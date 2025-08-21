import argparse, json, sys
import pandas as pd
import numpy as np
from sklearn.preprocessing import OneHotEncoder
from sklearn.metrics import accuracy_score
from scipy import sparse
from xgboost import XGBClassifier

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--csv', required=True)
    p.add_argument('--train-start', required=True)
    p.add_argument('--train-end', required=True)
    p.add_argument('--sim-start', required=True)
    p.add_argument('--sim-end', required=True)
    p.add_argument('--timestamp-col', default='Timestamp')
    p.add_argument('--target-col', default='Response')
    p.add_argument('--max-rows', type=int, default=1000)   # cap for UI streaming
    return p.parse_args()

def day_start(d): return pd.Timestamp(f"{d} 00:00:00")
def day_end(d):   return pd.Timestamp(f"{d} 23:59:59")

# ---- same thresholds as training.py ----
LOW_CARD_MAX  = 40
OHE_MAX_WIDTH = 20000
ROW_FRAC_CAP  = 0.05

def build_preprocessor(X_train, X_infer):
    num_cols = X_train.select_dtypes(exclude=['object']).columns.tolist()
    cat_cols = X_train.select_dtypes(include=['object']).columns.tolist()

    nunqs = {}
    low_card, high_card = [], []
    rows = max(1, len(X_train))
    for c in cat_cols:
        nunq = pd.concat([X_train[c], X_infer[c]], axis=0).nunique(dropna=False)
        nunqs[c] = int(nunq)
        if nunq <= LOW_CARD_MAX and nunq <= max(10, int(ROW_FRAC_CAP * rows)):
            low_card.append(c)
        else:
            high_card.append(c)

    # frequency-encode high-card
    for c in high_card:
        freq = X_train[c].value_counts(dropna=False)
        X_train[c] = X_train[c].map(freq).astype('float32')
        X_infer[c] = X_infer[c].map(freq).astype('float32')

    # dense base -> csr
    base_cols = num_cols + high_card
    if base_cols:
        tr_dense = X_train[base_cols].fillna(0).to_numpy(dtype=np.float32, copy=False)
        te_dense = X_infer[base_cols].fillna(0).to_numpy(dtype=np.float32, copy=False)
        tr_base = sparse.csr_matrix(tr_dense)
        te_base = sparse.csr_matrix(te_dense)
    else:
        tr_base = sparse.csr_matrix((len(X_train), 0), dtype=np.float32)
        te_base = sparse.csr_matrix((len(X_infer), 0), dtype=np.float32)

    # OHE (guard explosion)
    projected_ohe = sum(nunqs[c] for c in low_card) if low_card else 0
    do_ohe = low_card and projected_ohe <= OHE_MAX_WIDTH

    if do_ohe:
        ohe = OneHotEncoder(handle_unknown='ignore', sparse=True, dtype=np.float32)
        tr_ohe = ohe.fit_transform(X_train[low_card])
        te_ohe = ohe.transform(X_infer[low_card])
    else:
        # fallback: freq-encode the remaining low-card
        for c in low_card:
            freq = X_train[c].value_counts(dropna=False)
            X_train[c] = X_train[c].map(freq).astype('float32')
            X_infer[c] = X_infer[c].map(freq).astype('float32')
        tr_ohe = sparse.csr_matrix(X_train[low_card].fillna(0).to_numpy(dtype=np.float32)) if low_card else sparse.csr_matrix((len(X_train),0),dtype=np.float32)
        te_ohe = sparse.csr_matrix(X_infer[low_card].fillna(0).to_numpy(dtype=np.float32))  if low_card else sparse.csr_matrix((len(X_infer),0),dtype=np.float32)

    X_tr = sparse.hstack([tr_base, tr_ohe], format='csr', dtype=np.float32)
    X_te = sparse.hstack([te_base, te_ohe], format='csr', dtype=np.float32)
    return X_tr, X_te

