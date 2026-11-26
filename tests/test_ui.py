"""Browser end-to-end tests (Playwright, headless Chromium). SYNTHETIC fixture data only.

Skipped automatically if Playwright's Chromium is not installed
(install with: .venv/bin/python -m playwright install chromium).
"""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests" / "fixtures"))
from synthetic import write_messy_workbook  # noqa: E402

sync_api = pytest.importorskip("playwright.sync_api")


def _free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close(); return port


def _serve(env_extra, tmp_path):
    port = _free_port()
    env = {**os.environ, **env_extra}
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.backend.server:app", "--port", str(port)],
                            cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(100):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/status"); break
        except Exception:
            time.sleep(0.1)
    return proc, f"http://127.0.0.1:{port}"


@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as p:
        try:
            b = p.chromium.launch()
        except Exception as exc:  # browser binary not installed
            pytest.skip(f"Chromium unavailable: {exc}")
        yield b
        b.close()


@pytest.fixture
def server_b(tmp_path):
    fx = write_messy_workbook(tmp_path / "fixture.xlsx")
    proc, url = _serve({"HEARTLAB_DATA": str(fx)}, tmp_path)
    yield url
    proc.terminate(); proc.wait()


def _page(browser, url):
    pg = browser.new_page(viewport={"width": 1280, "height": 900})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(url); pg.wait_for_timeout(800)
    return pg, errors


def _estimate(pg):
    return float(pg.inner_text("#hBig"))


def _settle(pg, ms=700):
    pg.wait_for_timeout(ms)


def test_landing_and_navigation(browser, server_b):
    pg, errors = _page(browser, server_b + "/")
    assert pg.is_visible("#landing") and not pg.is_visible("#simulate")
    assert pg.is_visible("#syntheticBanner")             # synthetic data is always flagged
    assert pg.locator("#heroHeart canvas, #heroHeart.no-webgl").count() >= 1
    assert pg.inner_text("#tryEst") not in ("", "–")      # landing preview shows a backend estimate
    pg.click("#enterBtn"); _settle(pg)
    assert pg.is_visible("#simulate") and pg.url.endswith("#/simulate")
    assert pg.get_attribute("#appNav a[data-view=simulate]", "aria-current") == "page"
    assert errors == []


def test_landing_preview_is_backend_estimate_and_carries_over(browser, server_b):
    pg, errors = _page(browser, server_b + "/")
    import json, urllib.request
    pg.eval_on_selector("#t-smoking", "e => { e.value = e.min; e.dispatchEvent(new Event('input')) }"); _settle(pg)
    smoking = float(pg.get_attribute("#t-smoking", "min"))
    inputs = {p: float(pg.input_value(f"#t-{p}")) for p in ("smoking", "obesity", "inactivity", "fruit_veg")}
    req = urllib.request.Request(server_b + "/api/simulate", data=json.dumps({"inputs": inputs}).encode(),
                                 headers={"Content-Type": "application/json"})
    est = json.loads(urllib.request.urlopen(req).read())["scenario"]["estimate"]
    assert float(pg.inner_text("#tryEst")) == pytest.approx(round(est, 1))
    assert "with these values" in pg.inner_text("#enterBtn")
    pg.click("#enterBtn"); _settle(pg, 1000)
    assert float(pg.input_value("#n-smoking")) == pytest.approx(round(smoking, 1))
    assert _estimate(pg) == pytest.approx(round(est, 1))
    assert errors == []


def test_live_update_without_run_button_and_reset(browser, server_b):
    pg, errors = _page(browser, server_b + "/#/simulate")
    assert pg.locator("#runBtn").count() == 0                                # no run button for ordinary changes
    base = _estimate(pg)
    pg.fill("#n-smoking", str(float(pg.input_value("#n-smoking")) - 3)); _settle(pg)
    changed = _estimate(pg)
    assert changed != base and "pts" in pg.inner_text("#d-smoking")
    pg.fill("#n-obesity", str(float(pg.input_value("#n-obesity")) + 2)); _settle(pg)
    assert _estimate(pg) != changed
    assert pg.locator("#whyBars svg").count() == 1
    pg.click("#resetBtn"); _settle(pg)
    assert _estimate(pg) == pytest.approx(base)
    assert pg.input_value("#baselineSelect") == "mean"                     # reset never changes the starting point
    assert errors == []


