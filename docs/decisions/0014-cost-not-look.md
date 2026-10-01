# ADR-0014 — A quality tier changes cost, not the look

- Status: accepted (Phase 03, realism pass 2)
- Supersedes nothing. Extends ADR-0012 (rendering foundation) and ADR-0013 (lighting rig).
  Departs from the prototype's quality switch in `legacy/PARITY_NOTES.md`.

## Context

The Phase 03 review contained a complaint that was not about art at all: *"turning
GRAPHICS down makes the game look worse, not cheaper."* It did, and the reason was
structural — a tier was an art direction:

| field | `low` | `high` | what the player sees |
| --- | --- | --- | --- |
| `shadows` | off | on | objects stop touching the ground |
| `aoIntensity` | `0` | `0.85` | every corner loses its contact shadow |
| `keyIntensity` | 2.2 | 2.6 | the whole frame goes flat and dark |
| `ambientIntensity` | 0.40 | 0.55 | the shadow side collapses into the key |
| `environmentIntensity` | 0.55 | 0.74 | metal loses its only bounce |
| `postAa` | FXAA | SMAA | the image blurs |
| `dust` | off | on | the air stops being air |

Two more defects were found while measuring that one:

- **The adaptive controller was pinned to its own floor.** It targeted 14 ms — 71 fps,
  a frame rate no display was showing. On ordinary hardware it sat at its floor (0.7)
  for the whole session, so the game was rendered at 70% of native resolution and
  upscaled. The review's frames read 48–58 fps *and* were soft, which is the signature.
- **Texel density was inverted.** `repeat` is baked into the shared surface textures,
  so a mesh's density was `texture pixels / mesh size`: the 400 m plaza floor carried
  one tile per 50 m (**97 mm per texel** — a beige wash across most of the frame) while
  a crate three metres away was tiled at **3 mm per texel**. The review described the
  result as painted cardboard, and it was: the same frame contained a 30,000× spread in
  detail density.

## Decision

**1. The look lives in one place.** `LOOK_RIG` in `packages/render/src/quality.ts` holds
every field a player would call art: the lighting ratios, shadow intensity, the AO
contact and corner radii with their intensity and power, bloom, the grade, and whether
dust exists. Every tier spreads it verbatim. A tier may only spend *samples, sizes and
counts* — shadow map resolution and reach, AO samples, MSAA samples, local-light budgets,
particle and decal capacity, pixel-ratio cap. `tests/unit/quality.test.ts` fails if two
tiers ever disagree about a look field, so this cannot be quietly undone.

Consequences taken deliberately: `low` keeps shadows (a 512² cascade over 45 m), keeps
AO (4 samples per radius, denoised), keeps SMAA, and keeps dust. A machine that cannot
afford those loses resolution instead — a single, visible, honest axis.

**2. Resolution is the trade, and the game says so.** The controller targets **16.7 ms
(60 fps)**; every tier's floor is **≥ 0.8** of native; a preset change or a mission load
`hold`s the controller for 3 s, and every step coasts 150 ms, because the frames after a
composer rebuild are shader compiles rather than the game — reading them as a bottleneck
is how "switch preset" became "switch to a blurrier game". The HUD's frame counter now
reads `58 FPS · 82% RES` when the two disagree, and the settings panel shows the tier's
budget, the live resolution and the sentence *"quality changes shadows, samples and
particles; it does not change the look"*.

**3. Density is a property of the surface.** `geometry.uvMetres(geometry, u, v, tile)`
authors UVs in metres, `UV_DENSITY` states how many metres one texture tile covers per
surface class (2.6 m of paving, 0.4 m of crate, 0.35 m of sandbag), and `uvUnitMetres`
bridges the two for surfaces whose textures still repeat inside a UV unit. The floor
goes from 97 mm per texel to 5.1 mm; a crate's density no longer changes when the crate
does. Props are migrated as they are touched — the ground, roads, kerbs, crate, sandbag,
puddle and banner are done; the remaining props still tile by their own size, which is a
documented gap in `docs/QUALITY_BAR.md` rather than a claim.

## Evidence

- `tests/unit/quality.test.ts` — look-field equality across tiers, the cost ladder, the
  0.8 floor, the controller's hysteresis, its hold, and the 16.7 ms target.
- `tests/unit/texel.test.ts` — the weapon set's per-metre tiling and `uvMetres`' exactness,
  including that it clones (a scaled cached geometry would corrupt every other user).
- `tests/unit/world.test.ts` — `uvUnitMetres` against a texture that repeats 8×, the
  floor-to-weapon density ratio, and `groundMaterialFor`.
- The visual half is the `preset` and `density` probes in `npm run shots`, plus the
  capture checklist in `docs/CAPTURE_REQUEST.md` (frames 3.6–3.9).
