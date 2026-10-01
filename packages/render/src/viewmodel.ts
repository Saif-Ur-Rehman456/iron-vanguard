/**
 * First-person view model.
 *
 * A view model sits 40 cm from the eye and fills a third of the screen, and the
 * art review's verdict on the previous one was exact: *it is not a man holding a
 * gun*. It was two boxes with four finger boxes each, both on the weapon's centre
 * line, two loose `fabric` boxes for arms, no shoulder contact, and a 0.66 m
 * receiver that put the muzzle 1.36 m from the eye — a plank with gloves taped to
 * it. None of that is fixable by adding detail; the *rig* was wrong.
 *
 * So this file is now a thin builder over three inputs:
 *
 *  - `weapon/layout.ts` — every part's real size in metres, the anchors, and the
 *    pose solution (sight line on the axis, eye relief, muzzle reach).
 *  - `materials/weapon.ts` — the weapon's own PBR set, tiled per world metre.
 *  - `geometry.ts` — `limb()` for arms and `uvMetres()` for density.
 *
 * The arms are a two-bone rig: the shoulders are fixed to the camera, the hands
 * are children of the weapon (so they never leave the grip), and the elbows are
 * solved each frame by `solveElbow`. That is what makes the weapon look carried
 * rather than pasted, and it is also why sprint, ADS and the reload move the
 * *hands* and let the arms follow instead of rotating one rigid slab.
 *
 * The interface is deliberately unchanged (`group`, `muzzleFlash`, `muzzleAnchor`,
 * `ejectAnchor`, `pose`, `dispose`) so the renderer keeps working, with `rig`
 * added for the debug surface and the rig tests.
 */
import * as THREE from 'three';
import type { WeaponDef } from '@iron/content';
import type { ModelLibrary } from './assets/models';
import { flattenLocal } from './batch';
import { annulus, chamferedCylinder, roundedBox, uvMetres, withAoUv } from './geometry';
import { buildHand, handShape, limbElliptic, mountHand } from './characters/hand';
import type { TextureLibrary } from './materials/textures';
import type { WeaponMaterials } from './materials/weapon';
import {
  ARMS,
  solveElbow,
  supportAnchor,
  weaponLayout,
  posePosition,
  type WeaponLayout,
  type WeaponMaterialKey,
  type WeaponPart,
} from './weapon/layout';

export interface ViewModelPose {
  adsT: number;
  sprintK: number;
  bobPhase: number;
  bobX: number;
  bobY: number;
  swayX: number;
  swayY: number;
  kick: number;
  reloadProgress: number;
  time: number;
  motionScale: number;
  /** 0 = standing, 1 = crouched: the hold tucks in as the player goes down. */
  crouchK?: number;
  /** True while the feet are off the ground. Blended internally, never snapped. */
  airborne?: boolean;
  /** Landing impulse 0..1 from the simulation: the weapon takes the impact. */
  land?: number;
}

/** The joints a test or a debug readout can measure. All values are world space. */
export interface ViewModelRig {
  shoulderRight: THREE.Object3D;
  shoulderLeft: THREE.Object3D;
  handRight: THREE.Object3D;
  handLeft: THREE.Object3D;
  elbowRight: THREE.Object3D;
  elbowLeft: THREE.Object3D;
  wristRight: THREE.Object3D;
  wristLeft: THREE.Object3D;
}

export interface ViewModel {
  group: THREE.Group;
  muzzleFlash: THREE.Sprite;
  muzzleAnchor: THREE.Object3D;
  ejectAnchor: THREE.Object3D;
  /** Layout actually used, for the debug surface and the rig tests. */
  layout: WeaponLayout;
  rig: ViewModelRig;
  /**
   * The arms' root, so a probe can hide the whole thing.
   *
   * The hands hang off the weapon and the arms off the camera, so "hide the view
   * model" is two objects. Exposing the second one is what lets a capture pair
   * isolate the weapon and hands from the world by subtraction — which is the only
   * way to measure "is this hand round" without the plaza in the sample.
   */
  arms: THREE.Object3D;
  /** `weaponToo: false` leaves the hands and arms on their own, for measurement. */
  setVisible(visible: boolean, weaponToo?: boolean): void;
  pose(params: ViewModelPose): void;
  dispose(): void;
}

const Y = new THREE.Vector3(0, 1, 0);
const SHOULDER_R = new THREE.Vector3(...ARMS.shoulderRight);
const SHOULDER_L = new THREE.Vector3(...ARMS.shoulderLeft);

