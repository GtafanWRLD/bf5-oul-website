"use strict";

/**
 * The Gun stats tab: every BFV gun's datamined stats (weapon-stats.js, from sym.gg) as a sortable
 * table, with a per-gun detail panel holding an interactive damage / shots / time-to-kill chart and
 * the specialization tree.
 *
 * Unlike sym's chart page, values here are derived from the selected specialization combo as a
 * whole, so specs that only change a multiplier still show up: Quick Reload scales reload times
 * through ReloadSpeed, Quick Aim raises the aim settle rate, ammo specs change the ammo type.
 */
window.GunStats = (() => {
  const DATA = window.WEAPON_STATS;
  const MAX_RANGE = 150;
  const CLASSES = ["Assault", "Medic", "Support", "Recon", "Sidearm"];

  // ---------- maths ----------

  const resolve = (w, combo) => (combo && w.variants[combo] ? { ...w.base, ...w.variants[combo] } : w.base);

  /** Damage of one projectile at distance d, linear between the datamined points. */
  function damageAt(s, d) {
    const dmg = s.Damages, dist = s.Dmg_distances;
    if (d <= dist[0]) return dmg[0];
    for (let i = 1; i < dist.length; i++) {
      if (d <= dist[i] && dist[i] > dist[i - 1]) {
        return dmg[i - 1] + ((d - dist[i - 1]) / (dist[i] - dist[i - 1])) * (dmg[i] - dmg[i - 1]);
      }
    }
    return dmg[dmg.length - 1];
  }
  /** Damage of one trigger pull, assuming every pellet hits. */
  const shotDamage = (s, d) => damageAt(s, d) * (s.ShotsPerShell || 1);
  /** Body shots to kill from 100 health. */
  const btk = (s, d) => Math.max(1, Math.ceil(100 / shotDamage(s, d) - 1e-6));
  /** Milliseconds from the first shot to the killing one, without bullet travel. */
  function ttk(s, d) {
    const n = btk(s, d);
    const perShot = 60000 / s.RoF;
    // Burst guns (Breda) fire their burst at BRoF and wait RoF between bursts.
    const burst = s.ShotsPerBurst > 1 && s.BRoF > s.RoF ? s.ShotsPerBurst : 1;
    let t = 0;
    for (let i = 1; i < n; i++) t += burst > 1 && i % burst ? 60000 / s.BRoF : perShot;
    return t;
  }
  /** Bullet flight time to distance d in ms (same drag model as sym: v -= v·drag per metre). */
  function travelMs(s, d) {
    let v = s.InitialSpeed, t = 0;
    for (let x = 0; x < d && v > 1; x++) { t += 1 / v; v -= v * s.Drag; }
    return t * 1000;
  }
  /**
   * Reload times with the ReloadSpeed multiplier (Quick Reload) applied. Magazine guns have
   * tactical/empty times; clip-fed and shell-by-shell guns have a clip time and/or a per-round time
   * (a "clip" of 1 is a single shell). Many clip-fed guns have no reload data in the datamine at all.
   */
  function reload(s) {
    const k = s.ReloadSpeed || 1;
    if (s.ReloadLeft != null) return { tactical: s.ReloadLeft / k, empty: (s.ReloadEmpty ?? s.ReloadLeft) / k };
    const per = s.SingleBulletReloadTime > 0 ? s.SingleBulletReloadTime : s.StripClipSize === 1 && s.StripReloadTime > 0 ? s.StripReloadTime : null;
    const clip = s.StripClipSize > 1 && s.StripReloadTime > 0 ? s.StripReloadTime : null;
    return { perRound: per && per / k, clip: clip && clip / k };
  }
  const hasReload = (s) => Object.values(reload(s)).some((v) => v != null);
  const reloadTime = (s) => { const r = reload(s); return r.tactical ?? r.clip ?? null; };
  const prettyAmmo = (a) => (a || "").replace(/_/g, " ").replace(/(\d)x(\d)/g, "$1×$2");

  // ---------- what's shown ----------

  /** Table columns. `better` says which end of the range fills the meter. */
  const COLUMNS = [
    { key: "btk", label: "BTK", title: "Body shots to kill at the chosen range (all pellets hitting)", better: "low", get: (s, r) => btk(s, r), fmt: (v) => v },
    { key: "ttk", label: "TTK", unit: "ms", title: "Time to kill at the chosen range, excluding bullet travel", better: "low", get: (s, r) => ttk(s, r), fmt: (v) => Math.round(v) },
    { key: "rpm", label: "RPM", title: "Rate of fire", better: "high", get: (s) => s.RoF, fmt: (v) => v },
    { key: "vel", label: "Velocity", unit: "m/s", title: "Muzzle velocity", better: "high", get: (s) => s.InitialSpeed, fmt: (v) => v },
    { key: "mag", label: "Mag", title: "Magazine size", better: "high", get: (s) => s.MagSize, fmt: (v) => v },
    { key: "reload", label: "Reload", unit: "s", title: "Reload with rounds left (stripper-clip reload for bolt-actions)", better: "low", get: (s) => reloadTime(s), fmt: (v) => v.toFixed(2) },
  ];

  /** Detail panel stat groups: [label, getter, unit, better, decimals, help]. */
  const GROUPS = [
    ["Handling", [
      ["Deploy time", (s) => s.DeployTime, "s", "low", 2, "Time to bring the gun up after switching to it."],
      ["Sprint-to-fire", (s) => s.SprintRecoverTimeMultiplier, "×", "low", 2, "Multiplier on the delay before you can fire after sprinting. Slings and Swivels lowers it."],
      ["Aim settle rate", (s) => s.ADSStandBaseSpreadIdleOffset, "", "high", 1, "How quickly spread settles after aiming in. Quick Aim raises it by 75%."],
    ]],
    ["Recoil, aimed", [
      ["First-shot kick", (s) => s.ADSStandRecoilInitialUp, "°", "low", 2, "Vertical recoil of the first shot."],
      ["Climb per shot", (s) => s.ADSStandRecoilUp, "°", "low", 3, "Extra vertical recoil added by each following shot."],
      ["Horizontal", (s) => Math.max(s.ADSStandRecoilLeft, s.ADSStandRecoilRight), "°", "low", 3, "Largest sideways kick per shot."],
      ["Recovery", (s) => s.ADSStandRecoilDecFactor, "", "high", 1, "How fast the sights return after a shot."],
    ]],
    ["Accuracy", [
      ["Aimed spread", (s) => s.ADSStandBaseMin, "°", "low", 3, "Spread while aiming and standing still."],
      ["Aimed, moving", (s) => s.ADSStandMoveMin, "°", "low", 3, "Spread while aiming and walking."],
      ["Hip spread", (s) => s.HIPStandBaseMin, "°", "low", 2, "Spread from the hip, standing still."],
      ["Hip, moving", (s) => s.HIPStandMoveMin, "°", "low", 2, "Spread from the hip while walking."],
      ["Bloom per shot, aimed", (s) => s.ADSStandBaseSpreadInc, "°", "low", 3, "Spread each shot adds while aiming."],
      ["Bloom per shot, hip", (s) => s.HIPStandBaseSpreadInc, "°", "low", 3, "Spread each shot adds from the hip."],
      ["Hip bloom recovery", (s) => s.HIPStandBaseSpreadDecCoef, "", "high", 2, "How fast hip-fire bloom shrinks again."],
      ["Pellet spread", (s) => (s.ShotsPerShell > 1 ? s.HorDispersion : null), "°", "low", 2, "Cone the pellets spread across."],
    ]],
    ["Ballistics", [
      ["Muzzle velocity", (s) => s.InitialSpeed, "m/s", "high", 0, "Bullet speed leaving the barrel."],
      ["Drag", (s) => s.Drag, "", "low", 4, "How quickly the bullet slows down."],
      ["Gravity", (s) => s.BDrop, "m/s²", "low", 1, "How strongly the bullet drops."],
      ["Pellets", (s) => (s.ShotsPerShell > 1 ? s.ShotsPerShell : null), "", null, 0, "Projectiles per shot."],
    ]],
    ["Ammo and reload", [
      ["Magazine", (s) => s.MagSize, "", "high", 0, "Rounds per magazine."],
      ["Reload, rounds left", (s) => reload(s).tactical, "s", "low", 2, "Reload with rounds still in the magazine. Includes Quick Reload's speed-up."],
      ["Reload, empty", (s) => reload(s).empty, "s", "low", 2, "Reload from empty. Includes Quick Reload's speed-up."],
      ["Stripper clip", (s) => reload(s).clip, "s", "low", 2, "Reload a full clip from empty."],
      ["Per round", (s) => reload(s).perRound, "s", "low", 2, "Time to load each single round or shell."],
      ["Reload", (s) => (hasReload(s) ? null : "Not in the datamine"), "", null, 0, "sym.gg's data has no reload times for this gun."],
      ["Ammo", (s) => prettyAmmo(s.Ammo), "", null, 0, "Ammo type. Penetration, headshot and incendiary specs swap this."],
    ]],
  ];

  /** [min, max] of a getter over every stock gun, for the meters. */
  const domainCache = new Map();
  function domain(id, get) {
    if (!domainCache.has(id)) {
      const vals = DATA.weapons.map((w) => get(w.base)).filter((v) => typeof v === "number" && isFinite(v));
      domainCache.set(id, [Math.min(...vals), Math.max(...vals)]);
    }
    return domainCache.get(id);
  }
  function meterFill(v, [min, max], better) {
    if (typeof v !== "number" || max === min || !better) return null;
    const t = Math.min(1, Math.max(0, (v - min) / (max - min)));
    return better === "low" ? 1 - t : t;
  }

  // ---------- small DOM helpers ----------

  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const SVG = "http://www.w3.org/2000/svg";
  const s$ = (tag, attrs = {}) => {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  function meter(fill) {
    const m = h("span", "gs-meter");
    if (fill == null) m.classList.add("empty");
    else m.style.setProperty("--fill", `${Math.max(.04, fill) * 100}%`);
    return m;
  }

  // ---------- state ----------

  let root, prefs, onChange, onRangeChange;
  let justOpened = null;
  const combo = (w) => prefs.specs[w.name] || "";
  const current = (w) => resolve(w, combo(w));
  const changed = () => onChange && onChange();

  /** Draws the tab into `container`. `p` is the saved prefs object (mutated in place); `cb` saves it. */
  function render(container, p, cb, rangeCb) {
    root = container;
    prefs = p;
    onChange = cb;
    onRangeChange = rangeCb;
    prefs.cls ||= "all";
    prefs.q ??= "";
    prefs.range ??= 25;
    prefs.sort ||= { key: "ttk", dir: 1 };
    prefs.specs ||= {};
    prefs.chart ||= "damage";
    if (!DATA) {
      root.innerHTML = "";
      root.append(h("p", "gs-empty", "Couldn't load the gun stats (weapon-stats.js is missing next to index.html)."));
      return;
    }
    if (!root.dataset.built) build();
    syncControls();
    renderList();
  }

  function status() {
    return DATA ? `${DATA.weapons.length} guns · stats at ${prefs?.range ?? 25} m` : "Gun stats unavailable";
  }

  // ---------- toolbar ----------

  function build() {
    root.dataset.built = "1";
    root.innerHTML = "";

    const bar = h("div", "gs-toolbar");

    const search = h("label", "search-field");
    search.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
    const q = h("input", "field");
    q.type = "search";
    q.id = "gsQuery";
    q.placeholder = "Find a gun…";
    q.setAttribute("aria-label", "Find a gun");
    q.addEventListener("input", () => { prefs.q = q.value; changed(); renderList(); });
    search.append(q);

    const seg = h("div", "gs-seg");
    seg.id = "gsClass";
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Class");
    for (const c of ["all", ...CLASSES]) {
      const b = h("button", "", c === "all" ? "All" : c);
      b.type = "button";
      b.dataset.cls = c;
      b.addEventListener("click", () => { prefs.cls = c; changed(); syncControls(); renderList(); });
      seg.append(b);
    }

    const range = h("label", "gs-range");
    const rl = h("span", "gs-range-label", "Range");
    const slider = h("input");
    slider.type = "range";
    slider.id = "gsRange";
    slider.min = 0;
    slider.max = MAX_RANGE;
    slider.step = 1;
    slider.setAttribute("aria-label", "Range for shots and time to kill, in metres");
    const out = h("output", "gs-range-value");
    out.id = "gsRangeOut";
    slider.addEventListener("input", () => setRange(+slider.value));
    range.append(rl, slider, out);

    bar.append(search, seg, range);

    const table = h("div", "gs-table");
    table.id = "gsTable";
    table.setAttribute("role", "list");

    const note = h("p", "hint");
    note.innerHTML =
      'Click a gun to open its damage chart and specializations; hover the chart to read any distance, click it to set the range. ' +
      'Shots and time to kill assume body shots from 100 health with every pellet hitting; time to kill leaves out bullet travel (shown on hover). ' +
      `Meters compare each stat with every stock gun. Stats datamined by <a href="https://sym.gg/legacy/index.html?game=bfv&page=charts" target="_blank" rel="noopener">sym.gg</a>.`;

    root.append(bar, table, note);
  }

  function syncControls() {
    const q = root.querySelector("#gsQuery");
    if (q.value !== prefs.q) q.value = prefs.q;
    for (const b of root.querySelectorAll("#gsClass button")) b.setAttribute("aria-pressed", String(b.dataset.cls === prefs.cls));
    root.querySelector("#gsRange").value = prefs.range;
    root.querySelector("#gsRangeOut").textContent = `${prefs.range} m`;
  }

  let rangeFrame = 0;
  function setRange(m) {
    prefs.range = Math.max(0, Math.min(MAX_RANGE, Math.round(m)));
    root.querySelector("#gsRange").value = prefs.range;
    root.querySelector("#gsRangeOut").textContent = `${prefs.range} m`;
    changed();
    // Slider drags fire faster than a full table redraw is worth.
    cancelAnimationFrame(rangeFrame);
    rangeFrame = requestAnimationFrame(() => { renderList(); onRangeChange?.(); });
  }

  // ---------- table ----------

  function visible() {
    const q = prefs.q.trim().toLowerCase();
    return DATA.weapons.filter((w) =>
      (prefs.cls === "all" || w.cls === prefs.cls) &&
      (!q || w.name.toLowerCase().includes(q) || (w.type || "").toLowerCase().includes(q)));
  }

  function sortValue(w) {
    const k = prefs.sort.key;
    if (k === "name") return w.name.toLowerCase();
    const col = COLUMNS.find((c) => c.key === k);
    return col.get(current(w), prefs.range);
  }

  function renderList() {
    const table = root.querySelector("#gsTable");
    const scrollY = window.scrollY;
    table.innerHTML = "";

    // Header
    const head = h("div", "gs-head");
    const headCell = (key, label, title) => {
      const b = h("button", "gs-sort", label);
      b.type = "button";
      b.dataset.col = key;
      if (title) b.title = title;
      const active = prefs.sort.key === key;
      if (active) b.dataset.dir = prefs.sort.dir > 0 ? "best" : "worst";
      b.setAttribute("aria-sort", active ? (prefs.sort.dir > 0 ? "ascending" : "descending") : "none");
      b.addEventListener("click", () => {
        prefs.sort = { key, dir: active ? -prefs.sort.dir : 1 };
        changed();
        renderList();
      });
      return b;
    };
    head.append(headCell("name", "Gun", "Sort by name"), h("span", "gs-spark-head", `Damage · ${prefs.range} m`));
    for (const c of COLUMNS) head.append(headCell(c.key, c.label, c.title));
    table.append(head);

    // Domains for the range-dependent columns are taken at the current range.
    const domains = Object.fromEntries(COLUMNS.map((c) => {
      const vals = DATA.weapons.map((w) => c.get(w.base, prefs.range)).filter((v) => typeof v === "number");
      return [c.key, [Math.min(...vals), Math.max(...vals)]];
    }));

    const list = visible();
    const col = COLUMNS.find((c) => c.key === prefs.sort.key);
    list.sort((a, b) => {
      const va = sortValue(a), vb = sortValue(b);
      if (va == null && vb == null) return a.name.localeCompare(b.name);
      if (va == null) return 1;
      if (vb == null) return -1;
      let d = typeof va === "string" ? va.localeCompare(vb) : va - vb;
      // "Best first" means ascending for lower-is-better stats, descending otherwise.
      if (col?.better === "high") d = -d;
      return d * prefs.sort.dir || a.name.localeCompare(b.name);
    });

    if (!list.length) {
      table.append(h("p", "gs-empty", "No gun matches that."));
      return;
    }

    for (const w of list) {
      const s = current(w);
      const row = h("div", "gs-item");
      row.setAttribute("role", "listitem");
      const btn = h("button", "gs-row");
      btn.type = "button";
      btn.setAttribute("aria-expanded", String(prefs.open === w.name));

      const gun = h("span", "gs-gun");
      const thumb = h("span", "gs-thumb");
      if (w.image) {
        const img = h("img");
        img.src = w.image;
        img.alt = "";
        img.loading = "lazy";
        img.onerror = () => img.remove();
        thumb.append(img);
      }
      const names = h("span", "gs-names");
      names.append(h("span", "gs-name", w.name));
      const sub = h("span", "gs-sub", [w.type || w.cls, w.type ? w.cls : null].filter(Boolean).join(" · "));
      if (combo(w)) {
        const n = combo(w).split("+").length;
        const badge = h("span", "gs-badge", `${n} spec${n > 1 ? "s" : ""}`);
        badge.title = combo(w).split("+").map((c) => w.specNames[c] || c).join(", ");
        sub.append(" ", badge);
      }
      names.append(sub);
      gun.append(thumb, names);
      btn.append(gun, sparkline(s));

      for (const c of COLUMNS) {
        const v = c.get(s, prefs.range);
        const cell = h("span", "gs-cell");
        cell.dataset.col = c.key;
        const num = h("span", "gs-num", v == null ? "—" : c.fmt(v));
        if (v != null && c.unit) num.append(h("span", "gs-unit", ` ${c.unit}`));
        cell.append(num, meter(meterFill(v, domains[c.key], c.better)));
        btn.append(cell);
      }
      btn.addEventListener("click", () => {
        prefs.open = prefs.open === w.name ? null : w.name;
        justOpened = prefs.open;
        changed();
        renderList();
      });
      row.append(btn);
      if (prefs.open === w.name) {
        const d = detail(w);
        // Only opening animates; spec picks and range changes redraw the panel in place.
        if (justOpened === w.name) d.classList.add("enter");
        row.append(d);
      }
      table.append(row);
      row.querySelector(".gs-chart")?.draw();
    }
    justOpened = null;
    // Re-rendering replaces the rows; keep the page where it was.
    window.scrollTo(0, scrollY);
  }

  /** A tiny damage-over-range curve with a dot at the chosen range. */
  function sparkline(s) {
    const W = 120, H = 30, max = Math.max(100, shotDamage(s, 0));
    const x = (d) => (d / MAX_RANGE) * W;
    const y = (v) => H - 2 - (Math.min(v, max) / max) * (H - 4);
    let path = "";
    for (let d = 0; d <= MAX_RANGE; d += 3) path += `${d ? "L" : "M"}${x(d).toFixed(1)},${y(shotDamage(s, d)).toFixed(1)}`;
    const svg = s$("svg", { viewBox: `0 0 ${W} ${H}`, class: "gs-spark", "aria-hidden": "true" });
    svg.append(
      s$("path", { d: `${path}L${W},${H}L0,${H}Z`, class: "area" }),
      s$("path", { d: path, class: "line" }),
      s$("circle", { cx: x(prefs.range), cy: y(shotDamage(s, prefs.range)), r: 2.5, class: "dot" }),
    );
    const wrap = h("span", "gs-spark-wrap");
    wrap.title = `${fmtDmg(s, prefs.range)} at ${prefs.range} m`;
    wrap.append(svg);
    return wrap;
  }

  const fmtDmg = (s, d) => {
    const one = damageAt(s, d);
    return s.ShotsPerShell > 1 ? `${round1(one * s.ShotsPerShell)} dmg (${s.ShotsPerShell} × ${round1(one)})` : `${round1(one)} dmg`;
  };
  const round1 = (v) => (Math.round(v * 10) / 10).toString();

  // ---------- detail panel ----------

  function detail(w) {
    const s = current(w);
    const panel = h("div", "gs-detail");

    const top = h("div", "gs-detail-top");
    top.append(specTree(w), chartBlock(w));
    panel.append(top);

    const groups = h("div", "gs-groups");
    for (const [title, rows] of GROUPS) {
      const g = h("section", "gs-group");
      g.append(h("h3", "", title));
      const dl = h("dl");
      for (const [label, get, unit, better, dec, help] of rows) {
        const v = get(s);
        if (v == null || v === "") continue;
        const stock = get(w.base);
        const dt = h("dt", "", label);
        dt.title = help;
        const dd = h("dd");
        const val = h("span", "gs-val", typeof v === "number" ? fmtNum(v, dec) : v);
        if (unit && typeof v === "number") val.append(h("span", "gs-unit", unit === "×" || unit === "°" ? unit : ` ${unit}`));
        dd.append(val);
        // Changed by the selected specs: show the stock value and whether it's better or worse.
        const differs = typeof v === "number" ? Math.abs(v - stock) > 1e-9 : v !== stock;
        if (differs) {
          const was = h("span", "gs-was", typeof stock === "number" ? fmtNum(stock, dec) : stock ?? "none");
          was.title = "Stock value";
          dd.append(was);
          if (typeof v === "number" && better) dd.classList.add((better === "low" ? v < stock : v > stock) ? "better" : "worse");
          else dd.classList.add("changed");
        }
        if (typeof v === "number") dd.append(meter(meterFill(v, domain(label, get), better)));
        dl.append(dt, dd);
      }
      g.append(dl);
      groups.append(g);
    }
    groups.append(spreadTable(w, s));
    panel.append(groups);
    return panel;
  }

  const fmtNum = (v, dec) => {
    const r = v.toFixed(dec);
    // Trim trailing zeros on the finer stats (0.150 → 0.15) but keep integers as they are.
    return dec > 1 ? r.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "") : r;
  };

  /** Stand / crouch / prone spread, aimed and from the hip, still and moving. */
  function spreadTable(w, s) {
    const g = h("section", "gs-group");
    g.append(h("h3", "", "Spread by stance"));
    const t = h("table", "gs-stance");
    t.innerHTML = "<thead><tr><th></th><th>Aimed</th><th>Aimed, moving</th><th>Hip</th><th>Hip, moving</th></tr></thead>";
    const tb = h("tbody");
    for (const st of ["Stand", "Crouch", "Prone"]) {
      const tr = h("tr");
      tr.append(h("th", "", st === "Stand" ? "Standing" : st === "Crouch" ? "Crouched" : "Prone"));
      for (const k of [`ADS${st}BaseMin`, `ADS${st}MoveMin`, `HIP${st}BaseMin`, `HIP${st}MoveMin`]) {
        const td = h("td", "", `${fmtNum(s[k], 3)}°`);
        if (Math.abs(s[k] - w.base[k]) > 1e-9) { td.classList.add(s[k] < w.base[k] ? "better" : "worse"); td.title = `Stock ${fmtNum(w.base[k], 3)}°`; }
        tr.append(td);
      }
      tb.append(tr);
    }
    t.append(tb);
    g.append(t);
    return g;
  }

  /** The four specialization tiers. Each pick narrows what the next tier offers, like in game. */
  function specTree(w) {
    const box = h("section", "gs-specs");
    const head = h("div", "gs-specs-head");
    head.append(h("h3", "", "Specializations"));
    const sel = combo(w) ? combo(w).split("+") : [];
    if (sel.length) {
      const reset = h("button", "btn ghost gs-reset", "Stock");
      reset.type = "button";
      reset.title = "Clear every specialization";
      reset.addEventListener("click", () => setCombo(w, []));
      head.append(reset);
    }
    box.append(head);

    const keys = Object.keys(w.variants).map((k) => k.split("+"));
    if (!keys.length) {
      box.append(h("p", "muted", "Sidearms have no specializations."));
      return box;
    }
    const depth = Math.max(...keys.map((k) => k.length));
    for (let i = 0; i < depth; i++) {
      // Options at tier i given the picks before it; later tiers preview what the first pick unlocks.
      const prefix = sel.slice(0, Math.min(i, sel.length));
      const opts = [...new Set(keys.filter((k) => k.length > i && prefix.every((c, j) => k[j] === c)).map((k) => k[i]))];
      const locked = i > sel.length;
      const row = h("div", "gs-tier");
      row.append(h("span", "gs-tier-n", String(i + 1)));
      for (const code of opts.slice(0, 2)) {
        const b = h("button", "gs-spec", w.specNames[code] || code);
        b.type = "button";
        b.disabled = locked;
        const on = sel[i] === code;
        b.setAttribute("aria-pressed", String(on));
        b.title = locked ? `Pick tier ${sel.length + 1} first` : on ? "Click to remove" : "";
        b.addEventListener("click", () => {
          if (on) return setCombo(w, sel.slice(0, i));
          const next = [...sel.slice(0, i), code, ...sel.slice(i + 1)];
          while (next.length && !w.variants[next.join("+")]) next.pop();
          setCombo(w, next.length ? next : [code]);
        });
        row.append(b);
      }
      box.append(row);
    }
    return box;
  }

  function setCombo(w, codes) {
    if (codes.length) prefs.specs[w.name] = codes.join("+");
    else delete prefs.specs[w.name];
    changed();
    renderList();
  }

  // ---------- chart ----------

  const MODES = {
    damage: { label: "Damage", value: (s, d) => shotDamage(s, d), fmt: (v) => round1(v), step: false },
    btk: { label: "Shots to kill", value: (s, d) => btk(s, d), fmt: (v) => v, step: true },
    ttk: { label: "Time to kill", value: (s, d) => ttk(s, d), fmt: (v) => `${Math.round(v)} ms`, step: true },
  };

  function chartBlock(w) {
    const box = h("section", "gs-chart");
    const head = h("div", "gs-chart-head");
    const seg = h("div", "gs-seg small");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Chart");
    for (const [k, m] of Object.entries(MODES)) {
      const b = h("button", "", m.label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(prefs.chart === k));
      b.addEventListener("click", () => {
        prefs.chart = k;
        changed();
        for (const x of seg.children) x.setAttribute("aria-pressed", String(x === b));
        draw();
      });
      seg.append(b);
    }
    const legend = h("span", "gs-legend");
    head.append(seg, legend);
    const plot = h("div", "gs-plot");
    const tip = h("div", "gs-tip");
    tip.setAttribute("aria-live", "polite");
    plot.append(tip);
    box.append(head, plot);

    const s = current(w);
    const stock = w.base;
    const sameCurve = (m) => {
      for (let d = 0; d <= MAX_RANGE; d += 5) if (Math.abs(m.value(s, d) - m.value(stock, d)) > 1e-6) return false;
      return true;
    };

    let svg = null;
    function draw() {
      const mode = MODES[prefs.chart];
      const width = Math.max(260, plot.clientWidth || 560);
      const H = 230, P = { l: 44, r: 14, t: 14, b: 28 };
      const showStock = !sameCurve(mode);
      legend.innerHTML = "";
      if (showStock) {
        legend.append(h("span", "key now", "With specs"), h("span", "key stock", "Stock"));
      }
      let ymax = 0;
      for (let d = 0; d <= MAX_RANGE; d++) {
        ymax = Math.max(ymax, mode.value(s, d), showStock ? mode.value(stock, d) : 0);
      }
      ymax = niceMax(ymax * 1.08);
      const x = (d) => P.l + (d / MAX_RANGE) * (width - P.l - P.r);
      const y = (v) => P.t + (1 - v / ymax) * (H - P.t - P.b);

      const path = (st) => {
        let p = "", prev = null;
        for (let d = 0; d <= MAX_RANGE; d++) {
          const v = mode.value(st, d);
          if (!p) p = `M${x(d)},${y(v)}`;
          else if (mode.step && v !== prev) p += `L${x(d)},${y(prev)}L${x(d)},${y(v)}`;
          else p += `L${x(d)},${y(v)}`;
          prev = v;
        }
        return p;
      };

      svg?.remove();
      svg = s$("svg", { width, height: H, class: "gs-svg", role: "img", "aria-label": `${mode.label} over range for ${w.name}` });
      for (const t of ticks(ymax, prefs.chart === "btk")) {
        svg.append(s$("line", { x1: P.l, x2: width - P.r, y1: y(t), y2: y(t), class: "grid" }));
        const lab = s$("text", { x: P.l - 8, y: y(t) + 4, class: "axis", "text-anchor": "end" });
        lab.textContent = prefs.chart === "ttk" ? Math.round(t) : t;
        svg.append(lab);
      }
      for (let d = 0; d <= MAX_RANGE; d += width < 420 ? 50 : 25) {
        const lab = s$("text", { x: x(d), y: H - 8, class: "axis", "text-anchor": d === 0 ? "start" : d === MAX_RANGE ? "end" : "middle" });
        lab.textContent = d === MAX_RANGE ? `${d} m` : d;
        svg.append(lab);
      }
      const area = `${path(s)}L${x(MAX_RANGE)},${y(0)}L${x(0)},${y(0)}Z`;
      svg.append(s$("path", { d: area, class: "area" }));
      if (showStock) svg.append(s$("path", { d: path(stock), class: "stock" }));
      svg.append(s$("path", { d: path(s), class: "line" }));

      // The table's range, which a click on the chart moves.
      const rx = x(prefs.range);
      svg.append(s$("line", { x1: rx, x2: rx, y1: P.t, y2: H - P.b, class: "range" }));

      const hover = s$("g", { class: "hover" });
      const hl = s$("line", { y1: P.t, y2: H - P.b, class: "hline" });
      const hd = s$("circle", { r: 4, class: "hdot" });
      hover.append(hl, hd);
      svg.append(hover);
      plot.prepend(svg);

      const at = (e) => {
        const r = svg.getBoundingClientRect();
        return Math.max(0, Math.min(MAX_RANGE, Math.round(((e.clientX - r.left - P.l) / (width - P.l - P.r)) * MAX_RANGE)));
      };
      const show = (d) => {
        const v = mode.value(s, d);
        hl.setAttribute("x1", x(d)); hl.setAttribute("x2", x(d));
        hd.setAttribute("cx", x(d)); hd.setAttribute("cy", y(v));
        hover.classList.add("on");
        tip.innerHTML = "";
        tip.append(h("b", "", `${d} m`), h("span", "", fmtDmg(s, d)), h("span", "", `${btk(s, d)} shot${btk(s, d) > 1 ? "s" : ""} · ${Math.round(ttk(s, d))} ms`));
        tip.append(h("span", "muted", `+${Math.round(travelMs(s, d))} ms bullet travel`));
        if (showStock) tip.append(h("span", "muted", `Stock: ${mode.fmt(mode.value(stock, d))}`));
        tip.classList.add("on");
        const left = Math.min(width - tip.offsetWidth - 4, Math.max(4, x(d) + 12));
        tip.style.translate = `${x(d) + 12 + tip.offsetWidth > width ? x(d) - tip.offsetWidth - 12 : left}px 0`;
      };
      const hide = () => { hover.classList.remove("on"); tip.classList.remove("on"); };
      svg.addEventListener("pointermove", (e) => show(at(e)));
      svg.addEventListener("pointerdown", (e) => show(at(e)));
      svg.addEventListener("pointerleave", hide);
      svg.addEventListener("click", (e) => setRange(at(e)));
    }

    // Drawn by renderList once the panel is in the page (it needs its width), and again when that
    // width changes.
    box.draw = draw;
    const ro = new ResizeObserver(() => { if (svg && Math.abs(svg.width.baseVal.value - plot.clientWidth) > 2) draw(); });
    ro.observe(plot);
    return box;
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(v));
    for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }
  function ticks(max, whole) {
    let step = niceMax(max / 4.5);
    if (whole) step = Math.max(1, Math.ceil(step));
    const out = [];
    for (let t = 0; t <= max + 1e-9; t += step) out.push(Math.round(t * 100) / 100);
    return out;
  }

  return { render, status };
})();
