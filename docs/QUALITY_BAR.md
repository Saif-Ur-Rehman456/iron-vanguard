# Quality bar

The prototype was a good weekend project: impressive for what it was, unshippable as
a game. This file is the line between "a demo" and "something a stranger can play".
It exists so that "is this done?" has an answer that does not depend on the person
asking.

## Definition of done

A change is done when **all** of these hold:

1. `npm run verify` passes (typecheck, lint, content validation, 76+ tests, bench,
   licence audit, both builds, size budget).
2. Any behaviour change is covered by a test that would fail if the behaviour were
   reverted — and for gameplay changes, the golden hash moving is explained.
3. Content changes are data edits, validated at load, with a clear error for a typo.
4. Non-trivial architecture decisions are written down (`docs/decisions/`), and any
   deviation from the prototype is numbered in `legacy/PARITY_NOTES.md`.
5. Nothing was added to `assets/` without a licence row.
6. It was played. Not "the test passes" — actually played with a mouse and keyboard.
   If you cannot play it, say so explicitly instead of implying you did.

## The feel bar (what "AAA" means here)

We cannot out-budget anyone, so the bar is *responsiveness and clarity*:

| Aspect | Bar |
| --- | --- |
| Input latency | look and fire respond on the next tick; no debounce, no queued feel |
| Crosshair | the reticle spread **is** the weapon's real cone (`spreadNow()` drives both) |
| Hit feedback | damage flash, hitmarker (distinct on kill), impact decal, surface-specific audio |
| Telegraphs | every enemy attack has a readable tell before it can hurt you — and breaking line of sight stops it |
| Death | you know what killed you and from where (directional indicator), and why (killcam-free but legible) |
| Mission flow | brief → waves with clear countdown → resupply → extraction → ranked debrief |
| Failure | dying is informative: checkpoint toast, results with waves cleared, one-key restart |

## The polish checklist (M1 vertical slice)

- [x] Boots to a menu that states the mission, controls and difficulty
- [x] Waves with labels/subtitles, a countdown between waves, and resupply
- [x] Three enemy archetypes with distinct silhouettes, colours and audio
- [x] Weapons with spread, recoil, falloff, headshots and reload staging
- [x] Grenades, barrels, chain explosions
- [x] Pickups (medkit, ammo) with lifetime and pickup radius
- [x] Killfeed, banners, compass with objective markers, damage direction
- [x] Settings that persist: sensitivity, invert, volumes, motion scale, quality,
      subtitles, colour-blind crosshair, difficulty
- [x] Pause/resume, K.I.A. and debrief screens
- [x] Pointer-lock fallback for environments that refuse to lock
- [x] Adaptive resolution and four quality tiers
- [x] Deterministic replay with a golden trace
- [x] Headless balance sweeps and a perf gate
- [x] A single-file artifact (`callofduty.html`) that runs offline
- [ ] Real art pass (M2 — Blender pipeline is built and waiting)
- [ ] Waypoint-graph navigation for hostiles (M2 — local steering is in place)
- [ ] Campaign mission 2+ (M3)

Unchecked items are the honest answer to "is it AAA?" — no. It is a coherent,
measurable, well-tested vertical slice with an art pipeline that has not been fed yet.

## Non-negotiables

These are the things this project will not trade away, regardless of feature
pressure:

- **Determinism.** If a feature cannot be made deterministic, it belongs in the
  presentation layer — not in the simulation.
- **Licence cleanliness.** No ripped assets, ever, for any reason. Attribution is
  not a substitute for permission.
- **Measurability.** Every claim about balance or performance has a command behind
  it (`npm run sweep`, `npm run bench:sim`, `npm run budget`).
- **Readability over cleverness.** This codebase is edited by agents and humans in
  short sessions; a construction that needs a diagram to read is a cost paid every
  time someone touches it.

## The visual gate (render changes)

A rendering change is not "done" because it compiles or because a screenshot looked fine
once. Run:

```bash
npm run shots -- --url=http://localhost:5173
```

It captures the menu, spawn, a firefight, mid-mission and the death screen, writes them to
`.captures/`, and prints two numbers per frame:

- **mean luminance / share of pixels below luma 25** — catches black frames, over-opaque
  overlays and blown-out exposure. A frame over 90% black in gameplay is a bug; a frame
  under 90% black *is* how the old damage vignette was found.
