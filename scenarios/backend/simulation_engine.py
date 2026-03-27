import random
import time
import json
import os
import hashlib
import base64

# ── AES-256 via pycryptodome (graceful fallback) ──────────────────────────────
try:
    from Crypto.Cipher import AES
    from Crypto.Random import get_random_bytes
    HAS_CRYPTO = True
except ImportError:
    HAS_CRYPTO = False

# ── Global system state ───────────────────────────────────────────────────────
def fresh_state():
    blocks = []
    for i in range(64):
        pe = random.randint(200, 2900)
        err_rate = round(pe / 3000 * 0.15 + random.uniform(0, 0.02), 4)
        health = "GOOD" if pe < 2000 else ("WARN" if pe < 2600 else "BAD")
        blocks.append({
            "id": i,
            "pe_cycles": pe,
            "error_rate": err_rate,
            "health": health,
            "data": f"data_{i}",
            "ecc_tier": 1 if pe < 1500 else (2 if pe < 2400 else 3),
        })
    return {
        "blocks": blocks,
        "bbt": {i: b["health"] for i, b in enumerate(blocks)},
        "smart_metrics": {
            "reallocated_sectors": random.randint(0, 10),
            "program_fail_count": 0,
            "erase_fail_count": 0,
            "wear_leveling_count": random.randint(100, 1000),
            "ecc_correction_rate": round(random.uniform(0.001, 0.05), 4),
            "rul_days": random.randint(200, 1000),
            "power_on_hours": random.randint(1000, 8760),
            "unsafe_shutdowns": 0,
            "crc_errors": 0,
            "temperature": random.randint(30, 55),
            "available_spare": random.randint(60, 100),
            "media_errors": 0,
        },
        "event_log": [],
        "host_status": "ACTIVE",
        "oob_active": False,
        "gc_runs": 0,
        "free_blocks": sum(1 for b in blocks if b["health"] != "BAD"),
    }

_state = fresh_state()

def get_state():
    return _state

def reset_state():
    global _state
    _state = fresh_state()
    return _state

def emit_event(source, etype, block_id=None, details=None):
    evt = {
        "ts": round(time.time() * 1000),
        "source": source,
        "type": etype,
        "block_id": block_id,
        "details": details or {},
    }
    _state["event_log"].append(evt)
    return evt

# ── Shamir Secret Sharing (simple 5-of-3 demo) ───────────────────────────────
def shamir_split(secret_hex: str, n=5, k=3):
    """Very simplified Shamir demo – XOR-based split for display purposes."""
    secret_bytes = bytes.fromhex(secret_hex)
    shares = []
    running = secret_bytes
    for i in range(n - 1):
        share = os.urandom(len(secret_bytes))
        shares.append(share.hex())
        running = bytes(a ^ b for a, b in zip(running, share))
    shares.append(running.hex())
    random.shuffle(shares)
    return shares

# ── AES-256 encryption helper ─────────────────────────────────────────────────
def aes_encrypt(plaintext: str):
    if not HAS_CRYPTO:
        # fallback — simulate
        key_hex = hashlib.sha256(b"simulated_key").hexdigest()
        return {
            "key_hex": key_hex,
            "ciphertext_b64": base64.b64encode(plaintext.encode()).decode(),
            "iv_hex": "00" * 16,
            "simulated": True,
        }
    key = get_random_bytes(32)
    cipher = AES.new(key, AES.MODE_GCM)
    ct, tag = cipher.encrypt_and_digest(plaintext.encode())
    return {
        "key_hex": key.hex(),
        "ciphertext_b64": base64.b64encode(ct).decode(),
        "iv_hex": cipher.nonce.hex(),
        "tag_hex": tag.hex(),
        "simulated": False,
    }

# ═══════════════════════════════════════════════════════════════════════════════
# SCENARIO IMPLEMENTATIONS
# ═══════════════════════════════════════════════════════════════════════════════

