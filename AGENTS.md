# AGENTS.md — how to work in this repository

You are working on **IRON VANGUARD**, a deterministic browser campaign shooter.
This file is the contract between the project and any agent (or human) making
changes. Read it before your first edit; the invariants below are enforced by
tests, lint rules and CI, so breaking one fails the build rather than review.

## The five invariants

### 1. The simulation never touches the platform

`packages/sim` and `packages/core` must not import `DOM`, `three`, `window`,
`document`, `performance`, `Date.now`, `Math.random`, `localStorage` or any
`node:*` module. Time comes from `world.tick`; randomness comes from a named RNG
stream (`world.rng.ai`, `.spawn`, `.fx`, `.ballistics`, `.loot`, `.world`).

Why: the same mission must produce the same result in Node, in the browser, in a
replay and in a test. An `eslint` boundary rule and the golden replay test both
enforce it.

### 2. One tick order, in one place

`stepWorld()` in `packages/sim/src/world.ts` is the only place systems are
sequenced:

```
updatePlayer → actions → fire → reload → scheduled cues → grenades
→ enemies → pending shots → pickups → corpses → spawner → objectives → tick++
```

Inserting, removing or reordering a system changes every golden hash. Do it
deliberately, re-record the golden, and say why in the commit.

### 3. Content is data, never code

Weapons, enemies, waves, objectives, maps, difficulties, pickups and ranks live in
`packages/content` as plain data validated by `zod` + cross-reference checks
(`npm run content:validate`). A new weapon is a data edit. A new *behaviour* is a
system.

### 4. Presentation reads; it never writes simulation state

`packages/render`, `packages/audio` and `packages/ui` may read `world` and consume
`world.events`. They must not mutate it. Debug/test mutation goes through
`window.__IV__` (see `apps/game/src/debugApi.ts`) so it is visible and greppable.

### 5. Nothing ships without provenance

Any binary in `assets/` needs a row in `assets/licenses/ledger.csv`
(`npm run licenses:audit`). Generated/procedural stand-ins are always allowed;
ripped or unattributable assets never are. See `docs/LICENSING.md`.

## Layout

```
packages/core      maths, vec3, rng, hashing, fixed-step clock, pools   (no deps)
packages/content   the game's data: weapons, enemies, waves, maps, …    (zod)
packages/sim       collision, ballistics, damage, AI, spawner, mission  (deterministic)
packages/render    three.js scene, materials, FX, camera rig, viewmodel
packages/audio     WebAudio bus, synthesis, 3D panning
packages/ui        HUD (canvas + DOM) and screens (menu/pause/results)
packages/tools     scripted player (bot), balance sweeps, validators
apps/game          the product: composition root + input + debug API
apps/harness       CLI: run/replay/sweep/hash/bench/diagnose
apps/devtools      browser dashboard: content, balance, determinism, perf
apps/editor        top-down level editor for MapDef data
tools/blender      asset pipeline: conform, LODs, fracture, Mixamo retarget
legacy/            the original prototype + the parity record
```

## Commands you will actually use

```bash
npm run dev              # play it (vite, port 5173)
npm test                 # unit + integration + golden (vitest)
npm run test:e2e         # Playwright against the real build
npm run sim -- --seed=7  # headless mission with the scripted player
npm run sweep -- --seeds=8 --difficulty=veteran
npm run replay           # verify the golden trace
npm run bench:sim        # simulation throughput gate
npm run shots            # screenshot the running game + luminance/detail report
npm run verify           # everything CI runs, in one command
```

`npm run dev:editor` and `npm run dev:tools` open the editor and the dev dashboard.

## Workflow rules

- **Run `npm run verify` before you claim a task is done.** It is the same chain
  CI runs: typecheck, lint, content validation, tests, bench, licence audit, both
  builds, budget.
- **Golden hash changes are a decision, not an accident.** If a gameplay change
  moves the trace on purpose:
  `npm run hash -- --seed=7 --seconds=420 --out=tests/golden/prologue.seed7.hash`
  and explain the change (`legacy/PARITY_NOTES.md` gets a line if it deviates from
  the prototype).
- **Fix the cause, not the assertion.** If a test looks wrong, check whether the
  *code* is wrong first: several real bugs in this project were found exactly that
  way (see "Bugs the tests found" below).
- **Prefer editing existing files** and keep diffs small. A 400-line new module is
  a harder review than four 100-line changes, and the architecture is deliberately
  small enough that large new modules usually mean the wrong seam.
- **Do not commit `assets_src/` downloads.** FBX files stay local; only exported
  GLB/KTX2 in `assets/` plus the ledger row are committed.

## Where to write things down

| You are doing… | Update |
| --- | --- |
| a new system or package boundary | `docs/ARCHITECTURE.md` + a new ADR in `docs/decisions/` |
| a deviation from the prototype | `legacy/PARITY_NOTES.md` |
| tuning numbers | `docs/BALANCE.md` and run a sweep |
| a rendering/quality change | `docs/PERF_BUDGET.md` + `docs/ART_BIBLE.md` + `docs/QUALITY_BAR.md` (targets) |
| a new asset source | `docs/LICENSING.md` + `assets/licenses/SOURCES.md` |
| a new objective/weapon/enemy type | the matching recipe in `docs/recipes/` |
| the plan changing | `docs/ROADMAP.md` + `docs/TASKS.md` |

