# ADR-0016 — The frame budget is a contract, and blur is a symptom

Status: accepted (realism pass, third review)

## Context

The second review of the graphics settings said, in the same sentence, "the game is
laggy" and "everything is blurry, at every graphics level". Those are not two
complaints. They are one, and this repository had already written the mechanism down
without noticing what it implied.

`AdaptiveResolution` (quality.ts) has exactly one lever: resolution. Given a frame that
costs 22 ms against a 16.7 ms target, it steps the scale down — to 0.85, then to its
floor — and the frame still costs 18 ms. The player is handed a *softer* picture and no
frame rate. ADR-0014's own rule is that "if a machine cannot afford the look, the
adaptive controller reduces resolution", and that rule is only true when the frame is
already near budget. When it is not, the resolution trade is a tax that buys nothing.

So the review's frames showed both halves of the same failure: an image at 0.8-0.9 of
native resolution (soft, low-contrast, textures reading as haze) *and* a machine that
could not hold 60 fps there.

## Decision

**A tier's cost fields are a budget with a ceiling, and the frame must fit inside 16.7 ms
before resolution is allowed to be the trade.** Where the millisecond was going, and what
changed:

### 1. MSAA belongs to geometry, and only the scene pass has any

`EffectComposer` clones the scene render target for its write buffer, so the graph was:

```
scene target (MSAA 4, half-float)   ← geometry: MSAA is correct here
write buffer (MSAA 4, half-float)   ← bloom composite, grade, sharpen, SMAA x3
```

Every fullscreen pass rendered into a 4x multisampled half-float target and resolved out
of it. MSAA antialiases *geometry silhouettes*; a fullscreen pass has no geometry for it
to antialias, so all it bought was a resolve per pass at the full drawing-buffer size.
`buildComposer` now sets `renderTarget2.samples = 0` (with the `dispose()` that makes
three reallocate the framebuffer). This is the single largest change in the pass.

### 2. A tier's MSAA budget is 2, not 4

SMAA runs after the grade on every tier regardless, so the third and fourth samples were
edge quality nobody could see, at double the bandwidth of the second. `cinematic` keeps 4.

### 3. AO sample counts came down; the radii did not

The two radii *are* the term — a tight contact radius grounds a barrel, a wide one
deepens a corner. The sample count is noise, and the bilateral blur removes it anyway.
`high` went 8 → 6, `cinematic` 10 → 8.

### 4. The sun's shadow atlas is the largest single allocation in the frame

2048² over a 95 m cascade reach is 4.6 cm per texel, which the PCF radius then blurs back
to a gradient. `high` is 1024² over 70 m: *finer per texel* and a quarter of the depth
fill. `cinematic` keeps 2048².

### 5. Lights are per-fragment, not per-lamp

Eight real lamp lights means eight lights evaluated for every fragment of every material
in the frame. `high` is 3 (`cinematic` 4); the emissive lamp props and the window panes
are still lit at every tier, and they are free.

### 6. Resolution floors went *up*, and the sharpen is conditional

`low`/`medium`/`high` floors are 0.9 and `cinematic` is 1.0 — a machine still over budget
at 0.9 needs a cheaper frame, not a smaller one. And because a browser bilinear upscale
does not merely lose pixels but removes the micro-contrast of the ones that remain,
`post/sharpen.ts` puts that contrast back — **only** below `SHARPEN_BELOW_SCALE` (0.99),
because sharpening an already-native frame is how a renderer grows a halo on every
high-contrast edge. The pass costs five taps and is off whenever it is not needed.

## The second defect this pass found: a wall's texture was one rectangle of noise

The arena had two density paths. Props authored UVs in metres (`uvMetres`); a building
shell did not author them at all, so a `BoxGeometry`'s 0..1 UV square was stretched over
a 20 x 12 x 18 m block — the plaster was one smear of grain at
four different densities on four faces of the same building, and the "lit windows" were
rows of orange rectangles baked into the albedo, stretched to whatever the wall happened
to be.

Two fixes:

1. `geometry.boxUvMetres(width, height, depth, metresPerTile)` authors each of the six
   faces from its own two dimensions, so a wall's texture agrees with the wall next to it
   however the two are proportioned.
