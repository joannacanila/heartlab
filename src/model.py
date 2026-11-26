"""
HEARTLAB statistical layer: the multiple linear regression of Section 14.3.6.

    Y_i = b0 + b1*X1_i + b2*X2_i + b3*X3_i + b4*X4_i + e_i

Y  = state CHD death rate, X1 = smoking prevalence, X2 = obesity
prevalence, X3 = physical inactivity, X4 = share of adults eating fewer than
five servings of fruit and vegetables a day (low intake).

Estimation is ordinary least squares (statsmodels). The fitted object keeps
everything needed for inference, diagnostics and prediction intervals.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy import stats
from statsmodels.stats.diagnostic import het_breuschpagan, het_white
from statsmodels.stats.outliers_influence import variance_inflation_factor, OLSInfluence
from statsmodels.stats.stattools import jarque_bera

from .data_processing import PREDICTORS, DEPENDENT

ALPHA = 0.05


@dataclass
class FittedModel:
    name: str
    predictors: list[str]
    result: Any              # statsmodels RegressionResultsWrapper
    data: pd.DataFrame       # analysis frame used for fitting (complete cases)

    @property
    def params(self) -> pd.Series:
        return self.result.params

    @property
    def cov(self) -> pd.DataFrame:
        return self.result.cov_params()

    def design(self, x: dict[str, float]) -> np.ndarray:
        return np.array([1.0] + [float(x[p]) for p in self.predictors])

    def predict(self, x: dict[str, float]) -> float:
        return float(self.design(x) @ self.params.values)


def fit_ols(data: pd.DataFrame, predictors: list[str] | None = None, name: str = "full") -> FittedModel:
    predictors = list(predictors or PREDICTORS)
    X = sm.add_constant(data[predictors].astype(float), has_constant="add")
    y = data[DEPENDENT].astype(float)
    res = sm.OLS(y, X).fit()
    return FittedModel(name=name, predictors=predictors, result=res, data=data)


def normal_equation(data: pd.DataFrame, predictors: list[str]) -> np.ndarray:
    """Independent verification: beta = (X'X)^-1 X'y solved with numpy (no statsmodels)."""
    X = np.column_stack([np.ones(len(data))] + [data[p].to_numpy(float) for p in predictors])
    y = data[DEPENDENT].to_numpy(float)
    return np.linalg.solve(X.T @ X, X.T @ y)


def backward_elimination(data: pd.DataFrame, alpha: float = ALPHA) -> tuple[FittedModel, list[dict[str, Any]]]:
    """Reduced model: repeatedly drop the predictor with the largest p-value above alpha.

    Reported alongside, never instead of, the full candidate model.
    """
    current = list(PREDICTORS)
    steps = []
    while current:
        m = fit_ols(data, current, name="reduced")
        pv = m.result.pvalues.drop("const")
        worst = pv.idxmax()
        if pv[worst] <= alpha:
            break
        steps.append({"dropped": worst, "p_value": float(pv[worst]), "remaining": [p for p in current if p != worst]})
        current.remove(worst)
    if not current:
        return fit_ols(data, [], name="reduced"), steps
    return fit_ols(data, current, name="reduced"), steps


def vif(data: pd.DataFrame, predictors: list[str]) -> dict[str, float]:
    if len(predictors) < 2:
        return {p: 1.0 for p in predictors}
    X = sm.add_constant(data[predictors].astype(float), has_constant="add").to_numpy()
    return {p: float(variance_inflation_factor(X, i + 1)) for i, p in enumerate(predictors)}


def diagnostics(m: FittedModel) -> dict[str, Any]:
    res, n = m.result, int(m.result.nobs)
    resid = res.resid.to_numpy()
    infl = OLSInfluence(res)
    cooks = infl.cooks_distance[0]
    leverage = infl.hat_matrix_diag
    stud = infl.resid_studentized_external
    k = len(m.predictors)
    out: dict[str, Any] = {
        "residual_mean": float(resid.mean()),
        "residual_std": float(resid.std(ddof=k + 1)),
        "jarque_bera": dict(zip(["statistic", "p_value", "skew", "kurtosis"], map(float, jarque_bera(resid)))),
        "shapiro_wilk": dict(zip(["statistic", "p_value"], map(float, stats.shapiro(resid)))) if n >= 3 else None,
        "condition_number": float(res.condition_number),
        "vif": vif(m.data, m.predictors),
    }
    if k >= 1:
        bp = het_breuschpagan(resid, res.model.exog)
        out["breusch_pagan"] = {"lm": float(bp[0]), "p_value": float(bp[1]), "f": float(bp[2]), "f_p_value": float(bp[3])}
        try:
            w = het_white(resid, res.model.exog)
            out["white"] = {"lm": float(w[0]), "p_value": float(w[1])}
        except Exception:  # White test needs more observations than its auxiliary regressors
            out["white"] = None
    cook_cut = 4.0 / n
    lev_cut = 2.0 * (k + 1) / n
    states = m.data["state"].tolist() if "state" in m.data else list(range(n))
    out["observations"] = [
        {"state": s, "observed": float(y), "fitted": float(f), "residual": float(r),
         "studentized": float(t), "leverage": float(h), "cooks_d": float(c),
         "influential": bool(c > cook_cut), "high_leverage": bool(h > lev_cut), "outlier": bool(abs(t) > 2.5)}
        for s, y, f, r, t, h, c in zip(states, res.model.endog, res.fittedvalues, resid, stud, leverage, cooks)
    ]
    out["thresholds"] = {"cooks_d": cook_cut, "leverage": lev_cut, "studentized": 2.5}
    return out


def summarize(m: FittedModel, alpha: float = ALPHA) -> dict[str, Any]:
    """JSON-ready model summary (all numbers come straight from the statsmodels fit)."""
    res = m.result
    ci = res.conf_int(alpha)
    robust = res.get_robustcov_results(cov_type="HC3")
    names = ["const", *m.predictors]
    coefs = []
    for i, name in enumerate(names):
        coefs.append({
            "term": name,
            "estimate": float(res.params[name]),
            "std_error": float(res.bse[name]),
            "t": float(res.tvalues[name]),
            "p_value": float(res.pvalues[name]),
            "ci_low": float(ci.loc[name, 0]),
            "ci_high": float(ci.loc[name, 1]),
            "significant": bool(res.pvalues[name] < alpha),
            "hc3_std_error": float(robust.bse[i]),
            "hc3_p_value": float(robust.pvalues[i]),
        })
    std_y = float(m.data[DEPENDENT].std(ddof=1))
    for c in coefs[1:]:
        k_std = float(m.data[c["term"]].std(ddof=1)) / std_y
        c["standardized"] = c["estimate"] * k_std
        c["standardized_ci_low"] = c["ci_low"] * k_std
        c["standardized_ci_high"] = c["ci_high"] * k_std
    k = len(m.predictors)
    return {
        "name": m.name,
        "predictors": m.predictors,
        "n": int(res.nobs),
        "df_model": int(res.df_model),
        "df_resid": int(res.df_resid),
        "r_squared": float(res.rsquared),
        "adj_r_squared": float(res.rsquared_adj),
        "f_statistic": float(res.fvalue) if k else None,
        "f_p_value": float(res.f_pvalue) if k else None,
        "rmse": float(np.sqrt(res.mse_resid)),
        "aic": float(res.aic),
        "bic": float(res.bic),
        "alpha": alpha,
        "coefficients": coefs,
        "significant_predictors": [c["term"] for c in coefs[1:] if c["significant"]],
        "equation": equation_string(m),
    }


def equation_string(m: FittedModel, digits: int = 4) -> str:
    p = m.params
    parts = [f"{p['const']:.{digits}f}"]
    for name in m.predictors:
        b = p[name]
        parts.append(f"{'+' if b >= 0 else '-'} {abs(b):.{digits}f}·{name}")
    return "Ŷ = " + " ".join(parts)


def prediction(m: FittedModel, x: dict[str, float], alpha: float = ALPHA) -> dict[str, float]:
    """Point prediction with confidence interval (mean response) and prediction interval (new state)."""
    exog = m.design(x).reshape(1, -1)
    pr = m.result.get_prediction(exog).summary_frame(alpha=alpha)
    return {"estimate": float(pr["mean"].iloc[0]),
            "ci_low": float(pr["mean_ci_lower"].iloc[0]), "ci_high": float(pr["mean_ci_upper"].iloc[0]),
            "pi_low": float(pr["obs_ci_lower"].iloc[0]), "pi_high": float(pr["obs_ci_upper"].iloc[0])}


def difference(m: FittedModel, x_base: dict[str, float], x_new: dict[str, float], alpha: float = ALPHA) -> dict[str, float]:
    """Delta-Y-hat = (x_new - x_base)'beta with its exact OLS confidence interval: Var = d' Cov(beta) d."""
    d = m.design(x_new) - m.design(x_base)
    delta = float(d @ m.params.values)
    se = float(np.sqrt(max(d @ m.cov.values @ d, 0.0)))
    tcrit = float(stats.t.ppf(1 - alpha / 2, m.result.df_resid))
    return {"delta": delta, "std_error": se, "ci_low": delta - tcrit * se, "ci_high": delta + tcrit * se}
