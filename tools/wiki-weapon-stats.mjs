// Parses the Battlefield wiki's BFV weapon infobox stats (rof, magazine, velocity, reload, damage).
//
// Fields list alternatives separated by " / "; an upgrade's value carries its name in brackets
// ("464 RPM (Light Bolt)"). Other bracketed notes ("(5-round clip)", "(High RoF)", "(SP)") aren't
// upgrades, so the base value is the first one without an upgrade label.
//
//   node tools/wiki-weapon-stats.mjs   runs the self-check

import { pathToFileURL } from "node:url";

const num = (s) => {
  const m = String(s).replace(/,/g, "").match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/s$/, "");

/** Which of the gun's spec names a bracket label refers to, if any. */
const specOf = (label, specNames) => specNames.find((n) => norm(n) === norm(label)) || null;

/**
 * "540 RPM / 638 RPM (Light Bolt)" → { base: { text, value }, specs: { "Light Bolt": { text, value } } }.
 * Stops at a "Burst" heading (the Breda lists its in-burst rate after its overall rate).
 */
export function parseAlternatives(field, specNames) {
  if (!field) return null;
  const out = { base: null, specs: {} };
  for (const raw of field.split(/\s+\/\s+/)) {
    const item = raw.trim();
    if (/^burst$/i.test(item)) break;
    const value = num(item);
    if (value == null) continue;
    const labels = [...item.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]);
    const spec = labels.map((l) => specOf(l, specNames)).find(Boolean);
    // The number as the wiki writes it ("15+1 rounds" → "15+1"), without units or notes.
    const text = item.replace(/\([^)]*\)/g, "").replace(/\s*(rounds?|shells?|rpm|m\/s|s)\s*$/i, "").replace(/\s*\+\s*/g, "+").trim();
    if (spec) out.specs[spec] ??= { text, value };
    else if (!out.base && !labels.some((l) => /^sp$/i.test(l))) out.base = { text, value };
  }
  return out.base || Object.keys(out.specs).length ? out : null;
}

/** One damage section's segments ("*25.1 - 25.0 (0-10m) *12.0 (>100m)") → { damages, distances }. */
function curve(section) {
  const pts = [];
  for (const m of section.matchAll(/\*\s*([\d.]+)\s*(?:-\s*([\d.]+))?\s*\(\s*(>?)\s*([\d.]+)\s*(?:-\s*([\d.]+))?\s*m\s*\)/g)) {
    const [, a, b, gt, x, y] = m;
    if (gt) { pts.push([+x, +a]); continue; }
    pts.push([+x, +a]);
    if (y != null) pts.push([+y, b != null ? +b : +a]);
  }
  if (!pts.length) {
    // No segments: "75 - 66" style max - min only can't be placed by distance; a single value is flat.
    const flat = section.match(/^\s*([\d.]+)\s*$/);
    return flat ? { damages: [+flat[1]], distances: [0] } : null;
  }
  pts.sort((p, q) => p[0] - q[0]);
  // Neighbouring segments repeat their shared end point; keep one.
  const uniq = pts.filter((p, i) => !i || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  pts.length = 0;
  pts.push(...uniq);
  return { damages: pts.map((p) => p[1]), distances: pts.map((p) => p[0]) };
}

/**
 * The damage field → { base: { damages, distances, pellets }, specs: { "Slugs": {...} } }.
 * Sections start with a heading ("Default /", "Buckshot (Heavy Load) /", "Slugs /"); a heading
 * naming one of the gun's specs is that spec's curve.
 */
export function parseDamage(field, specNames) {
  if (!field) return null;
  const parts = field.split(/(?:^|\s)([A-Za-z][A-Za-z ()-]*?)\s+\/\s+/).filter((p) => p !== undefined);
  // parts: [before, heading1, body1, heading2, body2, ...]; "before" is the body when there's no heading.
  const sections = [];
  if (parts[0].trim()) sections.push({ heading: "", body: parts[0] });
  for (let i = 1; i + 1 < parts.length; i += 2) sections.push({ heading: parts[i], body: parts[i + 1] });
  const out = { base: null, specs: {} };
  for (const { heading, body } of sections) {
    const c = curve(body);
    if (!c) continue;
    c.pellets = num((body.match(/\(x\s*(\d+)\)/i) || [])[1] ?? "") || 1;
    const labels = [heading, ...[...heading.matchAll(/\(([^)]+)\)/g)].map((m) => m[1])];
    const spec = labels.map((l) => specOf(l.replace(/\(.*\)/, "").trim(), specNames)).find(Boolean)
      || labels.map((l) => specOf(l, specNames)).find(Boolean);
    if (spec && out.base) out.specs[spec] ??= c;
    else if (!out.base) out.base = c;
  }
  return out.base ? out : null;
}

