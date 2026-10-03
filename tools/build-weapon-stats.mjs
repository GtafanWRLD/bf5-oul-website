// Builds weapon-stats.js: BFV gun stats for the Gun stats tab.
//
// The data is sym.gg's datamine (the same file their legacy charts page loads). It ships every
// specialization combo as a full 250-field record (10 MB), so this keeps the fields the page shows
// and stores each combo as a diff against the stock gun.
//
//   node tools/build-weapon-stats.mjs

import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = "https://sym.gg/legacy/pages/bfv/data/bfv_P.json";

const KEEP = [
  "Damages", "Dmg_distances", "ShotsPerShell", "RoF", "BRoF", "ShotsPerBurst",
  "InitialSpeed", "Drag", "BDrop", "MagSize", "Ammo",
  "ReloadLeft", "ReloadEmpty", "ReloadSpeed", "StripReloadTime", "SingleBulletReloadTime", "StripClipSize",
  "DeployTime", "SprintRecoverTimeMultiplier", "HorDispersion",
  "ADSStandBaseMin", "ADSCrouchBaseMin", "ADSProneBaseMin", "ADSStandMoveMin", "ADSCrouchMoveMin", "ADSProneMoveMin",
  "HIPStandBaseMin", "HIPCrouchBaseMin", "HIPProneBaseMin", "HIPStandMoveMin", "HIPCrouchMoveMin", "HIPProneMoveMin",
  "ADSStandBaseSpreadInc", "HIPStandBaseSpreadInc", "HIPStandBaseSpreadDecCoef", "ADSStandBaseSpreadIdleOffset",
  "ADSStandRecoilUp", "ADSStandRecoilInitialUp", "ADSStandRecoilLeft", "ADSStandRecoilRight", "ADSStandRecoilDecFactor",
];

const CLASSES = { 1: "Medic", 2: "Assault", 3: "Support", 4: "Recon", 8: "Sidearm" };

// Specialization labels, from sym's bfv.js.
const SPEC_NAMES = {
  QADS: "Quick Aim", ADSM: "Custom Stock", MoAD: "Lightened Stock", Bayo: "Bayonet", QRel: "Quick Reload",
  QDep: "Slings and Swivels", QCyc: "Machined Bolt", Zero: "Variable Zeroing", VRec: "Recoil Buffer",
  ITri: "Trigger Job", Hipf: "Enhanced Grips", IADS: "Barrel Bedding", DMag: "Detachable Magazines", Bipo: "Bipod",
  FBul: "High Velocity Bullets", Long: "Low Drag Rounds", ADSS: "Barrel Bedding", HRec: "Ported Barrel",
  Heav: "Heavy Load", Pene: "Penetrating Shot", ExMa: "Extended Magazine", Slug: "Slugs", Head: "Solid Slug",
  IBip: "Improved Bipod", Flas: "Flashless Propellant", IROF: "Light Bolt", Ince: "Incendiary Bullets",
  Cool: "Chrome Lining", Magd: "Polished Action", Chok: "Internal Choke", ExBe: "Extended Belt",
  Drum: "Double Drum Magazine", Gren: "Improved Grenades", APCR: "APCR Bullets", QBCy: "Light Bolt",
  BROF: "Trigger Job", GLau: "Grenade Launcher", Fire: "Fully Automatic Fire", QCyP: "Machined Bolt",
  Supp: "Suppressor", TopU: "Top Up", HiPo: "High Power Optics",
};

// sym's names → names in catalog.js (for the weapon images).
const CATALOG_NAMES = {
  "M28 Tromboncino": "M28 con Tromboncino", "Lee-Enfield No4 Mk1": "Lee-Enfield No.4 Mk I",
  "Nambu Type 2A": "Type 2A", "PPK Suppressed": "PPKS", "C96 Trench Carbine": "Trench Carbine",
  "M1922 MMG": "M1922 MG", "M97": "M1897", "Type 11 MG": "Type 11 LMG",
};

const local = process.argv[2];
const data = local
  ? JSON.parse(readFileSync(local, "utf8"))
  : await (await fetch(SOURCE, { signal: AbortSignal.timeout(120000) })).json();