def test_price_pathway_keeps_demand_separate_and_rejects_invalid(browser, server_b):
    pg, errors = _page(browser, server_b + "/#/simulate")
    pg.fill("#priceNum", "20"); pg.check("#responseSeg input[value=custom]"); pg.fill("#elasNum", "-0.3"); _settle(pg)
    path = pg.inner_text("#pathway")
    assert "−6.0%" in path                       # prevalence: assumed −0.3 × 20%
    assert "8.0%" in path and "does not enter the model" in path    # demand: sourced −0.4, reference only
    pg.check("#responseSeg input[value=small]"); _settle(pg)
    assert "−2.0%" in pg.inner_text("#pathway")
    pg.fill("#priceNum", "150"); _settle(pg, 300)
    assert pg.is_visible("#formError") and "between 0 and 100" in pg.inner_text("#formError")
    assert errors == []


def test_presets_state_baseline_and_compare(browser, server_b):
    pg, errors = _page(browser, server_b + "/#/simulate")
    base = _estimate(pg)
    pg.click("[data-preset=price-20]"); _settle(pg)
    assert pg.get_attribute("[data-preset=price-20]", "aria-pressed") == "true"
    assert pg.input_value("#priceNum") == "20" and _estimate(pg) != base
    pg.click("#pinBtn")
    assert pg.locator("#pins li").count() == 1
    code = pg.eval_on_selector("#profileSelect", "e => e.options[1].value")
    pg.select_option("#profileSelect", code); _settle(pg)
    assert "observed rate" in pg.inner_text("#hFlag")      # observed and modelled rates are labelled separately
    pg.select_option("#baselineSelect", code); _settle(pg)
    assert "Reset to" in pg.inner_text("#resetBtn") and pg.input_value("#priceNum") == "0"
    pg.click("#pins .restore"); _settle(pg)
    assert pg.input_value("#priceNum") == "20" and pg.input_value("#baselineSelect") == "mean"
    assert errors == []


def test_theme_toggle_persists(browser, server_b):
    ctx = browser.new_context(color_scheme="light")
    pg = ctx.new_page(); pg.goto(server_b + "/"); _settle(pg)
    assert pg.evaluate("document.documentElement.dataset.theme || ''") == ""     # follows the OS until chosen
    pg.click("#themeBtn")
    assert pg.evaluate("document.documentElement.dataset.theme") == "dark"
    bg = pg.evaluate("getComputedStyle(document.body).backgroundColor")
    pg.goto(server_b + "/#/model"); pg.reload(); _settle(pg)
    assert pg.evaluate("document.documentElement.dataset.theme") == "dark"
    assert pg.evaluate("getComputedStyle(document.body).backgroundColor") == bg
    ctx.close()


def test_model_and_methods_views(browser, server_b):
    pg, errors = _page(browser, server_b + "/#/model"); _settle(pg)
    body = pg.inner_text("#modelBody")
    for txt in ("Coefficients", "Breusch–Pagan", "Shapiro–Wilk", "Variance inflation", "Leaving each state out", "Influential states", "Backward elimination", "Sensitivity"):
        assert txt.lower() in body.lower(), txt
    assert pg.locator("#tornadoChart svg").count() == 1 and pg.locator("#gridChart svg").count() == 1
    pg.click("#appNav a[data-view=methods]"); _settle(pg)
    assert "Limitations" in pg.inner_text("#methodsBody") and "Bader" in pg.inner_text("#methodsBody")
    assert errors == []


def test_state_a_shows_upload_and_no_fabricated_results(browser, tmp_path):
    proc, url = _serve({"HEARTLAB_DATA": str(tmp_path / "missing.xls")}, tmp_path)
    try:
        pg, errors = _page(browser, url + "/#/simulate")
        assert pg.is_visible("#drop") and "Load the dataset" in pg.inner_text("#simulate")
        assert not pg.is_visible(".sim-grid") and not pg.is_visible(".presets")
        assert pg.inner_text("#hBig") if pg.locator("#hBig").count() else True
        pg.goto(url + "/"); _settle(pg)
        assert pg.inner_text("#tryEst") == "–"                    # no estimate without a fitted model
        assert errors == []
    finally:
        proc.terminate(); proc.wait()


