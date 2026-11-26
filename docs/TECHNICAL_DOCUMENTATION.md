# HEARTLAB technical documentation

This is the engineering reference for the HEARTLAB application as it exists in this repository: how it is built, how data moves through it, how every statistic is computed and where, and how to run, test and extend it. It describes the code, not an intended design. When the code changes, update this file in the same commit.

Related documents:

- [`README.md`](../README.md): short overview and quick start.
- [`documentation/HEARTLAB_Research_Documentation.md`](../documentation/HEARTLAB_Research_Documentation.md): the research paper foundation (methodology, results and discussion for the course paper).
- [`DESIGN.md`](../DESIGN.md): visual design system (colour tokens, type, components). It contains no engineering information.

---

## Contents

1. [System overview](#1-system-overview)
2. [Technology stack](#2-technology-stack)
3. [Repository structure](#3-repository-structure)
4. [Data architecture and pipeline](#4-data-architecture-and-pipeline)
5. [Statistical model implementation](#5-statistical-model-implementation)
6. [Model diagnostics](#6-model-diagnostics)
7. [Verification and validation](#7-verification-and-validation)
8. [Simulation engine](#8-simulation-engine)
9. [Sensitivity analysis](#9-sensitivity-analysis)
10. [API reference](#10-api-reference)
11. [Frontend architecture](#11-frontend-architecture)
12. [Batch analysis runner](#12-batch-analysis-runner)
13. [Testing](#13-testing)
14. [Installation, configuration and execution](#14-installation-configuration-and-execution)
15. [Known limitations](#15-known-limitations)
16. [Maintenance and extension](#16-maintenance-and-extension)

---

## 1. System overview

HEARTLAB fits the state-level multiple linear regression of Gordon & Guilfoos (2017), Chapter 14, §14.3.6: U.S. coronary heart disease (CHD) mortality regressed on four behavioural risk-factor prevalences. It then lets a user change the risk-factor values (and, optionally, simulate a cigarette-price rise) and see what the fitted equation gives, with confidence intervals.

### 1.1 Components

| Component | Location | Responsibility |
|---|---|---|
| Data layer | `src/data_processing.py`, `config/column_mapping.json` | Read CSV/XLS/XLSX, locate the header row, map columns to model variables, classify rows (state vs. aggregate/note), convert numbers, report every decision |
| Statistical layer | `src/model.py` | OLS fit (statsmodels), inference, HC3, standardized coefficients, diagnostics, prediction/confidence intervals, differences between two input vectors, backward elimination |
| Verification and validation | `src/validation.py` | Independent recomputation of the fit, leave-one-out cross-validation, coefficient sign plausibility |
| Simulation | `src/simulation.py` | Input bounds and validation, baselines, scenarios, cigarette-price pathway, Monte Carlo |
| Sensitivity | `src/sensitivity_analysis.py` | One-at-a-time grid, tornado, price × elasticity grid |
| Orchestration | `src/engine.py` (`HeartLabEngine`) | Owns the loaded dataset and fitted models; exposes everything the API and the batch runner need |
| Web backend | `app/backend/server.py` (FastAPI) | JSON API, dataset upload, serves the static frontend |
| Frontend | `app/frontend/` (HTML, CSS, vanilla JavaScript, SVG, WebGL, Canvas 2D) | Landing page, simulator, model-evidence and methods pages. It renders numbers returned by the API |
| Batch runner | `src/run_analysis.py` | Writes all result tables and figures to `results/` |

### 1.2 How the components communicate

```
browser (app/frontend)                     FastAPI (app/backend/server.py)          src/
──────────────────────                     ───────────────────────────────          ────
GET  /api/status ───────────────────────▶  engine.status()               ───────▶  engine.py
GET  /api/model  ───────────────────────▶  engine.model_summary()        ───────▶  model.py, validation.py
GET  /api/states ───────────────────────▶  engine.states(), bounds, quartiles
GET  /api/baseline?state= ──────────────▶  engine.baseline()             ───────▶  simulation.baseline_inputs
POST /api/simulate {inputs, price…} ────▶  engine.simulate()             ───────▶  simulation.run_scenario, monte_carlo
GET  /api/sensitivity ──────────────────▶  engine.sensitivity()          ───────▶  sensitivity_analysis.py
POST /api/dataset (multipart file) ─────▶  data_processing.ingest → engine.load
```

There is no database. State lives in one `HeartLabEngine` instance created at import time of `server.py` (process memory). The dataset is a file on disk.

### 1.3 Execution flow

1. `./run.sh` starts uvicorn with `app.backend.server:app`.
2. On import, `server._initial_load()` calls `engine.load(path)` for `$HEARTLAB_DATA` if set, otherwise `engine.load_default()`, which uses `data_processing.locate_dataset()`.
3. `HeartLabEngine.load()` ingests the file (`dp.ingest`), drops incomplete rows (`dp.analysis_frame`), fits the full model (`mdl.fit_ols`), runs backward elimination (`mdl.backward_elimination`) and computes slider bounds (`sim.InputBounds`). If ingestion fails, the engine stays in **State A** (no dataset) and records the error; otherwise it is in **State B** (ready).
4. The browser loads `index.html`, then `app.js` calls `/api/status` and, in State B, `/api/model` and `/api/states`.
5. In the simulator every input change triggers a debounced `POST /api/simulate`; the response is rendered as-is.

---

## 2. Technology stack

Versions are those pinned in `requirements.txt` and installed in the project's `.venv` (Python 3.13.2 at the time of writing; Python 3.11 or later is required).

| Area | Technology | Version | Used for |
|---|---|---|---|
| Language (backend) | Python | ≥ 3.11 | All computation |
| Web framework | FastAPI | 0.165.0 | JSON API, upload endpoint, static files |
| ASGI server | uvicorn | 0.54.0 | Serving the app (`run.sh`) |
| Validation | pydantic (FastAPI dependency) | 2.x | `SimulationRequest` body model |
| Upload parsing | python-multipart | 0.0.34 | `UploadFile` in `POST /api/dataset` |
| Data | pandas | 3.1.1 | Reading files, cleaning, descriptive statistics |
| Numerics | NumPy | 2.5.5 | Linear algebra, Monte Carlo draws |
| Statistics | statsmodels | 0.15.0 | OLS, HC3, prediction intervals, Breusch–Pagan, White, Jarque–Bera, VIF, influence |
| Statistics | SciPy | 1.18.1 | Shapiro–Wilk, t and F distributions |
| Spreadsheet readers | openpyxl 3.1.5 (.xlsx), xlrd 2.0.2 (.xls) | | `pd.read_excel` engines |
| Figures (batch) | Matplotlib | 3.11.2 | `results/figures/*.png`, documentation diagrams |
| Documents | python-docx | 1.2.0 | `scripts/build_docx.py` |
| Testing | pytest 9.2.0, httpx 0.28.1, Playwright 1.65.2 | | Unit, API (`TestClient`) and browser tests |
| Test-only | xlwt 1.3.0 | | Writes a legacy `.xls` fixture |
| Frontend | HTML, CSS, JavaScript (ES2020, no framework, no build step) | | UI |
| Frontend rendering | SVG (charts), WebGL 1 (heart illustration), Canvas 2D (landing data field) | | Drawn by hand-written code; no chart library |
| Fonts | Hanken Grotesk (variable), Fragment Mono | self-hosted woff2 | `app/frontend/fonts/` (licences in `fonts/LICENSE.md`) |

There is no Node.js toolchain, bundler, database or external CDN. Package management is `pip` with `requirements.txt`.

---

## 3. Repository structure

```
app/
  backend/server.py          FastAPI app: endpoints, upload handling, static mount, favicon routes
  frontend/
    index.html               Single page: landing, simulator, model evidence, methods (switched by URL hash)
    app.js                   Routing, API calls, simulator state and rendering, model/methods pages, upload
    charts.js                SVG chart renderers (state range, contribution bars, scatter, tornado, policy lines, histogram, forest)
    heart.js                 WebGL raymarched heart illustration (decorative; never receives model output)
    field.js                 Landing background: the dataset's 51 jurisdictions plotted on Canvas 2D
    styles.css               All styles and theme tokens
    mark.svg, icons/, site.webmanifest   Brand mark, favicon and touch icons, web manifest
    fonts/                   Self-hosted fonts and their licences
config/column_mapping.json   Header → model-variable mapping, units, definitions, expected signs, dataset provenance
data/
  raw/                       The working dataset (and uploads saved as uploaded_dataset.*)
  processed/                 Cleaned copy + ingestion report written on upload or by `python -m src.data_processing`
src/
  data_processing.py         Ingestion and cleaning
  model.py                   OLS, inference, diagnostics, intervals, backward elimination
  validation.py              Verification identities, LOOCV, sign check
  simulation.py              Bounds, baselines, scenarios, price pathway, Monte Carlo
  sensitivity_analysis.py    Structured sensitivity grids
  engine.py                  HeartLabEngine (State A / State B)
  run_analysis.py            Batch generation of results/
results/                     Output of `python -m src.run_analysis` (tables, figures, model_summary.json, processed/)
scripts/
  build_docx.py              documentation/*.md → .docx
  make_diagrams.py           Conceptual-model and workflow figures for the research documentation
  make_icons.py              Renders app/frontend/icons/ from the mark
tests/
  test_heartlab.py           Unit and integration tests of src/
  test_api.py                API contract tests (FastAPI TestClient)
  test_ui.py                 Browser tests (Playwright, headless Chromium)
  fixtures/synthetic.py      Synthetic, deliberately messy spreadsheets (not CDC data)
documentation/               Research documentation (.md source, generated .docx, figures)
docs/TECHNICAL_DOCUMENTATION.md   This file
run.sh                       Starts the server on 127.0.0.1:${PORT:-8000}
requirements.txt             Pinned Python dependencies
```

Files that contain system logic: everything in `src/`, `app/backend/server.py`, `app/frontend/app.js` (UI state and request flow) and `config/column_mapping.json` (which columns are read, and what they mean).

---

## 4. Data architecture and pipeline

### 4.1 The working dataset

- **File:** `data/raw/HEARTLAB_1998_CDC_CHD_dataset.csv` (named in `config/column_mapping.json` → `dataset_file`).
- **Rows:** 51 (50 states and the District of Columbia), one per jurisdiction, all complete.
- **Columns (10):**

| Column | Model variable | Meaning |
|---|---|---|
| `state` | state label | Jurisdiction name |
| `coronary_heart_disease_age_adjusted_death_rate_per_100k_age_35_plus` | `heart_disease` (Y) | CHD mortality, ICD-9 410.0–414.9, age-adjusted to the 2000 U.S. standard population, persons aged 35+, deaths per 100,000, 1998 |
| `current_smoking_percent` | `smoking` (X1) | % of adults who currently smoke, 1998 |
| `obesity_percent_bmi_ge_30` | `obesity` (X2) | % of adults with BMI ≥ 30, 1998 |
| `no_leisure_exercise_percent` | `inactivity` (X3) | % of adults with no leisure-time physical activity, 1998 |
| `less_than_5_fruit_vegetable_servings_percent` | `fruit_veg` (X4) | % of adults eating fewer than five servings of fruit and vegetables a day, 1998 |
| `risk_factor_year`, `outcome_year` | metadata | Both 1998 |
| `outcome_definition` | metadata | Text definition of the outcome |
| `source_status` | metadata | `assembled_from_separate_CDC_published_tables_not_original_CDCHeartRisk.xls` |

**Provenance.** The file was assembled from separate CDC-published state tables. It is **not** the textbook's original spreadsheet `CDCHeartRisk.xls`, so results can differ from the textbook's. `config/column_mapping.json` → `source.provenance` and `source.year_note` record this, and `data/raw/README.md` repeats it. Note that X4 measures *inadequate* intake, the inverse of the textbook's wording.

### 4.2 Locating the dataset

`data_processing.locate_dataset()` collects candidates in `data/raw/`: the configured `dataset_file`, `uploaded_dataset.*`, and `CDCHeartRisk*.{xls,xlsx,csv}`. It returns the most recently modified existing file, so an upload made through the interface survives a restart. `HEARTLAB_DATA=/path/to/file` bypasses this.

### 4.3 Ingestion (`data_processing.ingest`)

1. **Read** (`read_workbook`): CSV via `pd.read_csv(header=None, dtype=object)`; `.xls` via xlrd, `.xlsx` via openpyxl, every sheet, no header, so that label rows are preserved.
2. **Choose sheet and header row.** If `sheet` / `header_row` are set in the config they are used. Otherwise `find_header_row` scans the first 40 rows and picks the row whose cells match the most model variables (by explicit `header`, exact `known_headers`, or case-insensitive substring `patterns`). At least three matches are required, else `DatasetError`.
3. **Map columns** (`map_columns`). Per variable, in order: explicit `header` (must exist), then `known_headers` (exact name), then `patterns`. Zero or several pattern hits raise `DatasetError` naming the headers found. The method used is recorded (`mapping_method`). Column positions are never assumed.
4. **Capture file metadata.** Unmapped columns with 1–3 distinct values (e.g. the year and provenance columns) are recorded in `report.file_metadata`.
5. **Classify rows** (`classify_state`). Blank labels, aggregate rows (`total`, `united states`, `average`, `median`, …, see `AGGREGATE_PATTERNS`), territories, and unrecognised labels are excluded with a recorded reason and spreadsheet row number. DC is included when `include_district_of_columbia` is true. Trailing footnote marks (`*`, `†`, `‡`) are stripped.
6. **Convert values** (`to_number`). Numbers pass through; text has `,` and `%` removed; `""`, `-`, `NA`, `N/A`, `.`, `*` become missing; anything else is recorded as `non-numeric`. Every problem is listed in `report.invalid_values`.
7. **Check.** Duplicate states raise `DatasetError`. Negative prevalences and values above 100 add warnings. Each predictor's scale is recorded (`proportion (0-1)` or `percent (0-100)`). Absent jurisdictions are listed. Fewer than six complete cases (`len(PREDICTORS) + 2`) raises `DatasetError`.
8. **Synthetic flag.** If the text "SYNTHETIC" appears anywhere in the sheet, `report.synthetic = True`. The UI then shows a banner, and neither the upload endpoint nor the batch runner writes the data into `data/raw/` or `results/`.

The result is a clean frame (`state`, `state_name`, five model variables; rows with missing values retained and flagged) and an `IngestionReport` (dataclass; `to_dict()` for JSON).

### 4.4 Missing values and inclusion

`analysis_frame()` applies **listwise deletion**: only rows complete on all five model variables enter the regression. The working dataset has 51 complete rows, so none are dropped. `describe()` reports count, missing, mean, SD and quartiles per variable.

### 4.5 Uploaded datasets

`POST /api/dataset` accepts `.csv`, `.xls`, `.xlsx` up to 10 MB. The file is written to a temporary directory and ingested there first; nothing in `data/raw/` changes unless ingestion succeeds. A valid non-synthetic file is copied to `data/raw/uploaded_dataset.<ext>`, the engine reloads it, and `save_processed()` writes `data/processed/heart_risk_clean.csv` and `ingestion_report.json`. A synthetic file is loaded from the temporary copy only (`persisted: false`).

### 4.6 From file to model

```
file ─▶ read_workbook ─▶ find_header_row ─▶ map_columns ─▶ classify_state / to_number ─▶ clean frame + IngestionReport
     ─▶ analysis_frame (complete cases) ─▶ fit_ols (full) ─▶ backward_elimination (reduced, if different)
     ─▶ InputBounds (slider and hard limits)
```

---

## 5. Statistical model implementation

### 5.1 Specification

```
Y_i = β0 + β1·smoking_i + β2·obesity_i + β3·inactivity_i + β4·fruit_veg_i + ε_i,   i = 1…n (jurisdictions)
```

- Dependent variable: `heart_disease` (`data_processing.DEPENDENT`).
- Predictors: `data_processing.PREDICTORS = ["smoking", "obesity", "inactivity", "fruit_veg"]`.
- Significance level: `model.ALPHA = 0.05`.
- Unit of analysis: the jurisdiction (ecological). Specification metadata is in `engine.SPECIFICATION`.

### 5.2 Fitting (`model.fit_ols`)

`X = sm.add_constant(data[predictors], has_constant="add")`, `y = data["heart_disease"]`, `res = sm.OLS(y, X).fit()`. The result is wrapped in `FittedModel(name, predictors, result, data)`, which also provides `design(x)` (the row vector `[1, x1, …]`), `predict(x)`, `params` and `cov` (`result.cov_params()`).

### 5.3 Reported statistics (`model.summarize`)

All values come from the statsmodels result:

| Output | Source |
|---|---|
| Coefficient, SE, t, p | `res.params`, `res.bse`, `res.tvalues`, `res.pvalues` |
| 95% CI | `res.conf_int(alpha)` |
| `significant` | `p < alpha` |
| HC3 robust SE and p | `res.get_robustcov_results(cov_type="HC3")` |
| Standardized coefficient and CI | `β · sd(x) / sd(y)` (sample SDs, ddof = 1), applied to the estimate and CI ends |
| R², adjusted R² | `res.rsquared`, `res.rsquared_adj` |
| F-test | `res.fvalue`, `res.f_pvalue` (`None` for an intercept-only model) |
| Residual SE | `sqrt(res.mse_resid)` |
| AIC, BIC | `res.aic`, `res.bic` |
| Equation string | `equation_string()` (4 decimals) |

The HC3 results are reported alongside the classical ones. They do not replace the classical standard errors used for the intervals.

### 5.4 Reduced model (`model.backward_elimination`)

Starting from all four predictors, refit and drop the predictor with the largest p-value while that p-value exceeds α. The steps are returned (`dropped`, `p_value`, `remaining`). `HeartLabEngine.load` adds a `"reduced"` model only if it differs from the full model. On the working dataset all four predictors have p < 0.05 in the full model, so no reduced model is created and the API returns only `"full"`. The full model is always fitted and reported first.

### 5.5 Predictions and differences

- `model.prediction(m, x)` uses `res.get_prediction(exog).summary_frame(alpha)`: the point estimate, the **confidence interval** for the mean response (`mean_ci_*`) and the **prediction interval** for a new observation (`obs_ci_*`).
- `model.difference(m, x_base, x_new)` computes `Δŷ = dᵀβ̂` with `d = design(x_new) − design(x_base)`, standard error `sqrt(dᵀ Cov(β̂) d)` and a t-based CI with `df_resid` degrees of freedom. This is the exact OLS interval for the change and is what the simulator calls the "uncertainty range".

### 5.6 Current results

From the working dataset (`results/model_summary.json`, regenerated by `python -m src.run_analysis`): n = 51, R² = 0.458, adjusted R² = 0.410, F(4, 46) = 9.70, p < 0.001. Smoking +4.94 per point (p = 0.047; HC3 p = 0.108), obesity +6.98 (p = 0.015), inactivity +3.70 (p < 0.001), low fruit and vegetable intake −3.35 (p = 0.047). The fruit and vegetable sign is opposite to the expected sign in the config. It is reported as fitted and flagged (Section 7.3), never corrected.

---

## 6. Model diagnostics

All diagnostics are computed by `model.diagnostics(m)`. They are **reported only**: none of them changes the fitted model, removes observations or switches the standard errors.

| Diagnostic | What it evaluates | Implementation | Output keys |
|---|---|---|---|
| Residual summary | Mean (≈0 with an intercept) and SD | NumPy | `residual_mean`, `residual_std` |
| Jarque–Bera | Skewness/kurtosis versus normal | `statsmodels.stats.stattools.jarque_bera(resid)` | `jarque_bera.{statistic,p_value,skew,kurtosis}` |
| Shapiro–Wilk | Normality of residuals | `scipy.stats.shapiro(resid)` (n ≥ 3) | `shapiro_wilk.{statistic,p_value}` |
| Breusch–Pagan | Heteroskedasticity linear in the regressors | `het_breuschpagan(resid, exog)` | `breusch_pagan.{lm,p_value,f,f_p_value}` |
| White | Heteroskedasticity including squares and cross-products | `het_white(resid, exog)`; `None` if there are too few observations | `white.{lm,p_value}` |
| VIF | Collinearity among predictors | `variance_inflation_factor` on the design matrix with constant (`model.vif`) | `vif.{predictor}` |
| Condition number | Numerical conditioning of X | `res.condition_number` | `condition_number` |
| Leverage | Unusual predictor combinations | `OLSInfluence(res).hat_matrix_diag`; flagged above `2(k+1)/n` | `observations[].leverage`, `high_leverage` |
| Cook's distance | Influence on the fit | `OLSInfluence(res).cooks_distance[0]`; flagged above `4/n` | `observations[].cooks_d`, `influential` |
| Studentized residuals | Outlying observations | `OLSInfluence(res).resid_studentized_external`; flagged beyond ±2.5 | `observations[].studentized`, `outlier` |

Thresholds are returned in `diagnostics.thresholds`. The model-evidence page interprets a test as "no evidence against the assumption" when p ≥ α and notes that, with 51 observations, these tests have limited power. Flagged jurisdictions stay in the model.

---

## 7. Verification and validation

### 7.1 Verification (`validation.verify`)

Each check returns `{check, expected, actual, passed}`:

1. Coefficients equal the normal-equation solution `(XᵀX)⁻¹Xᵀy` computed independently with `numpy.linalg.solve` (`model.normal_equation`), rtol/atol 1e-8.
2. R² equals `1 − SSE/SST`.
3. F equals `(R²/k) / ((1−R²)/(n−k−1))`.
4. p(F) equals `scipy.stats.f.sf(F, k, n−k−1)`.
5. Residuals sum to zero.
6. ŷ at the predictor means equals mean(y).

These check the software, not the model.

### 7.2 Validation (`validation.loocv`)

Leave-one-out residuals are `e_i / (1 − h_ii)` (exact for OLS, no refitting). Reported: PRESS, in-sample RMSE, LOOCV RMSE, LOOCV MAE and predicted R² = `1 − PRESS/SST`. `loocv_bruteforce()` refits n times; the tests use it to confirm the shortcut.

### 7.3 Sign plausibility (`validation.sign_check`)

Compares each coefficient's sign with `expected_sign` from `config/column_mapping.json` (falling back to `EXPECTED_SIGN` in the module, where `fruit_veg` is undetermined). All four predictors are configured as expected-positive, so the negative fruit/veg coefficient is returned with `agrees: false`. The frontend uses this to show its explanation: a conditional association in an ecological regression, probably reflecting overlap between predictors or confounding. It does not mean a poor diet is protective. Agreement is a plausibility check, not evidence of causation.

---

## 8. Simulation engine

### 8.1 Baselines (`simulation.baseline_inputs`)

- `"mean"` (default): the unweighted mean of each predictor across the analysis frame ("average of 51 jurisdictions").
- A state code (e.g. `"TX"`): that state's observed predictor values. Unknown codes raise `InputError`.

### 8.2 Input bounds (`simulation.InputBounds`)

For each predictor, from the analysis frame:

| Key | Value |
|---|---|
| `observed_min`, `observed_max` | Range across jurisdictions |
| `slider_min`, `slider_max` | Observed range ± 25% of its width, clipped to the hard limits |
| `hard_min`, `hard_max` | 0 and 100 (or 0 and 1 if the data are proportions) |
| `mean`, `sd` | Cross-state mean and sample SD |

`validate(x)` requires every predictor, rejects non-finite values and values outside the hard limits (`InputError` → HTTP 422), and returns a warning for each value outside the observed range ("…the estimate is an extrapolation"). Values are **never clamped**.

### 8.3 Scenario calculation (`simulation.run_scenario`)

1. Validate inputs (8.2).
2. If `price_increase_pct > 0`, apply the price pathway (8.5) and replace `smoking` with the post-policy value.
3. `baseline = prediction(model, baseline_inputs)`, `scenario = prediction(model, inputs)`: estimate, 95% CI, 95% PI.
4. `difference = difference(model, baseline_inputs, inputs)`: Δŷ, SE and 95% CI.
5. Per predictor: baseline value, scenario value, change, % change, `in_model`, and `contribution = β_j · Δx_j`. Because the model is linear, the contributions sum to Δŷ.
6. `relative_change_pct = Δŷ / ŷ_baseline × 100`.

### 8.4 Uncertainty

- **Confidence intervals** (default everywhere in the UI, labelled "uncertainty range"): analytic OLS intervals from 5.5.
- **Prediction intervals**: shown under "Statistical details" and on the model-evidence page.
- **Monte Carlo** (`simulation.monte_carlo`): 5,000 draws `β ~ MVN(β̂, Cov(β̂))` with a fixed seed (20171), giving the distribution of Δŷ (mean, SD, quantiles, share below zero, 40-bin histogram). If the request includes `uncertainty_range` and a price rise, the smoking-prevalence elasticity is also drawn as `E_s ~ Uniform(range)` and the post-policy smoking value is recomputed for each draw.

### 8.5 Cigarette-price pathway

Three explicitly separate components (`simulation.py` module docstring):

| Component | Formula | Status | Used in the estimate? |
|---|---|---|---|
| A. Demand response | `%ΔQ = E_d × %ΔP`, `E_d = −0.4` (`DEMAND_ELASTICITY`) | **Sourced**: Bader, Boisclair & Ferrence (2011), citing Jha & Chaloupka (1999) | **No.** Returned as `demand_change_pct` for reference only |
| B. Prevalence response | `%ΔS = E_s × %ΔP`; `S_new = S × (1 + %ΔS/100)` | **Assumption**: `E_s` is chosen by the user, range −1 to 0 | Yes, through smoking |
| C. Regression outcome | `Δŷ` from the fitted equation with `S_new` | Model-based | Yes |

`E_s` is never derived from `E_d`: cigarette consumption is not smoking prevalence. Price is validated to 0–100% and `E_s` to [−1, 0] (`validate_policy`). The response includes `demand_elasticity_status: "sourced"` and `prevalence_elasticity_status: "assumption"`, plus `regression_effect`: the difference that the price step alone causes, with its CI. In the UI the assumption levels are None (0), Small (−0.10), Moderate (−0.25), Strong (−0.40) or Custom. These are illustrative assumptions, not measured values.

### 8.6 How results reach the frontend

`POST /api/simulate` returns the dictionary from `run_scenario` plus `monte_carlo`, `state: "B"` and `baseline_state`. The browser renders the fields directly. It does not compute any estimate, interval or contribution.

---

## 9. Sensitivity analysis

`src/sensitivity_analysis.py`, exposed through `GET /api/sensitivity`:

- `one_at_a_time`: each predictor moved by −2, −1, −0.5, +0.5, +1, +2 cross-state SDs and by −5, −2, −1, +1, +2, +5 points, others at baseline, with Δŷ and its CI. Negative values are skipped.
- `tornado`: ŷ at baseline ± 1 SD for each predictor, sorted by swing.
- `policy_grid`: price rises {5, 10, 15, 20, 25, 50}% × assumed `E_s` {0, −0.1, −0.2, −0.3, −0.4}, with the post-policy smoking value and Δŷ with CI. Every row is labelled as an assumption.
- `policy_table`: component A only (needs no data).

---

## 10. API reference

All endpoints are in `app/backend/server.py`. Responses are JSON.

| Method and path | Parameters / body | Success response | Errors |
|---|---|---|---|
| `GET /api/status` | none | `{state: "A"|"B", ready, specification, variables, source, demand_elasticity, demand_elasticity_source, error, dataset?}`. `dataset` includes `file`, `observations`, `complete_cases`, `excluded_rows`, `invalid_values`, `warnings`, `includes_dc`, `states_absent`, `column_mapping`, `sheet`, `metadata_text`, `synthetic`, `value_scale`, `file_metadata`, `mapping_method` | none |
| `GET /api/model` | none | State A: `{ready: false}`. State B: `{ready, models: {full[, reduced]}, elimination_steps, bounds, states, descriptive}`. Each model has the `summarize` fields plus `diagnostics`, `verification`, `validation` (without per-state LOO residuals) and `sign_check` | none |
| `GET /api/states` | none | `{states: [{state, state_name, smoking, obesity, inactivity, fruit_veg, observed_rate, fitted_rate}], bounds, quartiles: {var: {p25, p50, p75}}}` | 409 in State A |
| `GET /api/baseline` | `state` (default `"mean"`) | `{state, inputs: {smoking, obesity, inactivity, fruit_veg}}` | 409 in State A; 422 unknown state |
| `POST /api/simulate` | `SimulationRequest`: `model` ("full"), `baseline_state` ("mean"), `inputs` (partial; merged over the baseline), `price_increase_pct` (0), `prevalence_elasticity` (0), `uncertainty_range` ([lo, hi], optional) | State B: `{model, baseline, scenario, difference, relative_change_pct, inputs[], policy, warnings[], monte_carlo, state, baseline_state}`. State A: `{state: "A", policy, regression: null, message}` | 422 (`{"detail": ...}`) for invalid values, unknown model or state |
| `GET /api/sensitivity` | `model`, `state` | `{policy_demand}` (State A) or plus `one_at_a_time`, `tornado`, `policy_grid` | 422 unknown model or state |
| `POST /api/dataset` | multipart `file` | `{loaded, persisted, synthetic, status}` | 415 wrong extension; 413 over 10 MB; 422 with `{detail, report}` if ingestion fails |
| `GET /` | | `index.html` | |
| `GET /static/*` | | Frontend files | |
| `GET /favicon.ico`, `GET /apple-touch-icon.png` | | Icons from `app/frontend/icons/` | |

`InputError` (from `src/simulation.py`) is mapped to HTTP 422 by an exception handler. Pydantic rejects bodies that do not match `SimulationRequest`, also with 422.

---

## 11. Frontend architecture

No framework and no build step: `index.html` loads `heart.js`, `field.js`, `charts.js` and `app.js` as classic scripts. Each file is an IIFE; `heart.js`, `field.js` and `charts.js` attach one object to `window` (`HeartSpecimen`, `LandingField`, `Charts`).

### 11.1 Routing

Hash routes: `#/` (landing), `#/simulate`, `#/model`, `#/methods`. `route()` shows one `<section class="view">`, sets `aria-current` on the nav link and the document title, and calls the view's entry function (`enterLanding`, `enterSimulate`, `renderModelView`, `renderMethodsView`). Views are built once and then updated. `document.startViewTransition` is used when available and motion is allowed.

### 11.2 State

One object `S` in `app.js` holds: `status`, `model`, `data` (from `/api/states`), `modelName`, `baselineState`, `baseline` (inputs at the starting point), `inputs` (current values), `price`, `response` and `elas` (assumed `E_s`), `varyE` (Monte Carlo elasticity range), `last` (last `/api/simulate` response), `preset`, and navigation helpers.

### 11.3 Recalculation

- Slider `input` events and committed typed values call `setInput(p, x)`, which updates `S.inputs`, repaints the slider and schedules `runNow()` with a 140 ms debounce.
- `runNow()` aborts any in-flight request (`AbortController`), sends `requestBody()` to `/api/simulate`, ignores stale responses (sequence counter), stores the response in `S.last` and calls `renderOutcome()`.
- `renderOutcome()` fills the headline estimate (tweened), the starting-point-versus-scenario bars (`renderCompare`), the plain-language sentence, the fruit/veg note when `sign_check` disagrees, the state comparison (`Charts.range`), the contribution bars (`Charts.bars`), backend warnings, and, if open, the statistical details (`renderAdvanced`).
- Presets use backend data only: "Better habits" sets smoking, obesity and inactivity to the 25th percentiles from `/api/states` → `quartiles`; "Lower smoking" sets smoking to the lowest observed state value.

### 11.4 Typed input (direct numeric entry)

Each factor's value is an `<input type="text" inputmode="decimal">` (`#v-<var>`) linked to its slider (`#r-<var>`):

- Enter or blur commits; Escape restores the current value; ArrowUp/ArrowDown step by 0.1 (Shift: 1).
- Accepted text: a number, optionally with `%` or a decimal comma. Committed values are rounded to one decimal (the precision of the source percentages).
- Valid range: the slider's span (`slider_min`–`slider_max`, Section 8.2), so the slider and the number always show the same value. Text that is not a number, or a value outside the span, is refused with a message in the factor row and `aria-invalid`, and the previous value is restored. Values are never silently clamped.

### 11.5 What the browser computes

Display only: number formatting, chart geometry, the comparison-bar widths, and one hint sentence that multiplies the chosen `E_s` by the price change (the same product the backend returns as `prevalence_change_pct`). All statistics come from the API.

### 11.6 Landing page

`field.js` draws the 51 jurisdictions from `/api/states` at their observed values (x = smoking %, y = observed CHD rate) on a Canvas 2D layer and labels the one nearest the pointer. `heart.js` renders the heart illustration in "ghost" mode (lines only) with WebGL 1, capped at 30 fps in that mode, with automatic resolution reduction on slow GPUs, and stopped when the landing is hidden. The heart has no pulse and never receives model output. Both respect `prefers-reduced-motion`. Without WebGL, an SVG mark is shown instead. Without a dataset, the field is not drawn.

### 11.7 Theme and accessibility

`data-theme` on `<html>` (stored in `localStorage["heartlab-theme"]`, applied before first paint); without a stored choice, `prefers-color-scheme` applies. Charts read CSS custom properties, so they follow the theme. The landing page is deep-toned in both themes. Controls are labelled, sliders expose `aria-valuetext`, the estimate region is `aria-live="polite"`, and the disclaimer button exposes `aria-expanded`.

---

## 12. Batch analysis runner

```bash
.venv/bin/python -m src.run_analysis                  # configured dataset → results/
.venv/bin/python -m src.run_analysis FILE --out DIR   # explicit file and output directory
```

Writes `results/tables/*.csv` (descriptive statistics, correlations, excluded rows, per-model coefficients, residuals, VIF and verification; sensitivity grids; policy demand table), `results/figures/fig1–fig6.png`, `results/model_summary.json` and `results/processed/` (cleaned data and ingestion report). It refuses to write synthetic data into `results/` (exit code 3), writes only the data-independent policy table when no dataset exists (exit code 2), and prints the ingestion error on failure (exit code 1).

---

## 13. Testing

**Framework:** pytest. **Run all:** `.venv/bin/python -m pytest -q` (117 tests collected).

| File | Kind | Covers |
|---|---|---|
| `tests/test_heartlab.py` | Unit and integration | Ingestion (header detection, mapping by pattern/explicit/known names, missing and ambiguous headers, aggregate/note/territory/DC rows, numeric conversion, missing values and listwise deletion, synthetic flag, CSV/XLS/XLSX, duplicates); OLS recovery of known coefficients, agreement with the normal equation, summary consistency, backward elimination, diagnostics, nested intervals, difference as a linear combination; verification checks, LOOCV against brute force, sign check; policy pathway (sourced vs. assumed elasticity, limits); scenarios (zero difference at baseline, single and simultaneous changes, additivity, price flow, reduced model, state baselines, reset, determinism, invalid inputs, extrapolation warnings, Monte Carlo centring, State A); sensitivity grids; the batch runner; and real-data tests (`TestRealDataset`, skipped if the CSV is absent) |
| `tests/test_api.py` | API contract (FastAPI `TestClient`) | Frontend and icon files served; State A returns no regression numbers; State B model and simulation; 422 on invalid requests; sensitivity; upload rejection and non-persistence of synthetic files; `/api/states` |
| `tests/test_ui.py` | End-to-end (Playwright, headless Chromium; skipped if Chromium is not installed) | Landing (no controls, one call to action, fits the viewport); disclaimer on hover, click, Escape and keyboard focus; typed values synced with sliders and validated; live update equals the API value; presets and state baseline; extrapolation flagged and not clamped; collapsed pricing with demand kept separate; theme persistence; model and methods pages (including the three-column variable table); upload flow; no horizontal overflow at six viewport sizes; keyboard operation and labels; real-data end-to-end |

**Fixtures.** `tests/fixtures/synthetic.py` writes small spreadsheets from a known linear model with a fixed seed and deliberately messy layout. They contain the word SYNTHETIC and are not CDC data. The UI and API tests start their own uvicorn processes with `HEARTLAB_DATA` pointing at a fixture.

**Setup for browser tests:** `.venv/bin/python -m playwright install chromium`.

**Reproducing results:** the suite is deterministic (fixed seeds for fixtures and Monte Carlo). Browser tests take three to five minutes because each starts a server and renders the WebGL landing in software. They wait for conditions rather than fixed delays, and the server fixture allows 30 s for startup.

---

## 14. Installation, configuration and execution

### 14.1 Prerequisites

Python 3.11 or later. For browser tests, Playwright's Chromium.

### 14.2 Install and run

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m playwright install chromium    # only for tests/test_ui.py and scripts/make_icons.py
./run.sh                                           # http://127.0.0.1:8000
PORT=8080 ./run.sh                                 # another port
```

`run.sh` runs `.venv/bin/python -m uvicorn app.backend.server:app --host 127.0.0.1 --port "$PORT"`.

### 14.3 Configuration

| Setting | Where | Effect |
|---|---|---|
| `HEARTLAB_DATA` | environment | Load this file instead of locating one in `data/raw/` |
| `PORT` | environment (`run.sh`) | Server port (default 8000) |
| `dataset_file`, `sheet`, `header_row` | `config/column_mapping.json` | Which file, sheet and header row to use (`null` = detect) |
| `variables.<name>.header / known_headers / patterns` | same | Column mapping |
| `variables.<name>.unit / definition / expected_sign` | same | Shown in the UI; `expected_sign` drives the sign check |
| `include_district_of_columbia`, `include_territories` | same | Row inclusion |
| `source.*` | same | Provenance text used by the API (`/api/status` → `source`) |

### 14.4 Other commands

```bash
.venv/bin/python -m src.data_processing [FILE]   # ingestion report; writes data/processed/
.venv/bin/python -m src.run_analysis             # regenerate results/
.venv/bin/python scripts/build_docx.py           # documentation/*.md → .docx
.venv/bin/python scripts/make_diagrams.py        # documentation/figures/
.venv/bin/python scripts/make_icons.py           # app/frontend/icons/
.venv/bin/python -m pytest -q                    # tests
```

### 14.5 Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The page says the backend is not responding | Start the server with `./run.sh` and reload |
| The simulator shows "Load the dataset" | No dataset was found or ingestion failed; `/api/status` → `error` gives the reason. Check `data/raw/` or set `HEARTLAB_DATA` |
| "Ambiguous columns" or "No column matches" | Set `variables.<name>.header` to the exact header text in `config/column_mapping.json` |
| A yellow banner says synthetic data is loaded | A test fixture was loaded; restart without `HEARTLAB_DATA` |
| Browser tests are skipped | Install Chromium: `.venv/bin/python -m playwright install chromium` |
| Port already in use | `PORT=8001 ./run.sh` |

---

## 15. Known limitations

- **Ecological data.** Observations are jurisdiction averages. Associations between states need not hold for individuals; nothing in HEARTLAB estimates personal risk.
- **Association, not causation.** A scenario reports what the fitted equation gives for other input values. It does not estimate what would happen if a state changed, and it does not count deaths prevented.
- **Historical, single-year, small sample.** 51 observations from 1998. Diagnostic tests have limited power, and some estimates depend on a few influential jurisdictions.
- **Statistical uncertainty.** Smoking is significant at α = 0.05 with classical standard errors but not with HC3 (p = 0.108). The price pathway works only through smoking.
- **Unexpected sign.** The low fruit/vegetable coefficient is negative, probably reflecting overlap with the other predictors or confounding. It is reported, not corrected.
- **Extrapolation.** Inputs outside the observed range are accepted within the hard limits and flagged; linearity outside the data is an assumption.
- **Assumed elasticity.** The prevalence elasticity is a user assumption; only the demand elasticity is sourced, and it is never used as the prevalence response.
- **Dataset provenance.** The working dataset is reconstructed from CDC tables, not the textbook's `CDCHeartRisk.xls`.
- **Reproducibility.** Dependencies are pinned; Monte Carlo and fixtures use fixed seeds. Floating-point results can differ in the last digits across platforms or library versions.
- **Single process.** The engine is in-process state; an upload replaces the dataset for every user of that server. It is designed for local, single-user use.

---

## 16. Maintenance and extension

**Add or replace the dataset.** Put the file in `data/raw/`, set `dataset_file` in `config/column_mapping.json`, and update `known_headers`, units, definitions and `source` to match the file. Run `python -m src.data_processing` to check the ingestion report, then `python -m src.run_analysis` and the tests. `TestRealDataset` in `tests/test_heartlab.py` asserts facts about the current file (51 complete rows, 1998 years); update it with the data.

**Change the model's inputs.** Predictors are listed in `data_processing.PREDICTORS` and `MODEL_VARIABLES` and configured in `config/column_mapping.json`. The frontend's labels are in `app.js` (`PREDICTORS`, `NAMES`, `LONG`). The price pathway assumes a `smoking` predictor and returns `regression_effect: null` without one.

**Change the regression.** Fitting and inference are in `src/model.py` (`fit_ols`, `summarize`, `prediction`, `difference`). Keep the verification checks in `src/validation.py` passing; they recompute the fit independently.

**Add a diagnostic.** Compute it in `model.diagnostics()` and add a key to its dictionary; it then appears in `/api/model` under `models.<name>.diagnostics`. Render it in `buildModelView()` in `app.js` and add a test in `tests/test_heartlab.py` (`TestModel.test_diagnostics_present`).

**Add or change a simulation feature.** Backend: `src/simulation.py` (`run_scenario`, `policy_chain`), wired through `HeartLabEngine.simulate` and the `SimulationRequest` model in `server.py`. Frontend: `requestBody()` and `renderOutcome()` in `app.js`. Keep sourced values and assumptions in separate, labelled fields.

**After any change:** run `.venv/bin/python -m pytest -q`, regenerate `results/` if model output changed, and update this document, `README.md` and, if results changed, the research documentation.

**Architectural constraints.**

- All statistics are computed in Python; the browser only renders API output.
- Never write synthetic data into `data/raw/` or `results/`.
- Never use the demand elasticity as the prevalence elasticity.
- Never clamp an input silently; reject it or flag it.
