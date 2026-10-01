# Task board

The live work list. Every task is written so that "done" is a command, not an opinion.
Milestone context lives in `docs/ROADMAP.md`; procedures live in `docs/recipes/`.

Legend: `[ ]` open · `[~]` in progress · `[x]` done

## M1 — closed (recorded here so the history is visible)

- [x] Monorepo, strict TS, lint-enforced package boundaries
- [x] Deterministic simulation: fixed 60 Hz tick, named RNG streams, state hashing
- [x] Content as validated data with cross-reference checks
- [x] Collision world interface + AABB implementation with grid broadphase
- [x] Player movement, stance, ADS, sprint-out, recoil, spread driven by heat
- [x] Weapon fire, falloff, penetration, headshot/limb multipliers
- [x] Grenades, barrels, chain explosions
- [x] Three enemy archetypes: perception, burst telegraph, steering, melee
- [x] Objective system + mission 00 played start to finish
- [x] HUD, screens, settings persistence, pointer-lock fallback
- [x] Procedural baseline for all art, four quality tiers, adaptive resolution
- [x] Synthesised audio with bus split and 3D panning
- [x] Scripted player, balance sweeps, stall/steer diagnostics
- [x] Golden replay trace + replay verification
- [x] Unit / integration / golden / e2e suites in CI
- [x] Single-file `callofduty.html` build + size budget
- [x] Blender pipeline scripts (conform, LODs, fracture, Mixamo retarget)
- [x] Asset ledger + licence audit gate
- [x] Docs: AGENTS, architecture, mechanics spec, parity notes, 10 ADRs, 20 recipes,
      perf budget, quality bar, art bible, level design, balance, licensing, MCP setup

## M2 — phase 03: rigs, presets and density (closed, recorded)

- [x] View model rebuilt from a real-dimension layout: 21 cm receiver, solved pose (sight
      line on the camera axis, 12 cm eye relief, 0.74 m muzzle), two-bone arm IK
- [x] Per-metre weapon materials (`materials/weapon.ts`) and `geometry.uvMetres`/`limb`
- [x] Soldier body: kit side convention (`front`/`back`/`KIT`), forward arm pitch,
      solved two-handed carry, support glove on the weapon, re-aimed every frame
- [x] Uniform value ladder + cool sheen so a dark soldier is not a cut-out
- [x] Quality tiers that share one look rig and spend samples/sizes/counts; 60 fps
      adaptive target, 0.8+ floor, post-change hold, honest HUD + settings readout
- [x] World: `UV_DENSITY` + `uvUnitMetres`, `groundSurface` honoured, rocks seated, cables
      routed by nearest neighbour with a monument exclusion, banner brackets, real puddles
- [x] ADR-0014, ADR-0015; ART_BIBLE, PERF_BUDGET, QUALITY_BAR, PARITY_NOTES, ARCHITECTURE,
      AGENTS bug list, `docs/CAPTURE_REQUEST.md` Phase 03

## M2 — realism pass (closed, recorded)

- [x] Procedural PBR surface factory: one height field → albedo, normal, roughness, AO,
      metalness (`render/materials/pbr.ts`)
- [x] Beveled/lathed/extruded geometry helpers; no scaled cubes in the arena
- [x] Detail pass on props, vehicle, monument, weapon and hostile (ADR-0011)
- [x] Image-based lighting from the procedural sky (PMREM), retuned key/fill
- [x] Static geometry batching + GPU point-cloud particles + instanced-friendly FX
- [x] Fix the intermittent black frame (mid-frame drawing-buffer resize) and the
      over-opaque damage vignette; translucent screens so pause/death stop reading as a
      black screen
- [x] Licensed-model slot table: manifest contract, loader with procedural fallback,
      `npm run assets:import`, model half of the licence audit, unit tests
- [x] Visual capture + luminance/detail report tool (`npm run shots`)

## M2 — rendering foundation + lighting (code complete, captures pending)

- [x] Fix the AA that was not there (inverted flag, `samples: 0` composer targets): MSAA
      on the scene target per tier, post AA last (ADR-0012)
- [x] Real soft shadows: `PCFSoftShadowMap` was removed in three r186, so replace the
      no-op flag with shadow radius/distance and r186's two-cascade `SunLight`
- [x] Depth-fed ambient occlusion written for this scene (contact + corner radii,
      bilateral denoise), with its small-occluder gap recorded rather than hidden
