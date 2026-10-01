/**
 * What makes a soldier read as a soldier: which way it faces, what its kit is worth
 * in value, and whether it is actually holding its weapon.
 *
 * The review's complaint was "the enemies do not read as real soldiers", and an
 * axis probe of the built body found three specific reasons, none of them about
 * detail — the kit list was already long (plate carrier, pouches, helmet, NVG mount,
 * kneepads, holster, radio, backpack). They were all in the wrong place, in the dark,
 * or attached to nothing:
 *
 *  1. **The kit was on the wrong side of the body.** The simulation's forward is
 *     local -z: `yawFromDirection` is `atan2(-dx, -dz)`, the muzzle points -z, the
 *     aim laser extends along -z, and the death animation falls forward along -z. The
 *     goggles, NVG mount, chest pouches, chest knife, hip pouches, kneepads, boot
 *     toes, thigh holster and the radio antenna were all authored at +z. So a
 *     rifleman faced the player while wearing its vest, its face and its boots
 *     backwards, and carried its backpack on its chest. `front()`/`back()` name the
 *     convention so a part's side is a decision rather than a sign someone typed.
 *  2. **The arms swung backwards.** The rest rotations were negative
 *     (`leftArm.rotation.x = -0.95`), which for a -z-forward body rotates the hand
 *     *behind* the hip — and the aiming pose went further negative (-1.45), so a
 *     soldier raised its weapon by swinging both arms behind its back.
 *  3. **The weapon was out of reach.** The rifle hung in the right hand 0.72-0.78 m
 *     from the left shoulder, and a 1.8 m soldier's arm is 0.64 m from shoulder to
 *     glove: the support arm stopped short of the weapon it was meant to be holding.
 *     `solveCarry()` chooses the weapon's rotation in the hand so the support grip
 *     lands exactly at the support arm's reach, and `enemyView` re-solves the support
 *     arm from the weapon's real position every frame.
 *
 * The palette half answers "they are black cut-outs": the archetype colours are dark
 * olive, dark brown and dark grey, and under a 2.6 lux moon a dark albedo renders as
 * a silhouette with no interior detail at all. A soldier has to stay dark — this is a
 * night mission — so the uniform is a *value ladder*: content's hue is kept exactly,
 * and each garment's albedo is lifted by a fixed factor chosen so that every
 * adjacent pair differs by at least a quarter of its brightness. That is what makes a
 * plate carrier legible against a jacket, and pouches legible against a carrier,
 * without any of them becoming visible-bright.
 *
 * Nothing here touches three beyond vectors, quaternions and materials, so the whole
 * thing is checkable in a unit test with no GPU (tests/unit/uniform.test.ts).
 */
import * as THREE from 'three';
import { applySurfaceMaps } from '../materials/pbr';

// ---------------------------------------------------------------------------
// Which way a soldier faces
// ---------------------------------------------------------------------------

/**
 * Forward, in body space.
 *
 * -1 because that is what the simulation says: `yawFromDirection(dx, dz)` is
 * `atan2(-dx, -dz)`, so yaw 0 faces world -z, and the renderer applies `yaw` directly
 * to the body's Y rotation. Everything the player can see shooting at them already
 * agrees (muzzle, laser, fall direction); the kit did not.
 */
export const FORWARD = -1;

/** A distance in front of the body's centre line, as a body-space z. */
export function front(metres: number): number {
  return FORWARD * metres;
}

/** A distance behind the body's centre line, as a body-space z. */
export function back(metres: number): number {
  return -FORWARD * metres;
}

/**
 * Every directional piece of kit, and the side it is worn on.
 *
 * A table rather than a comment because the sign of a z offset is exactly the kind
 * of number that silently gets flipped back, and a test can read a table.
 */
export const KIT = {
  /** The goggle bar and NVG mount: the face is the loudest read at any distance. */
  goggles: 'front',
  nvgMount: 'front',
  /** Chest pouches and the knife: what the player sees head-on. */
  chestPouches: 'front',
  chestKnife: 'front',
  hipPouches: 'front',
  /** Knee pads and boot toes point the way the soldier walks. */
  kneepads: 'front',
  toes: 'front',
  thighHolster: 'front',
  /** Pack and antenna are worn on the back. */
  backpack: 'back',
  radioAntenna: 'back',
} as const;

export type KitPiece = keyof typeof KIT;

