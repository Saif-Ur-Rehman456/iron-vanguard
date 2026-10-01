# ADR-0012 — The rendering foundation is measured, not asserted

- Status: accepted (rendering foundation pass)
- Supersedes nothing. Extends ADR-0005 (procedural-first art) and ADR-0011 (realism
  without borrowed assets).

## Context

The art review of the realism pass said the models were better but the *image* was not:
jagged edges, shadows that did not ground anything, flat corners, one brightness band,
and — intermittently — a black screen. Four of those were not opinions, they were
measurements waiting for a tool, so the first change was the tool: `npm run shots`
screenshots the running game, reports luma percentiles, edge/ramp ratio (the AA score),
per-patch brightness at fixed *world* points, an HTML overlay readout and a black-frame
hunt.

It immediately found four things nobody had argued for:

1. **A real one-frame black flash** (98.3% of pixels below luma 25). The adaptive
   resolution controller called `setSize` *after* the frame had been drawn, reallocating
   the WebGL drawing buffer, so the compositor presented an empty black buffer.
2. **`PCFSoftShadowMap` no longer exists.** three r186's `WebGLShadowMap` silently coerces
   it to `PCFShadowMap` and logs a warning, so the `shadowsSoft` quality flag had been a
   no-op since the upgrade.
3. **There was no anti-aliasing at all.** `antialias: this.quality.antialias === 'none'`
   was inverted, and the composer's render targets had `samples: 0`, so SMAA was running
   on top of a fully aliased render.
4. **The adaptive controller measured the wrong thing** — `performance.now()` around
   `composer.render()`, i.e. CPU submit time, which stays flat on a GPU-bound frame.

## Decision

Make each foundation stage measurable, and keep the measurement in the repository.

- **AA**: MSAA on the composer's scene target (4/2/0 by tier — the canvas cannot provide
  it behind a composer), with the post AA (SMAA/FXAA) last, after the grade. Thin geometry
  keeps a minimum screen thickness so a wire or a rail does not disappear between samples.
- **Shadows**: the sun becomes r186's two-cascade `SunLight`, texel-snapped by the addon.
  Near cascade ~3 cm/texel for contact, far cascade soft by construction (the PCF radius
  is in texels). `shadowRadius`/`shadowFar` replace the removed `shadowsSoft` flag.
- **Ambient occlusion**: a purpose-built depth-fed pass (`packages/render/src/post/ao.ts`)
  with two radii — a tight contact term that grounds a tyre or a boot, and a wider term
  that deepens a corner. `GTAOPass` was dropped: its depth-fed path sampled a depth
  texture the scene never wrote to (the composer's second target is a `clone()`, which
  gets its *own* depth texture, while `RenderPass` draws into `readBuffer`), which measured
  as a pure white AO buffer with a 6% frame-wide wash and 0% at a contact.
- **Tone mapping**: AgX over ACESFilmic (ACES desaturates warm midtones toward the beige
  the review kept flagging and has no shoulder for the lamps), plus a display-space grade
  pass with an S-curve, a highlight shoulder, a cool lift and a cool/warm split tone.
- **Stability**: `setSize` only ever at the top of a frame, zero-size resizes cannot make
  the projection matrix NaN, and a lost WebGL context is recoverable.

## Consequences

Good:

- The claims are checkable: `npm run shots` prints the numbers, and the targets in
  `docs/QUALITY_BAR.md` fail loudly. Measured: 0 of 40 hunted frames black (was 98.3%),
  21 → 56 fps in the same software-rendered harness, ramp-per-edge roughly doubled.
- Every A/B in `shots.ts` is a pair of frames at one frozen pose with the resolution
  *locked* — without the lock, turning an effect off makes the frame cheaper, the
  controller raises the resolution, and the pair differs in sharpness as well as in the
  effect. That produced a phantom "37% darkening" before it was caught.

Costs, accepted knowingly:

- **The AO term is honest but not good enough yet.** The pass detects contact and corner
  occlusion reliably (a wall base darkens deeply and falls to zero by 2 m), but its
  sensitivity to *small* occluders is limited: it can only find occluders that are visible
  and project into the sample's screen footprint, which is a property of screen-space AO
  rather than of this implementation. Measured: a barrel base reads 0–3% darkening at a
  0.7 m contact radius, below the 8% target in `docs/QUALITY_BAR.md`. The term is tuned
  through the *composite* channel only (the pass's own debug view is tone-mapped and
  bloomed, so its pixel values are not linear occlusion and must not be tuned against).
  The target stays in the file as a known gap rather than being quietly lowered.
- Two cascades are tuned for a ~100 m arena; a much larger map would need a third and a
  per-tier split change.
- The probe suite is a real tool with real maintenance cost, and it is not in `npm run
  verify` (it needs a running dev server and a GPU). It is run by hand, on purpose.

## Alternatives rejected

- **`GTAOPass` as shipped.** It reads the wrong depth texture in the depth-fed path, and
  its own G-buffer path is a second full-scene draw of every batched mesh for a term that
  only needs depth. Detailed above; the measurement is in the pass's header comment.
- **Keep GTAO and fix only the normals.** The failure was structural (which buffer is
  sampled), not a tuning problem, and the "6% frame-wide wash, 0% at contact" signature
  says the term was measuring nothing useful.
- **Tune AO against its own debug view.** Rejected after it wasted a cycle: the debug view
  goes through bloom, the tone map and the grade, and AgX compresses so hard that a linear
  occlusion of 0.3 displays as 0.65. Only the composite A/B is linear enough to tune on.