- [x] AgX tone mapping + a display-space grade (S-curve, highlight shoulder, cool lift,
      cool/warm split tone)
- [x] Lighting rig split into a cool moon key, a cool/warm ambient, per-lamp point lights
      with real falloff, a window-light pool and a controlled muzzle flash (ADR-0013)
- [x] `npm run shots` grows a probe suite: fixed poses, world-anchored patches, per-patch
      warmth, resolution lock, FX freeze, pose settling, a black-frame hunt and a
      `--probe=lighting` A/B per lighting group
- [x] Lighting contract unit tests (`tests/unit/lighting.test.ts`) — cool vs warm, key vs
      ambient, shadow detail, bloom guard, budgets
- [ ] **Capture the Phase 02 evidence frames** — see `docs/CAPTURE_REQUEST.md` (needs a
      GPU browser; not runnable from the headless harness on every machine)
- [ ] Raise small-occluder AO sensitivity (contact term that does not depend on screen
      footprint) — the one target in `docs/QUALITY_BAR.md` still unmet

## M2 — open

### Navigation (highest leverage)

- [ ] **Waypoint graph generated from `MapDef`** — build a graph from prop footprints
      (+ the collision world), expose `findPath(from, to)` on the collision provider.
  - Acceptance: `npm run sweep -- --seeds=16` completes 16/16 with a zero-stall
    assertion; `tests/unit/ai.test.ts` gains a test where an enemy paths *around* a
    building rather than grinding into it.
  - Note: this changes gameplay → re-record the golden (recipe 16).
- [ ] **Interior routes** — once paths exist, build an interior kit and a map with a
      real building; the plaza's four gates are a constraint of local steering.
- [ ] **Remove the two-probe steering fallback** if the graph makes it dead code, or
      keep it explicitly as a recovery behaviour with a comment saying why.

### Art pipeline

- [ ] **Author `kit_plaza.blend`** (jersey barrier, crate, lamp, kiosk, planter).
  - Acceptance: `python tools/blender/kit_batch.py --only kit_plaza` exports GLB + LODs
    + `_COL` proxy, `conform.py` passes, `npm run licenses:audit` passes, and the props
    look correct in-game at `low` and `high`.
- [ ] **Author the M4 view-model** and wire it into `viewmodel.ts`.
  - Acceptance: hip/ADS placement matches `WeaponDef.viewModel`, no clipping at either
    FOV, and `docs/ART_BIBLE.md` triangle budget respected.
- [ ] **Author the hostile character + one Mixamo clip set** (recipe 11).
  - Acceptance: no `mixamorig` bone name survives in the exported GLB; ledger says
    animation-data-only.
- [ ] **First texture set** (recipe 12), KTX2, shared trim sheet where possible.
- [ ] **Wire a preloader** that reads `assets/manifest.json` and degrades to the
      procedural baseline when a file is missing.
  - Acceptance: an e2e test boots with `assets/` renamed and still plays a wave.

### Simulation depth

- [ ] **Projectile ballistics for the shotgun/DMR to come** — `WeaponBallisticsDef`
      already has `projectile`/`muzzleVelocity`; implement the path and add a golden.
- [ ] **`destroy` and `defend` objectives in a real mission** — the kinds exist and are
      validated; nothing exercises them yet.
- [ ] **Save/load a checkpoint to storage** — `snapshotCheckpoint` exists; wire it to
      `localStorage` behind an explicit player action, and prove it with a test that
      round-trips through JSON.
- [ ] **Damage from falling/explosive proximity falloff documented** in
      `legacy/MECHANICS_SPEC.md` if it deviates from parity.

### Presentation

