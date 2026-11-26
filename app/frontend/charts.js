/* Heartlab charts: small SVG renderers. They only draw numbers returned by the Python backend.
   Colours come from CSS custom properties, so every chart follows the light/dark theme. */
(function () {
  const v = (name) => `var(--${name})`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const W = (el, lo = 280, hi = 980) => Math.max(lo, Math.min(hi, Math.round(el.clientWidth || el.parentElement?.clientWidth || 600)));

  function scale(d0, d1, r0, r1) { const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0); return (x) => r0 + (x - d0) * k; }
  function niceTicks(lo, hi, n = 5) {
    if (lo === hi) { lo -= 1; hi += 1; }
    const span = hi - lo, step0 = Math.pow(10, Math.floor(Math.log10(span / n)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * step0).find((s) => span / s <= n) || step0 * 10;
    const out = [];
    for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(+t.toFixed(10));
    return out;
  }
  const fmt = (x, d = 2) => (x == null || !isFinite(x)) ? "–" : Number(x).toFixed(d).replace("-", "−");
  const signed = (x, d = 2) => (x == null || !isFinite(x)) ? "–" : (Math.abs(x) < 0.5 * Math.pow(10, -d) ? "±" : x > 0 ? "+" : "−") + Math.abs(x).toFixed(d);
  const tickFmt = (t) => fmt(t, Math.abs(t) >= 10 || t === 0 ? 0 : 1);
  const wrap = (svg, desc) => `<div class="chart">${svg}</div>${desc ? `<p class="sr-only">${esc(desc)}</p>` : ""}`;
  const st = (o) => `style="${Object.entries(o).map(([k, x]) => `${k}:${x}`).join(";")}"`;

  /* The headline chart: every jurisdiction's observed rate as a dot, the starting estimate, the scenario estimate with its
     95% confidence interval, and any kept scenarios. One axis, in the outcome's own units. */
  function range(el, o) {
    const w = W(el, 300, 900), H = 118, padL = 10, padR = 10, axisY = 64;
    const all = [...o.states.map((s) => s.rate), o.baseline, o.scenario.estimate, o.scenario.ci_low, o.scenario.ci_high, ...o.pins.map((p) => p.estimate)];
    let lo = Math.min(...all), hi = Math.max(...all); const pad = (hi - lo) * .04; lo -= pad; hi += pad;
    const x = scale(lo, hi, padL, w - padR);
    let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="${esc(o.label)}">`;
    niceTicks(lo, hi, Math.max(3, Math.floor(w / 110))).forEach((t) => {
      s += `<line x1="${x(t)}" x2="${x(t)}" y1="${axisY + 14}" y2="${axisY + 18}" ${st({ stroke: v("line-2") })}/><text x="${x(t)}" y="${H - 4}" text-anchor="middle">${tickFmt(t)}</text>`;
    });
    s += `<line x1="${padL}" x2="${w - padR}" y1="${axisY + 14}" y2="${axisY + 14}" ${st({ stroke: v("line-2") })}/>`;
    o.states.slice().sort((a, b) => a.rate - b.rate).forEach((d, i) => {
      s += `<circle cx="${x(d.rate)}" cy="${axisY + (i % 2 ? 3 : -3)}" r="3.4" ${st({ fill: v("dot") })}><title>${esc(d.name)}: observed ${fmt(d.rate, 1)}</title></circle>`;
    });
    o.pins.forEach((p, i) => {
      s += `<circle cx="${x(p.estimate)}" cy="${axisY}" r="8" ${st({ fill: v("bg"), stroke: v("ink-2"), "stroke-width": 1.5 })}/>` +
        `<text x="${x(p.estimate)}" y="${axisY + 4}" text-anchor="middle" ${st({ fill: v("ink"), "font-size": "11px", "font-weight": 700 })}>${i + 1}</text>`;
    });
    const xb = x(o.baseline), xs = x(o.scenario.estimate);
    s += `<line x1="${xb}" x2="${xb}" y1="${axisY - 30}" y2="${axisY + 12}" ${st({ stroke: v("base"), "stroke-width": 2.5 })}/>`;
    s += `<rect x="${x(o.scenario.ci_low)}" y="${axisY - 6}" width="${Math.max(2, x(o.scenario.ci_high) - x(o.scenario.ci_low))}" height="12" rx="6" ${st({ fill: v("accent"), "fill-opacity": .22 })}/>`;
    if (Math.abs(xs - xb) > 14) {
      const dir = xs < xb ? -1 : 1;
      s += `<path d="M${xb + dir * 4},${axisY - 22} L${xs - dir * 6},${axisY - 22}" ${st({ stroke: v("accent"), "stroke-width": 1.5, fill: "none" })}/>` +
        `<path d="M${xs - dir * 6},${axisY - 26} L${xs - dir * 1},${axisY - 22} L${xs - dir * 6},${axisY - 18}" ${st({ stroke: v("accent"), "stroke-width": 1.5, fill: "none", "stroke-linejoin": "round" })}/>`;
    }
    s += `<circle cx="${xs}" cy="${axisY}" r="7" ${st({ fill: v("accent"), stroke: v("bg"), "stroke-width": 2 })}/>`;
    if (Math.abs(xs - xb) < 2) {
      s += `<text x="${Math.min(w - 90, Math.max(90, xb))}" y="${axisY - 36}" text-anchor="middle" ${st({ fill: v("ink-2"), "font-weight": 650, "font-size": "13px" })}>Scenario = start, ${fmt(o.baseline, 1)}</text>`;
    } else {
      const left = xs < xb;
      const lab = (xx, anchor, fill, t) => `<text x="${Math.min(w - 4, Math.max(4, xx + (anchor === "start" ? 6 : -6)))}" y="${axisY - 36}" text-anchor="${anchor}" ${st({ fill, "font-weight": 650, "font-size": "13px" })}>${t}</text>`;
      s += lab(xb, left ? "start" : "end", v("base"), `Start ${fmt(o.baseline, 1)}`);
      s += lab(xs, left ? "end" : "start", v("accent"), `Scenario ${fmt(o.scenario.estimate, 1)}`);
    }
    el.innerHTML = wrap(s + `</svg>`);
  }

  /* Horizontal bars: change in the estimate attributed to each factor. */
  function bars(el, items, opts = {}) {
    const w = W(el, 280, 900), rowH = 32, padL = Math.min(180, w * .38), padR = 70, H = items.length * rowH + 4;
    const m = Math.max(1e-9, ...items.map((d) => Math.abs(d.value)));
    const x = scale(-m, m, padL, w - padR);
    let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="${esc(opts.label || "bar chart")}">`;
    s += `<line x1="${x(0)}" x2="${x(0)}" y1="0" y2="${H}" ${st({ stroke: v("line-2") })}/>`;
    items.forEach((d, i) => {
      const y = i * rowH, x0 = x(Math.min(0, d.value)), bw = Math.abs(x(d.value) - x(0));
      const fill = d.muted ? v("line") : v("ink-2");
      s += `<text class="lab" x="0" y="${y + 20}">${esc(d.name)}</text>`;
      if (Math.abs(d.value) > 1e-9) s += `<rect x="${x0}" y="${y + 8}" width="${Math.max(bw, 2)}" height="16" rx="3" ${st({ fill })}/>`;
      s += `<text class="val" x="${w}" y="${y + 20}" text-anchor="end" ${Math.abs(d.value) > 1e-9 ? "" : st({ fill: v("ink-3"), "font-weight": 500 })}>${esc(d.text ?? signed(d.value, 1))}</text>`;
    });
    el.innerHTML = wrap(s + `</svg>`);
  }

  /* Histogram of Monte Carlo draws of the change. */
  function histogram(el, mc) {
    if (!(mc.sd > 1e-12)) { el.innerHTML = ""; return; }
    const w = W(el, 260, 560), H = 140, padB = 22, padT = 20;
    const { counts, edges } = mc.histogram, q = mc.quantiles;
    const x = scale(edges[0], edges[edges.length - 1], 6, w - 6);
    const y = scale(0, Math.max(...counts), H - padB, padT);
    let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="Distribution of ${mc.draws} simulated changes, median ${fmt(q.p50)}, middle 95% from ${fmt(q.p2_5)} to ${fmt(q.p97_5)}">`;
    counts.forEach((c, i) => {
      const x0 = x(edges[i]), x1 = x(edges[i + 1]);
      const inside = edges[i + 1] >= q.p2_5 && edges[i] <= q.p97_5;
      s += `<rect x="${x0 + .5}" y="${y(c)}" width="${Math.max(.5, x1 - x0 - 1)}" height="${H - padB - y(c)}" ${st({ fill: inside ? v("ink-2") : v("line-2") })}/>`;
    });
    if (edges[0] <= 0 && edges[edges.length - 1] >= 0) s += `<line x1="${x(0)}" x2="${x(0)}" y1="${padT - 6}" y2="${H - padB}" ${st({ stroke: v("ink-3"), "stroke-dasharray": "3 3" })}/><text x="${x(0)}" y="${padT - 8}" text-anchor="middle">0</text>`;
    s += `<line x1="${x(q.p50)}" x2="${x(q.p50)}" y1="${padT - 6}" y2="${H - padB}" ${st({ stroke: v("accent"), "stroke-width": 2 })}/>`;
    s += `<text x="${x(q.p2_5)}" y="${H - 5}" text-anchor="middle">${fmt(q.p2_5, 1)}</text><text x="${x(q.p97_5)}" y="${H - 5}" text-anchor="middle">${fmt(q.p97_5, 1)}</text>`;
    el.innerHTML = wrap(s + `</svg>`);
  }

  /* Tornado: estimate at −1 SD and +1 SD of each predictor. */
  function tornado(el, rows, labels) {
    const w = W(el, 300, 760), rowH = 36, padL = Math.min(200, w * .36), padR = 14, H = rows.length * rowH + 34;
    const base = rows[0].baseline_yhat;
    const m = Math.max(1e-9, ...rows.flatMap((r) => [r.yhat_minus_1sd, r.yhat_plus_1sd]).map((t) => Math.abs(t - base)));
    const x = scale(base - m, base + m, padL, w - padR);
    let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="Estimate when each factor moves one standard deviation down or up from the starting estimate ${fmt(base)}">`;
    rows.forEach((r, i) => {
      const y = 6 + i * rowH;
      s += `<text class="lab" x="0" y="${y + 15}">${esc(labels[r.variable] || r.variable)}</text>`;
      [[r.yhat_minus_1sd, v("base")], [r.yhat_plus_1sd, v("accent")]].forEach(([t, fill]) => {
        s += `<rect x="${Math.min(x(t), x(base))}" y="${y + 3}" width="${Math.abs(x(t) - x(base))}" height="16" rx="3" ${st({ fill })}/>`;
      });
    });
    s += `<line x1="${x(base)}" x2="${x(base)}" y1="0" y2="${H - 24}" ${st({ stroke: v("ink"), "stroke-width": 1.5 })}/>`;
    s += `<text x="${x(base)}" y="${H - 6}" text-anchor="middle">${fmt(base, 1)}</text>`;
    s += `<text x="${padL}" y="${H - 6}" ${st({ fill: v("base"), "font-weight": 600 })}>factor −1 SD</text><text x="${w - padR}" y="${H - 6}" text-anchor="end" ${st({ fill: v("accent"), "font-weight": 600 })}>factor +1 SD</text></svg>`;
    el.innerHTML = wrap(s);
  }

  /* Change in estimate vs price increase, one line per assumed prevalence elasticity. */
  function policyLines(el, rows, current) {
    const w = W(el, 300, 760), H = 230, padL = 46, padR = 84, padT = 14, padB = 28;
    const prices = [...new Set(rows.map((r) => r.price_increase_pct))], pmax = Math.max(...prices);
    const elas = [...new Set(rows.map((r) => r.prevalence_elasticity))];
    const ys = rows.map((r) => r.delta_yhat);
    let lo = Math.min(0, ...ys), hi = Math.max(0, ...ys);
    if (lo === hi) { lo -= 1; hi += 1; }
    const x = scale(0, pmax, padL, w - padR), y = scale(lo, hi, H - padB, padT);
    let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="Change in the estimate against price increase for each assumed prevalence elasticity">`;
    niceTicks(lo, hi, 4).forEach((t) => { s += `<line class="grid" x1="${padL}" x2="${w - padR}" y1="${y(t)}" y2="${y(t)}"/><text x="${padL - 8}" y="${y(t) + 4}" text-anchor="end">${tickFmt(t)}</text>`; });
    [0, ...prices].filter((p) => p % 10 === 0 || p === pmax || p === 25).forEach((p) => { s += `<text x="${x(p)}" y="${H - 8}" text-anchor="middle">+${p}%</text>`; });
    const used = [];
    elas.slice().sort((a, b) => b - a).forEach((e) => {
      const pts = rows.filter((r) => r.prevalence_elasticity === e).sort((a, b) => a.price_increase_pct - b.price_increase_pct);
      const isCur = Math.abs(e - current) < 1e-9;
      const col = isCur ? v("amber") : e === 0 ? v("ink-3") : v("line-2");
      const d = [[0, 0], ...pts.map((r) => [r.price_increase_pct, r.delta_yhat])].map(([a, b], k) => `${k ? "L" : "M"}${x(a)},${y(b)}`).join(" ");
      s += `<path d="${d}" ${st({ fill: "none", stroke: col, "stroke-width": isCur ? 2.5 : 1.5 })}/>`;
      let ly = y(pts[pts.length - 1].delta_yhat) + 4;
      while (used.some((u) => Math.abs(u - ly) < 14)) ly += 14;
      used.push(ly);
      s += `<text x="${w - padR + 8}" y="${ly}" ${isCur ? st({ fill: v("amber"), "font-weight": 650 }) : ""}>${e === 0 ? "none" : fmt(e, 2)}</text>`;
    });
    el.innerHTML = wrap(s + `</svg>`);
  }

  /* Observed vs fitted, one point per jurisdiction, flagged points labelled. */
  function scatter(el, obs, unit) {
    const w = W(el, 300, 680), H = Math.round(Math.min(400, w * 0.7)), pad = { l: 48, r: 16, t: 12, b: 40 };
    const vals = obs.flatMap((o) => [o.observed, o.fitted]);
    let lo = Math.min(...vals), hi = Math.max(...vals); const p = (hi - lo) * .06; lo -= p; hi += p;
    const x = scale(lo, hi, pad.l, w - pad.r), y = scale(lo, hi, H - pad.b, pad.t);
    let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="Observed against fitted ${esc(unit)} for ${obs.length} jurisdictions">`;
    niceTicks(lo, hi, 5).forEach((t) => {
      s += `<line class="grid" x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${tickFmt(t)}</text>`;
      s += `<text x="${x(t)}" y="${H - pad.b + 16}" text-anchor="middle">${tickFmt(t)}</text>`;
    });
    s += `<line x1="${x(lo)}" y1="${y(lo)}" x2="${x(hi)}" y2="${y(hi)}" ${st({ stroke: v("ink-3"), "stroke-dasharray": "4 4" })}/>`;
    obs.forEach((o) => {
      const flag = o.influential || o.outlier;
      s += `<circle cx="${x(o.fitted)}" cy="${y(o.observed)}" r="${flag ? 5 : 4}" ${st({ fill: flag ? v("accent") : v("ink-2"), "fill-opacity": flag ? 1 : .55 })}><title>${esc(o.state)}: observed ${fmt(o.observed, 1)}, fitted ${fmt(o.fitted, 1)}</title></circle>`;
      if (flag) s += `<text class="val" x="${x(o.fitted) + 8}" y="${y(o.observed) + 4}">${esc(o.state)}</text>`;
    });
    s += `<text x="${(pad.l + w - pad.r) / 2}" y="${H - 4}" text-anchor="middle">Fitted by the model</text>`;
    s += `<text x="12" y="${(pad.t + H - pad.b) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(pad.t + H - pad.b) / 2})">Observed</text></svg>`;
    el.innerHTML = wrap(s);
  }

  /* One forest row: CI and point on a shared symmetric scale. */
  function forest(lo, est, hi, m) {
    const w = 180, x = scale(-m, m, 6, w - 6);
    const col = lo > 0 || hi < 0 ? v("accent") : v("ink-3");
    return `<svg viewBox="0 0 ${w} 22" width="${w}" height="22" aria-hidden="true"><line x1="${x(0)}" x2="${x(0)}" y1="1" y2="21" ${st({ stroke: v("line-2"), "stroke-dasharray": "2 2" })}/>` +
      `<line x1="${x(lo)}" x2="${x(hi)}" y1="11" y2="11" ${st({ stroke: col, "stroke-width": 3, "stroke-linecap": "round" })}/>` +
      `<circle cx="${x(est)}" cy="11" r="4.5" ${st({ fill: v("bg"), stroke: col, "stroke-width": 2 })}/></svg>`;
  }

  window.Charts = { range, bars, histogram, tornado, policyLines, scatter, forest, fmt, signed };
})();