2. The facade texture is one *storey* per tile (it claimed that before and did not do
   it), and windows are **geometry** — a proud reveal, a pane 5 cm behind it that is
   either dark glass or `windowGlow`, and a sill below it (`arena.buildWindowRow`). A lit
   window is now a source that can be occluded and can glow, rather than a painted
   colour, and it registers the anchor the window-light pool snaps to.

The wall albedo's grain and spalling amplitudes also came down: small high-contrast dots
on a 3 m tile are noise at 4 m, not damage, and they were a large part of why the review
described the buildings as "blurry".

## Third: the first-person weapon was a silhouette in its own scene

A weapon is 40-60 cm from the eye, inside a night rig lit by a moon three hundred times
further away than the object it is meant to reveal. Measured against the world rig, the
receiver, both gloves and both sleeves were one black shape — the review's "there are no
hands" report, which was a lighting bug wearing a modelling bug's clothes.

The renderer now owns a **view-model key light**: a 1.2 cd point light with 2 m of reach,
attached to the camera, above and right of the receiver. At 0.45 m it is ~6 lux, a stop
under the moonlight that falls on the street beyond it — a fill, not a lamp — and 2 m of
`distance` is what keeps it off the rest of the frame.

## Fourth: a second moon, and a sky that could only be night

`createMoonSprite` was called twice into the same scene, so the moon disc was drawn at
double brightness (visible in the review's frames as a large white blob). It is called
once now, by the rig that owns the sky.

And the sky itself was a module-level cache of one gradient with a moon, lamps and stars
wired to it: the morning scene the prototype had was not *disabled*, it did not exist.
`level/timeOfDay.ts` states the atmosphere as data — sky gradient, key direction/colour/
strength, ambient colours, haze, exposure, reflection scale, which artificial sources are
on, and the emissive prop colours — and `GameRenderer.setTimeOfDay` swaps it in place.
Two presets ship (`dawn`, `dusk`), the player picks one before deploying, and it persists.

## Fifth: the loadout, and why the golden hash did not move

The review asked for three weapons — a Desert Eagle, the M4 and an AK-47 — selected with
1/2/3, and for them to work. That is a simulation change, so it is an *action*
(`weapon1..3`), applied in the actions step of the canonical tick order rather than as a
new system (AGENTS.md invariant 2), and the loadout lives in content
(`LOADOUT`/`DEFAULT_SLOT`) with one ammo runtime per slot in `PlayerState`. Nothing new
is hashed: slot 2 is the M4 with the same magazine and the same parity 240-round reserve
it always had, so a replay that never presses 1 or 3 is byte-identical — verified with
`npm run replay` at every step.

A weapon is what the existing systems read (`world.weaponDef`, `p.weapon`), so damage,
headshot multiplier, spread, recoil, falloff, mag size, reload time, fire mode and audio
all change with it. Swapping cancels a reload, clears barrel heat, and locks fire for the
weapon's own `equipSeconds` — a counter (`equipTicks`) decremented by `updatePlayer`,
which is the one system that already runs before the actions.

## Consequences

- `tests/unit/quality.test.ts` now carries a **cost ceiling table** (MSAA, shadow map,
  shadow reach, AO samples, light budgets, particles) and the 0.9 floor. A budget that
  exists only in prose is a budget that gets spent again.
- `tests/unit/timeOfDay.test.ts` proves the two atmospheres are two pictures: different
  key direction (dot < 0.3), warm-versus-cool key, lamps/windows/stars off in the
  morning, thinner brighter haze, lower exposure, stronger reflection.
- `tests/unit/loadout.test.ts` proves the loadout: three weapons, per-weapon ammunition,
  behaviour read from the weapon in hand, the equip lockout, the cancelled reload, and
  that an unknown slot is a no-op rather than an exception.
- `tests/unit/weaponRig.test.ts` is archetype-aware. It previously asserted "a carbine is
  80-90 cm overall" against *every* weapon in content, which is a test that rejects a
  correct pistol; the ranges are now per archetype, and a pistol's inverted hip hold (its
  low-ready is nearer the body than its presentation) is asserted explicitly.
- The visual half of all of this is in `docs/CAPTURE_REQUEST.md` phase 04. Nothing in
  this repository can measure the user's frame rate, so the frame rate is the one claim
  that has to be checked on the machine that reported it.
