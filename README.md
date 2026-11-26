# HEARTLAB

An interactive empirical simulation of heart disease risk factors. This is the Computational Science final project implementing Gordon & Guilfoos (2017), *Introduction to Modeling and Simulation with MATLAB and Python*, Chapter 14, §14.3.6, "Empirical Model of Heart Disease Risk Factors".

HEARTLAB fits a multiple linear regression of U.S. state heart disease rates on smoking, obesity, physical inactivity and fruit and vegetable consumption. It then simulates risk-factor and cigarette-price scenarios. A Python backend does all the computation, and a web interface (landing page, live simulator, model evidence, methods & data) displays the results.

> **Current status: fitted on real data (State B).** The dataset `data/raw/HEARTLAB_1998_CDC_CHD_dataset.csv` (50 states + DC, 1998 risk factors and 1998 CHD mortality) loads automatically. It was assembled from separate CDC-published tables and is not the textbook's original `CDCHeartRisk.xls`. Full model: R² = 0.458, adjusted R² = 0.410, F(4, 46) = 9.70, p < 0.001; all four predictors significant at α = 0.05 (smoking only marginally, and not under HC3).

## Quick start

Requires Python 3.11 or later.

```bash
cd HEARTLAB
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m playwright install chromium   # optional: only for the browser tests
./run.sh                                          # then open http://127.0.0.1:8000
```

## Dataset

The configured dataset is named in `config/column_mapping.json` (`dataset_file`) and loaded from `data/raw/` when the server starts. Its columns are matched by exact name (`known_headers`); units and definitions are recorded there too.

```bash
.venv/bin/python -m src.data_processing   # ingestion report: mapping, excluded rows, missing values, file years
.venv/bin/python -m src.run_analysis      # writes all tables and figures into results/
```

To use a different file, either drop it on the upload area under Methods & data (or in the simulator when no dataset is loaded) (it is validated first and saved as `data/raw/uploaded_dataset.*`), or start the server with `HEARTLAB_DATA=/path/to/file ./run.sh`.

## Project structure

```
app/backend/server.py        FastAPI JSON API; serves the frontend
app/frontend/                index.html, styles.css, app.js (UI), charts.js (SVG charts), heart.js (WebGL heart), fonts/
config/column_mapping.json   spreadsheet header → model variable mapping, units, data year
src/data_processing.py       ingestion, header detection, row classification (drops totals/labels), cleaning
src/model.py                 OLS, inference, HC3, VIF, residual diagnostics, intervals, backward elimination
src/simulation.py            input validation, baselines, cigarette-price pathway, scenarios, Monte Carlo
src/sensitivity_analysis.py  one-at-a-time, tornado, price × elasticity grid
src/validation.py            analytic verification checks, LOOCV, sign plausibility
src/engine.py                State A / State B orchestration used by the API and the runner
src/run_analysis.py          batch generation of results/tables and results/figures
tests/                       115 automated tests (synthetic fixtures + real-data integration)
scripts/                     diagram generation; Markdown → DOCX conversion
documentation/               research documentation (.md and .docx) and figures
data/raw, data/processed     1998 dataset and its cleaned copy + ingestion report
results/                     tables and figures generated from the dataset
```

## The model, in brief

- **Regression [Textbook]:** Y = β0 + β1·Smoking + β2·Obesity + β3·Inactivity + β4·FruitVeg + ε, fitted by OLS with α = 0.05. The full model is always reported. A backward-elimination reduced model is shown alongside it.
- **Cigarette-price pathway:**
  - **A (sourced):** cigarette demand changes by −0.4 × the price change. This is from Bader et al. (2011), citing Jha & Chaloupka (1999).
  - **B (assumption):** smoking prevalence changes by E_s × the price change. E_s is set by the user (−1 to 0, default 0) and is never taken from the demand elasticity.
  - **C (model):** the new smoking value goes through the fitted equation.
- **Extensions:**
  - confidence intervals for every difference;
  - Monte Carlo propagation of coefficient uncertainty, and optionally of an E_s range;
  - HC3 robust standard errors;
  - LOOCV validation;
  - structured sensitivity grids.

## Demonstration flow (for the video)

1. **Landing page.** Drag a "Try it" slider (for example, smoking down to its minimum). The estimate comes from the backend, and the heart's crimson level shows where it sits between the lowest and highest observed state rates. Toggle the theme. Click **Open the simulator with these values**: the values carry over.
2. **Start.** Reset to the average of 51 jurisdictions: 311.4 deaths per 100,000.
3. **Presets.** Click **Obesity 5 points lower**. The estimate updates live. Show the range chart (start, scenario, CI against all 51 states) and "What moves the estimate".
4. **Keep for comparison**, then try **Match a state** (observed and modelled rates are labelled separately). Restore the kept scenario.
5. **Price.** Click **Cigarettes 20% dearer**. Walk through the pathway: price, share who smoke (assumed, amber), smoking prevalence, estimate. Point out that demand (−8.0%) is reference only. Switch the response between None, Small and Strong. Open **How certain is this?** for the CI, the prediction interval and the Monte Carlo spread.
6. **Fruit and vegetable sign.** Lower low fruit and vegetable intake and open the "Why…?" note.
7. **Model evidence:** in brief (R² 46%), coefficients (smoking loses significance under HC3; fruit/veg callout), how well it predicts (leave-one-out), checks on the assumptions, influential states (NY, AK), model selection, sensitivity.
8. Close on **Methods & data**: limitations and the reconstructed-dataset note.

## Testing

```bash
.venv/bin/python -m pytest -q
```

115 tests pass. They cover:

- ingestion, column mapping, aggregate-row exclusion, missing values and numeric conversion;
- regression recovery of known coefficients and agreement with the normal equation;
- diagnostics, verification identities, and LOOCV against brute force;
- the policy pathway, scenarios (single, simultaneous, reset, determinism), input validation and bounds, and sensitivity;
- the API contract and uploads;
- headless-browser interaction tests (navigation, scenarios, reset, invalid input, upload, keyboard tabs, mobile overflow);
- real-data integration (column mapping, 51 jurisdictions, 1998 years, independent least-squares check, API and browser).

All fixtures are **synthetic** and labelled as such. A synthetic file loaded into the app triggers a warning banner and is never written to `data/raw/` or `results/`.

## Documentation

- `documentation/HEARTLAB_Research_Documentation.md` and `.docx`: the paper foundation. It has 13 working sections mapped to the 8 required ACM sections. Items marked **[GROUP INPUT REQUIRED]** need the group's information.
- The ACM-format PDF has not been produced yet; the empirical results it needs now exist.

## References

- Gordon, S. I., & Guilfoos, B. (2017). *Introduction to Modeling and Simulation with MATLAB® and Python*. Chapman and Hall/CRC.
- Bader, P., Boisclair, D., & Ferrence, R. (2011). Effects of tobacco taxation and pricing on smoking behavior in high risk populations: A knowledge synthesis. *IJERPH, 8*(11), 4118–4139. https://doi.org/10.3390/ijerph8114118