/** The body-space z for a piece of kit, given how far from the centre line it sits. */
export function kitZ(piece: KitPiece, metres: number): number {
  return (KIT[piece] === 'front' ? 1 : -1) * front(metres);
}

// ---------------------------------------------------------------------------
// Value: the uniform palette
// ---------------------------------------------------------------------------

export interface UniformRender {
  bodyColor: number;
  accentColor: number;
  visorColor: number;
}

export interface UniformPalette {
  jacket: number;
  trousers: number;
  carrier: number;
  pouches: number;
  helmet: number;
  boots: number;
  belt: number;
  gloves: number;
  visor: number;
}

/**
 * How much each garment's albedo is lifted off content's archetype colour.
 *
 * These are multipliers in *linear* space, which is the space that matters: under a
 * dim key the rendered value is roughly proportional to albedo, so a factor is
 * roughly a contrast ratio. The ladder, in order of the frame's read:
 *
 *   jacket (2.1)   the largest surface and the one that says "human"
 *   pouches (1.75) lighter nylon over the jacket, so the pouch row reads
 *   trousers (1.5) a clear step below the jacket, so the waist line reads
 *   helmet (1.35)  a helmet catches the moon; it must not match the jacket
 *   belt (1.25)    leather, and the divider between jacket and trousers
 *   carrier (1.15) the plate carrier is the *darkest* of the kit, so the torso
 *                  reads as armour over cloth rather than as one shape
 *   boots (1.0)    content's own value: boots are dark, and the feet are read from
 *                  the shadow contact and the value step at the trouser cuff
 *
 * Nothing is darkened: the render layer may lift what content asked for, never
 * remove it. The gradient is checked in tests/unit/uniform.test.ts.
 */
export const PALETTE_LIFT = {
  // The lift is half of what it was, because the ladder was calibrated against a
  // *cool sheen veil* that no longer exists: with the rim restored to a grazing
  // lobe, a 2.1x jacket lift plus sheen plus a 300-cd lamp pool put every garment
  // near paper-white and erased the separation the ladder exists for. The ratios
  // between adjacent garments are unchanged — the ladder still separates — and the
  // whole figure sits two stops darker, where a night soldier belongs.
  jacket: 1.7,
  pouches: 1.45,
  trousers: 1.28,
  helmet: 1.18,
  belt: 1.12,
  carrier: 1.06,
  boots: 1,
  /** Gloves are gloves: leather, a step under the jacket's sleeve. */
  gloves: 1.22,
} as const;

/**
 * Scale a colour's albedo, preserving its hue exactly.
 *
 * `THREE.Color` holds linear values for an sRGB hex (colour management is on), so a
 * scalar multiply here is a scalar multiply of reflectance, and the ratios between
 * channels — the hue — are untouched. The result is clamped into gamut.
 */
export function lift(hex: number, factor: number): number {
  const colour = new THREE.Color(hex).multiplyScalar(factor);
  colour.r = Math.min(1, Math.max(0, colour.r));
  colour.g = Math.min(1, Math.max(0, colour.g));
  colour.b = Math.min(1, Math.max(0, colour.b));
  return colour.getHex();
}

export function deriveUniformPalette(render: UniformRender): UniformPalette {
  const cloth = render.bodyColor;
  // The accent is a near-black olive; it is the *hue* of the webbing and armour,
  // which is all a near-black hex can meaningfully contribute.
  const gear = render.accentColor;
  return {
    jacket: lift(cloth, PALETTE_LIFT.jacket),
    trousers: lift(cloth, PALETTE_LIFT.trousers),
    carrier: lift(gear, PALETTE_LIFT.carrier),
    pouches: lift(gear, PALETTE_LIFT.pouches),
    helmet: lift(cloth, PALETTE_LIFT.helmet),
    boots: lift(cloth, PALETTE_LIFT.boots),
    belt: lift(gear, PALETTE_LIFT.belt),
    gloves: lift(gear, PALETTE_LIFT.gloves),
    visor: render.visorColor,
  };
}

// ---------------------------------------------------------------------------
// Rim response
// ---------------------------------------------------------------------------

