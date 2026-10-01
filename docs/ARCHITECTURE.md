# Architecture

IRON VANGUARD is a deterministic simulation with replaceable presentation. That one
sentence explains most of the design decisions in this document.

```
                 ┌───────────────────────────────────────────────┐
   input ───────▶│  @iron/sim      fixed 60 Hz, no platform APIs │───────▶ events
 (commands)      │  world + systems + objectives                 │
                 └───────────────┬───────────────────────────────┘
                                 │ read-only state
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
   @iron/render             @iron/ui                @iron/audio
   three.js scene        canvas + DOM HUD          WebAudio graph
```

`@iron/content` is data read by the simulation. `@iron/core` is the shared maths
substrate. `@iron/tools` and `apps/*` sit on top and are never imported by the
libraries.

## 0. How the render layer is organised

`@iron/render` reads the world and writes pixels; it never mutates either. Inside it,
four modules own four different problems, and the realism work lives almost entirely in
the first three:

| Module | Owns | Why it exists |
| --- | --- | --- |
| `materials/pbr.ts` | procedural PBR maps | one height field derives albedo, normal, roughness, AO and metalness, so the maps agree with each other |
| `geometry.ts` | beveled/lofted geometry | nothing is a scaled cube; a rounded edge is the difference between "prop" and "box" |
| `batch.ts` | static geometry merging | detail costs draw calls, so a prop's parts are baked into one mesh per material |
| `assets/models.ts` | optional downloaded GLB slots | the upgrade path; the procedural build is the product, models are a bonus |

The hard rule in `batch.ts` is worth restating because it is the one that breaks
silently: **nothing that moves is batched into something that does not.** Limb bones,
the magazine that leaves the weapon, barrels that individually disappear and banners
that sway each get their own transform.

`packages/content/src/assets.ts` holds the model manifest contract, because it is data
with an invariant (provenance) rather than code. The loader takes the parsed manifest;
`packages/tools/src/assetsImport.ts` is the only thing allowed to write one, and it
writes the licence ledger row in the same step.

## 1. Determinism is the load-bearing property

Everything else is negotiable; this is not. It is what gives us replay, golden
tests, headless balance sweeps, reproducible bug reports and a devtools panel that
can *prove* a change did not alter gameplay.

How it is achieved:

| Source of nondeterminism | Replacement |
| --- | --- |
| `Math.random()` | named streams: `spawn`, `ai`, `fx`, `ballistics`, `loot`, `world` |
| wall-clock time | `world.tick` (60 Hz), `TICK_DT`, `FixedStepClock` in the app |
| `setTimeout` | tick-scheduled queues (`pendingShots`, `pendingCues`) |
| float drift across machines | state hashing quantises to 1e-3 (`quantize`) |
| iteration order of object keys | enemies hashed by sorted id; RNG streams derived by name hash |
| frame-rate-dependent smoothing | `damp()` (exponential) everywhere, never `lerp(1-dt)` |

`hashWorld()` (in `packages/sim/src/statehash.ts`) hashes only gameplay-visible
state — never particles, camera smoothing or audio. `tests/golden/prologue.seed7.hash`
records one hash per simulated second for a full mission; any accidental change
moves it.

## 2. The tick

`stepWorld()` (`packages/sim/src/world.ts`) is the single ordered list of systems:

| # | System | Owns |
| --- | --- | --- |
| 1 | `updatePlayer` | look, stance, movement, collision, regen, bob |
| 2 | actions | `reload` / `grenade` commands from this tick |
| 3 | `fireShot` | hitscan, spread, recoil, damage application |
| 4 | `updateReload`, `updateScheduledCues` | timed weapon state |
| 5 | `updateGrenades` | projectile flight, bounce, fuse, blast |
| 6 | `updateEnemies` | perception, state machines, steering, enemy fire |
| 7 | `updatePendingShots` | enemy damage landing N ticks later |
| 8 | `updatePickups` | lifetime, pickup radius, effects |
| 9 | `updateCorpses` | death animation, cleanup |
| 10 | `updateSpawner` | wave scheduling, gates, wave completion |
| 11 | `updateObjectives` | objective progression, mission end |
| 12 | `world.tick++` | and rebuild `world.stats` |

