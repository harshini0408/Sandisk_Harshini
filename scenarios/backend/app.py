from flask import Flask, jsonify, request
from flask_cors import CORS
import os, random, math
import simulation_engine as engine

app = Flask(__name__)
CORS(app)

# ── Load ML models (lazy — on first use) ─────────────────────────────────────
_voltage_model    = None
_health_classifier = None

def _load_models():
    global _voltage_model, _health_classifier
    if _voltage_model is None:
        try:
            import joblib
            vp = os.path.join(os.path.dirname(__file__), 'models', 'voltage_model.pkl')
            _voltage_model = joblib.load(vp) if os.path.exists(vp) else None
        except Exception as e:
            print(f"[WARN] voltage_model not loaded: {e}")
    if _health_classifier is None:
        try:
            import joblib
            cp = os.path.join(os.path.dirname(__file__), 'models', 'health_classifier.pkl')
            _health_classifier = joblib.load(cp) if os.path.exists(cp) else None
        except Exception as e:
            print(f"[WARN] health_classifier not loaded: {e}")

# ── In-memory block health state store ────────────────────────────────────────
_block_states = {}  # block_id (int) → dict

def _get_block_state(block_id: int) -> dict:
    if block_id not in _block_states:
        _block_states[block_id] = {
            "iteration_history": [],
            "ecc_correction_count": 0,
            "prev_72h_count": 0,
            "tier3_hit_count": 0,
            "ftl_notified": False,
        }
    return _block_states[block_id]

# ── Health class metadata ──────────────────────────────────────────────────────
HEALTH_LABELS    = {0:"HEALTHY", 1:"MODERATELY_WORN", 2:"HIGHLY_DEGRADED", 3:"CRITICAL_METADATA"}
HEALTH_STRATEGY  = {0:"BCH only", 1:"BCH + Hard LDPC", 2:"BCH + Hard LDPC (strong)", 3:"Double-enveloped (BCH+LDPC+BCH verify)"}
HEALTH_MAX_ITERS = {0:8, 1:12, 2:20, 3:20}
HEALTH_PROT      = {0:"Standard", 1:"High", 2:"Maximum", 3:"Maximum + Verify"}

# ── ECC engine import ─────────────────────────────────────────────────────────
from ecc_engines import (
    calculate_syndrome, bch_decode, ldpc_hard_decode, update_block_health,
    DEFAULT_H, EXTENDED_H
)

# ─────────────────────────────────────────────────────────────────────────────
# Original simulation endpoints
# ─────────────────────────────────────────────────────────────────────────────
@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status":"ok","pillars":4,"scenarios":6,"ecc_engines":4,"ml_models":2})

@app.route("/api/state", methods=["GET"])
def get_state():
    return jsonify(engine.get_state())

@app.route("/api/reset", methods=["POST"])
def reset():
    _block_states.clear()
    state = engine.reset_state()
    return jsonify({"status":"reset","blocks":len(state["blocks"])})

@app.route("/api/start-simulation", methods=["POST"])
def start_simulation():
    data = request.get_json(force=True)
    scenario_id = data.get("scenario","BOOT").upper()
    result = engine.run_scenario(scenario_id)
    return jsonify(result)

@app.route("/api/events", methods=["GET"])
def get_events():
    return jsonify(engine.get_state()["event_log"])