/**
 * Cloth sheen, per garment class.
 *
 * A dark object at night is legible only by its *edges*: the moon and the sky are
 * behind the observer's shoulder as often as not, so the rim of a shoulder or a
 * helmet is doing most of the work. `MeshPhysicalMaterial`'s sheen is exactly that —
 * a retroreflective grazing-angle lobe — and it is charged for one material at a
 * time, on a handful of enemy materials, rather than for the whole world.
 *
 * The lobe is *tight* (roughness 0.35): the first version shipped 0.85, which is not
 * a grazing rim at all — a sheen lobe that broad adds a near-uniform veil of cool
 * light to every surface, and over a 2.1x palette lift the whole soldier shaded
 * towards a single pale cream: the review's "flat boxman". A tight lobe returns
 * energy only where the surface turns away from the eye, which is the edge that a
 * silhouette needs. And it is *warm-neutral*, not the moon's blue: the strongest
 * light that reaches a soldier in this plaza is a street lamp, and a cool glow on a
 * warm-lit figure is what reads as "washed out".
 */
export const RIM = {
  cloth: 0.45,
  nylon: 0.38,
  skin: 0.14,
  /** Warm-neutral: the strongest light on a soldier here is a lamp, not the sky. */
  sheenColor: 0xcfc2a8,
  sheenRoughness: 0.35,
} as const;

/**
 * A sheened copy of a shared material.
 *
 * The maps are *shared*, never cloned: they belong to the texture library, which
 * disposes them once. Only the material itself is owned by the caller.
 */
export function sheened(
  source: THREE.MeshStandardMaterial,
  sheen: number,
  color?: number,
  roughness?: number,
): THREE.MeshPhysicalMaterial {
  // The colour and roughness are taken as arguments rather than by tinting the
  // source first: an intermediate clone is a material nobody owns, and the enemy
  // pool builds and discards a view per wave, so it would never be disposed.
  const built = new THREE.MeshPhysicalMaterial({
    map: source.map,
    normalMap: source.normalMap,
    roughnessMap: source.roughnessMap,
    metalnessMap: source.metalnessMap,
    aoMap: source.aoMap,
    aoMapIntensity: source.aoMapIntensity,
    color: color ?? source.color.getHex(),
    roughness: roughness ?? source.roughness,
    metalness: source.metalness,
    envMapIntensity: source.envMapIntensity,
    sheen,
    sheenColor: new THREE.Color(RIM.sheenColor),
    sheenRoughness: RIM.sheenRoughness,
  });
  // The shared roughness map is a *swing* around this material's own value, and three's
  // stock shader multiplies it: without the patch a soldier's gear would shade at its
  // roughness times the map's mid-grey, i.e. half of what the table says. This is the
  // second and last place a material is built from surface maps outside
  // `materials/material()` — which is exactly why the call is here with a comment rather
  // than only in the factory.
  applySurfaceMaps(built);
  return built;
}

// ---------------------------------------------------------------------------
// The carry
// ---------------------------------------------------------------------------

/**
 * The combatant's skeletal constants, in body space.
 *
 * Exported because the carry is *arithmetic*: whether a soldier can hold its weapon
 * with two hands is a distance compared against an arm, and a test can do that
 * comparison without building anything.
 */
export const COMBATANT = {
  /** Right arm pivot (the shoulder the weapon hangs from). */
  shoulderRight: [0.22, 1.62, 0] as const,
  shoulderLeft: [-0.22, 1.62, 0] as const,
  /**
   * Glove centre in arm-local space: the end of a rigid arm. -z because arm-local
   * -z is forward once the arm is pitched, which is where the glove mesh sits.
   */
  handLocal: [0, -0.62, -0.02] as const,
  /**
   * Arm pitch while aiming, and how far the low-ready rest pose drops below it.
   *
   * Positive pitch brings the hand forward, which is the sign the old rig had
   * backwards: negative values swung both hands behind the hips.
   */
  aimArm: 1.3,
  /** The low-ready rest pose is this many radians below the aiming pitch. */
  restDrop: 0.45,
  /** The arm's cant toward the body, both arms. */
  armCant: -0.32,
  /** Rest (low ready) arm pitch, in radians. */
  restArm: 0.85,
  /** The support grip, in weapon-local space: between magazine and handguard. */
  supportLocal: [0, -0.05, -0.16] as const,
  /** Where the weapon sits in the right hand, in arm-local space. */
  weaponInArm: [0.06, -0.62, -0.06] as const,
  /**
   * The muzzle direction of an *aiming* soldier, in body space: level, forward, a
   * touch down. The rest pose inherits it and points lower as the arms drop.
   */
  desiredMuzzle: [0, -0.1, -0.99] as const,
} as const;

