"use strict";

/**
 * The Sensitivity tab: per-scope zoom sensitivity values for BFV's Uniform Soldier Aiming (USA)
 * played at coefficient 0, so flicks match the coefficient you'd ideally use (your aspect ratio).
 * Same math as the community "BFV USA Sensitivity Calculator" sheet, from DICE's write-up
 * ("Consistent 360 degree distance aim"):
 *
 *   k = coefficient × tan(vertical FOV / 2)
 *   slider(z) = z × atan(k / z) / atan(k)
 *
 * Below that, an FOV converter: the slider value on another aspect ratio that keeps the same
 * horizontal view. hfov = 2 × atan(tan(vfov / 2) × aspect).
 *
 * Last, "How it looks": two setups drawn on a 16:9 monitor with a soldier at a chosen distance, the
 * picked gun's first-shot kick, and a sprint across the screen. Something at distance d, offset
 * y metres up and x across, lands at (y / d) / tan(vfov / 2) of half the screen height and
 * (x / d) / (tan(vfov / 2) × aspect) of half the screen width; stretching a render ratio onto a
 * 16:9 monitor is what makes things wider.
 */
window.Sensitivity = (() => {
  const ZOOMS = [1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10];
  const RATIOS = [[1, "1:1", 0.008], [4 / 3, "4:3", 0.008], [1.25, "5:4", 0.008], [1.5, "3:2", 0.008], [1.6, "16:10", 0.008], [16 / 9, "16:9", 0.008], [21 / 9, "21:9", 0.02]];
  const TOO_HIGH = 200;
  /** BFV's FOV slider range. */
  const FOV_MIN = 55, FOV_MAX = 105;
  const SHAPES = ["1:1", "5:4", "4:3", "3:2", "16:10", "16:9", "21:9"];
  const aspect = (shape) => { const [w, h] = shape.split(":"); return w / h; };
  const tanHalf = (vfov) => Math.tan((vfov * Math.PI) / 360);
  /** Vertical FOV on aspect `aNew` with the same horizontal view as `vfov` on `aOld`. */
  const convertFov = (vfov, aOld, aNew) => (360 / Math.PI) * Math.atan((tanHalf(vfov) * aOld) / aNew);

  /** Slider percentage for zoom `z` (coefficient in %, FOV in degrees), rounded like the sheet. */
  const slider = (z, coef, fov) => {
    const k = (coef / 100) * Math.tan((fov * Math.PI) / 360);
    return Math.round(100 * (k <= 0 ? 1 : (z * Math.atan(k / z)) / Math.atan(k)));
  };
  const ratioName = (r) => RATIOS.find(([v, , tol]) => Math.abs(r - v) < tol)?.[1] || "non-standard ratio";
  const num = (v) => (v === "" || v == null ? NaN : Number(v));

  let prefs, onChange, els;

  function render(container, p, cb) {
    prefs = p;
    onChange = cb;
    prefs.w ??= 1920;
    prefs.h ??= 1080;
    prefs.fov ??= 90;
    prefs.from ??= "4:3";
    prefs.to ??= "16:9";
    prefs.cfov ??= 90;
    prefs.vis ??= { a: { shape: "16:9", fov: 55 }, b: { shape: "16:9", fov: 105 }, dist: 20, gun: "MP40", close: true };
    if (!container.dataset.built) build(container);
    for (const k of ["w", "h", "fov", "cfov"]) els[k].value = prefs[k];
    prefs.coefOn ??= prefs.coef != null;
    els.coefOn.checked = prefs.coefOn;
    els.coef.value = prefs.coefOn ? prefs.coef ?? "" : "";
    update();
  }

  function build(root) {
    root.dataset.built = "1";
    root.innerHTML = `
      <div class="sens-layout">
        <div class="sens-calc">
          <div class="gs-group">
            <h3>Your setup</h3>
            <div class="sens-fields">
              <label>Resolution width<input class="field" data-k="w" type="number" inputmode="numeric" min="1" step="1"></label>
              <label>Resolution height<input class="field" data-k="h" type="number" inputmode="numeric" min="1" step="1"></label>
              <label>FOV slider<input class="field" data-k="fov" type="number" inputmode="numeric" min="1" max="179" step="1"></label>
              <label>Coefficient %<input class="field" data-k="coef" type="number" inputmode="decimal" min="0" step="1"></label>
            </div>
            <label class="sens-check"><input type="checkbox" data-out="coefOn"> Change the coefficient</label>
            <p class="sens-warn" data-out="coefWarn">Only change this if you know what you're doing. The coefficient that matches your aspect ratio is right for most people. Lower makes big scopes slower.</p>
            <p class="sens-note" data-out="ratio"></p>
            <p class="sens-note">Use the resolution the game <b>renders</b> at. If you play 1920×1440 stretched on a 1080p monitor, put 1920 and 1440.
              FOV is the number on the left of the slider, not the one in brackets.</p>
          </div>
          <div class="gs-group">
            <h3>Type these into the game</h3>
            <p class="sens-note">Options › Controls › Advanced, under the zoom sensitivity for each scope.</p>
            <table class="gs-stance sens-table">
              <thead><tr><th>Scope zoom</th><th>Value</th><th></th></tr></thead>
              <tbody data-out="rows"></tbody>
            </table>
          </div>
        </div>
        <div class="sens-explain">
          <div class="gs-group">
            <h3>Why use this</h3>
            <p>Scopes zoom in, so the game turns your mouse speed down while you're scoped. Otherwise a small mouse movement would swing you way off target.</p>
            <p><b>Uniform Soldier Aiming (USA)</b> decides how much it turns it down. The <b>coefficient</b> picks which distance from your crosshair feels the same on every scope:</p>
            <ul>
              <li><b>0:</b> right on your crosshair. Tracking feels the same on every scope, but on bigger magnifications flicks might feel too slow.</li>
              <li><b>178</b> (16:9), <b>160</b> (16:10), <b>133</b> (4:3): the edge of your screen. Flicks feel the same on every scope.</li>
            </ul>
            <p>These values get you both. Put the coefficient on 0 for tracking, then set each scope's zoom sensitivity from the table. Flicks then feel like they would at 178 (or 160 / 133, depending on your aspect ratio).</p>
          </div>
          <div class="gs-group">
            <h3>How to set it up</h3>
            <ol>
              <li>In BFV go to Options › Controls › Advanced.</li>
              <li>Turn <b>Uniform Soldier Aiming</b> on.</li>
              <li>Set the <b>USA coefficient to 0</b> (the values only work at 0).</li>
              <li>Turn <b>ADS field of view</b> (FOV scaling when aiming) on.</li>
              <li>Enter your resolution and FOV above, then put each value into the matching scope's zoom sensitivity.</li>
              <li>Leave Soldier Zoom Sensitivity at 100%.</li>
            </ol>
            <p class="sens-note">FOV numbers depend on aspect ratio. 105 on 4:3 stretched is a lot narrower than 105 on 16:9, so don't just copy someone else's. The FOV converter below works out the matching number.</p>
          </div>
          <details class="gs-group sens-math">
            <summary>How it's calculated</summary>
            <p>BFV's FOV slider is vertical FOV. The ring distance is:</p>
            <math display="block"><mi>k</mi><mo>=</mo><mi>c</mi><mo>·</mo><mi>tan</mi><mo>(</mo><mfrac><mtext>FOV</mtext><mn>2</mn></mfrac><mo>)</mo></math>
            <p><i>c</i> is the coefficient as a decimal (178 → 1.78). At zoom <i>z</i>, USA scales your sensitivity by:</p>
            <math display="block"><mfrac><mrow><msup><mi>tan</mi><mrow><mo>−</mo><mn>1</mn></mrow></msup><mo>(</mo><mfrac><mi>k</mi><mi>z</mi></mfrac><mo>)</mo></mrow><mrow><msup><mi>tan</mi><mrow><mo>−</mo><mn>1</mn></mrow></msup><mo>(</mo><mi>k</mi><mo>)</mo></mrow></mfrac></math>
            <p>tan<sup>−1</sup> is inverse tan, in radians. With coefficient 0 that's just 1/<i>z</i>, so the value you need is:</p>
            <math display="block"><mtext>value</mtext><mo>=</mo><mi>z</mi><mo>·</mo><mfrac><mrow><msup><mi>tan</mi><mrow><mo>−</mo><mn>1</mn></mrow></msup><mo>(</mo><mfrac><mi>k</mi><mi>z</mi></mfrac><mo>)</mo></mrow><mrow><msup><mi>tan</mi><mrow><mo>−</mo><mn>1</mn></mrow></msup><mo>(</mo><mi>k</mi><mo>)</mo></mrow></mfrac></math>
            <p>Example, 1920×1080 at FOV 105 on a 6× scope:</p>
            <math display="block"><mi>k</mi><mo>=</mo><mn>1.778</mn><mo>·</mo><mi>tan</mi><mo>(</mo><mn>52.5</mn><mo>°</mo><mo>)</mo><mo>=</mo><mn>2.317</mn></math>
            <math display="block"><mtext>value</mtext><mo>=</mo><mn>6</mn><mo>·</mo><mfrac><mrow><msup><mi>tan</mi><mrow><mo>−</mo><mn>1</mn></mrow></msup><mo>(</mo><mn>0.386</mn><mo>)</mo></mrow><mrow><msup><mi>tan</mi><mrow><mo>−</mo><mn>1</mn></mrow></msup><mo>(</mo><mn>2.317</mn><mo>)</mo></mrow></mfrac><mo>=</mo><mn>1.90</mn></math>
            <p>So you'd put <b>190%</b>.</p>
            <p>1× is always 100%. Values flatten out at high zoom (around 199% for 16:9 at FOV 105), so 8× and 10× end up nearly the same.</p>
            <p class="sens-note">Source: DICE's design write-up "Consistent 360 degree distance aim".</p>
          </details>
        </div>
        <div class="gs-group fov-conv">
          <h3>FOV converter</h3>
          <p class="sens-note">Changing your in-game aspect ratio? This finds the FOV that keeps the same view.</p>
          <div class="fov-rows">
            <span class="fov-label">Current aspect ratio</span>
            <div class="gs-seg small" role="group" aria-label="Current aspect ratio" data-side="from">${SHAPES.map((x) => `<button type="button" data-shape="${x}">${x}</button>`).join("")}</div>
            <label class="fov-label" for="fovNow">Current FOV</label>
            <div class="fov-range"><input id="fovNow" data-k="cfov" type="range" min="${FOV_MIN}" max="${FOV_MAX}" step="1"><output data-out="cfovText"></output></div>
            <span class="fov-label">New aspect ratio</span>
            <div class="gs-seg small" role="group" aria-label="New aspect ratio" data-side="to">${SHAPES.map((x) => `<button type="button" data-shape="${x}">${x}</button>`).join("")}</div>
          </div>
          <div class="fov-result" data-out="fovResult"></div>
        </div>
      </div>`;
    els = Object.fromEntries([...root.querySelectorAll("[data-k]")].map((e) => [e.dataset.k, e]));
    els.ratio = root.querySelector('[data-out="ratio"]');
    els.coefOn = root.querySelector('[data-out="coefOn"]');
    els.coefWarn = root.querySelector('[data-out="coefWarn"]');
    els.coefOn.addEventListener("change", () => {
      prefs.coefOn = els.coefOn.checked;
      if (!prefs.coefOn) prefs.coef = null;
      els.coef.value = "";
      onChange?.();
      update();
      if (prefs.coefOn) els.coef.focus();
    });
    els.rows = root.querySelector('[data-out="rows"]');
    els.cfovText = root.querySelector('[data-out="cfovText"]');
    els.fovResult = root.querySelector('[data-out="fovResult"]');
    els.sides = [...root.querySelectorAll("[data-side]")];
    for (const seg of els.sides) seg.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      prefs[seg.dataset.side] = b.dataset.shape;
      onChange?.();
      update();
    });
    for (const [k, input] of Object.entries(els)) {
      if (!input.dataset?.k) continue;
      input.addEventListener("input", () => {
        if (k === "coef") prefs.coef = input.value === "" ? null : num(input.value);
        else prefs[k] = input.value;
        onChange?.();
        update();
      });
    }
  }

  function update() {
    const w = num(prefs.w), h = num(prefs.h), fov = num(prefs.fov);
    const ratio = w > 0 && h > 0 ? w / h : NaN;
    const auto = Math.round(ratio * 100);
    els.coef.placeholder = Number.isFinite(ratio) ? String(auto) : "";
    els.coef.disabled = !prefs.coefOn;
    els.coefWarn.hidden = !prefs.coefOn;
    const coef = prefs.coefOn && prefs.coef != null ? prefs.coef : ratio * 100;
    els.ratio.textContent = Number.isFinite(ratio)
      ? `${ratioName(ratio)} (${ratio.toFixed(3)}), so the matching coefficient is ${auto}.`
      : "Type your resolution to see your aspect ratio.";
    els.rows.innerHTML = "";
    const ok = Number.isFinite(ratio) && fov > 0 && fov < 180 && coef >= 0;
    for (const z of ZOOMS) {
      const tr = document.createElement("tr");
      const v = ok ? slider(z, coef, fov) : null;
      tr.innerHTML = `<td>${z}×</td><td class="sens-val">${v == null ? "—" : `${v}%`}</td><td class="sens-flag"></td>`;
      if (v > TOO_HIGH) tr.lastChild.textContent = "Very high, check your slider goes this far";
      els.rows.append(tr);
    }
    updateFov();
    if (!vis) buildVis(document.querySelector("#sensCalc"));
    drawVis();
  }

  function updateFov() {
    for (const seg of els.sides) for (const b of seg.children) b.setAttribute("aria-pressed", String(b.dataset.shape === prefs[seg.dataset.side]));
    const now = num(prefs.cfov);
    els.cfovText.textContent = now;
    const exact = convertFov(now, aspect(prefs.from), aspect(prefs.to));
    const value = Math.round(exact);
    els.fovResult.innerHTML = value >= FOV_MIN && value <= FOV_MAX
      ? `<span>Set FOV to</span><span class="fov-big">${value}</span><span>in game</span><p class="sens-note">You'll see just as much to the sides as now.</p>`
      : `<p class="fov-warn">Can't be set in game. You'd need FOV ${value}, but the slider only goes from ${FOV_MIN} to ${FOV_MAX}.</p>`;
  }

  // The sheet's worked example: 1920×1080, FOV 105, 6× → 190%.
  console.assert(slider(6, 177.78, 105) === 190 && slider(1, 178, 105) === 100, "sensitivity math");
  // FOV converter: 4:3 at 105 → 16:9 is 88.69 (slider 89), → 16:10 is 94.72.
  console.assert(convertFov(105, 4 / 3, 16 / 9).toFixed(2) === "88.69" && convertFov(105, 4 / 3, 1.6).toFixed(2) === "94.72", "fov converter math");

  // ---------- How it looks ----------

  /** Approximate: BFV doesn't publish soldier dimensions, so a 1.8 m person. */
  const SOLDIER_H = 1.8, EYE_H = 1.6;
  /** Measured BFV sprint speed (SMK Gaming's test, via MP1st). */
  const SPRINT = 6.04;
  const MONITOR = 16 / 9, MONITOR_H = 1080;
  const guns = () => (window.WEAPON_STATS?.weapons || [])
    .filter((w) => w.base?.ADSStandRecoilInitialUp != null)
    .sort((a, b) => a.name.localeCompare(b.name));

  let vis, playing = false, t0 = 0;

  function buildVis(root) {
    const v = prefs.vis;
    const setup = (key) => `
      <div class="vis-setup" data-vis="${key}">
        <div class="gs-seg small" role="group" aria-label="Aspect ratio">${SHAPES.map((x) => `<button type="button" data-shape="${x}">${x}</button>`).join("")}</div>
        <label class="fov-range"><span class="fov-label">FOV</span><input type="range" min="${FOV_MIN}" max="${FOV_MAX}" step="1" aria-label="FOV"><output></output></label>
        <canvas class="vis-canvas" role="img"></canvas>
        <dl class="vis-stats"></dl>
      </div>`;
    const box = document.createElement("div");
    box.className = "gs-group vis";
    box.innerHTML = `
      <h3>How it looks</h3>
      <p class="sens-note">Compare two setups on a 16:9 monitor. The soldier is about 1.8 m tall (BFV's real size isn't published) and sprints at 6 m/s, as measured in game.</p>
      <div class="vis-controls">
        <label class="fov-range"><span class="fov-label">Distance</span><input type="range" min="5" max="150" step="5" data-vis="dist" aria-label="Distance"><output></output></label>
        <label class="vis-gun"><span class="fov-label">Recoil of</span><select class="field" data-vis="gun"><option value="">No gun</option>${guns().map((w) => `<option>${w.name}</option>`).join("")}</select></label>
        <label class="sens-check vis-close"><input type="checkbox" data-vis="close"> Close-up (4× around the crosshair)</label>
        <button type="button" class="btn ghost" data-vis="play">Play sprint</button>
      </div>
      <div class="vis-pair">${setup("a")}${setup("b")}</div>
      <p class="sens-note">The amber line is the gun's first-shot kick when aiming. A higher FOV draws everything smaller, the kick included, so it moves fewer pixels on screen. Scopes zoom the target and the kick by the same amount.</p>`;
    root.querySelector(".sens-layout").append(box);
    vis = { box, dist: box.querySelector('[data-vis="dist"]'), gun: box.querySelector('[data-vis="gun"]'), play: box.querySelector('[data-vis="play"]'), setups: {} };
    for (const key of ["a", "b"]) {
      const el = box.querySelector(`[data-vis="${key}"]`);
      const s = { el, seg: el.querySelector(".gs-seg"), fov: el.querySelector("input"), out: el.querySelector("output"), canvas: el.querySelector("canvas"), stats: el.querySelector("dl") };
      s.seg.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { v[key].shape = b.dataset.shape; onChange?.(); drawVis(); } });
      s.fov.addEventListener("input", () => { v[key].fov = Number(s.fov.value); onChange?.(); drawVis(); });
      vis.setups[key] = s;
    }
    vis.dist.addEventListener("input", () => { v.dist = Number(vis.dist.value); onChange?.(); drawVis(); });
    vis.close = box.querySelector('[data-vis="close"]');
    vis.close.addEventListener("change", () => { v.close = vis.close.checked; onChange?.(); drawVis(); });
    vis.gun.addEventListener("change", () => { v.gun = vis.gun.value; onChange?.(); drawVis(); });
    vis.play.addEventListener("click", () => {
      playing = !playing;
      vis.play.textContent = playing ? "Stop" : "Play sprint";
      t0 = performance.now();
      if (playing) requestAnimationFrame(tick); else drawVis();
    });
    new ResizeObserver(() => drawVis()).observe(vis.box);
  }

  function tick(now) {
    // Stop when the tab is switched away (the section is hidden).
    if (!playing || !vis.box.offsetParent) { playing = false; vis.play.textContent = "Play sprint"; drawVis(); return; }
    drawVis((now - t0) / 1000);
    requestAnimationFrame(tick);
  }

  function drawVis(time = null) {
    if (!vis) return;
    const v = prefs.vis;
    vis.dist.value = v.dist;
    vis.dist.nextElementSibling.textContent = `${v.dist} m`;
    vis.gun.value = v.gun;
    vis.close.checked = v.close;
    // Close-up zooms both pictures the same amount around the crosshair, so they still compare.
    const z = v.close ? 4 : 1;
    const gun = guns().find((w) => w.name === v.gun)?.base;
    const css = getComputedStyle(document.body);
    const color = (name) => css.getPropertyValue(name).trim();
    for (const [key, s] of Object.entries(vis.setups)) {
      const { shape, fov } = v[key];
      for (const b of s.seg.children) b.setAttribute("aria-pressed", String(b.dataset.shape === shape));
      s.fov.value = fov;
      s.out.textContent = fov;
      const a = aspect(shape), th = tanHalf(fov);
      // Canvas: a 16:9 monitor at the column's width.
      const W = s.canvas.clientWidth, H = W / MONITOR, dpr = devicePixelRatio || 1;
      if (!W) continue;
      s.canvas.width = Math.round(W * dpr);
      s.canvas.height = Math.round(H * dpr);
      s.canvas.style.height = `${H}px`;
      const g = s.canvas.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Metres at distance d → canvas pixels (y up from eye level, x right of centre).
      const d = v.dist;
      const py = (H / 2) / (d * th), px = (W / 2) / (d * th * a);
      const cx = W / 2, cy = H / 2;
      g.fillStyle = color("--surface-3"); g.fillRect(0, 0, W, cy);
      g.fillStyle = color("--surface-1"); g.fillRect(0, cy, W, H - cy);
      // Sprinting: the soldier crosses the visible width and wraps around.
      const viewW = 2 * d * th * a, shownW = viewW / z, margin = 0.6;
      const x = time == null ? 0 : ((time * SPRINT) % (shownW + 2 * margin)) - shownW / 2 - margin;
      const zx = px * z, zy = py * z;
      const sx = cx + x * zx, ground = cy + EYE_H * zy;
      g.fillStyle = color("--text");
      g.beginPath();
      g.ellipse(sx, ground - 1.68 * zy, 0.12 * zx, 0.12 * zy, 0, 0, Math.PI * 2);
      g.fill();
      g.fillRect(sx - 0.22 * zx, ground - 1.52 * zy, 0.44 * zx, 0.68 * zy);
      g.fillRect(sx - 0.18 * zx, ground - 0.86 * zy, 0.15 * zx, 0.86 * zy);
      g.fillRect(sx + 0.03 * zx, ground - 0.86 * zy, 0.15 * zx, 0.86 * zy);
      // Crosshair.
      g.strokeStyle = color("--muted"); g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx - 6, cy); g.lineTo(cx + 6, cy); g.moveTo(cx, cy - 6); g.lineTo(cx, cy + 6); g.stroke();
      // First-shot kick: straight up by the recoil angle, sideways range as a bar on top.
      let kickPx = null;
      if (gun) {
        const up = Math.tan((gun.ADSStandRecoilInitialUp * Math.PI) / 180);
        const side = Math.tan((Math.max(gun.ADSStandRecoilLeft || 0, gun.ADSStandRecoilRight || 0) * Math.PI) / 180);
        const ky = (z * (H / 2) * up) / th, kx = (z * (W / 2) * side) / (th * a);
        kickPx = ((MONITOR_H / 2) * up) / th;
        g.strokeStyle = color("--accent"); g.lineWidth = 2;
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, cy - ky); g.stroke();
        if (kx > 0.5) { g.beginPath(); g.moveTo(cx - kx, cy - ky); g.lineTo(cx + kx, cy - ky); g.stroke(); }
        g.fillStyle = color("--accent"); g.beginPath(); g.arc(cx, cy - ky, 3, 0, Math.PI * 2); g.fill();
      }
      s.canvas.setAttribute("aria-label", `${shape} at FOV ${fov}: soldier at ${d} m`);
      // Numbers on a 1080p monitor.
      const k = MONITOR_H / H;
      const rows = [
        ["Horizontal view", `${(2 * Math.atan(th * a) * 180 / Math.PI).toFixed(1)}°`],
        ["Soldier on a 1080p screen", `${Math.round(0.44 * px * k)} × ${Math.round(SOLDIER_H * py * k)} px`],
        ["Sprints across the screen in", `${(viewW / SPRINT).toFixed(1)} s`],
      ];
      if (kickPx != null) rows.push(["First-shot kick", `${Math.round(kickPx)} px`]);
      s.stats.innerHTML = rows.map(([dt, dd]) => `<dt>${dt}</dt><dd>${dd}</dd>`).join("");
    }
  }

  return { render, status: () => "" };
})();
