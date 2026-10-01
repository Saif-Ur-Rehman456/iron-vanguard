# ADR-0019 — Controlled highlights, and an optic that is a sight rather than an object

Status: accepted (sixth review)

## Context

The sixth report came with two frames and both of them were measurable rather than
debatable.

**Frame one, hip fire.** The M4 sits in the bottom right of an otherwise correctly exposed
night plaza, and three things on it are pure white: a ball where the optic is, and two
streaks along the rail and the flash hider. Everything bright enough to clip also blooms,
so each one carried a halo over the scene behind it. The player's own words were "the
highlights and bloom become excessively intense and visually spread across the camera view…
a washed-out, glowing appearance that affects the entire screen".

**Frame two, aimed.** The optic is enormous — its tube runs from the HUD's wave banner down
past the bottom third of the frame — the world inside the glass is a flat grey disc with a
faint image behind it, and the reticle is a soft pink blob about 50 px across.

Neither is an art-direction problem, and neither is a shading-library problem. Both are
numbers that were never multiplied together before:

| | measured | why it looked like that |
| --- | --- | --- |
| view-model light | **17 lux** on a receiver 40 cm away | the moon key is 2.6 lux: the weapon was **6.5x the scene** |
| weapon specular | `roughness` 0.44, `metalness` 0.72 | a narrow lobe collects 17 lux into a highlight that clips past 1.0 |
| bloom | strength 0.55, radius 0.5, threshold 0.9 | a wide, strong kernel on everything that clipped |
| eye relief | **12 cm** at a 1.36x zoom | a 46 mm housing is `2 atan(23/120)` = **21.7° of a 55° frame**, i.e. 39% |
| lens glass | 0.16 opacity ×2, env 1.7 on 0.04 roughness | a 30% grey veil plus a two-way mirror across the aperture |
| reticle | a **12 mm disc** | ~10% of the frame's height: light, not a mark |

The requirement that ties them together is one sentence from the report: *"The lighting must
become controlled and gameplay-friendly."* Not darker, not flat, not prettier — controlled.
The same is true of the optic: *"improve aiming rather than obstruct gameplay."*

## Decision

### 1. The view light is bounded by the scene it sits in, not by the weapon

The view-model light exists because the weapon and the hands have to read at night (ADR-0017:
"the gun has no hands"). Its intensity has now been wrong in both directions, so the
arithmetic is written down where the light is built: **1.1 cd is 7 lux on a receiver 40 cm
away, about 2.7x the moon key on the street behind it.** That is bright enough that a
knuckle, a wrist and a sling loop each hold their own value, and dim enough that a highlight
is light *on a surface* instead of brightness in the air. A light whose job is to reveal an
object 40 cm away has to be measured against the scene's own level, because that is what the
tone map is exposed for.

### 2. The highlight is spread, not removed

The same 7 lux still has to land somewhere, so the surfaces it lands on were re-authored:

| surface | was | now | why |
| --- | --- | --- | --- |
| gunmetal | r 0.44 / m 0.72 / env 1.25 | r 0.56 / m 0.66 / env 0.9 | a broad lobe at a lower gain spreads the energy over ~10x the area |
| steel | r 0.52 / m 0.6 / env 1.15 | r 0.62 / m 0.55 / env 0.85 | same, and it keeps the barrel separate from the handguard |
| polymer, wood | env 0.95 / 0.8 | env 0.85 / 0.75 | matte parts have no highlight to control; they only add sheen |
| leather, sleeve | env 1.15 / 1.0 | env 1.2 / 1.05 | **the dielectric surfaces take the difference** |

That last row is the important one. A matte surface is where the sky reads as *form*, and a
hand lit by the sky cannot blow out — so when the point light came down, the soft surfaces
took more of the environment rather than less. The metals kept their colour, their normal
maps and a real specular lobe: this is controlled realism, not a flat weapon.

### 3. Bloom is for emitters, and it is a kernel, not a wash

`bloomStrength` 0.55 → **0.42**, `bloomRadius` 0.5 → **0.36**, `bloomThreshold` 0.9 →
**1.0**. The threshold sits in the gap between the scene and the emitters: an emissive prop
is 1.4–1.5 (a lit window, the firepit's coals, a soldier's goggles), and a weapon surface
under its own view light must not reach 1.0. The radius is what stops a lamp's pool from
being a wash over the scenery behind it. `muzzleLightIntensity` 60 → **26 cd** — one stop:
a burst is still the brightest thing in the frame for 40 ms, and the ground a metre ahead
is no longer four stops over the street. The look rig is shared by every tier, so all of
this is one picture (ADR-0014), and `tests/unit/lighting.test.ts` holds the bounds.

**What was not touched:** the exposure (1.24), the tone curve, the AgX map, `LOOK.fog*`, the
key/ambient ratios, the highlight shoulder, and every tier's cost table. The frames the
review liked are the frames this keeps.

### 4. The optic is sized by the frame, and the frame is what the player aims at