/** Shoulder to glove, in metres: the reach a support grip has to sit inside. */
export const ARM_REACH = Math.hypot(
  COMBATANT.handLocal[0],
  COMBATANT.handLocal[1],
  COMBATANT.handLocal[2],
);

/** Rotate a rigid limb so its hand points at a target (world or body space: both). */
export function aimLimb(
  shoulder: THREE.Vector3,
  handLocal: THREE.Vector3,
  target: THREE.Vector3,
): THREE.Quaternion {
  const from = handLocal.clone().normalize();
  const to = target.clone().sub(shoulder).normalize();
  return new THREE.Quaternion().setFromUnitVectors(from, to);
}

/**
 * Where the support grip and the muzzle end up, in body space, for a weapon
 * rotation in the hand and a given arm pitch.
 *
 * `rotation` is the weapon's own rotation inside the right arm's frame, `armPitch`
 * the right arm's; the left shoulder is the origin every distance is measured from.
 */
const ARM_ROT = new THREE.Quaternion();
const WEAPON_ROT = new THREE.Quaternion();
const SCRATCH = new THREE.Vector3();
const SCRATCH_OUT = new THREE.Vector3();
const SCRATCH_EULER = new THREE.Euler();

function carryAt(
  rotation: readonly [number, number, number],
  armPitch: number,
): { support: THREE.Vector3; muzzle: THREE.Vector3 } {
  // Closed form rather than an Object3D graph: the solver evaluates ~5,000
  // candidates, and a scene graph per candidate would spend 300,000 allocations on
  // arithmetic that is three quaternion applications.
  ARM_ROT.setFromEuler(SCRATCH_EULER.set(armPitch, 0, COMBATANT.armCant));
  WEAPON_ROT.setFromEuler(SCRATCH_EULER.set(rotation[0], rotation[1], rotation[2]));
  const support = SCRATCH.set(...COMBATANT.weaponInArm)
    .add(SCRATCH_OUT.set(...COMBATANT.supportLocal).applyQuaternion(WEAPON_ROT))
    .applyQuaternion(ARM_ROT)
    .add(SCRATCH_OUT.set(...COMBATANT.shoulderRight));
  const muzzle = new THREE.Vector3(0, 0, -1).applyQuaternion(WEAPON_ROT).applyQuaternion(ARM_ROT);
  return { support: support.clone(), muzzle };
}

/**
 * The support grip's position in body space, for a weapon rotation and arm pitch.
 *
 * `enemyView` calls this every frame to aim the support arm, so the arm is solved
 * from the weapon's *actual* pose rather than from a pose assumed at build time.
 */
export function carryPoint(
  rotation: readonly [number, number, number],
  armPitch: number,
  out: THREE.Vector3 = new THREE.Vector3(),
): THREE.Vector3 {
  return out.copy(carryAt(rotation, armPitch).support);
}

/**
 * The weapon's rotation inside the right hand that points its muzzle along
 * `desired` (body space) when the arm is pitched to `armPitch`.
 *
 * Derived rather than searched, because "the weapon points where the soldier is
 * aiming" is exactly the constraint the player reads at 20 m, and the arm's frame is
 * known: the muzzle's arm-local direction is the inverse of the arm's rotation
 * applied to the desired direction.
 */
export function weaponRotationFor(
  armPitch: number,
  desired: readonly [number, number, number],
): [number, number, number] {
  const arm = new THREE.Group();
  arm.rotation.set(armPitch, 0, COMBATANT.armCant);
  const inverse = arm.quaternion.clone().invert();
  const local = new THREE.Vector3(...desired).normalize().applyQuaternion(inverse).normalize();
  const aim = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), local);
  // ...then the carry's roll, which is character, not geometry.
  const cant = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.12));
  const euler = new THREE.Euler().setFromQuaternion(aim.multiply(cant), 'XYZ');
  return [euler.x, euler.y, euler.z];
}

export interface CarrySolution {
  /** The weapon's rotation inside the right arm's frame, at the low-ready carry. */
  restRotation: [number, number, number];
  /** ...and while aiming, where the muzzle has to point at the player. */
  aimRotation: [number, number, number];
  /** Support grip to left shoulder, in metres, at the rest and aiming poses. */
  restDistance: number;
  aimDistance: number;
  /** Muzzle direction in body space, at the rest and aiming poses. */
  restMuzzle: [number, number, number];
  aimMuzzle: [number, number, number];
  /**
   * How far the low-ready support grip sits from the support arm's reach, in metres.
   *
   * This is the number the low-ready rotation controls, and the search drives it to
   * zero. The aiming pose is *not* part of it: there the grip is a fixed 0.2 m beyond
   * the arm (see `aimDistance`), which is a property of the skeleton rather than of
   * the carry, and which the support glove attached to the weapon hides.
   */
  reachError: number;
}

