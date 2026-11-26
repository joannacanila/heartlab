"""
HEARTLAB engine: one object that owns the dataset state and the fitted models.

State A (awaiting dataset): only the specification and policy components A/B are available.
State B (dataset loaded):   ingestion report, full + reduced OLS fits, diagnostics,
                            verification, validation, scenarios and sensitivity analysis.
Used by both the web backend and the command-line analysis runner.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from . import data_processing as dp
from . import model as mdl
from . import simulation as sim
from . import sensitivity_analysis as sa
from . import validation as val

SPECIFICATION = {
    "title": "Empirical Model of Heart Disease Risk Factors",
    "source": "Gordon & Guilfoos (2017), Introduction to Modeling and Simulation with MATLAB and Python, "
              "Chapter 14, Section 14.3.6",
    "equation": "Y_i = β0 + β1·X1_i + β2·X2_i + β3·X3_i + β4·X4_i + ε_i",
    "method": "Multiple linear regression, ordinary least squares",
    "unit_of_analysis": "U.S. state (ecological, population-level)",
    "alpha": mdl.ALPHA,
}


def records(df) -> list[dict[str, Any]]:
    """DataFrame -> JSON-safe records (NaN becomes None)."""
    return df.astype(object).where(df.notna(), None).to_dict("records")


class HeartLabEngine:
    def __init__(self, mapping_path: Path | str | None = None):
        self.mapping_path = mapping_path
        self.mapping = dp.load_mapping(mapping_path)
        self.reset()

    def reset(self):
        self.dataset_path: Path | None = None
        self.clean = None
        self.data = None
        self.report: dp.IngestionReport | None = None
        self.error: dict[str, Any] | None = None
        self.models: dict[str, mdl.FittedModel] = {}
        self.elimination_steps: list[dict[str, Any]] = []
        self.bounds: sim.InputBounds | None = None

    # ------------------------------------------------------------------ state
    @property
    def ready(self) -> bool:
        return bool(self.models)

    def load(self, path: Path | str) -> bool:
        self.reset()
        self.mapping = dp.load_mapping(self.mapping_path)
        self.dataset_path = Path(path)
        try:
            self.clean, self.report = dp.ingest(path, self.mapping)
        except dp.DatasetError as exc:
            self.error = {"message": str(exc), "report": exc.report.to_dict() if exc.report else None}
            return False
        self.data = dp.analysis_frame(self.clean)
        self.models["full"] = mdl.fit_ols(self.data, dp.PREDICTORS, name="full")
        reduced, steps = mdl.backward_elimination(self.data)
        self.elimination_steps = steps
        if reduced.predictors and reduced.predictors != dp.PREDICTORS:
            self.models["reduced"] = reduced
        self.bounds = sim.InputBounds(self.data)
        return True

    def load_default(self) -> bool:
        path = dp.locate_dataset()
        return self.load(path) if path else False

    def variables(self) -> dict[str, Any]:
        return {k: {kk: v.get(kk) for kk in ("role", "symbol", "label", "short", "unit", "definition", "header", "expected_sign")}
                for k, v in self.mapping["variables"].items()}

    def status(self) -> dict[str, Any]:
        out = {"state": "B" if self.ready else "A", "ready": self.ready, "specification": SPECIFICATION,
               "variables": self.variables(), "source": self.mapping.get("source"),
               "demand_elasticity": sim.DEMAND_ELASTICITY, "demand_elasticity_source": sim.DEMAND_ELASTICITY_SOURCE,
               "error": self.error}
        if self.report:
            r = self.report
            out["dataset"] = {"file": r.source_file, "observations": r.observations,
                              "complete_cases": r.complete_cases, "excluded_rows": r.excluded_rows,
                              "invalid_values": r.invalid_values, "warnings": r.warnings,
                              "includes_dc": r.includes_dc, "states_absent": r.states_absent,
                              "column_mapping": r.column_mapping, "sheet": r.sheet_used,
                              "metadata_text": r.metadata_text, "synthetic": r.synthetic,
                              "value_scale": r.value_scale, "file_metadata": r.file_metadata,
                              "mapping_method": r.mapping_method}
        return out

    # ------------------------------------------------------------------ model
    def _model(self, name: str) -> mdl.FittedModel:
        if not self.ready:
            raise sim.InputError("The original dataset is not loaded; regression estimates are unavailable.")
        if name not in self.models:
            raise sim.InputError(f"unknown model '{name}'; available: {list(self.models)}")
        return self.models[name]

    def model_summary(self) -> dict[str, Any]:
        if not self.ready:
            return {"ready": False}
        out = {"ready": True, "models": {}, "elimination_steps": self.elimination_steps,
               "bounds": self.bounds.bounds,
               "states": self.data[["state", "state_name"]].to_dict("records"),
               "descriptive": records(dp.describe(self.clean).reset_index(names="variable"))}
        for name, m in self.models.items():
            out["models"][name] = {**mdl.summarize(m), "diagnostics": mdl.diagnostics(m),
                                   "verification": val.verify(m), "validation": val.loocv(m),
                                   "sign_check": val.sign_check(m, self.mapping)}
            out["models"][name]["validation"].pop("loo_residuals", None)
        return out

    def states(self) -> list[dict[str, Any]]:
        """Observed per-jurisdiction values (data, not estimates) plus the full model's fitted value."""
        if not self.ready:
            return []
        fitted = self.models["full"].result.fittedvalues.to_numpy()
        cols = ["state", "state_name", *dp.PREDICTORS, dp.DEPENDENT]
        rows = records(self.data[cols])
        for r, f in zip(rows, fitted):
            r["observed_rate"] = r.pop(dp.DEPENDENT)
            r["fitted_rate"] = float(f)
        return rows

    def baseline(self, state: str | None = None) -> dict[str, float]:
        if not self.ready:
            raise sim.InputError("dataset not loaded")
        return sim.baseline_inputs(self.data, dp.PREDICTORS, state)

    def simulate(self, model: str = "full", baseline_state: str | None = "mean", inputs: dict | None = None,
                 price_increase_pct: float = 0.0, prevalence_elasticity: float = 0.0,
                 uncertainty_range: tuple[float, float] | None = None) -> dict[str, Any]:
        if not self.ready:
            return {"state": "A", "policy": sim.policy_chain(price_increase_pct, prevalence_elasticity),
                    "regression": None,
                    "message": "Regression estimates require a loaded dataset."}
        m = self._model(model)
        base = self.baseline(baseline_state)
        inputs = dict(base, **(inputs or {}))
        policy = {"price_increase_pct": price_increase_pct, "prevalence_elasticity": prevalence_elasticity}
        sim.validate_policy(price_increase_pct, prevalence_elasticity)
        result = sim.run_scenario(m, self.bounds, base, inputs, policy)
        pre_policy, _ = self.bounds.validate(inputs)
        if uncertainty_range and price_increase_pct > 0:
            for e in uncertainty_range:
                sim.validate_policy(price_increase_pct, e)
            mc = sim.monte_carlo(m, base, pre_policy, price_increase_pct, tuple(uncertainty_range))
        else:
            post = {r["variable"]: r["scenario"] for r in result["inputs"]}
            mc = sim.monte_carlo(m, base, post)
        result["monte_carlo"] = mc
        result["state"] = "B"
        result["baseline_state"] = baseline_state or "mean"
        return result

    def sensitivity(self, model: str = "full", baseline_state: str | None = "mean") -> dict[str, Any]:
        out = {"policy_demand": records(sa.policy_table())}
        if not self.ready:
            return out
        m = self._model(model)
        base = self.baseline(baseline_state)
        out.update({"one_at_a_time": records(sa.one_at_a_time(m, self.data, base)),
                    "tornado": records(sa.tornado(m, self.data, base)),
                    "policy_grid": records(sa.policy_grid(m, base))})
        return out