## Bugs the tooling found (so you trust it too)

The screenshot/luminance tool (`npm run shots`, added with the realism pass) measures the
frame it captures, which is how these three were caught rather than argued about:

7. **The screen flashed black during firefights.** The adaptive resolution controller
   resized the WebGL drawing buffer *after* the frame had been drawn, so the compositor
   presented an empty black buffer for one frame — measured as 98.3% of pixels below luma
   25. `setSize` is now only ever called at the top of a frame, a zero-size resize can no
   longer produce a NaN projection matrix, and a lost context is recoverable.
8. **Being shot at made the screen nearly black.** The damage vignette held ~0.88 opacity
   for 1.5 s per hit, and with a squad firing that is permanent: a 60% dark-red wash over
   the whole image. It is now a 0.6 s punch capped at 0.6 opacity, and the results/pause
   screens are translucent instead of opaque near-black.
9. **Parts of props silently vanished.** `mergeGeometries` refuses to merge geometries
   whose attribute sets differ (lathes carry `uv1`, `ConvexGeometry` has none), and the
   batcher dropped the whole bucket. `packages/render/src/batch.ts` now normalises every
   geometry to position/normal/uv before merging.

Rendering-foundation and lighting passes added four more, all measured before they were
argued about (ADR-0012, ADR-0013):