Events produced during a tick are consumed by the app after `stepWorld` returns,
then cleared on the next tick (`world.events.length = 0`). **Consequence:** an
event pushed from outside the tick loop is wiped before anyone sees it. That is why
the app also polls `missionComplete`/`missionFailed` (`apps/game/src/main.ts`).

## 3. Content boundary

`packages/content` exports plain objects typed in `types.ts` and validated in
`schema.ts`:

- per-row `zod` schemas (magazines positive, drop chance 0..1, damage delay int…);
- a cross-reference pass for what types cannot see: unknown map/weapon ids,
  duplicate ids, a `survive` objective with no wave count, a checkpoint that
  references a wave that does not exist, rank thresholds that are not descending.

`getWeapon(id)` and friends throw on an unknown id rather than returning
`undefined`, so a typo fails at the call site with a clear message. `validateContent()`
is run by `npm run content:validate`, by the devtools app, and by tests.

Adding content is a data edit. The recipes in `docs/recipes/` walk through each kind.

## 4. Collision

One interface (`CollisionWorld`) with one implementation today
(`createAabbCollisionWorld`): footprints derived from prop data, a uniform 10 m grid
broadphase, slab tests for rays, circle-vs-AABB resolution with step-and-slide and a
least-penetration escape when a body starts inside geometry.

The simulation only ever talks to the interface, so M2 can drop in a
`three-mesh-bvh` provider built from real meshes without touching gameplay code.
`footprintOf()` is shared by collision, the editor's overlay and map validation, so
all three agree on what a prop blocks.

## 5. Rendering

The renderer is a *reader*: `syncWorld(world, alpha, dt)` interpolates between the
previous and current tick using the clock's `alpha`. It contains no gameplay logic.
`capturePrevious(world)` snapshots poses before each tick so interpolation is exact
rather than approximate.

Procedural materials, geometry and effects are the M1 baseline; `assets/` adds
fidelity on top. Every visual system is pooled (`createPool`) so the frame loop does
not allocate. Post-processing (bloom, FXAA) is tiered per `docs/PERF_BUDGET.md`.

## 6. The app layer

`apps/game/src/main.ts` is the composition root and the only place that knows about
all packages. It owns: URL parameters (`?seed=`, `?mission=`, `?autostart=1`,
`?lock=off`), settings persistence, pointer lock with a fallback path, the frame
loop, event → HUD/audio plumbing, and `window.__IV__` (the debug API that Playwright
and the golden tests drive).

Anything the app mutates directly for debugging is exposed through `__IV__` so it is
greppable and testable, instead of being hidden in a keyboard shortcut.

## 7. Testing strategy

| Layer | Where | What it protects |
| --- | --- | --- |
| unit | `tests/unit/*` | maths, rng, hashing, collision, ballistics, AI behaviour |
| integration | `tests/integration/mission.test.ts` | tick order, full mission, damage, explosives, save |
| golden | `tests/golden/replay.test.ts` | the whole simulation, byte-for-byte per second |
| balance | `apps/harness` sweeps | tuning regressions, difficulty curve |
| e2e | `tests/e2e/game.spec.ts` | the real build boots, plays, survives quality changes |

Tests are written against the *contract* (state, events) rather than the
implementation, which is why they caught the six real bugs listed in `AGENTS.md`.

## 8. Deliberate non-goals

- **Not an ECS.** With one player, ≤ 20 hostiles and a handful of systems, an ECS
  buys indirection we would pay for in readability. Pooled arrays + explicit systems
  are faster to reason about at this scale.
- **No netcode.** Commands are already the sole input path, so a future authority
  model is a transport problem rather than a rewrite — but nothing is built for it.
- **No physics engine.** Character movement, hitscan and grenade ballistics are
  hand-rolled and tuned; a general engine would change the feel we are matching.

## 9. Rig modules (Phase 03)

Two modules exist because "does this look like a man holding a gun" turned out to be
arithmetic, and arithmetic can be unit-tested with no GPU (ADR-0015):