# ─────────────────────────────────────────────────────────────────────────────
# PILLAR 3 ECC Endpoint 1 — POST /api/ecc/decode
# Full tiered ECC pipeline: Syndrome → BCH → LDPC → Voltage ML → Health Monitor
# ─────────────────────────────────────────────────────────────────────────────
@app.route("/api/ecc/decode", methods=["POST"])
def ecc_decode():
    _load_models()
    d = request.get_json(force=True)

    block_id      = int(d.get("block_id", 0))
    pe_cycles     = float(d.get("pe_cycles", 500))
    temperature   = float(d.get("temperature", 45))
    retention_days= float(d.get("retention_days", 30))
    wear_level    = float(d.get("wear_level", 0.2))
    num_errors    = int(d.get("num_errors", 0))
    # If codeword not provided, generate a random valid one
    codeword = d.get("codeword", [random.randint(0,1) for _ in range(16)])

    # ── STEP 1: Classify block health → get max_iters ─────────────────────────
    health_class = 0
    if _health_classifier:
        try:
            rber_est = min(1e-3, 1e-7 * math.exp(pe_cycles / 500))
            ecc_rate = rber_est * 1e6
            ldpc_avg = 1.5 + (pe_cycles / 3000) * 18
            is_meta  = 0
            feats = [[pe_cycles, rber_est, ecc_rate, ldpc_avg, temperature, is_meta]]
            health_class = int(_health_classifier.predict(feats)[0])
        except Exception as e:
            print(f"[WARN] health_classifier predict error: {e}")
    else:
        # Fallback rule-based classification
        if pe_cycles >= 2000:    health_class = 2
        elif pe_cycles >= 800:   health_class = 1
        else:                    health_class = 0

    max_iters    = HEALTH_MAX_ITERS[health_class]
    health_label = HEALTH_LABELS[health_class]

    # ── STEP 2: Syndrome check ────────────────────────────────────────────────
    syn = calculate_syndrome(codeword, EXTENDED_H)

    if syn["is_zero"] and num_errors == 0:
        blk_state = _get_block_state(block_id)
        health_result = update_block_health(block_id, {"iterations":0,"errors_found":0,"tier":1}, blk_state)
        return jsonify({
            "tier_used": 1, "success": True,
            "iterations": 0, "errors_detected": 0, "errors_corrected": 0,
            "latency_us": 0.0, "pre_failure_flag": False,
            "syndrome": syn["syndrome_hex"], "syndrome_bits": syn["syndrome_bits"],
            "block_health": health_label, "max_iters_allowed": max_iters,
            "health_class": health_class,
            "description": "Syndrome Zero Bypass — H·r=0, data returned instantly. 0 µs overhead.",
            "mode": "SYNDROME_ZERO",
            "parity_matrix": EXTENDED_H[:4],
            "health_monitor": health_result,
        })

    # ── STEP 3: BCH decode ────────────────────────────────────────────────────
    bch = bch_decode(codeword, num_errors=num_errors, H=DEFAULT_H, t=4)
    if bch["success"] and num_errors <= 4:
        blk_state = _get_block_state(block_id)
        health_result = update_block_health(block_id, {
            "iterations": 0, "errors_found": bch["errors_found"], "tier": 2
        }, blk_state)
        return jsonify({
            "tier_used": 2, "success": True,
            "iterations": 0, "errors_detected": bch["errors_found"],
            "errors_corrected": bch["errors_corrected"],
            "latency_us": bch["latency_us"],
            "pre_failure_flag": health_result["pre_failure_flag"],
            "syndrome": syn["syndrome_hex"], "syndrome_bits": syn["syndrome_bits"],
            "block_health": health_label, "max_iters_allowed": max_iters,
            "health_class": health_class,
            "description": f"BCH corrected {bch['errors_found']} bit-flip(s). Latency: {bch['latency_us']} µs.",
            "mode": "BCH",
            "parity_matrix": DEFAULT_H,
            "health_monitor": health_result,
        })

    # ── STEP 4: Hard LDPC ─────────────────────────────────────────────────────
    ldpc = ldpc_hard_decode(codeword, H=EXTENDED_H, max_iters=max_iters,
                             num_errors=num_errors)
    if ldpc["success"]:
        blk_state = _get_block_state(block_id)
        health_result = update_block_health(block_id, {
            "iterations": ldpc["iterations"],
            "errors_found": num_errors,
            "tier": 2
        }, blk_state)
        pre_flag = health_result["pre_failure_flag"]
        warn_msg = " ⚠ ITERS >= 15 — Pre-failure flag sent to Pillar 1!" if ldpc["iterations"] >= 15 else ""
        return jsonify({
            "tier_used": 2, "success": True,
            "iterations": ldpc["iterations"],
            "errors_detected": num_errors, "errors_corrected": num_errors,
            "latency_us": ldpc["latency_us"],
            "pre_failure_flag": pre_flag,
            "syndrome": syn["syndrome_hex"], "syndrome_bits": syn["syndrome_bits"],
            "block_health": health_label, "max_iters_allowed": max_iters,
            "health_class": health_class,
            "description": f"Hard LDPC corrected {num_errors} errors in {ldpc['iterations']}/{max_iters} iters.{warn_msg}",
            "mode": "HARD_LDPC",
            "iteration_log": ldpc["iteration_log"],
            "parity_matrix": EXTENDED_H[:4],
            "health_monitor": health_result,
        })

    # ── STEP 5: ML Soft-Decision (Tier 3) ─────────────────────────────────────
    voltage_shift = round(random.uniform(15, 45), 1)  # fallback
    if _voltage_model:
        try:
            feats = [[pe_cycles, temperature, retention_days, wear_level]]
            voltage_shift = round(float(_voltage_model.predict(feats)[0]) * 1000, 1)  # V → mV
        except Exception as e:
            print(f"[WARN] voltage_model predict error: {e}")

    lat_t3 = round(random.uniform(3.2, 5.8), 2)
    blk_state = _get_block_state(block_id)
    health_result = update_block_health(block_id, {
        "iterations": max_iters, "errors_found": num_errors, "tier": 3
    }, blk_state)

    return jsonify({
        "tier_used": 3, "success": True,
        "iterations": max_iters,
        "errors_detected": num_errors, "errors_corrected": num_errors,
        "latency_us": lat_t3,
        "voltage_shift_mv": voltage_shift,
        "pre_failure_flag": True,
        "syndrome": syn["syndrome_hex"], "syndrome_bits": syn["syndrome_bits"],
        "block_health": health_label, "max_iters_allowed": max_iters,
        "health_class": health_class,
        "description": (
            f"ML Soft-LDPC Recovery. 3.3 KB Decision Tree predicted ΔV=+{voltage_shift} mV. "
            f"Latency: {lat_t3} µs. ⚠ Tier 3 → Pre-failure flag → Pillar 1 FTL."
        ),
        "mode": "ML_SOFT_LDPC",
        "iteration_log": ldpc.get("iteration_log", []),
        "parity_matrix": EXTENDED_H[:4],
        "health_monitor": health_result,
        "model_info": {
            "type": "DecisionTreeRegressor",
            "max_depth": 6,
            "size_kb": 3.3,
            "features": ["pe_cycles", "temperature", "retention_days", "wear_level"],
            "simulated": _voltage_model is None,
        },
    })


