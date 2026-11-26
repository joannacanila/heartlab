/* Heartlab interface logic. Every estimate, interval and statistic shown comes from the Python backend (/api/*).
   The browser only sends inputs, then lays out what comes back. */
(function () {
  const $ = (id) => document.getElementById(id);
  const { fmt, signed } = window.Charts;
  const PREDICTORS = ["smoking", "obesity", "inactivity", "fruit_veg"];
  const NAMES = { smoking: "Smoking", obesity: "Obesity", inactivity: "Physical inactivity", fruit_veg: "Low fruit & veg intake" };
  const LONG = { smoking: "Smoking prevalence", obesity: "Obesity prevalence", inactivity: "Physical inactivity", fruit_veg: "Low fruit & vegetable intake" };
  const RESPONSES = [
    { k: "none", e: 0, label: "None" },
    { k: "small", e: -0.10, label: "Small" },
    { k: "moderate", e: -0.25, label: "Moderate" },
    { k: "strong", e: -0.40, label: "Strong" },
    { k: "custom", e: null, label: "Custom" },
  ];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const S = {
    status: null, model: null, data: null, sens: null, modelName: "full",
    baselineState: "mean", baseline: null, inputs: {}, price: 0, response: "moderate", elas: -0.25, varyE: false,
    last: null, pins: [], preset: null, lastWhy: null, gotoAfter: null,
    tryInputs: {}, tryBase: null, tryLevel: null,
  };

  async function api(path, opts = {}) {
    const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.detail || `Request failed (${res.status})`), { body, status: res.status });
    return body;
  }
  const simulate = (body, signal) => api("/api/simulate", { method: "POST", body: JSON.stringify(body), signal });

  const V = (k) => S.status?.variables?.[k] || {};
  const yUnit = () => V("heart_disease").unit || "deaths per 100,000";
  const pfmt = (p) => (p == null ? "–" : p < 0.001 ? "< 0.001" : p.toFixed(3));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const stateRow = (code) => S.data?.states.find((s) => s.state === code);
  const stateName = (code) => stateRow(code)?.state_name || code;
  const nJur = () => S.data?.states.length || S.model?.models?.full?.n || 0;
  const startName = () => (S.baselineState === "mean" ? `the average of ${nJur()} jurisdictions` : stateName(S.baselineState));
  const pts = (x, d = 1) => `${signed(x, d)} pts`;
  const fullModel = () => S.model.models[S.modelName];
  const signIssue = (v) => (fullModel().sign_check || []).find((s) => s.variable === v && s.agrees === false);

  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  /* ---------------------------------------------------------------- theme */
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const currentTheme = () => document.documentElement.dataset.theme || (darkQuery.matches ? "dark" : "light");
  function paintThemeButton() {
    const next = currentTheme() === "dark" ? "light" : "dark";
    $("themeBtn").setAttribute("aria-label", `Switch to ${next} theme`);
    $("themeBtn").querySelector(".theme-label").textContent = next === "dark" ? "Dark" : "Light";
  }
  function toggleTheme() {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("heartlab-theme", next); } catch (e) { /* storage unavailable: theme still applies for this visit */ }
    paintThemeButton();
  }
  darkQuery.addEventListener("change", paintThemeButton);

  /* ---------------------------------------------------------------- routing */
  const VIEWS = ["landing", "simulate", "model", "methods"];
  let heart = null;
  function viewFromHash() {
    const h = location.hash.replace(/^#\/?/, "").split(/[/?#]/)[0];
    return VIEWS.includes(h) && h !== "landing" ? h : "landing";
  }
  function route() {
    const view = viewFromHash();
    const swap = () => {
      VIEWS.forEach((v) => { $(v).hidden = v !== view; });
      document.body.classList.toggle("in-app", view !== "landing");
      $("appNav").hidden = view === "landing";
      document.querySelectorAll("#appNav a").forEach((a) => { if (a.dataset.view === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
      document.title = { landing: "Heartlab", simulate: "Simulate · Heartlab", model: "Model evidence · Heartlab", methods: "Methods & data · Heartlab" }[view];
      window.scrollTo(0, 0);
      if (view === "landing") {
        if (!heart) heart = window.HeartSpecimen.mount($("heroHeart"), { area: $("landing") });
        else heart.wake();
        if (S.tryLevel != null) heart?.setLevel(S.tryLevel);
      }
      if (view === "simulate") enterSimulate();
      if (view === "model") renderModelView();
      if (view === "methods") renderMethodsView();
    };
    const prev = VIEWS.find((v) => !$(v).hidden);
    if (prev && prev !== view && document.startViewTransition && !reduceMotion.matches) document.startViewTransition(swap);
    else swap();
  }

  /* ---------------------------------------------------------------- landing preview */
  function buildTry() {
    if (!S.status.ready) {
      $("tryRows").innerHTML = "";
      document.querySelector(".try-note").textContent = "No dataset is loaded yet, so there is no fitted model to try.";
      $("tryEst").textContent = "–"; $("enterText").textContent = "Open the simulator to load a dataset";
      $("stageScale").hidden = true;
      return;
    }
    const b = S.data.bounds;
    $("tryRows").innerHTML = PREDICTORS.map((p) => `
      <div class="try-row">
        <label for="t-${p}">${esc(NAMES[p])}</label>
        <input type="range" id="t-${p}" min="${b[p].observed_min}" max="${b[p].observed_max}" step="0.1" value="${S.tryBase[p]}">
        <output id="to-${p}" for="t-${p}">${fmt(S.tryBase[p], 1)}%</output>
      </div>`).join("");
    PREDICTORS.forEach((p) => {
      const r = $(`t-${p}`); paint(r);
      r.addEventListener("input", () => {
        S.tryInputs[p] = +r.value; $(`to-${p}`).textContent = `${fmt(+r.value, 1)}%`; paint(r);
        const moved = PREDICTORS.some((q) => Math.abs(S.tryInputs[q] - S.tryBase[q]) > 1e-9);
        $("enterText").textContent = moved ? "Open the simulator with these values" : "Open the simulator";
        tryRun();
      });
    });
    const rates = S.data.states.map((s) => s.observed_rate);
    S.rateLo = Math.min(...rates); S.rateHi = Math.max(...rates);
    $("scaleLo").textContent = `Lowest state ${fmt(S.rateLo, 0)}`;
    $("scaleHi").textContent = `${fmt(S.rateHi, 0)} highest`;
    tryRunNow();
  }
  let tryCtl = null;
  async function tryRunNow() {
    tryCtl?.abort(); tryCtl = new AbortController();
    try {
      const r = await simulate({ model: "full", baseline_state: "mean", inputs: { ...S.tryInputs } }, tryCtl.signal);
      const est = r.scenario.estimate, d = r.difference.delta;
      $("tryEst").textContent = fmt(est, 1);
      $("tryDelta").textContent = Math.abs(d) < 0.05 ? "at the average" : `${signed(d, 1)} vs average`;
      const f = (est - S.rateLo) / (S.rateHi - S.rateLo);
      S.tryLevel = f;
      heart?.setLevel(f);
      $("scaleFill").style.width = `${Math.max(0, Math.min(1, f)) * 100}%`;
    } catch (e) { if (e.name !== "AbortError") $("tryDelta").textContent = e.message; }
  }
  const tryRun = debounce(tryRunNow, 90);

  /* ---------------------------------------------------------------- simulate: setup */
  let entered = false;
  async function enterSimulate() {
    if (entered) { drawCharts(); return; }
    entered = true;
    const ready = S.status.ready;
    document.querySelector(".presets").hidden = !ready;
    document.querySelector(".sim-grid").hidden = !ready;
    document.querySelector(".start").hidden = !ready;
    if (!ready) { renderUploadInto($("simulate"), true); return; }
    buildBaselineSelect(); buildFactors(); buildPrice(); buildPresets();
    $("resetBtn").addEventListener("click", resetToStart);
    $("pinBtn").addEventListener("click", pinScenario);
    await setBaseline("mean", false);
    let carry = null;
    try { carry = JSON.parse(sessionStorage.getItem("heartlab-carry") || "null"); sessionStorage.removeItem("heartlab-carry"); } catch (e) { carry = null; }
    if (carry) PREDICTORS.forEach((p) => { if (isFinite(carry[p])) S.inputs[p] = carry[p]; });
    writeInputs(); runNow();
    setupMini();
  }

  function buildBaselineSelect() {
    $("baselineSelect").innerHTML = `<option value="mean">Average of ${nJur()} jurisdictions</option>` +
      S.data.states.map((s) => `<option value="${s.state}">${esc(s.state_name)}</option>`).join("");
    $("baselineSelect").addEventListener("change", (e) => setBaseline(e.target.value, true));
  }

  async function setBaseline(code, run) {
    S.baselineState = code;
    const b = await api(`/api/baseline?state=${encodeURIComponent(code)}`);
    S.baseline = b.inputs; S.inputs = { ...b.inputs }; S.preset = null;
    $("resetText").textContent = code === "mean" ? "Reset to average" : `Reset to ${stateName(code)}`;
    $("baselineSelect").value = code;
    S.sens = null; modelBuilt = false;
    writeInputs(); paintPresets();
    if (run) runNow();
  }

  const stepFor = (b) => (b.slider_max - b.slider_min > 20 ? 0.1 : 0.05);
  const pctOf = (b, x) => ((x - b.slider_min) / (b.slider_max - b.slider_min)) * 100;
  function paint(r) {
    const min = +r.min, max = +r.max, x = +r.value;
    r.style.setProperty("--fill", `${max > min ? ((x - min) / (max - min)) * 100 : 0}%`);
  }
  const inRange = (x, lo, hi) => isFinite(x) && x >= lo && x <= hi;

  function buildFactors() {
    const b = S.data.bounds;
    $("factorControls").innerHTML = PREDICTORS.map((p) => {
      const bb = b[p], issue = signIssue(p);
      return `<div class="factor" data-var="${p}">
        <div class="f-row">
          <span class="f-name"><label for="n-${p}">${esc(LONG[p])}</label><button class="tip" type="button" aria-expanded="false" aria-controls="tip-${p}" aria-label="About ${esc(LONG[p].toLowerCase())}"><svg aria-hidden="true"><use href="#i-info"/></svg></button></span>
          <span class="f-delta" id="d-${p}"></span>
          <span class="num"><input type="number" id="n-${p}" min="${bb.hard_min}" max="${bb.hard_max}" step="${stepFor(bb)}" inputmode="decimal"><span class="unit">%</span></span>
        </div>
        <div class="f-tip" id="tip-${p}" hidden>${esc(V(p).definition || "")}${issue ? ` <b>In this model its coefficient is negative</b>: holding the other three factors fixed, states with more adults in this group had slightly lower estimated rates. That is a conditional association across states, probably reflecting overlap with physical inactivity or differences the model does not measure. It does not mean that a poor diet protects the heart.` : ""}</div>
        <div class="slider" style="--lo:${pctOf(bb, bb.observed_min)}%;--hi:${pctOf(bb, bb.observed_max)}%">
          <i class="band"></i><i class="base-tick" id="bt-${p}"></i>
          <input type="range" id="r-${p}" min="${bb.slider_min}" max="${bb.slider_max}" step="${stepFor(bb)}" aria-label="${esc(LONG[p])}, percent of adults">
        </div>
        <div class="f-meta"><span class="start-v" id="s-${p}"></span><span id="o-${p}"></span></div>
      </div>`;
    }).join("");
    PREDICTORS.forEach((p) => {
      $(`r-${p}`).addEventListener("input", (e) => setInput(p, e.target.value, "range"));
      $(`n-${p}`).addEventListener("input", (e) => setInput(p, e.target.value, "num"));
      $(`n-${p}`).addEventListener("blur", () => { if (!isFinite(S.inputs[p])) { S.inputs[p] = S.baseline[p]; writeInputs(); $("formError").hidden = true; schedule(); } });
    });
    $("factorControls").querySelectorAll(".tip").forEach((btn) => btn.addEventListener("click", () => {
      const open = btn.getAttribute("aria-expanded") !== "true";
      btn.setAttribute("aria-expanded", String(open)); $(btn.getAttribute("aria-controls")).hidden = !open;
    }));
  }

  function setInput(p, raw, from) {
    const num = $(`n-${p}`), rng = $(`r-${p}`), b = S.data.bounds[p];
    const x = parseFloat(raw), ok = raw !== "" && inRange(x, b.hard_min, b.hard_max);
    num.classList.toggle("invalid", !ok);
    if (ok) {
      S.inputs[p] = x;
      if (from === "range") num.value = (+x).toFixed(1); else rng.value = x;
      paint(rng);
    } else S.inputs[p] = NaN;
    S.preset = null; paintPresets();
    factorMeta(p);
    if (ok) schedule(); else showError(`${LONG[p]} must be between ${fmt(b.hard_min, 0)} and ${fmt(b.hard_max, 0)}%.`);
  }

  function factorMeta(p) {
    const b = S.data.bounds[p], x = S.inputs[p], d = x - S.baseline[p];
    const el = $(`d-${p}`);
    const moved = isFinite(d) && Math.abs(d) >= 0.005;
    el.textContent = moved ? pts(d) : "";
    el.classList.toggle("moved", moved);
    $(`s-${p}`).textContent = `Start ${fmt(S.baseline[p], 1)}%`;
    const out = isFinite(x) && (x < b.observed_min || x > b.observed_max);
    $(`o-${p}`).textContent = out ? "Beyond any state: extrapolating" : `States range ${fmt(b.observed_min, 1)}–${fmt(b.observed_max, 1)}%`;
    $(`o-${p}`).classList.toggle("out", out);
    $(`bt-${p}`).style.setProperty("--b", `${pctOf(b, S.baseline[p])}%`);
  }

  function writeInputs() {
    PREDICTORS.forEach((p) => {
      $(`n-${p}`).value = (+S.inputs[p]).toFixed(1); $(`r-${p}`).value = S.inputs[p];
      $(`n-${p}`).classList.remove("invalid"); paint($(`r-${p}`)); factorMeta(p);
    });
    $("priceNum").value = S.price; $("priceRange").value = S.price; paint($("priceRange")); $("priceNum").classList.remove("invalid");
    document.querySelectorAll("#responseSeg input").forEach((i) => { i.checked = i.value === S.response; });
    $("customRow").hidden = S.response !== "custom";
    $("elasNum").value = S.elas;
    responseHint();
  }

  function buildPrice() {
    $("responseSeg").innerHTML = RESPONSES.map((r) => `<label><input type="radio" name="resp" value="${r.k}"${r.k === S.response ? " checked" : ""}>${r.label}<small>${r.e == null ? "set" : r.e === 0 ? "0" : fmt(r.e, 2)}</small></label>`).join("");
    const pr = $("priceRange"), pn = $("priceNum");
    pr.addEventListener("input", () => { S.price = +pr.value; pn.value = pr.value; pn.classList.remove("invalid"); paint(pr); S.preset = null; paintPresets(); responseHint(); schedule(); });
    pn.addEventListener("input", () => {
      const x = parseFloat(pn.value), ok = inRange(x, 0, 100); pn.classList.toggle("invalid", !ok);
      if (!ok) { showError("Price increase must be between 0 and 100%."); return; }
      S.price = x; pr.value = x; paint(pr); S.preset = null; paintPresets(); responseHint(); schedule();
    });
    $("responseSeg").addEventListener("change", (e) => {
      S.response = e.target.value;
      const r = RESPONSES.find((x) => x.k === S.response);
      if (r.e != null) S.elas = r.e;
      $("customRow").hidden = S.response !== "custom"; $("elasNum").value = S.elas;
      responseHint(); schedule();
    });
    $("elasNum").addEventListener("input", () => {
      const x = parseFloat($("elasNum").value), ok = inRange(x, -1, 0); $("elasNum").classList.toggle("invalid", !ok);
      if (!ok) { showError("The assumed response must be between −1 and 0."); return; }
      S.elas = x; responseHint(); schedule();
    });
  }

  function responseHint() {
    const e = S.elas, p = S.price || 10;
    $("responseHint").textContent = e === 0
      ? "No response: the share of adults who smoke stays put, so a price change does not move the estimate."
      : `A ${fmt(p, 0)}% price rise would cut the share of adults who smoke by ${fmt(Math.abs(e * p), 1)}% of its level (elasticity ${fmt(e, 2)}). These levels are illustrative choices, not measured values.`;
  }

  /* ---------------------------------------------------------------- presets */
  function presetDefs() {
    const b = S.data.bounds, q = S.data.quartiles, rows = S.data.states;
    const minSm = rows.reduce((a, r) => (r.smoking < a.smoking ? r : a));
    return [
      { id: "smoke-low", label: `Smoking as low as ${minSm.state_name}`, title: `Smoking set to ${fmt(minSm.smoking, 1)}%, the lowest of any jurisdiction (${minSm.state_name}); other factors stay at the start.`,
        apply: () => ({ inputs: { smoking: minSm.smoking } }) },
      { id: "obesity-5", label: "Obesity 5 points lower", title: "Obesity prevalence 5 percentage points below the start.",
        apply: () => ({ inputs: { obesity: Math.max(b.obesity.hard_min, S.baseline.obesity - 5) } }) },
      { id: "inactive-q", label: "Inactivity at the best quarter of states", title: `Physical inactivity set to ${fmt(q.inactivity.p25, 1)}%, the level a quarter of jurisdictions are at or below.`,
        apply: () => ({ inputs: { inactivity: q.inactivity.p25 } }) },
      { id: "price-20", label: "Cigarettes 20% dearer", title: "A 20% cigarette price rise with a moderate assumed smoking response (−0.25).",
        apply: () => ({ price: 20, response: "moderate" }) },
    ];
  }
  function buildPresets() {
    $("presetList").innerHTML = presetDefs().map((p) => `<button class="preset" type="button" data-preset="${p.id}" aria-pressed="false" title="${esc(p.title)}">${esc(p.label)}</button>`).join("") +
      `<span class="preset-state" id="profileWrap"><label for="profileSelect">Match a state:</label><select id="profileSelect"><option value="">Choose…</option>${S.data.states.map((s) => `<option value="${s.state}">${esc(s.state_name)}</option>`).join("")}</select></span>`;
    $("presetList").querySelectorAll(".preset").forEach((btn) => btn.addEventListener("click", () => applyPreset(btn.dataset.preset)));
    $("profileSelect").addEventListener("change", (e) => {
      const r = stateRow(e.target.value); if (!r) return;
      S.inputs = Object.fromEntries(PREDICTORS.map((p) => [p, r[p]]));
      S.price = 0; S.preset = `state:${r.state}`;
      writeInputs(); paintPresets(); runNow();
    });
  }
  function applyPreset(id) {
    const a = presetDefs().find((d) => d.id === id).apply();
    S.inputs = { ...S.baseline, ...(a.inputs || {}) };
    S.price = a.price || 0;
    if (a.response) { S.response = a.response; S.elas = RESPONSES.find((r) => r.k === a.response).e; }
    S.preset = id;
    writeInputs(); paintPresets(); runNow();
  }
  function paintPresets() {
    document.querySelectorAll(".preset").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.preset === S.preset)));
    const isState = !!S.preset?.startsWith("state:");
    $("profileWrap")?.classList.toggle("on", isState);
    if ($("profileSelect")) $("profileSelect").value = isState ? S.preset.slice(6) : "";
  }

  function resetToStart() {
    S.inputs = { ...S.baseline }; S.price = 0; S.preset = null;
    writeInputs(); paintPresets(); $("formError").hidden = true; runNow();
  }

  /* ---------------------------------------------------------------- simulate: run */
  let ctl = null, seq = 0;
  const schedule = debounce(() => runNow(), 140);
  function requestBody() {
    const b = { model: S.modelName, baseline_state: S.baselineState, inputs: { ...S.inputs }, price_increase_pct: S.price, prevalence_elasticity: S.price > 0 ? S.elas : 0 };
    if (S.varyE && S.price > 0) b.uncertainty_range = [-0.4, 0];
    return b;
  }
  async function runNow() {
    if (PREDICTORS.some((p) => !isFinite(S.inputs[p]))) return;
    ctl?.abort(); ctl = new AbortController(); const my = ++seq;
    $("outcome").setAttribute("aria-busy", "true");
    try {
      const r = await simulate(requestBody(), ctl.signal);
      if (my !== seq) return;
      S.last = r; $("formError").hidden = true;
      renderOutcome();
    } catch (e) {
      if (e.name !== "AbortError") showError(e.message);
    } finally { if (my === seq) $("outcome").removeAttribute("aria-busy"); }
  }
  function showError(msg) { $("formError").textContent = msg; $("formError").hidden = false; }

  /* ---------------------------------------------------------------- simulate: render */
  const changes = (r) => r.inputs.filter((i) => Math.abs(i.change) > 1e-9);

  function tween(el, to, d = 1) {
    const from = parseFloat(el.dataset.v ?? to); el.dataset.v = String(to);
    if (reduceMotion.matches || !isFinite(from) || Math.abs(from - to) < 1e-9) { el.textContent = fmt(to, d); return; }
    const t0 = performance.now(), dur = 320;
    const step = (now) => {
      if (el.dataset.v !== String(to)) return;
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * e, d);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function renderOutcome() {
    const r = S.last, d = r.difference, ch = changes(r);
    const moved = Math.abs(d.delta) >= 0.05;
    const excl = d.ci_low > 0 || d.ci_high < 0;
    const h = $("headline");
    if (!$("hBig")) {
      h.innerHTML = `<p class="h-label" id="hLabel"></p><span class="h-big" id="hBig"></span>
        <div class="h-side"><span class="h-change" id="hChange"></span><span class="h-unit">${esc(yUnit())} adults aged 35+, age-adjusted</span></div>
        <p class="h-plain" id="hPlain"></p><div id="hFlag" style="grid-column:1/-1;display:flex;flex-direction:column;gap:8px"></div>`;
    }
    const isScenario = ch.length || S.price > 0;
    $("hLabel").textContent = isScenario ? "Estimated death rate from coronary heart disease, your scenario"
      : `Estimated death rate from coronary heart disease, ${S.baselineState === "mean" ? "average jurisdiction" : stateName(S.baselineState)}`;
    tween($("hBig"), r.scenario.estimate);
    $("hChange").innerHTML = moved
      ? `${signed(d.delta, 1)} <span class="from">from ${fmt(r.baseline.estimate, 1)} at the start</span>`
      : `<span class="from">${isScenario ? "About the same as the start" : "Starting point"}</span>`;

    const what = ch.map((i) => `${NAMES[i.variable].toLowerCase()} ${i.change < 0 ? "down" : "up"} ${fmt(Math.abs(i.change), 1)} pts`);
    let plain;
    if (!isScenario) {
      plain = `This is the model’s estimate for ${esc(startName())}. Move a slider or pick a starting scenario above; the estimate updates as you go.`;
    } else if (!moved) {
      plain = `With ${esc(what.join(", ") || "this price change")}, the estimate barely moves from the start.`;
    } else {
      plain = `With ${esc(what.join(", ") || "this price change")}, the model estimates a state-level rate <b>${fmt(Math.abs(d.delta), 1)} ${d.delta < 0 ? "lower" : "higher"}</b> (${signed(r.relative_change_pct, 1)}%). ` +
        `The 95% confidence interval for the change, ${fmt(d.ci_low, 1)} to ${fmt(d.ci_high, 1)}, ${excl ? `lies entirely ${d.delta < 0 ? "below" : "above"} zero.` : "includes zero, so the model cannot tell this apart from no change."}`;
    }
    $("hPlain").innerHTML = plain;

    const fv = ch.find((i) => i.variable === "fruit_veg") && signIssue("fruit_veg");
    let flag = "";
    if (fv) {
      const lowered = ch.find((i) => i.variable === "fruit_veg").change < 0;
      flag += `<details class="flagbox"><summary class="flag">Why does ${lowered ? "lowering" : "raising"} low fruit and vegetable intake ${lowered ? "raise" : "lower"} the estimate?</summary><p class="f-tip">In this model the low-intake coefficient is negative (${fmt(fv.estimate, 2)} per point). Holding smoking, obesity and inactivity fixed, states with more low-intake adults had slightly lower rates. That is a conditional association across states, probably reflecting overlap with inactivity or factors the model does not measure. It does not mean a poor diet protects the heart. <a href="#/model" data-goto="m-coef">See the coefficients</a></p></details>`;
    }
    if (S.preset?.startsWith("state:")) {
      const s = stateRow(S.preset.slice(6));
      flag += `<p class="f-tip">These are ${esc(s.state_name)}’s 1998 risk-factor values. For them the model estimates ${fmt(r.scenario.estimate, 1)}; ${esc(s.state_name)}’s observed rate was ${fmt(s.observed_rate, 1)}. The gap is what the four factors do not explain.</p>`;
    } else if (S.baselineState !== "mean" && !isScenario) {
      const s = stateRow(S.baselineState);
      flag += `<p class="f-tip">${esc(s.state_name)}’s observed 1998 rate was ${fmt(s.observed_rate, 1)}. The simulation starts from the model’s estimate for its risk factors (${fmt(s.fitted_rate, 1)}), so changes reflect only the factors you move.</p>`;
    }
    $("hFlag").innerHTML = flag;
    $("hFlag").querySelectorAll("[data-goto]").forEach((a) => a.addEventListener("click", () => { S.gotoAfter = a.dataset.goto; }));

    renderWhy(r, ch);
    drawCharts();
    renderPathway(r.policy);
    renderCertainty(r);
    renderPins();
    const extra = r.warnings.filter((w) => !/outside the observed state range/.test(w));
    $("warnings").innerHTML = extra.map((w) => `<li>${esc(w)}</li>`).join("");
    $("mini").innerHTML = `<b>${fmt(r.scenario.estimate, 1)}</b><span>per 100,000</span><span class="md">${moved ? signed(d.delta, 1) : "at start"}</span>`;
    $("pinBtn").disabled = S.pins.length >= 4;
  }

  function drawCharts() {
    const r = S.last; if (!r || $("simulate").hidden) return;
    const label = `Estimated rate ${fmt(r.scenario.estimate, 1)} with 95% confidence interval ${fmt(r.scenario.ci_low, 1)} to ${fmt(r.scenario.ci_high, 1)}, starting estimate ${fmt(r.baseline.estimate, 1)}, shown against the observed rates of ${nJur()} jurisdictions.`;
    if (!$("rangeSvg")) {
      $("rangeChart").innerHTML = `<div class="section-h">Where the estimate sits among the states</div><div id="rangeSvg"></div>
        <p class="legend"><span><i class="lg-state"></i>Observed 1998 rate, one dot per jurisdiction</span><span><i class="lg-start"></i>Start</span><span><i class="lg-scen"></i>Scenario</span><span><i class="lg-ci"></i>95% confidence interval</span></p>`;
    }
    Charts.range($("rangeSvg"), {
      states: S.data.states.map((s) => ({ rate: s.observed_rate, name: s.state_name })),
      baseline: r.baseline.estimate, scenario: r.scenario, pins: S.pins, label,
    });
    if (S.lastWhy && $("whyBars")) Charts.bars($("whyBars"), S.lastWhy, { label: "Change in the estimate attributed to each factor" });
  }

  function renderWhy(r, ch) {
    if (!ch.length) { $("whyPanel").innerHTML = ""; S.lastWhy = null; return; }
    S.lastWhy = r.inputs.map((i) => ({ name: `${NAMES[i.variable]}${Math.abs(i.change) > 1e-9 ? ` ${pts(i.change)}` : ""}`, value: i.contribution, muted: !i.in_model,
      text: !i.in_model ? "not in model" : Math.abs(i.change) > 1e-9 ? signed(i.contribution, 1) : "unchanged" }));
    if (!$("whyBars")) $("whyPanel").innerHTML = `<div class="section-h">What moves the estimate <span>change in deaths per 100,000</span></div><div id="whyBars"></div>`;
  }

  function renderPathway(p) {
    const el = $("pathway");
    if (!p || !(S.price > 0)) { el.hidden = true; return; }
    el.hidden = false;
    const reg = p.regression_effect;
    el.innerHTML = `<div class="section-h">How the price rise reaches the estimate</div>
      <ol class="steps">
        <li><span class="k">Cigarette price</span><span class="v">+${fmt(p.price_increase_pct, 0)}%</span><span class="n">your scenario</span></li>
        <li class="a"><span class="k">Share who smoke</span><span class="v">${signed(p.prevalence_change_pct, 1)}%</span><span class="n">assumed${p.prevalence_elasticity === 0 ? ", no response" : `, elasticity ${fmt(p.prevalence_elasticity, 2)}`}</span></li>
        <li><span class="k">Smoking prevalence</span><span class="v">${p.smoking_base == null ? "–" : `${fmt(p.smoking_new, 1)}%`}</span><span class="n">${p.smoking_base == null ? "not in this model" : `from ${fmt(p.smoking_base, 1)}%, ${pts(p.smoking_change_points)}`}</span></li>
        <li class="o"><span class="k">Estimated death rate</span><span class="v">${reg ? signed(reg.delta, 1) : "–"}</span><span class="n">${reg ? `95% CI ${fmt(reg.ci_low, 1)} to ${fmt(reg.ci_high, 1)}` : "smoking not in model"}</span></li>
      </ol>
      <p class="demand">For reference, cigarette consumption would fall about <b>${fmt(Math.abs(p.demand_change_pct), 1)}%</b> (demand elasticity −0.4; Bader, Boisclair &amp; Ferrence, 2011). Fewer cigarettes is not the same as fewer smokers, so this figure does not enter the model.</p>`;
  }

  function renderCertainty(r) {
    const mc = r.monte_carlo;
    const row = (name, x) => `<tr><td class="term">${name}</td><td>${fmt(x.estimate, 1)}</td><td>${fmt(x.ci_low, 1)} to ${fmt(x.ci_high, 1)}</td><td>${fmt(x.pi_low, 1)} to ${fmt(x.pi_high, 1)}</td></tr>`;
    const varyOK = S.price > 0;
    $("certaintyBody").innerHTML = `
      <p>The confidence interval reflects uncertainty in the fitted coefficients. The prediction interval is wider: it is where a single state’s rate would be expected to fall, given everything the four factors leave unexplained.</p>
      <div class="table-scroll"><table class="data"><thead><tr><th></th><th>Estimate</th><th>95% CI</th><th>95% prediction</th></tr></thead>
        <tbody>${row("Start", r.baseline)}${row("Scenario", r.scenario)}</tbody></table></div>
      ${mc && mc.sd > 1e-12 ? `<p>Re-running the scenario with ${mc.draws.toLocaleString()} plausible sets of coefficients${mc.elasticity_range ? ` and a smoking response drawn between ${fmt(mc.elasticity_range[0], 2)} and ${fmt(mc.elasticity_range[1], 2)}` : ""}: the middle 95% of changes run from ${fmt(mc.quantiles.p2_5, 1)} to ${fmt(mc.quantiles.p97_5, 1)}, and ${fmt(mc.prob_decrease * 100, 1)}% are below zero.</p><div id="mcSvg"></div>` : `<p>No change from the start, so there is nothing to simulate.</p>`}
      <label class="custom" style="justify-content:flex-start;gap:10px;font-size:14px"><input type="checkbox" id="varyE" ${S.varyE ? "checked" : ""} ${varyOK ? "" : "disabled"}>Also vary the assumed smoking response from 0 to −0.40${varyOK ? "" : " (needs a price rise)"}</label>`;
    if (mc && mc.sd > 1e-12) Charts.histogram($("mcSvg"), mc);
    $("varyE").addEventListener("change", (e) => { S.varyE = e.target.checked; runNow(); });
  }

  /* ---------------------------------------------------------------- compare */
  function scenarioName() {
    if (S.preset?.startsWith("state:")) return `${stateName(S.preset.slice(6))}’s factors`;
    const ch = changes(S.last).filter((i) => !(S.price > 0 && i.variable === "smoking" && Math.abs(S.inputs.smoking - S.baseline.smoking) < 1e-9))
      .map((i) => `${NAMES[i.variable]} ${pts(i.change)}`);
    if (S.price > 0) ch.unshift(`Price +${fmt(S.price, 0)}%`);
    return ch.join(", ") || "Start";
  }
  function pinScenario() {
    if (!S.last || S.pins.length >= 4) return;
    S.pins.push({ name: scenarioName(), estimate: S.last.scenario.estimate, delta: S.last.difference.delta,
      snap: { inputs: { ...S.inputs }, price: S.price, response: S.response, elas: S.elas, preset: S.preset, baselineState: S.baselineState } });
    renderPins(); drawCharts(); $("pinBtn").disabled = S.pins.length >= 4;
  }
  function renderPins() {
    $("pins").innerHTML = S.pins.map((p, i) => `<li><span class="pn">${i + 1}</span>
      <button class="restore" type="button" data-i="${i}" title="Restore: ${esc(p.name)}">${esc(p.name)}</button>
      <span class="pv">${fmt(p.estimate, 1)} <span style="color:var(--ink-3);font-weight:500">${signed(p.delta, 1)}</span></span>
      <button class="rm" type="button" data-rm="${i}" aria-label="Remove kept scenario ${i + 1}"><svg aria-hidden="true"><use href="#i-x"/></svg></button></li>`).join("");
    $("pins").querySelectorAll(".restore").forEach((b) => b.addEventListener("click", async () => {
      const s = S.pins[+b.dataset.i].snap;
      if (s.baselineState !== S.baselineState) await setBaseline(s.baselineState, false);
      Object.assign(S, { inputs: { ...s.inputs }, price: s.price, response: s.response, elas: s.elas, preset: s.preset });
      writeInputs(); paintPresets(); runNow();
    }));
    $("pins").querySelectorAll(".rm").forEach((b) => b.addEventListener("click", () => { S.pins.splice(+b.dataset.rm, 1); renderPins(); drawCharts(); $("pinBtn").disabled = false; }));
  }

  function setupMini() {
    const mini = $("mini");
    new IntersectionObserver((en) => { mini.classList.toggle("show", !en[0].isIntersecting && !$("simulate").hidden); }, { rootMargin: "-60px 0px 0px 0px" }).observe($("headline"));
  }

  /* ---------------------------------------------------------------- shared: on-page index */
  function toc(listId, sections) {
    $(listId).innerHTML = sections.map(([id, t]) => `<li><a href="#${id}" data-sec="${id}">${t}</a></li>`).join("");
    const links = Object.fromEntries([...$(listId).querySelectorAll("a")].map((a) => [a.dataset.sec, a]));
    Object.values(links).forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault(); document.getElementById(a.dataset.sec)?.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });
    }));
    const io = new IntersectionObserver((en) => {
      en.forEach((x) => { if (x.isIntersecting) { Object.values(links).forEach((l) => l.classList.remove("on")); links[x.target.id]?.classList.add("on"); } });
    }, { rootMargin: "-25% 0px -65% 0px" });
    sections.forEach(([id]) => { const el = document.getElementById(id); if (el) io.observe(el); });
    links[sections[0][0]]?.classList.add("on");
  }

  /* ---------------------------------------------------------------- model evidence */
  let modelBuilt = false;
  async function renderModelView() {
    if (!S.status.ready) {
      $("modelSub").textContent = ""; $("modelToc").innerHTML = "";
      $("modelBody").innerHTML = `<p class="sub">No dataset is loaded, so there is no fitted model yet. <a href="#/methods">Load one under Methods &amp; data</a>.</p>`;
      return;
    }
    if (!S.sens) S.sens = await api(`/api/sensitivity?model=${S.modelName}&state=${encodeURIComponent(S.baselineState)}`);
    if (!modelBuilt) { buildModelView(); modelBuilt = true; } else drawModelCharts();
    if (S.gotoAfter) { const id = S.gotoAfter; S.gotoAfter = null; requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" })); }
  }

  function buildModelView() {
    const m = fullModel(), v = m.validation, dg = m.diagnostics, a = m.alpha;
    const co = m.coefficients.filter((c) => c.term !== "const");
    const lim = Math.max(...co.map((c) => Math.max(Math.abs(c.standardized_ci_low ?? 0), Math.abs(c.standardized_ci_high ?? 0)))) * 1.08;
    const flagged = dg.observations.filter((o) => o.influential || o.high_leverage || o.outlier).sort((x, y) => y.cooks_d - x.cooks_d);
    const bad = (m.sign_check || []).filter((s) => s.agrees === false);
    const steps = S.model.elimination_steps;
    const robustShift = co.filter((c) => c.significant !== (c.hc3_p_value < a));
    const models = Object.keys(S.model.models);
    const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
    $("modelSub").textContent = `Ordinary least squares on ${m.n} jurisdictions, 1998 data, tested at α = ${a}.`;

    const stat = (k, val, note) => `<div><dt>${k}</dt><dd>${val}${note ? `<small>${note}</small>` : ""}</dd></div>`;
    const higher = co.filter((c) => c.estimate > 0 && !bad.find((b) => b.variable === c.term)).map((c) => NAMES[c.term].toLowerCase());
    const check = (name, q, statTxt, p, okTxt, badTxt) => `<div class="check"><h3>${name}</h3><p class="q">${q}</p>
      <p class="r"><b class="${p >= a ? "ok" : "warn"}">${p >= a ? okTxt : badTxt}</b>${statTxt}, p ${pfmt(p)}</p></div>`;
    const maxV = Math.max(...Object.values(dg.vif));
    const vOk = m.verification.filter((c) => c.passed).length;

    $("modelBody").innerHTML = `
      <section class="doc-sec" id="m-brief"><h2>In brief</h2>
        <p class="big-say">Together the four factors account for <b>${fmt(m.r_squared * 100, 0)}%</b> of the differences in coronary heart disease death rates between jurisdictions. Higher ${list(higher)} go with higher rates.${bad.length ? ` ${list(bad.map((b) => NAMES[b.variable]))} runs the other way from what was expected.` : ""}</p>
        <dl class="stats" style="margin-top:20px">
          ${stat("R²", fmt(m.r_squared, 3), "share of variation explained")}
          ${stat("Adjusted R²", fmt(m.adj_r_squared, 3), `penalised for ${m.df_model} predictors`)}
          ${stat(`F(${m.df_model}, ${m.df_resid})`, fmt(m.f_statistic, 2), `p ${pfmt(m.f_p_value)}`)}
          ${stat("Residual SE", fmt(m.rmse, 1), "typical miss, per 100,000")}
          ${stat("Jurisdictions", m.n, "50 states and DC")}
        </dl>
        ${models.length > 1 ? `<p class="foot"><label for="modelSelect">Model </label><select id="modelSelect">${models.map((k) => `<option value="${k}"${k === S.modelName ? " selected" : ""}>${k === "full" ? "Full, 4 predictors" : `Reduced, ${S.model.models[k].predictors.length} predictors`}</option>`).join("")}</select></p>` : ""}
      </section>

      <section class="doc-sec" id="m-coef"><h2>Coefficients</h2>
        <p class="lead">Each estimate is the change in the death rate (per 100,000) that goes with a one-point rise in that factor, holding the other three fixed. These are associations across states, not causal effects.</p>
        <div class="table-scroll"><table class="data"><caption class="sr-only">Coefficient estimates</caption>
          <thead><tr><th>Factor</th><th>Per +1 point</th><th>95% CI</th><th>Std. error</th><th>t</th><th>p</th><th>p, robust (HC3)</th><th>Standardized, 95% CI</th></tr></thead>
          <tbody>${m.coefficients.map((c) => {
            const isC = c.term === "const";
            return `<tr><td class="term">${isC ? "Intercept" : esc(NAMES[c.term])}${!isC && c.significant ? `<span class="sig" title="p < ${a}"></span>` : ""}</td>
              <td>${signed(c.estimate, 2)}</td><td>${fmt(c.ci_low, 2)} to ${fmt(c.ci_high, 2)}</td><td>${fmt(c.std_error, 2)}</td><td>${fmt(c.t, 2)}</td>
              <td class="${c.significant ? "" : "ns"}">${pfmt(c.p_value)}</td><td class="${c.hc3_p_value < a ? "" : "ns"}">${pfmt(c.hc3_p_value)}</td>
              <td class="forest-cell">${isC ? "" : `<span style="display:inline-flex;align-items:center;gap:8px">${Charts.forest(c.standardized_ci_low, c.standardized, c.standardized_ci_high, lim)}${fmt(c.standardized, 2)}</span>`}</td></tr>`;
          }).join("")}</tbody></table></div>
        <p class="foot"><span class="sig" style="margin:0 6px 0 0"></span>p &lt; ${a}. Robust (HC3) p-values allow the spread of errors to differ between states. Standardized: standard deviations of the death rate per standard deviation of the factor, so the factors can be compared with each other.</p>
        ${bad.map((b) => `<div class="callout"><b>${esc(NAMES[b.variable])}: unexpected direction.</b> The factor is the share of adults eating fewer than five servings of fruit and vegetables a day, so a positive coefficient was expected. Once smoking, obesity and especially physical inactivity are held fixed, its coefficient is negative (${fmt(b.estimate, 2)}, p ${pfmt(b.p_value)}). This is a conditional association in a 51-observation ecological regression and probably reflects overlap among the predictors or confounding the model does not capture. It is reported as fitted, not corrected, and it does not mean a poor diet is protective.</div>`).join("")}
        <h3>Fitted equation</h3>
        <div class="eq">${esc(m.equation)}</div>
      </section>

      <section class="doc-sec" id="m-fit"><h2>How well it predicts</h2>
        <p class="lead">Judging a model on the same states it was fitted to flatters it. Leaving each state out in turn, refitting on the other ${m.n - 1} and predicting the one left out gives a fairer test.</p>
        <dl class="stats">
          ${stat("Typical error, in sample", fmt(v.rmse_in_sample, 1), "RMSE")}
          ${stat("Typical error, state left out", fmt(v.rmse_loocv, 1), "leave-one-out RMSE")}
          ${stat("Mean absolute error", fmt(v.mae_loocv, 1), "state left out")}
          ${stat("Predicted R²", fmt(v.predicted_r_squared, 3), `vs ${fmt(m.r_squared, 3)} in sample`)}
          ${stat("PRESS", fmt(v.press, 0), "sum of squared prediction errors")}
          ${stat("AIC · BIC", `${fmt(m.aic, 0)} · ${fmt(m.bic, 0)}`, "for comparing models")}
        </dl>
        <h3>Observed against fitted</h3>
        <div id="ofChart"></div>
        <p class="foot">Each point is a jurisdiction. Points on the dashed line would be predicted exactly. Highlighted points are flagged as influential or outlying.</p>
      </section>

      <section class="doc-sec" id="m-checks"><h2>Checks on the assumptions</h2>
        <p class="lead">Each test asks whether the data contradict an assumption behind the p-values and intervals. Passing means no contradiction was detected at α = ${a}. It does not prove the assumption holds, and with ${m.n} jurisdictions these tests have limited power.</p>
        <div class="checks">
          ${check("Breusch–Pagan", "Does the spread of the errors change with the predictors?", `LM ${fmt(dg.breusch_pagan.lm, 2)}`, dg.breusch_pagan.p_value, "No evidence it does", "Evidence it does; prefer robust p-values")}
          ${dg.white ? check("White", "The same question, allowing curved and interacting patterns.", `LM ${fmt(dg.white.lm, 2)}`, dg.white.p_value, "No evidence it does", "Evidence it does; prefer robust p-values") : ""}
          ${check("Jarque–Bera", "Are the errors skewed or heavy-tailed compared with a normal distribution?", `JB ${fmt(dg.jarque_bera.statistic, 2)}`, dg.jarque_bera.p_value, "No evidence they are", "Evidence they are")}
          ${dg.shapiro_wilk ? check("Shapiro–Wilk", "A second check on whether the errors look normally distributed.", `W ${fmt(dg.shapiro_wilk.statistic, 3)}`, dg.shapiro_wilk.p_value, "No evidence against", "Evidence against") : ""}
          <div class="check"><h3>Variance inflation</h3><p class="q">Do the predictors overlap so much that their separate effects blur? Values above 5 are a common warning sign. ${PREDICTORS.filter((p) => p in dg.vif).map((p) => `${NAMES[p]} ${fmt(dg.vif[p], 2)}`).join(" · ")}.</p>
            <p class="r"><b class="${maxV < 5 ? "ok" : "warn"}">${maxV < 5 ? "Below the warning level" : "Above the warning level"}</b>highest ${fmt(maxV, 2)}</p></div>
          <div class="check"><h3>Arithmetic verification</h3><p class="q">Do the reported coefficients, R², F and residuals match independent calculations from the normal equations? This checks the software, not the model.</p>
            <p class="r"><b class="${vOk === m.verification.length ? "ok" : "warn"}">${vOk} of ${m.verification.length} match</b></p></div>
        </div>
      </section>

      <section class="doc-sec" id="m-infl"><h2>Influential states</h2>
        <p class="lead">Some jurisdictions pull the fit more than others: unusual factor values (leverage), large misses (outliers), or both (Cook’s distance). They stay in the model; this list shows where the results lean on a few states.</p>
        ${flagged.length ? `<div class="table-scroll"><table class="data"><caption class="sr-only">Influential and outlying jurisdictions</caption>
          <thead><tr><th>Jurisdiction</th><th>Observed</th><th>Fitted</th><th>Miss</th><th>Studentized</th><th>Leverage</th><th>Cook’s D</th><th>Why flagged</th></tr></thead>
          <tbody>${flagged.map((o) => `<tr><td class="term">${esc(stateName(o.state))}</td><td>${fmt(o.observed, 1)}</td><td>${fmt(o.fitted, 1)}</td><td>${signed(o.residual, 1)}</td><td>${fmt(o.studentized, 2)}</td><td>${fmt(o.leverage, 3)}</td><td>${fmt(o.cooks_d, 3)}</td>
            <td style="text-align:left">${[o.influential && "influential", o.high_leverage && "unusual factors", o.outlier && "large miss"].filter(Boolean).join(", ")}</td></tr>`).join("")}</tbody></table></div>
          <p class="foot">Thresholds: Cook’s D above 4/n = ${fmt(dg.thresholds.cooks_d, 3)}; leverage above 2(k+1)/n = ${fmt(dg.thresholds.leverage, 3)}; studentized residual beyond ±${dg.thresholds.studentized}.</p>`
          : `<p>No jurisdiction crosses the Cook’s distance, leverage or residual thresholds.</p>`}
      </section>

      <section class="doc-sec" id="m-select"><h2>Model selection</h2>
        <p class="lead">${steps.length
          ? `Backward elimination at α = ${a} removed ${steps.map((s) => `${esc(NAMES[s.dropped])} (p = ${pfmt(s.p_value)})`).join(", ")}. The reduced model can be chosen under In brief.`
          : `Backward elimination at α = ${a} removed nothing: all four predictors are significant in the full model, so the reduced model is the full model.`}</p>
        <p>${robustShift.length
          ? `With robust (HC3) standard errors, ${robustShift.map((c) => `${esc(NAMES[c.term].toLowerCase())} (p = ${pfmt(c.hc3_p_value)})`).join(", ")} ${robustShift.length > 1 ? "cross" : "crosses"} the ${a} threshold. Treat ${robustShift.length > 1 ? "these results" : "that result"} as less robust${robustShift.some((c) => c.term === "smoking") ? ". This matters for the cigarette-price simulation, which works only through smoking" : ""}.`
          : "Significance is unchanged under robust (HC3) standard errors."}</p>
      </section>

      <section class="doc-sec" id="m-sens"><h2>Sensitivity</h2>
        <p class="lead">How much the estimate for ${esc(startName())} moves when each factor shifts by one standard deviation across states, and how the price result depends on the assumed smoking response.</p>
        <h3>One factor at a time, ±1 standard deviation</h3><div id="tornadoChart"></div>
        <h3>Price rise against assumed smoking response</h3><div id="gridChart"></div>
        <p class="foot">Each line is one assumed prevalence elasticity, from none to −0.40. All of them are assumptions; none is a measured value.</p>
      </section>`;
    toc("modelToc", [["m-brief", "In brief"], ["m-coef", "Coefficients"], ["m-fit", "How well it predicts"], ["m-checks", "Checks on the assumptions"], ["m-infl", "Influential states"], ["m-select", "Model selection"], ["m-sens", "Sensitivity"]]);
    $("modelSelect")?.addEventListener("change", async (e) => { S.modelName = e.target.value; S.sens = null; modelBuilt = false; await renderModelView(); if (S.last) runNow(); });
    drawModelCharts();
  }
  function drawModelCharts() {
    if ($("model").hidden || !$("ofChart") || !S.sens) return;
    Charts.scatter($("ofChart"), fullModel().diagnostics.observations, yUnit());
    Charts.tornado($("tornadoChart"), S.sens.tornado, NAMES);
    Charts.policyLines($("gridChart"), S.sens.policy_grid, S.price > 0 ? S.elas : NaN);
  }

  /* ---------------------------------------------------------------- methods & data */
  let methodsBuilt = false;
  function renderMethodsView() {
    if (methodsBuilt) return; methodsBuilt = true;
    const st = S.status, d = st.dataset, src = st.source || {}, meta = d?.file_metadata || {};
    const vars = ["heart_disease", ...PREDICTORS];
    $("methodsBody").innerHTML = `
      <section class="doc-sec" id="x-what"><h2>What Heartlab estimates</h2>
        <p class="lead">A multiple linear regression across U.S. jurisdictions: the age-adjusted coronary heart disease death rate among adults aged 35 and over, regressed on four behavioural risk factors measured in the same states.</p>
        <div class="eq">${esc(st.specification.equation)}</div>
        <p style="margin-top:14px">A scenario changes one or more factor values and asks what the fitted equation gives for them. The difference from the start is the scenario’s change, with a 95% confidence interval from the coefficients’ estimated uncertainty. The model follows Gordon &amp; Guilfoos (2017), Chapter 14, §14.3.6.</p>
      </section>

      <section class="doc-sec" id="x-data"><h2>Data</h2>
        ${d ? `<p class="lead"><code>${esc(d.file)}</code>: ${d.observations} jurisdictions (50 states${d.includes_dc ? " and the District of Columbia" : ""}), ${d.complete_cases} complete, ${d.excluded_rows.length} excluded.
          ${meta.risk_factor_year ? `Risk factors: ${esc(meta.risk_factor_year.join(", "))}. ` : ""}${meta.outcome_year ? `Outcome: ${esc(meta.outcome_year.join(", "))}.` : ""}</p>
        ${src.provenance ? `<div class="callout"><b>Reconstructed dataset.</b> ${esc(src.provenance)}</div>` : ""}
        <div class="table-scroll"><table class="data"><thead><tr><th>Variable</th><th>Unit</th><th>Definition</th><th>Source column</th></tr></thead><tbody>
          ${vars.map((k) => `<tr><td class="term">${esc(k === "heart_disease" ? "CHD death rate" : LONG[k])}</td><td style="text-align:left">${esc(V(k).unit || "–")}</td><td class="wrap">${esc(V(k).definition || "–")}</td><td style="text-align:left"><code>${esc(d.column_mapping[k])}</code></td></tr>`).join("")}
        </tbody></table></div>
        ${src.year_note ? `<p class="foot">${esc(src.year_note)}</p>` : ""}` : `<p class="lead">No dataset is loaded.</p>`}
        <details style="margin-top:18px"${st.ready ? "" : " open"}><summary>${st.ready ? "Load a different dataset" : "Load the dataset"}</summary><div id="methodsUpload"></div></details>
      </section>

      <section class="doc-sec" id="x-price"><h2>Cigarette-price pathway</h2>
        <ul>
          <li><b>Price.</b> The scenario’s percentage increase in cigarette prices.</li>
          <li><b>Smoking response (assumption).</b> Smoking prevalence changes by E<sub>s</sub> × the price change, with E<sub>s</sub> chosen by you: none (0), small (−0.10), moderate (−0.25), strong (−0.40) or a custom value between −1 and 0. These are illustrative levels, not measured general-population elasticities.</li>
          <li><b>Model.</b> The new smoking value, S × (1 + E<sub>s</sub> × ΔP / 100), goes through the fitted equation with the other factors unchanged.</li>
          <li><b>Demand (reference only).</b> A 10% price rise lowers cigarette consumption by about 4% (E<sub>d</sub> = −0.4; Bader, Boisclair &amp; Ferrence, 2011, citing Jha &amp; Chaloupka, 1999). Consumption is not prevalence, so this figure is shown for context and never used as the smoking response.</li>
        </ul>
      </section>

      <section class="doc-sec" id="x-stats"><h2>Statistical methods</h2>
        <ul>
          <li>Ordinary least squares with t-tests, an F-test, 95% confidence intervals and HC3 heteroskedasticity-robust standard errors.</li>
          <li>Residual checks: Breusch–Pagan and White (variance), Jarque–Bera and Shapiro–Wilk (normality), variance inflation factors (collinearity), Cook’s distance, leverage and studentized residuals (influence).</li>
          <li>Leave-one-state-out cross-validation through the hat matrix, verified against brute-force refits.</li>
          <li>Backward elimination at α = ${st.specification.alpha} for the reduced model.</li>
          <li>Monte Carlo: 5,000 draws of the coefficients from their estimated sampling distribution (seed 20171), optionally with the smoking response drawn uniformly from 0 to −0.40.</li>
          <li>Sliders span the observed range of states ±25%. Values outside the observed range are accepted within 0–100% and flagged as extrapolation.</li>
        </ul>
      </section>

      <section class="doc-sec" id="x-limits"><h2>Limitations</h2>
        <ul>
          <li><b>Ecological.</b> The data are state averages. Relationships between states need not hold for individuals, and nothing here estimates a person’s risk.</li>
          <li><b>Associations, not causes.</b> A scenario shows what the fitted equation gives for different factor values. It does not show what would happen if a state changed its behaviour, and it does not count deaths prevented.</li>
          <li><b>Small sample.</b> ${st.ready ? S.model.models.full.n : 51} observations from one year. Several estimates lean on a handful of influential states.</li>
          <li><b>Unexpected sign.</b> The low fruit and vegetable coefficient is negative; see Model evidence.</li>
          <li><b>Reconstructed data.</b> The dataset was assembled from CDC tables, not taken from the textbook’s original spreadsheet, so results may differ from the textbook’s.</li>
        </ul>
      </section>

      <section class="doc-sec" id="x-refs"><h2>References</h2>
        <ul>
          <li>Gordon, S. I., &amp; Guilfoos, B. (2017). <i>Introduction to Modeling and Simulation with MATLAB and Python</i>, Ch. 14, §14.3.6. CRC Press.</li>
          <li>Bader, P., Boisclair, D., &amp; Ferrence, R. (2011). Effects of tobacco taxation and pricing on smoking behavior in high risk populations. <i>IJERPH, 8</i>(11), 4118–4139.</li>
          <li>U.S. Centers for Disease Control and Prevention, state-level risk-factor and mortality tables, 1998.</li>
        </ul>
      </section>`;
    if (!document.getElementById("drop")) renderUploadInto($("methodsUpload"), false);
    toc("methodsToc", [["x-what", "What it estimates"], ["x-data", "Data"], ["x-price", "Price pathway"], ["x-stats", "Statistical methods"], ["x-limits", "Limitations"], ["x-refs", "References"]]);
  }

  /* ---------------------------------------------------------------- upload */
  function renderUploadInto(host, primary) {
    const err = S.status.error;
    host.insertAdjacentHTML("beforeend", `
      <div class="upload" id="drop">
        <span class="ico"><svg aria-hidden="true"><use href="#i-upload"/></svg></span>
        <h2>${primary ? "Load the dataset" : "Replace the dataset"}</h2>
        <p>Drop the state-level CDC file here, or choose it. Heartlab checks the columns, fits the model and opens the simulator.</p>
        <label class="btn-solid" for="fileInput">Choose file</label>
        <input type="file" id="fileInput" accept=".csv,.xls,.xlsx">
        <p class="types">.csv, .xls or .xlsx, up to 10 MB</p>
        <div class="file-row" id="fileRow" hidden><svg aria-hidden="true"><use href="#i-file"/></svg><span id="fname"></span><span id="fsize" style="color:var(--ink-3)"></span></div>
        <div class="progress" id="upProgress" hidden><i></i></div>
        <p class="up-msg ${err && primary ? "err" : ""}" id="uploadMsg" role="status">${err && primary ? `The configured dataset could not be loaded: ${esc(err.message)}` : ""}</p>
      </div>`);
    const drop = $("drop"), input = $("fileInput");
    const send = async (file) => {
      const msg = $("uploadMsg");
      $("fileRow").hidden = false; $("fname").textContent = file.name; $("fsize").textContent = `${(file.size / 1024).toFixed(1)} KB`;
      $("upProgress").hidden = false; msg.className = "up-msg"; msg.textContent = "Uploading and checking columns…";
      const fd = new FormData(); fd.append("file", file);
      try {
        const res = await fetch("/api/dataset", { method: "POST", body: fd });
        const b = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(b.detail || `Upload failed (${res.status})`);
        msg.className = "up-msg ok"; msg.innerHTML = `<svg aria-hidden="true"><use href="#i-check"/></svg>Loaded ${b.status?.dataset?.observations ?? ""} jurisdictions. Opening the simulator…`;
        setTimeout(() => { location.hash = "#/simulate"; location.reload(); }, 900);
      } catch (e) {
        msg.className = "up-msg err"; msg.textContent = e.message;
      } finally { $("upProgress").hidden = true; }
    };
    input.addEventListener("change", () => input.files[0] && send(input.files[0]));
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", (e) => e.dataTransfer.files[0] && send(e.dataTransfer.files[0]));
  }

  /* ---------------------------------------------------------------- boot */
  async function boot() {
    paintThemeButton();
    $("themeBtn").addEventListener("click", toggleTheme);
    S.status = await api("/api/status");
    if (S.status.ready) {
      [S.model, S.data] = await Promise.all([api("/api/model"), api("/api/states")]);
      const b = await api("/api/baseline?state=mean");
      S.tryBase = b.inputs; S.tryInputs = { ...b.inputs };
    }
    $("syntheticBanner").hidden = !(S.status.ready && S.status.dataset.synthetic);
    buildTry();
    $("enterBtn").addEventListener("click", () => {
      if (!S.status.ready) return;
      const moved = PREDICTORS.some((q) => Math.abs(S.tryInputs[q] - S.tryBase[q]) > 1e-9);
      try { if (moved) sessionStorage.setItem("heartlab-carry", JSON.stringify(S.tryInputs)); } catch (e) { /* carry-over is optional */ }
    });
    window.addEventListener("hashchange", route);
    window.addEventListener("resize", debounce(() => { drawCharts(); drawModelCharts(); }, 150));
    route();
  }
  boot().catch((e) => {
    document.body.insertAdjacentHTML("afterbegin", `<p class="banner">The Heartlab backend is not responding (${esc(e.message)}). Start it with ./run.sh.</p>`);
  });
})();
