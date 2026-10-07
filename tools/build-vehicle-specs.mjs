// Builds vehicle-specs.js: BFV vehicle loadouts and specialization trees for the Vehicle upgrades tab.
//
// Sources:
// - Battlefield wiki "Vehicle Specializations" page: every vehicle's upgrades and their tiers.
// - Each vehicle's wiki article: its BFV infobox (role, crew, weapons per seat, ammo, payload and
//   equipment options).
// - Gamepressure's BF5 vehicle guide: the same upgrades for the launch vehicles, often with the
//   numbers the wiki leaves out ("reduces explosive damage by 15%"); used where the wiki has none.
// No public source has vehicle performance numbers (health, speed, turn rate, shell damage), so
// none are shown. The wiki lists only 4 tiers for the European vehicles (the Pacific ones have 6);
// those get a note that the in-game tree may have more.
//
//   node tools/build-vehicle-specs.mjs

import { writeFileSync } from "node:fs";

const WIKI = "https://battlefield.fandom.com/api.php";
const PAGE = "Specializations (Battlefield V)/Vehicles";
const GAMEPRESSURE = ["tanks/zfbb8c", "aircrafts/z0bb8d", "allies-tanks-in-battlefield-5/zdbb8a", "allies-aircrafts-in-battlefield-5/zebb8b"]
  .map((p) => `https://www.gamepressure.com/battlefield-5/${p}`);

const get = async (url, as = "json") => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (bf5-tools)" }, signal: AbortSignal.timeout(60000) });
      if (res.ok) return as === "json" ? await res.json() : await res.text();
    } catch {}
  }
  return null;
};
const wikitext = async (page) =>
  (await get(`${WIKI}?${new URLSearchParams({ action: "parse", page, prop: "wikitext", format: "json", redirects: "1" })}`))?.parse?.wikitext?.["*"] || "";

globalThis.window = {};
await import(new URL("../catalog.js", import.meta.url));
const key = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const catalog = new Map(window.CATALOG.vehicles.map((v) => [key(v.name), v]));
/** Wiki name → catalog (gametools) name where they differ. */
const CATALOG_NAMES = { "StuG IV": "Sturmgeschutz iv" };