- [ ] **Footstep audio and surface-aware landing** — every surface already has a cue.
- [ ] **Death direction indicator** for the K.I.A. screen ("killed by rifleman from the
      north-west"), using the existing `playerDamaged` event.
- [ ] **Objective markers** — done for the active objective
      (`packages/ui/src/hud.ts`). Next: markers for *all* active zones and a marker for
      the nearest resupply.
- [ ] **Compass distance fade** so a marker does not clutter the strip at close range.

## M3 — open (not started)

- [ ] Mission 02 — interior assault on a new map
- [ ] Mission 03 — hold-and-extract, exercising `defend`
- [ ] Squad tactics from the `tactics` tags
- [ ] Campaign shell: mission select and progression
- [ ] Recorded audio behind the existing cue ids
- [ ] Weapon progression: `kr74` and `vector9` as mission weapons

## Cross-cutting (do continuously)

- [ ] **Every new bug gets a regression test** named for the promise it protects.
- [ ] **Every tuning change gets a sweep before/after in the commit message.**
- [ ] **Every asset gets a ledger row** — nothing merges without `licenses:audit` green.
- [ ] **Keep `docs/BALANCE.md` current** — it is the only record of why numbers are what
      they are.
- [ ] **When a doc and the code disagree, the code wins** and the doc is fixed in the
      same change. (This is how the quality-tier table in `docs/PERF_BUDGET.md` got
      corrected.)

## How to add a task

1. Write it as an outcome with an acceptance command.
2. Put it under the milestone whose exit condition it serves.
3. If it needs a new *kind* of change, write the recipe first
   (`docs/recipes/20-write-an-adr.md` for decisions, a new recipe for a procedure) so the
   next person — or agent — does not have to rediscover the seam.

## Review 3 — lag, blur, hands, loadout, two scenes (done, ADR-0016)

- [x] One multisampled target in the post chain; MSAA budget 2; cheaper AO, shadow atlas and
      light budgets; resolution floors up to 0.9.
- [x] Conditional sharpen below native resolution.
- [x] Buildings author per-face UVs; facade authored one storey per tile; windows are geometry.
- [x] View-model key light so the weapon and both hands read at night.
- [x] `level/timeOfDay.ts`: a morning and a dusk, selected before deploying, persisted.
- [x] Three-weapon loadout (Desert Eagle / M4 / AK-47) on 1/2/3, with `pistol` and `ak`
      layout archetypes and iron sights.
- [x] Tests: cost ceilings, box UVs, time of day, loadout, archetype-aware rig checks.
- [ ] **Open:** the frame rate on the reporting machine (`CAPTURE_REQUEST` 4.1). If it is
      still short of 60 with `resolutionScale` at 1, the next lever is the post chain itself.
- [ ] **Open:** the hands and the AK read as intended (`CAPTURE_REQUEST` 4.4, 4.8).

## Review 4 — "still laggy and blurry at every level" (done, ADR-0017)

- [x] Pixels are no longer a tier: `pixelRatioCap` 2 at every tier, so the frame renders at
      the display's own count on any panel; the trade is the RESOLUTION setting, off by
      default. (This was the cause of the blur that survived Review 3.)
- [x] A tier buys effects, and says which: AO off at `low`/`medium`, no shadow atlas at
      `low`, FXAA instead of SMAA below `high`, 1 lamp light at `low`.
- [x] One fewer whole-buffer pass everywhere: the grade and the upscale compensation are one
      pass, and the pass list is data (`postChain`) that a test counts.
- [x] Buildings: facade 512² over 1.2 m instead of 256² over 2.5 m, the storey band is
      geometry rather than a baked line, and the wall's dirt is fewer/larger/softer marks.
- [x] Texel density as a checked contract: `UV_PIXELS` / `UV_DENSITY` and the density floors
      in `tests/unit/texel.test.ts`; the plaza floor is 1024².
- [x] Aerial haze down 27% and the dusk fog colour darker, so distance reads as distance
      rather than as a wash.
- [x] View-model light 2.6 cd and the glove given the sky at full strength, so the hands read.
- [ ] **Open:** the reporting machine's frame rate and *seen* sharpness
      (`docs/CAPTURE_REQUEST.md` phase 05) — the only two things in this list that need a GPU.

## Review 5 — "the scope is black, the pistol and AK are incomplete, the walk is robotic" (done, ADR-0018)

- [x] The sight picture: the optic tube is open-ended, the bezel is a ring, the lenses are thin
      rings and the turret and knob are off-axis, so the sight line is a clear hole through the
      weapon. The ADS pose is solved from the optic, per archetype, so it lands on the camera
      axis for a red dot, for the AK's iron sights and for a pistol's notch alike.
- [x] `tests/unit/sightPicture.test.ts` proves it with rays (`THREE.Raycaster` — matrix and
      triangle arithmetic, no GPU) and found the optic mount's 19 mm overhang on its first run.
- [x] The Desert Eagle and the AK-47 are their own builds: a slide with serrations, a trigger,
      a grip magazine and a notch sight; a gas system over the barrel, wooden furniture, a
      rocking magazine and iron sights.
- [x] The squad's walk is a three-segment chain with a cadence, stride and knee flexion solved
      from ground speed instead of one sine per leg (`tests/unit/gait.test.ts`).
- [x] Crouch (C), jump (Space) and a sprint carry (Shift). Stance is simulation state
      (`playerEyeHeight`), and a player who never uses it hashes byte-identically — no golden
      re-record (verified with `npm run replay`).
- [ ] **Open:** whether the optic *frames* the world the way a real one does, whether the pistol
      and the AK read as complete weapons in the hand, and whether the walk reads as COD's
      (`docs/CAPTURE_REQUEST.md` phase 06) — the three things a ray cannot answer.

## Review 6 — "the weapon is glowing and the optic is an object" (done, ADR-0019)

- [x] The view-model light is bounded by the scene it sits in: 2.6 → 1.1 cd, i.e. 17 → 7 lux on
      a receiver 40 cm away, against a moon key of 2.6 lux. It was 6.5x the scene, which is why
      everything it touched clipped.
- [x] The highlight moved into the surface: a broader specular lobe at a lower gain on the
      metals, and *more* sky on the glove and the sleeve, because a matte surface is where the
      environment reads as form instead of as a highlight.
- [x] Bloom is a tighter kernel above a higher threshold (0.42 / 0.36 / 1.0) and the muzzle
      light is one stop down (60 → 26 cd), bounded in `tests/unit/lighting.test.ts`.
- [x] The optic is sized by the frame it has to fit: eye relief 0.12 → 0.17 (aperture 30% → 20%
      of the frame, housing 39% → 24%), a 2 mm rim instead of 5.5 mm, glass at 0.06 opacity
      instead of a 30% veil plus a mirror, and a turret and knob that clear the *whole*
      aperture (the ray sweep now covers 95% of it).
- [x] The reticle is a mark instead of a glow: a 2.4 mm dot in a 5.2 mm ring, centred on the
      optic's axis (2.5% of the frame, 27 px at 1080p, against ~50 px), and deliberately below
      the bloom threshold so it can never bloom.
- [x] The reticle *is* the point of aim: at ADS the weapon's drift scales to a third while the
      recoil push-back stays, and the idle breathing is 5 px instead of 20.
- [x] The muzzle flash cannot cover the sight picture — asserted geometrically (it is behind
      the optic's rear glass at ADS, additive and depth-tested, under an opaque housing).
- [x] `npm run replay` still reports 162 samples matching: every number in this list is
      presentation.
- [ ] **Open:** whether the weapon reads as *lit* rather than *glowing*, whether the sight
      picture is usable at the tier the player plays on, and whether the reticle is legible
      against pale pavement (`docs/CAPTURE_REQUEST.md` phase 07) — judgements, not measurements.

## Review 7 — the surface pass: eighteen items, one cause (done, ADR-0020)

- [x] A surface's physical identity lives in one table (`SURFACE_SPEC`), and a material is a
      variant of a class instead of a second copy of the same numbers. Nineteen classes, one
      recipe per class reading the same row.
- [x] The three scales are a contract rather than a hope: macro / mid / micro amplitudes per
      class, with the outdoor families required to carry ≥ 0.8 of their story at the two large
      scales — because that is the only detail that survives distance.
- [x] No half-metals (0 or ≥ 0.9), and a coating declares its *substrate* with the map carrying
      the paint, so a chip through paint is a change of material rather than of colour.
- [x] Roughness spends the real range (1.0 on sand to 0.06 on water) and no two classes
      collapse into each other — with the pairs the frames confused asserted by name.
- [x] Weathering is part of the atmosphere (`Weathering` on the preset, applied by
      `applyWeathering`), it is idempotent, and it cannot reach what it must not (an unlit lamp
      lens is a source, not a surface).
- [x] A sand ground draws sand (it was falling through to the plaza paving, and the *test*
      asserted the fallback).
- [x] The road has a history: edge sand drifts (which double as the road/ground transition),
      repairs that are darker *and* smoother, burn marks, and the markings' own wear.
- [x] The car is a painted object: clearcoat paint (and `burntPaint` for its state), glazing
      over a real cabin, tread / sidewall / rim, grime where spray lands, and a contact patch.
- [x] Dirt is a material (`grime`) placed by rule — contact lines, wall bases, wheel arches —
      rather than a layer tiled over everything.
- [x] Repetition is broken by placement and UV windows, not by more textures: one `shiftUv` per
      building shell, plus a grime band and a drainpipe so a facade is a building.
- [x] The claims are measurable: `__IV__.materials()` reports both hours' weather and every
      weathered material's live numbers, and `npm run verify` runs all of the above as tests.
- [ ] **Open:** whether the material *differences* are visible in a frame (road versus sand,
      clean paint versus dirty, dry hour versus damp), and whether the far buildings still read
      as wallpaper — `docs/CAPTURE_REQUEST.md` phase 08.

## Review 8 — PHASE 04, geometry and 3D construction (done, ADR-0021)

- [x] The previous pass's own artifacts: the wall grime band was a belt floating clear of every
      building (half a metre wider than the building on each side), and the car's rocker band and
      contact patch were sized from the car's *length* on a body 0.44 of it wide — dark wings twice
      the car's width. Both now hug the surface they are on (AGENTS.md 35–38).
- [x] A bevel is a rule, not a number: a 12% share of the part, capped by the request, and the
      "never a third" clamp applied after the floor — a 60 mm detail keeps a 7 mm round instead of
      the 20 mm capsule it shipped with. Every box in the arena and on the weapon obeys it.
- [x] Detail follows importance: `DETAIL` (hero / mid / far) as data, with the tier's own bevel,
      segment count and whether secondary forms are built — and a quality tier may never read it.
- [x] A window is an opening: lintel and sill proud of the wall, glass 14–18 cm behind their outer
      edge, frame seated in the wall. (The shipped version put the pane 9 cm *in front of* its own
      reveal, so every window was a dark plate 15 cm off the facade.)
- [x] A building is its attached forms: an entrance with a canopy on braced struts, a service box
      and a louvred grille, a balcony with a rail and brackets, pilasters on the tall blocks.
- [x] The landmark got its setting: a paved apron with a slab ring, a ring of bollards and two
      benches — a landmark is the *setting* the object was designed to stand in.
- [x] A street is not cast in one piece: kerbs in ten segments with a centimetre of line variation
      and one in six broken, a grime gutter, barriers with an RNG profile and a spalled corner, and
      sand drifts around the sandbag stacks.
- [x] The car is a vehicle: shut lines, a handle, a mirror on a stalk, rolled arch lips, lamps in
      housings, a grille of slats, tail lamps — behind the hero tier, and sized from the hull.
- [x] One material that was built inline in a builder is back in the library (`brass`), so it is
      inside the physical table and inside the weather.
- [x] `tests/unit/detail.test.ts` (12 tests) asserts the bevel rule, the budget ordering and the
      window construction; `npm run replay` is still 162 samples and `npm run verify` is green.
- [ ] **Open:** the weapon's own close-up hardware (item 6 — screws, magazine ribs, a modelled
      trigger area) is unchanged; the ground away from props is still a plane (item 11); and the
      skyline does not yet use the `far` tier (item 16) — `docs/CAPTURE_REQUEST.md` phase 09.

## Review 9 — the lighting everywhere, and the ground in the second image (done, ADR-0022)

The report carried its own frame: a road that is near-black, speckled like television static, and
stitched with bright glints. The scan found **five arithmetic defects**, all measured in that frame
before they were fixed, and four of them are the same mistake in four places — a number authored in
one unit used in another.

- [x] **A roughness map is a signed swing, not an absolute.** three multiplies the material's
      `roughness` by the map's green channel, and the map was authored with the absolute baked in —
      so every surface shaded at its own gloss *squared*: car paint 0.34 → 0.12, water 0.06 → 0.004,
      and the view-model receiver 0.56 → 0.235, which is a mirror and is why ADR-0019's own view
      light and roughness fix was being undone by the map. The map now carries a delta centred on
      0.5 and `applySurfaceMaps` teaches the shader to add it. (`sheened()` in `characters/uniform.ts`
      was the second and last place a material is built outside `material()`.)
- [x] **A metalness map is a fraction**, for the same reason: gunmetal authored at 0.95 shaded at
      0.90 because `base * field` was baked and then multiplied by `material.metalness`.
- [x] **The AO term was darkening the flattest surface in the build.** The pass's own `ao` output
      measured **0.80 of unoccluded on the flat open road** at `bias 0.06`, and that false occlusion
      *is* the speckle in the report's image. Now `bias` 0.25 / `thickness` 0.12 (95.6% of
      unoccluded, term hf 0.0090 → 0.0063), the sample ramp reaches 10.5 cm so a contact can ground
      a tyre, and `renderDebug().ao` reports both numbers.
