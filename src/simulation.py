"""
HEARTLAB simulation layer: risk-factor scenarios and the cigarette-price policy pathway.

Policy pathway (three explicitly separated components)

  A. Cigarette demand response (sourced).
     %dQ = E_d * %dP, with E_d = -0.4: Bader et al. (2011, Introduction) report
     that a 10% price increase reduces cigarette demand by about 4% in the
     general adult population of high-income countries (citing Jha & Chaloupka, 1999).

  B. Smoking-prevalence response (ASSUMPTION).
     %dS = E_s * %dP. Bader et al. give no general-population prevalence
     elasticity, so E_s is a user-set assumption. It is never derived from E_d.
     The change is relative: S_new = S_base * (1 + E_s * %dP / 100).

  C. Regression outcome (model-based).
     Y_hat is recomputed with the new smoking input, other inputs held fixed
     unless the user changed them. dY_hat is an association-based scenario
     estimate, not a causal effect of taxation.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from .data_processing import PREDICTORS
from .model import FittedModel, prediction, difference, ALPHA

DEMAND_ELASTICITY = -0.4
DEMAND_ELASTICITY_SOURCE = (
    "Bader, Boisclair & Ferrence (2011), Introduction: a 10% cigarette price increase reduces demand by about 4% "
    "in the general adult population of high-income countries (attributed to Jha & Chaloupka, 1999).")
PRICE_LIMITS = (0.0, 100.0)          # % price increase accepted by the simulator
PREVALENCE_ELASTICITY_LIMITS = (-1.0, 0.0)
MC_DRAWS = 5000
MC_SEED = 20171


class InputError(ValueError):
    pass


def _finite(name: str, value: Any) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        raise InputError(f"{name} must be a number")
    if not np.isfinite(v):
        raise InputError(f"{name} must be finite")
    return v


def validate_policy(price_pct: Any, prevalence_elasticity: Any) -> tuple[float, float]:
    p = _finite("price_increase_pct", price_pct)
    e = _finite("prevalence_elasticity", prevalence_elasticity)
    if not PRICE_LIMITS[0] <= p <= PRICE_LIMITS[1]:
        raise InputError(f"price_increase_pct must be between {PRICE_LIMITS[0]:g} and {PRICE_LIMITS[1]:g}")
    if not PREVALENCE_ELASTICITY_LIMITS[0] <= e <= PREVALENCE_ELASTICITY_LIMITS[1]:
        raise InputError(f"prevalence_elasticity must be between {PREVALENCE_ELASTICITY_LIMITS[0]:g} and "
                         f"{PREVALENCE_ELASTICITY_LIMITS[1]:g}")
    return p, e


def demand_response(price_pct: float, elasticity: float = DEMAND_ELASTICITY) -> float:
    """Component A: percentage change in cigarette demand."""
    return elasticity * price_pct


def prevalence_response(price_pct: float, prevalence_elasticity: float) -> float:
    """Component B: assumed relative percentage change in smoking prevalence."""
    return prevalence_elasticity * price_pct


def apply_prevalence_change(smoking_base: float, pct_change: float) -> float:
    return smoking_base * (1.0 + pct_change / 100.0)


def policy_chain(price_pct: Any, prevalence_elasticity: Any, smoking_base: float | None = None) -> dict[str, Any]:
    """Components A and B. Works without a fitted model (State A)."""
    p, e = validate_policy(price_pct, prevalence_elasticity)
    out: dict[str, Any] = {
        "price_increase_pct": p,
        "demand_elasticity": DEMAND_ELASTICITY,
        "demand_elasticity_status": "sourced",
        "demand_elasticity_source": DEMAND_ELASTICITY_SOURCE,
        "demand_change_pct": demand_response(p),
        "prevalence_elasticity": e,
        "prevalence_elasticity_status": "assumption",
        "prevalence_change_pct": prevalence_response(p, e),
    }
    if smoking_base is not None:
        new = apply_prevalence_change(smoking_base, out["prevalence_change_pct"])
        out.update({"smoking_base": smoking_base, "smoking_new": new,
                    "smoking_change_points": new - smoking_base})
    return out


class InputBounds:
    """Per-variable bounds derived from the observed state data.

    Hard limits reject impossible values; the observed range flags extrapolation.
    """

    def __init__(self, data, predictors=PREDICTORS):
        self.bounds = {}
        for p in predictors:
            col = data[p].astype(float)
            lo, hi = float(col.min()), float(col.max())
            pad = 0.25 * (hi - lo)
            hard_hi = 1.0 if hi <= 1 else 100.0
            self.bounds[p] = {"observed_min": lo, "observed_max": hi,
                              "slider_min": max(0.0, lo - pad), "slider_max": min(hard_hi, hi + pad),
                              "hard_min": 0.0, "hard_max": hard_hi, "mean": float(col.mean()),
                              "sd": float(col.std(ddof=1))}

    def validate(self, x: dict[str, Any]) -> tuple[dict[str, float], list[str]]:
        clean, warnings = {}, []
        for p, b in self.bounds.items():
            if p not in x:
                raise InputError(f"missing input '{p}'")
            v = _finite(p, x[p])
            if not b["hard_min"] <= v <= b["hard_max"]:
                raise InputError(f"{p} must be between {b['hard_min']:g} and {b['hard_max']:g}")
            if v < b["observed_min"] or v > b["observed_max"]:
                warnings.append(f"{p} = {v:.2f} lies outside the observed state range "
                                f"[{b['observed_min']:.2f}, {b['observed_max']:.2f}]; the estimate is an extrapolation.")
            clean[p] = v
        return clean, warnings


def baseline_inputs(data, predictors=PREDICTORS, state: str | None = None) -> dict[str, float]:
    """Baseline = observed values for one state, or the unweighted mean across states."""
    if state and state != "mean":
        row = data.loc[data["state"] == state]
        if row.empty:
            raise InputError(f"unknown state '{state}'")
        return {p: float(row.iloc[0][p]) for p in predictors}
    return {p: float(data[p].mean()) for p in predictors}


def run_scenario(model: FittedModel, bounds: InputBounds, baseline: dict[str, float], inputs: dict[str, Any],
                 policy: dict[str, Any] | None = None, alpha: float = ALPHA) -> dict[str, Any]:
    """Full scenario: user-modified inputs, optional price policy applied to smoking, regression outcome."""
    x, warnings = bounds.validate(inputs)
    chain = None
    if policy and float(policy.get("price_increase_pct", 0)) > 0:
        chain = policy_chain(policy["price_increase_pct"], policy["prevalence_elasticity"], x["smoking"])
        if "smoking" in model.predictors:
            pre = {p: x[p] for p in model.predictors}
            post = dict(pre, smoking=chain["smoking_new"])
            chain["regression_effect"] = difference(model, pre, post, alpha)
        else:
            chain["regression_effect"] = None
        x["smoking"] = chain["smoking_new"]
    used = {p: x[p] for p in model.predictors}
    base_used = {p: baseline[p] for p in model.predictors}
    b = prediction(model, base_used, alpha)
    s = prediction(model, used, alpha)
    diff = difference(model, base_used, used, alpha)
    changes = []
    for p in PREDICTORS:
        changes.append({"variable": p, "baseline": baseline[p], "scenario": x[p], "change": x[p] - baseline[p],
                        "pct_change": (x[p] - baseline[p]) / baseline[p] * 100 if baseline[p] else None,
                        "in_model": p in model.predictors,
                        "contribution": float(model.params[p] * (x[p] - baseline[p])) if p in model.predictors else 0.0})
    return {
        "model": model.name,
        "baseline": b,
        "scenario": s,
        "difference": diff,
        "relative_change_pct": diff["delta"] / b["estimate"] * 100 if b["estimate"] else None,
        "inputs": changes,
        "policy": chain,
        "warnings": warnings,
    }


def monte_carlo(model: FittedModel, baseline: dict[str, float], scenario: dict[str, float],
                price_pct: float = 0.0, elasticity_range: tuple[float, float] | None = None,
                draws: int = MC_DRAWS, seed: int = MC_SEED) -> dict[str, Any]:
    """Extension: propagate coefficient uncertainty (and, optionally, an elasticity range) into dY_hat.

    beta ~ MVN(beta_hat, Cov(beta_hat)); if an elasticity range is given, E_s ~ Uniform(range)
    and the smoking input is recomputed per draw. Fixed seed -> reproducible output.
    """
    rng = np.random.default_rng(seed)
    betas = rng.multivariate_normal(model.params.values, model.cov.values, size=draws)
    xb = model.design(baseline)
    sc = dict(scenario)
    if elasticity_range and price_pct > 0 and "smoking" in model.predictors:
        lo, hi = sorted(elasticity_range)
        es = rng.uniform(lo, hi, size=draws)
        smoke = sc["smoking"] * (1 + es * price_pct / 100.0)
        X = np.tile(model.design(sc), (draws, 1))
        X[:, 1 + model.predictors.index("smoking")] = smoke
        deltas = np.einsum("ij,ij->i", X - xb, betas)
    else:
        deltas = betas @ (model.design(sc) - xb)
    q = np.percentile(deltas, [2.5, 5, 25, 50, 75, 95, 97.5])
    hist, edges = np.histogram(deltas, bins=40)
    return {"draws": draws, "seed": seed, "mean": float(deltas.mean()), "sd": float(deltas.std(ddof=1)),
            "quantiles": dict(zip(["p2_5", "p5", "p25", "p50", "p75", "p95", "p97_5"], map(float, q))),
            "prob_decrease": float((deltas < 0).mean()),
            "histogram": {"counts": hist.tolist(), "edges": edges.tolist()},
            "elasticity_range": list(elasticity_range) if elasticity_range else None}