/**
 * A part's geometry, with UVs authored in world metres.
 *
 * Module scope rather than a closure so that a test can build the weapon's geometry
 * with no GPU, no camera and no scene — which is how the sight-line contract in
 * `tests/unit/sightPicture.test.ts` is checked.
 *
 * Boxes: U follows the part's length and V its height, which is exactly right on the
 * two side faces that face the camera and approximate on the top and bottom — the
 * honest trade for not building a six-material UV atlas for every 4 mm rail slot.
 * Tubes get circumference × length, which is exact. A `ring` with an `innerRadius` is a
 * true annulus (a bezel, a sling loop); without one it is a disc (glass, a reticle).
 */
export function partGeometry(part: WeaponPart, tile: number): THREE.BufferGeometry {
  const [w, h, d] = part.size;
  if (part.shape === 'tube') {
    const radius = part.radius ?? Math.min(w, h) / 2;
    const height = d > 0 ? d : h;
    return uvMetres(
      chamferedCylinder(radius, radius, height, part.radialSegments ?? 14, part.open === true),
      2 * Math.PI * radius,
      height,
      tile,
    );
  }
  if (part.shape === 'ring') {
    const radius = part.radius ?? Math.min(w, h) / 2;
    const geometry =
      part.innerRadius && part.innerRadius > 0
        ? annulus(radius, part.innerRadius, 24)
        : withAoUv(new THREE.CircleGeometry(radius, 24));
    return uvMetres(geometry, radius * 2, radius * 2, tile);
  }
  // Thin plates get a plain box: a 4 mm bevel on a 2 mm part is degenerate
  // geometry, which is what the old rail slots were.
  const bevel = Math.min(w, h, d) < 0.012 ? 0 : Math.min(0.0035, Math.min(w, h, d) / 3);
  const geometry = bevel > 0 ? roundedBox(w, h, d, bevel) : withAoUv(new THREE.BoxGeometry(w, h, d));
  return uvMetres(geometry, d, h, tile);
}

/**
 * The material a part is drawn with.
 *
 * One rule beyond "use the material the layout named": a tube the player looks down
 * is drawn with a double-sided wall, because an open-ended cylinder's inner surface
 * faces away from the eye and a single-sided one is not there at all — the sight tube
 * would render as a hole through the weapon from wherever the player stood.
 */
export function partMaterial(weapons: WeaponMaterials, part: WeaponPart): THREE.Material {
  if (part.material === 'lens') return weapons.lens;
  if (part.material === 'dot') return weapons.dot;
  if (part.open) {
    return weapons.opticWall(
      part.material === 'steel' ? 'steel' : part.material === 'polymer' ? 'polymer' : 'gunmetal',
    );
  }
  return weapons[part.material].material;
}

