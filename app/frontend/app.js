/* HEARTLAB interface logic. Every estimate, interval and statistic shown comes from the Python backend (/api/*).
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
    last: null, preset: null, lastWhy: null, gotoAfter: null,
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
    $("themeBtn").title = `Switch to ${next} theme`;
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
      document.body.classList.toggle("on-landing", view === "landing");

      document.querySelectorAll("#appNav a").forEach((a) => { if (a.dataset.view === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
      document.title = { landing: "HEARTLAB", simulate: "Simulator · HEARTLAB", model: "Model evidence · HEARTLAB", methods: "Methods & data · HEARTLAB" }[view];
      window.scrollTo(0, 0);
      if (view === "landing") enterLanding();
      if (view === "simulate") enterSimulate();
      if (view === "model") renderModelView();
      if (view === "methods") renderMethodsView();
    };
    const prev = VIEWS.find((v) => !$(v).hidden);
    if (prev && prev !== view && document.startViewTransition && !reduceMotion.matches) document.startViewTransition(swap);
    else swap();
  }

  /* ---------------------------------------------------------------- landing */
  let landingBuilt = false;
  function enterLanding() {
    if (landingBuilt) { heart?.wake(); return; }
    landingBuilt = true;
    const land = $("landing");
    heart = window.HeartSpecimen.mount($("heroHeart"), { area: land, ghost: true, colorsFrom: land, maxScale: 1.5 });
    if (S.data) window.LandingField.mount($("field"), { states: S.data.states, area: land, readout: $("fieldRead"), colorsFrom: land });
    else $("fieldRead").hidden = true;
    setupDisclaimer();
  }

  /* The disclaimer: previewed on hover or keyboard focus, pinned open by a click or tap, closed by Escape or a click outside. */
  function setupDisclaimer() {
    const box = $("disc"), btn = $("discBtn");
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    let pinned = false, timer = 0;
    const set = (open) => { clearTimeout(timer); box.classList.toggle("open", open); btn.setAttribute("aria-expanded", String(open)); if (!open) pinned = false; };
    box.addEventListener("mouseenter", () => { if (fine.matches) set(true); });
    box.addEventListener("mouseleave", () => { if (fine.matches && !pinned) timer = setTimeout(() => set(false), 160); });
    btn.addEventListener("focus", () => { if (btn.matches(":focus-visible")) set(true); });
    btn.addEventListener("blur", () => { if (!pinned) set(false); });
    btn.addEventListener("click", () => { if (pinned) set(false); else { set(true); pinned = true; } });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && box.classList.contains("open")) { set(false); btn.focus(); } });
    document.addEventListener("pointerdown", (e) => { if (!box.contains(e.target) && box.classList.contains("open")) set(false); });
  }

  /* ---------------------------------------------------------------- simulate: setup */
  let entered = false;
  async function enterSimulate() {
    if (entered) { drawCharts(); return; }
    entered = true;
    const ready = S.status.ready;
    document.querySelector(".sim-grid").hidden = !ready;
    document.querySelector(".start").hidden = !ready;
    if (!ready) { renderUploadInto($("simulate"), true); return; }
    buildBaselineSelect(); buildFactors(); buildPrice(); buildPresets();
    $("resetBtn").addEventListener("click", resetToStart);
    $("advBox").addEventListener("toggle", () => { if ($("advBox").open) renderAdvanced(); });
    document.querySelectorAll("#simulate [data-goto]").forEach((a) => a.addEventListener("click", () => { S.gotoAfter = a.dataset.goto; }));
    await setBaseline("mean", false);
    runNow();
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
    $("baselineSelect").value = code;
    S.sens = null; modelBuilt = false;
    writeInputs(); paintPresets();
    if (run) runNow();
  }

  const stepFor = (b) => (b.slider_max - b.slider_min > 20 ? 0.1 : 0.05);
  const pctOf = (b, x) => ((x - b.slider_min) / (b.slider_max - b.slider_min)) * 100;
  /* Track fill runs from the starting point (or the track's start, for price) to the current value. */
  function paint(r, from) {
    const min = +r.min, max = +r.max, x = +r.value, f = from == null ? min : from;
    const pc = (v) => (max > min ? Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100)) : 0);
    r.style.setProperty("--a", `${pc(Math.min(f, x))}%`); r.style.setProperty("--b", `${pc(Math.max(f, x))}%`);
  }
  const inRange = (x, lo, hi) => isFinite(x) && x >= lo && x <= hi;

  function buildFactors() {
    const b = S.data.bounds;
    $("factorControls").innerHTML = PREDICTORS.map((p) => {
      const bb = b[p];
      return `<div class="factor" data-var="${p}" id="f-${p}">
        <div class="f-row">
          <label for="r-${p}">${esc(NAMES[p])}</label>
          <span class="f-delta" id="d-${p}"></span>
          <span class="f-val"><input class="f-num" id="v-${p}" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"
            aria-label="${esc(NAMES[p])}, percent of adults. Type a value from ${fmt(bb.slider_min, 1)} to ${fmt(bb.slider_max, 1)}" aria-describedby="m-${p}"><span class="pct" aria-hidden="true">%</span></span>
        </div>
        <div class="slider" style="--lo:${pctOf(bb, bb.observed_min)}%;--hi:${pctOf(bb, bb.observed_max)}%">
          <i class="band"></i><i class="base-tick" id="bt-${p}"></i>
          <input type="range" id="r-${p}" min="${bb.slider_min}" max="${bb.slider_max}" step="${stepFor(bb)}" aria-describedby="m-${p}">
        </div>
        <p class="f-meta" id="m-${p}"></p>
      </div>`;
    }).join("");
    PREDICTORS.forEach((p) => {
      $(`r-${p}`).addEventListener("input", (e) => { clearNumError(p); setInput(p, +e.target.value); $(`v-${p}`).value = fmt(S.inputs[p], 1); });
      bindNumber(p);
    });
  }

  /* Typed values: Enter or leaving the field commits, Escape restores the previous value, arrow keys nudge by 0.1
     (Shift: 1). Values are kept to one decimal (the precision of the CDC percentages) and must lie on the slider's span,
     so the slider and the number always show the same value. Anything else is refused with a message, never clamped. */
  const parseNum = (t) => {
    const s = String(t).trim().replace(/%$/, "").trim().replace(",", ".").replace("−", "-");
    return /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? parseFloat(s) : null;
  };
  const round1 = (x) => Math.round(x * 10) / 10;
  function bindNumber(p) {
    const el = $(`v-${p}`), b = S.data.bounds[p];
    const ok = (v) => v != null && v >= round1(b.slider_min) && v <= round1(b.slider_max);
    el.addEventListener("focus", () => el.select());
    el.addEventListener("input", () => { clearNumError(p); el.classList.toggle("bad", !ok(parseNum(el.value))); });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commitNumber(p); el.select(); }
      else if (e.key === "Escape") { e.preventDefault(); clearNumError(p); el.classList.remove("bad"); el.value = fmt(S.inputs[p], 1); el.select(); }
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const v = round1((parseNum(el.value) ?? S.inputs[p]) + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 1 : 0.1));
        el.value = fmt(Math.min(round1(b.slider_max), Math.max(round1(b.slider_min), v)), 1); commitNumber(p); el.select();
      }
    });
    el.addEventListener("blur", () => commitNumber(p));
  }
  function commitNumber(p) {
    const el = $(`v-${p}`), b = S.data.bounds[p], lo = round1(b.slider_min), hi = round1(b.slider_max);
    const v = parseNum(el.value);
    el.classList.remove("bad");
    if (v == null || v < lo || v > hi) {
      if (el.value.trim() !== fmt(S.inputs[p], 1)) numError(p, v == null ? `“${el.value.trim()}” is not a number. Type a value such as ${fmt(S.inputs[p], 1)}.` : `Type a value from ${fmt(lo, 1)} to ${fmt(hi, 1)}%, the span of this slider.`);
      el.value = fmt(S.inputs[p], 1);
      return;
    }
    const x = round1(v);
    if (x === round1(S.inputs[p])) { el.value = fmt(S.inputs[p], 1); return; }
    $(`r-${p}`).value = x;
    setInput(p, x);
  }
  function numError(p, msg) {
    $(`f-${p}`).classList.add("err"); $(`v-${p}`).setAttribute("aria-invalid", "true");
    $(`m-${p}`).textContent = msg;
  }
  function clearNumError(p) {
    if (!$(`f-${p}`).classList.contains("err")) return;
    $(`f-${p}`).classList.remove("err"); $(`v-${p}`).removeAttribute("aria-invalid"); factorMeta(p);
  }

  function setInput(p, x) {
    S.inputs[p] = x; S.preset = null;
    paint($(`r-${p}`), S.baseline[p]); paintPresets(); factorMeta(p); schedule();
  }

  function factorMeta(p) {
    const b = S.data.bounds[p], x = S.inputs[p], d = x - S.baseline[p];
    const moved = Math.abs(d) >= 0.05;
    if (document.activeElement !== $(`v-${p}`)) $(`v-${p}`).value = fmt(x, 1);
    $(`d-${p}`).textContent = moved ? pts(d) : "";
    $(`d-${p}`).classList.toggle("moved", moved);
    $(`f-${p}`).classList.toggle("moved", moved);
    const out = x < b.observed_min || x > b.observed_max;
    $(`f-${p}`).classList.toggle("out", out);
    if (!$(`f-${p}`).classList.contains("err")) $(`m-${p}`).innerHTML = out
      ? `Outside the range seen in the historical state data (${fmt(b.observed_min, 1)}–${fmt(b.observed_max, 1)}%).`
      : `Starting point ${fmt(S.baseline[p], 1)}% · States ranged ${fmt(b.observed_min, 1)}–${fmt(b.observed_max, 1)}%`;
    $(`bt-${p}`).style.setProperty("--b", `${pctOf(b, S.baseline[p])}%`);
    $(`r-${p}`).setAttribute("aria-valuetext", `${fmt(x, 1)} percent${moved ? `, ${pts(d)} from the starting point` : ""}`);
  }

  function writeInputs() {
    PREDICTORS.forEach((p) => { $(`r-${p}`).value = S.inputs[p]; paint($(`r-${p}`), S.baseline[p]); factorMeta(p); });
    $("priceRange").value = S.price; paint($("priceRange")); $("priceOut").textContent = `${fmt(S.price, 0)}%`;
    document.querySelectorAll("#responseSeg input").forEach((i) => { i.checked = i.value === S.response; });
    $("customRow").hidden = S.response !== "custom";
    $("elasNum").value = S.elas;
    responseHint();
    $("resetBtn").disabled = isAtStart();
  }
  const isAtStart = () => S.price === 0 && PREDICTORS.every((p) => Math.abs(S.inputs[p] - S.baseline[p]) < 1e-9);

  function buildPrice() {
    $("responseSeg").innerHTML = RESPONSES.map((r) => `<label><input type="radio" name="resp" value="${r.k}"${r.k === S.response ? " checked" : ""}>${r.label}<small>${r.e == null ? "set" : r.e === 0 ? "0" : fmt(r.e, 2)}</small></label>`).join("");
    const pr = $("priceRange");
    pr.addEventListener("input", () => { S.price = +pr.value; $("priceOut").textContent = `${fmt(S.price, 0)}%`; paint(pr); $("resetBtn").disabled = isAtStart(); responseHint(); schedule(); });
    $("policyBox").addEventListener("toggle", () => {
      if (!$("policyBox").open && S.price > 0) { S.price = 0; writeInputs(); runNow(); }   // closing the section removes the price rise
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
      ? "No response: the share of adults who smoke stays the same, so the price has no effect on the estimate."
      : `A ${fmt(p, 0)}% price rise would lower the share of adults who smoke by ${fmt(Math.abs(e * p), 1)}% of its level. These levels are illustrative assumptions, not measured values.`;
  }

  /* ---------------------------------------------------------------- presets */
  function presetDefs() {
    const q = S.data.quartiles, rows = S.data.states;
    const minSm = rows.reduce((a, r) => (r.smoking < a.smoking ? r : a));
    return [
      { id: "habits", label: "Better habits",
        title: `Smoking, obesity and inactivity set to ${fmt(q.smoking.p25, 1)}%, ${fmt(q.obesity.p25, 1)}% and ${fmt(q.inactivity.p25, 1)}%: the levels a quarter of states were at or below in 1998.`,
        apply: () => ({ smoking: q.smoking.p25, obesity: q.obesity.p25, inactivity: q.inactivity.p25 }) },
      { id: "smoke-low", label: "Lower smoking",
        title: `Smoking set to ${fmt(minSm.smoking, 1)}%, the lowest of any state in 1998 (${minSm.state_name}).`,
        apply: () => ({ smoking: minSm.smoking }) },
    ];
  }
  function buildPresets() {
    $("presetList").innerHTML = presetDefs().map((p) => `<button class="preset" type="button" data-preset="${p.id}" aria-pressed="false" title="${esc(p.title)}">${esc(p.label)}</button>`).join("");
    $("presetList").querySelectorAll(".preset").forEach((btn) => btn.addEventListener("click", () => applyPreset(btn.dataset.preset)));
  }
  function applyPreset(id) {
    S.inputs = { ...S.baseline, ...presetDefs().find((d) => d.id === id).apply() };
    S.preset = id;
    writeInputs(); paintPresets(); runNow();
  }
  function paintPresets() {
    document.querySelectorAll(".preset").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.preset === S.preset)));
    if ($("resetBtn")) $("resetBtn").disabled = isAtStart();
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
    const isScenario = ch.length > 0 || S.price > 0;
    const h = $("headline");
    if (!$("hBig")) {
      h.innerHTML = `<p class="h-label" id="hLabel"></p><span class="h-big" id="hBig"></span>
        <p class="h-unit">Estimated coronary heart disease deaths per 100,000 people aged 35 and older, per year</p>
        <div class="cmp" id="hCmp" role="img"></div>
        <p class="h-plain" id="hPlain"></p><div class="h-flag" id="hFlag"></div>`;
    }
    $("hLabel").textContent = isScenario ? "Your scenario" : `Starting point: ${S.baselineState === "mean" ? `average of ${nJur()} jurisdictions` : stateName(S.baselineState)}`;
    tween($("hBig"), r.scenario.estimate);
    renderCompare(r, isScenario);
    let plain = "";
    if (isScenario && moved) {
      const excl = d.ci_low > 0 || d.ci_high < 0;
      plain = `Your scenario is estimated to be <b>${fmt(Math.abs(d.delta), 1)} deaths per 100,000 ${d.delta < 0 ? "lower" : "higher"}</b> than the starting point. ` +
        `Uncertainty range: ${signed(d.ci_low, 1)} to ${signed(d.ci_high, 1)}${excl ? "." : ", so the model cannot rule out no change."}`;
    } else if (S.baselineState !== "mean") {
      const s = stateRow(S.baselineState);
      plain = `${esc(s.state_name)}’s observed rate in 1998 was ${fmt(s.observed_rate, 1)}. The starting point is the model’s estimate for its four factors.`;
    } else if (isScenario) {
      plain = "Your scenario gives the same estimate as the starting point.";
    } else {
      plain = "This is the starting point. Drag a slider, type a value or try a preset to see how the estimate changes.";
    }
    $("hPlain").innerHTML = plain;
    $("hPlain").hidden = !plain;

    const fv = ch.find((i) => i.variable === "fruit_veg") && signIssue("fruit_veg");
    $("hFlag").innerHTML = fv ? `<details class="flagbox"><summary class="flag">Why does ${ch.find((i) => i.variable === "fruit_veg").change < 0 ? "lowering" : "raising"} low fruit &amp; veg intake move the estimate this way?</summary>
      <p class="f-tip">In this model, states with more adults eating little fruit and vegetables had slightly lower rates once the other three factors are taken into account. That is a statistical pattern across states, probably because diet overlaps with the other factors. It does not mean a poor diet protects the heart. <a href="#/model" data-goto="m-coef">Read the full explanation</a></p></details>` : "";
    $("hFlag").querySelectorAll("[data-goto]").forEach((a) => a.addEventListener("click", () => { S.gotoAfter = a.dataset.goto; }));

    renderWhy(r, ch);
    if ($("advBox").open) renderAdvanced();
    drawCharts();
    renderPathway(r.policy);
    const extra = r.warnings.filter((w) => !/outside the observed state range/.test(w));
    $("warnings").innerHTML = extra.map((w) => `<li>${esc(w)}</li>`).join("");
    $("mini").innerHTML = `<b>${fmt(r.scenario.estimate, 1)}</b><span>deaths per 100,000</span><span class="md">${isScenario && moved ? signed(d.delta, 1) : "starting point"}</span>`;
    h.classList.remove("tick"); void h.offsetWidth; h.classList.add("tick");
  }

  /* Starting point and scenario side by side, both measured from zero on one fixed scale (up to the highest observed
     state rate), so the length of each bar is the estimate itself. The scenario bar carries its uncertainty range and
     a tick where the starting point ends. */
  function renderCompare(r, isScenario) {
    const hi = Math.max(...S.data.states.map((s) => s.observed_rate), r.baseline.estimate, r.scenario.ci_high) * 1.04;
    const w = (x) => `${Math.max(0, Math.min(100, (x / hi) * 100)).toFixed(2)}%`;
    const sc = r.scenario;
    $("hCmp").setAttribute("aria-label", `Starting point ${fmt(r.baseline.estimate, 1)}; your scenario ${fmt(sc.estimate, 1)}, uncertainty range ${fmt(sc.ci_low, 1)} to ${fmt(sc.ci_high, 1)}.`);
    if (!$("cmpBase")) {
      $("hCmp").innerHTML = `
        <div class="cmp-row base"><span class="cmp-k">Starting point</span><span class="cmp-bar"><i id="cmpBase"></i></span><span class="cmp-v" id="cmpBaseV"></span></div>
        <div class="cmp-row scen"><span class="cmp-k">Your scenario</span><span class="cmp-bar"><i id="cmpScen"></i><em id="cmpCi"></em><b id="cmpTick"></b></span><span class="cmp-v" id="cmpScenV"></span></div>`;
    }
    $("cmpBase").style.width = w(r.baseline.estimate); $("cmpBaseV").textContent = fmt(r.baseline.estimate, 1);
    $("cmpScen").style.width = w(sc.estimate); $("cmpScenV").textContent = fmt(sc.estimate, 1);
    $("cmpCi").style.left = w(sc.ci_low); $("cmpCi").style.width = `calc(${w(sc.ci_high)} - ${w(sc.ci_low)})`;
    $("cmpTick").style.left = w(r.baseline.estimate);
    $("hCmp").classList.toggle("same", !isScenario);
  }

  /* Statistical details for readers who want them, folded under the result. */
  function renderAdvanced() {
    const m = fullModel(), r = S.last, a = m.alpha;
    if (!r) return;
    const row = (name, x) => `<tr><td class="term">${name}</td><td>${fmt(x.estimate, 1)}</td><td>${fmt(x.ci_low, 1)} to ${fmt(x.ci_high, 1)}</td><td>${fmt(x.pi_low, 1)} to ${fmt(x.pi_high, 1)}</td></tr>`;
    const d = r.difference;
    $("advBody").innerHTML = `
      <dl class="adv-stats">
        <div><dt>R²</dt><dd>${fmt(m.r_squared, 3)}</dd></div>
        <div><dt>Adjusted R²</dt><dd>${fmt(m.adj_r_squared, 3)}</dd></div>
        <div><dt>F(${m.df_model}, ${m.df_resid})</dt><dd>${fmt(m.f_statistic, 2)} <small>p ${pfmt(m.f_p_value)}</small></dd></div>
        <div><dt>Jurisdictions</dt><dd>${m.n}</dd></div>
      </dl>
      <div class="table-scroll"><table class="data compact"><caption class="sr-only">Coefficients</caption>
        <thead><tr><th>Factor</th><th>Per +1 point</th><th>95% CI</th><th>p</th><th>p (HC3)</th></tr></thead>
        <tbody>${m.coefficients.filter((c) => c.term !== "const").map((c) => `<tr><td class="term">${esc(NAMES[c.term])}</td><td>${signed(c.estimate, 2)}</td><td>${fmt(c.ci_low, 2)} to ${fmt(c.ci_high, 2)}</td><td class="${c.p_value < a ? "" : "ns"}">${pfmt(c.p_value)}</td><td class="${c.hc3_p_value < a ? "" : "ns"}">${pfmt(c.hc3_p_value)}</td></tr>`).join("")}</tbody></table></div>
      <div class="table-scroll"><table class="data compact"><caption class="sr-only">This scenario</caption>
        <thead><tr><th>This scenario</th><th>Estimate</th><th>95% CI</th><th>95% prediction interval</th></tr></thead>
        <tbody>${row("Starting point", r.baseline)}${row("Your scenario", r.scenario)}
          <tr><td class="term">Change</td><td>${signed(d.delta, 1)}</td><td>${signed(d.ci_low, 1)} to ${signed(d.ci_high, 1)}</td><td class="ns">SE ${fmt(d.std_error, 2)}</td></tr></tbody></table></div>
      <p class="foot">The uncertainty range shown above is the 95% confidence interval for the change. The prediction interval is wider: it is where a single state’s rate would be expected to fall.</p>
      <p class="out-more"><a href="#/model" data-goto="m-unc">All model evidence: diagnostics, Monte Carlo and sensitivity</a></p>`;
    $("advBody").querySelectorAll("[data-goto]").forEach((x) => x.addEventListener("click", () => { S.gotoAfter = x.dataset.goto; }));
  }

  function drawCharts() {
    const r = S.last; if (!r || $("simulate").hidden) return;
    const label = `Estimate ${fmt(r.scenario.estimate, 1)}, starting point ${fmt(r.baseline.estimate, 1)}, shown against the observed 1998 rates of ${nJur()} jurisdictions.`;
    if (!$("rangeSvg")) {
      $("rangeChart").innerHTML = `<div class="section-h">Compared with the states</div><div id="rangeSvg"></div>
        <p class="legend"><span><i class="lg-state"></i>States in 1998</span><span><i class="lg-start"></i>Starting point</span><span><i class="lg-scen"></i>Your scenario, with its uncertainty range</span></p>`;
    }
    Charts.range($("rangeSvg"), {
      states: S.data.states.map((s) => ({ rate: s.observed_rate, name: s.state_name })),
      baseline: r.baseline.estimate, scenario: r.scenario, pins: [], label,
    });
    if (S.lastWhy && $("whyBars")) Charts.bars($("whyBars"), S.lastWhy, { label: "Estimated contribution of each factor to the change" });
  }

  function renderWhy(r, ch) {
    if (!ch.length) { $("whyPanel").innerHTML = ""; S.lastWhy = null; return; }
    S.lastWhy = r.inputs.map((i) => ({ name: NAMES[i.variable], value: i.contribution, muted: !i.in_model,
      flag: i.variable === "fruit_veg" && Math.abs(i.change) > 1e-9 && !!signIssue("fruit_veg"),
      text: !i.in_model ? "not in model" : Math.abs(i.change) > 1e-9 ? signed(i.contribution, 1) : "unchanged" }));
    if (!$("whyBars")) $("whyPanel").innerHTML = `<div class="section-h">Estimated contribution to the change <span>deaths per 100,000</span></div><div id="whyBars"></div>`;
  }

  function renderPathway(p) {
    const el = $("pathway");
    if (!p || !(S.price > 0)) { el.hidden = true; return; }
    el.hidden = false;
    const reg = p.regression_effect;
    el.innerHTML = `<ol class="steps">
        <li><span class="k">Price</span><span class="v">+${fmt(p.price_increase_pct, 0)}%</span><span class="n">your choice</span></li>
        <li class="a"><span class="k">Share who smoke</span><span class="v">${signed(p.prevalence_change_pct, 1)}%</span><span class="n">assumed</span></li>
        <li><span class="k">Smoking</span><span class="v">${p.smoking_base == null ? "–" : `${fmt(p.smoking_new, 1)}%`}</span><span class="n">${p.smoking_base == null ? "not in this model" : `from ${fmt(p.smoking_base, 1)}%`}</span></li>
        <li class="o"><span class="k">Estimate</span><span class="v">${reg ? signed(reg.delta, 1) : "–"}</span><span class="n">${reg ? `range ${signed(reg.ci_low, 1)} to ${signed(reg.ci_high, 1)}` : "smoking not in model"}</span></li>
      </ol>
      <p class="demand">Published research: a ${fmt(p.price_increase_pct, 0)}% price rise cuts cigarettes bought by about <b>${fmt(Math.abs(p.demand_change_pct), 1)}%</b> (Bader, Boisclair &amp; Ferrence, 2011). Buying fewer cigarettes is not the same as fewer people smoking, so this figure is not used in the model.</p>`;
  }

  function setupMini() {
    const mini = $("mini");
    new IntersectionObserver((en) => { mini.classList.toggle("show", !en[0].isIntersecting && !$("simulate").hidden); }, { rootMargin: "-60px 0px 0px 0px" }).observe($("headline"));
  }

  /* Uncertainty of the current scenario: shown on the Model evidence page, not in the simulator. */
  function renderCertainty(r) {
    const host = $("m-unc-body"); if (!host) return;
    if (!r) { host.innerHTML = `<p>Build a scenario in the <a href="#/simulate">simulator</a> to see its uncertainty here.</p>`; return; }
    const mc = r.monte_carlo;
    const row = (name, x) => `<tr><td class="term">${name}</td><td>${fmt(x.estimate, 1)}</td><td>${fmt(x.ci_low, 1)} to ${fmt(x.ci_high, 1)}</td><td>${fmt(x.pi_low, 1)} to ${fmt(x.pi_high, 1)}</td></tr>`;
    const varyOK = S.price > 0;
    host.innerHTML = `
      <p class="lead">The simulator’s “uncertainty range” is the 95% confidence interval: it reflects uncertainty in the fitted coefficients. The prediction interval is wider: it is where a single state’s rate would be expected to fall, given everything the four factors leave unexplained.</p>
      <div class="table-scroll"><table class="data"><thead><tr><th></th><th>Estimate</th><th>95% CI</th><th>95% prediction interval</th></tr></thead>
        <tbody>${row("Starting point", r.baseline)}${row("Your scenario", r.scenario)}</tbody></table></div>
      <h3>Monte Carlo</h3>
      ${mc && mc.sd > 1e-12 ? `<p>Re-running the scenario with ${mc.draws.toLocaleString()} plausible sets of coefficients${mc.elasticity_range ? ` and a smoking response drawn between ${fmt(mc.elasticity_range[0], 2)} and ${fmt(mc.elasticity_range[1], 2)}` : ""}: the middle 95% of changes run from ${fmt(mc.quantiles.p2_5, 1)} to ${fmt(mc.quantiles.p97_5, 1)}, and ${fmt(mc.prob_decrease * 100, 1)}% are below zero.</p><div id="mcSvg"></div>` : `<p>The scenario equals the starting point, so there is no change to simulate.</p>`}
      <label class="custom" style="justify-content:flex-start;gap:10px;font-size:14px"><input type="checkbox" id="varyE" ${S.varyE ? "checked" : ""} ${varyOK ? "" : "disabled"}>Also vary the assumed smoking response from 0 to −0.40${varyOK ? "" : " (needs a cigarette price rise in the simulator)"}</label>`;
    if (mc && mc.sd > 1e-12) Charts.histogram($("mcSvg"), mc);
    $("varyE").addEventListener("change", async (e) => { S.varyE = e.target.checked; await runNow(); renderCertainty(S.last); });
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
    renderCertainty(S.last);
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

      <section class="doc-sec" id="m-unc"><h2>Uncertainty in your scenario</h2><div id="m-unc-body"></div></section>

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
    toc("modelToc", [["m-brief", "In brief"], ["m-unc", "Your scenario"], ["m-coef", "Coefficients"], ["m-fit", "How well it predicts"], ["m-checks", "Checks on the assumptions"], ["m-infl", "Influential states"], ["m-select", "Model selection"], ["m-sens", "Sensitivity"]]);
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
    const st = S.status, d = st.dataset, src = st.source || {};
    const vars = ["heart_disease", ...PREDICTORS];
    $("methodsBody").innerHTML = `
      <section class="doc-sec" id="x-what"><h2>What HEARTLAB estimates</h2>
        <p class="lead">A multiple linear regression across U.S. jurisdictions: the age-adjusted coronary heart disease death rate among adults aged 35 and over, regressed on four behavioural risk factors measured in the same states.</p>
        <div class="eq">${esc(st.specification.equation)}</div>
        <p style="margin-top:14px">A scenario changes one or more factor values and asks what the fitted equation gives for them. The difference from the start is the scenario’s change, with a 95% confidence interval from the coefficients’ estimated uncertainty. The model follows Gordon &amp; Guilfoos (2017), Chapter 14, §14.3.6.</p>
      </section>

      <section class="doc-sec" id="x-data"><h2>Data</h2>
        ${d ? `<div class="table-scroll"><table class="data text"><thead><tr><th>Variable</th><th>Unit</th><th>Definition</th></tr></thead><tbody>
          ${vars.map((k) => `<tr><td class="term">${esc(k === "heart_disease" ? "CHD death rate" : LONG[k])}</td><td style="text-align:left">${esc(V(k).unit || "–")}</td><td class="wrap">${esc(V(k).definition || "–")}</td></tr>`).join("")}
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
        <p>Drop the state-level CDC file here, or choose it. HEARTLAB checks the columns, fits the model and opens the simulator.</p>
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
    if (S.status.ready) [S.model, S.data] = await Promise.all([api("/api/model"), api("/api/states")]);
    $("syntheticBanner").hidden = !(S.status.ready && S.status.dataset.synthetic);
    document.querySelectorAll("[data-goto]").forEach((a) => a.addEventListener("click", () => { S.gotoAfter = a.dataset.goto; }));
    window.addEventListener("hashchange", route);
    window.addEventListener("resize", debounce(() => { drawCharts(); drawModelCharts(); }, 150));
    route();
  }
  boot().catch((e) => {
    document.body.insertAdjacentHTML("afterbegin", `<p class="banner">The HEARTLAB backend is not responding (${esc(e.message)}). Start it with ./run.sh.</p>`);
  });
})();
