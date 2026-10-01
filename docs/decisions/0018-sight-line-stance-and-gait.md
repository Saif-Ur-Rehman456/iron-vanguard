# ADR-0018 — The sight picture, the stance and the walk are all arithmetic

Status: accepted (fifth review)

## Context

The fifth report was six items in three sentences: *the scope/ADS is black*, *the pistol is
tiny and incomplete and has no hands*, *the AK-47 is not complete*, *the enemies' walk must be
realistic like COD*, *Shift must sprint realistically*, and *C crouch / Space jump, not
robotic*. The frame attached to it was the useful artefact: a large opaque dark ellipse
centred over the plaza, banded brown and black, with an M4 and a 240-round reserve on the HUD.

Three properties of that report shaped the whole response:

1. **None of the three failures was cosmetic.** The black scope was geometry standing in
   front of the eye; the incomplete pistol was a *layout* (a carbine, wearing a pistol's
   numbers); the stiff walk was a single sine per leg. A better shader, a bigger mesh or a
   nicer animation curve would have changed none of them.
2. **Each one reduces to one ray or one number**, which means each one is checkable without a
   GPU. The sight line is one ray through the optic. The pistol's failure was a hip hold at
   0.17 m right and 0.31 m down on a 75° camera — inside the frustum, below the frame. The
   walk's failure was a 0.96 m straight leg whose sole sits 10 cm above the ground when swung
   26°. All three are arithmetic, so all three could be gated in `npm test` (which is also why
   they survived so long: they are invisible in code review and take one ray to prove).
3. **Two of the six asks did not exist to fix.** `C` was bound to nothing and `Space` was
   bound to a `jump` **action** that no system consumed. The prototype had no crouch at all.
   So this ADR covers new *systems*, not only corrected geometry, and the constraint that
   shaped them is invariant 1 of `AGENTS.md`: the simulation cannot touch the platform, and
   the golden trace cannot move.

## Decision

### 1. The optic is a tube with an aperture, not a cylinder with two dark lenses

The shipped optic was three pieces of geometry on one axis, and each one blocked the view:

| part | was | now |
| --- | --- | --- |
| `optic_tube` | capped `CylinderGeometry` — a 3.8 cm opaque disc, 12 cm from the eye | `open: true`, i.e. open-ended and double-sided, so the player sees the tube's inner wall and then the world |
| `optic_bezel` | capped cylinder, same axis | a `ring` with `innerRadius` 18.5 mm: an aperture with a rim, not a face |
| `lens_rear` / `lens_front` | dark glass at 0.4 opacity, stacked twice — a 60% black filter | thin rings (`0.004 m` thick) at `radius 0.0175`, the aperture between them clear |
| `optic_turret` / `optic_knob` | centred on the tube's axis, i.e. standing *in* the aim point | off-axis: the elevation turret above the tube, the windage knob on its side |
| `optic_mount` | a block as tall as `opticMount` (30 mm), overlapping the lower 19 mm of the tube | `opticMount - 0.019` — the aperture's lower half is clear |
| reticle | none | `dot` (ring, r 2.5 mm) with a `dot_halo` (r 6 mm) so a red dot reads at 12 cm eye relief |

The red dot is a ring, not a disc, for the same reason the bezel is: the *sight line* has to be
clear, and the dot only has to be visible.

### 2. Every weapon is built from its archetype

`weaponLayout(def)` switches on `def.viewModel.archetype` — `carbine` / `ak` / `pistol` — and
each archetype has its own part set, not a scaled copy:

- **`carbine`** — receiver, rail, red-dot optic (above), handguard, magazine.
- **`ak`** — gas tube and gas block *above* the bore and visible over the handguard, walnut
  handguard and stock, a magazine that rocks forward in four segments, a right-side bolt
  handle, a slant brake, and **iron sights** (a leaf at the receiver's front, a post on the gas
  block) rather than a red dot: `eyeRelief` 0.28 m, sight line 5 cm over the bore.
- **`pistol`** — slide with front and rear cocking serrations, an ejection port and extractor,
  a raked grip with panels, the magazine inside the grip, a trigger and guard, a hammer, a
  beavertail — and a rear sight that is a **notch** (two shoulders, a 5 mm gap, a floor below
  the sight line) instead of the full-width blade that shipped, which is a pistol you cannot
  aim with.

