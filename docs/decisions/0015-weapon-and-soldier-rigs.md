# ADR-0015 — The weapon and the soldier are rigs, and their invariants are tested

- Status: accepted (Phase 03, realism pass 2)
- Supersedes nothing. Extends ADR-0005 (procedural first art) and ADR-0011 (realism
  without borrowed assets). Departs from the prototype's view model and enemy body in
  `legacy/PARITY_NOTES.md`.

## Context

Two of the review's complaints were the same defect wearing different clothes: *the gun
is not held by a man*, and *the enemies do not read as real soldiers*. Both were
arithmetic, and neither was visible in a screenshot without knowing what the numbers
should be.

**The view model was a plank.** `viewModel.body[2]` (0.44) was used as `depth * 1.5` for
the receiver, so the receiver alone was 0.66 m on a 44 cm weapon; the muzzle sat 1.36 m
from the eye at ADS; the butt never reached the shoulder; both gloves were built on the
weapon's centre line with four finger boxes each; the arms were two plain `fabric` boxes;
and the pose kept content's parity numbers verbatim (`ads[1] = -0.178`), which put the
optic 10 cm *below* the crosshair — the player was aiming off the top of the receiver.

**The squad faced backwards.** An axis probe of the built body (three's own matrix math,
no GPU) found the simulation's forward is local **-z**: `yawFromDirection` is
`atan2(-dx, -dz)`, the muzzle points -z, the aim laser extends along -z, and the death
animation falls forward along -z. The kit did not agree:

- goggles, NVG mount, chest pouches, chest knife, hip pouches, kneepads, boot toes, thigh
  holster and the radio antenna were all authored at **+z** — the squad wore its vest,
  face and boots backwards and carried its pack on its chest;
- the arm rest rotations were **negative** (`leftArm.rotation.x = -0.95`), which for a
  -z-forward body swings the hand *behind the hip*, and the aiming pose went further
  negative (-1.45): a soldier raised its weapon by swinging both arms backwards;
- the rifle hung 0.72–0.78 m from the support shoulder while a 1.8 m soldier's arm is
  **0.62 m** from shoulder to glove, so it could not be held with two hands at all;
- and the archetype colours are dark olive / dark brown / dark grey, which under a 2.6 lux
  moon render as flat black cut-outs with no interior detail.

## Decision

**1. Rigs are data, and the data has invariants.** `packages/render/src/weapon/layout.ts`
holds every view-model part at an armourer's real size (`MM`: 21 cm receiver, 8.5 mm rail
slots, a bore 6.8 cm under the sight line), the anchors, the pose solve and the arm rig,
and states its invariants in `layoutProblems()`. `packages/render/src/characters/uniform.ts`
does the same for the soldier: `front()`/`back()`/`KIT` name which side a piece of kit is
worn on, `deriveUniformPalette` builds the value ladder, and `solveCarry` finds the
weapon's rotation in the hand. Both modules are pure (three's maths only, no meshes, no
DOM), which is why a unit test with no GPU can check them.

**2. The pose is solved, not typed in.** For the player: `y` so the sight line lands on
the camera axis, `z` so the rear lens sits 12 cm from the eye at ADS and the muzzle 0.74 m
(0.85 m at the hip), and the hip depth from the support arm's reach. For the soldier:
`carrySolution()` searches the weapon's rotation in the hand for the low-ready carry whose
support grip sits inside a 0.62 m support arm (it lands at 0.62–0.67 m depending on the
muzzle-angle preference) and derives the aiming rotation from "the muzzle points level at
the player".

**3. Hands belong to the weapon, arms point at them.** Both rigs solve the support arm
from the weapon's *actual* position rather than a pose assumed at build time: the player's
elbows come from a two-bone IK (`solveElbow`, with the reach clamped so a limb is never
asked to be longer than it is), and each soldier's support arm is re-aimed every frame
from `carryPoint`. Where the geometry cannot reach — the soldier's aiming pose leaves the
support grip 0.20 m beyond the arm, a property of a 0.44 m-shouldered skeleton — the glove
is a child of the *weapon*, so the wrist ends 20 cm behind a glove that is already on the
handguard. A gap between glove and sleeve is the tell; an overlap is invisible.

**4. Darkness is a value problem, not a brightness one.** The uniform palette keeps
content's hue exactly and lifts each garment's albedo in linear space by a fixed ladder:
jacket 2.1×, pouches 1.75×, trousers 1.5×, helmet 1.35×, belt 1.25×, carrier 1.15×, boots
1.0× (content's own value). Every adjacent pair differs by at least a quarter of its
luminance, nothing is darkened, and nothing exceeds 2.5×. Garments get a cool sheen
(`MeshPhysicalMaterial`, `RIM`) so their *edges* catch the moon, which is what makes a dark
figure legible at night.

## Evidence

- `tests/unit/weaponRig.test.ts` — carbine dimensions, the sight line on the camera axis,
  the muzzle distance, and the invariant that both hands are inside both arms at every aim
  blend (60–90% extension), plus `solveElbow`'s clamp and degenerate cases.
- `tests/unit/uniform.test.ts` — the kit sides, the palette ladder and hue preservation,
  the sheen, and the carry: reach, aim direction, low-ready direction, and the whole
  rest→aim blend staying inside 0.5–0.9 m of the support shoulder.
- `tests/unit/texel.test.ts` — the weapon's per-metre tiling, which is why the receiver
  reads as metal instead of brushed stripes.
- `window.__IV__.weapon()` reports the built layout, the per-surface tile sizes and the
  world-space joints; frames 3.1–3.5 of `docs/CAPTURE_REQUEST.md` are the manual capture.
