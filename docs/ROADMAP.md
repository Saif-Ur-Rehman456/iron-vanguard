# Roadmap

Where the project is, where it is going, and what each milestone is allowed to assume.
Dates are deliberately absent: this is a solo, agent-driven project, and a date that
nobody believes is worse than no date.

## Status at a glance

| Milestone | State | Exit condition |
| --- | --- | --- |
| **M0** scaffold & guardrails | **done** | `npm run verify` green on a fresh clone |
| **M1** vertical slice | **done** | one mission playable end to end, deterministic, measured, shareable as one file |
| **M2** art & navigation | next | real Blender art on the plaza, waypoint navigation for hostiles |
| **M3** campaign & audio | planned | 3 missions, recorded audio, squad tactics |
| **M4** polish & release | planned | netcode-free release build, accessibility pass, storefront-ready |

## M0 — Scaffold and guardrails (done)

The point of M0 was never code: it was making every later change *cheap and safe*. What
landed:

- monorepo with dependency-cruiser-style boundaries enforced by lint (`sim`/`core`
  cannot touch DOM, `three`, `Math.random` or Node built-ins);
- strict TypeScript everywhere, no framework in the simulation;
- content as validated data (`zod` + cross-reference checks);
- Vitest for unit/integration/golden, Playwright for e2e, both in CI;
- the licence ledger and its audit gate;
- the six real bugs found by the first test pass (`AGENTS.md`), including two that made
  promised mechanics impossible.

Exit condition met: `npm run verify` runs typecheck → lint → content validation → tests →
sim bench → licence audit → both builds → size budget, and passes.

## M1 — Vertical slice (done)

One mission, `m00_prologue`, on `plaza_alpha`, played start to finish:

- five waves across three archetypes, with telegraphs, resupply and intermissions;
- objectives that sequence brief → survive → extraction → ranked debrief (a deliberate
  deviation from the prototype, which ended the instant wave 5 was cleared);
- weapons with spread, recoil, falloff, headshots (which did not work before the fix),
  reload staging, grenades and chain-exploding barrels;
- deterministic simulation with a golden replay trace, headless sweeps and a perf gate;
- four quality tiers with adaptive resolution, and a `callofduty.html` single-file build;
- HUD, pause/results screens, persisted settings, pointer-lock fallback.

**Known gaps carried into M2** (all documented, none hidden):

| Gap | Where it is acknowledged |
| --- | --- |
| procedural art only — no modelled props or characters | `docs/QUALITY_BAR.md`, `docs/ART_BIBLE.md`, ADR-0011 |
| character animation is procedural; a GLB enemy does not walk | `assets/models/README.md`, recipe 21 |
| hostiles use local steering, not navigation | `AGENTS.md` bug #4, recipe 05 |
| synthesised audio only | `docs/decisions/0010-synthesised-audio-baseline.md` |
| one mission, two weapons unused by the mission | `docs/BALANCE.md` |
| no bullets-as-projectiles for any weapon | `content/weapons.ts` (`projectile: false`) |

## M2 — Art and navigation (in progress)

Landed so far: **the realism pass** (ADR-0011). The look moved from scaled boxes to
manufactured objects *without* shipping a single binary — procedural PBR surfaces derived
from one height field, beveled/lathed/extruded geometry, image-based lighting from the
procedural sky, GPU-batched statics and point-cloud particles to pay for the extra
detail, and a licensed-model slot table (`assets/models/`) for the parts that code cannot
reach. `npm run shots` captures the evidence; `docs/PERF_BUDGET.md` carries the measured
numbers and the draw-call model.

