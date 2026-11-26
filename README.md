# HEARTLAB

An interactive empirical model of heart disease risk factors, built as a Computational Science final project. It implements Gordon & Guilfoos (2017), *Introduction to Modeling and Simulation with MATLAB and Python*, Chapter 14, §14.3.6, "Empirical Model of Heart Disease Risk Factors".

HEARTLAB fits a multiple linear regression of U.S. state coronary heart disease (CHD) death rates on smoking, obesity, physical inactivity and low fruit and vegetable intake. You can then change those factors, or simulate a cigarette-price rise, and see how the model's estimate responds, with its uncertainty. A Python backend does every calculation. The web interface (landing page, simulator, model evidence, methods and data) only displays the results.

> **Data.** `data/raw/HEARTLAB_1998_CDC_CHD_dataset.csv` contains 50 states and DC, with 1998 risk factors and 1998 CHD mortality. It was assembled from separate CDC-published tables and is **not** the textbook's original `CDCHeartRisk.xls`. Full model: R² = 0.458, adjusted R² = 0.410, F(4, 46) = 9.70, p < 0.001. All four predictors are significant at α = 0.05; smoking only marginally, and not under HC3 robust standard errors.

HEARTLAB describes associations across states. It does not estimate an individual's risk and does not show causal effects.

## Quick start

Requires Python 3.11 or later.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m playwright install chromium   # only needed for the browser tests
./run.sh                                          # open http://127.0.0.1:8000
```

## Using it

1. **Landing page.** Click **Explore the simulator**. The background plots the dataset's 51 jurisdictions; move the pointer across it to read a state's values. The ⓘ icon opens the disclaimer.
2. **1 · Starting point.** The default is the average of 51 jurisdictions (311.4 deaths per 100,000 people aged 35+, per year). You can choose a state instead.
3. **2 · Adjust the risk factors.** Drag a slider, or click the number beside it and type a value (Enter to apply, Escape to cancel). Two presets are available: **Better habits** and **Lower smoking**. **Reset** returns to the starting point.
4. **3 · How the estimate changed.** This section shows:
   - the new estimate;
   - the starting point and your scenario as bars, with the scenario's uncertainty range;
   - a one-line summary;
   - where the scenario sits among the states;
   - each factor's estimated contribution to the change.

   **Statistical details** opens the coefficients, p-values, R² and intervals. It links to **Model evidence** (diagnostics, Monte Carlo, sensitivity).
5. **Explore cigarette pricing policy** is collapsed by default. It covers the price rise, an *assumed* smoking response, and the published demand figure, which is shown for reference but never used in the model.

Values outside the range seen in the data are accepted, flagged as extrapolation, and never clamped.

## Documentation

- [`docs/TECHNICAL_DOCUMENTATION.md`](docs/TECHNICAL_DOCUMENTATION.md): the engineering reference. It covers architecture, the data pipeline, the regression and diagnostics as implemented, the simulation engine, the API, the frontend, testing, configuration, limitations and how to extend the system.
- [`documentation/HEARTLAB_Research_Documentation.md`](documentation/HEARTLAB_Research_Documentation.md) (and `.docx`): the research paper foundation. Items marked **[GROUP INPUT REQUIRED]** still need the group's information. The ACM-format PDF has not been produced yet.
- [`DESIGN.md`](DESIGN.md): the visual design system.

## Project structure

```
app/backend/server.py        FastAPI JSON API; serves the frontend
app/frontend/                index.html, app.js (UI), charts.js (SVG charts), heart.js (WebGL illustration),
                             field.js (landing data field), styles.css, icons/, fonts/
config/column_mapping.json   column → model-variable mapping, units, definitions, provenance
src/                         data_processing, model, validation, simulation, sensitivity_analysis, engine, run_analysis
tests/                       pytest suite (unit, API, Playwright browser tests); synthetic fixtures
data/raw, data/processed     the 1998 dataset; cleaned copy and ingestion report
results/                     tables, figures and model_summary.json from `python -m src.run_analysis`
scripts/                     build_docx.py, make_diagrams.py, make_icons.py
documentation/               research documentation and figures
docs/                        technical documentation
```

## Common commands

```bash
./run.sh                                   # start the app (PORT=8080 ./run.sh for another port)
.venv/bin/python -m pytest -q              # run the test suite
.venv/bin/python -m src.run_analysis       # regenerate results/ from the dataset
.venv/bin/python -m src.data_processing    # print the ingestion report
HEARTLAB_DATA=/path/to/file ./run.sh       # load a different dataset file
```

## Tests

`.venv/bin/python -m pytest -q` runs 117 tests:

- **Unit and integration** (`tests/test_heartlab.py`): ingestion, the regression, diagnostics, verification and validation, the simulation, sensitivity, and the real dataset.
- **API contract** (`tests/test_api.py`).
- **Headless-browser** (`tests/test_ui.py`): landing, disclaimer, typed inputs, scenarios, extrapolation, pricing, theme, upload, responsive layout and keyboard use.

Fixtures are synthetic and labelled as such. A synthetic file is flagged in the interface and is never written to `data/raw/` or `results/`. See the technical documentation, Section 13.

## References

- Gordon, S. I., & Guilfoos, B. (2017). *Introduction to Modeling and Simulation with MATLAB® and Python*. Chapman and Hall/CRC.
- Bader, P., Boisclair, D., & Ferrence, R. (2011). Effects of tobacco taxation and pricing on smoking behavior in high risk populations: A knowledge synthesis. *IJERPH, 8*(11), 4118–4139. https://doi.org/10.3390/ijerph8114118
