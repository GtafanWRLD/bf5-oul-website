"use strict";

/**
 * The Randomizer tab: a random BFV loadout for a class. Primary weapons and spec trees come from
 * weapon-stats.js; sights, sidearms, gadgets, throwables and combat roles from loadouts.js.
 * Spec paths follow the same rule as Gun stats: a path is real if the datamine has stats for it,
 * or if it only differs by a last-tier spec with no stats (cosmetic).
 */
window.Randomizer = (() => {
  const CLASSES = ["Assault", "Medic", "Support", "Recon"];
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  /** Every full spec path a gun can actually have, as arrays of spec codes. */
  function specPaths(w) {
    if (!w.tree?.length) return [[]];
    let paths = [[]];
    for (const tier of w.tree) paths = paths.flatMap((p) => tier.map((code) => [...p, code]));
    const valid = (codes) => !codes.length || Boolean(w.variants?.[codes.join("+")])
      || (codes.length === w.tree.length && w.cosmetic?.includes(codes.at(-1)) && valid(codes.slice(0, -1)));
    return paths.filter(valid);
  }

  function roll(cls) {
    const L = window.LOADOUTS.classes[cls];
    const weapons = window.WEAPON_STATS.weapons;
    const gun = pick(weapons.filter((w) => w.cls === cls));
    const sidearm = pick(L.sidearms);
    return {
      cls,
      role: pick(L.roles),
      gun: gun.name,
      specs: pick(specPaths(gun)).map((code) => gun.specNames?.[code] || code),
      sight: pick(window.LOADOUTS.sights[gun.name] || ["Iron Sights"]),
      sidearm,
      gadget1: pick(L.gadget1),
      gadget2: pick(L.gadget2),
      throwable: pick(L.throwables),
    };
  }

  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  /** Wiki names that the catalog spells differently. */
  const CATALOG_NAMES = { "Anti-Tank Mine": "AT Mine", "Doppel Schuss": "Doppel-Schuss", "Throwing Knife": "Throwing Blade" };
  /** Picture for a weapon or gadget by name, from the gun data or the catalog. */
  const image = (name) => window.WEAPON_STATS?.weapons.find((w) => w.name === name)?.image
    || window.CATALOG?.weapons.find((w) => w.name.toLowerCase() === (CATALOG_NAMES[name] || name).toLowerCase())?.image;

  /**
   * Shows EA's picture with its empty transparent border cut off, so every gun fills the box the
   * same way (the files come in different shapes: MG42 is 256×85, Type 11 a 255 square). EA's CDN
   * only allows this for some images; the others show untrimmed.
   */
  function trimmed(img, src) {
    const probe = new Image();
    probe.crossOrigin = "anonymous";
    probe.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = probe.naturalWidth;
        c.height = probe.naturalHeight;
        const g = c.getContext("2d");
        g.drawImage(probe, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
        for (let y = 0; y < c.height; y++) {
          for (let x = 0; x < c.width; x++) {
            if (d[(y * c.width + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
          }
        }
        if (x1 < 0) { img.src = src; return; }
        const out = document.createElement("canvas");
        out.width = x1 - x0 + 1;
        out.height = y1 - y0 + 1;
        out.getContext("2d").drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
        img.src = out.toDataURL();
      } catch { img.src = src; }
    };
    probe.onerror = () => { img.src = src; };
    probe.src = src;
  }

  const asText = (r) => [
    `${r.cls}: ${r.role}`,
    `Primary: ${r.gun} (${r.sight})`,
    r.specs.length ? `Specializations: ${r.specs.join(", ")}` : null,
    `Sidearm: ${r.sidearm}`,
    `Gadgets: ${r.gadget1}, ${r.gadget2}`,
    `Throwable: ${r.throwable}`,
  ].filter(Boolean).join("\n");

  let root, prefs, onChange;

  function render(container, p, cb) {
    root = container;
    prefs = p;
    onChange = cb;
    prefs.cls ||= "any";
    root.innerHTML = "";
    if (!window.LOADOUTS || !window.WEAPON_STATS) {
      root.append(h("p", "gs-empty", "Couldn't load the loadout data (loadouts.js or weapon-stats.js is missing next to index.html)."));
      return;
    }
    const bar = h("div", "gs-toolbar");
    const seg = h("div", "gs-seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Class");
    for (const c of ["any", ...CLASSES]) {
      const b = h("button", "", c === "any" ? "Any class" : c);
      b.type = "button";
      b.setAttribute("aria-pressed", String(prefs.cls === c));
      b.addEventListener("click", () => { prefs.cls = c; reroll(); });
      seg.append(b);
    }
    const go = h("button", "btn primary", "Randomize");
    go.type = "button";
    go.addEventListener("click", reroll);
    bar.append(seg, go);
    root.append(bar);
    if (prefs.last) root.append(card(prefs.last));
    else root.append(h("p", "gs-empty", "Pick a class, or leave it on Any class, and hit Randomize."));
  }

  function reroll() {
    prefs.last = roll(prefs.cls === "any" ? pick(CLASSES) : prefs.cls);
    onChange?.();
    render(root, prefs, onChange);
    root.querySelector(".rand-card")?.classList.add("enter");
  }

  function card(r) {
    const el = h("div", "rand-card");
    const head = h("div", "rand-head");
    const title = h("div", "rand-title");
    title.append(h("span", "rand-cls", r.cls), h("span", "rand-role", r.role));
    const copy = h("button", "btn ghost", "Copy");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(asText(r)); copy.textContent = "Copied"; }
      catch { copy.textContent = "Couldn't copy"; }
      setTimeout(() => { copy.textContent = "Copy"; }, 1500);
    });
    head.append(title, copy);

    const primary = h("div", "rand-primary");
    const src = image(r.gun);
    if (src) { const img = h("img", "rand-img"); img.alt = ""; trimmed(img, src); primary.append(img); }
    const info = h("div", "rand-info");
    info.append(h("div", "rand-name", r.gun), h("div", "rand-sub", r.sight));
    if (r.specs.length) {
      const specs = h("ol", "rand-specs");
      r.specs.forEach((s) => specs.append(h("li", "", s)));
      info.append(specs);
    }
    primary.append(info);

    const items = h("div", "rand-items");
    for (const [label, name] of [["Sidearm", r.sidearm], ["Gadget 1", r.gadget1], ["Gadget 2", r.gadget2], ["Throwable", r.throwable]]) {
      const item = h("div", "rand-item");
      const pic = image(name);
      if (pic) { const img = h("img", "rand-thumb"); img.src = pic; img.alt = ""; img.onerror = () => img.remove(); item.append(img); }
      const txt = h("div", "rand-item-text");
      txt.append(h("span", "rand-label", label), h("span", "rand-item-name", name));
      item.append(txt);
      items.append(item);
    }
    el.append(head, primary, items);
    return el;
  }

  // Every path must be one of the gun's real combos (the same rule Gun stats uses).
  if (window.WEAPON_STATS) {
    for (const w of window.WEAPON_STATS.weapons) {
      for (const p of specPaths(w)) console.assert(p.length === (w.tree?.length || 0), `spec path length for ${w.name}`);
    }
  }

  return { render, status: () => "" };
})();