10. **The AO term measured nothing at a small object.** The first version judged occlusion
    along the *view ray* through a sample's pixel, so reach was set by screen-space
    projection rather than by the sampling radius: a wall base darkened 68% a metre out and
    a 2 m window let a wall occlude pavement it never touched, while a barrel 0.38 m away
    measured exactly 0%. It now resolves the occluder in 3D (within the sample's own
    distance, above the surface's plane). Small occluders are still weak — a documented
    gap, not a silent one (`docs/QUALITY_BAR.md`).
11. **A whole category of lamp was decoration.** Lamp lights shipped at 12 cd with
    inverse-square falloff, i.e. ~0.4 lux on the pavement 5.4 m below them — 25× dimmer than
    the key, so every lamp was an object with a glow sprite. They are ~300 cd now, and the
    probe asserts the pool, the falloff and the warmth split rather than the intent.
12. **A probe measured a camera that was still moving.** `__IV__.pose()` snaps the rig, but
    the page keeps rendering and the rig interpolates, so a fixed 200 ms wait captured a
    frame from mid-swing: the barrel contact patches landed ~200 px from where they were
    aimed and reported "AO does nothing at a barrel base" — a measurement bug wearing a
    shader bug's clothes. The harness now waits for the projected point to stop moving.

The realism pass found six more, four of them by reading the numbers rather than a frame
(ADR-0014, ADR-0015):

13. **The view model was a plank.** `body[2] * 1.5` made the receiver 0.66 m on a 44 cm
    weapon, the muzzle sat 1.36 m from the eye, the stock never reached the shoulder, both
    gloves were built on the weapon's centre line, and `ads[1] = -0.178` put the sight line
    10 cm below the crosshair — the player aimed off the top of the receiver. The pose is
    solved from a real-dimension table now, and `tests/unit/weaponRig.test.ts` states the
    invariants. → `weapon/layout.ts`
14. **The squad wore its kit backwards.** Forward is local -z (`yawFromDirection` is
    `atan2(-dx, -dz)`; the muzzle, the aim laser and the death fall all agree), and the
    goggles, NVG mount, pouches, knife, kneepads, boot toes and holster were all at +z. An
    axis probe of the built body — three's own matrix maths, no GPU — is how it was found.
    → `characters/uniform.ts` (`front`/`back`/`KIT`)
15. **The squad swung its arms backwards.** The rest rotations were negative, which for a
    -z-forward body puts the hand behind the hip, and the aiming target went further
    negative: soldiers "raised" their weapons by swinging both arms behind their backs.
    Positive pitch brings the hand forward. → `uniform.ts` (`COMBATANT.restArm`)
16. **The soldiers could not hold their own rifles.** The weapon hung 0.72–0.78 m from the
    support shoulder with a 0.62 m arm, so the support hand stopped short of the weapon.
    `solveCarry()` searches the weapon's rotation in the hand for a low-ready carry whose
    support grip is inside the reach, and the support glove belongs to the weapon so the
    wrist can never separate from it. → `uniform.ts`, `enemyView.ts`
17. **Turning the graphics setting down made the game look worse.** A tier was an art
    direction: shadows off, AO zeroed, the lighting ratios cut by a third, FXAA instead of
    SMAA, dust off. The look is one shared rig now and a tier buys samples, sizes and
    counts; the adaptive controller also targeted 71 fps, which pinned it to its 0.7 floor
    and rendered the whole game upscaled. → `quality.ts`
18. **Texel density was inverted.** `repeat` is baked into the shared textures, so density
    was `texture pixels / mesh size`: 97 mm per texel on the plaza floor and 3 mm on a
    crate, in the same frame. Surfaces state metres per tile now, UVs are authored in
    metres, and the floor is 19× denser than it was. → `materials/materials.ts`,
    `geometry.uvMetres`

Two smaller ones from the same pass: a cable was strung between poles *in map order*, which
put a 17 m span through the monument (the router is nearest-neighbour and refuses spans that
cross it), and fifty rocks were placed at a fixed 2–16 cm above the ground while rotated and
non-uniformly scaled, so most of them hovered (a rock's centre now sits at a fraction of its
own half-height).

A third review — *"the game is laggy and everything is blurry, at every graphics level"* —
found four more, and all four were found by reading the pipeline rather than a frame
(ADR-0016):

19. **Every fullscreen pass paid for multisampling it could not use.** `EffectComposer`
    clones the scene target for its write buffer, so bloom's composite, the grade and each
    of SMAA's three passes rendered into — and resolved out of — a 4x multisampled
    half-float target. MSAA antialiases geometry silhouettes, and a fullscreen pass has
    none: it was a resolve per pass, at the full drawing-buffer size, for nothing.
    → `renderer.ts` (`buildComposer`).
20. **A building had no world-space UVs at all.** Props authored UVs in metres; a building
    shell did not, so a `BoxGeometry`'s 0..1 UV square was stretched across a 20 x 12 x 18 m
    block — one smear of texture at four different densities on the four faces of the same
    building, with rows of "lit windows" baked into the albedo as orange rectangles. The
    fix is per-face UVs (`geometry.boxUvMetres`), a facade authored one storey per tile,
    and windows as geometry with a reveal, a pane and a sill. → `geometry.ts`,
    `materials/textures.ts`, `level/arena.ts`.
21. **The gun and the hands were a silhouette in their own frame.** A weapon 40-60 cm from
    the eye, lit only by a moon three hundred times further away than the object it is meant
    to reveal, measured as one black shape: the review's "there are no hands" was a lighting
    bug wearing a modelling bug's clothes. → a 1.2 cd, 2 m-reach view-model light on the
    camera (`renderer.ts`). Two smaller ones in the same frame: a duplicate moon sprite
    (called twice into one scene, hence a disc at double brightness) and a sky that was a
    single module-level night gradient, so the morning scene did not exist to be selected.
22. **The density contract had a double-scaling trap.** `withAoUv` hands `uv1` the *same*
    attribute object as `uv`, which is right for the shader and wrong for anything that
    scales by name: a 20 m wall at 2.5 m per tile came out at 51.8 tiles across instead of
    7.2. `uvMetres` never hit it because it clones first; a freshly built box did.
    → `geometry.ts` (`boxUvMetres`, and the same guard in `uvMetres`).

Two more that were caught by tests rather than by eye: a pool that leaked entries as it
recycled, and a body fully inside geometry that could never leave.

The fourth review — *"still laggy, still blurry, at every graphics level, and the walls
look like static"* — found four, and three of them were arithmetical (ADR-0017):

23. **Every graphics level was a different pixel count.** `pixelRatioCap` was 1.0 / 1.25 /
    1.75 / 2.0, so on a 125%-scaled 1080p panel `low` rendered 80% of the panel's pixels
    and the browser stretched them — a blur applied by the compositor, invisible to every
    number the renderer reports — and on a 2x display `cinematic` was the only sharp tier.
    The setting the player reached for when the game was slow made the picture *softer* and
    nothing else. Pixels are invariant now (cap 2 = `min(devicePixelRatio, 2)`) and effects
    are what a tier buys; the resolution trade is the RESOLUTION setting, off by default.
    → `quality.ts`, `renderer.ts`, `packages/sim/src/save.ts`
24. **A building wall was seven times softer than the monitor.** The facade map was 256²
    stretched over a 3 m storey (11.7 mm per texel) against ~1.7 mm per screen pixel at two
    metres, and the storey slab band was *baked into the map*, which is what forced the tile
    to be a storey in the first place. The band is geometry now, the map is 512² over 1.2 m
    (2.3 mm per texel), and the density is a checked contract: `UV_PIXELS` / `UV_DENSITY`
    divided and asserted per surface class in `tests/unit/texel.test.ts`. → `textures.ts`,
    `materials.ts`, `arena.ts`
25. **The haze was the brightest thing in the frame.** A bright fog colour made the far end
    of the plaza the brightest region of the image, which reads as a soft picture and cannot
    be sharpened out of it; the same report's "the gun has no hands" was the view-model light
    at 1.2 cd, i.e. 6 lux on a handguard 45 cm away — a fill that left a glove reading as
    part of the weapon. → `post/look.ts` (fog −27%), `renderer.ts` (view light 2.6 cd,
    glove `envIntensity` 1)
26. **Two full-resolution passes did the job of one.** The grade and the upscale
    compensation were separate `ShaderPass`es, both reading and writing the whole buffer.
    The compensation is a uniform with five taps inside the look pass now, and the pass
    list itself (`postChain`) is data that a test counts: 4 whole-buffer passes at `low`,
    6 at `high`.    → `post/look.ts`, `post/sharpen.ts` (deleted), `renderer.ts`, `quality.ts`

The fifth review — *"the scope is black, the pistol and the AK are incomplete, the squad's walk
is not realistic, and there is no sprint, crouch or jump"* — found three, and all three were
found by arithmetic rather than by a frame (ADR-0018):

27. **The scope was a black screen.** Opening the sight put an opaque dark ellipse over the
    world, and it was not a shading problem: three pieces of geometry stood on the sight
    line, which is one ray. `optic_tube` and `optic_bezel` were built from a *capped*
    `CylinderGeometry`, so the tube's rear cap was a 3.8 cm disc of opaque metal 12 cm from
    the eye — that disc was the black screen; `lens_rear`/`lens_front` were dark glass at 0.4
    opacity stacked twice on the same axis, a 60% black filter over everything; and the
    elevation turret and windage knob were centred on the tube's axis, standing inside the
    aperture it is impossible to aim through. The tube is `open` now (open-ended and
    double-sided, so what the player sees down it is its own inner wall and then the world),
    the bezel is a ring around a real aperture, the lenses are thin rings, the dot is a ring
    with a halo, and the turret and knob sit off-axis. The check is geometric because the fix
    is: `tests/unit/sightPicture.test.ts` builds every weapon exactly as the view model does
    (`partGeometry`/`partMaterial`, the real transforms, the real ADS pose) and casts rays
    along the sight line — no GPU, because `THREE.Raycaster` is matrix and triangle
    arithmetic. → `weapon/layout.ts`, `geometry.ts` (`open` tube), `materials/weapon.ts`
28. **Crouch and jump did not exist behind keys that did.** The prototype had no crouch at
    all, and the shipped build bound `C` to nothing and `Space` to a `jump` **action** that
    no system consumed: the player could not leave the ground, behind a key that was already
    wired. It is gameplay rather than a camera trick — the eye height enemies aim at and the
    player's own shot origin both resolve through it — so it lives in the simulation: a
    `crouch` command and a `jump` action consumed in `stepWorld`'s actions step, and
    `STANCE`/`playerEyeHeight` in `packages/sim/src/player.ts` as the one place the stance
    becomes a number. The rig and the view model only *read* it. A player who never presses
    `C` or `Space` hashes exactly as before, because a grounded body's `pos.y`/`vel.y` are
    zeroed rather than integrated and `hashWorld` pushes both vectors — which is why the
    golden trace did not move. → `sim/src/{commands,types,world,player,ai}.ts`,
    `cameraRig.ts`, `viewmodel.ts`, `apps/game/src/input.ts`, `tests/unit/stance.test.ts`
29. **The squad walked on stiff legs.** The walk was `leftLeg.rotation.x = sin(phase) * 0.8`
    and its mirror — one joint per leg, so the legs were sticks — and arithmetic says why that
    cannot walk: a straight 0.96 m leg swung 26° forward puts its sole 10 cm *above* the
    ground and nothing corrected for it, so the squad skated with its feet in the air; with no
    knee there is no swing phase, so the foot never lifted and never planted; with no ankle
    there is no heel strike and no toe-off, which is most of what the eye reads; and a phase
    advanced by the *clock* slides the feet whenever the animation's cadence and the
    simulation's speed disagree, which they always do somewhere. The legs are a three-segment
    chain (thigh 0.42 / shin 0.46 / foot 0.08, summing to the 0.96 m hip-to-sole the body was
    built with) whose cadence, stride and knee flexion are solved from ground speed, and
    `tests/unit/gait.test.ts` asserts the two things that make a walk read as a walk: the
    planted foot is on the ground and no foot ever goes through it, and the swing foot clears
    by the authored height. → `characters/uniform.ts` (`GAIT`, `walkPose`, `strideFor`,
    `swingClearance`), `characters/enemyView.ts`

Two smaller ones from the same pass. The optic **mount** was 19 mm too tall and filled the
lower half of the aperture — the first version of the ray test reported it as a blocked sight
line, and the fix is one subtraction (`opticMountHeight = MM.opticMount - 0.019`). And the
view model built one *carbine* for every weapon: a Desert Eagle arrived as a small carbine
(no slide, no serrations, a full-width blade across the aim point instead of a rear notch you
can see through, and a rifle's low-ready hold — 0.17 m right, 0.31 m down on a 75° camera,
which put the whole weapon below the bottom of the frame, i.e. "the pistol is tiny and
incomplete and has no hands") and the AK-47 arrived as the M4 in different colours. The
layout is per *archetype* now (`carbine`/`ak`/`pistol`), each with its own part set, iron
sights, ADS eye relief and hip hold, and `layoutProblems` range-checks them — a pistol at
19–36 cm overall and a rifle at 50–98 cm — so "the weapon is the wrong size" cannot pass by
looking plausible.

The sixth review — *"the weapon is washed out and glowing across the whole screen, and the
optic is a large object rather than a working sight"* — found two, and both are arithmetic
rather than art direction (ADR-0019):

30. **The weapon was the brightest thing in every frame.** Two numbers multiplied: the
    view-model light sat at 2.6 cd, which is **17 lux on a receiver 40 cm away** against a
    moon key of 2.6 lux — 6.5x the scene — and the weapon's specular lobe was narrow
    (`roughness` 0.44 at `metalness` 0.72), so that 17 lux collected into a highlight that
    clipped past 1.0 in the HDR buffer. Everything above the bloom threshold smears, so the
    rail, the optic's tube and the flash hider were three white blobs *and* a screen-wide
    glow. The light is 1.1 cd (7 lux, ~2.7x the key), the metals are `roughness` 0.56 at
    `metalness` 0.66 with `envIntensity` 0.9 — a broad lobe at a lower gain puts the same
    energy on the surface it landed on — and the dielectric surfaces (glove, sleeve) take
    the difference, because a matte surface is where the sky reads as *form* rather than as
    a highlight. The bloom kernel came down with them (strength 0.55 → 0.42, radius 0.5 →
    0.36) and its threshold up (0.9 → 1.0), and the muzzle light lost a stop (60 → 26 cd),
    because a burst may be the brightest thing in the frame for 40 ms without taking the
    frame with it. The tone curve and the exposure are untouched: the fix is the light and
    the lobe, not a darker game. → `renderer.ts` (view light), `materials/weapon.ts`,
    `quality.ts` (`LOOK_RIG`), `tests/unit/weaponMaterials.test.ts`,
    `tests/unit/lighting.test.ts`
31. **The optic was a grey wash in a housing that ate a third of the frame.** Three
    numbers, one sight picture: at **12 cm of eye relief** the 46 mm housing was **39% of the
    frame's height** at the 1.36x aim zoom (the aim FOV is 55°) with a 21 cm receiver under
    it, which is the report's "a large object attached to the weapon"; the two lenses were
    **0.16 opacity each in front of the eye** with a 1.7-intensity sky reflection on
    0.04-roughness glass, i.e. a 30% grey veil *and* a two-way mirror across the aperture;
    and the reticle was a **12 mm disc** — ~10% of the frame, a 50 px pink blob centred on
    the aim point but useless for it. Now: eye relief 0.17 (aperture 20% of the frame,
    housing 24% — and 0.17 and not 0.19 because the *arms* decide the rest: the support grip
    is a point on the weapon, so pulling the optic away pulls the hand out of its reach, and
    0.19 made the kr74's support hand 99% along its own arm — `arm_short_left_1`), a 2 mm
    rim instead of 5.5 mm, glass at 0.06 opacity and 0.45 env, and a **2.4 mm dot in a
    5.2 mm ring** (2.5% of the frame, 27 px at 1080p) sitting exactly on the optic's axis,
    which the ADS solve has already put on the camera axis. The reticle is also deliberately
    below the bloom threshold, and the turret and knob moved to `tube radius + their own`
    (0.0275) because the ray test now sweeps **95% of the aperture** rather than its middle
    third. → `weapon/layout.ts` (`POSE.eyeRelief`, the optic parts, the reticle),
    `materials/weapon.ts` (lens, dot), `tests/unit/sightPicture.test.ts`

Two more from the same pass. **The reticle drifted off the point of aim**, which is a sight
that lies: the HUD crosshair is hidden while aiming, so anything that moves only the weapon
moves the dot off the crosshair — and the idle "breathing" sway was 3.5 mm, **20 px of reticle
drift on a 1080p frame**. At ADS the weapon's positional and rotational drift now scale by
`1 - 0.65 * adsT` (the recoil push-back along z stays, because it brings the optic closer
without moving it off the axis) and the breathing is ~5 px. And **the flash could have stood
in front of the sight picture**: it is geometry and depth-testing, not taste, so
`sightPicture.test.ts` now asserts the flash anchor is *behind* the optic's rear glass at ADS
for every weapon — the sprite is additive and depth-tested, the optic is opaque and nearer.

The seventh review — *"materials har object par almost same type ka visual response de rahe
hain… car ka material sab se zyada fake/noisy… road ek generic textured plane jaisi lagti
hai"* — found three, and the first two were caught before a frame existed (ADR-0020):

32. **The rain could not touch a surface that was already rough.** `weathered()` moved
    roughness by `pull * wet * (1 - roughness)` — in proportion to how *smooth* a surface
    already was — so sand at 1.0 did not move **at all** when wet while the road at 0.9 barely
    did, and the only surface the weather could act on was one that was already glossy. Its
    own doc comment claimed the opposite ("sand at 1.0 comes down to 0.76 when wet"), which is
    why `tests/unit/surfaces.test.ts` caught it as `sand wet: expected 1 to be less than 1`.
    Water does not polish what is already polish: it fills the *pits* that made a surface
    rough, so roughness now approaches `WEATHER.wetRoughness` (0.3) from above, and a surface
    already smoother than that does not move. → `materials/surfaces.ts`
33. **A map that asked for a sand ground got mortar-jointed paving.** `groundMaterialFor`
    had no `'sand'` case, so every map whose `groundSurface` is sand fell through to the plaza
    flags — the one surface the review asked to be soft and granular, rendering as stone. The
    *test* was worse than the code: `world.test.ts` asserted the fallback (`expect(
    groundMaterialFor('sand', materials).name).toBe('paving')`), i.e. the assertion had been
    written to match the defect. The case was added and the assertion follows it.
    → `level/arena.ts`, `tests/unit/world.test.ts`
34. **The car's glass was a solid panel because there was nothing behind it.** A 0.34-opacity
    tinted box with no cabin inside is a flat cyan rectangle: transparency with no depth cue
    behind it is a *paint*, not a window, which is what "windshield ek flat blue/cyan surface
    jaisa read hota hai" measured. The cabin is geometry now (seats, a bench, a dashboard, a
    wheel) and the glazing is four thin panes with the pillars proud of them, so the glass has
    something to be transparent *over*. Two smaller ones in the same file: a tyre was one
    material all over (tread and sidewall are different surfaces — the sidewall is the half
    the player sees), and `shiftUv` had to clone before it offsets, because `withAoUv` hands
    `uv1` the same attribute object as `uv` and shifting in place drags a wall's occlusion
    into its new texture window (the same trap as entry 22). → `level/arena.ts`,
    `geometry.ts`

The eighth report was PHASE 04 — *"geometry / 3D model quality"*, eighteen items about shapes — and
reviewing the previous pass's own frames-free geometry found four more, three of which were mine
(ADR-0021):

35. **Every small part was being melted round.** `roundedBox` clamped its corner radius to *a
    third of the smallest dimension*: fine for a crate, a disaster for anything you can hold — a
    60 mm detail box came out with a 20 mm radius, i.e. a capsule, and a 30 mm one 10 mm. "Objects
    are primitive shapes" and "the weapon is a plank" are partly this one number, because no
    amount of detail geometry survives being rounded off. There is now a *rule* rather than a
    number (`geometry.bevelFor`): absolute up to the part's own size, then a 12% share of it,
    then never past a third — the third-clamp applied **after** the floor, because the first
    version of the fix could violate its own limit on a 4 mm plate (1.5 mm is already a third of
    it), and a rule that fails near zero is not a rule. → `geometry.ts`,
    `tests/unit/detail.test.ts`
36. **A car's hardware was inside the car.** Moving the car's panels into their own function
    meant passing the hull's half-width, and the first version derived it from the *profile's
    length* (`length / 2 * 0.44 * 0.5` = 0.53 m) where the body is 0.92 m half-wide — so the door
    handles, the mirrors and all four arch lips were buried inside the shell, at exactly the
    width where nothing can be seen. The number was already in the builder (`size * 0.22`); the
    refactor lost it. → `arena.ts` (`buildCarHardware`)
37. **The glass stood in front of its own frame.** A window was three boxes and none of them made
    an opening: a concrete "reveal" sat on the wall and the pane was placed **9 cm in front of
    it**, so the glass covered its own frame and each window was a dark plate standing 15 cm off
    the facade. That is the review's "windows mostly flat surfaces jaisi hain" measured. A shell
    is one solid box, so a real hole is not available — the honest construction is a lintel and a
    sill proud of the wall with the glass 14–18 cm behind their outer edge, which is what the eye
    reads as the reveal. → `arena.ts` (`windowConstruction`), `tests/unit/detail.test.ts`
38. **A material was being built inside the arena.** The monument's brass cap was an inline
    `new THREE.MeshStandardMaterial({ color: 0xd8b45c, metalness: 1, … })` in the builder —
    outside the physical table, outside the weather and outside every check in
    `materials/materials.ts`, which is how two of them end up disagreeing. It is
    `materials.brass` now (and it is in `WEATHERED_MATERIALS`, so the air reaches it).
    → `materials/materials.ts`, `arena.ts`

The ninth report was a frame rather than a list — *"YA AESA KYON HAI LIGHTING"*, over a shot of a road
that was near-black and covered in a field of bright speckles, with *"2ND IMAGE MEIN ZAMEEN KAISE HAI"*
underneath it. Reading the pipeline rather than the argument found five, and every one of them was a
number in two places (ADR-0022):

39. **Every surface in the build was glossier than its own table said.** three's stock chunk is
    `roughnessFactor = roughness` then `roughnessFactor *= texelRoughness.g`, and the roughness map
    was authored with the *absolute* roughness baked into it (`roughnessAt` took the class's base).
    So an absolute map was multiplied by an absolute material: the surface shaded at its own
    roughness **squared**, at a rate set by how smooth it already was. Car paint authored at 0.34
    shaded at 0.12, water at 0.06 shaded at 0.004, and the view model's receiver authored at 0.56
    shaded at 0.235 — which is a mirror, and is why a 1.1 cd light 45 cm away came back as a white
    smear on the weapon (entry 30 was tuning against this number the whole time). The map is the
    *swing* now and the material is the value, which is also the only way one map can serve a
    library material at 0.42 and seven view-model parts whose authored roughnesses differ per part
    (`applySurfaceMaps`, `tests/unit/roughness.test.ts`). → `materials/pbr.ts`,
    `materials/materials.ts`, `characters/uniform.ts` (`sheened`)
40. **The metalness map was applied twice for the same reason** — it baked `base * field` and the
    material's `metalness` was the same base — so a gunmetal surface at 0.95 shaded at 0.90. The map
    is the *fraction* now: the field starts at 1 (this texel is metal) and a recipe paints it down
    where paint or dirt takes over, which is exactly what the material then scales. → `materials/pbr.ts`
41. **The AO was darkening the flattest, most exposed surface in the build.** The pass has a debug
    output for its own term, and pointing it at the open road measured **0.80** where 1.0 is "nothing
    occludes this": a flat sheet of tarmac was having **7.4% of its light removed by occlusion that
    does not exist**, at a `bias` of 0.06 (3.4°), which a depth-reconstructed normal at a grazing
    angle clears easily. The same term was the speckle: the false occlusion *is* the noise. `bias`
    0.25 (an occluder must sit 14.5° above the surface) and `thickness` 0.12 m take the far ground to
    95.6% of unoccluded and the term's noise down 21%; the sample ramp came with it (0.35 → 0.15 of
    the radius), because a contact term whose nearest sample is 0.28 m out cannot see the 5 cm
    between a tyre and the tarmac (`docs/QUALITY_BAR.md` records the small-occluder gap it leaves).
    → `post/ao.ts`, `renderer.ts` (`aoOptionsFromQuality`)
42. **The denoise pass did nothing where it was needed, and measurably so.** The bilateral blur's
    range tolerance was `max(0.05, distance * 0.02)`, which sounds generous until it is priced on a
    grazing plane: looking down the road, a metre of ground falls about a metre per texel, so every
    tap was weighted to zero and the AO buffer was **byte-identical with the blur on and off** on the
    far ground (hf 0.00924 either way) — the one surface that carries the 6-sample noise. The
    tolerance now includes the depth the blur footprint itself spans, so a tap that follows the
    surface is admitted whatever its slope and a silhouette is still rejected; with the footprint at
    2.6 texels instead of 1.35, the blur is worth 21% of the far ground's high-frequency energy, up
    from 3%. → `post/ao.ts`
43. **The road was drawing its aggregate smaller than a texel.** 7,000 relief-embossed stones of
    radius 1.5-5.6 px at relief 0.06, on a 512² map over a 3 m tile (5.9 mm per texel) — a 30-45°
    normal perturbation every ~2 texels, which is a field of miniature mirrors, and the map's other
    half was an albedo at linear 0.027 against real asphalt's 0.05-0.10. Measured on the frame at
    one pose: 20.7% of the road's pixels below luma 0.02, 4.3% of them isolated glints, and 1.45x the
    paving's *relative* high-frequency energy. It is 1024² (2.9 mm per texel, so a 5-15 mm stone is
    2-5 texels and can be drawn as a stone), the stones carry a bulge rather than a cliff, the albedo
    is 0x3f3c36, and the class's own swing came down with them. Same pose after: 3.5% near-black,
    0.11% glints. → `materials/textures.ts`, `materials/surfaces.ts`, `materials/materials.ts`

Two smaller ones from the same pass, both mine. The **asphalt's micro grain was left at 0.05 when
every other surface halved its relief on the way to a higher-resolution map** (ADR-0017's rule: the
grain is per-pixel, so doubling the resolution doubles the frequency of the finest term) — it is
0.016 now, and the *measured* consequence was already visible in the paving, which reads cleanly at
0.02. And **the scene's fog colour was darker than the night it was sitting in** … actually no: that
one is still open. The distant road at dusk measures luma below 0.02 across 66% of one band, and the
fog colour (0x39404f, luma 0.24) is nowhere near it, which means the fog is not reaching 60 m at all
— a finding with a number and no fix yet (`docs/TASKS.md`, review 9).

Two smaller ones from the same review, both mine and both *placements* rather than shapes: the wall
"grime band" was a belt around the middle of every building half a metre wider than the building on
each side — a dark ring floating clear of the facade — and the car's rocker band and contact patch
were sized at 0.9 × the car's *length* on a body whose width is 0.44 of it, i.e. dark wings 2× the
car's width. Both are now sized from the surface they sit on (`size * 0.22` plus a centimetre for
the band, and the patch inside the hull's own footprint). Dirt has to hug what it is on.

The tenth review was the standing loop itself — *"khud game open karo, khelo, screenshots lo, har cheez
identify karo … hamara apna hand/bazo ka shape real nahi hai, enemies ke model fazool shape hain"* —
and the first three findings are about the player's own hands (ADR-0023):

44. **The hand was a mitten, and the instrument said so in numbers.** One `roundedBox` for the palm,
    **four identical boxes** for the fingers (two per finger, same length, same thickness, no taper),
    one box for the thumb, and a `chamferedCylinder` for the wrist — and the enemy's "hand" was a
    single 9 x 10 x 13 cm box with no fingers at all. A gradient-orientation histogram of the
    isolated view model (`.captures/mask.py`) put it at `axis = 0.44` with `fill = 0.67` inside its
    own bounding box: a plate with perpendicular edges. The fix is one module of real proportions and
    a solved chain — `handShape()` is pure arithmetic with no three and no GPU, so the contract lives
    in `tests/unit/hand.test.ts`. → `characters/hand.ts`
45. **The grip's axis and the hand's closure were both guesses, and both can be solved.** A bar held
    in a fist is tangent to two phalanges at once, so its axis is where those two lines cross once
    each is offset inward by the bar's radius; and how far a finger closes is whatever puts *that*
    fingertip on the bar's surface. Solving them makes the fit exact at every radius — the little
    finger closes at 0.87 on a 19 mm grip and 0.93 on a 30 mm one, the middle at 0.94 and 0.97, and
    after the first version every fingertip lands within 0.1 mm of the surface. → `hand.ts`
    (`fitAxis`, the closure search, `solveTwoBone` for the thumb)
46. **The thumb was a box on the wrong side of the grip.** Opposition is the one thing that separates
    a grip from a basket, and it is an *angle*: the thumb's tip must come to rest at least a quarter
    turn around the bar from a fingertip. Hand-tuned flexion ratios could not express it — the first
    version's tip finished 64 mm off a 17 mm grip and the sign-flipped second finished 69 mm off the
    other way, because a three-segment chain with two bending joints has an S-shape in it that no
    single scale unwinds. It is a two-bone IK onto the point on the bar diametrically opposite the
    fingertips now, and the solver reports how far short it fell when a hand cannot reach.
    → `hand.ts` (`solveTwoBone`, `mountProblems`)

Four smaller ones from the same pass. The forward-kinematic chain applied each joint's flexion
*after* its own phalanx, so the MCP flexion was landing on the PIP joint and **every finger came out
perfectly straight** — a fist gripping nothing, with the grip's fitted axis just over 12 cm in front
of the knuckles. The **index finger was excluded from its own closure solve**, so a hand that was
supposed to be holding a 17 mm grip curled 3 mm *inside* it. The **opposition check compared signed
`y`**, which reported a thumb resting 195 degrees across the bar from the middle finger as "on the
same side as every fingertip" — two points on opposite sides of a circle can share a sign, and only
an angle can see it. And **the hand's own axes were left-handed for a right hand** (`x` = thumb side,
`y` = knuckles, `z` = back of hand), which would have forced every caller to mount a right hand with
a mirroring matrix — and a mirroring matrix turns a right hand into a left one. `+z` is the palm side
now, and `mountProblems` checks the mount's consistency.

