# ADR-0013 — The night is cool, the lamps are warm, and both are measured

- Status: accepted (Phase 02, lighting)
- Supersedes nothing. Extends ADR-0012 (rendering foundation) and ADR-0006 (parity as a
  target) — the moon key is a deliberate deviation from the prototype's sunset, recorded
  in `legacy/PARITY_NOTES.md`.

## Context

The Phase 02 review listed fourteen problems; they reduce to one: **every light in the
scene was the same light.** Concretely, in the code:

- The key was a *sunset*: `0xffd9a0` at 4.6 lux and 47° elevation, with a warm beige sky
  dome, a warm horizon gradient and warm fog. Sand, concrete, cars and characters therefore
  arrived at the same warm value, and no material could separate from another.
- The **lamp lights were 25× too dim to see**. `PointLight(0xffb066, 12, 26, 2)` with
  physical (inverse-square) falloff gives 12/5.4² ≈ **0.4 lux** on the pavement 5.4 m
  below it — less than a quarter of the sun. The lamps were objects with a glow sprite:
  exactly what the review described.
- Windows were a dark material behind bars with no light of any kind, so a lit window and
  an unlit one were the same pixel.
- Bloom ran at a 0.85 threshold, which is below the tone-mapped value of a lamp lens, so
  every emitter bloomed into a flat white disc.

## Decision

Split the rig into three roles with different *colour and distribution*, then measure each
one with an A/B capture.

- **Moon key** (`MOON_POSITION`, `LIGHTING.moonColor`): cool (`0xbdd0f0`), intensity from
  the quality tier (1.6–2.2), and **lower** than the prototype's sun — 33° elevation
  instead of 47°, same azimuth. A high key lights every roof equally and flattens the
  street; a lower one throws long shadow lines across it, which is the "lighting reveals
  form" requirement. It is the only shadow caster.
- **Broad ambient**: a hemisphere with a cool sky half (`0x59709f`) and a warm sand-bounce
  ground half (`0x6a5636`), kept well under the key on every tier (asserted in
  `tests/unit/lighting.test.ts`: `keyIntensity > ambientIntensity * 2`). Below the key, so
  it fills the shadow side and gives it edge detail without turning black objects grey.
- **Image-based reflections**: the PMREM cubemap of the night sky, `environmentIntensity`
  per tier. On this budget **the bounce is the sky** — one cubemap rather than a second
  bounce pass — and per-material `envMapIntensity` decides who reflects how much (dark
  technical materials were raised to 0.85–0.95, so black polymer keeps a cool sheen).
- **Local sources**: one real `PointLight` per lamp prop with true inverse-square falloff,
  intensities and ranges varied *deterministically* per lamp (a 300 cd street lamp pools
  ~10 lux on its own pavement, about five times the moon), plus a small pool of window
  lights that snaps to the nearest lit windows each frame. Every window stays emissive at
  every tier; the budget only decides how many get a light that shades geometry.
- **Highlight guard**: bloom threshold per tier (0.88–0.95) so only emitters bloom, a
  highlight shoulder in the grade, exposure trimmed 1.35 → 1.24 to leave the emitters room,
  and a muzzle flash that is short (40 ms), local (range 9–12 m) and dimmer than it was.
- **Controlled fill**: `shadowIntensity` 0.84–0.92 (never 1) plus the cool lift in the
  grade, so shadowed geometry reads as dark-with-detail rather than black-with-nothing.

## Consequences

Good:

- The seven behaviours are testable without a GPU: the colours and the key/ambient
  relationship are unit-tested, and `npm run shots --probe=lighting` A/Bs each group
  (`key`, `ambient`, `lamps`, `windows`, `reflections`) at fixed world points with the
  resolution locked, so "the lamp lights its pavement" is a number.
- A lamp is now ~5× the moon on the pavement and stops mattering inside its own range.
  The falloff, the warmth difference and the spill controls all have targets in
  `docs/QUALITY_BAR.md`.
- Nothing about the simulation changed: the golden replay is byte-identical, and no content
  data was touched — every light is derived from what the map already declared.

Costs, accepted knowingly:

- **More lights, so more shader work.** Four lamp lights + four window lights + key +
  ambient + fire + muzzle + boom is 13 lights in a forward renderer; `docs/PERF_BUDGET.md`
  now carries the counts and the cheapest fix (drop the window budget first).
- The night is darker than the prototype by construction. Where the review wants "dark
  areas keep detail", the answer is the ambient floor and the grade lift, not a brighter
  key — and the two have to be re-tuned together or the scene flattens again.
- Deterministic per-lamp variation is *stable* but not authored: the same lamp is the same
  brightness every run, and changing the light rig means the lamps re-roll.

## Alternatives rejected

- **Brighten the existing warm sun and call it done.** Rejected: the review's first
  complaint was colour variety, which no amount of intensity fixes, and a warm key cannot
  produce the "warm pool inside a cool field" contrast the night setting needs.
- **Keep the sunset sky and light only with lamps.** Rejected: the sky is the ambient, the
  reflections *and* the background; a warm sky makes every material warm no matter what the
  lights do.
- **Spot lights for the lamps.** Rejected for now: the head is a wide lens, not a beam, and
  a cone would need per-lamp targeting plus shadow-map budget for no visible gain at the
  distances the plaza is played at. Point lights with physical falloff are the honest
  model.
- **A single warm fill light for the whole scene.** Rejected — that is the failure mode
  being fixed: one light means one value range, no matter what colour it is.
