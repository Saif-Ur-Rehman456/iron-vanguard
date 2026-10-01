# ADR-0005 — Procedural baseline, art as an additive layer

**Status:** accepted · **Date:** 2026-09-20

## Context

Two failure modes were on the table:

1. **Art-gated development.** Nothing playable until the art is finished. Feedback
   arrives late, and the game's feel gets tuned against placeholder assets that lie
   about visibility and scale.
2. **Placeholder rot.** Ship with ripped or "temporary" assets and promise to replace
   them. The replacement never fully happens, and the project carries legal risk in
   the meantime.

M1 also has to work as a single self-contained HTML file, which rules out a large
binary asset payload for the core experience.

## Decision

Generate everything at runtime for now, and treat `assets/` as a layer that
*overlays* the baseline:

- Textures: canvas noise + blur, seeded (`packages/render/src/materials/textures.ts`).
- Geometry: built from `MapDef` prop data (`level/arena.ts`), weapons and characters
  (`viewmodel.ts`, `characters/enemyView.ts`).
- Audio: WebAudio synthesis, ~20 cues (`packages/audio/src/sfx.ts`).
- FX: pooled sprites for particles, tracers, decals, explosions.

Rules that follow from it:

- The game must boot and play with `assets/` deleted or empty. No asset is a hard
  dependency.
- The art pipeline (`tools/blender/*.py`) writes GLB/KTX2 into `assets/` and a ledger
  row; it never overwrites or requires the procedural path.
- Anything that ships from `assets/` needs provenance (ADR-0009).
- Scale and silhouette conventions in `docs/ART_BIBLE.md` are chosen so a
  Blender-authored asset can replace a procedural one without changing collision
  (collision comes from `MapDef`/footprints, not from the mesh).

## Consequences

- The project is playable and testable from day one, and stays playable offline as
  one file.
- The look is coherent but plain: flat colours, simple forms, no normal maps. M1
  reads as a stylised prototype, which is the honest description.
- Replacing a prop with real art is an additive change (drop a GLB, add a manifest
  entry) rather than a refactor.
- Some procedural code will eventually be dead weight for props that get real art.
  That is the cheap direction of the trade.

## Alternatives rejected

- **Ship a small placeholder pack (Kenney/Quaternius) now.** Tempting, and CC0-legal,
  but it converts "make an art pass" into "make an art pass *and* remove the
  placeholders", and it hides visibility/scale problems behind someone else's
  proportions.
- **Wait for art.** Kills the iteration loop that the whole workflow depends on.
