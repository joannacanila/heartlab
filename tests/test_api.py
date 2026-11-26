"""Frontend/backend contract tests (FastAPI TestClient). Uses SYNTHETIC fixtures only."""
from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests" / "fixtures"))
from synthetic import write_messy_workbook  # noqa: E402


def make_client(monkeypatch, data_path=None, empty_raw=None):
    if data_path:
        monkeypatch.setenv("HEARTLAB_DATA", str(data_path))
    else:
        monkeypatch.delenv("HEARTLAB_DATA", raising=False)
    from src import data_processing as dp
    if empty_raw is not None:
        monkeypatch.setattr(dp, "RAW_DIR", empty_raw)
        monkeypatch.setattr(dp, "PROCESSED_DIR", empty_raw / "processed")
    import app.backend.server as server
    server = importlib.reload(server)
    return TestClient(server.app), server


@pytest.fixture
def state_a(monkeypatch, tmp_path):
    raw = tmp_path / "raw"; raw.mkdir()
    client, _ = make_client(monkeypatch, empty_raw=raw)
    return client


@pytest.fixture
def state_b(monkeypatch, tmp_path):
    p = write_messy_workbook(tmp_path / "fixture.xlsx")
    client, _ = make_client(monkeypatch, data_path=p)
    return client


def test_frontend_served(state_a):
    r = state_a.get("/")
    assert r.status_code == 200 and "HEARTLAB" in r.text
    for icon in ("/favicon.ico", "/apple-touch-icon.png", "/static/icons/favicon-32.png", "/static/site.webmanifest"):
        assert state_a.get(icon).status_code == 200, icon
    for asset in ["app.js", "charts.js", "heart.js", "field.js", "styles.css"]:
        assert state_a.get(f"/static/{asset}").status_code == 200


def test_state_a_has_no_regression_numbers(state_a):
    s = state_a.get("/api/status").json()
    assert s["state"] == "A" and not s["ready"] and "dataset" not in s
    assert state_a.get("/api/model").json() == {"ready": False}
    sim = state_a.post("/api/simulate", json={"price_increase_pct": 10, "prevalence_elasticity": -0.2}).json()
    assert sim["state"] == "A" and sim["regression"] is None
    assert sim["policy"]["demand_change_pct"] == pytest.approx(-4)
    sens = state_a.get("/api/sensitivity").json()
    assert set(sens) == {"policy_demand"}
    assert state_a.get("/api/baseline").status_code == 409


def test_state_b_model_and_simulation(state_b):
    s = state_b.get("/api/status").json()
    assert s["state"] == "B" and s["dataset"]["synthetic"] is True
    m = state_b.get("/api/model").json()
    assert m["ready"] and "full" in m["models"] and len(m["states"]) == 48
    base = state_b.get("/api/baseline").json()["inputs"]
    r0 = state_b.post("/api/simulate", json={"inputs": base}).json()
    assert r0["difference"]["delta"] == pytest.approx(0, abs=1e-9)
    changed = dict(base, smoking=base["smoking"] - 2)
    r1 = state_b.post("/api/simulate", json={"inputs": changed}).json()
    beta = next(c["estimate"] for c in m["models"]["full"]["coefficients"] if c["term"] == "smoking")
    assert r1["difference"]["delta"] == pytest.approx(-2 * beta)
    assert r1["scenario"]["estimate"] != r0["scenario"]["estimate"]   # output recalculated from new input


def test_invalid_requests_return_422(state_b):
    base = state_b.get("/api/baseline").json()["inputs"]
    assert state_b.post("/api/simulate", json={"inputs": dict(base, obesity=150)}).status_code == 422
    assert state_b.post("/api/simulate", json={"price_increase_pct": 500}).status_code == 422
    assert state_b.post("/api/simulate", json={"prevalence_elasticity": 0.5, "price_increase_pct": 5}).status_code == 422
    assert state_b.post("/api/simulate", json={"model": "nonexistent"}).status_code == 422
    assert state_b.post("/api/simulate", json={"inputs": {"smoking": "abc"}}).status_code == 422


def test_sensitivity_endpoint(state_b):
    s = state_b.get("/api/sensitivity?model=full&state=mean").json()
    assert {"one_at_a_time", "tornado", "policy_grid", "policy_demand"} <= set(s)


def test_upload_rejects_bad_files_and_never_persists_synthetic(monkeypatch, tmp_path):
    raw = tmp_path / "raw"; raw.mkdir()
    client, server = make_client(monkeypatch, empty_raw=raw)
    assert client.post("/api/dataset", files={"file": ("x.txt", b"hello")}).status_code == 415
    bad = client.post("/api/dataset", files={"file": ("x.csv", b"a,b\n1,2\n")})
    assert bad.status_code == 422 and "header row" in bad.json()["detail"]
    fx = write_messy_workbook(tmp_path / "fixture.xlsx")
    ok = client.post("/api/dataset", files={"file": ("CDCHeartRisk.xlsx", fx.read_bytes())}).json()
    assert ok["loaded"] and ok["synthetic"] and not ok["persisted"]
    assert not any(raw.iterdir())                    # synthetic fixture was not copied into data/raw
    assert client.get("/api/status").json()["state"] == "B"


def test_states_endpoint_returns_observed_data_and_fitted_values(state_b):
    s = state_b.get("/api/states").json()
    m = state_b.get("/api/model").json()["models"]["full"]
    fitted = {o["state"]: o["fitted"] for o in m["diagnostics"]["observations"]}
    observed = {o["state"]: o["observed"] for o in m["diagnostics"]["observations"]}
    for row in s["states"]:
        assert row["fitted_rate"] == pytest.approx(fitted[row["state"]])       # model value, labelled as fitted
        assert row["observed_rate"] == pytest.approx(observed[row["state"]])   # data value, labelled as observed
    for v, q in s["quartiles"].items():
        assert q["p25"] <= q["p50"] <= q["p75"]
        assert s["bounds"][v]["observed_min"] <= q["p25"]


def test_states_endpoint_requires_dataset(state_a):
    assert state_a.get("/api/states").status_code == 409