Also landed: **the rendering foundation and the lighting rig** (ADR-0012, ADR-0013) —
MSAA on the scene target with post AA, real soft shadows (the removed
`PCFSoftShadowMap` flag replaced by shadow radius/distance over r186's two-cascade
`SunLight`), a purpose-built depth-fed AO pass with one documented gap, AgX + a
film-grade look pass, and a lighting rig split into a cool moon key, a broad
cool/warm ambient, reflected sky, per-lamp point lights with physical falloff, a
window-light pool and a controlled muzzle flash. Evidence: `npm run shots --probe=lighting`
(the A/B per group, with targets in `docs/QUALITY_BAR.md`) plus
`tests/unit/lighting.test.ts`; the manual capture list is `docs/CAPTURE_REQUEST.md`.

Also landed: **the Phase 03 realism pass** (ADR-0014, ADR-0015) — the first-person weapon
and the soldiers are rigs with solved poses and unit-tested invariants (a 21 cm receiver
with the sight line on the camera axis, two hands on every weapon, a soldier whose kit is on
the side it faces and whose uniform is a value ladder rather than a black cut-out), quality
tiers that trade resolution instead of art direction, and texel density stated per surface
rather than falling out of each mesh's size. Static evidence is in
`tests/unit/{weaponRig,uniform,quality,texel,world}.test.ts`; the manual ask is the Phase 03
section of `docs/CAPTURE_REQUEST.md`.

Still open in M2: authored art through the Blender pipeline, skinned animation for
characters, and navigation.

1. **Feed the pipeline.** Author the plaza kit (`assets_src/blender/kit_plaza.blend`),
   one prop family, the M4 and the hostile. Every asset goes through
   `kit_batch.py` and the ledger. Success is *reproducible* art, not maximum
   fidelity: a fresh clone plus `npm run assets:pipeline` reproduces `assets/`.
2. **Waypoint navigation.** Replace local steering with a navmesh or a waypoint graph
   generated from map data (the collision world already exposes footprints). This
   removes the stalled-wave class of bug entirely and lets maps have real interiors.
3. **Mesh-accurate hit tests.** Swap the AABB provider for a `three-mesh-bvh` provider
   behind the existing `CollisionWorld` interface (ADR-0001), so the simulation keeps
   its contract and the golden hash records the change honestly.
4. **Animation.** Retarget Mixamo clips (recipe 11) onto Blender-authored characters;
   keep the simulation as the owner of position.
5. **Re-baseline the budgets** with the first non-procedural build, and record the
   measurements in `docs/PERF_BUDGET.md`.

Exit condition: the mission plays with real art and no hostile can be stalled by
geometry — proven by a sweep with zero incomplete seeds and a re-recorded golden.

## M3 — Campaign and audio (planned)

1. **Mission 2 and 3** on two new maps, each with a distinct objective shape
   (an interior assault, a defence/extraction). The objective kinds are in place.
2. **Weapon progression** — the two unused weapons become mission starting weapons,
   with the data already in `content/weapons.ts`.
3. **Squad tactics** — the `tactics` tags on enemy data (hold/advance/suppress/rush/
   flank/anchor) become real behaviour, so a wave is a formation rather than a crowd.
4. **Recorded audio** — swap the synth cues for recordings behind the same cue ids
   (ADR-0010), with ledger rows for every file.
5. **Campaign shell** — mission select, difficulty persistence, between-mission
   progression. This is the first UI work that is not HUD.

Exit condition: three missions, played in sequence, with no shared-state leaks between
them (each mission is a fresh `World` — verify with a determinism test).

## M4 — Polish and release (planned)

1. **Accessibility:** remappable controls, subtitle coverage for all barks, a colour
   blind mode beyond the crosshair, FOV/sensitivity ranges verified against the
   options screen.
2. **Difficulty honesty:** a public table of what each tier changes, generated from
   `DIFFICULTIES` rather than hand-written.
3. **Release build:** the single-file artifact and the product build, both signed off
   by `npm run verify` on a clean checkout; a placeholder page that hosts them.
4. **Post-launch loop:** replay sharing (the deterministic seed plus command log is
   already the input format), and a bug-report path that starts from a seed.

