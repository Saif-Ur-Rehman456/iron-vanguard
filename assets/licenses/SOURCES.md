# Asset sources and terms

`ledger.csv` is the machine-readable record (and the thing CI checks). This file is
the human explanation: where each source came from, what we may do with it, and what
we must not.

## Shipped today: procedural only

The M1 vertical slice has **no binary assets**. Every texture, mesh and sound is
generated at runtime:

| Asset class | Where it is generated | Notes |
| --- | --- | --- |
| Textures (concrete, sand, metal, wood, sky) | `packages/render/src/materials/textures.ts` | canvas noise + box blur, seeded |
| Level geometry, props, barrels | `packages/render/src/level/arena.ts` | built from `MapDef` data |
| Weapons, characters | `packages/render/src/viewmodel.ts`, `characters/enemyView.ts` | box/cylinder builds |
| Particles, tracers, decals, explosions | `packages/render/src/fx/*` | pooled sprites |
| All audio | `packages/audio/src/sfx.ts` | WebAudio synthesis |

That is why `ledger.csv` is empty and why `npm run licenses:audit` passes on a clean
checkout: there is nothing to audit yet. The moment a GLB, KTX2 or WAV lands in
`assets/`, the audit demands a row — and `tools/blender/kit_batch.py` writes those
rows automatically from each source file's sidecar.

## Planned sources (M2)

| Source | Use | Licence | Restrictions |
| --- | --- | --- | --- |
| [Poly Haven](https://polyhaven.com) | HDRIs, PBR texture sets | CC0 | none |
| [ambientCG](https://ambientcg.com) | PBR materials, decals, ground | CC0 | none |
| [Quaternius](https://quaternius.com) | low-poly props, animated characters | CC0 | none |
| [Kenney](https://kenney.nl) | UI, prop kits | CC0 | none |
| [KayKit](https://kaylousberg.itch.io) | dungeon/urban kits | CC0 | none |
| [Mixamo](https://mixamo.com) | animation clips | Adobe royalty-free | **raw assets may not be redistributed** |
| Blender (ours) | characters, weapons, level kits | ours | none |

## The Mixamo rule, spelled out

Mixamo clips are free for commercial games. They are *not* free to redistribute as
assets, so:

- the FBX files never enter the repository (they stay in a local download folder);
- `tools/blender/mixamo_retarget.py` imports a clip, renames every bone to
  `IK_iron_*`, deletes the imported mesh, and exports our own GLB containing
  animation data against our skeleton;
- the ledger row says `Mixamo-Royalty-Free` with a note that it is animation data
  only, so a future audit can tell the difference between "we licensed a clip" and
  "we redistributed someone's character".

## Adding a source

1. Download it to `assets_src/blender/` (or a textures folder) — never directly into
   `assets/`.
2. Write `<asset>.license.json` next to it: `source`, `author`, `license`,
   `retrieved`, `notes`.
3. Run `npm run assets:pipeline`. The exporter validates conformance, exports the
   GLB, and appends the ledger row.
4. Run `npm run licenses:audit`. If it fails, the sidecar is wrong — fix it before
   committing.
