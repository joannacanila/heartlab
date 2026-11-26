/* HEARTLAB landing field. The 51 jurisdictions of the loaded dataset drawn at their real values, like a plotted
   plate behind the title: x = share of adults who smoke, y = observed 1998 CHD death rate (higher is up).
   Moving the pointer lights the ground around it and dimensions the nearest jurisdiction to both axes.
   Everything drawn here is observed data from /api/states; no model estimate appears on the landing page. */
(function () {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  function mount(canvas, opts) {
    const { states, area, readout, colorsFrom } = opts;
    const ctx = canvas.getContext("2d");
    if (!ctx || !states?.length) return null;
    const xs = states.map((s) => s.smoking), ys = states.map((s) => s.observed_rate);
    const pad = (lo, hi, f) => [lo - (hi - lo) * f, hi + (hi - lo) * f];
    const [x0, x1] = pad(Math.min(...xs), Math.max(...xs), 0.06), [y0, y1] = pad(Math.min(...ys), Math.max(...ys), 0.08);
    let W = 0, H = 0, dpr = 1, box = null, C = null, hot = -1, born = 0, raf = 0;
    const ptr = { x: -1e4, y: -1e4, in: false };

    function readColors() {
      const cs = getComputedStyle(colorsFrom || document.documentElement);
      const g = (n, f) => (cs.getPropertyValue(n) || f).trim();
      C = { dot: g("--l-dot", "#8a8fa3"), ink: g("--l-ink", "#eef0f6"), ink3: g("--l-ink-3", "#8a8fa3"), hair: g("--l-hair", "rgba(238,240,246,.12)"), accent: g("--l-accent", "#ff5a70") };
    }

    /* The plotting box: wide and low on desktop so the points read as a field, clear of the bar and the readout. */
    function layout() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      const mx = Math.max(28, W * 0.07), top = Math.max(108, H * 0.15), bottom = Math.max(104, H * 0.14);
      box = { l: mx + 20, r: W - mx, t: top, b: H - bottom };
    }
    const px = (x) => box.l + ((x - x0) / (x1 - x0)) * (box.r - box.l);
    const py = (y) => box.b - ((y - y0) / (y1 - y0)) * (box.b - box.t);

    function nearest() {
      if (!ptr.in) return -1;
      let best = -1, bd = 64 * 64;
      states.forEach((s, i) => { const dx = px(s.smoking) - ptr.x, dy = py(s.observed_rate) - ptr.y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } });
      return best;
    }

    function draw(now) {
      raf = 0;
      const t = reduce.matches ? 1 : Math.min(1, (now - born) / 1400);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.font = `400 11px "Fragment Mono", ui-monospace, monospace`;
      ctx.textBaseline = "alphabetic";

      // axes: two hairlines with sparse ticks, drafted in from the corner
      const ax = Math.min(1, t * 1.6);
      ctx.strokeStyle = C.hair; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(box.l, box.b + 14); ctx.lineTo(box.l + (box.r - box.l) * ax, box.b + 14); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(box.l - 14, box.b); ctx.lineTo(box.l - 14, box.b - (box.b - box.t) * ax); ctx.stroke();
      ctx.globalAlpha = ax;
      ctx.fillStyle = C.ink3;
      const step = (lo, hi, n) => { const raw = (hi - lo) / n, m = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 5, 10].map((k) => k * m).find((k) => k >= raw); };
      const sx = step(x0, x1, 5), sy = step(y0, y1, 4);
      ctx.textAlign = "center";
      for (let v = Math.ceil(x0 / sx) * sx; v <= x1; v += sx) { const X = px(v); ctx.fillRect(X, box.b + 14, 1, 5); ctx.fillText(`${v}%`, X, box.b + 32); }
      ctx.textAlign = "right";
      for (let v = Math.ceil(y0 / sy) * sy; v <= y1; v += sy) { const Y = py(v); ctx.fillRect(box.l - 19, Y, 5, 1); ctx.fillText(String(v), box.l - 24, Y + 4); }
      ctx.textAlign = "right";
      ctx.fillText("adults who smoke, % →", box.r, box.b + 52);
      ctx.textAlign = "left";
      ctx.fillText("↑ CHD deaths per 100,000, 1998", box.l - 14, box.t - 18);
      ctx.globalAlpha = 1;

      // the jurisdictions: each appears in turn, ordered by smoking, so the plate develops left to right
      hot = nearest();
      const order = states.map((s, i) => i).sort((a, b) => states[a].smoking - states[b].smoking);
      order.forEach((i, k) => {
        const a = Math.max(0, Math.min(1, t * 1.8 - (k / order.length) * 0.8));
        if (!a) return;
        const s = states[i], X = px(s.smoking), Y = py(s.observed_rate);
        const dx = X - ptr.x, dy = Y - ptr.y, near = ptr.in ? Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / 220) : 0;
        ctx.globalAlpha = a * (0.42 + 0.5 * near);
        ctx.fillStyle = i === hot ? C.accent : C.dot;
        ctx.beginPath(); ctx.arc(X, Y + (1 - a) * 8, i === hot ? 4 : 2.4 + near * 1.2, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;

      // dimension the nearest jurisdiction to both axes
      if (hot >= 0) {
        const s = states[hot], X = px(s.smoking), Y = py(s.observed_rate);
        ctx.strokeStyle = C.accent; ctx.globalAlpha = 0.55; ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(X, Y + 7); ctx.lineTo(X, box.b + 14); ctx.moveTo(X - 7, Y); ctx.lineTo(box.l - 14, Y); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(X, Y, 9, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = C.accent;
        ctx.textAlign = "center"; ctx.fillText(`${s.smoking.toFixed(1)}%`, X, box.b + 32 + 14);
        ctx.textAlign = "right"; ctx.fillText(s.observed_rate.toFixed(1), box.l - 24, Y - 8);
      }
      if (readout) {
        readout.innerHTML = hot >= 0
          ? `<b>${states[hot].state_name}</b><span>${states[hot].smoking.toFixed(1)}% of adults smoked</span><span>${states[hot].observed_rate.toFixed(1)} CHD deaths per 100,000</span>`
          : `<b>${states.length} jurisdictions, 1998</b><span>Move across the field to read a state</span>`;
      }
      if (t < 1) raf = requestAnimationFrame(draw);
    }
    const redraw = () => { if (!raf) raf = requestAnimationFrame(draw); };

    const move = (e) => {
      const r = canvas.getBoundingClientRect();
      ptr.x = e.clientX - r.left; ptr.y = e.clientY - r.top; ptr.in = true;
      area.style.setProperty("--mx", `${(ptr.x / W) * 100}%`); area.style.setProperty("--my", `${(ptr.y / H) * 100}%`);
      redraw();
    };
    area.addEventListener("pointermove", move);
    area.addEventListener("pointerdown", move);
    area.addEventListener("pointerleave", () => { ptr.in = false; redraw(); });
    new ResizeObserver(() => { layout(); redraw(); }).observe(canvas);
    new MutationObserver(() => { readColors(); redraw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    document.fonts?.ready.then(redraw);

    readColors(); layout(); born = performance.now(); redraw();
    return { replay() { born = reduce.matches ? 0 : performance.now(); redraw(); } };
  }

  window.LandingField = { mount };
})();