Exit condition: a stranger can open one file, play the campaign, and report a bug with
a reproducible seed.

## Things deliberately not on the roadmap

- **Multiplayer.** Commands are the sole input path, so it is *possible* — but the
  project is a campaign shooter, and half-built netcode is worse than none
  (ADR-0002 discussion).
- **A general-purpose editor.** `apps/editor` edits `MapDef` data. Extending it into a
  scriptable content tool is a project in itself.
- **An asset store / modding API.** Attractive, and impossible to support before the
  content pipeline is stable.

## How to change this file

The roadmap changes when a milestone's **exit condition** changes, or when something in
the "deliberately not" list becomes real. New *tasks* go in `docs/TASKS.md`; new
*decisions* go in `docs/decisions/`. A roadmap edit without a corresponding change to
one of those two files is usually a wish, not a plan.

## Review 3 — the frame budget, the second atmosphere and the loadout (done)

The third review ("laggy and blurry at every graphics level", plus hands, three weapons and
the morning scene) is recorded in **ADR-0016**. Its shape: the post chain now has exactly one
multisampled target, a tier's cost ceilings are enforced by a test, resolution is only traded
once the frame fits 16.7 ms, an upscaled frame is sharpened back, buildings author per-face
UVs and real window geometry, the view model has its own light, the atmosphere is a data
table with two presets chosen before deploying, and the squad carries three weapons on 1/2/3
— as a recorded action, so the golden trace did not move.

The two items left open are the two only the machine that reported the problem can answer:
the frame rate at the tier that machine plays on, and whether the hands and the AK read the
way they are meant to (`docs/CAPTURE_REQUEST.md` phase 04).

## Review 4 — pixels are not a tier (done)

The fourth review was the same two symptoms for the third time, which is what made it
useful: the frame budget was not the remaining problem, the *pixel count* was. Every tier
owned a different `pixelRatioCap` (1.0 / 1.25 / 1.75 / 2.0) and the adaptive controller could
scale below it, so the setting a player reached for when the game was slow made the picture
softer on every display and softer still on a HiDPI one — "blurry at every graphics level"
was literally true. **ADR-0017** splits the trade: pixels are invariant (native at every
tier, on any panel) and a tier buys effects. It also deletes a whole-buffer pass, sets the
facade's texel density at 2.3 mm (from 9.8 mm) with the density itself now asserted in tests,
thins the haze and doubles the view-model light.

The exit condition for the review is in `docs/CAPTURE_REQUEST.md` phase 05: one
`renderDebug()` object that shows the drawing buffer equal to the display's pixels at every
tier, and one frame each of a wall at arm's length and the plaza's far end.

## Review 5 — the sight picture, the weapons and the walk (done)

The fifth review was six asks in three sentences and every one of them turned out to be
arithmetic rather than art direction: the black scope was three pieces of geometry standing on
the sight line — one of them a capped cylinder's rear cap 12 cm from the eye; the "tiny,
incomplete pistol with no hands" was a rifle's hip hold on a 27 cm weapon, 0.31 m down on a 75°
camera, which put the whole gun *below the bottom of the frame*; and the "robotic" walk was
`sin(phase) * 0.8` per leg, a rigid leg that lifts its own foot 10 cm and never corrects for
it. **ADR-0018** makes the layout per archetype (`carbine`/`ak`/`pistol`), the ADS pose a solve
from the optic, the stance simulation state (`playerEyeHeight`, with `C` crouch and `Space`
jump behind keys that previously did nothing) and the walk a solved chain whose cadence follows
ground speed.

Its exit condition is `docs/CAPTURE_REQUEST.md` phase 06: one frame that shows the world
*through* the optic, one pistol and one AK in the hand, and a stride sheet.

## Review 6 — controlled highlights and a real optic (done)