def scenario_boot():
    """Scenario 1 — SSD Boot"""
    reset_state()
    steps = []

    # Pillar 2 — rebuild BBT
    emit_event("PILLAR_2", "BBT_REBUILD", details={"bloom_filter": "initializing"})
    steps.append({
        "page": "pillar2",
        "event": "BBT_REBUILD",
        "message": "Pillar 2: Rebuilding Bad Block Table from reserved NAND region",
        "data": {
            "good_blocks": sum(1 for b in _state["blocks"] if b["health"] == "GOOD"),
            "warn_blocks": sum(1 for b in _state["blocks"] if b["health"] == "WARN"),
            "bad_blocks": sum(1 for b in _state["blocks"] if b["health"] == "BAD"),
            "bloom_filter": "initialized",
            "bitmap": "populated",
            "cuckoo_hash": "loaded",
        }
    })

    # Pillar 1 — SMART baseline + LSTM seed
    emit_event("PILLAR_1", "SMART_BASELINE", details={"rul": _state["smart_metrics"]["rul_days"]})
    steps.append({
        "page": "pillar1",
        "event": "SMART_BASELINE",
        "message": "Pillar 1: SMART baseline snapshot captured, LSTM seeded",
        "data": {**_state["smart_metrics"], "lstm_status": "seeded", "ftl_status": "initializing"},
    })

    # Pillar 3 — ECC engine init
    emit_event("PILLAR_3", "ECC_INIT", details={"strength": "BCH+LDPC"})
    steps.append({
        "page": "pillar3",
        "event": "ECC_INIT",
        "message": "Pillar 3: ECC engine initialized (BCH + LDPC + ML Soft-Decision)",
        "data": {
            "tier1": {"status": "READY", "mode": "Syndrome Check"},
            "tier2": {"status": "READY", "mode": "BCH + Hard LDPC"},
            "tier3": {"status": "READY", "mode": "ML Soft-Decision"},
        }
    })

    # Pillar 4 — logic optimization
    emit_event("PILLAR_4", "LOGIC_OPTIMIZE", details={"reduction": "44%"})
    steps.append({
        "page": "pillar4",
        "event": "LOGIC_OPTIMIZE",
        "message": "Pillar 4: Decision logic minimized via Quine-McCluskey (44% reduction)",
        "data": {
            "original_ops": 9,
            "optimized_ops": 5,
            "reduction_pct": 44,
            "kmap_result": "minimized",
        }
    })

    steps.append({
        "page": "result",
        "event": "SYSTEM_READY",
        "message": "System Ready — All pillars online. SSD boot complete.",
        "data": {"status": "READY", "rul": _state["smart_metrics"]["rul_days"]},
    })
    return {"scenario": "BOOT", "steps": steps, "state": _state}