def test_upload_flow_loads_synthetic_file_without_persisting(browser, tmp_path):
    proc, url = _serve({"HEARTLAB_DATA": str(tmp_path / "missing.xls")}, tmp_path)
    try:
        pg, errors = _page(browser, url + "/#/simulate")
        bad = tmp_path / "notes.txt"; bad.write_text("not a dataset")
        pg.set_input_files("#fileInput", str(bad)); _settle(pg, 600)
        assert "Unsupported file type" in pg.inner_text("#uploadMsg")
        fx = write_messy_workbook(tmp_path / "fixture.xlsx")
        pg.set_input_files("#fileInput", str(fx)); _settle(pg, 400)
        assert "fixture.xlsx" in pg.inner_text("#fileRow")
        _settle(pg, 2500)
        assert pg.is_visible("#syntheticBanner") and pg.is_visible("#hBig")
        assert not (ROOT / "data" / "raw" / "uploaded_dataset.xlsx").exists()
        assert errors == []
    finally:
        proc.terminate(); proc.wait()


@pytest.mark.parametrize("w,h", [(1440, 900), (1280, 720), (1024, 768), (768, 1024), (390, 844), (375, 667)])
def test_no_horizontal_overflow_any_view(browser, server_b, w, h):
    pg = browser.new_page(viewport={"width": w, "height": h})
    errors = []; pg.on("pageerror", lambda e: errors.append(str(e)))
    for path in ("/", "/#/simulate", "/#/model", "/#/methods"):
        pg.goto(server_b + path); _settle(pg, 900)
        assert pg.evaluate("document.documentElement.scrollWidth") <= w, path
    if w >= 1024:
        pg.goto(server_b + "/"); _settle(pg)
        assert pg.evaluate("document.documentElement.scrollHeight") <= h + 40   # landing is one screen (synthetic banner aside)
    assert errors == []


def test_keyboard_and_labels(browser, server_b):
    pg, errors = _page(browser, server_b + "/#/simulate")
    unlabeled = pg.evaluate("""[...document.querySelectorAll('#simulate input, #simulate select')]
        .filter(e => e.type !== 'hidden' && !e.labels?.length && !e.getAttribute('aria-label')).map(e => e.id)""")
    assert unlabeled == []
    pg.click("#r-smoking"); before = _estimate(pg)
    pg.focus("#r-smoking"); pg.keyboard.press("Home"); _settle(pg)
    assert _estimate(pg) != before                                  # sliders work from the keyboard
    pg.click(".tip >> nth=0")
    assert pg.get_attribute(".tip >> nth=0", "aria-expanded") == "true" and pg.is_visible("#tip-smoking")
    assert errors == []


REAL = ROOT / "data" / "raw" / "HEARTLAB_1998_CDC_CHD_dataset.csv"


@pytest.mark.skipif(not REAL.exists(), reason="real dataset not in data/raw/")
def test_real_dataset_end_to_end(browser, tmp_path):
    proc, url = _serve({"HEARTLAB_DATA": str(REAL)}, tmp_path)
    try:
        pg, errors = _page(browser, url + "/#/simulate"); _settle(pg)
        assert not pg.is_visible("#syntheticBanner")
        import json, urllib.request
        base = json.loads(urllib.request.urlopen(urllib.request.Request(url + "/api/simulate", data=b"{}",
                          headers={"Content-Type": "application/json"})).read())["baseline"]["estimate"]
        assert _estimate(pg) == pytest.approx(round(base, 1))           # UI shows the backend's number
        pg.fill("#priceNum", "20"); pg.check("#responseSeg input[value=custom]"); pg.fill("#elasNum", "-0.2"); _settle(pg, 900)
        assert "−4.0%" in pg.inner_text("#pathway") and _estimate(pg) < round(base, 1)
        pg.fill("#n-fruit_veg", "70"); _settle(pg)
        assert "Why does lowering low fruit" in pg.inner_text("#hFlag")   # unexpected sign is explained, not hidden
        assert errors == []
    finally:
        proc.terminate(); proc.wait()