| Module | Holds | Invariants it states |
| --- | --- | --- |
| `render/src/weapon/layout.ts` | every view-model part at real size (`MM`), the anchors, the pose solve, the arm rig | carbine dimensions, the sight line on the camera axis, the muzzle distance, both hands inside both arms, `solveElbow`'s clamp |
| `render/src/characters/uniform.ts` | which side kit is worn on (`front`/`back`/`KIT`), the uniform value ladder, the rim, the carry solve | kit sides, the palette ladder and hue, sheen, the support grip's reach in both poses and the whole rest→aim blend |
| `render/src/characters/hand.ts` | the anatomy table (`HAND`), the phalanx chain, the grip-axis fit, the per-finger closure solve, the thumb's two-bone IK, the mount | hand size and breadth, a wedge palm, a flattened wrist, three phalanges per digit, four *different* finger lengths in order, a taper in every finger, every fingertip on the surface of what is held (not beside it, not through it), the thumb a quarter turn or more around the bar from a fingertip, and the mount's consistency |

A fourth is the hand's, and it exists because of what a hand is: **the grip and the closure are
solved, not tuned** (ADR-0023). A bar held in a fist is tangent to the proximal and the middle
phalanx at once, so `fitAxis` puts its axis where those two lines cross once each is offset inward
by the bar's radius; then each finger's closing amount is whatever puts *that* fingertip on the
surface, so the little finger closes at 0.87 on a 19 mm grip and the middle at 0.94. Hand-tuned
equivalents were tried and none of them worked: a three-segment chain with two bending joints has an
S-shape in it that no single scale factor unwinds, which is why the thumb is a two-bone IK onto the
point on the bar diametrically opposite the fingertips (`solveTwoBone`, `clamped` reporting how far
short it fell). `handShape()` is pure arithmetic with no three in it, so `tests/unit/hand.test.ts`
sees every one of those numbers with no GPU.

A third lives next to the material library because the defect it prevents was invisible in
a screenshot's metadata: `materials/materials.ts` exports `UV_DENSITY` (metres per texture
tile, per surface class) and `uvUnitMetres`, and `geometry.uvMetres` authors a geometry's
UVs in metres. Together they make a surface's texel density a property of the surface
rather than of the mesh it happens to be applied to (ADR-0014).

All three are pure: no DOM, no `world`, no meshes in the invariant paths. That is what
lets `npm test` check the things a reviewer would otherwise have to see.

## Phases 04–05 additions: the atmosphere, the frame budget, and the loadout

- **`packages/render/src/level/timeOfDay.ts`** — the atmosphere as data: `TIME_PRESETS`
  (sky gradient, key direction/colour/strength, ambient colours, haze, exposure, reflection
  scale, which artificial sources are lit, the emissive prop colours), `skyTextureFor`,
  `keyDirection`, `keyElevationDeg`. `createLighting(..., timeOfDay)` builds the rig from it
  and `LightingRig.applyTimeOfDay` swaps it in place; `GameRenderer.setTimeOfDay` owns the
  rest (fog, exposure, environment cubemap, prop glow). Presentation only — the setting lives
  in `StoredSettings` and cannot reach the simulation.
- **The upscale compensation** — a cross-shaped unsharp term *inside* `post/look.ts`
  (`setSharpen`), enabled only while the adaptive controller is rendering below native
  (`SHARPEN_BELOW_SCALE`). Compensation for an upscaled frame, not a filter: it is a uniform
  with four extra taps, it reads 0 at native resolution, and it is not a pass of its own
  (ADR-0017 — the separate `post/sharpen.ts` was one more whole-buffer read/write per frame).
- **`packages/render/src/quality.ts` → `postChain` / `fullResPasses`** — a tier's post chain as
  data, and the number of whole-buffer read/writes it costs (4 / 4 / 6 / 6). `buildComposer`
  iterates the list and `tests/unit/quality.test.ts` asserts it, which is how the frame budget
  stays provable without a GPU.
- **`UV_PIXELS` / `UV_DENSITY` (materials)** — the world's texel-density contract: pixels per
  surface class, divided by metres per tile, asserted per class in `tests/unit/texel.test.ts`.
  Density is the one visual property that a resolution setting cannot change and a reviewer
  can see at arm's length, which is why it is a tested number rather than a comment.
- **`packages/render/src/geometry.ts` → `boxUvMetres`** — per-face, per-metre UVs for a box,
  the one primitive whose six faces cannot share a UV scale.
- **The loadout** — `packages/content/src/weapons.ts` (`LOADOUT`, `DEFAULT_SLOT`) is the
  data; `packages/sim` gives each slot its own `WeaponRuntime` in `PlayerState.loadout` and
  swaps them from the `weapon1..3` **action** in `stepWorld`'s actions step, so the canonical
  tick order is untouched (invariant 2) and a swap replays like any other command. The
  renderer rebuilds the view model from the `weaponChanged` event; the archetype in
  `weapon/layout.ts` is `carbine`/`ak`/`pistol`.