- **detail (mean |Laplacian|)** — how much high-frequency structure the frame carries.
  Flat-shaded boxes score low; beveled geometry with normal-mapped relief scores high.
  Compare the number across commits instead of trusting your memory of a screenshot.

The `--hunt=N` flag hammers the frame loop for N captures and reports the worst frame, which
is how a one-frame flash gets caught rather than missed.

### The lighting gate (Phase 02)

```bash
npm run shots -- --probe=lighting
```

Every reading is an A/B pair at a **frozen pose**: the same frame with one group of the rig
switched off and on (`__IV__.setLighting(group, enabled)`), sampled at fixed world points
that should move and control points that should not. It prints, per group, the relative
darkening of each patch and the patch's colour warmth, so both halves of the lighting claim
("cool environment, warm local sources") are numbers:

| Target | min/max | What it proves |
| --- | --- | --- |
| `lighting-lamps_pool` | ≥ 0.30 | a lamp lights its own pavement |
| `lighting-lamps_near3` | ≥ 0.10 | the pool still reaches 3 m |
| `lighting-lamps_falloff` | ≥ 0.15 | the light falls off with distance |
| `lighting-lampsFar_farControl` | ≤ 0.05 | it does not reach 34 m |
| `lighting-lamps_warmthDelta` | ≥ 0.02 | the pool is warmer than the field beside it |
| `lighting-key_litFace` | ≥ 0.35 | the moon key lights the +x facade |
| `lighting-key_shadowFace` | ≤ 0.25 | and leaves the +z facade shadowed |
| `lighting-ambient_shadowFace` | ≥ 0.25 | the ambient is what keeps the shadow side readable |
| `lighting-ambient_litFace` | ≤ 0.35 | the ambient never rivals the key |
| `lighting-windows_wall` | ≥ 0.02 | a lit window warms its own wall |
| `lighting-windows_far6` | ≤ 0.01 | and stops at its own wall |
| `lighting-night_warmthSplit` | ≥ 0.02 | the lamp pool is warmer than the moonlit ground |
| `emitterBright` | ≤ 0.30 | lamps and windows are not blown out (clipped pixels) |
| `shadeDetail` | ≥ 8 | shadowed ground keeps detail |

The rig's *proportions* are also unit-tested without a browser
(`tests/unit/lighting.test.ts`): the moon is cooler than the lamps by a real margin, the
key beats its own ambient on every tier, shadows never reach 1.0, and the bloom threshold
sits above the tone-mapped midtone *and* above the player's own weapon under its view light
(ADR-0019), with the kernel bounded so a pool stays a pool.