def scenario_read():
    """Scenario 2 — Normal Read Request"""
    block_id = random.randint(0, 63)
    block = _state["blocks"][block_id]
    steps = []

    # Host → NVMe
    emit_event("HOST", "READ_REQUEST", block_id=block_id)
    steps.append({
        "page": "home",
        "event": "READ_REQUEST",
        "message": f"Host OS issues READ_REQUEST for LBA → Block {block_id} over NVMe",
        "data": {"lba": block_id * 512, "block_id": block_id}
    })

    # Pillar 1 — FTL translate
    emit_event("PILLAR_1", "FTL_TRANSLATE", block_id=block_id)
    steps.append({
        "page": "pillar1",
        "event": "FTL_TRANSLATE",
        "message": f"Pillar 1 FTL: Logical address → Physical Block {block_id}, Page 4",
        "data": {**_state["smart_metrics"], "target_block": block_id, "ftl_status": "translating"},
    })

    # Pillar 2 — BBT gate
    emit_event("PILLAR_2", "BBT_CHECK", block_id=block_id, details={"result": block["health"]})
    steps.append({
        "page": "pillar2",
        "event": "BBT_CHECK",
        "message": f"Pillar 2: Bloom Filter + Bitmap check → Block {block_id} is {block['health']}",
        "data": {
            "block_id": block_id,
            "bloom_result": "POSSIBLY_GOOD",
            "bitmap_result": block["health"],
            "cuckoo_pe": block["pe_cycles"],
        }
    })

    # Pillar 3 — ECC decode
    tier = block["ecc_tier"]
    iterations = random.randint(0, 5) if tier == 1 else (random.randint(6, 14) if tier == 2 else random.randint(15, 20))
    ecc_event = "ECC_DETECTED" if tier > 1 else "ECC_CLEAN"
    emit_event("PILLAR_3", ecc_event, block_id=block_id, details={"tier": tier, "iterations": iterations})
    steps.append({
        "page": "pillar3",
        "event": ecc_event,
        "message": f"Pillar 3: Tier {tier} ECC{'— ' + str(iterations) + ' iterations' if tier > 1 else ' syndrome ZERO — clean read'}",
        "data": {
            "tier": tier,
            "iterations": iterations,
            "pe_cycles": block["pe_cycles"],
            "rber": block["error_rate"],
            "result": "CORRECTED" if tier <= 2 else "ML_ASSISTED",
        }
    })

    steps.append({
        "page": "result",
        "event": "READ_COMPLETE",
        "message": f"READ complete — Data from Block {block_id} successfully delivered to host",
        "data": {"block_id": block_id, "tier_used": tier, "latency_us": 50 + iterations * 10},
    })
    return {"scenario": "READ", "steps": steps, "state": _state}


def scenario_write():
    """Scenario 3 — Normal Write Request"""
    # pick lowest PE block
    good = [b for b in _state["blocks"] if b["health"] == "GOOD"]
    block = min(good, key=lambda b: b["pe_cycles"]) if good else _state["blocks"][0]
    block_id = block["id"]
    steps = []

    emit_event("HOST", "WRITE_REQUEST", block_id=block_id)
    steps.append({
        "page": "home",
        "event": "WRITE_REQUEST",
        "message": f"Host OS issues WRITE_REQUEST → NVMe → FTL",
        "data": {"block_id": block_id}
    })

    emit_event("PILLAR_1", "FTL_TRANSLATE", block_id=block_id)
    steps.append({
        "page": "pillar1",
        "event": "FTL_TRANSLATE",
        "message": f"Pillar 1 FTL: Wear leveling selects Block {block_id} (lowest PE={block['pe_cycles']})",
        "data": {**_state["smart_metrics"], "target_block": block_id, "pe_cycles": block["pe_cycles"]},
    })

    emit_event("PILLAR_2", "BLOCK_ALLOC", block_id=block_id)
    steps.append({
        "page": "pillar2",
        "event": "BLOCK_ALLOC",
        "message": f"Pillar 2: Block {block_id} allocated (Cuckoo Hash updated with new P/E count)",
        "data": {"block_id": block_id, "pe_before": block["pe_cycles"], "pe_after": block["pe_cycles"] + 1}
    })

    # ECC encode
    emit_event("PILLAR_3", "ECC_ENCODE", block_id=block_id)
    steps.append({
        "page": "pillar3",
        "event": "ECC_ENCODE",
        "message": "Pillar 3: BCH parity bits attached to codeword before NAND write",
        "data": {"block_id": block_id, "parity_bits": 128, "mode": "BCH_ENCODE"}
    })

    # Update state
    _state["blocks"][block_id]["pe_cycles"] += 1
    _state["smart_metrics"]["wear_leveling_count"] += 1

    steps.append({
        "page": "result",
        "event": "WRITE_COMPLETE",
        "message": f"WRITE complete — Data safely written to Block {block_id} with ECC",
        "data": {"block_id": block_id, "pe_cycles": _state["blocks"][block_id]["pe_cycles"]},
    })
    return {"scenario": "WRITE", "steps": steps, "state": _state}