## Phase 06 additions: the sight line, the stance and the walk

Three seams were added by the fifth review, and each exists so that a defect has a single
place to be *checked* rather than a single place to be written (ADR-0018).

- **`packages/render/src/weapon/layout.ts` → `weaponLayout(def)`** — the layout is chosen by
  `def.viewModel.archetype` (`carbine`/`ak`/`pistol`), and each archetype owns its part set,
  its sights, its `eyeRelief` and its hip hold. `posePosition` solves ADS from the *optic*
  (`ads.y = -optic.height`, `ads.z = -(eyeRelief + optic.rear.z)`) rather than reading
  content's `ads` array, so the sight line lands on the camera axis for a weapon whose optic
  sits 3 cm over the bore and for one whose iron sights sit 5 cm over it. `geometry.ts`'s
  `tube` shape gained `open` (open-ended, double-sided) because a capped cylinder on the sight
  line is an opaque disc 12 cm from the eye — which was the black screen. "Is anything in
  front of the eye" is one ray, so `tests/unit/sightPicture.test.ts` answers it with
  `THREE.Raycaster` and no GPU.
- **`packages/sim/src/player.ts` → `STANCE` / `playerEyeHeight`** — crouch and jump are
  simulation state, not camera offsets: the eye height the AI aims at, the player's own shot
  origin and the head's crown all resolve through one function. `crouch` is a held command and
  `jump` an action, both consumed in `stepWorld`'s existing actions step, so the tick order
  (invariant 2) is unchanged and a jump replays like any other command. A grounded body zeroes
  `pos.y`/`vel.y` instead of integrating them, so a player who never crouches or jumps hashes
  byte-identically — which is why this cost no golden re-record, and why every future stance
  change has to make the same argument.
- **`packages/render/src/characters/uniform.ts` → `GAIT` / `walkPose` / `strideFor`** — the
  walk is a three-segment chain (thigh/shin/foot) whose cadence and stride are solved from
  ground speed and whose knee flexion is solved from the *clearance* it must produce.
  `enemyView.ts` applies it, and `tests/unit/gait.test.ts` asserts the contact and clearance
  invariants across the cycle at nine speeds. The rule the module follows: a presentation
  constant that a *speed* should decide is a bug waiting for a sprint.

## Phase 07 additions: controlled highlights and the aimed picture

Presentation-only, and every number below is stated with the measurement it came from rather
than as a look preference (ADR-0019). The simulation is untouched, so `npm run replay` is
still the same 162 samples.

- **`renderer.ts` (the view-model light) and `quality.ts` (`LOOK_RIG`).** The weapon's own
  light is bounded by the scene it sits in — 1.1 cd is 7 lux on a receiver 40 cm away, about
  2.7x the moon key — because a light whose job is to reveal an object at arm's length has to
  be measured against the level the tone map is exposed for. The bloom kernel is tighter and
  its threshold higher (0.42 / 0.36 / 1.0): everything above the threshold smears, so the
  threshold has to sit in the gap between the scene and the emitters (an emissive prop is
  1.4–1.5). The muzzle light lost one stop. `LOOK_RIG` is shared by every tier, so this is
  one picture at all four settings, and `tests/unit/lighting.test.ts` holds the bounds.
- **`materials/weapon.ts` (`WEAPON_SURFACE`, `createLensMaterial`, `createDotMaterial`).**
  The highlight is a property of the surface: a broader lobe at a lower gain on the metals
  (`roughness` 0.56 / `metalness` 0.66 / `envIntensity` 0.9 on gunmetal), with the dielectric
  surfaces (glove, sleeve) taking *more* sky, because a matte surface is where the
  environment reads as form and a hand lit by the sky cannot blow out. The lens transmits
  88% of the world through the pair, and the reticle's brightest channel sits at the bloom
  threshold — asserted against `LOOK_RIG.bloomThreshold`, so an aiming mark can never become
  a glow.