/** Everything the gun list and detail panel use, from one infobox. */
export function parseWeaponBox(box, specNames) {
  return {
    rpm: parseAlternatives(box.rof, specNames),
    magazine: parseAlternatives(box.magazine, specNames),
    velocity: parseAlternatives(box.velocity, specNames),
    partial: parseAlternatives(box.partial, specNames),
    empty: parseAlternatives(box.empty, specNames),
    damage: parseDamage(box.damage, specNames),
  };
}

// Self-check with fields copied from the wiki.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const assert = (c, msg) => { if (!c) throw new Error(msg); };
  const breda = parseAlternatives("Total / 423 RPM / 464 RPM (Light Bolt) / 540 RPM (Trigger Job) / Burst / 539 RPM / 635 RPM (Light Bolt)", ["Light Bolt", "Trigger Job"]);
  assert(breda.base.value === 423 && breda.specs["Light Bolt"].value === 464 && breda.specs["Trigger Job"].value === 540, "breda rof");
  const bar = parseAlternatives("600 RPM (High RoF) / 360 RPM (Low RoF)", []);
  assert(bar.base.value === 600, "bar rof");
  const tommy = parseAlternatives("20 rounds / 30 rounds (SP) / 50 rounds (Extended Magazine)", ["Extended Magazine"]);
  assert(tommy.base.text === "20" && tommy.specs["Extended Magazine"].value === 50, "m1928 mag");
  const carbine = parseAlternatives("15+1 rounds / 30+1 rounds (Extended Magazine)", ["Extended Magazine"]);
  assert(carbine.base.text === "15+1" && carbine.base.value === 15, "carbine mag");
  assert(parseAlternatives("30 + 1 rounds", []).base.text === "30+1", "spaced +1");
  const g43 = parseAlternatives("10 rounds (5-round stripper clips) / 10+1 rounds (Detachable Magazine)", ["Detachable Magazines"]);
  assert(g43.base.value === 10 && g43.specs["Detachable Magazines"].text === "10+1", "g43 mag");
  const g43r = parseAlternatives("2.25s (Detachable Magazine)", ["Detachable Magazines"]);
  assert(!g43r.base && g43r.specs["Detachable Magazines"].value === 2.25, "g43 reload");
  const mp40 = parseDamage("25.1 - 12.0 *25.1 - 25.0 (0-10m) *25.0 - 20.0 (10-20m) *20.0 - 16.7 (20-30m) *16.7 - 14.3 (30-50m) *14.3 - 12.5 (50-75m) *12.5 - 12.0 (75-100m) *12.0 (>100m)", []);
  assert(mp40.base.damages[0] === 25.1 && mp40.base.distances.at(-1) === 100 && mp40.base.damages.at(-1) === 12, "mp40 dmg");
  const shotgun = parseDamage("Buckshot / 7.2 - 2.0 (x32) *7.2 (0-7m) *7.2-3.0 (7-8m) *3.0-2.0 (8-24m) Buckshot (Heavy Load) / 7.2 - 2.0 (x32) *7.2 (0-9m) *7.2-3.0 (9-10m) *3.0-2.0 (10-24m) Slugs / 100 - 34 *100 (0-7m) *100-80 (7-8m) *80-50 (8-30m) *50-34 (30-75m)", ["Heavy Load", "Slugs"]);
  assert(shotgun.base.pellets === 32 && shotgun.base.damages[0] === 7.2, "12g base");
  assert(shotgun.specs["Heavy Load"]?.distances.includes(9), "12g heavy load");
  assert(shotgun.specs.Slugs?.damages[0] === 100 && shotgun.specs.Slugs.pellets === 1, "12g slugs");
  const garand = parseDamage("Default / 40 - 23 *40.0 (0-25m) *40.0 - 35.7 (25-30m) *25.0 (100m) *25.0 - 23.0 (100-150m) Heavy Load / 45 - 28 *45.0 (0-25m) *45.0 - 35.7 (25-50m)", ["Heavy Load"]);
  assert(garand.base.damages[0] === 40 && garand.specs["Heavy Load"].damages[0] === 45, "garand");
  const kar = parseDamage("75 - 66 *75 (0-20m) *75 - 66 (20-60m) *66 (>60m)", []);
  assert(kar.base.damages.join() === "75,75,66" && kar.base.distances.join() === "0,20,60", "kar98k");
  console.log("wiki-weapon-stats self-check passed");
}
