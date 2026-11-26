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
    for _ in range(300):                       # up to 30 s: startup is slow when the machine is busy
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/status"); break
        except Exception:
            time.sleep(0.1)
    else:
        proc.terminate()
        raise RuntimeError("HEARTLAB test server did not start within 30 s")
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


def _until(pg, js, arg=None, timeout=8000):
    """Wait for a condition in the page instead of sleeping a fixed time (software WebGL can stall timers)."""
    pg.wait_for_function(js, arg=arg, timeout=timeout)


def _slide(pg, sel, value):
    """Set a slider the way a drag does: change its value and fire input."""
    pg.eval_on_selector(sel, "(e, v) => { e.value = v; e.dispatchEvent(new Event('input')) }", str(value))


def _api(url, path, body=None):
    import json
    req = urllib.request.Request(url + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req).read())


def test_landing_is_an_introduction_not_a_simulator(browser, server_b):
    pg, errors = _page(browser, server_b + "/")
    assert pg.is_visible("#landing") and not pg.is_visible("#simulate")
    assert pg.is_visible("#syntheticBanner")                         # synthetic data is always flagged
    assert pg.locator("#heroHeart canvas, #heroHeart.no-webgl").count() >= 1
    assert pg.locator("#landing input, #landing select, #landing output").count() == 0   # no simulation controls
    assert "Explore the simulator" in pg.inner_text("#enterBtn")
    assert pg.locator("#landing a, #landing button:not(#discBtn)").count() == 1          # one call to action
    assert pg.inner_text("#lHead").replace("\n", "") == "HEARTLAB"
    assert "personal risk calculator" not in pg.inner_text("#landing")                 # the old sentence is gone
    assert pg.evaluate("document.documentElement.scrollHeight <= innerHeight")         # fits one viewport
    assert pg.is_visible("#appNav")
    pg.click("#enterBtn"); _settle(pg)
    assert pg.is_visible("#simulate") and pg.url.endswith("#/simulate")
    assert pg.get_attribute("#appNav a[data-view=simulate]", "aria-current") == "page"
    pg.click("#appNav a[data-view=model]"); _settle(pg)
    assert pg.is_visible("#model")
    pg.click(".brand"); _settle(pg)
    assert pg.is_visible("#landing")
    assert errors == []


def test_landing_disclaimer_opens_on_hover_click_and_keyboard(browser, server_b):
    pg, errors = _page(browser, server_b + "/")
    assert not pg.is_visible("#discPop")
    pg.hover("#discBtn"); pg.wait_for_selector("#discPop", state="visible", timeout=8000)
    assert pg.get_attribute("#discBtn", "aria-expanded") == "true"
    txt = pg.inner_text("#discPop")
    for phrase in ("educational modeling tool", "multiple linear regression", "not an individual’s medical risk",
                   "do not establish causation", "not intended for medical diagnosis"):
        assert phrase in txt, phrase
    pg.mouse.move(5, 600); _until(pg, "() => discBtn.getAttribute('aria-expanded') === 'false' && !disc.classList.contains('open')")   # hover preview closes
    pg.click("#discBtn"); pg.mouse.move(5, 600); _settle(pg, 900)
    assert pg.get_attribute("#discBtn", "aria-expanded") == "true"               # a click pins it open
    pg.keyboard.press("Escape"); _until(pg, "() => discBtn.getAttribute('aria-expanded') === 'false' && !disc.classList.contains('open')")
    pg.focus("#enterBtn"); pg.keyboard.press("Shift+Tab")                         # keyboard focus previews it
    pg.wait_for_selector("#discPop", state="visible", timeout=8000)
    assert pg.evaluate("document.activeElement.id") == "discBtn"
    assert errors == []