Two more the loop found while building the instrument for it. **`weaponDebug().joints` labelled
camera-local coordinates as world space**: `elbowLeft`, `elbowRight`, `wristLeft` and `wristRight`
were created and never added to anything, and a detached `Object3D`'s `getWorldPosition()` returns
its local value unchanged — so projecting any of the four returned the camera's own position. The
whole rig is in the graph now. And **a hand cannot be measured on the raw frame**: the weapon is one
large axis-aligned mass, so an orientation histogram over the whole view model reports the receiver;
and cropping to the hand does not help either, because at a hip carry the hand sits against the
weapon's own body and the crop comes back `fill = 0.98` — the whole box is mask, so there is no
silhouette in it to measure. `window.__IV__.viewModel(false, false)` hides the weapon and leaves the
hands and arms on their own, which is what turns the hand's own orientation histogram into a number
about the hand (`axis = 0.28-0.33`, i.e. the least axis-aligned object the view model contains).

## Bugs the tests found (so you trust them)

These are real defects this codebase shipped *before* the test suite existed, all
now covered by a named regression test:

1. **Barrels could not be shot.** The barrel's movement footprint (0.6) was larger
   than its shootable box (0.45), so every round landed on the barrel's own
   collider. Chain explosions were dead code. → `packages/sim/src/collision.ts`
   (`BARREL_RADIUS`), test `lets the player shoot a fuel barrel and blow it up`.