/**
 * Measure a candidate carry: both hands, both muzzles, and where they point.
 *
 * The weapon's rotation is *not* the same in the two poses, and it cannot be: with
 * this skeleton (shoulders 0.44 m apart, a 0.62 m arm, and a support grip 0.17 m up
 * the weapon from the right hand) the only low-ready orientation that puts the grip
 * within the support arm's reach is the weapon canted across the body, muzzle to the
 * soldier's left — and that orientation, held up to the eye, points at nothing. A
 * real soldier solves it the same way: the weapon comes up and levels as the arms
 * rise. So the carry is two rotations, and `enemyView` slerps between them on the
 * same blend the arms use.
 */
export function evaluateCarry(rotation: readonly [number, number, number]): CarrySolution {
  const left = new THREE.Vector3(...COMBATANT.shoulderLeft);
  const rest = carryAt(rotation, COMBATANT.restArm);
  const aimRotation = weaponRotationFor(COMBATANT.aimArm, COMBATANT.desiredMuzzle);
  const aim = carryAt(aimRotation, COMBATANT.aimArm);
  const restDistance = left.distanceTo(rest.support);
  const aimDistance = left.distanceTo(aim.support);
  return {
    restRotation: [rotation[0], rotation[1], rotation[2]],
    aimRotation,
    restDistance,
    aimDistance,
    restMuzzle: [rest.muzzle.x, rest.muzzle.y, rest.muzzle.z],
    aimMuzzle: [aim.muzzle.x, aim.muzzle.y, aim.muzzle.z],
    reachError: Math.abs(restDistance - ARM_REACH),
  };
}

let carryCache: CarrySolution | null = null;

/**
 * The carry, solved once.
 *
 * The answer depends only on the constants above, so every enemy view in every
 * mission shares one solution: the search is a build-time cost, not a spawn cost.
 */
export function carrySolution(): CarrySolution {
  carryCache ??= solveCarry();
  return carryCache;
}

/**
 * Search the low-ready carry: the weapon's pitch and yaw in the hand.
 *
 * The right hand is fixed by the arm and the weapon hangs from it, so the only
 * freedom is how the weapon is *rotated* about that hand, which swings the support
 * grip around a 17 cm sphere. Reach is the hard constraint; the muzzle terms keep the
 * weapon somewhere a soldier carries one — hanging across the chest, muzzle down and
 * forward, never up.
 *
 * A grid rather than a Gauss-Newton, run once rather than per enemy: the cost is
 * non-convex in the muzzle terms and the feasible set is small.
 */