def test_typed_values_sync_with_sliders_and_validate(browser, server_b):
    pg, errors = _page(browser, server_b + "/#/simulate"); _settle(pg)
    b = _api(server_b, "/api/states")["bounds"]["smoking"]
    base = _estimate(pg)
    target = round((b["slider_min"] + b["slider_max"]) / 2 + 1.3, 1)
    pg.fill("#v-smoking", str(target)); pg.keyboard.press("Enter"); _settle(pg)
    assert float(pg.input_value("#r-smoking")) == pytest.approx(target, abs=0.051)   # slider follows the typed value
    body = _api(server_b, "/api/simulate", {"inputs": {"smoking": target}})
    want = f'{round(body["scenario"]["estimate"], 1):.1f}'
    _until(pg, "w => document.getElementById('hBig').textContent === w", want)
    _slide(pg, "#r-smoking", round(b["slider_min"] + 1, 1)); _settle(pg)
    assert pg.input_value("#v-smoking") == f"{round(b['slider_min'] + 1, 1):.1f}"    # and the number follows the slider
    now = _estimate(pg)
    pg.fill("#v-smoking", "abc"); pg.keyboard.press("Enter"); _settle(pg)
    assert "not a number" in pg.inner_text("#m-smoking") and _estimate(pg) == now
    assert pg.get_attribute("#v-smoking", "aria-invalid") == "true"
    pg.fill("#v-smoking", str(b["slider_max"] + 20)); pg.keyboard.press("Enter"); _settle(pg)
    assert "Type a value from" in pg.inner_text("#m-smoking") and _estimate(pg) == now   # refused, not clamped
    pg.fill("#v-obesity", "1"); pg.keyboard.press("Escape"); _settle(pg)
    assert pg.input_value("#v-obesity") != "1" and _estimate(pg) == now               # Escape cancels the edit
    pg.fill("#v-obesity", "18,5%"); pg.keyboard.press("Tab")                            # blur commits; comma and % accepted
    _until(pg, "n => parseFloat(document.getElementById('hBig').textContent) !== n", now)
    assert float(pg.input_value("#r-obesity")) == pytest.approx(18.5, abs=0.051)
    pg.click("#resetBtn")
    _until(pg, "b => parseFloat(document.getElementById('hBig').textContent) === b", base)
    assert errors == []


def test_live_update_contribution_and_reset(browser, server_b):
    pg, errors = _page(browser, server_b + "/#/simulate"); _settle(pg)
    assert pg.locator("#runBtn").count() == 0                                # no run button: updates are live
    assert pg.locator("#simulate select").count() == 1                       # one starting-point selector
    assert pg.locator("#simulate input[type=number]:not(#elasNum)").count() == 0
    base = _estimate(pg)
    assert pg.is_disabled("#resetBtn")
    sm = float(pg.input_value("#r-smoking"))
    _slide(pg, "#r-smoking", sm - 3); _settle(pg)
    body = _api(server_b, "/api/simulate", {"inputs": {"smoking": sm - 3}})
    assert _estimate(pg) == pytest.approx(round(body["scenario"]["estimate"], 1))   # the number is the backend's
    assert "pts" in pg.inner_text("#d-smoking") and pg.inner_text("#d-obesity") == ""
    assert "lower" in pg.inner_text("#hPlain") or "higher" in pg.inner_text("#hPlain")
    assert pg.locator("#whyBars svg").count() == 1
    assert "unchanged" in pg.eval_on_selector("#whyBars", "e => e.textContent")     # untouched factors show no contribution
    assert "lives saved" not in pg.inner_text("body").lower()
    pg.click("#resetBtn"); _settle(pg)
    assert _estimate(pg) == base and pg.input_value("#baselineSelect") == "mean"
    assert pg.locator("#whyBars").count() == 0                                 # nothing changed, nothing to attribute
    assert errors == []