- **`weapon/layout.ts` (`POSE.eyeRelief`, the optic parts, the reticle).** Apparent size is
  `2 atan(radius / distance) / fov`, so the optic is sized by distance and by wall thickness:
  17 cm of eye relief (aperture 20% of the frame, housing 24%), a 2 mm rim, and a 2.4 mm dot
  in a 5.2 mm ring on the optic's axis. The constrained number is the eye relief — *the
  largest distance every weapon can still be held at*, because the support grip is a point on
  the weapon and `arm_short_left_1` fires if the hand leaves its arm's reach.
- **`viewmodel.ts` (aim stability).** At ADS the weapon's positional and rotational drift
  scales by `1 - 0.65 * adsT` while the recoil push-back along z stays: the HUD crosshair is
  hidden while aiming, so anything that moves only the weapon moves the *reticle* off the
  point of aim, and a sight that lies is worse than a crosshair. The idle breathing is ~5 px
  at 1080p, from 20.

## Phase 08 additions: a surface is a physical identity

Presentation-only again, and this pass is the widest one so far in *scope* and the narrowest
in *mechanism*: the seventh review's eighteen items were all one problem — a surface's
physical response living in three places at once (ADR-0020). The fix is a single table, and
every item is then a value that can be checked.

- **`materials/surfaces.ts` (`SURFACE_SPEC`, `SURFACE_CLASSES`, `Weathering`, `weathered`,
  `WEATHER`, `WEATHERED_CLASSES`).** One row per surface class, holding what the surface *is*:
  family, roughness (and how much the relief and the painted field move it), metalness plus
  its reading mode, relief, normal scale, environment intensity, and the amplitudes of the
  three storytelling scales (macro / mid / micro). Nineteen classes. A material is a *variant*
  of a class (`specFor('asphalt', { aoIntensity: 0.9 })`), and the recipe that draws the maps
  reads the same row — which is what makes the map and the material unable to disagree, and
  what makes "no half-metals", "no two classes collapse", "roughness spends its range" and
  "every class has a large-scale story" unit tests rather than opinions.
- **`materials/materials.ts` (`applyWeathering`, `WEATHERED_MATERIALS`, `grime`, `roadPatch`,
  `scorch`).** Weathering is part of the atmosphere, not a filter over a fixed world: a preset
  declares `{ wetness, dust }` (`level/timeOfDay.ts`) and every exposed material answers it.
  It is **idempotent by construction** — the arithmetic runs against the values the recipe
  authored (`userData.baseRoughness` / `baseEnvIntensity`), never against the current ones —
  so an atmosphere switch can be applied twice, and a dry clean hour restores the library
  exactly. Three new materials are *substances* rather than tints: contact grime (the film a
  surface collects at its contact line), patched asphalt (darker and smoother, because new
  binder has not been worn rough yet), and a burn mark (the decal sprite as a stain, with a
  polygon offset and no depth write, so it can never fight its own host surface).
- **`level/timeOfDay.ts` (`weather`).** The two hours are two different *worlds*, not two skies:
  dawn is dry and dusty (0.5 dust, 0.1 wetness) and dusk is the damp end of a night (0.45
  wetness, 0.12 dust). The dust is deliberately on the bright preset — a fine layer of settled
  sand takes the edge off specular clipping in a hard low sun, which is both what a dusty
  street looks like and a readability win.
- **`geometry.ts` (`shiftUv`).** Repetition breaking as arithmetic: every building shell
  samples its own window onto the three shared facade maps. It *clones* before it offsets,
  because `withAoUv` hands `uv1` the same attribute object as `uv` (AGENTS.md entry 22) and
  sliding it would drag a wall's occlusion into its new texture window.
- **`level/arena.ts` (road wear, the car, the walls).** History instead of tiling: sand drifts
  banked against both kerbs (which is also the road/sand *transition*), repairs, burn marks,
  a grime band along rocker panels and around wheel arches, a ground-level grime band and a
  drainpipe on the walls, and a car whose paint is a clearcoat over a base coat, whose glazing
  is four thin panes over a real cabin (seats, a bench, a dashboard, a wheel), and whose tyres
  are tread, sidewall and rim as three surfaces.
## Phase 09 additions: geometry as construction

PHASE 04 of the seventh review is about shapes (ADR-0021), and the pass that answered it also
repaired four defects the previous one had introduced — a grime belt floating clear of every
building, a car's dirt sized twice the car's width, a bevel rule that melted small parts, and a
window whose glass stood in front of its own frame (AGENTS.md 35–38).

