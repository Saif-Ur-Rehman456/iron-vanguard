# ADR-0017 — The pixel count is not a tier's lever; the effects are

Status: accepted (fourth review)

## Context

The third report of the same two symptoms — *the game is very laggy* and *everything is
blurry, dhundla, at every graphics level* — arrived with five frames attached, and the
frames were the useful part. Every one of them had three properties at once:

1. **The HUD was crisp and the 3D image was not.** The overlay is DOM; the scene is a
   render target. So the blur was in the render, not in the display or the font.
2. **Fine world detail was missing, not softened.** A wall two metres away was a mottle of
   light and dark with no masonry in it. A mottled wall is a *texel-density* symptom, and
   `UV_DENSITY` / `UV_PIXELS` say why: a 256² facade map stretched over a 3 m storey is
   11.7 mm per texel, against ~1.7 mm per screen pixel at that distance. The wall was
   seven times softer than the monitor could show.
3. **The distance was a pale wash.** Far buildings read as light grey against a dark sky —
   the fog colour converging on the brightest value in the frame, i.e. haze that reads as
   a soft picture rather than as air.

And underneath all three, the settings ladder was still the thing ADR-0014 made it:

| | low | medium | high | cinematic |
| --- | --- | --- | --- | --- |
| `pixelRatioCap` | 1.0 | 1.25 | 1.75 | 2.0 |
| `adaptiveFloor` | 0.90 | 0.90 | 0.90 | 1.00 |

with a controller free to scale *below* that on any frame over budget. Two consequences,
both invisible to the code that reports them:

- **On a 125%-scaled 1080p panel, `low` rendered 80% of the panel's pixels** and let the
  compositor stretch them. That is a blur applied by the browser, outside every renderer
  number. On a 2x display even `high` (1.75) was a downscale, and `cinematic` was the only
  sharp tier — which is exactly the shape of "every level looks bad".
- **The two settings a player reaches for when the game is slow were the same setting**,
  and it was the wrong one: turning GRAPHICS down made the game *softer*, and turning it
  down again made it softer still. There was no lever anywhere in the product that meant
  "draw fewer effects, but draw them sharply" — which is what a player with a weak GPU
  actually wants, and what the previous build (a fixed-resolution prototype with far fewer
  effects) accidentally was.

## Decision

**Split the trade in two, and make each half honest on its own.**

### 1. Native pixels at every tier, at any device pixel ratio

`pixelRatioCap` is 2 on all four tiers; the renderer computes
`min(devicePixelRatio, cap)`, so the frame is drawn at the display's own pixel count and
never below it. The cap is a *ceiling* on the ratio (a 3x phone screen need not render 9x
the pixels), not a per-tier target — a ladder of pixel counts is a ladder of blurs, and no
wording in a settings menu can make "medium" not look like a smeared "high".

### 2. A tier buys effects, and says which

| | low | medium | high | cinematic |
| --- | --- | --- | --- | --- |
| ambient occlusion | off | off | 6 samples @ 0.5 | 8 samples @ 0.5 |
| shadow atlas | off | 1024² / 55 m | 1024² / 70 m | 2048² / 90 m |
| screen-space AA | FXAA | FXAA | SMAA | SMAA |
| MSAA | 0 | 0 | 2 | 4 |
| real lamp lights | 1 | 2 | 3 | 6 |
| window lights | 0 | 1 | 2 | 4 |
| particles / decals | 180 / 4 | 320 / 8 | 420 / 12 | 640 / 20 |
| whole-buffer passes | 4 | 4 | 6 | 6 |

AMD-0014 said a tier may not change the look, and this keeps the part of that which was
right: the colour, contrast, fog, bloom, lighting *ratios* and AO radii are one shared rig
(`LOOK_RIG`), so no tier is a different picture. What changes is that a tier may drop an
effect entirely and say so in the settings copy. The reasoning that produced ADR-0014 was
"turning graphics down made the game look worse" — and it was right that the picture must
not become a different picture; it was the *remedy* that was wrong. Spending the pixel
count to achieve that invariant was the mistake, because softness is the one degradation
a player cannot compensate for, while a missing shadow or a missing occlusion term is
visible, nameable and cheap to describe.

### 3. The resolution trade is a setting, with two named modes

`RESOLUTION` in the settings panel, persisted with the rest of `StoredSettings`:

- **NATIVE (default)** — lock the scale at 1.0. The frame is never upscaled, and a slow
  machine is answered by the effect budget above.
- **DYNAMIC** — release the controller to its floor (0.7, or better up the tiers). This is
  the right choice for a machine that cannot hold 60 fps at native and would rather have
  the frames; the upscale compensation in `post/look.ts` restores the micro-contrast a
  bilinear upscale removes, so it is a softer picture, not a smeared one.

A trade that is chosen is a trade. A trade that happens *to* you is a blur — and it is the
one thing every frame in the review had in common.

