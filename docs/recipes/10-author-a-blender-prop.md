# Recipe 10 — Author a Blender prop

**Time:** 1–3 hours · **Risk:** medium · **Touches:** `assets_src/blender/*`,
`tools/blender/*`, `assets/models/*`, `assets/licenses/ledger.csv`

Props are the first art that replaces the procedural baseline. The pipeline exists so
this stays reproducible: one source `.blend` in, GLB + LODs + collision proxy +
collision data + ledger row out, with a script that refuses to ship a 3-metre crate
that was authored 3 units tall.

Nothing here is required for the game to run. A missing `assets/` folder degrades to
the procedural baseline (ADR-0005). That is deliberate: it means art can land
incrementally, prop by prop, without a flag day.

## Before you open Blender

1. **Read `docs/ART_BIBLE.md`.** The rules that matter most:
   - 1 unit = 1 metre, `+Y` up, origin at the ground contact point;
   - materials named `SURFACE_<surface-id>` (e.g. `SURFACE_concrete`) so impact FX can
     be looked up from the surface table (recipe 09);
   - triangle budgets per class (LOD0/1/2) and no more than 4 materials per prop.
2. **Have a licence story ready.** Every `.blend` gets a sidecar
   `assets_src/blender/<name>.license.json` (copy `_TEMPLATE.license.json`). If you
   modelled it yourself, say so; if it is derived from a download, name the source and
   its terms. `npm run licenses:audit` fails the build otherwise.
3. **Check it already exists.** The procedural baseline covers every `PropKind`; if
   your prop is decorative and cheap, the baseline may be the right answer.

## Authoring

1. **One prop per file** (or one kit per file if the pieces share a palette and budget,
   like the plaza kit). Name the file for what it is: `props_barrels.blend`,
   `kit_plaza.blend`, `m4_vanguard.blend`.
2. **Build to the footprint.** The simulation collides against `footprintOf(propKind)`
   in `packages/sim/src/collision.ts` — a prop that *looks* 3 m wide but is 0.45 m in
   collision is a bug the player will find. Either build to the existing footprint or
   change the footprint deliberately (and re-record the golden, since cover changed).
3. **Keep a shootable/hittable silhouette.** The mesh is what bullets are tested
   against once meshes are in play; thin, non-manifold or inside-out geometry produces
   shots that pass through.
4. **Run the conformance check early:**

   ```bash
   export BLENDER_BIN="/c/Program Files/Blender Foundation/Blender 4.2/blender.exe"
   python tools/blender/conform.py --only props_barrels
   ```

5. **Export through the pipeline, never by hand:**

   ```bash
   python tools/blender/kit_batch.py --only props_barrels
   ```

   That conforms, generates `_LOD0..2`, unwraps the lightmap UVs, builds the
   `<asset>_COL` collision proxy, exports GLB (`+Y` up, no cameras/lights), and
   updates the ledger.

6. **Register the asset** in `assets/manifest.json` (logical id → runtime file). The
   game reads logical ids, so a rename on disk does not ripple through the code — but
   an asset that is not in the manifest is invisible to the preloader.

7. **Hook it up** where the renderer builds that prop kind, and delete the procedural
   placeholder for that kind *only if* every map prop of that kind is now covered.

## Verify

```bash
npm run assets:validate      # manifest ↔ ledger ↔ files agree
npm run licenses:audit       # provenance gate
npm run build && npm run test:e2e
npm run budget               # the artifact size gate still passes
```

Then look at it in-game at `low` and `high` quality (`docs/PERF_BUDGET.md`): LOD
switching at close range and shadow acne are the two things that only show up live.

## Traps we have hit

- **Origin drift.** A prop whose origin is not at the ground contact point is placed
  half-buried or floating, and every map that uses it is subtly wrong.
- **`Material.001`.** The pipeline rejects non-`SURFACE_*` material names, because
  otherwise impact FX silently default to concrete.
- **Mesh density vs. the fragment budget.** A beautiful 30k-tri barrel eats the frame
  budget of twenty procedural crates; check `docs/PERF_BUDGET.md` before adding
  non-LOD'd detail.