# ─────────────────────────────────────────────────────────────────────────────
# PILLAR 3 ECC Endpoint 2 — POST /api/ecc/classify-block
# Block Health Classifier → ECC strategy allocation
# ─────────────────────────────────────────────────────────────────────────────
@app.route("/api/ecc/classify-block", methods=["POST"])
def classify_block():
    _load_models()
    d = request.get_json(force=True)

    block_id           = int(d.get("block_id", 0))
    pe_cycles          = float(d.get("pe_cycles", 500))
    rber               = float(d.get("rber", 1e-6))
    ecc_correction_rate= float(d.get("ecc_correction_rate", 0))
    ldpc_avg_iterations= float(d.get("ldpc_avg_iterations", 2.0))
    temperature        = float(d.get("temperature", 45))
    is_metadata        = int(d.get("is_metadata", 0))

    health_class = 0
    confidence   = 1.0
    if _health_classifier:
        try:
            feats = [[pe_cycles, rber, ecc_correction_rate, ldpc_avg_iterations,
                      temperature, is_metadata]]
            health_class = int(_health_classifier.predict(feats)[0])
            proba = _health_classifier.predict_proba(feats)[0]
            confidence = round(float(max(proba)), 3)
        except Exception as e:
            print(f"[WARN] classify error: {e}")
            health_class = _rule_classify(pe_cycles, rber, is_metadata)
    else:
        health_class = _rule_classify(pe_cycles, rber, is_metadata)

    label    = HEALTH_LABELS[health_class]
    strategy = HEALTH_STRATEGY[health_class]
    max_iter = HEALTH_MAX_ITERS[health_class]
    prot     = HEALTH_PROT[health_class]

    rec_map = {
        0: "Block healthy — standard monitoring",
        1: "Monitor — approaching degraded threshold",
        2: "High risk — data relocation recommended",
        3: "Critical metadata — maximum protection always applied",
    }

    return jsonify({
        "block_id":        block_id,
        "health_class":    health_class,
        "health_label":    label,
        "ecc_strategy":    strategy,
        "max_iterations":  max_iter,
        "protection_level": prot,
        "confidence":      confidence,
        "recommendation":  rec_map[health_class],
        "model_used":      "RandomForestClassifier" if _health_classifier else "rule_based",
        "feature_importance": {
            "pe_cycles": 0.42, "rber": 0.28, "ldpc_avg_iterations": 0.15,
            "ecc_correction_rate": 0.08, "temperature": 0.05, "is_metadata": 0.02,
        },
    })

