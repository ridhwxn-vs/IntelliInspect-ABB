# IntelliInspect — Monorepo README

This repo contains **two apps that ship together**:

* **`intelliinspect/`** — the Angular frontend (Chart.js UI, file upload, training UX)
* **`IntelliInspect.Api/`** — the ASP.NET Core backend *with* the Python ML script colocated inside the API’s output folder (no separate ML service)

---

## 1) Prerequisites

* **Node.js + npm** (LTS is fine)
* **.NET SDK 9** (or the SDK your project targets)
* **Python 3.10 or 3.11** (avoid 3.13 for ML wheels)
* Git, PowerShell (Windows) or a shell (macOS/Linux)

---

## 2) Repo layout

```
repo-root/
├─ intelliinspect/             # Angular frontend
│  ├─ src/ …                   # UI: upload, date ranges, training charts
│  └─ package.json
└─ IntelliInspect.Api/         # ASP.NET Core backend (Minimal API)
   ├─ Program.cs
   ├─ IntelliInspect.Api.csproj
   └─ ML/
      ├─ training.py           # Python training script (invoked by API)
      └─ requirements.txt      # Python deps pinned for training.py
```

> The ML code lives under **`IntelliInspect.Api/ML/`** and is **copied into `bin/…/ML/`** at build/publish. The API executes it directly—no Flask/FastAPI service to run.

---

## 3) Frontend: install & run

From `repo-root/intelliinspect`:

```bash
npm install
npm start        # or: npx ng serve
```

* Default dev URL: `http://localhost:4200`
* The UI expects the API at `http://localhost:5159` (adjust your environment file if needed).

---

## 4) Backend: Python environment

From `repo-root/IntelliInspect.Api` create a **local venv** and install ML deps.

### Windows (PowerShell)

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r ML\requirements.txt
```

### macOS / Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r ML/requirements.txt
```

**`ML/requirements.txt`** (ships in the repo; keep versions roughly in this range to avoid compatibility issues):

```txt
numpy>=1.22,<2.0
pandas>=1.5,<3.0
scikit-learn>=1.1,<2.0
scipy>=1.8,<2.0
joblib>=1.2
matplotlib>=3.6,<4.0
xgboost>=1.7,<2.0
```

> We require **xgboost ≥ 1.7** so that training metrics behave consistently.

---

## 5) Backend: point the API to your Python

Create/update **`appsettings.Development.json`** in `IntelliInspect.Api/`:

```json
{
  "Python": {
    "ExeWin": ".venv/Scripts/python.exe",
    "Exe": ".venv/bin/python",
    "TrainingScript": "ML/training.py"
  }
}
```

* On Windows the API uses `ExeWin`; on macOS/Linux it uses `Exe`.
* `TrainingScript` is a **relative path** that resolves into the API’s **output** folder (e.g., `bin/Debug/net9.0/ML/training.py`).

Ensure the **ML folder is copied** to the output at build/publish. In `IntelliInspect.Api.csproj`:

```xml
<ItemGroup>
  <Content Include="ML\**\*">
    <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
    <CopyToPublishDirectory>Always</CopyToPublishDirectory>
  </Content>
</ItemGroup>
```

---

## 6) Backend: run

From `repo-root/IntelliInspect.Api`:

```bash
dotnet run
```

* API dev URL: `http://localhost:5159`
* Health checks (dev only, if you kept the sample diagnostics):

  * `GET /` → “MiniML API running.”
  * `GET /_diag/paths` → shows where `training.py` is resolved
  * `GET /_diag/python` → shows the Python interpreter and import check for pandas/xgboost

---

## 7) How it works end-to-end

* **Upload**: UI posts a CSV to `/upload-dataset`. Backend streams to temp, computes light stats, and if no timestamps are present, it augments the CSV by adding a synthetic `Timestamp` column. You get back a `fileKey`.
* **Train**: UI posts `{ fileKey, trainStart, trainEnd, testStart, testEnd }` to `/train-model`. Backend validates dates and spawns **`ML/training.py`** using the configured Python. The script trains an XGBoost model, calculates metrics and training curves, and prints a single JSON blob to stdout. The API returns that JSON untouched and the UI renders the charts.

**Date format** expected by the API: `yyyy-MM-dd HH:mm:ss`.

**Target column** default: `Response` (you can pass `--target-col` from the backend if your CSV uses a different name).

---

## 8) Typical dev flow (copy-paste)

```bash
# 1) Frontend
cd intelliinspect
npm install
npm start

# 2) Backend
cd ../IntelliInspect.Api
py -m venv .venv                  # python3 -m venv .venv on macOS/Linux
.\.venv\Scripts\Activate.ps1      # source .venv/bin/activate on macOS/Linux
pip install -r ML\requirements.txt
dotnet run
```

Open the app, upload a CSV, set train/test ranges, click **Train**—you should see metrics plus two charts (accuracy/logloss & confusion matrix).

---

## 9) Troubleshooting (quick)

* **`training.py not found`**
  The `ML/` copy-to-output rule is missing. Add the `<Content Include="ML\**\*">…</Content>` block and rebuild.
* **`ModuleNotFoundError` / import squiggles**
  Activate the venv and `pip install -r ML/requirements.txt`. In your editor, select the venv interpreter.
* **`Dates must be 'yyyy-MM-dd HH:mm:ss'`**
  The UI will normalize, but if you call the API manually, use the exact format.
* **Angular says “Unexpected non-whitespace after JSON”**
  Ensure the training script only prints a **single JSON** to stdout and runs with `verbose=False` (already handled in the repo script).

---


That’s it—**one repo, one deployable unit**. The UI, API, and ML script move together, which keeps local dev and production deployments predictable and easy to reason about.