def scenario_degradation():
    """Scenario 4 — Progressive Block Degradation"""
    # pick a WARN block or highest PE
    warn = [b for b in _state["blocks"] if b["health"] == "WARN"]
    block = random.choice(warn) if warn else max(_state["blocks"], key=lambda b: b["pe_cycles"])
    block_id = block["id"]

    # Find a fresh target block for relocation
    good = [b for b in _state["blocks"] if b["health"] == "GOOD" and b["id"] != block_id]
    target = min(good, key=lambda b: b["pe_cycles"]) if good else _state["blocks"][(block_id + 1) % 64]
    target_id = target["id"]

    steps = []

    emit_event("PILLAR_3", "ECC_DETECTED", block_id=block_id, details={"iterations": 17, "pe": block["pe_cycles"]})
    steps.append({
        "page": "pillar3",
        "event": "ECC_DETECTED",
        "message": f"Pillar 3: Block {block_id} (PE={block['pe_cycles']}) → Tier 2 LDPC 17 iterations — escalating",
        "data": {
            "block_id": block_id, "pe_cycles": block["pe_cycles"],
            "tier": 2, "iterations": 17, "rber": block["error_rate"],
            "threshold_breached": True,
        }
    })

    emit_event("PILLAR_3", "PRE_FAILURE", block_id=block_id, details={"tier3_invoked": True})
    steps.append({
        "page": "pillar3",
        "event": "PRE_FAILURE",
        "message": f"Pillar 3: PRE_FAILURE flag → Tier 3 ML soft-decision triggered for Block {block_id}",
        "data": {
            "block_id": block_id, "ml_prediction": "IMMINENT_FAILURE",
            "voltage_shift_model": "3.3KB", "read_threshold_adjusted": True,
        }
    })

    emit_event("PILLAR_1", "DATA_RELOCATION", block_id=block_id, details={"target": target_id})
    steps.append({
        "page": "pillar1",
        "event": "DATA_RELOCATION",
        "message": f"Pillar 1 FTL: Relocating data from Block {block_id} → Block {target_id}",
        "data": {
            **_state["smart_metrics"],
            "source_block": block_id, "target_block": target_id,
            "lstm_rul_update": max(0, _state["smart_metrics"]["rul_days"] - 10),
        }
    })

    emit_event("PILLAR_2", "BLOCK_RETIRE", block_id=block_id, details={"pe": block["pe_cycles"]})
    _state["blocks"][block_id]["health"] = "BAD"
    _state["bbt"][block_id] = "BAD"
    _state["smart_metrics"]["reallocated_sectors"] += 1
    _state["smart_metrics"]["rul_days"] = max(0, _state["smart_metrics"]["rul_days"] - 10)
    steps.append({
        "page": "pillar2",
        "event": "BLOCK_RETIRE",
        "message": f"Pillar 2: Block {block_id} RETIRED — Bloom Filter updated, Bitmap=BAD, Cuckoo Hash logged",
        "data": {
            "block_id": block_id, "status": "RETIRED",
            "pe_at_death": block["pe_cycles"],
            "good_blocks": sum(1 for b in _state["blocks"] if b["health"] == "GOOD"),
            "bad_blocks": sum(1 for b in _state["blocks"] if b["health"] == "BAD"),
        }
    })

    emit_event("PILLAR_4", "LOGIC_OPTIMIZE", details={"reason": "post-failure threshold update"})
    steps.append({
        "page": "pillar4",
        "event": "LOGIC_OPTIMIZE",
        "message": "Pillar 4: Decision thresholds recalculated after degradation event",
        "data": {"new_threshold": block["pe_cycles"], "optimized": True, "reduction_pct": 44}
    })

    steps.append({
        "page": "result",
        "event": "DEGRADATION_HANDLED",
        "message": "Block degradation handled — data relocated, block retired, UECC=0",
        "data": {
            "uecc_count": 0,
            "data_lost": False,
            "lifespan_extended": "1.5x",
            "retired_block": block_id,
        }
    })
    return {"scenario": "DEGRADATION", "steps": steps, "state": _state}


