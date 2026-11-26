"""
HEARTLAB sensitivity analysis.

Structured (not arbitrary) scenario grids:
  1. One-at-a-time: each predictor shifted by -2, -1, -0.5, +0.5, +1, +2 cross-state
     standard deviations, and by -5, -2, -1, +1, +2, +5 percentage points, others at baseline.
  2. Tornado: effect on Y_hat of moving each predictor from -1 SD to +1 SD.
  3. Policy grid: price increases {5,10,15,20,25,50}% x assumed prevalence elasticities
     {0, -0.1, -0.2, -0.3, -0.4}. Elasticities are ASSUMPTIONS spanning "no prevalence
     response" up to "prevalence responds as strongly as total demand" (|E_s| = |E_d|).
Every row records whether each value is observed, scenario-defined or assumed.
"""
from __future__ import annotations

import pandas as pd

from .data_processing import PREDICTORS
from .model import FittedModel, difference
from .simulation import DEMAND_ELASTICITY, demand_response, apply_prevalence_change

SD_STEPS = [-2.0, -1.0, -0.5, 0.5, 1.0, 2.0]
POINT_STEPS = [-5.0, -2.0, -1.0, 1.0, 2.0, 5.0]
PRICE_GRID = [5.0, 10.0, 15.0, 20.0, 25.0, 50.0]
ELASTICITY_GRID = [0.0, -0.1, -0.2, -0.3, -0.4]


def policy_table(price_grid=PRICE_GRID) -> pd.DataFrame:
    """Component A only (needs no data): demand change implied by the sourced E_d = -0.4."""
    return pd.DataFrame({"price_increase_pct": price_grid,
                         "demand_elasticity": DEMAND_ELASTICITY,
                         "demand_change_pct": [demand_response(p) for p in price_grid],
                         "status": "sourced elasticity applied arithmetically (not a HEARTLAB fit)"})


def one_at_a_time(model: FittedModel, data: pd.DataFrame, baseline: dict[str, float]) -> pd.DataFrame:
    rows = []
    base_x = {p: baseline[p] for p in model.predictors}
    for var in PREDICTORS:
        sd = float(data[var].std(ddof=1))
        for kind, steps in (("sd", SD_STEPS), ("points", POINT_STEPS)):
            for step in steps:
                change = step * sd if kind == "sd" else step
                new_val = baseline[var] + change
                if new_val < 0:
                    continue
                row = {"variable": var, "step_type": kind, "step": step, "baseline_input": baseline[var],
                       "modified_input": new_val, "absolute_change": change,
                       "pct_change": change / baseline[var] * 100 if baseline[var] else None,
                       "input_status": "baseline observed (state mean); modification user-defined scenario",
                       "in_model": var in model.predictors}
                if var in model.predictors:
                    x = dict(base_x, **{var: new_val})
                    d = difference(model, base_x, x)
                    yb = model.predict(base_x)
                    row.update({"baseline_yhat": yb, "scenario_yhat": yb + d["delta"], "delta_yhat": d["delta"],
                                "delta_ci_low": d["ci_low"], "delta_ci_high": d["ci_high"]})
                rows.append(row)
    return pd.DataFrame(rows)


def tornado(model: FittedModel, data: pd.DataFrame, baseline: dict[str, float]) -> pd.DataFrame:
    rows = []
    base_x = {p: baseline[p] for p in model.predictors}
    yb = model.predict(base_x)
    for var in model.predictors:
        sd = float(data[var].std(ddof=1))
        lo = model.predict(dict(base_x, **{var: baseline[var] - sd}))
        hi = model.predict(dict(base_x, **{var: baseline[var] + sd}))
        rows.append({"variable": var, "sd": sd, "yhat_minus_1sd": lo, "yhat_plus_1sd": hi, "baseline_yhat": yb,
                     "swing": abs(hi - lo)})
    return pd.DataFrame(rows).sort_values("swing", ascending=False).reset_index(drop=True)


def policy_grid(model: FittedModel, baseline: dict[str, float],
                price_grid=PRICE_GRID, elasticity_grid=ELASTICITY_GRID) -> pd.DataFrame:
    rows = []
    base_x = {p: baseline[p] for p in model.predictors}
    for p in price_grid:
        for e in elasticity_grid:
            pct = e * p
            s_new = apply_prevalence_change(baseline["smoking"], pct)
            row = {"price_increase_pct": p, "demand_change_pct": demand_response(p),
                   "prevalence_elasticity": e, "prevalence_elasticity_status": "assumption",
                   "smoking_base": baseline["smoking"], "smoking_new": s_new,
                   "smoking_change_points": s_new - baseline["smoking"], "smoking_change_pct": pct}
            if "smoking" in model.predictors:
                d = difference(model, base_x, dict(base_x, smoking=s_new))
                row.update({"delta_yhat": d["delta"], "delta_ci_low": d["ci_low"], "delta_ci_high": d["ci_high"]})
            else:
                row.update({"delta_yhat": 0.0, "delta_ci_low": 0.0, "delta_ci_high": 0.0,
                            "note": "smoking not in this model; no regression response"})
            rows.append(row)
    return pd.DataFrame(rows)