def _rule_classify(pe_cycles, rber, is_metadata):
    if is_metadata:       return 3
    if pe_cycles >= 2000 or rber > 1e-4: return 2
    if pe_cycles >= 800:  return 1
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# PILLAR 3 ECC Endpoint 3 — GET /api/ecc/block-health/<block_id>
# Full health telemetry for a single block
# ─────────────────────────────────────────────────────────────────────────────
@app.route("/api/ecc/block-health/<int:block_id>", methods=["GET"])
def get_block_health(block_id):
    _load_models()

    # Get sim state for this block
    sim_state = engine.get_state()
    blocks    = sim_state.get("blocks", [])
    sim_block = blocks[block_id] if block_id < len(blocks) else {}

    pe_cycles  = float(sim_block.get("pe_cycles", 0))
    wear_pct   = round(pe_cycles / 3000 * 100, 1)
    rber_est   = min(1e-3, 1e-7 * math.exp(pe_cycles / 500)) if pe_cycles > 0 else 1e-7

    bstate = _get_block_state(block_id)
    avg_iters = (round(sum(bstate["iteration_history"]) / len(bstate["iteration_history"]), 2)
                 if bstate["iteration_history"] else 0.0)

    health_class = _rule_classify(pe_cycles, rber_est, 0)
    if _health_classifier:
        try:
            ecc_rate = rber_est * 1e6
            ldpc_avg = avg_iters if avg_iters > 0 else (1.5 + (pe_cycles/3000)*18)
            feats = [[pe_cycles, rber_est, ecc_rate, ldpc_avg, 45, 0]]
            health_class = int(_health_classifier.predict(feats)[0])
        except: pass

    pre_fail = avg_iters >= 15 or bstate["tier3_hit_count"] > 0

    return jsonify({
        "block_id":            block_id,
        "pe_cycles":           pe_cycles,
        "wear_pct":            wear_pct,
        "rber":                round(rber_est, 10),
        "iteration_history":   bstate["iteration_history"],
        "avg_iterations":      avg_iters,
        "ecc_correction_count": bstate["ecc_correction_count"],
        "tier3_hit_count":     bstate["tier3_hit_count"],
        "pre_failure_flag":    pre_fail,
        "recommended_tier":    3 if pre_fail else (2 if health_class >= 1 else 1),
        "health_class":        health_class,
        "health_label":        HEALTH_LABELS[health_class],
        "ecc_strategy":        HEALTH_STRATEGY[health_class],
        "max_iterations":      HEALTH_MAX_ITERS[health_class],
        "ftl_notified":        bstate["ftl_notified"],
        "action_taken":        "DATA_RELOCATION_PENDING" if pre_fail else "NONE",
        "block_sim_state":     sim_block,
    })


# ─────────────────────────────────────────────────────────────────────────────
# PILLAR 3 ECC Endpoint 4 — GET /api/ecc/classify-all
# Classify all 64 blocks at once for grid coloring
# ─────────────────────────────────────────────────────────────────────────────
@app.route("/api/ecc/classify-all", methods=["GET"])
def classify_all():
    _load_models()
    sim_state = engine.get_state()
    blocks    = sim_state.get("blocks", [])
    results   = []
    for i, blk in enumerate(blocks):
        pe     = float(blk.get("pe_cycles", 0))
        rber_e = min(1e-3, 1e-7 * math.exp(pe / 500)) if pe > 0 else 1e-7
        hc     = _rule_classify(pe, rber_e, 0)
        if _health_classifier:
            try:
                ldpc_avg = 1.5 + (pe/3000)*18
                feats = [[pe, rber_e, rber_e*1e6, ldpc_avg, 45, 0]]
                hc = int(_health_classifier.predict(feats)[0])
            except: pass
        bstate = _get_block_state(i)
        avg_i  = (sum(bstate["iteration_history"])/len(bstate["iteration_history"])
                  if bstate["iteration_history"] else 0.0)
        results.append({
            "block_id":     i,
            "pe_cycles":    pe,
            "health_class": hc,
            "health_label": HEALTH_LABELS[hc],
            "max_iters":    HEALTH_MAX_ITERS[hc],
            "avg_iters":    round(avg_i, 1),
            "pre_failure":  avg_i >= 15,
            "health":       blk.get("health", "GOOD"),
        })
    return jsonify(results)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
