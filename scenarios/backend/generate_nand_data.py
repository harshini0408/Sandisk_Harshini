"""
generate_nand_data.py
Generates 15,000-row physics-based synthetic NAND dataset for Model 1 & 2.
Usage: python generate_nand_data.py
"""
import numpy as np
import pandas as pd
import os

np.random.seed(42)
N = 15000

# ── Primary features (physics ranges) ────────────────────────────────────────
pe_cycles      = np.random.uniform(0, 3000, N)
temperature    = np.clip(np.random.normal(45, 15, N), 25, 85)
retention_days = np.clip(np.random.exponential(60, N), 0, 365)
wear_level     = pe_cycles / 3000 + np.random.normal(0, 0.01, N)
wear_level     = np.clip(wear_level, 0, 1)
is_metadata    = (np.random.rand(N) < 0.08).astype(int)  # ~8% metadata blocks

# ── RBER: exponential with PE cycles (physics-based) ─────────────────────────
rber = 1e-7 * np.exp(pe_cycles / 500) + np.random.normal(0, 1e-8, N)
rber = np.clip(rber, 1e-8, 1e-2)

# ── ECC correction rate: correlated with RBER ─────────────────────────────────
ecc_correction_rate = rber * 1e6 + np.random.normal(0, 5, N)
ecc_correction_rate = np.clip(ecc_correction_rate, 0, 5000)

# ── LDPC avg iterations: driven by wear ───────────────────────────────────────
ldpc_avg_iterations = 1.5 + (pe_cycles / 3000) * 18 + np.random.normal(0, 0.8, N)
ldpc_avg_iterations = np.clip(ldpc_avg_iterations, 1.0, 20.0)

# ── MODEL 1 LABEL: voltage_shift (physics of oxide degradation) ────────────────
voltage_shift = (
    0.05 * (pe_cycles / 1000) ** 1.3
    + 0.02 * (temperature - 25) / 60
    + 0.015 * retention_days / 100
    + np.random.normal(0, 0.008, N)
)
# Clamp to realistic range
voltage_shift = np.clip(voltage_shift, -0.3, 0.3)

# ── MODEL 2 LABEL: health_class (derived from thresholds from document) ────────
health_class = np.zeros(N, dtype=int)  # default HEALTHY
health_class[pe_cycles >= 800] = 1     # MODERATELY_WORN
health_class[(pe_cycles >= 2000) | (rber > 1e-4)] = 2  # HIGHLY_DEGRADED
health_class[is_metadata == 1] = 3     # CRITICAL_METADATA (always max protection)

# ── Build DataFrame ────────────────────────────────────────────────────────────
df = pd.DataFrame({
    'pe_cycles':           pe_cycles,
    'temperature':         temperature,
    'retention_days':      retention_days,
    'wear_level':          wear_level,
    'rber':                rber,
    'ecc_correction_rate': ecc_correction_rate,
    'ldpc_avg_iterations': ldpc_avg_iterations,
    'temperature':         temperature,
    'is_metadata':         is_metadata,
    'voltage_shift':       voltage_shift,   # Model 1 label
    'health_class':        health_class,    # Model 2 label
})

os.makedirs('data', exist_ok=True)
df.to_csv('data/nand_synthetic.csv', index=False)
print(f"Generated {N} rows → data/nand_synthetic.csv")
print(f"voltage_shift: mean={df.voltage_shift.mean():.4f}V, std={df.voltage_shift.std():.4f}V")
print(f"health_class distribution:\n{df.health_class.value_counts().sort_index()}")