2. **Headshots did nothing.** `hitGroupMultiplier` existed but `fireShot` never
   applied it, so the M4's 2.1x was decorative. → `weapons.ts`, test
   `deals flat M4 damage across the plaza and doubles it on a headshot`.
3. **Blinded enemies kept firing.** Breaking line of sight did not stop a burst,
   contradicting the mission brief. → `ai.ts`, test `sees the player across open
   ground and does not see through buildings`.
4. **Hostiles wedged forever on cover corners.** A single 1.8 m steering probe
   accepted directions blocked at the next step, so an enemy could sit still for
   the rest of the mission and stall a wave. → `ai.ts` two-probe steering, test
   `walks around a lamp post instead of grinding into its corner`.
5. **A body inside geometry could never leave.** `resolve()` picked a degenerate
   escape direction. → `collision.ts` least-penetration escape.
6. **The pool leaked entries** as it recycled, so `live` drifted from reality. →
   `packages/core/src/util.ts`.

## When you are stuck

- `apps/harness/src/diagnose.ts` prints per-second enemy positions, modes and
  line of sight — the fastest way to see *why* a wave is not being cleared.
- `apps/devtools` runs the balance sweep and the determinism comparison in a
  browser, no terminal needed.
- `npm run sim -- --quiet=false --seconds=400` gives a full mission report
  (outcome, waves, kills, accuracy, score, final state hash).
