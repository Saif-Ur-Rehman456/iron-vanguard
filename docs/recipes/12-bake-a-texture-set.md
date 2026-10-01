# Recipe 12 — Bake a texture set

**Time:** 1–2 hours · **Risk:** medium (payload size is a gameplay concern) ·
**Touches:** `tools/blender/kit_batch.py`, `assets/textures/*`, `assets/licenses/ledger.csv`,
`packages/render/src/materials/materials.ts`

Textures are where a browser build dies quietly: a handful of 4K PNGs is 40 MB, and the
game ships to a player on hotel wifi. The pipeline bakes to KTX2 (GPU-compressed, mip
mapped) and the budget gate enforces the result.

## Steps

1. **Author the source.** Either bake from a high-poly + procedural pass inside
   Blender, or from a CC0 material library (see `assets/licenses/SOURCES.md` for the
   vetted list — Poly Haven, ambientCG). Keep the source files in `assets_src/`, not
   `assets/`.

2. **Bake/export the set** through the pipeline:

   ```bash
   export BLENDER_BIN="/c/Program Files/Blender Foundation/Blender 4.2/blender.exe"
   python tools/blender/kit_batch.py --only props_barrels
   ```

   That unwraps a **second UV channel with a 4-pixel gutter** for baked AO, exports
   albedo/normal/roughness (ORM packed), and compresses to KTX2 with mipmaps.

3. **Name materials after surfaces.** `SURFACE_concrete`, `SURFACE_metal`, … — the
   runtime maps material → surface id → impact FX/decal/penetration (recipe 09). A
   material with a non-`SURFACE_*` name is a conformance failure.

4. **Pick the texture budget from the class, not your eye:**

   | Asset class | Albedo | Notes |
   | --- | --- | --- |
   | small prop | 512 | a crate does not need more |
   | medium prop / weapon | 1024 | view-model gets the high end |
   | hero prop / monument | 2048 | one per map, not one per prop |
   | trim/tile sheet | 2048 shared | palette-friendly, best win |

   Values are enforced in `docs/ART_BIBLE.md` and `docs/PERF_BUDGET.md`.

5. **Try to avoid unique textures.** The plaza kit's whole point is a shared palette:
   trim sheets and tiling materials let twenty props share one texture. If you are
   baking a new unique set per prop, stop and ask whether a common palette would do.

6. **Register in `assets/manifest.json`** and point the material at the new maps in
   `packages/render/src/materials/materials.ts`.

## Verify

```bash
npm run assets:validate
npm run licenses:audit
npm run build && npm run budget      # this is the real test: did it ship?
```

Load the map at `low` quality on integrated graphics (`docs/PERF_BUDGET.md`) and check
both memory and frame time; KTX2 helps, but mip level 0 still has to fit.

## Traps we have hit

- **PNG where KTX2 was expected.** A stray PNG in `assets/` bypasses GPU compression and
  roughly quadruples VRAM for the same image.
- **Normals baked for the wrong handedness.** The project is `+Y` up; a normal map baked
  for another convention makes every surface look lit from the wrong direction.
- **No gutter.** Mip mapping bleeds neighbouring islands into seams; the 4-pixel gutter
  is not decoration.
- **A unique 4K set for a prop you will never look at closely.** The budget gate will
  not catch it (it only measures the artifact) — but your min-spec player will.
