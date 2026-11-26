"""
HEARTLAB verification and validation.

Verification (is the code computing the model correctly?)
  - statsmodels coefficients equal the numpy normal-equation solution.
  - R^2 recomputed from residual and total sums of squares.
  - F statistic recomputed from R^2.
  - Residuals sum to ~0 (model has an intercept).
  - Prediction at the predictor means equals the mean of Y (OLS property).

Validation (how well does the model describe/predict data it was not fitted on?)
  - Leave-one-state-out cross-validation via the hat matrix (PRESS statistic),
    giving out-of-sample RMSE and predicted R^2.
  - Coefficient signs compared with the direction reported in the literature.
    This is a plausibility check only: agreement does not validate causality.
"""
from __future__ import annotations

from typing import Any

import numpy as np
from scipy import stats

from .data_processing import DEPENDENT
from .model import FittedModel, normal_equation

# Direction of association expected for each risk factor (plausibility check only).
# fruit_veg is left undetermined: its sign depends on whether the CDC column measures adequate
# consumption (expected negative) or the share eating fewer than five servings a day (expected
# positive). Set "expected_sign" in config/column_mapping.json once the column definition is known.
EXPECTED_SIGN = {"smoking": +1, "obesity": +1, "inactivity": +1, "fruit_veg": None}


def verify(m: FittedModel, tol: float = 1e-8) -> list[dict[str, Any]]:
    res = m.result
    y = m.data[DEPENDENT].to_numpy(float)
    checks = []

    def add(name, expected, actual, ok):
        checks.append({"check": name, "expected": expected, "actual": actual, "passed": bool(ok)})

    beta_ne = normal_equation(m.data, m.predictors)
    add("Coefficients equal (X'X)^-1 X'y", beta_ne.tolist(), res.params.to_numpy().tolist(),
        np.allclose(beta_ne, res.params.to_numpy(), rtol=1e-8, atol=1e-8))
    sse = float(np.sum(res.resid ** 2))
    sst = float(np.sum((y - y.mean()) ** 2))
    r2 = 1 - sse / sst
    add("R^2 = 1 - SSE/SST", r2, float(res.rsquared), abs(r2 - res.rsquared) < tol)
    k, n = len(m.predictors), len(y)
    if k:
        f = (r2 / k) / ((1 - r2) / (n - k - 1))
        add("F = (R^2/k)/((1-R^2)/(n-k-1))", f, float(res.fvalue), abs(f - res.fvalue) < 1e-6 * max(1, f))
        fp = float(stats.f.sf(f, k, n - k - 1))
        add("p(F) from F distribution", fp, float(res.f_pvalue), abs(fp - res.f_pvalue) < 1e-10)
    add("Residuals sum to zero", 0.0, float(res.resid.sum()), abs(res.resid.sum()) < 1e-6 * max(1, sst))
    means = {p: float(m.data[p].mean()) for p in m.predictors}
    add("Y-hat at predictor means equals mean(Y)", float(y.mean()), m.predict(means),
        abs(m.predict(means) - y.mean()) < 1e-8 * max(1, abs(y.mean())))
    return checks


def loocv(m: FittedModel) -> dict[str, Any]:
    """Leave-one-out residuals e_i/(1-h_ii): exact for OLS, no refitting needed."""
    res = m.result
    h = res.get_influence().hat_matrix_diag
    e_loo = res.resid.to_numpy() / (1 - h)
    y = m.data[DEPENDENT].to_numpy(float)
    press = float(np.sum(e_loo ** 2))
    sst = float(np.sum((y - y.mean()) ** 2))
    return {"press": press,
            "rmse_in_sample": float(np.sqrt(np.mean(res.resid ** 2))),
            "rmse_loocv": float(np.sqrt(press / len(y))),
            "mae_loocv": float(np.mean(np.abs(e_loo))),
            "predicted_r_squared": 1 - press / sst,
            "loo_residuals": dict(zip(m.data["state"], map(float, e_loo))) if "state" in m.data else None}


def loocv_bruteforce(m: FittedModel) -> np.ndarray:
    """Refit n times; used by the test-suite to verify the hat-matrix shortcut."""
    from .model import fit_ols
    out = []
    for i in range(len(m.data)):
        train = m.data.drop(index=m.data.index[i])
        fm = fit_ols(train, m.predictors)
        row = m.data.iloc[i]
        out.append(float(row[DEPENDENT]) - fm.predict({p: row[p] for p in m.predictors}))
    return np.array(out)


def sign_check(m: FittedModel, mapping: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    rows = []
    for p in m.predictors:
        b = float(m.params[p])
        exp = EXPECTED_SIGN[p]
        if mapping and mapping["variables"][p].get("expected_sign") is not None:
            exp = int(mapping["variables"][p]["expected_sign"])
        rows.append({"variable": p, "estimate": b, "expected_sign": exp,
                     "observed_sign": int(np.sign(b)),
                     "agrees": None if exp is None else bool(np.sign(b) == exp),
                     "p_value": float(m.result.pvalues[p])})
    return rows
