"""
train_models.py
Trains both ML models required by the Pillar 3 ECC pipeline.
Usage: python train_models.py
"""
import os
import numpy as np
import pandas as pd
from sklearn.tree import DecisionTreeRegressor
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, classification_report
import joblib

os.makedirs('models', exist_ok=True)

# ── Load dataset ──────────────────────────────────────────────────────────────
if not os.path.exists('data/nand_synthetic.csv'):
    print("Dataset not found. Running generator...")
    import generate_nand_data  # generates it

df = pd.read_csv('data/nand_synthetic.csv')
print(f"Loaded {len(df)} rows.")

# ════════════════════════════════════════════════════════════════════════
# MODEL 1 — Voltage Shift Predictor
# DecisionTreeRegressor, max_depth=6 (~3.3 KB, firmware-ready)
# ════════════════════════════════════════════════════════════════════════
print("\n─── Training Model 1: Voltage Shift Predictor ───")

X1 = df[['pe_cycles', 'temperature', 'retention_days', 'wear_level']]
y1 = df['voltage_shift']

X1_train, X1_test, y1_train, y1_test = train_test_split(X1, y1, test_size=0.2, random_state=42)

model1 = DecisionTreeRegressor(max_depth=5, min_samples_leaf=15, random_state=42)
model1.fit(X1_train, y1_train)

preds1 = model1.predict(X1_test)
mae1 = mean_absolute_error(y1_test, preds1)
print(f"  MAE: {mae1:.4f}V  (target: < 0.015V)")

path1 = 'models/voltage_model.pkl'
joblib.dump(model1, path1)
size1_kb = os.path.getsize(path1) / 1024
print(f"  Saved → {path1}  ({size1_kb:.1f} KB)")
if size1_kb > 10:
    print(f"  [WARN] Model is {size1_kb:.1f} KB — larger than 3.3 KB target (acceptable for Python simulation)")

# ════════════════════════════════════════════════════════════════════════
# MODEL 2 — Block Health Classifier
# RandomForestClassifier, n_estimators=50, max_depth=8
# ════════════════════════════════════════════════════════════════════════
print("\n─── Training Model 2: Block Health Classifier ───")

X2 = df[['pe_cycles', 'rber', 'ecc_correction_rate', 'ldpc_avg_iterations',
          'temperature', 'is_metadata']]
y2 = df['health_class']

X2_train, X2_test, y2_train, y2_test = train_test_split(
    X2, y2, test_size=0.2, random_state=42, stratify=y2)

model2 = RandomForestClassifier(n_estimators=50, max_depth=8, random_state=42, n_jobs=-1)
model2.fit(X2_train, y2_train)

preds2 = model2.predict(X2_test)
print(classification_report(y2_test, preds2,
      target_names=['HEALTHY','MOD_WORN','HIGHLY_DEGRADED','CRITICAL_META']))

path2 = 'models/health_classifier.pkl'
joblib.dump(model2, path2)
size2_kb = os.path.getsize(path2) / 1024
print(f"  Saved → {path2}  ({size2_kb:.1f} KB)")

print("\n✅ Both models trained and saved.")
