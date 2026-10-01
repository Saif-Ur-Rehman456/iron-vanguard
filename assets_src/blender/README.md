# assets_src/blender

Source `.blend` and `.fbx` files. **Not shipped, not loaded by the game, not
redistributed** unless the sidecar licence allows it.

```
assets_src/blender/
  m4_vanguard.blend
  m4_vanguard.license.json      ← required: provenance for every export from it
  plaza_kits.blend
  plaza_kits.license.json
```

## Sidecar format

Every source asset needs `<asset>.license.json`. The pipeline refuses to export
without one, and `npm run licenses:audit` fails if an exported binary has no ledger
row. See `_TEMPLATE.license.json`.

```json
{
  "source": "Blender / in-house",
  "author": "IRON VANGUARD art team",
  "license": "Proprietary-Purchased",
  "retrieved": "2026-09-20",
  "notes": "hand-modelled from concept sheet 04"
}
```

Allowed `license` values are listed in `packages/tools/src/licenseAudit.ts`:
`CC0`, `MIT`, `Apache-2.0`, `CC-BY`, `CC-BY-4.0`, `Mixamo-Royalty-Free`,
`Proprietary-Purchased`. Anything else needs an ADR — that is deliberate friction:
it forces a human decision about rights before an asset can ship.

## Conventions (enforced by `conform.py`)

- 1 unit = 1 metre; a 5 m wall is 5 units tall.
- Origin at the ground contact point (floor of the prop at Z = 0).
- Applied transforms: no leftover scale or rotation.
- Materials named `SURFACE_<surface-id>` matching `packages/content/src/surfaces.ts`
  (`SURFACE_concrete`, `SURFACE_metal`, `SURFACE_sand`, `SURFACE_wood`, `SURFACE_flesh`).
- LOD0 within the class budget (`docs/ART_BIBLE.md`), LOD1 ≈ 40%, LOD2 ≈ 15%.
- A second UV channel named `Lightmap`; a `<asset>_COL` convex proxy for collision.

Add `.blend1` backups and `.fbx` downloads to your global gitignore — they must
never be committed.
