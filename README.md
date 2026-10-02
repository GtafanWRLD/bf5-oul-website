# BF5 Tier List

Drag-and-drop tier lists for Battlefield V:

- **Players**: search any BF5 platoon and rank its members (with their EA avatars).
- **Weapons**, **Vehicles**, **Maps**: every one in the game, with in-game pictures.

Add notes to any card (double-click), rename / recolor / reorder tiers, and save a tier list as a PNG.
Everything is saved in your browser's local storage: nothing is uploaded anywhere.

Player, platoon and server data comes live from [gametools.network](https://gametools.network).
Not affiliated with EA or DICE.

## Files

- `index.html`: the whole app (no build step).
- `catalog.js`: the weapon, vehicle and map list. Regenerate it with `node tools/build-catalog.mjs`
  (Node 18+), which combines the weapon and vehicle lists from many players' profiles, since
  gametools has no "every weapon" endpoint.

## Running locally

Open `index.html` in a browser, or serve the folder (e.g. `python -m http.server`).
