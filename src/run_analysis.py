"""
HEARTLAB analysis runner: produces every table and figure for the paper from the real dataset.

    python -m src.run_analysis                      # uses data/raw/CDCHeartRisk.xls
    python -m src.run_analysis path/to/file.xls     # explicit file
    python -m src.run_analysis FILE --out DIR       # write somewhere other than results/

Without a dataset it writes only the data-independent policy table (Component A) and exits
with a clear message. It never writes placeholder regression output.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from . import data_processing as dp
from . import sensitivity_analysis as sa
from .engine import HeartLabEngine, records
from .model import summarize, diagnostics
from .validation import verify, loocv, sign_check

ROOT = Path(__file__).resolve().parents[1]
LABELS = {"smoking": "Smoking", "obesity": "Obesity", "inactivity": "Physical inactivity",
          "fruit_veg": "Low fruit & veg intake", "heart_disease": "CHD deaths per 100,000"}
INK, MUTED, ACCENT, GRID = "#1d2430", "#6b7383", "#c8463c", "#e4e6ea"

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 9, "axes.edgecolor": MUTED,
                     "axes.labelcolor": INK, "xtick.color": MUTED, "ytick.color": MUTED,
                     "axes.spines.top": False, "axes.spines.right": False, "figure.dpi": 150,
                     "savefig.bbox": "tight"})


def _write(df: pd.DataFrame, path: Path):
    df.to_csv(path, index=False)


def figures(engine: HeartLabEngine, fig_dir: Path, tag: str):
    m = engine.models["full"]
    data = engine.data
    # 1. Scatter matrix: Y against each predictor
    fig, axes = plt.subplots(1, 4, figsize=(11, 2.8), sharey=True)
    for ax, p in zip(axes, dp.PREDICTORS):
        ax.scatter(data[p], data["heart_disease"], s=14, color=INK, alpha=0.75, lw=0)
        b = np.polyfit(data[p], data["heart_disease"], 1)
        xs = np.linspace(data[p].min(), data[p].max(), 50)
        ax.plot(xs, np.polyval(b, xs), color=ACCENT, lw=1.2)
        r = np.corrcoef(data[p], data["heart_disease"])[0, 1]
        ax.set_title(f"{LABELS[p]}  (r = {r:.2f})", fontsize=9, color=INK)
        ax.set_xlabel(engine.mapping["variables"][p].get("unit") or "source units")
        ax.grid(color=GRID, lw=0.6)
    axes[0].set_ylabel(LABELS["heart_disease"])
    fig.suptitle(f"State observations, n = {len(data)}{tag}", x=0.01, ha="left", fontsize=10)
    fig.savefig(fig_dir / "fig1_scatter_predictors.png"); plt.close(fig)

    # 2. Coefficient plot with 95% CI (standardized for comparability)
    s = summarize(m)
    co = [c for c in s["coefficients"] if c["term"] != "const"]
    fig, ax = plt.subplots(figsize=(5.5, 2.6))
    for i, c in enumerate(co):
        sd_x = data[c["term"]].std(ddof=1) / data["heart_disease"].std(ddof=1)
        lo, hi, est = c["ci_low"] * sd_x, c["ci_high"] * sd_x, c["standardized"]
        col = ACCENT if c["significant"] else MUTED
        ax.plot([lo, hi], [i, i], color=col, lw=2)
        ax.plot(est, i, "o", color=col, ms=6)
        ax.text(hi, i + 0.18, f"  p = {c['p_value']:.3f}", fontsize=8, color=col, va="bottom")
    ax.axvline(0, color=MUTED, lw=0.8, ls="--")
    ax.set_yticks(range(len(co)), [LABELS[c["term"]] for c in co])
    ax.set_xlabel("Standardized coefficient (95% CI)")
    ax.set_title(f"Full model coefficients{tag}", loc="left", fontsize=10)
    ax.grid(axis="x", color=GRID, lw=0.6)
    fig.savefig(fig_dir / "fig2_coefficients.png"); plt.close(fig)

    # 3. Residual diagnostics
    d = diagnostics(m)
    obs = pd.DataFrame(d["observations"])
    fig, axes = plt.subplots(1, 3, figsize=(11, 3))
    axes[0].scatter(obs.fitted, obs.residual, s=14, color=INK, lw=0)
    axes[0].axhline(0, color=ACCENT, lw=1)
    axes[0].set(xlabel="Fitted value", ylabel="Residual", title="Residuals vs fitted")
    from scipy import stats
    (osm, osr), (slope, inter, _) = stats.probplot(obs.residual, dist="norm")
    axes[1].scatter(osm, osr, s=14, color=INK, lw=0)
    axes[1].plot(osm, slope * np.array(osm) + inter, color=ACCENT, lw=1)
    axes[1].set(xlabel="Theoretical quantile", ylabel="Ordered residual", title="Normal Q-Q")
    axes[2].bar(range(len(obs)), obs.cooks_d, color=[ACCENT if f else MUTED for f in obs.influential], width=0.8)
    axes[2].axhline(d["thresholds"]["cooks_d"], color=INK, lw=0.8, ls="--")
    for i, r in obs[obs.influential].iterrows():
        axes[2].text(i, r.cooks_d, r.state, fontsize=7, ha="center", va="bottom")
    axes[2].set(xlabel="State (row order)", ylabel="Cook's distance", title="Influence (cut-off 4/n)")
    for ax in axes:
        ax.grid(color=GRID, lw=0.6); ax.title.set_fontsize(10)
    fig.savefig(fig_dir / "fig3_residual_diagnostics.png"); plt.close(fig)

    # 4. Observed vs fitted
    fig, ax = plt.subplots(figsize=(4, 4))
    ax.scatter(obs.observed, obs.fitted, s=14, color=INK, lw=0)
    lim = [min(obs.observed.min(), obs.fitted.min()), max(obs.observed.max(), obs.fitted.max())]
    ax.plot(lim, lim, color=ACCENT, lw=1)
    ax.set(xlabel="Observed", ylabel="Fitted", title=f"Observed vs fitted (R² = {s['r_squared']:.3f}){tag}")
    ax.title.set_fontsize(10); ax.grid(color=GRID, lw=0.6)
    fig.savefig(fig_dir / "fig4_observed_vs_fitted.png"); plt.close(fig)

    # 5. Tornado
    base = engine.baseline("mean")
    t = sa.tornado(m, data, base)
    fig, ax = plt.subplots(figsize=(5.5, 2.4))
    yb = t.baseline_yhat.iloc[0]
    for i, r in t.iloc[::-1].reset_index(drop=True).iterrows():
        ax.barh(i, r.yhat_plus_1sd - yb, left=yb, color=ACCENT, height=0.55)
        ax.barh(i, r.yhat_minus_1sd - yb, left=yb, color=MUTED, height=0.55)
    ax.axvline(yb, color=INK, lw=0.8)
    ax.set_yticks(range(len(t)), [LABELS[v] for v in t.variable[::-1]])
    ax.set_xlabel("Model-estimated heart disease rate (−1 SD grey, +1 SD red)")
    ax.set_title(f"One-at-a-time sensitivity at the state mean{tag}", loc="left", fontsize=10)
    fig.savefig(fig_dir / "fig5_tornado.png"); plt.close(fig)

    # 6. Policy grid
    g = sa.policy_grid(m, base)
    fig, ax = plt.subplots(figsize=(5.5, 3))
    for j, e in enumerate(sa.ELASTICITY_GRID):
        sub = g[g.prevalence_elasticity == e]
        ax.plot(sub.price_increase_pct, sub.delta_yhat, marker="o", ms=3, lw=1.3,
                color=plt.cm.Reds(0.35 + 0.15 * j) if e else MUTED, label=f"E_s = {e:g}")
    ax.axhline(0, color=MUTED, lw=0.6)
    ax.set(xlabel="Cigarette price increase (%)", ylabel="Δ model-estimated rate")
    ax.set_title(f"Price scenarios under assumed prevalence elasticities{tag}", loc="left", fontsize=10)
    ax.legend(frameon=False, fontsize=8); ax.grid(color=GRID, lw=0.6)
    fig.savefig(fig_dir / "fig6_policy_grid.png"); plt.close(fig)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("dataset", nargs="?")
    ap.add_argument("--out", default=str(ROOT / "results"))
    args = ap.parse_args(argv)
    out = Path(args.out)
    tables, figs = out / "tables", out / "figures"
    tables.mkdir(parents=True, exist_ok=True); figs.mkdir(parents=True, exist_ok=True)

    _write(sa.policy_table(), tables / "policy_demand_response.csv")
    path = Path(args.dataset) if args.dataset else dp.locate_dataset()
    if path is None:
        print("Original dataset not found in data/raw/. Wrote only tables/policy_demand_response.csv "
              "(arithmetic on the sourced elasticity). No regression output was produced.")
        return 2
    eng = HeartLabEngine()
    if not eng.load(path):
        print("Dataset could not be ingested:\n" + eng.error["message"])
        if eng.error.get("report"):
            print(json.dumps(eng.error["report"], indent=2, default=str))
        return 1
    rep = eng.report
    tag = "  [SYNTHETIC TEST DATA]" if rep.synthetic else ""
    if out.resolve() == (ROOT / "results").resolve() and rep.synthetic:
        print("Refusing to write synthetic-fixture results into results/. Use --out.")
        return 3
    dp.save_processed(eng.clean, rep, out / "processed")
    _write(dp.describe(eng.clean).reset_index(names="variable"), tables / "descriptive_statistics.csv")
    _write(eng.data[["state", *dp.MODEL_VARIABLES]].corr(numeric_only=True).reset_index(names="variable"),
           tables / "correlation_matrix.csv")
    _write(pd.DataFrame(rep.excluded_rows or [], columns=["row", "label", "reason"]), tables / "excluded_rows.csv")

    summary = {"synthetic": rep.synthetic, "dataset": rep.source_file, "models": {}}
    for name, m in eng.models.items():
        s = summarize(m)
        _write(pd.DataFrame(s["coefficients"]), tables / f"coefficients_{name}.csv")
        d = diagnostics(m)
        _write(pd.DataFrame(d["observations"]), tables / f"residuals_{name}.csv")
        _write(pd.DataFrame([{"variable": k, "vif": v} for k, v in d["vif"].items()]), tables / f"vif_{name}.csv")
        ver = verify(m)
        _write(pd.DataFrame(ver).astype(str), tables / f"verification_{name}.csv")
        lo = loocv(m); lo.pop("loo_residuals", None)
        summary["models"][name] = {**{k: v for k, v in s.items() if k != "coefficients"}, "validation": lo,
                                   "diagnostics": {k: v for k, v in d.items() if k != "observations"},
                                   "verification_passed": all(c["passed"] for c in ver),
                                   "sign_check": sign_check(m, eng.mapping)}
    summary["elimination_steps"] = eng.elimination_steps
    base = eng.baseline("mean")
    full = eng.models["full"]
    _write(sa.one_at_a_time(full, eng.data, base), tables / "sensitivity_one_at_a_time.csv")
    _write(sa.tornado(full, eng.data, base), tables / "sensitivity_tornado.csv")
    _write(sa.policy_grid(full, base), tables / "sensitivity_policy_grid.csv")
    with open(out / "model_summary.json", "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2, default=str)
    figures(eng, figs, tag)
    print(f"Wrote tables to {tables} and figures to {figs}. Observations: {rep.observations}, "
          f"complete cases: {rep.complete_cases}. Full model R² = {summary['models']['full']['r_squared']:.4f}"
          f"{tag}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
