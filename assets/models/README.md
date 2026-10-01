# assets/models — downloaded models (optional)

The game ships a complete **procedural** baseline: the plaza, the props, the weapon
and every enemy are generated in code, so this folder can stay empty forever and the
product still works. What lives here is the *upgrade path* — a licensed model
dropped into a named slot.

```
assets/
  models/
    prop_wreck.glb          <- one file per slot, named <slot>_<id>.glb
  manifest.json             <- the slot table (models: { "prop.wreck": {...} })
  licenses/ledger.csv       <- provenance row per binary (invariant 5)
```

## Add a model

```bash
# From Sketchfab (needs your own token: https://sketchfab.com/settings/password)
export SKETCHFAB_TOKEN=...
npm run assets:import -- --slot=weapon:m4a1 --url=https://sketchfab.com/3d-models/... 

# From a file you already have (a purchased pack, your own Blender export)
npm run assets:import -- --slot=prop:wreck --file=~/Downloads/wreck.glb \
  --license=CC0 --author="Someone" --source="https://example.com/wreck"
```

Both forms write the manifest entry, copy the GLB and append the ledger row in one
step, then run the licence audit. Skipping a step is not possible by design: the
manifest without the ledger row fails `npm run licenses:audit`, and CI runs it.

## Slots that exist

| Slot | Fills | Notes |
| --- | --- | --- |
| `weapon.<weaponId>` | the first-person view model | anchors/muzzle flash stay procedural |
| `enemy.<archetypeId>` | an enemy body | animated as a whole (yaw, hit flash, death fall) |
| `prop.<propKind>` | one prop kind in every map | barrels and banners stay individually addressable |

`<id>` values come from `packages/content` (`weapons.ts`, `enemies.ts`, `PropKind`).
Optional per-entry fields: `scale` (model units → metres), `yawOffset`, `yOffset`.

## What the game does when something is wrong

Nothing throws. A missing file, a 404, a broken GLB or a manifest entry the schema
rejects all log one line and keep the procedural version of that slot. That is the
point of the baseline: models are an upgrade, never a dependency.

`window.__IV__.models()` reports what actually loaded in a running build.
