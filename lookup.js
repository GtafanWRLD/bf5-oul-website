"use strict";

/**
 * The Player lookup tab: one BFV PC player's profile from gametools.network (stats, top weapons
 * and vehicles, platoons, other BF games) and whether they're on a server right now, found by
 * checking every live server's player list. Uses index.html's global api() and mapLimit().
 *
 * Name history, "last seen" and who's online come from our Discord bot, which reads every live
 * server every couple of minutes. With GIST set, the bot's src/publish.ts keeps them in a GitHub
 * gist (online.json after every scan, history.json every 15 min); otherwise bot-history.js, a
 * snapshot made by tools/build-bot-history.mjs, is used and online status comes from our own scan.
 * Country isn't available for BFV from any source.
 */
window.PlayerLookup = (() => {
  /** The bot's gist (owner = the GitHub account its token belongs to). Empty id = not set up yet. */
  const GIST = { owner: "GtafanWRLD", id: "d610bba8e0ddb76e57fc36b7c97dc1f5" };
  /** Raw gist files are cached for up to 5 minutes; a per-minute query skips older copies. */
  const gistFile = async (name) => {
    if (!GIST.id) return null;
    const res = await fetch(`https://gist.githubusercontent.com/${GIST.owner}/${GIST.id}/raw/${name}?t=${Math.floor(Date.now() / 60000)}`);
    return res.ok ? res.json() : null;
  };
  /** Bot online data older than this is ignored (the bot is probably off) and we scan ourselves. */
  const LIVE_MAX_AGE = 15 * 60;
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
    gistFile("history.json").catch(() => null).then((live) => (live ? done(live) : snapshot(done)));
  }));
  const snapshot = (done) => {
    const tag = document.createElement("script");
    tag.src = "bot-history.js";
    tag.onload = () => done(window.BOT_HISTORY || null);
    tag.onerror = () => done(null);
    document.head.append(tag);
  };
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

    const hs = s.kills ? (100 * s.headShots) / s.kills : null;
    const side = h("aside", "lk-side lk-card");
    const hero = h("div", "lk-hero");
    for (const [label, value] of [
      ["K/D", num(s.killDeath, 2)], ["Kills / min", num(s.killsPerMinute, 2)],
      ["Win rate", `${num(s.winPercent, 1)}%`], ["Score / min", num(s.scorePerMinute)],
    ]) {
      const t = h("div", "lk-hero-stat");
      t.append(h("span", "lk-hero-l", label), h("span", "lk-hero-v", value));
      hero.append(t);
    }
    side.append(hero);
    for (const [title, rows] of [
      ["Combat", [["Kills", num(s.kills)], ["Deaths", num(s.deaths)], ["Accuracy", `${num(s.accuracy, 1)}%`],
        ["Headshot kills", hs == null ? "—" : `${num(hs, 1)}%`], ["Best streak", num(s.highestKillStreak)], ["Longest headshot", `${num(s.longestHeadShot)} m`]]],
      ["Teamwork", [["Revives", num(s.revives)], ["Heals", num(s.heals)], ["Repairs", num(s.repairs)], ["Kill assists", num(s.killAssists)]]],
      ["Games", [["Time played", hours(s.secondsPlayed)], ["Rounds", num(s.roundsPlayed)], ["Wins", num(s.wins)], ["Losses", num(s.loses)], ["Best class", s.bestClass || "—"]]],
    ]) {
      side.append(h("h3", "lk-group-title", title));
      const dl = h("dl", "lk-list");
      for (const [dt, dd] of rows) dl.append(h("dt", "", dt), h("dd", "", dd));
      side.append(dl);
    }

    const main = h("div", "lk-main");
    const weapons = (s.weapons || []).filter((w) => w.kills > 0).map((w) => ({ ...w, name: w.weaponName }));
    if (weapons.length) main.append(table("weapons", "Weapons", "Weapon", weapons, [
      ["kills", "Kills", (w) => w.kills, (v) => num(v)],
      ["kpm", "KPM", (w) => w.killsPerMinute, (v) => num(v, 2)],
      ["acc", "Accuracy", (w) => w.accuracy, (v) => `${num(v, 1)}%`],
      ["hs", "Headshots", (w) => w.headshots, (v) => `${num(v, 1)}%`],
      ["time", "Time", (w) => w.timeEquipped, hours],
    ], 10));
    const vehicles = (s.vehicles || []).filter((v) => v.kills > 0).map((v) => ({ ...v, name: v.vehicleName.replace(/\b\w/g, (c) => c.toUpperCase()) }));
    if (vehicles.length) main.append(table("vehicles", "Vehicles", "Vehicle", vehicles, [
      ["kills", "Kills", (v) => v.kills, (x) => num(x)],
      ["kpm", "KPM", (v) => v.killsPerMinute, (x) => num(x, 2)],
      ["destroyed", "Destroyed", (v) => v.destroyed, (x) => num(x)],
      ["time", "Time", (v) => v.timeIn, hours],
    ], 6));

    const body = h("div", "lk-body");
    body.append(side, main);
    box.append(body, note(history));
    return box;
  }

  const note = (history) => h("p", "lk-note", history
    ? `Name history and last seen come from our Discord bot's server scans (data until ${history.dataUntil?.slice(0, 10) || "?"}). Country isn't available for BFV.`
    : "Name history and last seen aren't loaded (bot-history.js is missing). Country isn't available for BFV.");

  /**
   * A sortable list of weapons or vehicles. Click a column to sort by it (again to flip the order);
   * the sort is remembered per table. Every row is listed in a box about `rows` rows tall that
   * scrolls on its own, with the column headers pinned.
   */
  function table(key, title, itemLabel, items, cols, rows) {
    const wrap = h("div", "lk-card lk-table");
    const draw = () => {
      const sort = prefs.sort?.[key] || { col: "kills", desc: true };
      const col = cols.find((c) => c[0] === sort.col) || cols[0];
      const sorted = [...items].sort((a, b) => ((col[2](a) ?? -1) - (col[2](b) ?? -1)) * (sort.desc ? -1 : 1));
      wrap.innerHTML = "";
      const head = h("div", "lk-table-head");
      head.append(h("h3", "", title), h("span", "lk-count", String(items.length)));
      wrap.append(head);
      const t = h("table", "");
      const tr = h("tr");
      tr.append(h("th", "", itemLabel));
      for (const [id, label] of cols) {
        const th = h("th", "");
        const b = h("button", "lk-sort" + (id === col[0] ? " on" : ""), label + (id === col[0] ? (sort.desc ? " ↓" : " ↑") : ""));
        b.type = "button";
        b.setAttribute("aria-label", `Sort by ${label}`);
        b.addEventListener("click", () => {
          prefs.sort = { ...prefs.sort, [key]: { col: id, desc: id === col[0] ? !sort.desc : true } };
          onChange?.();
          draw();
        });
        th.append(b);
        tr.append(th);
      }
      const thead = h("thead");
      thead.append(tr);
      const tbody = h("tbody");
      for (const item of sorted) {
        const r = h("tr");
        const first = h("td");
        const cell = h("div", "lk-item");
        if (item.image) { const i = h("img", "lk-thumb"); i.src = item.image; i.alt = ""; i.loading = "lazy"; i.onerror = () => i.remove(); cell.append(i); }
        const txt = h("span", "lk-item-text");
        txt.append(h("span", "lk-item-name", item.name), h("span", "lk-item-type", item.type || ""));
        cell.append(txt);
        first.append(cell);
        r.append(first);
        for (const [id, , get, fmt] of cols) r.append(h("td", id === col[0] ? "on" : "", fmt(get(item))));
        tbody.append(r);
      }
      t.append(thead, tbody);
      const scroll = h("div", "lk-scroll");
      // Header row plus `rows` rows of ~53px.
      scroll.style.maxHeight = `${36 + rows * 53}px`;
      scroll.append(t);
      wrap.append(scroll);
    };
    draw();
    return wrap;
  }

  /** Online status: from the bot's last scan when it's recent, else by checking every live server. */
  async function findOnline(who, me, known) {
    const status = () => (me === run ? els.out.querySelector('[data-out="status"]') : null);
    const seen = known?.rec[1] ? ` Last seen on ${known.rec[2]}, ${ago(known.rec[1])}.` : "";
    const live = await gistFile("online.json").catch(() => null);
    if (live && Date.now() / 1000 - live.at < LIVE_MAX_AGE) {
      const lower = who.name.toLowerCase();
      const hit = live.online[who.id] || live.online[who.userId] || (known && live.online[known.id])
        || Object.values(live.online).find((o) => o[0].toLowerCase() === lower);
      const el = status();
      if (!el) return;
      el.className = "lk-status" + (hit ? " online" : "");
      el.textContent = hit
        ? `Playing now: ${hit[1]} · ${hit[3]}, ${hit[4]} · ${hit[5]}`
        : `Not on any server right now.${seen}`;
      el.title = `From our Discord bot's scan ${ago(live.at)}`;
      return;
    }
    return scanOnline(who, me, seen, status);
  }

  /** Looks for the player in every live server's player list; stops at the first match. */
  async function scanOnline(who, me, seen, status) {
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