The sixth review came with the first frames that were *measurements*: a weapon whose highlights
had clipped and then bloomed across the scene, and an optic 39% of the frame's height with a grey
wash inside it. Both failures were two numbers that had never been multiplied together. The
view-model light sat at 2.6 cd — **17 lux** on a receiver 40 cm away against a 2.6-lux moon key,
with a specular lobe narrow enough to collect it into a highlight past 1.0 — so the weapon was the
brightest thing in every frame and bloom spread it over the scene. And the optic's apparent size
is `2 atan(radius / distance) / fov`: at 55° and 12 cm of eye relief a 46 mm housing is 39% of
the frame, its two lenses were a 30% veil with a mirror sheen on top, and its reticle was a 12 mm
disc. **ADR-0019** bounds the light by the scene it sits in, moves the highlight into the
surface, tightens the bloom kernel, puts the optic at 17 cm with a 2 mm rim and glass you can see
through, replaces the reticle with a 2.4 mm dot in a 5.2 mm ring on the optic's own axis, and
holds the reticle *on* the point of aim while the weapon kicks. The exposure and the tone curve
are untouched: a complaint about an object 40 cm from the camera is not fixed by darkening the
plaza.

Its exit condition is `docs/CAPTURE_REQUEST.md` phase 07: one frame of the weapon that was
glowing, one sight picture, the reticle on a dark *and* a pale background, and a full-magazine
burst with the optic up.

The seventh review was eighteen items long and arrived with two ordinary frames of the plaza — a
car and a patch of ground — and it was the most *diagnosable* report so far, because every item
resolved to the same cause. Materials were "different colours of the same response": what a
surface *is* lived in three places at once (the recipe, the call site, and the material), so the
road, the sand, the concrete, the car, the walls and the weapon all answered light the same way,
and the two frames made it obvious where that fails — a car body wearing a stippled polymer map
(3,400 px/m of grain, no panels), glass with no geometry behind it, a road of fifty identical
tiles, nine buildings made of three walls that all start at the same corner of the same map.
**ADR-0020** gives a surface one physical identity (`SURFACE_SPEC`: family, roughness and how it
moves, metalness and how it is read, environment, and the three storytelling scales), makes a
material a variant of a class, makes the hour part of the material (a dry dusty 0620 versus a
damp 0437, applied idempotently so a settings visit cannot dull the world), and breaks repetition
by *placement* — road-edge sand as the road/ground transition, repairs, burn marks, contact grime,
wall-foot dirt, a UV window per building — rather than by shipping more art. The point of the
whole pass is one line of the report: "texture ko zyada detailed nahi banana — material ko zyada
believable banana hai."

Its exit condition is `docs/CAPTURE_REQUEST.md` phase 08, and `__IV__.materials()` reports the
live numbers those frames are about.

PHASE 04 of the same report is the follow-up it needed, and it is about *shapes*: material can make
a surface believable and no material can make a box read as architecture. Reviewing the previous
pass for exactly that turned up four defects it had introduced — a grime belt floating clear of
every building, a car's dirt sized twice the car's width, a bevel rule that melted any part under
about 20 cm into a lozenge, and a window whose glass stood 9 cm *in front of* its own frame. The
shapes themselves divide into construction (a building is its attached forms, a window is a reveal,
a car is panels and hardware), edges (a bevel is a 12% share of the part, not a third of it) and
*where detail is spent* (an asset-importance budget: hero, mid, far). **ADR-0021** makes all three
into rules a test can hold — `bevelFor`, `DETAIL`, `windowConstruction` — and breaks the procedural
repetition with placement rather than polygons: kerbs in ten segments with one in six broken, a
grime gutter, barriers with a profile off the RNG and a spalled corner, sand drifted around the
sandbag stacks, and a monument with an apron and a ring of bollards.

Its exit condition is `docs/CAPTURE_REQUEST.md` phase 09, and the cost of every triangle it added is
reported by `__IV__.renderer()`.

## Review 7 — the lighting everywhere, and the ground (done, ADR-0022)

