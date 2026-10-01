# Blender asset pipeline

Source `.blend` files live in `assets_src/` and are **never** loaded by the game.
Everything the runtime consumes is exported here into `assets/`, with a ledger row
in `assets/licenses/ledger.csv` (see `docs/LICENSING.md`).

```
assets_src/blender/m4_vanguard.blend      →  assets/models/weapons/m4_vanguard.glb
assets_src/blender/plaza_kits.blend       →  assets/models/kits/plaza_*.glb
assets_src/blender/props_barrels.blend    →  assets/models/props/barrel_a.glb (+ LODs, fracture chunks)
```

## Running it

```bash
# once: point at a Blender 4.2+ install
export BLENDER_BIN="/c/Program Files/Blender Foundation/Blender 4.2/blender.exe"

python tools/blender/kit_batch.py --all              # export everything that changed
python tools/blender/kit_batch.py --only m4_vanguard # export one source file
python tools/blender/conform.py --all                # art-bible conformance report only
python tools/blender/fracture.py assets_src/blender/props_barrels.blend --pieces 12
python tools/blender/mixamo_retarget.py --fbx ~/Downloads/mixamo/idle.fbx --clip idle
```

Or via npm: `npm run assets:pipeline` (same as `kit_batch.py --all`).

## What `kit_batch.py` does, per source file

1. **Conform** — check the art-bible rules (`conform.py`): 1 unit = 1 metre, +Y up
   inside Blender, origin at the ground contact point, materials named
   `SURFACE_<surface-id>` so the game can look up impact FX from its surface table.
2. **LODs** — decimate to the triangle budgets in `docs/ART_BIBLE.md` (LOD0/1/2) and
   name them `<asset>_LOD0..2`.
3. **Lightmap UVs** — unwrap a second UV channel with a 4-pixel gutter for baked AO.
4. **Collision proxy** — build a low-poly convex proxy named `<asset>_COL`, which
   `three-mesh-bvh` consumes in @iron/render.
5. **Export** — GLB with `+Y up`, applied modifiers, no cameras/lights, KTX2 textures.
6. **Ledger** — read the sidecar `assets_src/blender/<asset>.license.json` and append
   or update the row in `assets/licenses/ledger.csv`.

## Rules that keep this honest

- **No asset enters `assets/` without a licence sidecar.** CI runs
  `npm run licenses:audit`; a missing row fails the build. This is the check that
  makes "where did this model come from?" a question nobody has to ask after ship.
- **Nothing in `assets_src/` is redistributable unless the sidecar says so.** Mixamo
  characters are royalty-free for use *in* a game but may not be redistributed as
  assets; their sidecar says `Mixamo-Royalty-Free` and the exporter strips the
  original rig names.
- **Procedural first.** Every prop has a procedural fallback in @iron/render, so a
  missing or broken `assets/` folder degrades rather than breaking the build. The
  pipeline adds fidelity; it is never a hard dependency.

## Why Python scripts instead of a manual export checklist

A checklist drifts. A script that fails loudly on a 3-unit-tall crate or a
`Material.001` name is the difference between a project that stays coherent and one
that quietly accumulates 400 hand-exported files nobody can re-export.
