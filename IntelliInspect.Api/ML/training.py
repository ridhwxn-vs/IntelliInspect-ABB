import argparse, json, sys
import pandas as pd
import numpy as np
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix
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

    # one-hot encode categoricals
    cat_cols = X_train.select_dtypes(include=['object']).columns.tolist()
    if cat_cols:
        X_train = pd.get_dummies(X_train, columns=cat_cols, dummy_na=True)
        X_test  = pd.get_dummies(X_test,  columns=cat_cols, dummy_na=True)

    # align
    X_test = X_test.reindex(columns=X_train.columns, fill_value=0)
    X_train = X_train.fillna(0).astype("float32")
    X_test  = X_test.fillna(0).astype("float32")

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
        tree_method='hist'
    )
    safe_fit(model, X_train, y_train, X_test, y_test, metrics_list)

    # test metrics
    y_pred = model.predict(X_test)
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
    if loss_key in val0 or err_key in val0:
        ll = val0.get(loss_key, [])
        er = val0.get(err_key, [])
        if er: train_accuracy = [(1.0 - e) * 100.0 for e in er]
        if ll: train_logloss = ll
        L = max(len(train_logloss), len(train_accuracy))
        if L == 0:
            train_accuracy = [accuracy_score(y_train, model.predict(X_train)) * 100.0]
            L = 1
        epochs = list(range(1, L+1))
    else:
        epochs = [1]
        train_accuracy = [accuracy_score(y_train, model.predict(X_train)) * 100.0]

    # output JSON only
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