def find_col(df, candidates):
    cols = {c.lower(): c for c in df.columns}
    for cand in candidates:
        for c in cols:
            if cand in c:
                return cols[c]
    return None

def main():
    args = parse_args()

    df = pd.read_csv(args.csv)
    if args.timestamp_col not in df.columns:
        print(json.dumps({"error": f"Timestamp column '{args.timestamp_col}' missing in CSV."}))
        sys.exit(2)
    if args.target_col not in df.columns:
        print(json.dumps({"error": f"Target column '{args.target_col}' missing in CSV."}))
        sys.exit(2)

    df[args.timestamp_col] = pd.to_datetime(df[args.timestamp_col], errors='coerce')
    df = df.dropna(subset=[args.timestamp_col])

    # splits
    train = df[(df[args.timestamp_col] >= day_start(args.train_start)) &
               (df[args.timestamp_col] <= day_end(args.train_end))].copy()
    sim   = df[(df[args.timestamp_col] >= day_start(args.sim_start)) &
               (df[args.timestamp_col] <= day_end(args.sim_end))].copy()

    if len(train) == 0 or len(sim) == 0:
        print(json.dumps({"error": "No rows in train and/or simulation ranges."}))
        sys.exit(3)

    y_train = train[args.target_col].astype(int)
    X_train = train.drop(columns=[c for c in [args.timestamp_col, args.target_col] if c in train.columns])
    X_sim   = sim.drop(columns=[c for c in [args.timestamp_col, args.target_col] if c in sim.columns])

    X_tr, X_te = build_preprocessor(X_train, X_sim)

    # class imbalance
    pos = max(1, int((y_train == 1).sum()))
    neg = max(1, int((y_train == 0).sum()))
    pos_weight = float(neg) / float(pos)

    mdl = XGBClassifier(
        n_estimators=200, max_depth=6, learning_rate=0.1,
        subsample=0.8, colsample_bytree=0.8, reg_lambda=1.0,
        random_state=42, n_jobs=-1, tree_method='hist',
        scale_pos_weight=pos_weight, eval_metric="logloss"
    )
    mdl.fit(X_tr, y_train)

    # prepare nice fields for UI
    id_col = 'Id' if 'Id' in sim.columns else None
    temp_col = find_col(sim, ['temperature', 'temp'])
    pres_col = find_col(sim, ['pressure'])
    hum_col  = find_col(sim, ['humidity', 'humid'])

    # predictions
    n = len(sim)
    if args.max_rows and n > args.max_rows:
        sim = sim.iloc[:args.max_rows, :]
        X_te = X_te[:args.max_rows, :]

    proba = mdl.predict_proba(X_te)[:, 1]  # P(class=1)
    pred  = (proba >= 0.5).astype(int)

    out = []
    for i, (_, row) in enumerate(sim.iterrows()):
        prob1 = float(proba[i])
        yhat  = int(pred[i])          # 1=fail (Bosch-style)
        conf  = prob1 if yhat == 1 else (1.0 - prob1)
        item = {
            "time": str(pd.to_datetime(row[args.timestamp_col]).strftime("%Y-%m-%d %H:%M:%S")),
            "sampleId": int(row[id_col]) if id_col and pd.notna(row[id_col]) else int(i+1),
            "prediction": "Fail" if yhat == 1 else "Pass",
            "confidence": round(conf * 100.0, 2),
            "temperature": float(row[temp_col]) if temp_col in sim.columns and pd.notna(row[temp_col]) else None,
            "pressure": float(row[pres_col]) if pres_col in sim.columns and pd.notna(row[pres_col]) else None,
            "humidity": float(row[hum_col]) if hum_col in sim.columns and pd.notna(row[hum_col]) else None
        }
        out.append(item)

    print(json.dumps(out))

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"error": f"simulate.py failed: {type(e).__name__}: {e}"}))
        sys.exit(1)