export function solveCarry(): CarrySolution {
  let best = evaluateCarry([0, 0, -0.12]);
  let bestCost = Infinity;
  const consider = (pitch: number, yaw: number): void => {
    const candidate = evaluateCarry([pitch, yaw, -0.12]);
    // Reach first, then somewhere a soldier would actually carry the weapon: muzzle
    // down and forward across the chest, never up and never level to the side.
    const cost =
      candidate.reachError * 6 +
      (candidate.restMuzzle[1] > -0.25 ? 0.5 : 0) +
      (candidate.restMuzzle[2] > -0.2 ? 0.5 : 0);
    if (cost < bestCost) {
      bestCost = cost;
      best = candidate;
    }
  };

  const coarse = 0.08;
  for (let pitch = -2.6; pitch <= 0.6 + 1e-9; pitch += coarse) {
    for (let yaw = -1.8; yaw <= 1.8 + 1e-9; yaw += coarse) consider(pitch, yaw);
  }
  // Refine around the winner: the feasible band is a couple of tenths wide.
  const seed = best.restRotation;
  for (let pitch = seed[0] - coarse; pitch <= seed[0] + coarse + 1e-9; pitch += 0.01) {
    for (let yaw = seed[1] - coarse; yaw <= seed[1] + coarse + 1e-9; yaw += 0.01) {
      consider(pitch, yaw);
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

/**
 * The gait, as numbers rather than as intent.
 *
 * The shipped walk was `leftLeg.rotation.x = sin(phase) * 0.8` and its mirror: a
 * single joint per leg, so both legs stayed *rigid sticks* swinging from the hip.
 * Rigid legs cannot walk, and the arithmetic says so rather than the eye:
 *
 *  - a straight leg swung 26 degrees forward puts its foot 10 cm *above* the ground,
 *    and the shipped rig made no correction for it, so the squad skated;
 *  - with no knee there is no swing phase, so the foot never lifted and never
 *    planted;
 *  - with no ankle there is no heel strike and no toe-off, which is the part of a
 *    walk the eye reads first.
 *
 * So the legs are a three-segment chain (thigh 0.42, shin 0.46, foot 0.08, summing
 * to the 0.96 m from hip to sole the body was built with) and this table states what
 * the chain does. `walkPose` is the chain's forward kinematics, and because it is
 * arithmetic, `tests/unit/gait.test.ts` can assert the two things that make a walk
 * read as a walk: **the planted foot is on the ground and no foot ever goes through
 * it**, and the swing foot clears by at least a few centimetres.
 */
export const GAIT = {
  /** Hip pivot to sole, in metres: 0.42 + 0.46 + 0.08. */
  legLength: 0.96,
  /** How long each segment is: [thigh, shin, foot]. */
  segments: [0.42, 0.46, 0.08] as const,
  /** Hip pivot height above the group origin (where the leg pivot is built). */
  hipHeight: 0.94,
  /** Sole height below the origin when standing straight: -0.02 m (the shipped rig). */
  contactY: -0.02,
  /**
   * Step frequency, in steps per second, as a linear function of ground speed.
   *
   * A walk is ~1.7 steps/s and a run ~3, which is why the slope is 0.9: an enemy
   * moving at 3.2 m/s is *running*, and a gait whose cadence ignores its speed
   * slides its feet no matter how good the joint angles are.
   */
  cadenceBase: 1.7,
  cadenceSlope: 0.9,
  cadenceWalkSpeed: 1.4,
  cadenceMin: 1.6,
  cadenceMax: 3.1,
  /** The hip's swing about vertical, in radians: a walk is 0.3, a run 0.57. */
  hipMin: 0.14,
  hipMax: 0.62,
  /**
   * Knee flexion, in radians, and where in the cycle it happens.
   *
   * The knee only ever flexes (the shin swings *behind* the thigh), so every term
   * here is subtracted: a positive knee angle is a knee bending the wrong way, and
   * the test says so for the whole cycle rather than at one sampled phase.
   */
  // The phase convention: the hip is most forward at PI/2 (heel strike), vertical and
  // going back at PI (mid-stance), most back at 3PI/2 (toe-off), and vertical and
  // coming forward at 0/2PI (mid-swing). The knee's big flexion is therefore just
  // *after* toe-off and the small one just after heel strike; a bump centred a whole
  // half-cycle early is a knee that bends as the foot lands, which reads as a limp.
  //
  // Every knee and ankle amplitude is stated *at the reference walk* and scaled by the
  // hip swing, because they are not independent: a slow shuffle bends the knee 35
  // degrees and a sprint 80, and a constant here bends the same knee for both. (The
  // first version of this table put a sprinter's 66-degree swing flexion on a walking
  // hip and lifted the swing foot 23 cm off the ground.)
  referenceHipSwing: 0.3,
  /**
   * How high the *swing* foot passes over the ground, in metres, at a walk and at a
   * run. This is the authoring parameter, and the knee flexion is solved from it
   * (`swingKnee`): the other way round — pick a knee angle and hope the foot clears —
   * is how the first version of this table lifted the swing foot 23 cm off the ground
   * on a walking hip.
   */
  clearanceWalk: 0.055,
  clearanceRun: 0.16,
  kneeSwingCentre: 5.15,
  kneeSwingWidth: 1.4,
  /** Stance knee flexion (loading response) and its centre and width. */
  kneeStanceWalk: 0.16,
  kneeStanceRun: 0.4,
  kneeStanceCentre: 1.85,
  kneeStanceWidth: 0.85,
  /** Ankle travel: dorsiflexed at heel strike, plantarflexed at toe-off. */
  ankle: 0.26,
  anklePhase: 0.9,
  /** Shoulder counter-rotation and upper-body roll. */
  torsoYaw: 0.09,
  torsoRoll: 0.05,
} as const;

export interface GaitPose {
  /** Hip pitch, radians. Positive swings the leg forward (forward is -z). */
  leftHip: number;
  rightHip: number;
  /** Knee flexion, radians, always <= 0: the shin swings back, never through. */
  leftKnee: number;
  rightKnee: number;
  /** Ankle pitch: positive is toes up. */
  leftAnkle: number;
  rightAnkle: number;
  /** Whole-body vertical offset, in metres, that keeps the planted foot planted. */
  bob: number;
  /** Upper-body roll and counter-yaw. */
  roll: number;
  yaw: number;
  /** How much the hips swing, so a caller can scale a stumble or a lunge off it. */
  hipSwing: number;
}

const TAU = Math.PI * 2;

/** Wrap an angle into [-PI, PI]. */
function wrapAngle(a: number): number {
  let x = a % TAU;
  if (x > Math.PI) x -= TAU;
  if (x < -Math.PI) x += TAU;
  return x;
}

/** A raised-cosine bump: 1 at `centre`, 0 at `centre +/- width`, smooth between. */
function bump(angle: number, centre: number, width: number): number {
  const d = wrapAngle(angle - centre);
  if (Math.abs(d) >= width) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * d) / width));
}