def test_presets_and_state_baseline(browser, server_b):
    pg, errors = _page(browser, server_b + "/#/simulate"); _settle(pg)
    assert pg.locator(".preset").count() == 2 and pg.is_visible("#resetBtn")  # two presets plus Reset
    base = _estimate(pg)
    pg.click(".preset[data-preset=habits]"); _settle(pg)
    assert pg.get_attribute(".preset[data-preset=habits]", "aria-pressed") == "true"
    assert _estimate(pg) != base and "pts" in pg.inner_text("#d-smoking")    # the change shows on the sliders
    code = pg.eval_on_selector("#baselineSelect", "e => e.options[1].value")
    pg.select_option("#baselineSelect", code); _settle(pg)
    fitted = _api(server_b, "/api/simulate", {"baseline_state": code})["baseline"]["estimate"]
    assert _estimate(pg) == pytest.approx(round(fitted, 1))
    assert "observed rate" in pg.inner_text("#hPlain")                       # observed and modelled rates are labelled apart
    b = _api(server_b, f"/api/baseline?state={code}")["inputs"]
    assert pg.input_value("#v-obesity") == f"{b['obesity']:.1f}"           # baseline values follow the starting point
    assert errors == []


def test_extrapolation_is_flagged_and_not_clamped(browser, server_b):
    pg, errors = _page(browser, server_b + "/#/simulate"); _settle(pg)
    for v in ("smoking", "obesity", "inactivity"):
        pg.eval_on_selector(f"#r-{v}", "e => { e.value = e.max; e.dispatchEvent(new Event('input')) }")
    _settle(pg, 900)
    est = _estimate(pg)
    hi = max(s["observed_rate"] for s in _api(server_b, "/api/states")["states"])
    assert "Outside the range seen in the historical state data" in pg.inner_text("#m-smoking")
    if est > hi:
        txt = pg.eval_on_selector("#rangeSvg", "e => e.textContent")
        assert "outside" in txt and f"{est:.1f}" in txt
    assert errors == []


def test_price_policy_is_collapsed_and_keeps_demand_separate(browser, server_b):
    pg, errors = _page(browser, server_b + "/#/simulate"); _settle(pg)
    assert not pg.is_visible("#priceRange")                                  # collapsed by default
    base = _estimate(pg)
    pg.click("#policyBox summary")
    _slide(pg, "#priceRange", 20); pg.check("#responseSeg input[value=custom]"); pg.fill("#elasNum", "-0.3"); _settle(pg)
    path = pg.inner_text("#pathway")
    assert "−6.0%" in path and "8.0%" in path and "not used in the model" in path
    assert _estimate(pg) != base
    pg.check("#responseSeg input[value=small]"); _settle(pg)
    assert "−2.0%" in pg.inner_text("#pathway")
    pg.click("#policyBox summary"); _settle(pg)                              # closing removes the price rise
    assert _estimate(pg) == base
    assert errors == []


def test_theme_toggle_persists(browser, server_b):
    ctx = browser.new_context(color_scheme="light")
    pg = ctx.new_page(); pg.goto(server_b + "/#/simulate"); _settle(pg)
    assert pg.evaluate("document.documentElement.dataset.theme || ''") == ""     # follows the OS until chosen
    pg.click("#themeBtn")
    assert pg.evaluate("document.documentElement.dataset.theme") == "dark"
    bg = pg.evaluate("getComputedStyle(document.body).backgroundColor")
    pg.goto(server_b + "/#/model"); pg.reload(); _settle(pg)
    assert pg.evaluate("document.documentElement.dataset.theme") == "dark"
    assert pg.evaluate("getComputedStyle(document.body).backgroundColor") == bg
    ctx.close()