The archetype decides the *pose* too, which is the part that made the pistol read as "tiny and
incomplete": it is held at the end of the arm (`eyeRelief` 0.3 m) with a two-handed grip whose
support hand is 5 cm forward of the firing hand on the frame, and its hip hold is inboard and
*up* at chest height. The shipped numbers (0.17 m right, 0.31 m down) are a rifle's low-ready
applied to a 27 cm weapon: on a 75° camera the whole gun was below the bottom of the frame.

`layoutProblems()` range-checks the result **per archetype** — a pistol must be 19–36 cm
overall and put its muzzle 0.32–0.62 m from the eye; a rifle 50–98 cm and 0.5–0.85 m — so
"the weapon is the wrong size" fails a test instead of passing as plausible.

### 3. ADS is solved from the optic, not read from content

`posePosition(def, layout, adsT)` now solves both ends of the aim blend from the layout:

```
ads.y = -optic.height                          // the sight line lands on the camera axis
ads.z = -(layout.eyeRelief + optic.rear.z)     // the rear lens sits eyeRelief from the eye
hip   = hipPose(layout)                        // hip depth from the support arm's reach
```

Content's `m4.viewModel.ads[1] = -0.178` (a carbine number, applied to every weapon) put the
sight line 10 cm below the crosshair — AGENTS entry 13 — and gave the AK and the pistol a pose
belonging to a weapon they are not. Both ends are reachable in every layout, and the blend is
linear, so `|lerp(A, B, t) - S| <= max(|A - S|, |B - S|)`: checking the two endpoints and the
midpoint (which is what `layoutProblems` does, via `armReaches`) covers the whole blend.
`ADS_FOV`/`HIP_FOV` are exported so the framing is asserted rather than assumed.

### 4. The check for a sight picture is a ray, because the defect is a ray

`tests/unit/sightPicture.test.ts` builds every weapon the way the view model builds it — the
real `partGeometry`/`partMaterial`, the real part transforms, the real ADS pose — and casts
`THREE.Raycaster` rays along the sight line: from just behind the rear lens, through the
aperture, out to the world. No GPU is involved (`Raycaster` is matrix and triangle
arithmetic), which is the entire reason this is a test and not a screenshot request. It found
the mount's 19 mm overhang on its first run.

### 5. Stance is simulation state, and a no-op for a player who does not use it

Crouch and jump are gameplay, not camera tricks: the eye height enemies aim at, the player's
own shot origin and the crown of the player's head all resolve through one function,
`playerEyeHeight`, in `packages/sim/src/player.ts`. So:

- `crouch` is a **command** (held state) and `jump` an **action** (edge), both consumed in
  `stepWorld`'s existing `actions` step — invariant 2, the tick order, is untouched, and a
  jump replays like any other command.
- `crouch` scales movement (a fraction of the walk/sprint speed), forbids sprint, lowers the
  eye, and changes the aim the AI solves for (a crouched player is a smaller target).
- The camera rig and the view model only **read** it (`crouchK`, `land`, `airborne`), which is
  invariant 4: presentation reads, it never writes.

**The golden trace does not move, and that is designed rather than lucky.** A grounded body's
`pos.y`/`vel.y` are zeroed instead of integrated, and `hashWorld` pushes both vectors — so a
replay that never presses `C` or `Space` hashes *bit-identically* to before. `npm run replay`
reports 162 samples matching `tests/golden/prologue.seed7.hash`. If a future stance change
cannot make that statement, it is a golden re-record, and it must be argued as one.

### 6. The walk is a solved chain, not a sine

The shipped walk was one line — `leftLeg.rotation.x = sin(phase) * 0.8`, mirrored. One joint
means a rigid leg, and a rigid leg cannot walk: swung 26° it lifts its own sole 10 cm and never
corrects (the squad *skated*), and with no knee there is no swing phase and with no ankle no
heel strike or toe-off. The legs are now a **three-segment chain** — thigh 0.42 / shin 0.46 /
foot 0.08, summing to the same 0.96 m hip-to-sole the body was already built with — driven by
`GAIT`:

- **cadence and stride are solved from ground speed** (`strideFor`), so a 3.2 m/s enemy is
  *running* (~3 steps/s) and a 1.4 m/s one is walking (~1.7), instead of both being the same
  shuffle at a different clock rate;
- **the swing-phase knee flexion is solved from the clearance it must produce**
  (`swingClearance`), not authored as an angle — the other way round means picking a knee angle
  and hoping the foot clears;
- **every knee and ankle amplitude is stated at the reference walk and scaled by the hip
  swing**, because a slow shuffle bends a knee 35° and a sprint 80°, and a constant bends the
  same knee for both;
- the knee only ever flexes (the shin swings behind the thigh), so every term is subtracted —
  a sign error is a knee bending the wrong way, which the test would catch as a foot through
  the floor.

`tests/unit/gait.test.ts` samples the whole cycle at nine speeds and asserts the two things
that make a walk read as a walk: **the planted foot is on the ground and never below it**, and
**the swing foot clears by the authored height** — plus that the knee only flexes, that the
right leg is the left leg half a cycle later, and that one cycle covers exactly the distance
the body travelled.

### 7. Sprint is a carry, and it is presentation

Sprint speed, the sprint gate and the FOV punch are prototype parity and were already correct
in the simulation. What was missing is what a run *looks like* from the player's own eyes: the
weapon comes in across the chest and the muzzle drops and swings left (`sprintK` terms in
`viewmodel.ts`), paired with a faster, larger bob and a torso roll. Parity's 0.07 m drop with
no rotation left the rifle shouldered and pointed where the player was aiming — i.e. running
while aiming, which is not a run. Crouch adds a small drop and inboard shift, and a jump is
*blended* (`airBlend`, 0.2 per frame) rather than switched: a 0.46 s jump that snaps between
two holds reads as a teleport.

## Consequences

- **Two new GPU-free contracts, and they are the reason this pass could be verified at all:**
  `tests/unit/sightPicture.test.ts` (the aperture is clear, from behind the rear lens to the
  world, for every weapon) and `tests/unit/gait.test.ts` (the walk's contact and clearance
  invariants) — plus `tests/unit/stance.test.ts` (a jump leaves the ground and lands at exactly
  zero; a player who never crouches hashes as before) and `tests/unit/weaponMaterials.test.ts`
  (the lens and dot factories).
- **What is still only checkable by eye** is handed to the user in `docs/CAPTURE_REQUEST.md`
  phase 06: whether the sight picture *frames* the world the way an optic should, whether the
  pistol and the AK read as complete weapons in the hand, and whether the walk reads as COD's.
  A ray cannot answer "does it look right"; it can answer "is anything standing in front of the
  eye", and that distinction is the point of this ADR.
- **`docs/ARCHITECTURE.md` gained a section** for the three new seams
  (`weapon/layout.ts`'s archetype switch, `sim/src/player.ts`'s stance, `uniform.ts`'s gait),
  because a reviewer looking for "where does crouch live" should not have to guess between
  presentation and simulation.
- **The pistol and the AK cost ~350 lines of layout data**, which is the honest price of "three
  weapons that are three weapons" instead of one weapon in three colours.

## Alternatives considered

- **Make the optic a shader effect** — render the sight picture as a separate pass or a
  texture. Rejected: the aperture is a hole in geometry, and a hole in geometry is free. A
  render-to-texture sight would add a camera, a target and a pass to fix a *cap*.
- **Crouch as camera-only (lower the rig, leave the sim alone).** Rejected: it is the classic
  cheat that breaks the game's honesty — a crouched player would be exactly as tall to incoming
  fire as a standing one, and the enemy aim code would keep solving for an eye that is no
  longer there. `playerEyeHeight` exists so there is one answer, not two.
- **Record a new golden for the stance work.** Rejected: not needed. Designing the stance so a
  grounded body's vertical state is *zeroed* rather than integrated keeps the trace
  byte-identical, and a golden re-record should be a gameplay decision, never a convenience.
- **Author the walk as a keyframed cycle (a table of joint angles per phase).** Rejected for
  the same reason the run cycle's cadence is solved: a table is authored at one speed, and this
  squad walks, runs and limps. Solved terms stay correct at every speed the spawner asks for.