The optic's size on screen is `2 atan(radius / distance) / fov`, and at the aimed FOV of 55°
(1.36x — itself an earlier, deliberate deviation from the prototype's 42) the only honest
lever is the distance. `POSE.eyeRelief` 0.12 → **0.17**:

| | before | after |
| --- | --- | --- |
| aperture (35 mm) | 30% of the frame's height | **20%** |
| housing (41 mm) | 39% | **24%** |
| rim, as a share of the optic's diameter | 30% (a 5.5 mm wall) | **11%** (2 mm) |

**0.17 and not 0.19, and the reason is the arms.** The support grip is a point *on the
weapon*, so moving the optic away moves the hand away with it: at 0.19 the kr74's support
hand sat 99% along its own arm and `arm_short_left_1` fired — the rig invariant from the
third review, doing its job. So the eye relief is *the largest distance every weapon in the
loadout can still be held at*, and the constraint is documented in `POSE` rather than
discovered later. Making it larger needs the support hand to slide back along the handguard
as the weapon comes up, which is a real solve and is noted as the next step instead of
half-done here.

### 5. Glass you can see through, and a reticle that is a mark

- **Lens: 0.06 opacity, `envMapIntensity` 0.45, roughness 0.08.** Two lenses stack, so the
  shipped pair was a 30% grey veil with a mirror sheen on top; two at 0.06 transmit 88% of
  the world. There is still a tint — you can see it at the lens's edge, which is what makes
  it read as glass rather than as a hole.
- **Reticle: a 2.4 mm dot inside a 5.2 mm ring**, both on the optic's own axis. The dot is
  the precision cue (14 px of a 1080p frame — a dot you can put on a head) and the ring is
  the acquisition cue, because a *shape* reads against pale pavement and against a muzzle
  flash where a plain red dot washes out. The whole reticle is 2.5% of the frame: 27 px,
  against the shipped 12 mm disc's ~106 px.
- **The reticle does not bloom.** It is unlit (`toneMapped: false`) and its brightest
  channel is *at* the bloom threshold, so it stays a crisp mark instead of a glow — a
  reticle whose centre is not where the round goes is worse than no reticle. This is
  asserted against `LOOK_RIG.bloomThreshold` in `weaponMaterials.test.ts`, so the two
  numbers cannot drift apart.
- **The turret and the knob are outside the whole aperture**, at `tube radius + their own`
  (0.0275), because the ray test now sweeps **95% of the aperture** (0.0175 of 0.0185)
  rather than its middle third. "Mostly out of the way" is a smudge at the edge of the glass.

### 6. The reticle is the point of aim, so the weapon may not drift off it

The HUD crosshair is hidden while aiming — that is what the optic is for — so anything that
moves *only the weapon* moves the dot off the crosshair, and a sight that lies about where
the next round goes is worse than a crosshair. Two consequences:

- **Aim stability.** At ADS the weapon's positional and rotational drift scale by
  `1 - 0.65 * adsT`; the recoil push-back along z stays, because that brings the optic
  closer without taking it off the axis. At the hip nothing is scaled, because that is where
  the motion belongs.
- **Idle breathing** came down from 3.5 mm to 1.1 mm: at 17 cm of eye relief, 3.5 mm is
  **20 px of reticle drift on a 1080p frame** — a sight picture moving faster than the
  target does.

### 7. Firing may not erase the sight picture

The muzzle flash is a sprite *and* a light, and the point that decides whether it can cover
the optic is geometric: from the eye, the flash anchor is further away than the optic's own
rear glass, the sprite is additive and **depth-tested**, and the optic is opaque and nearer.
So the burst is depth-culled wherever the housing covers it and reads through the aperture —
which is what "firing is loud" should look like. `sightPicture.test.ts` asserts the ordering
for every weapon, and the flash's own light is bounded in §3.

## Consequences

- **Four new GPU-free contracts, and they are the only reason this pass is verifiable
  here:** the aperture is a window and the rim is thin (`sightPicture.test.ts`), the reticle
  is small, centred and on the axis (`sightPicture.test.ts`), the flash is behind the optic
  (`sightPicture.test.ts`), and the metals spread a light instead of clipping it
  (`weaponMaterials.test.ts`) with the bloom kernel bounded (`lighting.test.ts`).
- **The eye relief is a documented trade, not a number that looks nice.** A *real* red dot
  lives 7–15 cm from the eye; 17 cm is a presentation distance chosen so that the optic is a
  quarter of the frame instead of a third, and the constraint that stops it going further is
  the arm rig, which is asserted.
- **What a test still cannot answer** is handed to `docs/CAPTURE_REQUEST.md` phase 07:
  whether the weapon reads as *lit* rather than *glowing*, whether the sight picture is
  usable at the tier the player plays on, and whether the reticle is legible against the
  pavement. A ray cannot say "that looks controlled"; it can say "nothing is standing in
  front of the eye", and the difference is the reason both exist.
- **The scene's exposure is unchanged**, which means a future complaint of "everything is
  too dark" is not answered by undoing this ADR — the light that was halved is 40 cm from
  the camera and touches nothing in the world.

## Alternatives considered

- **Cut the exposure or lift the tone curve** to stop things clipping. Rejected: exposure is
  scene-wide, and the complaint was about one object 40 cm away. Darkening the plaza to fix
  a highlight on a receiver is the wrong end of the same arithmetic.
- **Remove the view-model light** (or make it ambient). Rejected: it exists because the
  weapon measured as one black silhouette (ADR-0017), and the frames in this report show the
  opposite failure — the answer is a bounded light, not no light.
- **Render the view model in its own pass with its own FOV.** This is what an engine would
  do for a true game-space view model, and it would let the optic keep a mechanical 12 cm
  eye relief. Rejected *here*: a second render pass is a per-frame cost the frame budget
  (ADR-0016) has to pay for a weapon that is already 0.4 MiB of the build's budget, and the
  same framing is reachable by moving the weapon. Recorded as the honest alternative.
- **Keep the 12 mm reticle and make it dimmer.** Rejected: a dim blob is still a blob, and
  the requirement is a *mark* whose centre is the point of aim.
- **Suppress the muzzle flash's sprite while aiming.** It would work, and it would be a lie:
  the flash is light, not UI. The geometric fix (it is behind the optic and depth-tested)
  keeps the flash and the sight picture at the same time.