- [x] **The denoise was a no-op exactly where it was needed.** The range tolerance
      `max(0.05, distance * 0.02)` collapses on a grazing plane — a metre of ground falls about a
      metre per texel — so *every* tap was weighted to zero and the AO buffer was **byte-identical
      with the blur on and off**. The tolerance now includes the two axial neighbours' footprint and
      `uBlurScale` is 2.6; the blur removes ~21% of the far ground's hf.
- [x] **The road drew its aggregate smaller than a texel.** 7,000 stones of radius 1.5–5.6 px at
      relief 0.06 on a 512² map over a 3 m tile is 5.9 mm per texel — a 30–45° normal perturbation
      every two texels, i.e. a field of miniature mirrors, over albedo 0.027 against real asphalt's
      0.05–0.10. Now 1024² (2.9 mm), a lighter fill and gentler micro detail, with
      `roughnessVariation`/`roughnessField` pulled back so the corrected swing cannot land at 0.03 on
      the one surface that fills the bottom half of every frame.
- [x] Measured on the report's own pose: ground mean 0.1473 → **0.2474**, hf 0.0285 → 0.0110,
      relative hf 0.1935 → 0.0443, glints 0.0597 → 0.0113, sub-0.02 pixels 20.7% → 3.5%. Live AO
      on/off now moves the flat road's mean by 1.3% and its hf by 0.7%.
