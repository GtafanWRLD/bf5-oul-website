"use strict";

/**
 * The Vehicle upgrades tab: every BFV tank and plane's specialization tree (vehicle-specs.js, from
 * the Battlefield wiki) with what each upgrade does. There are no public vehicle numbers, so unlike
 * Gun stats this shows loadouts (weapons, ammo, payloads), upgrade trees and descriptions only.
 * Trees the wiki lists with only 4 tiers (the Pacific vehicles have 6) get a note.
 */
window.VehicleUpgrades = (() => {
  const DATA = window.VEHICLE_SPECS;
  const TYPES = [["Tanks", "Tanks"], ["Planes", "Planes"]];
  const FACTIONS = ["Germany", "United Kingdom", "USA", "Japan"];

  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  let root, prefs, onChange;
  let justOpened = null;
  const changed = () => onChange && onChange();
  /** Picked option index per tier (null = nothing picked), for one vehicle. */
  const picksOf = (v) => {
    const p = prefs.picks[v.name] || [];
    return v.tree.map((_, i) => (Number.isInteger(p[i]) && p[i] < v.tree[i].length ? p[i] : null));
  };

  /** Draws the tab into `container`. `p` is the saved prefs object (mutated in place); `cb` saves it. */
  function render(container, p, cb) {
    root = container;
    prefs = p;
    onChange = cb;
    prefs.type ||= "all";
    prefs.q ??= "";
    prefs.picks ||= {};
    if (!DATA) {
      root.innerHTML = "";
      root.append(h("p", "gs-empty", "Couldn't load the vehicle upgrades (vehicle-specs.js is missing next to index.html)."));
      return;
    }
    if (!root.dataset.built) build();
    syncControls();
    renderList();
  }

  function build() {
    root.dataset.built = "1";
    root.innerHTML = "";
    const bar = h("div", "gs-toolbar");

    const seg = h("div", "gs-seg");
    seg.id = "vuType";
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Vehicle type");
    for (const [t, label] of [["all", "All"], ...TYPES]) {
      const b = h("button", "", label);
      b.type = "button";
      b.dataset.type = t;
      b.addEventListener("click", () => { prefs.type = t; changed(); syncControls(); renderList(); });
      seg.append(b);
    }

    const search = h("label", "search-field gs-search");
    search.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
    const q = h("input", "field");
    q.type = "search";
    q.id = "vuQuery";
    q.placeholder = "Find a vehicle or upgrade…";
    q.setAttribute("aria-label", "Find a vehicle or upgrade");
    q.addEventListener("input", () => { prefs.q = q.value; changed(); renderList(); });
    search.append(q);

    bar.append(seg, search);

    const list = h("div", "vu-list");
    list.id = "vuList";

    const note = h("p", "hint");
    note.innerHTML =
      "Click a vehicle to see its loadout and specialization tree and plan a build; hover an upgrade to read what it does. " +
      "Performance numbers (health, speed, turn rate, shell damage) have never been published for BF5, so upgrades are described rather than measured. " +
      `Loadouts and upgrade lists from the <a href="${DATA?.source}" target="_blank" rel="noopener">Battlefield wiki</a>, ` +
      `with upgrade figures from <a href="https://www.gamepressure.com/battlefield-5/vehicles/z3bb87" target="_blank" rel="noopener">Gamepressure</a>.`;

    root.append(bar, list, note);
  }

  function syncControls() {
    const q = root.querySelector("#vuQuery");
    if (q.value !== prefs.q) q.value = prefs.q;
    for (const b of root.querySelectorAll("#vuType button")) b.setAttribute("aria-pressed", String(b.dataset.type === prefs.type));
  }

  function visible() {
    const q = prefs.q.trim().toLowerCase();
    return DATA.vehicles.filter((v) =>
      (prefs.type === "all" || v.type === prefs.type) &&
      (!q || v.name.toLowerCase().includes(q) || (v.faction || "").toLowerCase().includes(q) ||
        v.tree.some((tier) => tier.some((s) => s.name.toLowerCase().includes(q)))));
  }

  function renderList() {
    const list = root.querySelector("#vuList");
    const scrollY = window.scrollY;
    list.innerHTML = "";
    const shown = visible();
    if (!shown.length) {
      list.append(h("p", "gs-empty", "No vehicle matches that."));
      return;
    }
    // Grouped by type, then faction (vehicles without wiki data last).
    for (const [type, label] of TYPES) {
      for (const faction of [...FACTIONS, null]) {
        const group = shown.filter((v) => v.type === type && (v.faction || null) === faction);
        if (!group.length) continue;
        const gh = h("div", "gs-group-head");
        gh.append(h("span", "gs-group-cls", label), h("span", "gs-group-type", faction || "Not on the wiki yet"), h("span", "gs-group-n", String(group.length)));
        list.append(gh);
        for (const v of group) list.append(row(v));
      }
    }
    justOpened = null;
    window.scrollTo(0, scrollY);
  }

  function row(v) {
    const item = h("div", "gs-item");
    const btn = h("button", "vu-row");
    btn.type = "button";
    const open = prefs.open === v.name;
    btn.setAttribute("aria-expanded", String(open));

    const thumb = h("span", "gs-thumb vu-thumb");
    if (v.image) {
      const img = h("img");
      img.src = v.image;
      img.alt = "";
      img.loading = "lazy";
      img.onerror = () => img.remove();
      thumb.append(img);
    }
    const names = h("span", "gs-names");
    names.append(h("span", "gs-name", v.name));
    const picks = picksOf(v);
    const picked = picks.map((p, i) => (p == null ? null : v.tree[i][p].name)).filter(Boolean);
    names.append(h("span", picked.length ? "gs-sub" : "gs-sub vu-sub-muted", picked.length ? picked.join(" · ") : v.tree.length ? `${v.tree.length} tiers` : "No upgrade data"));

    const tags = h("span", "vu-tags");
    if (v.loadout?.role) tags.append(h("span", "vu-tag", v.loadout.role));
    if (v.tree.length) tags.append(h("span", "vu-tag", `${picked.length}/${v.tree.length} picked`));

    btn.append(thumb, names, tags);
    btn.addEventListener("click", () => {
      prefs.open = open ? null : v.name;
      justOpened = prefs.open;
      changed();
      renderList();
    });
    item.append(btn);
    if (open) {
      const d = detail(v);
      if (justOpened === v.name) d.classList.add("enter");
      item.append(d);
    }
    return item;
  }

  function detail(v) {
    const panel = h("div", "gs-detail");
    if (!v.tree.length && !v.loadout) {
      panel.append(h("p", "muted", "The Battlefield wiki doesn't cover this vehicle's loadout or specializations yet, so there's nothing reliable to show."));
      return panel;
    }
    if (v.partial) {
      panel.append(h("p", "vu-note",
        `Note: the wiki lists ${v.tree.length} upgrade tiers for the ${v.name}, while the Pacific vehicles have 6, so the in-game tree may have more.`));
    }
    if (v.loadout) panel.append(loadoutBox(v));
    if (v.tree.length) {
      const top = h("div", "gs-detail-top vu-detail-top");
      top.append(tree(v), buildSummary(v));
      panel.append(top);
    }
    return panel;
  }

  /**
   * The vehicle's stock weapons per seat, payload and equipment options (wiki infobox). Items
   * that come from an upgrade are tagged, and lit when that upgrade is in the planned build.
   */
  function loadoutBox(v) {
    const L = v.loadout;
    const key = (s) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");
    const picks = picksOf(v);
    const planned = new Set(picks.map((p, i) => (p == null ? null : key(v.tree[i][p].name))).filter(Boolean));
    const items = (list) => {
      const ul = h("ul", "vu-items");
      for (const text of list) {
        const upgrade = /\(upgrade\)/i.test(text);
        const isDefault = /\(default\)/i.test(text);
        const li = h("li", upgrade ? "upgrade" : "");
        li.append(h("span", "", text.replace(/\s*\((upgrade|default)\)/gi, "")));
        if (upgrade) {
          const on = planned.has(key(text));
          li.classList.toggle("on", on);
          li.append(h("span", "vu-item-tag", on ? "in your build" : "upgrade"));
        } else if (isDefault) li.append(h("span", "vu-item-tag", "default"));
        ul.append(li);
      }
      return ul;
    };
    // Seat names from the crew list ("1 Rear Gunner" → "Rear gunner"); the pilot/driver is first.
    const roles = L.crew.filter((c) => !/^\(/.test(c)).map((c) => c.replace(/^\d+\s*/, ""));
    const box = h("section", "gs-group vu-loadout");
    box.append(h("h3", "", "Loadout"));
    const dl = h("dl");
    const row = (label, content) => { dl.append(h("dt", "", label)); const dd = h("dd", "text"); dd.append(content); dl.append(dd); };
    if (L.role) row("Role", h("span", "gs-val", L.role));
    if (L.crew.length) row("Crew", h("span", "gs-val", L.crew.filter((c) => !/^\(/.test(c)).join(", ")));
    L.seats.forEach((seat, i) => {
      const wrap = h("div");
      wrap.append(items(seat.weapons));
      if (seat.ammo.length) wrap.append(h("span", "gs-was-text", `Ammo: ${seat.ammo.join(" · ")}`));
      row(`${roles[i] || `Seat ${i + 1}`} weapons`, wrap);
    });
    if (L.payload.length) {
      const wrap = h("div");
      wrap.append(items(L.payload));
      if (L.payloadAmmo.length) wrap.append(h("span", "gs-was-text", `Ammo: ${L.payloadAmmo.join(" · ")}`));
      row("Secondary", wrap);
    }
    L.equipment.forEach((slot, i) => row(`Equipment ${i + 1}`, items(slot)));
    box.append(dl);
    return box;
  }

  /** The tree: one pick per tier. Nothing is locked here because the wiki doesn't give the lines between upgrades for the current trees. */
  function tree(v) {
    const box = h("section", "gs-specs");
    const head = h("div", "gs-specs-head");
    head.append(h("h3", "", "Specializations"));
    const picks = picksOf(v);
    if (picks.some((p) => p != null)) {
      const reset = h("button", "btn ghost gs-reset", "Clear");
      reset.type = "button";
      reset.title = "Clear every pick";
      reset.addEventListener("click", () => { delete prefs.picks[v.name]; changed(); renderList(); });
      head.append(reset);
    }
    box.append(head);

    const infoBox = h("div", "gs-spec-info");
    infoBox.setAttribute("aria-live", "polite");
    const showInfo = (s) => {
      infoBox.innerHTML = "";
      if (!s) return infoBox.append(h("span", "muted", "Hover or tab to an upgrade to see what it does."));
      infoBox.append(h("b", "", s.name), h("span", "", s.desc));
    };
    showInfo();

    const wrap = h("div", "gs-tree vu-tree");
    v.tree.forEach((options, i) => {
      const row = h("div", "gs-tier");
      row.append(h("span", "gs-tier-n", String(i + 1)));
      const opts = h("div", "gs-tier-opts");
      opts.style.setProperty("--n", options.length);
      options.forEach((s, j) => {
        const b = h("button", "gs-spec");
        b.type = "button";
        b.append(h("span", "", s.name));
        const on = picks[i] === j;
        b.setAttribute("aria-pressed", String(on));
        b.addEventListener("pointerenter", () => showInfo(s));
        b.addEventListener("focus", () => showInfo(s));
        b.addEventListener("pointerleave", () => showInfo());
        b.addEventListener("blur", () => showInfo());
        b.addEventListener("click", () => {
          const next = picksOf(v);
          next[i] = on ? null : j;
          if (next.every((p) => p == null)) delete prefs.picks[v.name];
          else prefs.picks[v.name] = next;
          changed();
          renderList();
        });
        opts.append(b);
      });
      row.append(opts);
      wrap.append(row);
    });
    box.append(wrap, infoBox);
    return box;
  }

  /** "Your build": one fixed row per tier, so picking only changes text, never the layout. */
  function buildSummary(v) {
    const box = h("section", "gs-group vu-build");
    box.append(h("h3", "", "Your build"));
    const dl = h("dl");
    picksOf(v).forEach((p, i) => {
      dl.append(h("dt", "", `Tier ${i + 1}`));
      const dd = h("dd", "text");
      if (p == null) {
        dd.append(h("span", "gs-val vu-none", "Not picked"));
      } else {
        const s = v.tree[i][p];
        dd.append(h("span", "gs-val", s.name), h("span", "gs-was-text", s.desc));
      }
      dl.append(dd);
    });
    box.append(dl);
    return box;
  }

  return { render, status: () => (DATA ? "" : "Couldn't load the vehicle upgrades.") };
})();
