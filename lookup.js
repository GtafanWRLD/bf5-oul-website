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
 *
 * "Compare" puts two players side by side: headline stats with the better value marked, and
 * the weapons both of them use.
 *
 * Players looked up before are kept in this browser (bfv-lookup-cache), so they open instantly;
 * fresh stats load in the background and replace them when they arrive.
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
    if (days < 1 / 1440) return "just now";
    if (days < 1 / 24) return `${Math.round(days * 1440)} min ago`;
    if (days < 1) return `${Math.round(days * 24)} h ago`;
    if (days < 60) return `${Math.round(days)} days ago`;
    return new Date(sec * 1000).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  };
  /** Bumped on every lookup so a slow older one doesn't draw over a newer one. */
  let run = 0;

  // ---------- browser cache ----------
  const CACHE_KEY = "bfv-lookup-cache";
  const CACHE_MAX = 30;
  /** names: "n:<lowercase name>" → who; players: id → { at, s (trimmed stats), games }. */
  const cache = (() => {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (c?.names && c?.players) return c;
    } catch {}
    return { names: {}, players: {} };
  })();
  const nameKey = (name) => `n:${name.toLowerCase()}`;
  function saveCache() {
    const ids = Object.keys(cache.players).sort((a, b) => cache.players[b].at - cache.players[a].at);
    for (const id of ids.slice(CACHE_MAX)) delete cache.players[id];
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
  }
  /** Only what the page shows, so 30 players fit easily in local storage. */
  const trim = (s) => ({
    ...Object.fromEntries(Object.entries(s).filter(([, v]) => v === null || typeof v !== "object")),
    weapons: (s.weapons || []).filter((w) => w.kills > 0).map(({ weaponName, type, image, kills, killsPerMinute, accuracy, headshots, timeEquipped }) =>
      ({ weaponName, type, image, kills, killsPerMinute, accuracy, headshots, timeEquipped })),
    vehicles: (s.vehicles || []).filter((v) => v.kills > 0).map(({ vehicleName, type, image, kills, killsPerMinute, destroyed, timeIn }) =>
      ({ vehicleName, type, image, kills, killsPerMinute, destroyed, timeIn })),
    platoons: (s.platoons || []).map(({ id, tag, name }) => ({ id, tag, name })),
    activePlatoon: s.activePlatoon ? { id: s.activePlatoon.id } : null,
  });
  /** Fresh stats (and owned games) from gametools, saved to the cache. Null if gametools fails. */
  async function fetchPlayer(who) {
    const [stats, games] = await Promise.all([
      api("/bfv/all/", { playerid: who.id, platform: "pc", skip_battlelog: true, format_values: false }, 30000).catch(() => null),
      api("/bfglobal/games/", { playerid: who.id, platform: "pc" }, 15000).catch(() => null),
    ]);
    if (!stats) return null;
    const entry = { at: Date.now(), s: trim(stats), games: games && Object.fromEntries(GAMES.map(([k]) => [k, Boolean(games[k])])) };
    cache.players[who.id] = entry;
    saveCache();
    return entry;
  }
  /** Name → who, from the cache when we've seen the name before. */
  async function whoIs(name, hist, force) {
    const hit = !force && cache.names[nameKey(name)];
    if (hit) return hit;
    const who = await resolveAny(name, hist);
    cache.names[nameKey(name)] = cache.names[nameKey(who.name)] = who;
    return who;
  }
  const sameStats = (a, b) => JSON.stringify(a?.s) === JSON.stringify(b?.s);
  /** The bot's history once loaded (null until then); renders use whatever is there. */
  let historyData = null;
  const ageText = (ms) => ago(ms / 1000);

  /** Shows a new profile/comparison, keeping the online status line the old one had. */
  function swap(box, animate) {
    const before = els.out.querySelector('[data-out="status"]');
    const after = box.querySelector('[data-out="status"]');
    if (before && after) { after.className = before.className; after.textContent = before.textContent; after.title = before.title; }
    if (!animate) box.classList.remove("enter");
    els.out.replaceChildren(box);
  }

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
      <div class="gs-seg lk-mode" role="group" aria-label="Mode">
        <button type="button" data-mode="one">One player</button>
        <button type="button" data-mode="two">Compare</button>
      </div>
      <form class="lk-search" role="search">
        <input class="field lk-in-a" name="q" placeholder="EA / Origin name (PC)" autocomplete="off" spellcheck="false" aria-label="Player name">
        <span class="lk-vs" hidden>vs</span>
        <input class="field lk-in-b" name="vs" placeholder="Second player" autocomplete="off" spellcheck="false" aria-label="Second player name" hidden>
        <button class="btn primary" type="submit">Look up</button>
      </form>
      <div class="lk-recent"></div>
      <div class="lk-out"></div>`;
    els = { form: root.querySelector("form"), recent: root.querySelector(".lk-recent"), out: root.querySelector(".lk-out"), mode: root.querySelector(".lk-mode") };
    els.mode.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-mode]");
      if (b) setMode(b.dataset.mode, true);
    });
    els.form.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = els.form.q.value.trim();
      const vs = els.form.vs.value.trim();
      if (prefs.mode === "two" && q && vs) compare(q, vs);
      else if (prefs.mode === "two") (q ? els.form.vs : els.form.q).focus();
      else if (q) lookup(q);
    });
    setMode(prefs.mode || "one");
    if (prefs.last) lookup(prefs.last, false);
  }

  function setMode(mode, focus = false) {
    prefs.mode = mode;
    onChange?.();
    const two = mode === "two";
    for (const b of els.mode.children) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    els.form.classList.toggle("two", two);
    els.form.vs.hidden = !two;
    els.form.querySelector(".lk-vs").hidden = !two;
    els.form.q.placeholder = two ? "First player" : "EA / Origin name (PC)";
    els.form.querySelector('[type="submit"]').textContent = two ? "Compare" : "Look up";
    if (focus) (two && els.form.q.value ? els.form.vs : els.form.q).focus();
  }

  function drawRecent() {
    els.recent.innerHTML = "";
    for (const name of prefs.recent) {
      const b = h("button", "lk-chip", name);
      b.type = "button";
      b.addEventListener("click", () => { setMode("one"); lookup(name); });
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

  /** resolve(), falling back to the bot's history: an old name finds the player's current one. */
  async function resolveAny(name, hist) {
    try { return await resolve(name); } catch (err) {
      const now = historyOf(await hist, [], name)?.rec[0].at(-1)[0];
      if (now && now.toLowerCase() !== name.toLowerCase()) {
        try { return await resolve(now); } catch {}
      }
      throw err;
    }
  }

  const message = (text) => { els.out.innerHTML = ""; els.out.append(h("p", "gs-empty", text)); };

  async function lookup(name, remember = true, force = false) {
    const me = ++run;
    els.form.q.value = name;
    const hist = loadHistory();
    let who;
    try {
      if (!cache.names[nameKey(name)] || force) message(`Looking up ${name}…`);
      who = await whoIs(name, hist, force);
    } catch (err) {
      if (me === run) message(`No PC player named "${name}" (${err.message}).`);
      return;
    }
    if (me !== run) return;
    if (remember) {
      prefs.last = who.name;
      prefs.recent = [who.name, ...prefs.recent.filter((n) => n.toLowerCase() !== who.name.toLowerCase())].slice(0, 8);
      onChange?.();
      drawRecent();
    }
    let entry = force ? null : cache.players[who.id];
    let updating = true;
    const draw = (animate) => {
      if (me !== run) return;
      const known = historyOf(historyData, [who.id, who.userId], who.name);
      swap(profile(who, entry, known, historyData, updating), animate);
    };
    if (entry) draw(true);
    else message(`Loading ${who.name}…`);
    const fresh = fetchPlayer(who);
    currentKnown = historyOf(historyData, [who.id, who.userId], who.name);
    findOnline(who, me);
    if (!historyData) hist.then((data) => {
      if (me !== run || !data) return;
      historyData = data;
      currentKnown = historyOf(data, [who.id, who.userId], who.name);
      if (entry) draw(false);
      // The online check may have finished first: add "Last seen" to it.
      const el = els.out.querySelector('[data-out="status"]');
      if (el && el.textContent === NOT_ONLINE) el.textContent += lastSeen();
    });
    const got = await fresh;
    if (me !== run) return;
    updating = false;
    const shown = Boolean(els.out.querySelector(".lk-profile"));
    const changed = !entry || !sameStats(entry, got);
    if (got) entry = got;
    if (!entry) { message(`Couldn't load ${who.name}'s stats from gametools. Try again in a moment.`); return; }
    // Same numbers as the saved copy: just update the "Updated…" line, so the tables keep their scroll.
    if (shown && !changed) els.out.querySelector(".lk-fresh")?.replaceWith(freshness(entry.at, false, () => lookup(who.name, false, true)));
    else draw(!shown);
  }

  async function compare(a, b, force = false) {
    const me = ++run;
    els.form.q.value = a;
    els.form.vs.value = b;
    const hist = loadHistory();
    const people = await Promise.all([a, b].map((name) => whoIs(name, hist, force).catch(() => name)));
    if (me !== run) return;
    const missing = people.filter((p) => typeof p === "string");
    if (missing.length) { message(`No PC player named ${missing.map((n) => `"${n}"`).join(" or ")}.`); return; }
    let entries = people.map((p) => (force ? null : cache.players[p.id]));
    let updating = true;
    const draw = (animate) => {
      if (me !== run) return;
      const gone = people.filter((p, i) => !entries[i]?.s.secondsPlayed).map((p) => p.name);
      if (gone.length) { if (!updating) message(`No BFV stats for ${gone.join(" or ")} (never played, or their stats are private).`); return; }
      swap(comparison(people, entries, updating, () => compare(a, b, true)), animate);
    };
    if (entries.every(Boolean)) draw(true);
    else message(`Comparing ${people[0].name} and ${people[1].name}…`);
    const fresh = await Promise.all(people.map(fetchPlayer));
    if (me !== run) return;
    updating = false;
    const shown = Boolean(els.out.querySelector(".lk-compare"));
    const changed = entries.some((e, i) => !e || !sameStats(e, fresh[i]));
    entries = entries.map((e, i) => fresh[i] || e);
    if (shown && !changed) els.out.querySelector(".lk-fresh")?.replaceWith(freshness(Math.min(...entries.map((e) => e.at)), false, () => compare(a, b, true)));
    else draw(!shown);
  }

  /** "Saved 5 min ago · updating…" plus a Refresh button. */
  function freshness(at, updating, refresh) {
    const row = h("div", "lk-fresh");
    row.append(h("span", "", updating ? (at ? `Saved data from ${ageText(at)} · updating…` : "Loading…") : `Updated ${ageText(at)}`));
    const b = h("button", "lk-refresh", "Refresh");
    b.type = "button";
    b.disabled = updating;
    b.addEventListener("click", refresh);
    row.append(b);
    return row;
  }

  /** [label, value, format, which is better: 1 higher, -1 lower, 0 neither]. */
  const COMPARE_ROWS = [
    ["Rank", (s) => s.rank, (v) => num(v), 1],
    ["K/D", (s) => s.killDeath, (v) => num(v, 2), 1],
    ["Kills / min", (s) => s.killsPerMinute, (v) => num(v, 2), 1],
    ["Score / min", (s) => s.scorePerMinute, (v) => num(v, 2), 1],
    ["Win rate", (s) => s.winPercent, (v) => `${num(v, 1)}%`, 1],
    ["Accuracy", (s) => s.accuracy, (v) => `${num(v, 1)}%`, 1],
    ["Headshot kills", (s) => (s.kills ? (100 * s.headShots) / s.kills : null), (v) => `${num(v, 1)}%`, 1],
    ["Kills", (s) => s.kills, (v) => num(v), 1],
    ["Deaths", (s) => s.deaths, (v) => num(v), 0],
    ["Best streak", (s) => s.highestKillStreak, (v) => num(v), 1],
    ["Longest headshot", (s) => s.longestHeadShot, (v) => `${num(v)} m`, 1],
    ["Revives", (s) => s.revives, (v) => num(v), 1],
    ["Heals", (s) => s.heals, (v) => num(v), 1],
    ["Repairs", (s) => s.repairs, (v) => num(v), 1],
    ["Kill assists", (s) => s.killAssists, (v) => num(v), 1],
    ["Time played", (s) => s.secondsPlayed, hours, 0],
    ["Rounds", (s) => s.roundsPlayed, (v) => num(v), 0],
    ["Best class", (s) => s.bestClass, (v) => v || "—", 0],
  ];

  function comparison(people, entries, updating, refresh) {
    const stats = entries.map((e) => e.s);
    const box = h("div", "lk-profile enter");
    const top = h("div", "lk-compare-top");
    top.append(freshness(Math.min(...entries.map((e) => e.at)), updating, refresh));
    box.append(top);
    const card = h("div", "lk-card lk-compare");
    const t = h("table", "");
    const head = h("tr");
    head.append(h("th", "", ""));
    people.forEach((p, i) => {
      const th = h("th", `lk-vs-player p${i}`);
      const b = h("button", "lk-vs-name");
      b.type = "button";
      b.title = `Open ${p.name}'s profile`;
      const av = h("img", "lk-vs-avatar");
      av.src = stats[i].avatar || p.avatar || "";
      av.alt = "";
      av.onerror = () => av.remove();
      b.append(av, h("span", "", p.name));
      b.addEventListener("click", () => { setMode("one"); lookup(p.name); });
      th.append(b);
      head.append(th);
    });
    const thead = h("thead");
    thead.append(head);
    const tbody = h("tbody");
    for (const [label, get, fmt, better] of COMPARE_ROWS) {
      const vals = stats.map(get);
      const r = h("tr");
      r.append(h("th", "", label));
      const best = better && vals.every((v) => typeof v === "number") && vals[0] !== vals[1]
        ? (better > 0 ? Math.max(...vals) : Math.min(...vals)) : null;
      vals.forEach((v, i) => r.append(h("td", `p${i}${v === best ? " win" : ""}`, fmt(v))));
      tbody.append(r);
    }
    t.append(thead, tbody);
    card.append(t);
    box.append(card);

    // Weapons both have kills with, most kills combined first. Each cell stacks both players'
    // values in their colour; ▲ marks the better one.
    const byName = stats.map((s) => new Map((s.weapons || []).filter((w) => w.kills > 0).map((w) => [w.weaponName, w])));
    const shared = [...byName[0].keys()].filter((n) => byName[1].has(n))
      .map((n) => [byName[0].get(n), byName[1].get(n)])
      .sort((x, y) => y[0].kills + y[1].kills - (x[0].kills + x[1].kills));
    if (shared.length) {
      const wcard = h("div", "lk-card lk-table lk-shared");
      const wh = h("div", "lk-table-head");
      wh.append(h("h3", "", "Weapons you both use"), h("span", "lk-count", String(shared.length)));
      const legend = h("span", "lk-legend");
      people.forEach((p, i) => legend.append(h("span", `p${i}`, p.name)));
      wh.append(legend);
      wcard.append(wh);
      const cols = [
        ["Kills", (w) => w.kills, (v) => num(v), 0],
        ["KPM", (w) => w.killsPerMinute, (v) => num(v, 2), 1],
        ["Accuracy", (w) => w.accuracy, (v) => `${num(v, 1)}%`, 1],
        ["Headshots", (w) => w.headshots, (v) => `${num(v, 1)}%`, 1],
        ["Time", (w) => w.timeEquipped, hours, 0],
      ];
      const wt = h("table", "");
      const tr = h("tr");
      tr.append(h("th", "", "Weapon"));
      for (const [label] of cols) tr.append(h("th", "", label));
      const wthead = h("thead");
      wthead.append(tr);
      const wbody = h("tbody");
      for (const pair of shared) {
        const r = h("tr");
        const first = h("td");
        const cell = h("div", "lk-item");
        if (pair[0].image) { const i = h("img", "lk-thumb"); i.src = pair[0].image; i.alt = ""; i.loading = "lazy"; i.onerror = () => i.remove(); cell.append(i); }
        const txt = h("span", "lk-item-text");
        txt.append(h("span", "lk-item-name", pair[0].weaponName), h("span", "lk-item-type", pair[0].type || ""));
        cell.append(txt);
        first.append(cell);
        r.append(first);
        for (const [, get, fmt, better] of cols) {
          const vals = pair.map(get);
          const best = better && vals[0] !== vals[1] ? Math.max(...vals) : null;
          const td = h("td", "lk-pair");
          vals.forEach((v, i) => td.append(h("span", `p${i}${v === best ? " best" : ""}`, fmt(v))));
          r.append(td);
        }
        wbody.append(r);
      }
      wt.append(wthead, wbody);
      const scroll = h("div", "lk-scroll");
      scroll.style.maxHeight = `${40 + 9 * 60}px`;
      scroll.append(wt);
      wcard.append(scroll);
      box.append(wcard);
    }
    box.append(h("p", "lk-note", "Green marks the better value in the stats; ▲ the better one per weapon. Click a name to open that player's full profile."));
    return box;
  }

  function profile(who, entry, known, history, updating) {
    const { s, games } = entry;
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
      aka.append(h("span", "lk-aka-l", "Also known as "), document.createTextNode(others.map((n) => n[0]).join(", ")));
      aka.title = `Older names our Discord bot has seen this player use (data until ${history.dataUntil?.slice(0, 10) || "?"})`;
      id.append(aka);
    }
    const status = h("div", "lk-status", "Checking who's online…");
    status.dataset.out = "status";
    id.append(status);
    const links = h("div", "lk-links");
    for (const [text, url] of [
      ["Battlefield Tracker", `https://battlefieldtracker.com/bfv/profile/origin/${encodeURIComponent(who.name)}/overview`],
      ["gametools", `https://gametools.network/stats/pc/playerid/${encodeURIComponent(who.id)}?game=bfv`],
    ]) {
      const a = h("a", "btn ghost", text);
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      links.append(a);
    }
    links.append(freshness(entry.at, updating, () => lookup(who.name, false, true)));
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
      ["Win rate", `${num(s.winPercent, 1)}%`], ["Score / min", num(s.scorePerMinute, 2)],
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

  /** The bot's record for the player on screen, once the history has loaded. */
  let currentKnown = null;
  const NOT_ONLINE = "Not on any server right now.";
  const lastSeen = () => (currentKnown?.rec[1] ? ` Last seen on ${currentKnown.rec[2]}, ${ago(currentKnown.rec[1])}.` : "");

  /** Online status: from the bot's last scan when it's recent, else by checking every live server. */
  async function findOnline(who, me) {
    const status = () => (me === run ? els.out.querySelector('[data-out="status"]') : null);
    const known = currentKnown;
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
        : NOT_ONLINE + lastSeen();
      el.title = `From our Discord bot's scan ${ago(live.at)}`;
      return;
    }
    return scanOnline(who, me, status);
  }

  /** Looks for the player in every live server's player list; stops at the first match. */
  async function scanOnline(who, me, status) {
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
        : NOT_ONLINE + lastSeen();
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