The ninth report has two complaints and one frame between them: *"ya aesa kyon hai lighting ise fix
karo totally har jagah se"*, and — pointing at a road that is near-black, speckled like television
static and stitched with bright glints — *"2nd image mein zameen kaise hai is ke tamam problems
analyze karo"*. The instinct is to reach for the rig (ADR-0013) or the art direction. Both would
have been wrong: **the rig was working**, and the frame was five arithmetic defects in the material
and post pipeline.

Four of the five are the *same* mistake in four places — a number authored in one unit used in
another. three multiplies `material.roughness` by the roughness map's green channel, and this
build's map had the absolute roughness baked in, so every surface shaded at its own gloss
**squared**: car paint 0.34 → 0.12, water 0.06 → 0.004, and the view-model receiver 0.56 → 0.235 —
a mirror, which silently undid ADR-0019's whole view-light fix (a 1.1 cd light at 0.56 roughness was
being fed a 0.235 surface). The metalness map was double-applied the same way. The map is a signed
*swing* now and the material is the value, which is the division of labour glTF intends and three
cannot express through multiplication alone.

The other three are in the ground itself. The SSAO pass was darkening **the flattest surface in the
build** — its own debug output read 0.80 of unoccluded on a flat road at `bias 0.06`, and that
false occlusion *is* the speckle in the report's image — and its bilateral denoise was a **no-op**
where it was needed, because a range tolerance derived from world distance collapses on a grazing
plane: the AO buffer was byte-identical with the blur on and off. And the road drew its aggregate
**smaller than a texel** — 7,000 relief-embossed stones at 5.9 mm per texel over albedo 0.027 — a
field of miniature mirrors on the surface that fills the bottom half of every frame.

Measured on the report's own pose: ground mean 0.1473 → 0.2474, high-frequency energy 0.0285 →
0.0110, glints 0.0597 → 0.0113, sub-0.02 pixels 20.7% → 3.5%. Its exit condition is
`docs/CAPTURE_REQUEST.md` phase 10 — and **phase 10.4 is the part that is still wrong**, recorded
with a number rather than smoothed over: the dusk far ground is still near-black, 66% of one band
below luma 0.02 while the fog colour is nowhere near it, i.e. the fog does not appear to reach ~60 m.

---

## Review 8 — the hand, the arm and the enemy (in progress, ADR-0023)

The standing loop's first item: *"our own hand and arm are still not realistic, their shapes are not
real"*, and *"the enemies' models are rubbish shapes — use real ones"*.

**Done.** One hand, built from adult anthropometry, in `characters/hand.ts` — and the two numbers it
replaced were guesses. A bar held in a fist is tangent to the proximal and the middle phalanx at
once, so its axis is *solved* where those two lines cross; and how far each finger closes is
*solved* to put that fingertip on the bar's surface. Measured: a little finger closes at 0.87 on a
19 mm grip and 0.93 on a 30 mm one, the middle at 0.94 and 0.97, and every fingertip lands within
0.1 mm of the surface at every radius the game holds. The thumb is a two-bone IK onto the point
diametrically opposite the fingertips, because opposition is an angle and hand-tuned ratios could
not express it (64 mm off a 17 mm grip, then 69 mm off the other way once the sign was flipped).

**What the old one was**, measured rather than argued: one rounded box for the palm, four identical
boxes for the fingers, one for the thumb, a cylinder for the wrist; `axis = 0.44` and `fill = 0.67`
in its own bounding box, i.e. a plate with perpendicular edges. `tests/unit/hand.test.ts` states the
replacement's contract — 11 tests, no GPU — and `npm run verify` is green with the golden replay
byte-identical (this is a render-only pass).

**Exit condition.** `docs/CAPTURE_REQUEST.md` phase 11, and two items it names: the enemies still
wear the *old* hand until `enemyView.ts` is moved onto the shared module, and no human has looked at
a frame of this pass yet.