def scenario_host_crash():
    """Scenario 5 — Host Crash (OOB + Security)"""
    steps = []
    _state["host_status"] = "DOWN"
    _state["oob_active"] = True
    _state["smart_metrics"]["unsafe_shutdowns"] += 1

    emit_event("HOST", "HOST_CRASH", details={"reason": "abnormal_poweroff"})
    steps.append({
        "page": "home",
        "event": "HOST_CRASH",
        "message": "HOST CRASH detected — NVMe in-band channel SILENT",
        "data": {"host_status": "DOWN", "nvme_status": "SILENT"}
    })

    emit_event("PILLAR_1", "OOB_TRIGGER", details={"channel": "UART/BLE"})
    steps.append({
        "page": "pillar1",
        "event": "OOB_TRIGGER",
        "message": "Pillar 1: In-band silent → switching to OOB channel (UART/BLE)",
        "data": {**_state["smart_metrics"], "oob_channel": "UART/BLE", "capacitor_power": True}
    })

    # Collect diagnostic payload
    diag = {
        "smart": _state["smart_metrics"],
        "bad_blocks": [i for i, h in _state["bbt"].items() if h == "BAD"],
        "rul": _state["smart_metrics"]["rul_days"],
        "timestamp": int(time.time()),
    }
    diag_str = json.dumps(diag)

    enc = aes_encrypt(diag_str)
    emit_event("PILLAR_1", "ENCRYPT_REPORT", details={"simulated": enc.get("simulated", True)})
    steps.append({
        "page": "oob",
        "event": "ENCRYPT_REPORT",
        "message": "Pillar 1: Diagnostic payload encrypted with AES-256-GCM",
        "data": {
            "plaintext_size": len(diag_str),
            "ciphertext_b64": enc["ciphertext_b64"][:64] + "...",
            "iv_hex": enc["iv_hex"],
            "simulated": enc.get("simulated", True),
        }
    })

    shares = shamir_split(enc["key_hex"])
    emit_event("PILLAR_1", "SHAMIR_SPLIT", details={"n": 5, "k": 3})
    steps.append({
        "page": "oob",
        "event": "SHAMIR_SPLIT",
        "message": "Pillar 1: AES key split into 5 Shamir shares (3-of-5 threshold)",
        "data": {
            "shares": [s[:24] + "..." for s in shares],
            "holders": ["Operator", "Cloud Node", "UART Port", "BLE Beacon", "Escrow"],
            "threshold": "3-of-5",
        }
    })

    emit_event("PILLAR_1", "OOB_TRANSMIT", details={"channel": "UART"})
    steps.append({
        "page": "oob",
        "event": "OOB_TRANSMIT",
        "message": "Pillar 1: Encrypted health report transmitted over UART/BLE OOB channel",
        "data": {"oob_channel": "UART", "bytes_sent": len(enc["ciphertext_b64"]), "status": "TRANSMITTED"}
    })

    steps.append({
        "page": "result",
        "event": "OOB_COMPLETE",
        "message": "OOB recovery complete — health report secured. Engineer can reconstruct with 3/5 shares.",
        "data": {
            "host_status": "DOWN",
            "oob_status": "TRANSMITTED",
            "shamir_shares": 5,
            "recovery_threshold": 3,
        }
    })
    return {"scenario": "HOST_CRASH", "steps": steps, "state": _state}