- [x] `tests/unit/roughness.test.ts` (5 tests, GPU-free) states the contract: a neutral channel is
      exactly the material's roughness and *not* its square, a texel can never swing past its class's
      declaration, the swing round-trips through 8 bits within 1.5/255, and class ordering cannot
      invert. Re-verified live this pass: AO bias 0.25 / thickness 0.12 at 6 samples, no page errors,
      `npm run verify` green, `npm run replay` still 162 samples (render-only: no golden moved).
- [ ] **Open, with a number and no fix yet:** the dusk far ground is still near-black — 66% of one
      band (rows 240–300) below luma 0.02 while the fog colour `0x39404f` (luma 0.24) is nowhere near
      it, i.e. **the fog does not appear to reach ~60 m**. A live AO toggle adds 3.5 points of
      sub-0.02 pixels in that band, which corroborates it: the far ground is under-lit, so the
      occlusion term pushes it under the black floor. This is the next pass's first item
      (`docs/CAPTURE_REQUEST.md` phase 10.4).
- [ ] **Open, honest gap:** the instrument cannot resolve a small occluder's contact gain — a barrel
      base measures ≈0.0–0.26% against 1 m away on *both* the old and the new AO settings — so the
      higher `bias` plus the contact ramp are asserted by construction, not by this measurement
      (`docs/QUALITY_BAR.md`).