### 4. One fewer whole-buffer pass, everywhere

The upscale compensation was a `ShaderPass` of its own and the grade was another, both
full-resolution, both single-viewport reads of the same buffer. The compensation is now a
uniform and five taps inside the look pass (`post/look.ts`, `setSharpen`), which is one
fewer whole-buffer read/write per frame at every tier. `post/sharpen.ts` is gone.

### 5. The pass list is data, and a test counts it

`postChain(quality)` states the stages, their order and their resolution scale, and
`buildComposer` iterates it. `fullResPasses(quality)` is the count of whole-buffer
read/writes, and `tests/unit/quality.test.ts` asserts it per tier (4 / 4 / 6 / 6) along
with the stage order, the sub-buffer bloom, the AO scale ceiling and the absence of a
`sharpen` stage. This is the GPU-free half of "the frame is cheap": it is arithmetic, and
it is reported live by `window.__IV__.renderDebug().fullResPasses`.

### 6. The world's texel density became a checked contract

- **`UV_PIXELS`** (materials/materials.ts) declares the texture edge in pixels per surface
  class, next to `UV_DENSITY`'s metres per tile. `tests/unit/texel.test.ts` divides them and
  fails below a stated floor per class — a *density* floor, not a size floor, so a recipe
  that doubles its tile must also double its resolution.
- **The facade map is 512² over `UV_DENSITY.building` = 1.2 m** (2.3 mm per texel, 4.2x
  denser than the 256²-over-2.5 m it was). The storey slab band that used to force the tile
  to be a storey is gone from the map because it is *geometry* (`arena.buildBuilding` puts
  a 0.22 m band on every storey line) — so the map is free to be a wall material at the
  density a wall is looked at from.
- **The plaza floor is 1024²** over its 2.6 m tile (2.5 mm per texel, 2x denser), with its
  per-pixel grain halved: doubling a texture's resolution doubles the frequency of its
  finest term, and a finer version of the same static is not an improvement.
- **The wall's dirt was reduced, not increased.** Spalling went from 34 specks at 0.22
  alpha and 6-20 mm to 26 at 0.11 alpha and 12-30 mm, and the grain from 0.03 to 0.018.
  At 2.3 mm per texel, many small high-contrast marks *are* noise; walls read as walls
  because they have few large marks.

### 7. The haze came down, and the view model came up

- `LOOK.fogDensityScale` 0.85 → 0.62 and the dusk fog colour `0x4b5567` → `0x39404f`. In a
  night frame the fog's brightness is a light source nobody asked for, and a bright fog
  makes the far end of the plaza the brightest region of the image — the measured
  definition of "blurry" that no sharpening can fix.
- The view-model light went from 1.2 cd to 2.6 cd: 13 lux on a handguard 45 cm away, twice
  the moonlight on the street behind it. One light, not two — the forward renderer
  evaluates every light for every fragment of the whole frame, so a rim light for one glove
  would be paid for by the entire scene. The glove's material also took the sky at full
  strength (`envIntensity` 1) and a touch more gloss, which is what puts an edge on a
  knuckle under a single point light.

## Consequences

- **`low` is now the tier to recommend to a weak machine**, and it is both the fastest and
  the sharpest frame the renderer can produce. Its cost is grounding: no AO and no shadow,
  so objects sit less firmly and the moon casts no long shadow across the plaza. That is a
  visible, nameable trade, which is the test this ADR applies to every tier.
- **A machine that still cannot hold 60 fps at `low` and native resolution has the
  DYNAMIC switch**, and `docs/CAPTURE_REQUEST.md` phase 05 asks for the two numbers that
  decide it (frame rate and observed resolution scale) instead of an argument.
- **The tier ladder is no longer monotonic in image quality** — that is the point. It is
  monotonic in cost and in effect count, and `tests/unit/quality.test.ts` asserts the cost
  ordering rather than an ordering of pixel counts.
- **`docs/PERF_BUDGET.md`'s "quality ladder" tables had to be rewritten**, because they
  described the pixel-count ladder that no longer exists. Any future change to a tier must
  update that table, the copy in `packages/ui/src/screens.ts`, and the EXPECTED table in
  `tests/unit/quality.test.ts` — three places that now state the same facts.

## Alternatives considered

- **Keep the caps and add a "performance" preset below `low`.** Rejected: the caps are what
  made every existing preset soft, and a fifth preset does not fix the four above it.
- **Keep the caps but lock the controller.** Better, and it was tried in ADR-0016 — but the
  caps themselves are still downscales on a HiDPI panel, and the ladder still reads as
  "lower settings look worse", because on `low` it still *was* worse.
- **Let a tier drop the look rig (the pre-0014 behaviour).** Rejected: two pictures with one
  label is the confusion ADR-0014 correctly identified. Dropping an effect is not changing
  the look — it is removing something the player can point at.