export function createViewModel(
  def: WeaponDef,
  camera: THREE.PerspectiveCamera,
  textures: TextureLibrary,
  weapons: WeaponMaterials,
  models?: ModelLibrary,
): ViewModel {
  const layout = weaponLayout(def);
  const group = new THREE.Group();
  group.name = `viewmodel_${def.id}`;
  camera.add(group);

  // The arms hang off the camera, not off the weapon: a shoulder does not move
  // when the wrist turns.
  const armsRoot = new THREE.Group();
  armsRoot.name = 'viewmodel_arms';
  camera.add(armsRoot);

  // The weapon lives in its own node under `group`, with the hands as siblings, so that
  // "hide the weapon" is one flag rather than hiding the hands with it — which is the
  // difference between an instrument that can measure a hand and one that cannot.
  const gun = new THREE.Group();
  gun.name = 'viewmodel_weapon';
  group.add(gun);
  const body = new THREE.Group();
  // The magazine is its own group because a reload makes it leave the well.
  const magazineGroup = new THREE.Group();

  /**
   * Show or hide the view model, and optionally the weapon with it.
   *
   * `weaponToo: false` is the instrument that makes a hand measurable. A rifle is more
   * pixels than two hands and nearly all of them are axis-aligned, so a shape statistic
   * over the whole view model reports the receiver: cropping to the hand does not help
   * either, because at a hip carry the hand sits against the weapon's own mass and the
   * crop is 98% filled — no silhouette in it to measure. Hiding the weapon and leaving
   * the hands and arms gives a mask that is exactly the thing under review.
   */
  const setVisible = (visible: boolean, weaponToo = true): void => {
    group.visible = visible;
    gun.visible = weaponToo;
    armsRoot.visible = visible;
    for (const hand of [handRight, handLeft]) hand.visible = visible;
  };
  magazineGroup.name = 'viewmodel_magazine';
  gun.add(magazineGroup);

  /** How large one texture tile is for each material key, in metres. */
  const density: Record<WeaponMaterialKey, number> = {
    gunmetal: weapons.gunmetal.metresPerTile,
    steel: weapons.steel.metresPerTile,
    polymer: weapons.polymer.metresPerTile,
    wood: weapons.wood.metresPerTile,
    leather: weapons.leather.metresPerTile,
    sleeve: weapons.sleeve.metresPerTile,
    skin: weapons.skin.metresPerTile,
    // The lens and the dot are flat colour on a small disc; density is moot.
    lens: 0.04,
    dot: 0.01,
  };
  const mesh = (parent: THREE.Group, part: WeaponPart): THREE.Mesh => {
    const item = new THREE.Mesh(partGeometry(part, density[part.material]), partMaterial(weapons, part));
    item.position.set(...part.at);
    if (part.rot) item.rotation.set(...part.rot);
    // The view model is drawn over the world, so it neither casts nor receives
    // shadows — those would fight the world's shadow map at this scale.
    item.castShadow = false;
    item.receiveShadow = false;
    parent.add(item);
    return item;
  };

  // ---- weapon ---------------------------------------------------------------
  for (const part of layout.parts) {
    const toMagazine = part.id === 'magazine' || part.id === 'mag_floor' || part.id.startsWith('mag_rib_');
    mesh(toMagazine ? magazineGroup : body, part);
  }
  flattenLocal(magazineGroup, 'viewmodel_magazine');

  const external = models?.instantiate('weapon', def.id) ?? null;
  if (external) {
    gun.add(external);
  } else {
    flattenLocal(body, 'viewmodel');
    gun.add(body);
  }

  // ---- hands ----------------------------------------------------------------
  // Both hands come from `characters/hand.ts` — one anatomically-based hand, the same one
  // the enemies use — mounted onto what it is holding. What this file supplies is the
  // *mount*: which way the grip runs, which way the palm faces and which way the knuckles
  // point. The old build put four identical finger boxes on a slab and called it a hand;
  // the shape itself now lives where a test can measure it.
  //
  // The grip's rake is the one number the mount needs beyond the anchors: a pistol grip
  // leans back, so its axis is the receiver's `+y` turned about x.
  const gripAxis = new THREE.Vector3(0, 1, 0.34).normalize();
  const gripRadius = 0.0165;

  const handRight = buildHand(
    handShape({ side: 'right', gripRadius, trigger: 0.16 }),
    { glove: weapons.leather.material, skin: weapons.skin.material },
    weapons.leather.metresPerTile,
  );
  handRight.name = 'viewmodel_hand_r';
  mountHand(handRight, {
    at: layout.anchors.gripRight.toArray() as [number, number, number],
    axis: gripAxis.toArray() as [number, number, number],
    palmNormal: [-1, 0, 0],
    forward: [0, 0, -1],
  });
  group.add(handRight);
  flattenLocal(handRight, 'viewmodel_hand_r');

  const handLeft = buildHand(
    handShape({ side: 'left', gripRadius: 0.024 }),
    { glove: weapons.leather.material, skin: weapons.skin.material },
    weapons.leather.metresPerTile,
  );
  handLeft.name = 'viewmodel_hand_l';
  // Rest position is the *hip* support grip (by the magazine well); `pose()` walks it out
  // along the handguard as the weapon comes up to the eye. The handguard runs along the
  // barrel, so the support hand's axis is the weapon's `-z` — thumb toward the muzzle.
  mountHand(handLeft, {
    at: layout.anchors.supportHip.toArray() as [number, number, number],
    axis: [0, 0, -1],
    palmNormal: [0.6, 0.8, 0],
    forward: [-0.8, 0.6, 0],
  });
  group.add(handLeft);
  flattenLocal(handLeft, 'viewmodel_hand_l');

  // ---- two-bone arms --------------------------------------------------------
  // Limb meshes are authored along +Y with the thick end at -Y, so a limb is
  // placed by its midpoint and rotated from the local +Y axis onto its segment.
  /**
   * An arm segment: an *ellipse*, not a pipe.
   *
   * A forearm is about a quarter wider across than it is deep, and a round 5 cm cone at
   * 30 cm from the eye reads as a length of pipe however good its material is — which is
   * half of the review's "the arm shapes are not real". `limbElliptic` carries the
   * anisotropy in the vertex positions rather than in the mesh's scale, because a scaled
   * mesh scales its UVs with it.
   */
  const armSegment = (
    bottom: { across: number; deep: number },
    top: { across: number; deep: number },
    length: number,
  ): THREE.Mesh => {
    const mean = (bottom.across + bottom.deep + top.across + top.deep) / 4;
    const geometry = uvMetres(limbElliptic(bottom, top, length, 18), 2 * Math.PI * mean, length, weapons.sleeve.metresPerTile);
    const item = new THREE.Mesh(geometry, weapons.sleeve.material);
    item.castShadow = false;
    item.receiveShadow = false;
    armsRoot.add(item);
    return item;
  };
  // A shirt sleeve over an arm: upper arm 5.2 cm across x 4.6 deep at the shoulder, the
  // forearm 5.6 x 4.4 at the elbow coming down to 4.2 x 3.3 at the wrist. The forearm is
  // *thickest at the elbow*, which is the detail a cone of constant taper cannot have.
  const upperRight = armSegment({ across: 0.052, deep: 0.046 }, { across: 0.058, deep: 0.044 }, ARMS.upper);
  const foreRight = armSegment({ across: 0.056, deep: 0.044 }, { across: 0.042, deep: 0.033 }, ARMS.fore);
  const upperLeft = armSegment({ across: 0.052, deep: 0.046 }, { across: 0.058, deep: 0.044 }, ARMS.upper);
  const foreLeft = armSegment({ across: 0.056, deep: 0.044 }, { across: 0.042, deep: 0.033 }, ARMS.fore);
  // A cuff where the sleeve meets the glove: 2 cm of it, a little proud of the forearm, so
  // the arm does not simply stop at the wrist.
  const cuff = (): THREE.Mesh => {
    const item = new THREE.Mesh(
      uvMetres(chamferedCylinder(0.042, 0.043, 0.022, 14), 2 * Math.PI * 0.042, 0.022, weapons.sleeve.metresPerTile),
      weapons.sleeve.material,
    );
    item.castShadow = false;
    armsRoot.add(item);
    return item;
  };
  const cuffRight = cuff();
  const cuffLeft = cuff();

  const shoulderRight = new THREE.Object3D();
  shoulderRight.position.set(...ARMS.shoulderRight);
  const shoulderLeft = new THREE.Object3D();
  shoulderLeft.position.set(...ARMS.shoulderLeft);
  const elbowRight = new THREE.Object3D();
  const elbowLeft = new THREE.Object3D();
  const wristRight = new THREE.Object3D();
  const wristLeft = new THREE.Object3D();
  // All eight joints go *into* the graph, not just the shoulders. `pose()` writes
  // these four in camera space, and a detached Object3D's `getWorldPosition()`
  // returns that camera-space value unchanged — so `weaponDebug().joints` used to
  // publish camera-local coordinates under a key documented as world space, and
  // projecting any of the four returned the camera's own position. Parenting them
  // to `armsRoot` (identity relative to the camera) makes the readout mean what it
  // says, and changes no arithmetic: nothing hangs off the elbows or the wrists.
  armsRoot.add(shoulderRight, shoulderLeft, elbowRight, elbowLeft, wristRight, wristLeft);

  // ---- anchors and muzzle flash --------------------------------------------
  const muzzleAnchor = new THREE.Object3D();
  muzzleAnchor.position.copy(layout.anchors.muzzle);
  group.add(muzzleAnchor);

  const ejectAnchor = new THREE.Object3D();
  ejectAnchor.position.copy(layout.anchors.eject);
  group.add(ejectAnchor);

  const muzzleFlash = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: textures.muzzleFlash,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // Depth-tested now: the old flash drew through walls, which is the sort of
      // thing you only notice when you shoot a fence at arm's length.
      depthTest: true,
    }),
  );
  muzzleFlash.position.copy(layout.anchors.muzzleFlash);
  muzzleFlash.renderOrder = 20;
  muzzleFlash.visible = false;
  group.add(muzzleFlash);
  // The flame itself, as a child so the renderer's single `visible` and `scale`
  // contract drives both halves.
  const flame = new THREE.Mesh(
    // Authored in the flash sprite's local units: the renderer scales the sprite
    // to ~0.15, so this reads as a ~9 cm flame with a 15 cm burst behind it.
    new THREE.ConeGeometry(0.17, 0.62, 14, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffca86,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  flame.rotation.x = -Math.PI / 2;
  flame.position.set(0, 0, -0.36);
  muzzleFlash.add(flame);

  // ---- pose -----------------------------------------------------------------
  /** 0..1 airborne blend, smoothed across the 0.46 s a jump lasts. */
  let airBlend = 0;
  const base = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const handTarget = new THREE.Vector3();
  const elbow = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  const pole = new THREE.Vector3();
  const supportHome = new THREE.Vector3();
  const cameraTarget = new THREE.Vector3();
  const shoulderLocal = new THREE.Vector3();
  const armQuaternion = new THREE.Quaternion();
  const armInverse = new THREE.Quaternion();

  /** Place one arm: shoulder → elbow → wrist, with the limb meshes oriented onto it. */
  const placeArm = (
    shoulder: THREE.Vector3,
    wrist: THREE.Vector3,
    poleAxis: readonly [number, number, number],
    upper: THREE.Mesh,
    fore: THREE.Mesh,
    /** The sleeve's cuff, which sits at the wrist and hides the seam with the glove. */
    cuff: THREE.Mesh,
    joints: { elbow: THREE.Object3D; wrist: THREE.Object3D },
  ): void => {
    pole.set(...poleAxis);
    elbow.copy(solveElbow(shoulder, wrist, ARMS.upper, ARMS.fore, pole));

    scratch.copy(elbow).sub(shoulder).normalize();
    upper.quaternion.setFromUnitVectors(Y, scratch);
    upper.position.copy(shoulder).lerp(elbow, 0.5);

    scratch.copy(wrist).sub(elbow).normalize();
    fore.quaternion.setFromUnitVectors(Y, scratch);
    fore.position.copy(elbow).lerp(wrist, 0.5);
    cuff.position.copy(elbow).lerp(wrist, 0.9);
    cuff.quaternion.copy(fore.quaternion);

    joints.elbow.position.copy(elbow);
    joints.wrist.position.copy(wrist);
  };

  return {
    group,
    muzzleFlash,
    muzzleAnchor,
    ejectAnchor,
    layout,
    arms: armsRoot,
    setVisible,
    rig: { shoulderRight, shoulderLeft, handRight, handLeft, elbowRight, elbowLeft, wristRight, wristLeft },
    pose(params: ViewModelPose): void {
      const motion = params.motionScale;
      const crouch = params.crouchK ?? 0;
      const land = params.land ?? 0;
      // Air is blended rather than switched: a jump is 0.46 s long and a pose that
      // snaps between two holds at take-off reads as a teleport, not a jump.
      airBlend += ((params.airborne ? 1 : 0) - airBlend) * 0.2;

      const solved = posePosition(def, layout, params.adsT);
      base.set(solved.x, solved.y, solved.z);
      base.y -= params.sprintK * 0.07; // parity: the weapon drops as the player runs
      // ---- sprint carry ------------------------------------------------------
      // The run hold is a *pose*, not a lower hip-fire: the weapon comes in across the
      // chest and the muzzle drops and swings to the left, which is what a soldier
      // carrying a rifle at a run actually looks like from their own eyes. (Parity's
      // 0.07 drop with no rotation left the weapon pointing where the player was
      // aiming, i.e. running with the rifle shouldered.)
      base.x -= params.sprintK * 0.05;
      base.z += params.sprintK * 0.06;
      // ---- crouch and jump ---------------------------------------------------
      base.y -= crouch * 0.045;
      base.x += crouch * 0.015;
      base.y += airBlend * 0.03;
      base.z += airBlend * 0.02;
      base.y -= land * 0.05;

      group.position.copy(base);
      // **The reticle is the aim point, so at ADS the drift is damped and the recoil is
      // kept.** The HUD crosshair is hidden while aiming (that is what the optic is
      // for), so anything that moves only the weapon moves the dot *off the crosshair* —
      // a sight that lies about where the next round goes. `kick` still pushes the
      // weapon back along z, which brings the optic closer without taking the dot off the
      // axis, and the rest scales down to a third at full ADS; at the hip nothing is
      // scaled, because that is where the motion belongs. (Sway is also what makes
      // sustained fire unreadable, so the same factor is what keeps the sight picture
      // functional through a burst.)
      const aimSteady = 1 - 0.65 * params.adsT;
      // Two bobs, not one: a walk's, and a sprint's, which is faster and larger. The
      // phases come from the simulation, so a footstep event and the bob agree.
      const bobGain = 1 + params.sprintK * 0.6;
      group.position.x +=
        (params.swayX + Math.cos(params.bobPhase) * 0.008 * bobGain * (1 - params.adsT) * motion) *
        aimSteady;
      group.position.y += (params.swayY + params.bobY * 0.8 * bobGain * motion) * aimSteady;
      group.position.z += params.kick * 0.07;

      if (params.adsT > 0.5) {
        // Idle breathing, and it is deliberately tiny: at 19 cm of eye relief a 3.5 mm
        // sway is 20 px of reticle drift on a 1080p frame — a sight picture moving faster
        // than the target does. This is ~5 px of life.
        group.position.y += Math.sin(params.time * 1.7) * 0.0011 * motion;
        group.position.x += Math.sin(params.time * 1.1) * 0.0009 * motion;
      }

      group.rotation.set(
        (params.swayY * 1.6 +
          params.kick * 0.1 +
          params.sprintK * -0.35 +
          land * 0.22 -
          airBlend * 0.06) *
          aimSteady,
        (params.swayX * 1.6 + params.sprintK * 0.5) * aimSteady,
        params.sprintK * 0.3 - crouch * 0.04,
      );

      if (params.reloadProgress > 0) {
        const dip = Math.sin(params.reloadProgress * Math.PI);
        group.rotation.x += dip * 0.85;
        group.position.y -= dip * 0.13;
        group.rotation.z += dip * 0.2;
        // The magazine actually leaves the well and comes back.
        const drop = Math.max(0, Math.sin(params.reloadProgress * Math.PI * 2));
        magazineGroup.position.set(0, -drop * 0.17, drop * 0.03);
        magazineGroup.rotation.z = dip * 0.45;
      } else {
        magazineGroup.position.set(0, 0, 0);
        magazineGroup.rotation.set(0, 0, 0);
      }

      // The shoulders follow the torso a little, so the arms are not welded to
      // the camera while the weapon sways.
      armsRoot.position.set(params.swayX * 0.35, params.swayY * 0.35, 0);
      armsRoot.rotation.set(0, params.swayX * 0.6, 0);

      quaternion.setFromEuler(group.rotation);
      const toCamera = (local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 =>
        out.copy(local).applyQuaternion(quaternion).add(group.position);

      // The IK is solved in the arms' own space, so the torso offset above can
      // never move an arm off its hand. (Solving in camera space and letting
      // `armsRoot` translate the answer is how a rig acquires a visible gap.)
      armQuaternion.setFromEuler(armsRoot.rotation);
      armInverse.copy(armQuaternion).invert();
      const toArms = (camera: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 =>
        out.copy(camera).sub(armsRoot.position).applyQuaternion(armInverse);

      // Support hand walks to the magazine during a reload and back.
      const reloadT = params.reloadProgress > 0 ? Math.sin(params.reloadProgress * Math.PI) : 0;
      supportAnchor(layout, params.adsT, supportHome);
      handTarget.copy(supportHome).lerp(layout.anchors.magWell, reloadT);
      handLeft.position.copy(handTarget);
      handLeft.rotation.z = reloadT * 0.5;

      toArms(toCamera(layout.anchors.gripRight, cameraTarget), handTarget);
      toArms(SHOULDER_R, shoulderLocal);
      placeArm(
        shoulderLocal,
        handTarget,
        ARMS.poleRight,
        upperRight,
        foreRight,
        cuffRight,
        { elbow: elbowRight, wrist: wristRight },
      );
      toArms(toCamera(handLeft.position, cameraTarget), handTarget);
      toArms(SHOULDER_L, shoulderLocal);
      placeArm(
        shoulderLocal,
        handTarget,
        ARMS.poleLeft,
        upperLeft,
        foreLeft,
        cuffLeft,
        { elbow: elbowLeft, wrist: wristLeft },
      );
    },
    dispose(): void {
      camera.remove(group);
      camera.remove(armsRoot);
      for (const root of [group, armsRoot]) {
        root.traverse((object) => {
          if (object instanceof THREE.Mesh) object.geometry.dispose();
        });
      }
      (muzzleFlash.material as THREE.Material).dispose();
      (flame.material as THREE.Material).dispose();
      flame.geometry.dispose();
    },
  };
}