## Review 10 — the hand, the arm and the enemy (ADR-0023)

- [x] One hand, from anatomy, shared by the player and (next) the enemies: `characters/hand.ts`.
      Palm 99 x 76 x 26 mm, four fingers of three phalanges at the textbook lengths, a 9% taper per
      phalanx, a thenar mass, a flattened wrist, an elliptic forearm. `tests/unit/hand.test.ts`.
- [x] Solve the grip's axis (the tangent intersection of two phalanges) and each finger's closure
      (onto the surface), instead of tuning them. Every fingertip on every grip lands within 0.1 mm.
- [x] Solve the thumb with a two-bone IK onto the point diametrically opposite the fingertips, and
      state opposition as an angle rather than a sign.
- [x] Fix `weaponDebug().joints`: the elbows and wrists were never in the graph, so the readout
      published camera-local coordinates under a world-space key.
- [x] The measurement instrument: `__IV__.viewModel(false, false)` hides the weapon and leaves the
      hands and arms, which is the only way a shape statistic is about a hand.
- [ ] **Next, first item:** adopt the shared hand in `enemyView.ts`. All three archetypes still build
      their hands from that file's own boxes, so they wear the mitten the first-person hand just lost
      (`docs/CAPTURE_REQUEST.md` phase 11.3).
- [ ] **Next:** the downloadable-model path for the enemy bodies — a licensed GLB behind
      `assets/manifest.json`, a ledger row, and `npm run licenses:audit` — since the request is to use
      real models rather than procedural stand-ins where one can be attributed.
- [ ] **Open, honest gap:** the hand's contract is geometric and is checked with no renderer, so it
      cannot see a *material* problem — and no human has looked at a frame of this pass yet.
