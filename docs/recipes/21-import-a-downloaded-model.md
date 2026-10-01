# Recipe 21 — import a downloaded model

**Goal:** replace one procedural thing with a licensed model — a weapon, an enemy body or
a prop kind — without breaking the build, the determinism or the licence audit.

Time: minutes. Risk: low (the procedural version stays until the model loads).

## Before you start

- Decide the slot. The ids are the ones the game already uses:
  - `weapon.<weaponId>` — `m4_vanguard`, … (`packages/content/src/weapons.ts`)
  - `enemy.<archetypeId>` — `rifleman`, `rusher`, `heavy` (`enemies.ts`)
  - `prop.<PropKind>` — `wreck`, `barrel`, `crate`, `monument`, … (`types.ts`)
- Decide the licence. If you cannot name it, you cannot ship it:
  CC0, CC-BY(-3.0/-4.0), MIT, Apache-2.0, Mixamo-Royalty-Free or
  Proprietary-Purchased. Everything else needs `--allow` **and** a line in
  `docs/LICENSING.md` explaining why.

## Steps

1. Import from a file you already have:

   ```bash
   npm run assets:import -- --slot=prop:wreck --file=~/Downloads/wreck.glb \
     --license=CC0 --author="Someone" --source="https://example.com/wreck"
   ```

   Or straight from Sketchfab, with your own API token (everything the model's licence
   allows is checked for you):

   ```bash
   export SKETCHFAB_TOKEN=...
   npm run assets:import -- --slot=weapon:m4a1 \
     --url=https://sketchfab.com/3d-models/<slug>-<id>
   ```

   The command copies the GLB to `assets/models/<slot>_<id>.glb`, adds the manifest entry
   and appends the ledger row.

2. Fix the scale and orientation if it is wrong. Most downloaded models are not in
   metres, and many face +Z:

   ```bash
   npm run assets:import -- --slot=prop:wreck --file=... --scale=0.01 --yawOffset=3.14159
   ```

3. Look at it:

   ```bash
   npm run shots -- --url=http://localhost:5173     # writes .captures/ + a luminance report
   ```

   Or open the devtools panel and read `window.__IV__.models()` — it lists exactly which
   slots loaded and which failed.

4. Prove the invariants still hold:

   ```bash
   npm run licenses:audit    # manifest entry ↔ file ↔ ledger row
   npm run test              # the golden replay must not move: this pass touches no sim code
   ```

## What good looks like

- `assets/manifest.json` has one new entry with `slot`, `id`, `file`, `license`, `source`,
  `author`.
- `assets/licenses/ledger.csv` has the matching row (the importer writes it; do not
  hand-edit one without the other).
- `window.__IV__.models()` reports `loaded: ["prop.wreck"]` and `failed: []`.
- Deleting the `.glb` returns the game to the procedural wreck with a single console line
  — nothing else changes.

## Removing a model

Delete the `models` entry, delete the file, delete the ledger row. Three deletions, no
code. If a model looked worse than the procedural version, do this instead of tuning it:
the baseline is the product, and a mediocre downloaded asset is a regression with a
licence attached.

## Gotchas

- **Skinned models are cloned with `SkeletonUtils`**, so two instances animate
  independently; a plain `clone()` would share one skeleton and move as a crowd.
- **A GLB enemy is animated as a whole** (yaw, hit flash, death fall) because its rig is
  not the procedural skeleton. Its limbs do not walk. That is a known, documented
  limitation, not a bug — a real rig is M2 animation work (recipe 11).
- **Barrels and banners stay individually addressable** even when they come from a model,
  because the simulation toggles a barrel's visibility when it explodes.
- **Never commit `assets_src/` downloads** (AGENTS.md): only the exported GLB plus its
  ledger row.
