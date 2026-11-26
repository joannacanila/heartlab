"""Draw the conceptual-model and system-workflow diagrams used in the research documentation."""
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

OUT = Path(__file__).resolve().parents[1] / "documentation" / "figures"
OUT.mkdir(parents=True, exist_ok=True)
INK, MUTED, ACCENT, ASSUME, SOURCE = "#1d2430", "#6b7383", "#c8463c", "#b7832d", "#3f8a68"


def box(ax, x, y, w, h, title, sub="", edge=INK, dashed=False, fill="#ffffff"):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.01,rounding_size=0.015", fc=fill, ec=edge,
                                lw=1.3, ls="--" if dashed else "-"))
    ax.text(x + w / 2, y + h * (0.62 if sub else 0.5), title, ha="center", va="center", fontsize=9.5, color=INK,
            weight="bold")
    if sub:
        ax.text(x + w / 2, y + h * 0.3, sub, ha="center", va="center", fontsize=7.6, color=MUTED, wrap=True)


def arrow(ax, x0, y0, x1, y1, text="", color=INK, dashed=False):
    ax.annotate("", xy=(x1, y1), xytext=(x0, y0),
                arrowprops=dict(arrowstyle="-|>", color=color, lw=1.1, ls="--" if dashed else "-", shrinkA=2, shrinkB=2))
    if text:
        ax.text((x0 + x1) / 2, (y0 + y1) / 2 + 0.015, text, fontsize=7.2, color=color, ha="center", va="bottom")


def conceptual():
    fig, ax = plt.subplots(figsize=(10, 5.6)); ax.set_xlim(-0.05, 1.04); ax.set_ylim(0, 1); ax.axis("off")
    ax.text(0.0, 0.97, "HEARTLAB conceptual model (state level, ecological)", fontsize=12, color=INK, weight="bold")
    ax.text(0.0, 0.925, "Solid: textbook model (§14.3.6)   Dashed: HEARTLAB extensions   "
            "Green: sourced evidence   Amber: assumption", fontsize=8, color=MUTED)
    # policy chain (extension)
    box(ax, 0.00, 0.70, 0.20, 0.12, "Cigarette price", "scenario input  %ΔP", dashed=True)
    box(ax, 0.00, 0.47, 0.20, 0.12, "Cigarette demand", "%ΔQ = −0.4·%ΔP (context)", edge=SOURCE, dashed=True)
    box(ax, 0.00, 0.22, 0.20, 0.14, "Prevalence response", "%ΔS = E_s·%ΔP\nS_new = S·(1 + %ΔS/100)", edge=ASSUME, dashed=True)
    arrow(ax, 0.10, 0.70, 0.10, 0.59, "Bader et al. 2011", SOURCE)
    ax.plot([0.0, -0.025, -0.025], [0.76, 0.76, 0.29], color=ASSUME, lw=1.1, ls="--")
    arrow(ax, -0.025, 0.29, 0.0, 0.29, "", ASSUME)
    ax.text(-0.035, 0.53, "E_s (assumed)", fontsize=7, color=ASSUME, ha="center", rotation=90)
    # predictors
    names = [("X1  Smoking prevalence", 0.76), ("X2  Obesity prevalence", 0.58),
             ("X3  Physical inactivity", 0.40), ("X4  Fruit & vegetables", 0.22)]
    for t, y in names:
        box(ax, 0.30, y, 0.25, 0.10, t)
        arrow(ax, 0.55, y + 0.05, 0.66, 0.50, "")
    arrow(ax, 0.20, 0.30, 0.30, 0.80, "", ASSUME, dashed=True)
    # model + outcome
    box(ax, 0.66, 0.40, 0.17, 0.20, "OLS regression", "Ŷ = β0 + Σ βj·Xj\nα = 0.05 significance", edge=ACCENT)
    box(ax, 0.865, 0.43, 0.165, 0.14, "Y  Heart disease\nrate (state)", "")
    arrow(ax, 0.83, 0.50, 0.865, 0.50)
    box(ax, 0.62, 0.10, 0.41, 0.18, "Extensions", "Monte Carlo over β (and E_s range) · sensitivity grids\n"
        "robust (HC3) SEs · LOOCV validation · reduced model", dashed=True)
    arrow(ax, 0.745, 0.40, 0.745, 0.28, "", MUTED, dashed=True)
    box(ax, 0.30, 0.02, 0.25, 0.12, "CDC state data", "CDCHeartRisk.xls (1998/1999, unresolved)", edge=MUTED)
    arrow(ax, 0.55, 0.08, 0.70, 0.40, "fit", MUTED)
    fig.savefig(OUT / "conceptual_model.png", dpi=200, bbox_inches="tight"); plt.close(fig)


def workflow():
    fig, ax = plt.subplots(figsize=(10, 2.6)); ax.set_xlim(0, 1); ax.set_ylim(0, 1); ax.axis("off")
    steps = [("Ingest", "read .xls, find header,\nmap columns"), ("Clean", "drop totals/labels,\nconvert, flag missing"),
             ("Fit", "OLS full model,\nbackward elimination"), ("Verify", "normal equation, R², F,\nresidual checks"),
             ("Simulate", "scenarios, price policy,\nMonte Carlo"), ("Analyse", "sensitivity, LOOCV,\ndiagnostics"),
             ("Report", "tables, figures,\nweb interface")]
    w = 0.125
    for i, (t, s) in enumerate(steps):
        x = i * (w + 0.018)
        box(ax, x, 0.25, w, 0.5, t, s, edge=ACCENT if t in ("Fit", "Simulate") else INK)
        if i:
            arrow(ax, x - 0.018, 0.5, x, 0.5)
    fig.savefig(OUT / "system_workflow.png", dpi=200, bbox_inches="tight"); plt.close(fig)


if __name__ == "__main__":
    conceptual(); workflow(); print(f"Diagrams written to {OUT}")
