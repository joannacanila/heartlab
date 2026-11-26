"""
HEARTLAB automated tests.

All data used here are SYNTHETIC fixtures (tests/fixtures/synthetic.py) generated from a known
linear model. They test software behaviour only and are not CDC observations.
The real-data tests at the end run only when the configured dataset is present in data/raw/.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests" / "fixtures"))

from synthetic import TRUE_BETA, write_messy_workbook, synthetic_values  # noqa: E402
from src import data_processing as dp  # noqa: E402
from src import model as mdl  # noqa: E402
from src import simulation as sim  # noqa: E402
from src import sensitivity_analysis as sa  # noqa: E402
from src import validation as val  # noqa: E402
from src.engine import HeartLabEngine  # noqa: E402


@pytest.fixture
def messy(tmp_path):
    return write_messy_workbook(tmp_path / "fixture.xlsx")


@pytest.fixture
def engine(messy):
    e = HeartLabEngine()
    assert e.load(messy), e.error
    return e


# ----------------------------------------------------------------------------- ingestion
class TestIngestion:
    def test_header_row_found_below_label_rows(self, messy):
        df, rep = dp.ingest(messy)
        assert rep.header_row_index == 3
        assert rep.metadata_text[0].startswith("SYNTHETIC TEST FIXTURE")

    def test_column_mapping_by_pattern(self, messy):
        _, rep = dp.ingest(messy)
        assert rep.column_mapping["smoking"] == "Smoking (%)"
        assert rep.column_mapping["inactivity"] == "No Leisure-Time Physical Activity (%)"
        assert rep.column_mapping["fruit_veg"] == "Fruit & Vegetable 5+/day (%)"
        assert {m for v, m in rep.mapping_method.items() if v != "state"} == {"pattern"}

    def test_explicit_mapping_overrides_patterns(self, messy):
        mapping = dp.load_mapping()
        mapping["variables"]["smoking"]["header"] = "Smoking (%)"
        _, rep = dp.ingest(messy, mapping)
        assert rep.mapping_method["smoking"] == "explicit"

    def test_missing_configured_header_raises(self, messy):
        mapping = dp.load_mapping()
        mapping["variables"]["obesity"]["header"] = "Does not exist"
        with pytest.raises(dp.DatasetError, match="not in the sheet"):
            dp.ingest(messy, mapping)

    def test_ambiguous_columns_raise(self, tmp_path):
        v = synthetic_values()
        df = pd.DataFrame({"State": v.state, "Heart disease": v.heart_disease, "Smoking": v.smoking,
                           "Smoking (men)": v.smoking, "Obesity": v.obesity, "Inactivity": v.inactivity,
                           "Fruit": v.fruit_veg})
        p = tmp_path / "amb.csv"; df.to_csv(p, index=False)
        with pytest.raises(dp.DatasetError, match="Ambiguous"):
            dp.ingest(p)

    def test_total_and_note_rows_excluded_with_reasons(self, messy):
        df, rep = dp.ingest(messy)
        labels = {r["label"]: r["reason"] for r in rep.excluded_rows}
        assert "Total" in labels and "aggregate" in labels["Total"]
        assert "Source: synthetic fixture" in labels
        assert "Total" not in df.state_name.tolist()
        assert rep.observations == 51 and len(df) == 51

    @pytest.mark.parametrize("label,expected", [
        ("Alabama", "AL"), ("  new york ", "NY"), ("TX", "TX"), ("District of Columbia", "DC"), ("Ohio*", "OH")])
    def test_state_recognition(self, label, expected):
        assert dp.classify_state(label, True, False) == (expected, None)

    @pytest.mark.parametrize("label", ["Total", "United States", "U.S.", "Median", "Average of states", "", "Puerto Rico",
                                       "Note: rates per 100,000"])
    def test_non_states_rejected(self, label):
        code, reason = dp.classify_state(label, True, False)
        assert code is None and reason

    def test_dc_can_be_excluded(self):
        code, reason = dp.classify_state("District of Columbia", False, False)
        assert code is None and "District of Columbia" in reason

    @pytest.mark.parametrize("raw,expected", [(12.5, 12.5), ("12.5", 12.5), ("12.5%", 12.5), ("1,234", 1234.0), (7, 7.0)])
    def test_numeric_conversion(self, raw, expected):
        assert dp.to_number(raw) == (expected, None)

    @pytest.mark.parametrize("raw,issue", [(None, "missing"), ("N/A", "missing"), ("", "missing"), ("abc", "non-numeric"),
                                           (float("nan"), "missing")])
    def test_invalid_numeric(self, raw, issue):
        v, why = dp.to_number(raw)
        assert np.isnan(v) and why == issue

    def test_missing_values_reported_and_listwise_deleted(self, messy):
        df, rep = dp.ingest(messy)
        issues = {(r["state"], r["variable"]): r["issue"] for r in rep.invalid_values}
        assert issues[("AZ", "obesity")] == "missing"
        assert issues[("AR", "inactivity")] == "missing"
        assert issues[("CA", "fruit_veg")] == "non-numeric"
        assert ("AK", "smoking") not in issues          # "xx.x%" text was converted, not dropped
        assert rep.complete_cases == 48
        assert len(dp.analysis_frame(df)) == 48

    def test_synthetic_flag(self, messy):
        _, rep = dp.ingest(messy)
        assert rep.synthetic is True

    def test_csv_input_supported(self, tmp_path):
        p = write_messy_workbook(tmp_path / "f.csv")
        df, rep = dp.ingest(p)
        assert rep.complete_cases == 48

    def test_duplicate_states_rejected(self, tmp_path):
        v = synthetic_values()
        v.loc[1, "state"] = "Alabama"
        v = v.rename(columns={"state": "State", "heart_disease": "Heart", "smoking": "Smoking", "obesity": "Obesity",
                              "inactivity": "Inactivity", "fruit_veg": "Fruit"})
        p = tmp_path / "dup.csv"; v.to_csv(p, index=False)
        with pytest.raises(dp.DatasetError, match="Duplicate"):
            dp.ingest(p)

    def test_missing_file(self, tmp_path):
        with pytest.raises(dp.DatasetError, match="not found"):
            dp.ingest(tmp_path / "nope.xls")

    def test_no_header_row(self, tmp_path):
        p = tmp_path / "bad.csv"
        pd.DataFrame({"a": [1, 2], "b": [3, 4]}).to_csv(p, index=False)
        with pytest.raises(dp.DatasetError, match="header row"):
            dp.ingest(p)


# ----------------------------------------------------------------------------- model
class TestModel:
    def test_recovers_known_coefficients_without_noise(self, tmp_path):
        p = write_messy_workbook(tmp_path / "exact.xlsx", noise=1e-9, with_problems=False, digits=None)
        e = HeartLabEngine(); assert e.load(p)
        params = e.models["full"].params
        for k, v in TRUE_BETA.items():
            assert params[k] == pytest.approx(v, abs=1e-6)

    def test_statsmodels_matches_normal_equation(self, engine):
        m = engine.models["full"]
        np.testing.assert_allclose(mdl.normal_equation(m.data, m.predictors), m.params.values, rtol=1e-9)

    def test_summary_statistics_consistent(self, engine):
        s = mdl.summarize(engine.models["full"])
        assert s["n"] == 48 and s["df_resid"] == 43 and s["df_model"] == 4
        assert 0 <= s["adj_r_squared"] <= s["r_squared"] <= 1
        for c in s["coefficients"]:
            assert c["ci_low"] < c["estimate"] < c["ci_high"]
            assert c["t"] == pytest.approx(c["estimate"] / c["std_error"])
            assert c["significant"] == (c["p_value"] < 0.05)

    def test_significance_matches_generating_model(self, engine):
        # inactivity has a true coefficient of 0 in the fixture; the others are non-zero
        sig = set(mdl.summarize(engine.models["full"])["significant_predictors"])
        assert {"smoking", "obesity", "fruit_veg"} <= sig and "inactivity" not in sig

    def test_backward_elimination_drops_null_predictor(self, engine):
        assert engine.elimination_steps[0]["dropped"] == "inactivity"
        assert engine.models["reduced"].predictors == ["smoking", "obesity", "fruit_veg"]

    def test_diagnostics_present(self, engine):
        d = mdl.diagnostics(engine.models["full"])
        assert set(d["vif"]) == set(dp.PREDICTORS) and all(v >= 1 for v in d["vif"].values())
        assert 0 <= d["breusch_pagan"]["p_value"] <= 1
        assert 0 <= d["jarque_bera"]["p_value"] <= 1
        assert len(d["observations"]) == 48
        assert abs(d["residual_mean"]) < 1e-8

    def test_prediction_intervals_nest(self, engine):
        m = engine.models["full"]
        pr = mdl.prediction(m, engine.baseline("mean"))
        assert pr["pi_low"] < pr["ci_low"] < pr["estimate"] < pr["ci_high"] < pr["pi_high"]

    def test_difference_equals_linear_combination(self, engine):
        m = engine.models["full"]
        b = engine.baseline("mean"); x = dict(b, smoking=b["smoking"] - 2, obesity=b["obesity"] + 1)
        d = mdl.difference(m, b, x)
        assert d["delta"] == pytest.approx(-2 * m.params["smoking"] + m.params["obesity"])
        assert d["delta"] == pytest.approx(m.predict(x) - m.predict(b))
        assert d["ci_low"] < d["delta"] < d["ci_high"]


# ----------------------------------------------------------------------------- verification / validation
class TestVerificationValidation:
    def test_all_verification_checks_pass(self, engine):
        for name, m in engine.models.items():
            assert all(c["passed"] for c in val.verify(m)), name

    def test_loocv_shortcut_equals_bruteforce(self, engine):
        m = engine.models["full"]
        fast = np.array(list(val.loocv(m)["loo_residuals"].values()))
        np.testing.assert_allclose(fast, val.loocv_bruteforce(m), rtol=1e-7, atol=1e-7)

    def test_loocv_error_not_smaller_than_in_sample(self, engine):
        v = val.loocv(engine.models["full"])
        assert v["rmse_loocv"] >= v["rmse_in_sample"]

    def test_sign_check_leaves_fruit_veg_undetermined_without_definition(self, engine):
        rows = {r["variable"]: r for r in val.sign_check(engine.models["full"], None)}
        assert rows["fruit_veg"]["agrees"] is None
        assert rows["smoking"]["agrees"] is True


# ----------------------------------------------------------------------------- policy pathway
class TestPolicy:
    @pytest.mark.parametrize("p,expected", [(5, -2.0), (10, -4.0), (15, -6.0), (20, -8.0), (0, 0.0)])
    def test_demand_response_uses_sourced_elasticity(self, p, expected):
        assert sim.demand_response(p) == pytest.approx(expected)

    def test_prevalence_uses_assumed_not_demand_elasticity(self):
        c = sim.policy_chain(10, 0.0, smoking_base=20)
        assert c["demand_change_pct"] == pytest.approx(-4.0)
        assert c["prevalence_change_pct"] == 0.0 and c["smoking_new"] == 20
        c = sim.policy_chain(10, -0.2, smoking_base=20)
        assert c["prevalence_change_pct"] == pytest.approx(-2.0)
        assert c["smoking_new"] == pytest.approx(19.6)     # relative change: 20 * (1 - 0.02)
        assert c["prevalence_elasticity_status"] == "assumption" and c["demand_elasticity_status"] == "sourced"

    @pytest.mark.parametrize("price,elas", [(-1, 0), (101, 0), (10, 0.1), (10, -1.5), ("x", 0), (float("nan"), 0),
                                            (10, float("inf"))])
    def test_invalid_policy_inputs(self, price, elas):
        with pytest.raises(sim.InputError):
            sim.validate_policy(price, elas)

    def test_policy_boundaries_accepted(self):
        assert sim.validate_policy(0, 0) == (0, 0)
        assert sim.validate_policy(100, -1) == (100, -1)


# ----------------------------------------------------------------------------- scenarios
class TestScenarios:
    def test_baseline_scenario_has_zero_difference(self, engine):
        r = engine.simulate(inputs=engine.baseline("mean"))
        assert r["difference"]["delta"] == pytest.approx(0, abs=1e-10)
        assert r["baseline"]["estimate"] == pytest.approx(r["scenario"]["estimate"])

    def test_single_factor_change(self, engine):
        b = engine.baseline("mean")
        r = engine.simulate(inputs=dict(b, obesity=b["obesity"] + 1))
        assert r["difference"]["delta"] == pytest.approx(engine.models["full"].params["obesity"])
        contrib = {i["variable"]: i["contribution"] for i in r["inputs"]}
        assert contrib["smoking"] == 0 and contrib["obesity"] == pytest.approx(r["difference"]["delta"])

    def test_simultaneous_changes_are_additive(self, engine):
        b = engine.baseline("mean"); p = engine.models["full"].params
        x = dict(b, smoking=b["smoking"] - 3, obesity=b["obesity"] + 2, fruit_veg=b["fruit_veg"] + 4)
        r = engine.simulate(inputs=x)
        assert r["difference"]["delta"] == pytest.approx(-3 * p["smoking"] + 2 * p["obesity"] + 4 * p["fruit_veg"])
        assert sum(i["contribution"] for i in r["inputs"]) == pytest.approx(r["difference"]["delta"])

    def test_price_policy_flows_into_smoking(self, engine):
        b = engine.baseline("mean"); beta = engine.models["full"].params["smoking"]
        r = engine.simulate(inputs=b, price_increase_pct=10, prevalence_elasticity=-0.2)
        assert r["policy"]["smoking_new"] == pytest.approx(b["smoking"] * 0.98)
        assert r["difference"]["delta"] == pytest.approx(beta * (b["smoking"] * 0.98 - b["smoking"]))
        assert r["policy"]["regression_effect"]["delta"] == pytest.approx(r["difference"]["delta"])

    def test_zero_elasticity_gives_no_regression_change(self, engine):
        r = engine.simulate(inputs=engine.baseline("mean"), price_increase_pct=50, prevalence_elasticity=0)
        assert r["difference"]["delta"] == pytest.approx(0, abs=1e-12)

    def test_reduced_model_ignores_dropped_variable(self, engine):
        b = engine.baseline("mean")
        r = engine.simulate(model="reduced", inputs=dict(b, inactivity=b["inactivity"] + 5))
        assert r["difference"]["delta"] == pytest.approx(0, abs=1e-12)
        assert not {i["variable"]: i for i in r["inputs"]}["inactivity"]["in_model"]

    def test_state_baseline(self, engine):
        b = engine.baseline("AL")
        row = engine.data.loc[engine.data.state == "AL"].iloc[0]
        assert b["smoking"] == pytest.approx(row.smoking)
        with pytest.raises(sim.InputError):
            engine.baseline("ZZ")

    def test_reset_returns_to_baseline(self, engine):
        b = engine.baseline("mean")
        engine.simulate(inputs=dict(b, smoking=b["smoking"] + 4))
        r = engine.simulate(inputs=engine.baseline("mean"))   # reset = request the baseline again
        assert r["difference"]["delta"] == pytest.approx(0, abs=1e-10)

    def test_deterministic(self, engine):
        b = engine.baseline("mean"); x = dict(b, smoking=b["smoking"] + 1)
        r1 = engine.simulate(inputs=x, price_increase_pct=10, prevalence_elasticity=-0.1, uncertainty_range=(-0.3, 0))
        r2 = engine.simulate(inputs=x, price_increase_pct=10, prevalence_elasticity=-0.1, uncertainty_range=(-0.3, 0))
        assert r1 == r2

    @pytest.mark.parametrize("var,value", [("smoking", -1), ("obesity", 101), ("fruit_veg", float("nan")), ("smoking", "abc")])
    def test_invalid_inputs_rejected(self, engine, var, value):
        b = engine.baseline("mean")
        with pytest.raises(sim.InputError):
            engine.simulate(inputs=dict(b, **{var: value}))

    def test_extrapolation_warning_and_slider_bounds(self, engine):
        bd = engine.bounds.bounds["smoking"]
        assert bd["slider_min"] <= bd["observed_min"] and bd["slider_max"] >= bd["observed_max"]
        assert bd["slider_min"] >= 0 and bd["slider_max"] <= 100
        b = engine.baseline("mean")
        inside = engine.simulate(inputs=dict(b, smoking=bd["observed_max"]))
        assert inside["warnings"] == []
        outside = engine.simulate(inputs=dict(b, smoking=bd["slider_max"]))
        assert any("extrapolation" in w for w in outside["warnings"])

    def test_monte_carlo_centres_on_analytic_difference(self, engine):
        b = engine.baseline("mean")
        r = engine.simulate(inputs=dict(b, smoking=b["smoking"] - 2))
        mc, d = r["monte_carlo"], r["difference"]
        assert mc["mean"] == pytest.approx(d["delta"], abs=4 * d["std_error"] / np.sqrt(mc["draws"]) + 1e-9)
        assert mc["sd"] == pytest.approx(d["std_error"], rel=0.05)

    def test_state_a_returns_policy_only(self):
        e = HeartLabEngine()
        r = e.simulate(price_increase_pct=10, prevalence_elasticity=-0.2)
        assert r["state"] == "A" and r["regression"] is None
        assert r["policy"]["demand_change_pct"] == pytest.approx(-4) and "smoking_new" not in r["policy"]
        assert e.model_summary() == {"ready": False}


# ----------------------------------------------------------------------------- sensitivity
class TestSensitivity:
    def test_one_at_a_time_structure(self, engine):
        t = sa.one_at_a_time(engine.models["full"], engine.data, engine.baseline("mean"))
        assert set(t.variable) == set(dp.PREDICTORS)
        row = t[(t.variable == "smoking") & (t.step_type == "points") & (t.step == 1)].iloc[0]
        assert row.delta_yhat == pytest.approx(engine.models["full"].params["smoking"])

    def test_tornado_swing(self, engine):
        m = engine.models["full"]
        t = sa.tornado(m, engine.data, engine.baseline("mean"))
        r = t.set_index("variable").loc["obesity"]
        assert r.swing == pytest.approx(2 * abs(m.params["obesity"]) * engine.data.obesity.std(ddof=1))
        assert list(t.swing) == sorted(t.swing, reverse=True)

    def test_policy_grid(self, engine):
        g = sa.policy_grid(engine.models["full"], engine.baseline("mean"))
        assert len(g) == len(sa.PRICE_GRID) * len(sa.ELASTICITY_GRID)
        assert (g[g.prevalence_elasticity == 0].delta_yhat.abs() < 1e-12).all()
        assert (g.prevalence_elasticity_status == "assumption").all()

    def test_policy_table_needs_no_data(self):
        t = sa.policy_table()
        assert list(t.demand_change_pct) == [-2, -4, -6, -8, -10, -20]


# ----------------------------------------------------------------------------- analysis runner
def test_run_analysis_writes_outputs_and_refuses_synthetic_in_results(messy, tmp_path):
    from src import run_analysis
    out = tmp_path / "res"
    assert run_analysis.main([str(messy), "--out", str(out)]) == 0
    for f in ["tables/coefficients_full.csv", "tables/sensitivity_policy_grid.csv", "figures/fig2_coefficients.png",
              "model_summary.json"]:
        assert (out / f).exists(), f
    assert run_analysis.main([str(messy)]) == 3      # synthetic data never written into results/


# ----------------------------------------------------------------------------- real dataset (when present)
real = dp.locate_dataset()


@pytest.mark.skipif(real is None, reason="no dataset in data/raw/")
def test_real_dataset_ingests_and_verifies():
    e = HeartLabEngine()
    assert e.load(real), e.error
    assert not e.report.synthetic
    assert e.report.observations >= 50
    assert all(c["passed"] for c in val.verify(e.models["full"]))


def test_legacy_xls_format(tmp_path):
    """The original file is .xls (BIFF); confirm the xlrd path works on a synthetic .xls."""
    xlwt = pytest.importorskip("xlwt")
    v = synthetic_values()
    wb = xlwt.Workbook(); ws = wb.add_sheet("SYNTHETIC")
    ws.write(0, 0, "SYNTHETIC TEST FIXTURE - NOT CDC DATA")
    for j, h in enumerate(["State", "Heart Disease", "Smoking", "Obesity", "Physical inactivity", "Fruit/veg"]):
        ws.write(2, j, h)
    cols = ["state", "heart_disease", "smoking", "obesity", "inactivity", "fruit_veg"]
    for i, r in v.iterrows():
        for j, c in enumerate(cols):
            ws.write(3 + i, j, r[c] if c == "state" else float(r[c]))
    ws.write(3 + len(v), 0, "Total")
    p = tmp_path / "legacy.xls"; wb.save(str(p))
    df, rep = dp.ingest(p)
    assert rep.observations == 51 and rep.excluded_rows[0]["label"] == "Total"


# ----------------------------------------------------------------------------- real dataset integration
@pytest.fixture(scope="module")
def eng():
    e = HeartLabEngine(); assert e.load(real), e.error; return e


@pytest.mark.skipif(real is None, reason="no dataset in data/raw/")
class TestRealDataset:
    def test_columns_mapped_by_configured_names(self, eng):
        cm = eng.report.column_mapping
        assert cm["heart_disease"] == "coronary_heart_disease_age_adjusted_death_rate_per_100k_age_35_plus"
        assert cm["smoking"] == "current_smoking_percent"
        assert cm["obesity"] == "obesity_percent_bmi_ge_30"
        assert cm["inactivity"] == "no_leisure_exercise_percent"
        assert cm["fruit_veg"] == "less_than_5_fruit_vegetable_servings_percent"

    def test_fifty_states_and_dc_complete(self, eng):
        r = eng.report
        assert r.observations == 51 and r.complete_cases == 51 and r.includes_dc
        assert not r.states_absent and not r.excluded_rows and not r.invalid_values and not r.synthetic

    def test_file_years_are_1998_for_risk_factors_and_outcome(self, eng):
        assert eng.report.file_metadata["risk_factor_year"] == ["1998"]
        assert eng.report.file_metadata["outcome_year"] == ["1998"]

    def test_fit_matches_independent_least_squares(self, eng):
        d = eng.data
        X = np.column_stack([np.ones(len(d))] + [d[p].to_numpy(float) for p in dp.PREDICTORS])
        beta = np.linalg.lstsq(X, d["heart_disease"].to_numpy(float), rcond=None)[0]
        np.testing.assert_allclose(eng.models["full"].params.to_numpy(), beta, rtol=1e-9)

    def test_api_reports_ready_state_b(self, monkeypatch):
        import importlib
        from fastapi.testclient import TestClient
        monkeypatch.setenv("HEARTLAB_DATA", str(real))
        import app.backend.server as server
        server = importlib.reload(server)
        c = TestClient(server.app)
        st = c.get("/api/status").json()
        assert st["ready"] and st["state"] == "B" and st["dataset"]["observations"] == 51
        r = c.post("/api/simulate", json={"price_increase_pct": 10, "prevalence_elasticity": -0.2}).json()
        assert r["policy"]["demand_change_pct"] == pytest.approx(-4.0)
        assert r["policy"]["prevalence_change_pct"] == pytest.approx(-2.0)
        assert r["difference"]["delta"] == pytest.approx(r["policy"]["regression_effect"]["delta"])
