import argparse, json, sys
import pandas as pd
import numpy as np
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix
from sklearn.preprocessing import OneHotEncoder
from scipy import sparse
from xgboost import XGBClassifier

# ------------------ ARG PARSING ------------------
def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--csv', required=True)
    p.add_argument('--train-start', required=True)
    p.add_argument('--train-end', required=True)
    p.add_argument('--test-start', required=True)
    p.add_argument('--test-end', required=True)
    p.add_argument('--timestamp-col', default='Timestamp')
    p.add_argument('--target-col', default='Response')
    return p.parse_args()

def day_start(d): return pd.Timestamp(f"{d} 00:00:00")
def day_end(d):   return pd.Timestamp(f"{d} 23:59:59")

# ------------------ METRICS CHOICE ------------------
def choose_metrics(y):
    n_classes = len(np.unique(y))
    if n_classes > 2:
        return ["mlogloss", "merror"], "mlogloss", "merror"
    else:
        return ["logloss", "error"], "logloss", "error"

# ------------------ ROBUST FIT ------------------
def safe_fit(model, X_tr, y_tr, X_va, y_va, metrics):
    eval_set = [(X_tr, y_tr), (X_va, y_va)]
    try:
        model.set_params(eval_metric=metrics)
    except Exception:
        try:
            model.set_params(eval_metric=metrics[0])
        except Exception:
            pass
    # try with early stopping + silent
    try:
        model.fit(X_tr, y_tr, eval_set=eval_set,
                  early_stopping_rounds=25, verbose=False)
        return
    except TypeError:
        pass
    # fallback: no early stopping
    try:
        model.fit(X_tr, y_tr, eval_set=eval_set, verbose=False)
    except TypeError:
        model.fit(X_tr, y_tr)