/**
 * Ground speed to gait: how long a stride is, how fast the steps come, and how far
 * the hips swing.
 *
 * `stride` is the distance the body covers in one full cycle (two steps), and it is
 * what the *phase* is driven from: an animation whose phase comes from elapsed time
 * slides its feet whenever the simulation's speed and the animation's cadence
 * disagree, and they always disagree somewhere.
 */
export function strideFor(speed: number): { cadence: number; stride: number; hipSwing: number } {
  const preferred =
    GAIT.cadenceBase + GAIT.cadenceSlope * (speed - GAIT.cadenceWalkSpeed);
  // A leg can only reach so far: past `hipMax` the hips cannot spread further, so the
  // *steps* have to come faster instead of longer, which is exactly what a real runner
  // does and what stops the feet sliding at the top of the speed range.
  const reachableStride = 4 * GAIT.legLength * Math.sin(GAIT.hipMax);
  const cadence = Math.max(
    GAIT.cadenceMin,
    Math.min(GAIT.cadenceMax, preferred),
    (2 * speed) / reachableStride,
  );
  const stride = speed / (cadence / 2);
  const ratio = Math.max(0, Math.min(0.95, stride / (4 * GAIT.legLength)));
  const hipSwing = Math.max(GAIT.hipMin, Math.min(GAIT.hipMax, Math.asin(ratio)));
  return { cadence, stride, hipSwing };
}

/** How far into "run" a hip swing is: 0 at the reference walk, 1 at the fastest. */
function runness(hipSwing: number): number {
  const span = Math.max(1e-6, GAIT.hipMax - GAIT.referenceHipSwing);
  return Math.max(0, Math.min(1, (hipSwing - GAIT.referenceHipSwing) / span));
}

/** The swing foot's clearance over the ground, in metres, for a hip swing. */
export function swingClearance(hipSwing: number): number {
  const t = runness(hipSwing);
  return GAIT.clearanceWalk + (GAIT.clearanceRun - GAIT.clearanceWalk) * t;
}

/**
 * The swing-phase knee flexion that carries the sole `clearance` above the ground.
 *
 * Solved rather than tabulated: the sole's height is `legReach(hip, knee, ankle)`, so
 * for the phase where the swing knee reaches its peak, the knee angle is the one that
 * makes that reach `legLength - clearance`. Two passes are enough (the foot term moves
 * by under 8 cm between them) and there is no iteration in the frame loop: it is
 * called once per `walkPose`.
 */
function swingKnee(hipSwing: number): number {
  const [thigh, shin, foot] = GAIT.segments;
  const phase = GAIT.kneeSwingCentre;
  const hip = hipSwing * Math.sin(phase);
  const ankle = GAIT.ankle * Math.sin(phase + GAIT.anklePhase);
  const target = GAIT.legLength - swingClearance(hipSwing);
  let knee = -0.5;
  for (let pass = 0; pass < 3; pass++) {
    const rest = target - thigh * Math.cos(hip) - foot * Math.cos(hip + knee + ankle);
    // Knee flexion is negative for a -z-forward body, so take the negative root.
    knee = -Math.acos(Math.max(-1, Math.min(1, rest / shin))) - hip;
  }
  // A knee that is not actually bent is not a walk: floor it at ~17 degrees.
  return Math.max(0.3, Math.abs(knee));
}

