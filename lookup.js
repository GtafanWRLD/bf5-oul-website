"use strict";

/**
 * The Player lookup tab: one BFV PC player's profile from gametools.network (stats, top weapons
 * and vehicles, platoons, other BF games) and whether they're on a server right now, found by
 * checking every live server's player list. Uses index.html's global api() and mapLimit().
 *
 * Name history and "last seen" come from our Discord bot, which reads every live server every two
 * minutes: tools/build-bot-history.mjs turns a copy of its store into bot-history.js, loaded only
 * when this tab is used. Country isn't available for BFV from any source.
 */
window.PlayerLookup = (() => {
  const GAMES = [["bf3", "BF3"], ["bf4", "BF4"], ["bfh", "Hardline"], ["bf1", "BF1"], ["bfv", "BFV"], ["bf2042", "2042"]];

  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const num = (v, d = 0) => (v == null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }));
  const hours = (s) => `${num(s / 3600)} h`;

  let root, prefs, onChange, els;

  /** Loads bot-history.js once (3 MB, so only when someone looks a player up). Null if it's missing. */
  let historyLoad;
  const loadHistory = () => (historyLoad ||= new Promise((done) => {
    if (window.BOT_HISTORY) return done(window.BOT_HISTORY);
    const tag = document.createElement("script");
    tag.src = "bot-history.js";
    tag.onload = () => done(window.BOT_HISTORY || null);
    tag.onerror = () => done(null);
    document.head.append(tag);
  }));
  /** The bot's record for a player: by id, else by any name they've had (newest sighting wins). */
  function historyOf(hist, ids, name) {
    if (!hist) return null;
    for (const id of ids) if (id && hist.players[id]) return { id, rec: hist.players[id] };
    const lower = name.toLowerCase();
    let best = null;
    for (const [id, rec] of Object.entries(hist.players)) {
      const hit = rec[0].find((n) => n[0].toLowerCase() === lower);
      if (hit && (!best || hit[2] > best.at)) best = { id, rec, at: hit[2] };
    }
    return best;
  }
  const ago = (sec) => {
    const days = (Date.now() / 1000 - sec) / 86400;
    if (days < 1 / 24) return "just now";
    if (days < 1) return `${Math.round(days * 24)} h ago`;
    if (days < 60) return `${Math.round(days)} days ago`;
    return new Date(sec * 1000).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  };
  /** Bumped on every lookup so a slow older one doesn't draw over a newer one. */
  let run = 0;

  function render(container, p, cb) {
    root = container;
    prefs = p;
    onChange = cb;
    prefs.recent ||= [];
    if (!root.dataset.built) build();
    drawRecent();
  }

  function build() {
    root.dataset.built = "1";
    root.innerHTML = `
      <form class="lk-search" role="search">
        <input class="field" name="q" placeholder="EA / Origin name (PC)" autocomplete="off" spellcheck="false" aria-label="Player name">
        <button class="btn primary" type="submit">Look up</button>
      </form>
      <div class="lk-recent"></div>
      <div class="lk-out"></div>`;
    els = { form: root.querySelector("form"), recent: root.querySelector(".lk-recent"), out: root.querySelector(".lk-out") };
    els.form.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = els.form.q.value.trim();
      if (q) lookup(q);
    });
    if (prefs.last) lookup(prefs.last, false);
  }

  function drawRecent() {
    els.recent.innerHTML = "";
    for (const name of prefs.recent) {
      const b = h("button", "lk-chip", name);
      b.type = "button";
      b.addEventListener("click", () => lookup(name));
      els.recent.append(b);
    }
  }

  /** Name → persona. /bfglobal/player/ misses some names that /bfglobal/games/ finds. */
  async function resolve(name) {
    try {
      const p = await api("/bfglobal/player/", { name, platform: "pc" }, 15000);
      return { id: String(p.personaId), userId: String(p.userId), name: p.personaName, avatar: p.avatar };
    } catch {
      const g = await api("/bfglobal/games/", { name, platform: "pc" }, 15000);
      return { id: String(g.id), userId: String(g.userId), name: g.userName, avatar: g.avatar };
    }
  }

  async function lookup(name, remember = true) {
    const me = ++run;
    els.form.q.value = name;
    els.out.innerHTML = "";
    els.out.append(h("p", "gs-empty", `Looking up ${name}…`));
    let who;
    const hist = loadHistory();
    try { who = await resolve(name); } catch (err) {
      // Maybe an old name: the bot knows which player had it and what they're called now.
      const old = historyOf(await hist, [], name);
      const now = old?.rec[0].at(-1)[0];
      if (now && now.toLowerCase() !== name.toLowerCase()) {
        try { who = await resolve(now); } catch {}
      }
      if (!who) {
        if (me === run) { els.out.innerHTML = ""; els.out.append(h("p", "gs-empty", `No PC player named "${name}" (${err.message}).`)); }
        return;
      }
    }
    const [stats, games, history] = await Promise.all([
      api("/bfv/all/", { playerid: who.id, platform: "pc", skip_battlelog: true, format_values: false }, 30000).catch(() => null),
      api("/bfglobal/games/", { playerid: who.id, platform: "pc" }, 15000).catch(() => null),
      hist,
    ]);
    if (me !== run) return;
    if (remember) {
      prefs.last = who.name;
      prefs.recent = [who.name, ...prefs.recent.filter((n) => n.toLowerCase() !== who.name.toLowerCase())].slice(0, 8);
      onChange?.();
      drawRecent();
    }
    els.out.innerHTML = "";
    const known = historyOf(history, [who.id, who.userId], who.name);
    els.out.append(profile(who, stats, games, known, history));
    findOnline(who, me, known);
  }

  function profile(who, s, games, known, history) {
    const box = h("div", "lk-profile enter");
    const head = h("div", "lk-head");
    const av = h("img", "lk-avatar");
    av.src = s?.avatar || who.avatar || "";
    av.alt = "";
    av.onerror = () => av.remove();
    const id = h("div", "lk-id");
    const nameRow = h("div", "lk-name-row");
    nameRow.append(h("h2", "lk-name", who.name));
    if (s?.rankImg) { const r = h("img", "lk-rank"); r.src = s.rankImg; r.alt = ""; nameRow.append(r); }
    if (s) nameRow.append(h("span", "lk-rank-n", `Rank ${s.rank}`));
    id.append(nameRow);
    const tags = h("div", "lk-tags");
    for (const pl of s?.platoons || []) {
      const t = h("span", "lk-tag" + (pl.id === s.activePlatoon?.id ? " active" : ""), `[${pl.tag}]`);
      t.title = pl.name + (pl.id === s.activePlatoon?.id ? " (active)" : "");
      tags.append(t);
    }
    const owned = GAMES.filter(([k]) => games?.[k]);
    if (owned.length) tags.append(h("span", "lk-games", `Owns ${owned.map(([, n]) => n).join(", ")}`));
    id.append(tags);
    const others = known?.rec[0].filter((n) => n[0].toLowerCase() !== who.name.toLowerCase());
    if (others?.length) {
      const aka = h("div", "lk-aka");
      aka.append(h("span", "lk-aka-l", "Also known as "), document.createTextNode(others.map((n) => `${n[0]} (until ${ago(n[2])})`).join(", ")));
      aka.title = `Names our Discord bot has seen this player use, data until ${history.dataUntil?.slice(0, 10) || "?"}`;
      id.append(aka);
    }
    const status = h("div", "lk-status", "Checking live servers…");
    status.dataset.out = "status";
    id.append(status);
    const links = h("div", "lk-links");
    for (const [text, url] of [
      ["Battlefield Tracker", `https://battlefieldtracker.com/bfv/profile/origin/${encodeURIComponent(who.name)}/overview`],
      ["gametools", `https://gametools.network/stats/pc/playerid/${who.id}?game=bfv`],
    ]) {
      const a = h("a", "btn ghost", text);
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      links.append(a);
    }
    head.append(av, id, links);
    box.append(head);

    if (!s || !s.secondsPlayed) {
      box.append(h("p", "gs-empty", s ? "No BFV stats for this player (never played, or their stats are private)." : "Couldn't load BFV stats from gametools."));
      box.append(note(history));
      return box;
    }

    const tiles = h("div", "lk-tiles");
    const hs = s.kills ? (100 * s.headShots) / s.kills : null;
    for (const [label, value] of [
      ["K/D", num(s.killDeath, 2)], ["Kills / min", num(s.killsPerMinute, 2)], ["Score / min", num(s.scorePerMinute)],
      ["Win rate", `${num(s.winPercent, 1)}%`], ["Accuracy", `${num(s.accuracy, 1)}%`], ["Headshot kills", hs == null ? "—" : `${num(hs, 1)}%`],
      ["Kills", num(s.kills)], ["Deaths", num(s.deaths)], ["Time played", hours(s.secondsPlayed)],
      ["Rounds", num(s.roundsPlayed)], ["Best streak", num(s.highestKillStreak)], ["Longest headshot", `${num(s.longestHeadShot)} m`],
      ["Revives", num(s.revives)], ["Heals", num(s.heals)], ["Repairs", num(s.repairs)], ["Best class", s.bestClass || "—"],
    ]) {
      const t = h("div", "lk-tile");
      t.append(h("span", "lk-tile-v", value), h("span", "lk-tile-l", label));
      tiles.append(t);
    }
    box.append(tiles);

    const weapons = (s.weapons || []).filter((w) => w.kills > 0).sort((a, b) => b.kills - a.kills).slice(0, 10);
    if (weapons.length) box.append(table("Top weapons", ["Weapon", "Kills", "KPM", "Accuracy", "Headshots"], weapons.map((w) => [
      [w.image, w.weaponName, w.type], num(w.kills), num(w.killsPerMinute, 2), `${num(w.accuracy, 1)}%`, `${num(w.headshots, 1)}%`,
    ])));
    const vehicles = (s.vehicles || []).filter((v) => v.kills > 0).sort((a, b) => b.kills - a.kills).slice(0, 6);
    if (vehicles.length) box.append(table("Top vehicles", ["Vehicle", "Kills", "KPM", "Destroyed", "Time"], vehicles.map((v) => [
      [v.image, v.vehicleName.replace(/\b\w/g, (c) => c.toUpperCase()), v.type], num(v.kills), num(v.killsPerMinute, 2), num(v.destroyed), hours(v.timeIn),
    ])));
    box.append(note(history));
    return box;
  }

  const note = (history) => h("p", "lk-note", history
    ? `Name history and last seen come from our Discord bot's server scans (data until ${history.dataUntil?.slice(0, 10) || "?"}). Country isn't available for BFV.`
    : "Name history and last seen aren't loaded (bot-history.js is missing). Country isn't available for BFV.");

  function table(title, cols, rows) {
    const wrap = h("div", "gs-group lk-table");
    wrap.append(h("h3", "", title));
    const t = h("table", "gs-stance");
    const tr = h("tr");
    cols.forEach((c) => tr.append(h("th", "", c)));
    const thead = h("thead");
    thead.append(tr);
    const tbody = h("tbody");
    for (const [[img, name, type], ...vals] of rows) {
      const r = h("tr");
      const first = h("td", "lk-item");
      if (img) { const i = h("img", "lk-thumb"); i.src = img; i.alt = ""; i.loading = "lazy"; i.onerror = () => i.remove(); first.append(i); }
      const txt = h("span", "lk-item-text");
      txt.append(h("span", "lk-item-name", name), h("span", "lk-item-type", type || ""));
      first.append(txt);
      r.append(first);
      vals.forEach((v) => r.append(h("td", "", v)));
      tbody.append(r);
    }
    t.append(thead, tbody);
    wrap.append(t);
    return wrap;
  }

  /** Looks for the player in every live server's player list; stops at the first match. */
  async function findOnline(who, me, known) {
    const status = () => (me === run ? els.out.querySelector('[data-out="status"]') : null);
    let found = null, checked = 0;
    try {
      const { servers } = await api("/bfv/servers/", { name: "", platform: "pc", limit: 250, region: "all" }, 30000);
      const live = servers.filter((s) => s.playerAmount > 0);
      const lower = who.name.toLowerCase();
      await mapLimit(live, 8, async (s) => {
        if (found || me !== run) return;
        try {
          const r = await api("/bfv/players/", { gameid: s.gameId }, 25000);
          const all = [...(r.teams || []).flatMap((t) => t.players || []), ...(r.que || []), ...(r.loading || [])];
          // Server lists don't always use the same id as the profile, so match any of them.
          if (all.some((p) => String(p.player_id) === who.id || String(p.user_id) === who.userId || p.name?.toLowerCase() === lower)) found = s;
        } catch {}
        checked++;
        const el = status();
        if (el && !found) el.textContent = `Checking live servers… ${checked} of ${live.length}`;
      });
      const el = status();
      if (!el) return;
      el.className = "lk-status" + (found ? " online" : "");
      const seen = known?.rec[1] ? ` Last seen on ${known.rec[2]}, ${ago(known.rec[1])}.` : "";
      el.textContent = found
        ? `Playing now: ${found.prefix} · ${found.currentMap}, ${found.mode} · ${found.serverInfo}`
        : `Not on any server right now.${seen}`;
    } catch {
      const el = status();
      if (el) el.textContent = "Couldn't check the live servers.";
    }
  }

  /** Opens the tab on a player (used by the tier list's right-click menu). */
  function show(name) {
    prefs.last = name;
    onChange?.();
    if (els) lookup(name);
  }

  return { render, show, status: () => "" };
})();
