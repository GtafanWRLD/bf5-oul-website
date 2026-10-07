"use strict";

/**
 * The Sensitivity tab: per-scope zoom sensitivity values for BFV's Uniform Soldier Aiming (USA)
 * played at coefficient 0, so flicks match the coefficient you'd ideally use (your aspect ratio).
 * Same math as the community "BFV USA Sensitivity Calculator" sheet, from DICE's write-up
 * ("Consistent 360 degree distance aim"):
 *
 *   k = coefficient × tan(vertical FOV / 2)
 *   slider(z) = z × atan(k / z) / atan(k)
 */
window.Sensitivity = (() => {
  const ZOOMS = [1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10];
  const RATIOS = [[4 / 3, "4:3", 0.008], [1.25, "5:4", 0.008], [1.6, "16:10", 0.008], [16 / 9, "16:9", 0.008], [21 / 9, "21:9", 0.02]];
  const TOO_HIGH = 200;

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
    if (!container.dataset.built) build(container);
    for (const k of ["w", "h", "fov"]) els[k].value = prefs[k];
    els.coef.value = prefs.coef ?? "";
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
              <li><b>0:</b> right on your crosshair. Tracking feels the same on every scope, but flicks on 6× and up feel slow.</li>
              <li><b>178</b> (16:9), <b>160</b> (16:10), <b>133</b> (4:3): the edge of your screen. Flicks feel the same on every scope.</li>
            </ul>
            <p>These values get you both. Put the coefficient on 0 for tracking, then set each scope's zoom sensitivity from the table. Flicks then feel like they would at 178 (or 160 / 133, depending on your screen).</p>
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
            <p class="sens-note">FOV numbers depend on aspect ratio. 105 on 4:3 stretched is a lot narrower than 105 on 16:9, so don't just copy someone else's.</p>
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
      </div>`;
    els = Object.fromEntries([...root.querySelectorAll("[data-k]")].map((e) => [e.dataset.k, e]));
    els.ratio = root.querySelector('[data-out="ratio"]');
    els.rows = root.querySelector('[data-out="rows"]');
    for (const [k, input] of Object.entries(els)) {
      if (!input.dataset.k) continue;
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
    const coef = prefs.coef ?? ratio * 100;
    els.ratio.textContent = Number.isFinite(ratio)
      ? `${ratioName(ratio)} (${ratio.toFixed(3)}), so the default coefficient is ${auto}. Leave the box empty to use it, or go lower if you want big scopes slower.`
      : "Type your resolution to see your screen shape.";
    els.rows.innerHTML = "";
    const ok = Number.isFinite(ratio) && fov > 0 && fov < 180 && coef >= 0;
    for (const z of ZOOMS) {
      const tr = document.createElement("tr");
      const v = ok ? slider(z, coef, fov) : null;
      tr.innerHTML = `<td>${z}×</td><td class="sens-val">${v == null ? "—" : `${v}%`}</td><td class="sens-flag"></td>`;
      if (v > TOO_HIGH) tr.lastChild.textContent = "Very high, check your slider goes this far";
      els.rows.append(tr);
    }
  }

  // The sheet's worked example: 1920×1080, FOV 105, 6× → 190%.
  console.assert(slider(6, 177.78, 105) === 190 && slider(1, 178, 105) === 100, "sensitivity math");

  return { render, status: () => "" };
})();
