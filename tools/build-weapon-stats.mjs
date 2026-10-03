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

const unknownSpecs = new Set();
const weapons = [];
for (const [name, recs] of groups) {
  const stock = recs.find((r) => !r.Attachments_short);
  if (!stock) continue;
  const base = pick(stock);
  const variants = {};
  for (const r of recs) {
    if (!r.Attachments_short) continue;
    const full = pick(r);
    variants[r.Attachments_short] = Object.fromEntries(KEEP.filter((k) => !same(full[k], base[k])).map((k) => [k, full[k]]));
    for (const code of r.Attachments_short.split("+")) if (!SPEC_NAMES[code]) unknownSpecs.add(code);
  }
  const specNames = {};
  for (const code of new Set(Object.keys(variants).flatMap((v) => v.split("+")))) {
    specNames[code] = name === "M1 Garand" && code === "Bayo" ? "Heavy Load" : SPEC_NAMES[code] || code;
  }
  const cat = catalog.get(key(CATALOG_NAMES[name] || name));
  weapons.push({
    name,
    cls: CLASSES[stock.Class] || "Other",
    type: cat?.type || null,
    image: cat?.image || null,
    specNames,
    base,
    variants,
  });
}
weapons.sort((a, b) => a.name.localeCompare(b.name));

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