def test_model_and_methods_views(browser, server_b):
    pg, errors = _page(browser, server_b + "/#/simulate"); _settle(pg)
    pg.click(".preset[data-preset=smoke-low]"); _settle(pg)
    pg.click("#advBox summary"); _settle(pg)
    adv = pg.inner_text("#advBody")
    assert "Adjusted R²" in adv and "p (HC3)" in adv and "prediction interval" in adv   # statistics stay one click away
    pg.click(".out-more a"); _settle(pg, 1200)
    body = pg.inner_text("#modelBody")
    for txt in ("Coefficients", "Breusch–Pagan", "Shapiro–Wilk", "Variance inflation", "Leaving each state out", "Influential states",
                "Backward elimination", "Sensitivity", "prediction interval", "Monte Carlo"):
        assert txt.lower() in body.lower(), txt
    assert pg.locator("#mcSvg svg").count() == 1
    assert pg.locator("#tornadoChart svg").count() == 1 and pg.locator("#gridChart svg").count() == 1
    pg.click("#appNav a[data-view=methods]"); _settle(pg)
    mb = pg.inner_text("#methodsBody")
    assert "Limitations" in mb and "Bader" in mb
    heads = pg.eval_on_selector_all("#x-data table th", "els => els.map(e => e.textContent)")
    assert heads == ["Variable", "Unit", "Definition"]                                    # source-column column removed
    assert "Reconstructed dataset." not in mb and "complete," not in mb                   # dataset paragraphs removed
    assert errors == []


def test_state_a_shows_upload_and_no_fabricated_results(browser, tmp_path):
    proc, url = _serve({"HEARTLAB_DATA": str(tmp_path / "missing.xls")}, tmp_path)
    try:
        pg, errors = _page(browser, url + "/#/simulate")
        assert pg.is_visible("#drop") and "Load the dataset" in pg.inner_text("#simulate")
        assert not pg.is_visible(".sim-grid") and pg.locator("#hBig").count() == 0
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
        pg.goto(server_b + path); pg.reload(); _settle(pg, 900)
        assert pg.evaluate("document.documentElement.scrollWidth") <= w, path
    pg.goto(server_b + "/#/simulate"); pg.reload(); _settle(pg)
    pg.click("#policyBox summary"); _slide(pg, "#priceRange", 30); _settle(pg)
    assert pg.evaluate("document.documentElement.scrollWidth") <= w
    assert errors == []


def test_keyboard_and_labels(browser, server_b):
    pg, errors = _page(browser, server_b + "/#/simulate"); _settle(pg)
    pg.click("#policyBox summary")
    unlabeled = pg.evaluate("""[...document.querySelectorAll('#simulate input, #simulate select')]
        .filter(e => e.type !== 'hidden' && !e.labels?.length && !e.getAttribute('aria-label')).map(e => e.id)""")
    assert unlabeled == []
    before = _estimate(pg)
    pg.focus("#r-smoking"); pg.keyboard.press("Home"); _settle(pg)
    assert _estimate(pg) != before                                  # sliders work from the keyboard
    assert "percent" in pg.get_attribute("#r-smoking", "aria-valuetext")
    assert pg.evaluate("getComputedStyle(document.getElementById('m-smoking')).opacity") == "1"   # details appear on focus
    assert errors == []


REAL = ROOT / "data" / "raw" / "HEARTLAB_1998_CDC_CHD_dataset.csv"


@pytest.mark.skipif(not REAL.exists(), reason="real dataset not in data/raw/")
def test_real_dataset_end_to_end(browser, tmp_path):
    proc, url = _serve({"HEARTLAB_DATA": str(REAL)}, tmp_path)
    try:
        pg, errors = _page(browser, url + "/#/simulate"); _settle(pg)
        assert not pg.is_visible("#syntheticBanner")
        base = _api(url, "/api/simulate", {})["baseline"]["estimate"]
        assert _estimate(pg) == pytest.approx(round(base, 1))           # UI shows the backend's number
        pg.click("#policyBox summary")
        _slide(pg, "#priceRange", 20); pg.check("#responseSeg input[value=custom]"); pg.fill("#elasNum", "-0.2"); _settle(pg, 900)
        assert "−4.0%" in pg.inner_text("#pathway") and _estimate(pg) < round(base, 1)
        _slide(pg, "#r-fruit_veg", 70); _settle(pg)
        assert "Why does lowering low fruit" in pg.inner_text("#hFlag")   # unexpected sign is explained, not hidden
        assert errors == []
    finally:
        proc.terminate(); proc.wait()