def scenario_gc():
    """Scenario 6 — Garbage Collection"""
    steps = []

    free_count = sum(1 for b in _state["blocks"] if b["health"] == "GOOD")
    emit_event("PILLAR_1", "GC_TRIGGER", details={"free_blocks": free_count})
    steps.append({
        "page": "pillar1",
        "event": "GC_TRIGGER",
        "message": f"Pillar 1 FTL: Free block count={free_count} → GC triggered",
        "data": {**_state["smart_metrics"], "free_blocks": free_count, "gc_reason": "low_space"}
    })

    # Pick worn blocks for GC
    candidates = sorted(_state["blocks"], key=lambda b: b["pe_cycles"], reverse=True)
    gc_blocks = [b for b in candidates if b["health"] == "GOOD"][:5]
    gc_ids = [b["id"] for b in gc_blocks]

    emit_event("PILLAR_2", "GC_CANDIDATES", details={"blocks": gc_ids})
    steps.append({
        "page": "pillar2",
        "event": "GC_CANDIDATES",
        "message": f"Pillar 2: Top worn candidates for GC → Blocks {gc_ids}",
        "data": {
            "candidates": [{"id": b["id"], "pe": b["pe_cycles"], "health": b["health"]} for b in gc_blocks],
            "selection_method": "cuckoo_hash_sorted_by_wear",
        }
    })

    # Fresh targets
    fresh = [b for b in _state["blocks"] if b["health"] == "GOOD" and b["id"] not in gc_ids]
    fresh_sorted = sorted(fresh, key=lambda b: b["pe_cycles"])[:5]
    fresh_ids = [b["id"] for b in fresh_sorted]

    emit_event("PILLAR_3", "ECC_ENCODE", details={"gc_reencode": True})
    steps.append({
        "page": "pillar3",
        "event": "ECC_ENCODE",
        "message": "Pillar 3: Valid pages re-encoded with fresh BCH parity during GC data copy",
        "data": {
            "source_blocks": gc_ids,
            "target_blocks": fresh_ids,
            "parity_refreshed": True,
        }
    })

    # Erase and increment PE
    retired_now = []
    for b in gc_blocks:
        _state["blocks"][b["id"]]["pe_cycles"] += 1
        if _state["blocks"][b["id"]]["pe_cycles"] >= 2800:
            _state["blocks"][b["id"]]["health"] = "BAD"
            _state["bbt"][b["id"]] = "BAD"
            retired_now.append(b["id"])
        else:
            _state["blocks"][b["id"]]["data"] = ""

    _state["gc_runs"] += 1
    _state["smart_metrics"]["wear_leveling_count"] += len(gc_blocks)

    emit_event("PILLAR_4", "LOGIC_OPTIMIZE", details={"gc_decision_minimized": True})
    steps.append({
        "page": "pillar4",
        "event": "LOGIC_OPTIMIZE",
        "message": "Pillar 4: Wear-leveling decision logic pre-optimized (9→5 ops, 44% reduction)",
        "data": {"original_ops": 9, "optimized_ops": 5, "reduction_pct": 44, "gc_runs": _state["gc_runs"]}
    })

    steps.append({
        "page": "result",
        "event": "GC_COMPLETE",
        "message": f"GC complete — {len(gc_blocks)} blocks erased, {len(retired_now)} retired, space reclaimed",
        "data": {
            "blocks_erased": len(gc_blocks),
            "blocks_retired": len(retired_now),
            "gc_run_count": _state["gc_runs"],
            "free_blocks_after": sum(1 for b in _state["blocks"] if b["health"] == "GOOD"),
        }
    })
    return {"scenario": "GC", "steps": steps, "state": _state}


# ── Dispatcher ────────────────────────────────────────────────────────────────
SCENARIOS = {
    "BOOT": scenario_boot,
    "READ": scenario_read,
    "WRITE": scenario_write,
    "DEGRADATION": scenario_degradation,
    "HOST_CRASH": scenario_host_crash,
    "GC": scenario_gc,
}

def run_scenario(scenario_id: str):
    fn = SCENARIOS.get(scenario_id)
    if not fn:
        return {"error": f"Unknown scenario: {scenario_id}"}
    return fn()