# ------------------ MAIN ------------------
def main():
    args = parse_args()

    # load CSV
    df = pd.read_csv(args.csv)
    if args.timestamp_col not in df.columns:
        print(json.dumps({"error": f"Timestamp column '{args.timestamp_col}' missing in CSV."}))
        sys.exit(2)
    if args.target_col not in df.columns:
        print(json.dumps({"error": f"Target column '{args.target_col}' missing in CSV."}))
        sys.exit(2)

    # parse and filter time
    df[args.timestamp_col] = pd.to_datetime(df[args.timestamp_col], errors='coerce')
    df = df.dropna(subset=[args.timestamp_col])

    train = df[(df[args.timestamp_col] >= day_start(args.train_start)) &
               (df[args.timestamp_col] <= day_end(args.train_end))].copy()
    test  = df[(df[args.timestamp_col] >= day_start(args.test_start)) &
               (df[args.timestamp_col] <= day_end(args.test_end))].copy()

    if len(train) == 0 or len(test) == 0:
        print(json.dumps({"error": "No rows in train and/or test ranges."}))
        sys.exit(3)

    y_train = train[args.target_col].astype(int)
    y_test  = test[args.target_col].astype(int)

    X_train = train.drop(columns=[c for c in [args.timestamp_col, args.target_col] if c in train.columns])
    X_test  = test.drop(columns=[c for c in [args.timestamp_col, args.target_col] if c in test.columns])

    # ===== Memory-safe feature engineering =====
    LOW_CARD_MAX = 40                # OHE only if <= 40 unique levels
    OHE_MAX_WIDTH = 20000            # hard cap on total OHE features
    ROW_FRAC_CAP = 0.05              # and each OHE column must have nunique <= 5% of rows

    # numeric vs categorical (object)
    num_cols = X_train.select_dtypes(exclude=['object']).columns.tolist()
    cat_cols = X_train.select_dtypes(include=['object']).columns.tolist()

    # frequency-encode high-card categoricals
    low_card, high_card = [], []
    nunqs = {}
    combined_rows = max(1, len(X_train))
    for c in cat_cols:
        nunq = pd.concat([X_train[c], X_test[c]], axis=0).nunique(dropna=False)
        nunqs[c] = int(nunq)
        # treat as low-card ONLY if tiny relative to rows and <= LOW_CARD_MAX
        if nunq <= LOW_CARD_MAX and nunq <= max(10, int(ROW_FRAC_CAP * combined_rows)):
            low_card.append(c)
        else:
            high_card.append(c)

    # frequency-encode high-card (single compact float32 per col)
    for c in high_card:
        freq = X_train[c].value_counts(dropna=False)
        X_train[c] = X_train[c].map(freq).astype('float32')
        X_test[c]  = X_test[c].map(freq).astype('float32')

    # numeric + high-card block (dense -> csr)
    base_cols = num_cols + high_card
    if base_cols:
        num_block_tr = X_train[base_cols].fillna(0).to_numpy(dtype=np.float32, copy=False)
        num_block_te = X_test[base_cols].fillna(0).to_numpy(dtype=np.float32, copy=False)
        base_tr = sparse.csr_matrix(num_block_tr)
        base_te = sparse.csr_matrix(num_block_te)
    else:
        base_tr = sparse.csr_matrix((len(X_train), 0), dtype=np.float32)
        base_te = sparse.csr_matrix((len(X_test), 0), dtype=np.float32)

    # projected OHE width; abandon OHE entirely if it explodes
    projected_ohe = sum(nunqs[c] for c in low_card) if low_card else 0
    do_ohe = low_card and projected_ohe <= OHE_MAX_WIDTH

    if do_ohe:
        ohe = OneHotEncoder(handle_unknown='ignore', sparse=True, dtype=np.float32)
        ohe_tr = ohe.fit_transform(X_train[low_card])
        ohe_te = ohe.transform(X_test[low_card])
    else:
        # fall back to frequency-encode everything to keep width small
        for c in low_card:
            freq = X_train[c].value_counts(dropna=False)
            X_train[c] = X_train[c].map(freq).astype('float32')
            X_test[c]  = X_test[c].map(freq).astype('float32')
        extra_tr = sparse.csr_matrix(X_train[low_card].fillna(0).to_numpy(dtype=np.float32)) if low_card else sparse.csr_matrix((len(X_train), 0), dtype=np.float32)
        extra_te = sparse.csr_matrix(X_test[low_card].fillna(0).to_numpy(dtype=np.float32))  if low_card else sparse.csr_matrix((len(X_test), 0), dtype=np.float32)
        ohe_tr, ohe_te = extra_tr, extra_te

    # final sparse matrices
    X_tr = sparse.hstack([base_tr, ohe_tr], format='csr', dtype=np.float32)
    X_te = sparse.hstack([base_te, ohe_te], format='csr', dtype=np.float32)

    # class imbalance helper
    pos = max(1, int((y_train == 1).sum()))
    neg = max(1, int((y_train == 0).sum()))
    pos_weight = float(neg) / float(pos)

    # model & fit
    metrics_list, loss_key, err_key = choose_metrics(y_train)
    model = XGBClassifier(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        reg_lambda=1.0,
        random_state=42,
        n_jobs=-1,
        tree_method='hist',
        scale_pos_weight=pos_weight
    )
    safe_fit(model, X_tr, y_train, X_te, y_test, metrics_list)

    # test metrics
    y_pred = model.predict(X_te)
    acc  = accuracy_score(y_test, y_pred)
    prec = precision_score(y_test, y_pred, zero_division=0)
    rec  = recall_score(y_test, y_pred, zero_division=0)
    f1   = f1_score(y_test, y_pred, zero_division=0)

    try:
        tn, fp, fn, tp = confusion_matrix(y_test, y_pred, labels=[0, 1]).ravel()
        conf = { "tp": int(tp), "tn": int(tn), "fp": int(fp), "fn": int(fn) }
    except Exception:
        conf = { "tp": 0, "tn": 0, "fp": 0, "fn": 0 }

    # history
    epochs, train_accuracy, train_logloss = [], [], []
    try:
        evals = model.evals_result()
    except Exception:
        evals = {}

    val0 = evals.get('validation_0', {})
    if val0:
        ll = val0.get(loss_key, [])
        er = val0.get(err_key, [])
        if er: train_accuracy = [(1.0 - e) * 100.0 for e in er]
        if ll: train_logloss = ll
        L = max(len(train_logloss), len(train_accuracy))
        if L == 0:
            train_accuracy = [accuracy_score(y_train, model.predict(X_tr)) * 100.0]
            L = 1
        epochs = list(range(1, L+1))
    else:
        epochs = [1]
        train_accuracy = [accuracy_score(y_train, model.predict(X_tr)) * 100.0]

    out = {
        "accuracy": round(acc*100.0, 2),
        "precision": round(prec*100.0, 2),
        "recall": round(rec*100.0, 2),
        "f1score": round(f1*100.0, 2),
        "confusion": conf,
        "history": {
            "epochs": epochs,
            "train_accuracy": [round(a, 2) for a in train_accuracy],
            "train_logloss": [round(l, 4) for l in train_logloss]
        }
    }
    print(json.dumps(out))

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"error": f"training.py failed: {type(e).__name__}: {e}"}))
        sys.exit(1)