globalThis.window = {};
await import(new URL("../catalog.js", import.meta.url));
const key = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ø/g, "o").toLowerCase().replace(/[^a-z0-9]/g, "");
const catalog = new Map(window.CATALOG.weapons.map((w) => [key(w.name), w]));

const pick = (rec) => Object.fromEntries(KEEP.map((k) => [k, rec[k] === "N/A" ? null : rec[k]]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const groups = new Map();
for (const rec of data) {
  if (!groups.has(rec.WeapShowName)) groups.set(rec.WeapShowName, []);
  groups.get(rec.WeapShowName).push(rec);
}

// ---------- specialization trees ----------
//
// BFV trees have four tiers. Tiers 1, 2 and 4 are free picks; tier 3 follows the side picked in
// tier 2 (left → left, right → right). sym stores every valid path (19 per gun), with the specs of
// a combo in tier order, so the tree's structure comes from sym. sym doesn't say which option is on
// the left in game, so each tier is ordered like the gun's BFV infobox on battlefield.fandom.com
// ("Rank 1 … Rank 4"); tier 3 is then ordered by its tier-2 parent so the branches line up.

const WIKI = "https://battlefield.fandom.com/api.php";
const wikiGet = async (params) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${WIKI}?${new URLSearchParams({ format: "json", ...params })}`, { headers: { "User-Agent": "bf5-tools" }, signal: AbortSignal.timeout(30000) });
      if (res.ok) return await res.json();
    } catch {}
  }
  return null;
};
/** Every BFV specialization tree on a wiki page (a page can hold several guns' infoboxes). */
async function wikiTrees(title) {
  const j = await wikiGet({ action: "parse", page: title, prop: "wikitext", redirects: "1" });
  const text = j?.parse?.wikitext?.["*"] || "";
  const trees = [];
  for (const m of text.matchAll(/\|\s*unlocks\s*=([^\n]*)/g)) {
    if (!m[1].includes("Specializations (Battlefield V)")) continue;
    trees.push(m[1].split(/Rank \d/).slice(1).map((r) => [...r.matchAll(/\[\[[^\]|]*\|([^\]]+)\]\]/g)].map((x) => x[1].trim())));
  }
  return { title: j?.parse?.title, trees };
}
// The wiki spells a few names differently.
const specKey = (s) => key(s).replace("enchanced", "enhanced").replace("slingsswivels", "slingsandswivels").replace("selectivefiretrigger", "fullyautomaticfire");
/** Wiki page names that searching doesn't find. */
const WIKI_TITLES = { STEN: "Sten", "Zk-383": "ZK-383" };

/**
 * The wiki tree that best matches this gun's specs. The gun's own pages are tried first; other
 * pages from a search (sibling guns share most of a tree) only count on a perfect match.
 */
async function findTree(name, labels) {
  const want = new Set(labels.map(specKey));
  const scoreOf = (tree) => {
    const names = tree.flat().map(specKey);
    const hit = [...want].filter((x) => names.includes(x)).length;
    const extra = names.filter((x) => !want.has(x)).length;
    return want.size ? hit / (want.size + extra) : 0;
  };
  const bestOf = async (titles) => {
    let best = null;
    for (const t of titles) {
      const { title, trees } = await wikiTrees(t);
      for (const tree of trees) {
        const score = scoreOf(tree);
        if (!best || score > best.score) best = { score, title, tree };
      }
      if (best?.score === 1) break;
    }
    return best;
  };
  const cat = CATALOG_NAMES[name];
  const own = await bestOf([...new Set([WIKI_TITLES[name], `${name}/Battlefield V`, name, cat && `${cat}/Battlefield V`, cat].filter(Boolean))]);
  if (own && own.score >= 0.6) return own;
  const open = await wikiGet({ action: "opensearch", search: name, limit: "3" });
  const search = await wikiGet({ action: "query", list: "search", srsearch: `${name} Battlefield V`, srlimit: "5" });
  const other = await bestOf([...new Set([...(open?.[1] || []), ...(search?.query?.search || []).map((r) => r.title)])]);
  return other && other.score === 1 ? other : null;
}

const mapLimit = async (items, limit, fn) => {
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => { while (i < items.length) await fn(items[i++]); }));
};

const unknownSpecs = new Set();
const weapons = [];
for (const [name, recs] of groups) {
  const stock = recs.find((r) => !r.Attachments_short);
  if (!stock) continue;
  const base = pick(stock);
  const full = { "": base };
  const variants = {};
  for (const r of recs) {
    if (!r.Attachments_short) continue;
    full[r.Attachments_short] = pick(r);
    variants[r.Attachments_short] = Object.fromEntries(KEEP.filter((k) => !same(full[r.Attachments_short][k], base[k])).map((k) => [k, full[r.Attachments_short][k]]));
    for (const code of r.Attachments_short.split("+")) if (!SPEC_NAMES[code]) unknownSpecs.add(code);
  }
  const specNames = {};
  for (const code of new Set(Object.keys(variants).flatMap((v) => v.split("+")))) specNames[code] = SPEC_NAMES[code] || code;
  // Tiers straight from sym's combos: tier i holds every spec seen at position i.
  const combos = Object.keys(variants).map((k) => k.split("+"));
  const depth = Math.max(0, ...combos.map((c) => c.length));
  const tree = Array.from({ length: depth }, (_, i) => [...new Set(combos.filter((c) => c.length > i).map((c) => c[i]))]);
  // Specs that change none of the shown stats (bayonets, bipods, zeroing…). sym sometimes stores
  // them on only some paths (the Garand's bayonet), so the page allows them anywhere.
  const cosmetic = Object.keys(specNames).filter((code) => combos
    .filter((c) => c.at(-1) === code)
    .every((c) => same(full[c.join("+")], full[c.slice(0, -1).join("+")])));
  const cat = catalog.get(key(CATALOG_NAMES[name] || name));
  weapons.push({
    name,
    cls: CLASSES[stock.Class] || "Other",
    type: cat?.type || null,
    image: cat?.image || null,
    specNames,
    /** [[code]] per tier, left to right as in game. */
    tree,
    cosmetic,
    base,
    variants,
  });
}
weapons.sort((a, b) => a.name.localeCompare(b.name));

const noWiki = [];
await mapLimit(weapons.filter((w) => w.tree.length), 4, async (w) => {
  const found = await findTree(w.name, Object.values(w.specNames));
  if (!found) return noWiki.push(w.name);
  w.treeSource = found.title;
  const rank = (tier, code) => {
    const i = (found.tree[tier] || []).map(specKey).indexOf(specKey(w.specNames[code]));
    return i < 0 ? 99 : i;
  };
  for (const tier of [0, 1, 3]) w.tree[tier]?.sort((a, b) => rank(tier, a) - rank(tier, b));
  // Tier 3 under its tier-2 parent, so left stays left.
  const parent = (code) => Object.keys(w.variants).map((k) => k.split("+")).find((c) => c[2] === code)?.[1];
  w.tree[2]?.sort((a, b) => w.tree[1].indexOf(parent(a)) - w.tree[1].indexOf(parent(b)));
});
if (noWiki.length) console.warn("No wiki tree (left/right order as in sym's data):", noWiki.join(", "));


if (unknownSpecs.size) console.warn("Specializations without a label:", [...unknownSpecs].join(", "));
const noImage = weapons.filter((w) => !w.image).map((w) => w.name);
if (noImage.length) console.warn("No image:", noImage.join(", "));

const out = { builtAt: new Date().toISOString(), source: SOURCE, weapons };
writeFileSync(
  new URL("../weapon-stats.js", import.meta.url),
  `// Generated by tools/build-weapon-stats.mjs from sym.gg's BFV datamine. Used by the Gun stats tab.\n` +
    `window.WEAPON_STATS = ${JSON.stringify(out)};\n`,
);
console.log(`weapon-stats.js: ${weapons.length} weapons, ${data.length} variants`);