**The surface contract** (ADR-0022) is checked without a GPU, because it is arithmetic: a map is a
statement about *where* a surface is glossier than its material, and the material is the value.
three multiplies the two, so a map carrying an absolute roughness is multiplied by an absolute
roughness — the surface's gloss *squared* (car paint 0.34 shaded at 0.12; the view-model receiver
0.56 shaded at 0.235). `tests/unit/roughness.test.ts` holds five facts: the neutral channel is
exactly the material's roughness and not its square; an authored roughness survives at both ends of
the table; a texel can never swing past its class's declaration (clamped, floored at three's
0.0525); the swing round-trips through an 8-bit channel within 1.5/255; and class ordering cannot
invert (sand ≥ asphalt ≥ gunmetal ≥ carPaint ≥ water, asphalt's glossy gap ≥ 0.05). If a surface
looks like a mirror in a frame, this is the first place to look, not the last.

**Occlusion has a number and a measured floor.** A term that darkens a *flat plane* is a term that
is shading noise, so the AO pass is judged on the flattest surface in the build: at the shipped
`bias` 0.25 the flat open road reads **95.6% of unoccluded** (term hf 0.0063), against **93.5% at
the `bias` 0.06 that shipped** — where the false occlusion *was* the speckle in the ninth report's
frame. The live A/B is `__IV__.setAo(true|false, 'frame')`: toggling it must not change the road
(measured: near-ground mean moves 1.3%, hf 0.7%).

**Known gap** (kept visible on purpose): `ao_barrel_ring` needs 8% darkening at a barrel
base and measures 0–3%. The AO pass grounds large contacts and corners, but screen-space AO
can only find an occluder that projects into the sample's footprint, so a 0.4 m drum is at
the edge of what it can see. The fix is a different term, not a bigger radius — see
`docs/ART_BIBLE.md` and ADR-0012. The 0.25 `bias` and the contact ramp were chosen for the road
measurement above, so they narrow this gap **by construction** rather than by evidence: on the current
instrument a barrel base measures ≈0.0–0.26% against 1 m away on both the old and the new settings,
which is below what it can resolve. That is stated here rather than claimed as a fix.

**Known gap** (kept visible on purpose, ADR-0022): the dusk far ground is still near-black — 66% of
one band (rows 240–300 of a 768-row frame) below luma 0.02 while the fog colour `0x39404f` (luma
0.24) is nowhere near it, i.e. the fog does not appear to reach ~60 m. Adding occlusion live raises
that band's sub-0.02 share by 3.5 points, which says the far ground is *under-lit* before the term
reaches it. A number, not a shading complaint; `docs/CAPTURE_REQUEST.md` phase 10.4 is how it gets
closed.

### The rig gate (Phase 03)

A rig change is judged by whether a *man could do it*, stated as arithmetic. Every
requirement below is a unit test, because none of them need a GPU to be measured.

| Requirement | How it is checked |
| --- | --- |
| The view model is a carbine | receiver 12.6–28.4 cm, overall 50–98 cm, no part over 1.6× the weapon's width (`weaponRig.test.ts`) |
| The player aims down the sight | the optic's height equals the camera axis at ADS within 2 mm; the muzzle is 0.50–0.85 m from the eye |
| Both hands hold the weapon | every hand is inside its own arm at every aim blend, 35–99% extended, never past the bone length |
| The soldier holds its weapon | the support grip is within 6 cm of the support arm's reach at the low-ready carry, and the muzzle points at the player (±0.1 in x, ≤ -0.9 in z) when aiming |
| A soldier faces the player | goggles, NVG, pouches, knife, kneepads, toes and holster are `front` (-z); pack and antenna are `back` |
| A soldier is legible at night | every garment is lifted ≥ 1.0× off content, adjacent pairs differ by ≥ 25% luminance, hue within a few degrees, nothing above 2.5× |
| Cloth has a rim | sheen on every garment, cool (`b > r`), maps shared with the library rather than cloned |

**Known gaps** (kept visible on purpose, all three measured rather than assumed):

1. **Soldiers have no elbows.** Their arms are single rigid bones aimed at the weapon, so
the aiming pose leaves the support grip 0.20 m beyond the arm's reach. The support glove
is part of the weapon, which hides it as an overlap — but a *bent elbow* needs the rig
`assets/models/` exists to source, not a code change (ADR-0015).
2. **Facade windows are painted, not emissive.** The building surfaces draw their lit
windows into the albedo (`materials/textures.ts`), so a lit window is a warm rectangle
that neither glows nor blooms; every *other* window in the game (barred ones, kiosk signs)
is a real emitter. The fix is an emissive map channel in the PBR recipe, which is a change
to every building recipe and is deliberately not half-built. `windowGlow` and the
four-light window pool already exist for it.
3. **Most props still tile by their own size.** The floor, roads, kerbs, crate, sandbag,
puddle and banner are on `UV_DENSITY`; barrels, jerseys, planters, wrecks, kiosks,
monuments and the skyline are not yet. Their density is therefore still a function of how
big someone made the prop, which is the defect ADR-0014 fixed for the ones that matter
most in frame.

## Phase 06 targets

| Claim | How it is checked |
| --- | --- |
| Every tier renders at the display's own pixel count | `tests/unit/quality.test.ts` (`pixelRatioCap >= 2`); `renderDebug().drawingBuffer` vs `pixelRatio` |
| A tier's effects are one stated table | `tests/unit/quality.test.ts` (EXPECTED), mirrored by `docs/PERF_BUDGET.md` and the settings copy |
| The frame's whole-buffer pass count per tier | `tests/unit/quality.test.ts` (`fullResPasses` 4/4/6/6); `renderDebug().fullResPasses` |
| No world surface is below its density floor | `tests/unit/texel.test.ts` (`UV_PIXELS / UV_DENSITY`, per class) |
| A wall is denser than 2.5 mm per texel, and the weapon beats the world | `tests/unit/texel.test.ts` |
| The frame fits the budget before resolution is traded | `tests/unit/quality.test.ts` cost ceilings; `window.__IV__.renderDebug()` pass list |
| One multisampled target, and it is the scene target | `renderDebug().msaaSamplesTarget` + `passes` |
| A building's texture is the same physical size on every face | `tests/unit/texel.test.ts` (`boxUvMetres`, all six faces) |
| A pistol is pistol-sized and a rifle is rifle-sized | `tests/unit/weaponRig.test.ts`, per archetype |
| The two atmospheres are two pictures | `tests/unit/timeOfDay.test.ts` (key direction, warmth, artificial sources, haze, exposure) |
| The loadout is three weapons and a swap is a swap | `tests/unit/loadout.test.ts` |
| Everything above is present *and looks right* | `docs/CAPTURE_REQUEST.md` phase 05 — not automatable here |
| The hands and the AK read as intended | `docs/CAPTURE_REQUEST.md` 4.4 and 4.6 |

## Phase 09 targets — the geometry gate

The eighth report's eighteen items are about *shapes* (ADR-0021), and four of them are arithmetic
rather than art direction — which is also how the previous pass's own geometry defects were found:

| Claim | How it is checked |
| --- | --- |
| A bevel never melts a small part | `tests/unit/detail.test.ts`: never more than 12% of the part's smallest dimension, never past a third, and monotone in both the part and the request |
| The bevel rule is the one the workhorse uses | `detail.test.ts`: `roundedBox` gives a 60 mm part and a 600 mm one different geometry |
| Detail follows importance, not a constant | `detail.test.ts`: hero ≥ mid ≥ far in segments, `far` builds no secondary forms, every tier states what it is for |
| A tier bevel scales inside the tier | `detail.test.ts`: `tierBevel('hero', 0.02)` is below the tier's ceiling and never a capsule |
| A window is an opening, not a plate | `detail.test.ts`: the pane is behind its frame by ≥ 100 mm, the lintel and sill cap rather than cover it, the frame is seated in the wall |
| Dirt hugs what it is on | `capture 9.4`/`9.5` — a band's offset is a frame's judgement, and the two artifacts this pass fixed were exactly this |
| A street is not cast in one piece | `capture 9.3`/`9.5`: a kerb with 10 segments and 1-in-6 broken, barriers with 1-in-3 spalled |
| The geometry is *built*, not placed | `capture 9.1`/`9.6`: an entrance with a canopy, a service grille, a balcony; a monument with an apron and bollards |
| The cost is stated | `__IV__.renderer()` (draw calls, triangles) + the in-app overlay's budget |

## Phase 08 targets — the material gate

The seventh review was eighteen items and one cause (ADR-0020), so the gate is a table of
material *properties* rather than of looks. Every row is a unit test, and every one of them was
written from a defect rather than from taste:

| Claim | How it is checked |
| --- | --- |
| Nothing is 35% metal | `tests/unit/surfaces.test.ts`: every class is `0` or `≥ 0.9` |
| A coating declares its substrate | `surfaces.test.ts`: a `coating` class is exactly 1.0 and the map carries the paint |
| Roughness spends the real range | `surfaces.test.ts`: the table spans matte to mirror and the smooth half is not empty |
| No two classes collapse into each other | `surfaces.test.ts`, plus a named list of the pairs the frames confused |
| Every surface has a large-scale story | `surfaces.test.ts`: macro + mid ≥ 0.8 for the outdoor families, and car paint is the least-grained class |
| A wet surface is glossier, a dusty one duller | `surfaces.test.ts`: the wet target is approached from above, so water does not move and sand is transformed |
| The two hours leave different surfaces | `surfaces.test.ts` (both presets declare a distinct weather) + `timeOfDay.test.ts` |
| Weathering cannot drift the world | `surfaces.test.ts`: applying an hour twice equals applying it once, and a dry clean hour restores the library |
| The weather reaches every class it claims | `surfaces.test.ts`: `WEATHERED_MATERIALS` covers `WEATHERED_CLASSES`, and an unlit lens is untouched |
| Dirt is placed, not tiled | `capture 8.3`/`8.4` (contact grime, arch spray, wall-foot dirt) — placement is a frame's judgement |
| A sand map draws sand | `tests/unit/world.test.ts`: `groundMaterialFor('sand')` is the sand material |
| The weapon is not one dark value | `tests/unit/weaponMaterials.test.ts`: the four hard-surface groups differ in response (not only in colour), and the hands take the sky the metals gave up |
| Repetition is broken without more art | `surfaces.test.ts` (`shiftUv` offsets and leaves `uv1` alone) + capture 8.2/8.5 |
| The pass's claims are measurable | `__IV__.materials()` — both hours' weather and every weathered material's live numbers |
| The materials *read* as different substances | `docs/CAPTURE_REQUEST.md` phase 08 — the one thing a table cannot assert |
