"use strict";

/**
 * The Gun stats tab: every BFV gun's datamined stats (weapon-stats.js, from sym.gg), grouped like
 * the in-game loadout screen (class, then weapon type), with a per-gun detail panel holding an
 * interactive damage / shots / time-to-kill chart and the specialization tree.
 *
 * Unlike sym's chart page, values here are derived from the selected specialization combo as a
 * whole, so specs that only change a multiplier still show up: Quick Reload scales reload times
 * through ReloadSpeed, Quick Aim raises the aim settle rate, ammo specs change the ammo type.
 */
window.GunStats = (() => {
  const DATA = window.WEAPON_STATS;
  const MAX_RANGE = 150;
  const CLASSES = ["Assault", "Medic", "Support", "Recon", "Sidearm"];
  /** Weapon types per class in loadout-screen order, with their plural group names. */
  const TYPES = [
    ["Assault rifle", "Assault rifles"], ["Semi-auto rifle", "Semi-auto rifles"],
    ["Smg", "Submachine guns"], ["Bolt action carbine", "Bolt-action carbines"],
    ["Lmg", "Light machine guns"], ["Mmg", "Medium machine guns"], ["Shotgun", "Shotguns"],
    ["Bolt action rifle", "Bolt-action rifles"], ["Self-loading rifle", "Self-loading rifles"],
    ["Pistol carbine", "Pistol carbines"], ["Anti-materiel rifle", "Anti-materiel rifles"],
    ["Sidearm", "Sidearms"],
  ];
  const TYPE_ORDER = TYPES.map(([t]) => t);
  const TYPE_PLURAL = Object.fromEntries(TYPES);
  const TYPE_SINGULAR = { Smg: "SMG", Lmg: "LMG", Mmg: "MMG", "Bolt action carbine": "Bolt-action carbine", "Bolt action rifle": "Bolt-action rifle" };
  const typeOf = (w) => w.type || w.cls;
  /** Group order; Recon's lone semi-auto (M3 Infrared) sits after its self-loading rifles. */
  const typeRank = (w) => (w.cls === "Recon" && typeOf(w) === "Semi-auto rifle" ? TYPE_ORDER.indexOf("Self-loading rifle") + .5 : TYPE_ORDER.indexOf(typeOf(w)));

  // ---------- maths ----------

  /**
   * Whether a path through the tree exists. sym stores every valid path, except that a last-tier
   * spec that changes no stats (the Garand's bayonet) is sometimes stored on only one branch.
   */
  function validPath(w, codes) {
    if (!codes.length) return true;
    if (w.variants[codes.join("+")]) return true;
    return codes.length === w.tree?.length && w.cosmetic?.includes(codes.at(-1)) && validPath(w, codes.slice(0, -1));
  }
  function resolve(w, combo) {
    const codes = combo ? combo.split("+") : [];
    // A path sym didn't store can only end in no-stat specs; its stats are the path before them.
    while (codes.length && !w.variants[codes.join("+")]) codes.pop();
    return codes.length ? { ...w.base, ...w.variants[codes.join("+")] } : w.base;
  }

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
  /** Burst guns (Breda) store the burst cycle in RoF and the firing rate inside a burst in BRoF; the latter is what the game shows. */
  const burstGun = (s) => s.ShotsPerBurst > 1 && s.BRoF > s.RoF;
  const rpm = (s) => (burstGun(s) ? s.BRoF : s.RoF);
  const reloadTime = (s) => { const r = reload(s); return r.tactical ?? r.clip ?? null; };

  // ---------- ammo names ----------

  /** The datamine's ammo ids (e.g. "Mauser792x57mm_HighROF_Fast") → cartridge names, by prefix. */
  const CALIBERS = [
    [/^12g_Slug/, "12 gauge slug"], [/^12g_Buckshot/, "12 gauge buckshot"],
    [/^30-06/, ".30-06 Springfield"], [/^(303_British|British303)/, ".303 British"], [/^30_Carbine/, ".30 Carbine"],
    [/^32ACP/, ".32 ACP"], [/^351Winchester/, ".351 Winchester"], [/^357Magnum/, ".357 Magnum"],
    [/^35Remington/, ".35 Remington"], [/^455Webley/, ".455 Webley"], [/^45(ACP|cal)/, ".45 ACP"],
    [/^55Boys/, ".55 Boys"], [/^75x54mm/, "7.5×54mm French"], [/^75x55/, "7.5×55mm Swiss"],
    [/^75x57mm/, "7.5×57mm French"], [/^762x53mmR/, "7.62×53mmR"], [/^77x58mm/, "7.7×58mm Arisaka"],
    [/^792x33mm/, "7.92×33mm Kurz"], [/^792x94mm/, "7.92×94mm Patrone"], [/^8mmLebel/, "8mm Lebel"],
    [/^8mmRibeyrolles/, "8mm Ribeyrolles"], [/^8x22mm/, "8×22mm Nambu"], [/^8x56mmR/, "8×56mmR"],
    [/^9mm_Export/, "9×25mm Mauser"], [/^(9x19mm|Welgun)/, "9×19mm Parabellum"], [/^9x23mm/, "9×23mm Largo"],
    [/^Carcano65x52mm/, "6.5×52mm Carcano"], [/^Mauser65x55mm/, "6.5×55mm Swedish"],
    [/^Mauser792x57mm/, "7.92×57mm Mauser"], [/^Mauser7x57mm/, "7×57mm Mauser"],
  ];
  /** Suffixes that a specialization adds; the rest (HighROF, Semi, MMG…) are internal variants. */
  const AMMO_TAGS = [
    [/Incendiary/, "incendiary"], [/APCR/, "APCR"], [/(LowDrag|LongRange)/, "low drag"],
    [/(_Fast|Aero)/, "high velocity"], [/Buckshot.*Improved/, "penetrating"], [/Slug.*Improved/, "solid slug"],
    [/^(?!12g).*Improved/, "improved"], [/MarkII/, "Mk II"], [/Sup+ressed/, "suppressed"],
  ];
  function ammoName(id) {
    if (!id) return null;
    const cal = CALIBERS.find(([re]) => re.test(id))?.[1] || id.replace(/_/g, " ");
    const tags = AMMO_TAGS.filter(([re]) => re.test(id)).map(([, t]) => t);
    return [cal, ...tags].join(" · ");
  }

  // ---------- what's shown ----------

  /** Table columns. `better` says which end of the range fills the meter and sorts first. */
  const COLUMNS = [
    { key: "dmg", label: "Damage", title: "Base damage per bullet (per pellet × pellets for shotguns)", better: "high", get: (s) => shotDamage(s, 0) },
    { key: "rpm", label: "RPM", title: "Rate of fire (within a burst for burst guns)", better: "high", get: (s) => rpm(s), fmt: (v) => v },
    { key: "vel", label: "Velocity", unit: "m/s", title: "Muzzle velocity", better: "high", get: (s) => s.InitialSpeed, fmt: (v) => v },
    { key: "mag", label: "Mag", title: "Magazine size", better: "high", get: (s) => s.MagSize, fmt: (v) => v },
    { key: "reload", label: "Reload", unit: "s", title: "Reload with rounds left (stripper-clip reload for bolt-actions)", better: "low", get: (s) => reloadTime(s), fmt: (v) => v.toFixed(2) },
  ];
  const SORTS = [
    ["name", "Name"], ["dmg", "Damage"], ["rpm", "Fire rate"],
    ["vel", "Bullet velocity"], ["mag", "Magazine size"], ["reload", "Reload time"],
  ];

  /** Detail panel stat groups: [label, getter, unit, better, decimals, help]. Text getters have no unit. */
  const GROUPS = [
    ["Handling", [
      ["Deploy time", (s) => s.DeployTime, "s", "low", 2, "Time to bring the gun up after switching to it."],
      ["Sprint-to-fire", (s) => s.SprintRecoverTimeMultiplier, "×", "low", 2, "Multiplier on the delay before you can fire after sprinting. Slings and Swivels lowers it."],
      ["Aim settle rate", (s) => s.ADSStandBaseSpreadIdleOffset, "", "high", 1, "How quickly spread settles after aiming in. Quick Aim raises it by 75%."],
    ]],
    ["Recoil, aimed", [
      ["First-shot kick", (s) => s.ADSStandRecoilInitialUp, "°", "low", 2, "Vertical recoil of the first shot."],
      ["Climb per shot", (s) => s.ADSStandRecoilUp, "°", "abs", 3, "Extra vertical recoil added by each following shot (negative pulls the sights down)."],
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
      ["Ammo", (s) => ammoName(s.Ammo), "", null, 0, "Cartridge. Penetration, headshot, incendiary and bullet specs swap it."],
      ["Magazine", (s) => s.MagSize, "", "high", 0, "Rounds per magazine."],
      ["Reload, rounds left", (s) => reload(s).tactical, "s", "low", 2, "Reload with rounds still in the magazine. Includes Quick Reload's speed-up."],
      ["Reload, empty", (s) => reload(s).empty, "s", "low", 2, "Reload from empty. Includes Quick Reload's speed-up."],
      ["Stripper clip", (s) => reload(s).clip, "s", "low", 2, "Reload a full clip from empty."],
      ["Per round", (s) => reload(s).perRound, "s", "low", 2, "Time to load each single round or shell."],
      ["Reload", (s) => (hasReload(s) ? null : "No data"), "", null, 0, "Reload times for this gun aren't known."],
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
  const round1 = (v) => (Math.round(v * 10) / 10).toString();
  const fmtNum = (v, dec) => {
    const r = v.toFixed(dec);
    // Trim trailing zeros on the finer stats (0.150 → 0.15) but keep integers as they are.
    return dec > 1 ? r.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "") : r;
  };
  const fmtDmg = (s, d) => {
    const one = damageAt(s, d);
    return s.ShotsPerShell > 1 ? `${round1(one * s.ShotsPerShell)} dmg (${s.ShotsPerShell} × ${round1(one)})` : `${round1(one)} dmg`;
  };

  // ---------- state ----------

  let root, prefs, onChange;
  let justOpened = null;
  /** Chart mode; not saved, so every visit starts on Damage. */
  let chartMode = "damage";
  const combo = (w) => prefs.specs[w.name] || "";
  const current = (w) => resolve(w, combo(w));
  const changed = () => onChange && onChange();

  /** Draws the tab into `container`. `p` is the saved prefs object (mutated in place); `cb` saves it. */
  function render(container, p, cb) {
    root = container;
    prefs = p;
    onChange = cb;
    prefs.cls ||= "all";
    prefs.q ??= "";
    if (!prefs.sort || !SORTS.some(([k]) => k === prefs.sort.key)) prefs.sort = { key: "name", dir: 1 };
    prefs.specs ||= {};
    // Saved paths from older data may no longer exist: keep the longest valid start of each.
    for (const w of DATA?.weapons || []) {
      const codes = (prefs.specs[w.name] || "").split("+").filter(Boolean);
      while (codes.length && !validPath(w, codes)) codes.pop();
      if (codes.length) prefs.specs[w.name] = codes.join("+");
      else delete prefs.specs[w.name];
    }
    delete prefs.chart; // older saves kept the chart mode; it now starts on Damage every visit
    if (!DATA) {
      root.innerHTML = "";
      root.append(h("p", "gs-empty", "Couldn't load the gun stats (weapon-stats.js is missing next to index.html)."));
      return;
    }
    if (!root.dataset.built) build();
    syncControls();
    renderList();
  }

  const status = () => (DATA ? "" : "Couldn't load the gun stats.");

  // ---------- toolbar ----------

  function build() {
    root.dataset.built = "1";
    root.innerHTML = "";

    const bar = h("div", "gs-toolbar");

    const seg = h("div", "gs-seg");
    seg.id = "gsClass";
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Class");
    for (const c of ["all", ...CLASSES]) {
      const b = h("button", "", c === "all" ? "All" : c === "Sidearm" ? "Sidearms" : c);
      b.type = "button";
      b.dataset.cls = c;
      b.addEventListener("click", () => { prefs.cls = c; changed(); syncControls(); renderList(); });
      seg.append(b);
    }

    const search = h("label", "search-field gs-search");
    search.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
    const q = h("input", "field");
    q.type = "search";
    q.id = "gsQuery";
    q.placeholder = "Find a gun…";
    q.setAttribute("aria-label", "Find a gun");
    q.addEventListener("input", () => { prefs.q = q.value; changed(); renderList(); });
    search.append(q);

    const sortWrap = h("label", "gs-sortby");
    sortWrap.append(h("span", "muted", "Sort"));
    const sel = h("select", "field");
    sel.id = "gsSort";
    sel.setAttribute("aria-label", "Sort guns within each group");
    for (const [k, label] of SORTS) {
      const o = h("option", "", k === "name" ? "Name (A–Z)" : `${label} (best first)`);
      o.value = k;
      sel.append(o);
    }
    sel.addEventListener("change", () => { prefs.sort = { key: sel.value, dir: 1 }; changed(); renderList(); });
    sortWrap.append(sel);

    bar.append(seg, search, sortWrap);

    const table = h("div", "gs-table");
    table.id = "gsTable";

    const note = h("p", "hint");
    note.innerHTML =
      "Click a gun for its damage chart, specializations and full stats; hover the chart to read any distance. " +
      "Time to kill assumes body shots from 100 health (every pellet hitting for shotguns) and leaves out bullet travel. " +
      `Meters compare each stat with every stock gun. Stats datamined by <a href="https://sym.gg/legacy/index.html?game=bfv&page=charts" target="_blank" rel="noopener">sym.gg</a>.`;

    root.append(bar, table, note);
  }

  function syncControls() {
    const q = root.querySelector("#gsQuery");
    if (q.value !== prefs.q) q.value = prefs.q;
    for (const b of root.querySelectorAll("#gsClass button")) b.setAttribute("aria-pressed", String(b.dataset.cls === prefs.cls));
  }

  // ---------- table ----------

  function visible() {
    const q = prefs.q.trim().toLowerCase();
    return DATA.weapons.filter((w) =>
      (prefs.cls === "all" || w.cls === prefs.cls) &&
      (!q || w.name.toLowerCase().includes(q) || typeOf(w).toLowerCase().includes(q) || (TYPE_PLURAL[typeOf(w)] || "").toLowerCase().includes(q)));
  }

  /** Orders guns inside a group: best first for stats, A–Z for names; dir -1 reverses. */
  function compare(a, b) {
    const k = prefs.sort.key;
    if (k === "name") return a.name.localeCompare(b.name) * prefs.sort.dir;
    const col = COLUMNS.find((c) => c.key === k);
    const va = col.get(current(a)), vb = col.get(current(b));
    if (va == null && vb == null) return a.name.localeCompare(b.name);
    if (va == null) return 1;
    if (vb == null) return -1;
    const d = (col.better === "high" ? vb - va : va - vb) * prefs.sort.dir;
    return d || a.name.localeCompare(b.name);
  }

  function renderList() {
    const table = root.querySelector("#gsTable");
    const scrollY = window.scrollY;
    table.innerHTML = "";
    root.querySelector("#gsSort").value = prefs.sort.key;

    const head = h("div", "gs-head");
    const headCell = (key, label, title) => {
      const b = h("button", "gs-sort", label);
      b.type = "button";
      b.dataset.col = key;
      b.title = `${title}. Click to sort.`;
      const active = prefs.sort.key === key;
      if (active) b.dataset.dir = prefs.sort.dir > 0 ? "best" : "worst";
      b.addEventListener("click", () => {
        prefs.sort = { key, dir: active ? -prefs.sort.dir : 1 };
        changed();
        renderList();
      });
      return b;
    };
    head.append(headCell("name", "Gun", "Name"));
    for (const c of COLUMNS) head.append(headCell(c.key, c.label, c.title));
    table.append(head);

    const list = visible();
    if (!list.length) {
      table.append(h("p", "gs-empty", "No gun matches that."));
      return;
    }

    // Grouped like the loadout screen: class, then weapon type.
    const groups = new Map();
    for (const cls of CLASSES) {
      for (const w of list.filter((x) => x.cls === cls).sort((a, b) => typeRank(a) - typeRank(b))) {
        const key = `${cls}|${typeOf(w)}`;
        if (!groups.has(key)) groups.set(key, { cls, type: typeOf(w), guns: [] });
        groups.get(key).guns.push(w);
      }
    }

    for (const g of groups.values()) {
      const gh = h("div", "gs-group-head");
      if (prefs.cls === "all" && g.cls !== "Sidearm") gh.append(h("span", "gs-group-cls", g.cls));
      gh.append(h("span", "gs-group-type", TYPE_PLURAL[g.type] || g.type), h("span", "gs-group-n", String(g.guns.length)));
      table.append(gh);
      for (const w of g.guns.sort(compare)) table.append(row(w));
    }

    justOpened = null;
    // Re-rendering replaces the rows; keep the page where it was.
    window.scrollTo(0, scrollY);
  }

  function row(w) {
    const s = current(w);
    const item = h("div", "gs-item");
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
    if (combo(w)) {
      const codes = combo(w).split("+");
      const sub = h("span", "gs-sub", codes.map((c) => w.specNames[c] || c).join(" · "));
      names.append(sub);
    }
    gun.append(thumb, names);
    btn.append(gun);

    for (const c of COLUMNS) {
      const cell = h("span", "gs-cell");
      cell.dataset.col = c.key;
      if (c.key === "dmg") {
        cell.append(damageCell(s));
      } else {
        const v = c.get(s);
        const num = h("span", "gs-num", v == null ? "—" : c.fmt(v));
        if (v != null && c.unit) num.append(h("span", "gs-unit", ` ${c.unit}`));
        if (v == null) num.title = "Not in the datamine";
        if (c.key === "rpm" && burstGun(s)) num.title = `${s.BRoF} rpm within ${s.ShotsPerBurst}-round bursts, up to ${s.RoF} bursts per minute`;
        cell.append(num);
      }
      btn.append(cell);
    }
    btn.addEventListener("click", () => {
      prefs.open = prefs.open === w.name ? null : w.name;
      justOpened = prefs.open;
      changed();
      renderList();
    });
    item.append(btn);
    if (prefs.open === w.name) {
      const d = detail(w);
      // Only opening animates; spec picks redraw the panel in place.
      if (justOpened === w.name) d.classList.add("enter");
      item.append(d);
      // The chart needs its width, so it's drawn once the panel is in the page.
      queueMicrotask(() => { d.querySelector(".gs-chart")?.draw(); d.querySelector(".gs-specs")?.drawLines?.(); });
    }
    return item;
  }

  /** Base damage per bullet, or per pellet × pellet count for shotguns. */
  function damageCell(s) {
    const one = damageAt(s, 0);
    const wrap = h("span", "gs-num", round1(one));
    if (s.ShotsPerShell > 1) wrap.append(h("span", "gs-unit", ` × ${s.ShotsPerShell}`));
    return wrap;
  }

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
        if (typeof v === "number") {
          const val = h("span", "gs-val", fmtNum(v, dec));
          if (unit) val.append(h("span", "gs-unit", unit === "×" || unit === "°" ? unit : ` ${unit}`));
          dd.append(val);
          // Changed by the selected specs: show the stock value and whether it's better or worse.
          if (typeof stock === "number" && Math.abs(v - stock) > 1e-9) {
            const was = h("span", "gs-was", fmtNum(stock, dec));
            was.title = "Stock value";
            dd.append(was);
            const improved = better === "abs" ? Math.abs(v) < Math.abs(stock) : better === "low" ? v < stock : v > stock;
            if (better) dd.classList.add(improved ? "better" : "worse");
          }
          // "abs" stats (recoil climb can be negative) are judged by size.
          const abs = better === "abs";
          dd.append(meter(meterFill(abs ? Math.abs(v) : v, domain(label, abs ? (x) => Math.abs(get(x)) : get), abs ? "low" : better)));
        } else {
          // Text (ammo, missing data) gets the full width and wraps normally.
          dd.classList.add("text");
          dd.append(h("span", "gs-val", v));
          if (stock !== v) {
            dd.classList.add("changed");
            dd.append(h("span", "gs-was-text", `Stock: ${stock ?? "none"}`));
          }
        }
        dl.append(dt, dd);
      }
      // Effects the numbers can't show, as normal rows. A row exists whenever the spec is in this
      // gun's tree, picked or not, so picking never adds or removes rows.
      const picked = new Set(combo(w) ? combo(w).split("+") : []);
      for (const [code, label, on, off, help] of EFFECT_ROWS[title] || []) {
        if (!w.tree?.some((tier) => tier.includes(code))) continue;
        if (code === "QRel" && !w.cosmetic?.includes(code)) continue; // shown in the reload times instead
        const dt = h("dt", "", label);
        dt.title = help;
        const dd = h("dd", "text");
        dd.append(h("span", "gs-val", picked.has(code) ? on : off));
        if (picked.has(code)) dd.classList.add("better");
        dl.append(dt, dd);
      }
      g.append(dl);
      groups.append(g);
    }
    groups.append(spreadTable(w, s));
    panel.append(groups);
    return panel;
  }

  /**
   * Spec effects that aren't in the datamined numbers, per stat group: [code, label, with the
   * spec, without it, help]. Amounts are from the Battlefield wiki.
   */
  const EFFECT_ROWS = {
    Handling: [
      ["QADS", "Aim-in speed", "33% faster", "Normal", "Quick Aim: aim down sights 33% faster. Actual aim times depend on the gun and sight, so only the change is shown."],
      ["MoAD", "Moving while aimed", "60% faster", "Normal", "Lightened Stock: move 60% faster while aiming down sights."],
    ],
    "Ammo and reload": [
      ["QRel", "Quick Reload", "15% faster reloads", "Not picked", "Quick Reload: reloads 15% faster. This gun's base reload times aren't known."],
      ["Cool", "Overheating", "33% slower", "Normal", "Chrome Lining: heats up 33% slower when firing continuously (about 1.5× as long a burst), with less accuracy loss when hot."],
      ["Head", "Headshot damage", "+25%", "Normal", "Solid Slug: 25% more headshot damage and a longer lethal range."],
      ["Pene", "Penetration", "Through cover and enemies", "None", "Penetrating Shot: pellets go through cover and enemies, hitting whoever's behind."],
      ["Ince", "Damage to aircraft", "2×", "Normal", "Incendiary Bullets: double damage to aircraft; infantry damage is unchanged."],
      ["APCR", "Damage to vehicles", "Higher", "Normal", "APCR Bullets: more damage to vehicles."],
    ],
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

  /** What each specialization does in game (Battlefield wiki, "Weapon Specializations"). */
  const SPEC_INFO = {
    VRec: { desc: "Reduces vertical recoil." },
    QADS: { desc: "Aim down sights 33% faster (25% less time to aim in)." },
    QDep: { desc: "Switch weapons 15% faster and fire sooner after sprinting." },
    HRec: { desc: "Reduces horizontal recoil." },
    ADSS: { desc: "Tighter spread when aiming and standing still." },
    IADS: { desc: "Tighter spread when aiming." },
    Hipf: { desc: "25% less hip-fire spread and 33% longer effective hip-fire range." },
    ADSM: { desc: "Tighter spread when aiming while moving." },
    FBul: { desc: "Bullets fly 10% faster, so distant and moving targets are easier to hit." },
    MoAD: { desc: "Move 60% faster while aiming down sights." },
    Magd: { desc: "Hip-fire spread grows more slowly, so you can fire longer from the hip." },
    ExMa: { desc: "Bigger magazine." },
    QRel: { desc: "Reloads 15% faster." },
    Bayo: { desc: "Fits a bayonet, allowing a bayonet charge." },
    IROF: { desc: "Higher fire rate in full auto." },
    QBCy: { desc: "Higher fire rate in full auto." },
    DMag: { desc: "Detachable magazines instead of stripper clips or single rounds: faster reloads and 1 more round." },
    QCyc: { desc: "Higher fire rate." },
    QCyP: { desc: "Higher fire rate." },
    Long: { desc: "Less bullet drop at long range." },
    Zero: { desc: "Adjust the scope's zeroing distance for long shots." },
    Bipo: { desc: "Fits a bipod to deploy on cover." },
    IBip: { desc: "More accurate while the bipod is deployed." },
    Cool: { desc: "Overheats 33% slower when firing continuously, with less accuracy loss when hot." },
    Drum: { desc: "Drum magazine: 25 more rounds and a faster reload." },
    ExBe: { desc: "Bigger ammo belt." },
    Flas: { desc: "Flash hider: much less muzzle flash, so you're harder to spot." },
    Ince: { desc: "Incendiary rounds: double damage to aircraft." },
    Heav: { desc: "Heavier ammunition for more damage at range." },
    Slug: { desc: "Fires a single slug: tight spread and much more damage per hit." },
    Head: { desc: "Longer lethal range and 25% more headshot damage." },
    Pene: { desc: "Pellets go through cover and enemies, hitting whoever's behind." },
    Chok: { desc: "Full choke: a 33% tighter pellet spread." },
    ITri: { desc: "Shorter delay between shots: higher fire rate." },
    BROF: { desc: "Shorter delay between shots: higher fire rate." },
    Gren: { desc: "Rifle grenades hit vehicles harder, with a smaller blast." },
    APCR: { desc: "Armour-piercing rounds: more damage to vehicles." },
    Fire: { desc: "Adds fully automatic fire." },
    HiPo: { desc: "Scope zoom goes from 3× to 6×." },
    GLau: { desc: "Lets the rifle fire rifle grenades." },
    Supp: { desc: "Suppressor: quieter shots that don't show you on the minimap." },
    TopU: { desc: "Reload a partly empty magazine by topping it up."  },
  };
  const specInfo = (w, code) => {
    const info = SPEC_INFO[code] || {};
    // On the Garand, "Heavy Load" makes it fire like a semi-auto sniper rifle, not a shotgun load.
    if (code === "Heav" && w.cls !== "Support") return { desc: "Heavier rounds: more damage, slower fire, like a semi-auto sniper rifle." };
    return info;
  };

  /**
   * The specialization tree, laid out and wired like the in-game one: four tiers, each a free pick,
   * except tier 3, which follows the side picked in tier 2. Lines show which nodes connect; the
   * picked path is lit.
   */
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

    const tree = w.tree || [];
    if (!tree.length) {
      box.append(h("p", "muted", "Sidearms have no specializations."));
      return box;
    }

    // Which node connects to which in the next tier, from every valid path.
    const edges = new Set();
    for (const k of Object.keys(w.variants)) {
      const c = k.split("+");
      for (let i = 0; i + 1 < c.length; i++) edges.add(`${i}:${c[i]}>${c[i + 1]}`);
    }
    const last = tree.length - 1;
    for (const b of tree[last] || []) if (last > 0 && w.cosmetic?.includes(b)) for (const a of tree[last - 1]) edges.add(`${last - 1}:${a}>${b}`);

    const wrap = h("div", "gs-tree");
    const svg = s$("svg", { class: "gs-tree-lines", "aria-hidden": "true" });
    wrap.append(svg);
    // One fixed line under the tree explains whichever node is hovered or focused; it has a set
    // height, so nothing around it moves.
    const infoBox = h("div", "gs-spec-info");
    infoBox.setAttribute("aria-live", "polite");
    const IDLE = "Hover or tab to a specialization to see what it does.";
    const showInfo = (name, text) => {
      infoBox.innerHTML = "";
      if (!name) return infoBox.append(h("span", "muted", IDLE));
      infoBox.append(h("b", "", name), h("span", "", text));
    };
    showInfo();
    const nodes = new Map();
    tree.forEach((options, i) => {
      const row = h("div", "gs-tier");
      row.append(h("span", "gs-tier-n", String(i + 1)));
      const opts = h("div", "gs-tier-opts");
      opts.style.setProperty("--n", options.length);
      for (const code of options) {
        const on = sel[i] === code;
        const reachable = i <= sel.length && validPath(w, [...sel.slice(0, i), code]);
        const b = h("button", "gs-spec");
        b.type = "button";
        b.append(h("span", "", w.specNames[code] || code));
        b.setAttribute("aria-pressed", String(on));
        let tip = specInfo(w, code).desc || "";
        let blocked = false;
        if (i > sel.length) {
          blocked = true;
          b.classList.add("ahead");
          tip = `${tip} Pick tier ${sel.length + 1} first.`;
        } else if (!reachable) {
          blocked = true;
          b.classList.add("locked");
          const via = tree[i - 1]?.find((p) => edges.has(`${i - 1}:${p}>${code}`));
          tip = `${tip} Only after ${w.specNames[via] || "the other branch"}.`;
        } else if (on) {
          tip = `${tip} Click to remove.`;
        }
        // aria-disabled rather than disabled, so locked nodes can still be hovered or focused to read why.
        if (blocked) b.setAttribute("aria-disabled", "true");
        const name = w.specNames[code] || code;
        b.addEventListener("pointerenter", () => showInfo(name, tip.trim()));
        b.addEventListener("focus", () => showInfo(name, tip.trim()));
        b.addEventListener("pointerleave", () => showInfo());
        b.addEventListener("blur", () => showInfo());
        b.addEventListener("click", () => {
          if (blocked) return;
          if (on) return setCombo(w, sel.slice(0, i));
          const next = [...sel.slice(0, i), code, ...sel.slice(i + 1)];
          // Keep the later picks where possible: a tier-3 pick moves to the new branch's node.
          for (let j = i + 1; j < next.length; j++) {
            const ok = tree[j].filter((c) => validPath(w, [...next.slice(0, j), c]));
            if (ok.includes(next[j])) continue;
            if (ok.length === 1 && j === 2) next[j] = ok[0];
            else { next.length = j; break; }
          }
          setCombo(w, next);
        });
        nodes.set(`${i}:${code}`, b);
        opts.append(b);
      }
      row.append(opts);
      wrap.append(row);
    });
    box.append(wrap, infoBox);

    // Lines are drawn from the laid-out node positions, so they wait until the tree is in the page.
    box.drawLines = () => {
      if (!wrap.isConnected) return;
      const origin = wrap.getBoundingClientRect();
      svg.setAttribute("width", origin.width);
      svg.setAttribute("height", origin.height);
      svg.innerHTML = "";
      const lit = [], open = [], rest = [];
      for (const e of edges) {
        const [, i, a, b] = e.match(/^(\d+):(.+)>(.+)$/);
        const from = nodes.get(`${i}:${a}`), to = nodes.get(`${+i + 1}:${b}`);
        if (!from || !to) continue;
        const r1 = from.getBoundingClientRect(), r2 = to.getBoundingClientRect();
        const x1 = r1.left + r1.width / 2 - origin.left, y1 = r1.bottom - origin.top;
        const x2 = r2.left + r2.width / 2 - origin.left, y2 = r2.top - origin.top;
        const my = (y1 + y2) / 2;
        const d = `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
        const picked = sel[i] === a;
        (picked && sel[+i + 1] === b ? lit : picked && +i + 1 === sel.length ? open : rest).push(d);
      }
      // Dim lines first so the lit path draws on top.
      for (const [list, cls] of [[rest, "dim"], [open, "open"], [lit, "lit"]]) {
        for (const d of list) svg.append(s$("path", { d, class: cls }));
      }
    };
    new ResizeObserver(() => box.drawLines()).observe(wrap);
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
      b.setAttribute("aria-pressed", String(chartMode === k));
      b.addEventListener("click", () => {
        chartMode = k;
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
      if (!plot.isConnected) return;
      const mode = MODES[chartMode];
      const width = Math.max(260, plot.clientWidth || 560);
      const H = 230, P = { l: 44, r: 14, t: 14, b: 28 };
      const showStock = !sameCurve(mode);
      legend.innerHTML = "";
      if (showStock) legend.append(h("span", "key now", "With specs"), h("span", "key stock", "Stock"));
      let ymax = 0;
      for (let d = 0; d <= MAX_RANGE; d++) ymax = Math.max(ymax, mode.value(s, d), showStock ? mode.value(stock, d) : 0);
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
      for (const t of ticks(ymax, chartMode === "btk")) {
        svg.append(s$("line", { x1: P.l, x2: width - P.r, y1: y(t), y2: y(t), class: "grid" }));
        const lab = s$("text", { x: P.l - 8, y: y(t) + 4, class: "axis", "text-anchor": "end" });
        lab.textContent = chartMode === "ttk" ? Math.round(t) : t;
        svg.append(lab);
      }
      for (let d = 0; d <= MAX_RANGE; d += width < 420 ? 50 : 25) {
        const lab = s$("text", { x: x(d), y: H - 8, class: "axis", "text-anchor": d === 0 ? "start" : d === MAX_RANGE ? "end" : "middle" });
        lab.textContent = d === MAX_RANGE ? `${d} m` : d;
        svg.append(lab);
      }
      svg.append(s$("path", { d: `${path(s)}L${x(MAX_RANGE)},${y(0)}L${x(0)},${y(0)}Z`, class: "area" }));
      if (showStock) svg.append(s$("path", { d: path(stock), class: "stock" }));
      svg.append(s$("path", { d: path(s), class: "line" }));

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
        const n = btk(s, d);
        tip.append(h("b", "", `${d} m`), h("span", "", fmtDmg(s, d)), h("span", "", `${n} shot${n > 1 ? "s" : ""} to kill · ${Math.round(ttk(s, d))} ms`));
        tip.append(h("span", "muted", `+${Math.round(travelMs(s, d))} ms bullet travel`));
        if (showStock) tip.append(h("span", "muted", `Stock: ${mode.fmt(mode.value(stock, d))}`));
        tip.classList.add("on");
        // Right of the cursor, or left of it near the right edge.
        const right = x(d) + 12;
        tip.style.translate = `${right + tip.offsetWidth > width ? x(d) - tip.offsetWidth - 12 : right}px 0`;
      };
      const hide = () => { hover.classList.remove("on"); tip.classList.remove("on"); };
      svg.addEventListener("pointermove", (e) => show(at(e)));
      svg.addEventListener("pointerdown", (e) => show(at(e)));
      svg.addEventListener("pointerleave", hide);
    }

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