const link = (s) => s.replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, "").replace(/\[\[[^\]|]*\|([^\]]+)\]\]/g, "$1").replace(/\[\[([^\]]+)\]\]/g, "$1");
const clean = (s) => link(s)
  .replace(/<small>\s*\(?([^<)]*)\)?\s*<\/small>/gi, " ($1)")
  .replace(/\{\{[^}]*\}\}/g, "").replace(/''+/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
  .replace(/^[·•*]\s*/, "");
/** An infobox value as a list: split on <br> and on "*" bullets. */
const list = (s) => (s || "").split(/<br\s*\/?>|\n\s*\*|^\s*\*/i).map(clean).filter(Boolean);

// ---------- upgrade trees (wiki) ----------

const specsText = await wikitext(PAGE);
const vehicles = [];
let faction = "";
for (const section of specsText.split(/\n(?====[^=])|\n(?=\|-\|)/)) {
  const tab = section.match(/^\|-\|\s*(.+?)\s*=/);
  if (tab) { faction = tab[1]; continue; }
  const head = section.match(/^===\s*(.+?)\s*===/);
  if (!head) continue;
  const name = link(head[1]).trim();
  // The heading links to the vehicle's article ("[[M4 Sherman#Battlefield V|Sherman]]").
  const article = (head[1].match(/\[\[([^\]|#]+)/) || [])[1]?.trim() || name;
  const specs = [];
  for (const row of section.split(/\n\|-\n/).slice(2)) {
    const cells = row.split("\n").filter((l) => l.startsWith("|") && !l.startsWith("|}")).map((l) => l.slice(1).trim());
    if (cells.length < 4) continue;
    const tier = parseInt(clean(cells[3]), 10);
    if (tier) specs.push({ name: clean(cells[0]), desc: clean(cells[2]), tier });
  }
  if (!specs.length) continue;
  const depth = Math.max(...specs.map((s) => s.tier));
  // [[{ name, desc }]] per tier, in the wiki's order.
  const tree = Array.from({ length: depth }, (_, i) => specs.filter((s) => s.tier === i + 1).map(({ name, desc }) => ({ name, desc })));
  const cat = catalog.get(key(CATALOG_NAMES[name] || name));
  vehicles.push({ name, article, faction, type: cat?.type || null, image: cat?.image || null, tree, partial: depth < 6 });
}

/**
 * Summer 2020 planes the upgrades page never got. Their trees are in their article's infobox
 * ("Rank 1 … Rank 6"); checked against in-game screenshots. Catalog name → [article, infobox name, in-game name].
 */
const ARTICLE_TREES = {
  "P51d Fighter": ["P-51", "P51D", "P51D Fighter"],
  "P51k Fighter": ["P-51", "P51K", "P51K Fighter"],
  "A-20 Bomber": ["A-20", "A-20 Bomber"],
  "P-70 Night Fighter": ["A-20", "P-70 Night Fighter"],
};

// Tanks and planes the wiki's upgrade page doesn't list. The C-47 is a transport with no upgrades.
const listed = new Set(vehicles.map((v) => key(CATALOG_NAMES[v.name] || v.name)));
for (const v of window.CATALOG.vehicles) {
  if (!["Tanks", "Planes"].includes(v.type) || listed.has(key(v.name)) || key(v.name) === "c47") continue;
  const name = v.name.replace(/\b([a-z])/g, (c) => c.toUpperCase());
  const [article, infobox, shown] = Object.entries(ARTICLE_TREES).find(([n]) => key(n) === key(v.name))?.[1] || [];
  vehicles.push({ name: shown || name, article, infobox, faction: article ? "USA" : null, type: v.type, image: v.image, tree: [], partial: false });
}

// ---------- loadouts (wiki infoboxes) ----------

/** The Infobox/vehicle blocks in an article's Battlefield V section. */
function bfvInfoboxes(text) {
  // Multi-game articles have a Battlefield V section; BF5-only ones (P-51, A-20) are the whole page.
  const start = text.search(/^==\s*Battlefield V\s*==\s*$/m);
  const rest = start < 0 ? text : text.slice(start + 5);
  const end = start < 0 ? -1 : rest.search(/^==[^=].*==\s*$/m);
  const section = end < 0 ? rest : rest.slice(0, end);
  // Infoboxes nest templates and don't always close on their own line, so match the braces.
  const bodies = [];
  // Older articles use {{Infobox/vehicle}}, the 2020 ones (P-51, A-20) {{Vehiclebox}}.
  for (const m of section.matchAll(/\{\{\s*(?:Infobox\/vehicle|Vehiclebox)/gi)) {
    let depth = 0, i = m.index;
    for (; i < section.length - 1; i++) {
      if (section.startsWith("{{", i)) { depth++; i++; } else if (section.startsWith("}}", i)) { depth--; i++; if (!depth) break; }
    }
    bodies.push(section.slice(m.index + m[0].length, i - 1));
  }
  return bodies.map((body) => {
    const f = {};
    for (const line of body.split(/\n\s*\|/)) {
      const eq = line.indexOf("=");
      if (eq > 0) f[line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim();
    }
    return f;
  });
}
function loadout(f) {
  const seats = [];
  for (let i = 1; i <= 9; i++) {
    if (f[`weapon${i}`]) seats.push({ weapons: list(f[`weapon${i}`]), ammo: list(f[`ammo${i}`]) });
  }
  return {
    role: clean(f.type || ""),
    crew: list(f.crew),
    seats,
    payload: list(f.weaponalt),
    payloadAmmo: list(f.ammoalt),
    equipment: [f.equip1, f.equip2, f.equip3].filter(Boolean).map(list),
  };
}

/** Upgrade descriptions by name, from every tree on the upgrades page, for trees that only list names. */
const descs = new Map(vehicles.flatMap((v) => v.tree.flat()).map((s) => [key(s.name), s.desc]));
// Descriptions read off the in-game specialization screen.
descs.set(key("6x HMG"), "6x heavy machine guns with an intermediate rate of fire and high projectile velocity, good for medium range fighting.");
descs.set(key("6x HMGs"), descs.get(key("6x HMG")));
descs.set(key("2x 20mm Cannons"), "2x 20mm long range cannons with high impact damage.");
descs.set(key("4x 20mm Cannons"), "4x 20mm long range cannons with high impact damage.");

const articles = new Map();
for (const v of vehicles) {
  // Vehicles without an upgrade entry: try an article under their own name.
  const page = v.article || v.name;
  if (!articles.has(page)) articles.set(page, bfvInfoboxes(await wikitext(page)));
  const boxes = articles.get(page);
  const box = boxes.find((b) => key(clean(b.name || "")) === key(v.infobox || v.name)) || (v.article && boxes.length === 1 ? boxes[0] : null);
  v.loadout = box ? loadout(box) : null;
  // A tree from the infobox's "Rank 1 … Rank 6" list, when the upgrades page had none.
  if (!v.tree.length && box?.upgrades) {
    v.tree = box.upgrades.split(/Rank \d/i).slice(1)
      .map((rank) => clean(rank.replace(/<\/?small>/gi, "")).split(/\s*·\s*/).filter(Boolean).map((name) => ({ name, desc: descs.get(key(name)) || "" })))
      .filter((rank) => rank.length);
    v.partial = v.tree.length < 6;
  }
  delete v.article;
  delete v.infobox;
}
// The P-70's infobox says 8x M8 rockets by default; the game shows 6x (in-game screenshot).
const p70 = vehicles.find((v) => v.name === "P-70 Night Fighter")?.loadout;
if (p70) p70.equipment = p70.equipment.map((slot) => slot.map((s) => (s === "8x M8 Rockets" ? "6x M8 Rockets" : s)));

// ---------- upgrade numbers (Gamepressure) ----------

/** Vehicle → { specKey: description } from Gamepressure's tables. */
const gp = new Map();
for (const url of GAMEPRESSURE) {
  const html = (await get(url, "text")) || "";
  const lines = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<(br|\/p|\/li|\/h\d|\/tr|\/td|\/th|\/div)[^>]*>/g, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'")
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (!/^Available specializations$/i.test(lines[i])) continue;
    // The vehicle name is the short heading above its intro paragraph and "unlocked at" line.
    let j = i - 1;
    while (j > 0 && (lines[j].length > 40 || /unlocked|available/i.test(lines[j]))) j--;
    let k = i + 1;
    while (k < lines.length && !/^Description$/i.test(lines[k])) k++;
    const specs = {};
    for (k++; k + 2 < lines.length && /^\d$/.test(lines[k + 1]); k += 3) specs[key(lines[k])] = lines[k + 2];
    gp.set(key(lines[j]), specs);
  }
}
let improved = 0;
for (const v of vehicles) {
  const specs = gp.get(key(v.name));
  if (!specs) continue;
  for (const s of v.tree.flat()) {
    const alt = specs[key(s.name)];
    // Prefer the description that carries a number.
    if (alt && /\d/.test(alt) && !/\d/.test(s.desc)) { s.desc = alt.replace(/\s*\.?$/, "."); improved++; }
  }
}

vehicles.sort((a, b) => a.name.localeCompare(b.name));
const noImage = vehicles.filter((v) => !v.image).map((v) => v.name);
if (noImage.length) console.warn("No image:", noImage.join(", "));
const noLoadout = vehicles.filter((v) => !v.loadout).map((v) => v.name);
if (noLoadout.length) console.warn("No loadout:", noLoadout.join(", "));
writeFileSync(
  new URL("../vehicle-specs.js", import.meta.url),
  `// Generated by tools/build-vehicle-specs.mjs from the Battlefield wiki and Gamepressure. Used by the Vehicle upgrades tab.\n` +
    `window.VEHICLE_SPECS = ${JSON.stringify({ builtAt: new Date().toISOString(), source: `https://battlefield.fandom.com/wiki/${PAGE.replace(/ /g, "_")}`, vehicles })};\n`,
);
const withTree = vehicles.filter((v) => v.tree.length);
console.log(`vehicle-specs.js: ${withTree.length} vehicles with trees (${withTree.filter((v) => v.partial).length} with 4 tiers on the wiki), ` +
  `${vehicles.filter((v) => v.loadout).length} with loadouts, ${improved} upgrade descriptions given numbers from Gamepressure`);