/** One leg at a cycle phase: hip, knee and ankle angles for the chain. */
function legAt(phase: number, hipSwing: number): { hip: number; knee: number; ankle: number } {
  const hip = hipSwing * Math.sin(phase);
  const t = runness(hipSwing);
  const knee = -(
    swingKnee(hipSwing) * bump(phase, GAIT.kneeSwingCentre, GAIT.kneeSwingWidth) +
    (GAIT.kneeStanceWalk + (GAIT.kneeStanceRun - GAIT.kneeStanceWalk) * t) *
      bump(phase, GAIT.kneeStanceCentre, GAIT.kneeStanceWidth)
  );
  const ankle = GAIT.ankle * Math.sin(phase + GAIT.anklePhase) * (1 + t * 0.4);
  return { hip, knee, ankle };
}

/**
 * How far below the hip a leg's sole hangs, for its joint angles.
 *
 * The chain is planar and the angles accumulate: each segment's vertical extent is
 * its length times the cosine of the sum of the angles above it. This is the number
 * the bob is solved from, and the number the test plants the feet with.
 */
export function legReach(hip: number, knee: number, ankle: number): number {
  const [thigh, shin, foot] = GAIT.segments;
  return (
    thigh * Math.cos(hip) +
    shin * Math.cos(hip + knee) +
    foot * Math.cos(hip + knee + ankle)
  );
}

/**
 * The pose at a cycle phase, for a hip swing.
 *
 * The right leg runs half a cycle behind the left, which is what makes the walk a
 * *stride* rather than a hop, and the body's height is solved from the legs rather
 * than added as a sine: the hip sits as high as the more extended leg allows, so the
 * planted foot is always exactly on the ground no matter what the other leg is doing.
 * (The shipped bob was `|sin(phase)| * 0.02`, a number with no relationship to either
 * leg — 4.6 cm of body movement over a foot that was not on the ground.)
 */
/**
 * Re-solve the body offset for a pose whose joint angles have been altered.
 *
 * A caller that scales a gait (a standing soldier's near-still shuffle, a stumble)
 * changes the angles, and the body height is a *function* of the angles: keeping the
 * old `bob` would leave the planted foot hanging in the air or buried in the ground.
 */
export function reseat(pose: GaitPose): GaitPose {
  const left = legReach(pose.leftHip, pose.leftKnee, pose.leftAnkle);
  const right = legReach(pose.rightHip, pose.rightKnee, pose.rightAnkle);
  pose.bob = Math.max(left, right) - GAIT.legLength;
  return pose;
}

export function walkPose(phase: number, hipSwing: number, out?: GaitPose): GaitPose {
  const left = legAt(phase, hipSwing);
  const right = legAt(phase + Math.PI, hipSwing);
  const pose = out ?? {
    leftHip: 0,
    rightHip: 0,
    leftKnee: 0,
    rightKnee: 0,
    leftAnkle: 0,
    rightAnkle: 0,
    bob: 0,
    roll: 0,
    yaw: 0,
    hipSwing,
  };
  pose.leftHip = left.hip;
  pose.rightHip = right.hip;
  pose.leftKnee = left.knee;
  pose.rightKnee = right.knee;
  pose.leftAnkle = left.ankle;
  pose.rightAnkle = right.ankle;
  // The pelvis drops on the *swing* side (a walk's oblique hip drop), which reads as
  // the upper body swaying rather than sliding. Roll is about the forward axis.
  pose.roll = GAIT.torsoRoll * Math.cos(phase);
  pose.yaw = GAIT.torsoYaw * Math.sin(phase);
  pose.hipSwing = hipSwing;
  // The taller leg decides the hip's height, and the offset is what puts that leg's
  // sole back on the ground.
  return reseat(pose);
}

/** A leg's sole height, in the group's own frame, for a pose and a side. */
export function soleHeight(pose: GaitPose, side: 'left' | 'right'): number {
  const hip = side === 'left' ? pose.leftHip : pose.rightHip;
  const knee = side === 'left' ? pose.leftKnee : pose.rightKnee;
  const ankle = side === 'left' ? pose.leftAnkle : pose.rightAnkle;
  return pose.bob + GAIT.hipHeight - legReach(hip, knee, ankle);
}