- **`geometry.ts` (`bevelFor`, `BEVEL_SHARE`).** A bevel is a *rule*: absolute up to the part's own
  size, then a 12% share of it, then never past a third — that last clamp applied **after** the
  floor, because the first version of the fix could violate its own limit on a 4 mm plate. Every
  `roundedBox` in the arena and on the weapon obeys it now, which is why small parts stopped
  reading as lozenges.
- **`level/detail.ts` (`DETAIL`, `detailFor`, `tierBevel`).** The asset-importance budget, as data:
  `hero` / `mid` / `far`, each with a bevel, a segment count, whether secondary forms are built and
  a line saying what the tier is for. A **quality tier may never read it** — a player on `low` is
  looking at the same world (ADR-0014/0017) — and `tierBevel` keeps a hero bevel from melting a
  hero screw.
- **`level/arena.ts` (`windowConstruction`, `buildFacadeDetail`, `buildCarHardware`).** An opening is
  construction: a lintel and a sill proud of the wall with the glass 14–18 cm behind their outer
  edge, because a shell is one solid box and the *reveal* is the shadow, not the hole. Attached
  forms are what make a block a building — an entrance with a canopy on struts, a service box and a
  louvred grille, a balcony with brackets, pilasters, a paved apron and a ring of bollards around
  the monument — and each of them casts the shadow that reads as architecture at 20 m. The car's
  hardware (shut lines, a handle, a mirror on a stalk, arch lips, lamps in housings, a grille of
  slats) is grouped behind `DETAIL.hero.secondary`, and the hull's half-width is passed in rather
  than re-derived: deriving it from the profile's length is AGENTS.md entry 36.
- **`level/arena.ts` (kerbs, barriers, sand).** Ten kerb segments per side with a centimetre of
  line variation and one in six broken, a grime gutter along each, barriers with an RNG profile and
  a spalled corner one time in three, and sand drifts around the sandbag stacks: repetition broken
  without a single new texture (items 3, 4, 10, 11).
- **`materials/materials.ts` (`brass`).** One material that was being built inside the arena builder
  is back in the library, which is what keeps it inside the physical table and inside the weather.
- **`renderer.ts` (`renderDebug().materials`) and `apps/game/src/debugApi.ts`.** The pass's
  claims are numbers, so they are reported: `__IV__.materials()` gives both hours' weather and
  every weathered material's *live* roughness / metalness / environment intensity. Reporting
  the live values rather than the spec table is the point — a road's numbers change with the
  hour, and a probe has to be able to see that they changed.
- **`materials/pbr.ts` (`roughnessSwing`, `swingChannel`, `effectiveRoughness`, `applySurfaceMaps`).**
  A surface map states *where* a surface is glossier than its material; the material states *how
  much* (ADR-0022). three's `roughnessmap_fragment` **multiplies** `material.roughness` by the map's
  green channel, so a map carrying an absolute roughness is multiplied by one — the surface's gloss
  *squared*, at a rate set by its own smoothness (water 0.06 shaded at 0.004; the view model's
  receiver 0.56 shaded at 0.235, a mirror). The map is a signed swing centred at 0.5 and
  `applySurfaceMaps` replaces the stock chunk with an additive one, `customProgramCacheKey` included
  (without it three caches the stock program for the injected source and never selects this one).
  It is called from `material()`, which is the single factory both the level and the view model
  build through, and from `characters/uniform.ts`'s `sheened()` — the second and last place a
  material is built from surface maps outside that factory.
- **`post/ao.ts` (`AoOptions`, `occlusionAt`, `BLUR_FRAGMENT`) and `renderer.ts` (`aoOptionsFromQuality`).**
  Two numbers that were wrong in opposite directions. The sample ramp (`radius * (0.15 + 0.85u)`, so
  the nearest sample is 10.5 cm) exists because **a contact term that cannot reach 5 cm cannot ground
  a tyre**; `bias` is a cosine of the occluder's minimum elevation, so 0.06 accepted an occluder
  barely above the surface's own plane and a *flat* road measured 0.80 of unoccluded. The bilateral
  denoise's tolerance now carries a footprint term computed from the two axial neighbours, because a
  tolerance derived from world distance collapses on a grazing plane and the blur was weighting every
  tap to zero — the AO buffer was byte-identical on and off. `renderDebug().ao` reports `bias`,
  `thickness` and `samples`, so the argument is about the numbers that actually ship.
