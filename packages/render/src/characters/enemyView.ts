/**
 * Enemy presentation.
 *
 * A humanoid built from a skeleton of groups (hip → thigh → knee → shin → boot,
 * shoulder → upper arm → forearm → hand) rather than a stack of boxes, because the
 * *pose* is what makes a figure read as a person at 20 metres: the silhouette of
 * shoulders, a helmet and a rifle held across the chest.
 *
 * Detail budget is spent where the camera looks: the kit (plate carrier, pouches,
 * helmet, NVG mount, holster) carries far more identity than anatomy, and every
 * part uses the same PBR materials as the player's gear.
 *
 * The animation interface is unchanged (walk blend, aim, hit flash, death fall), so
 * a rigged GLB can replace `buildBody` later without touching the simulation.
 */
import * as THREE from 'three';
import type { EnemyDef } from '@iron/content';
import type { EnemyState } from '@iron/sim';
import type { ModelLibrary } from '../assets/models';
import { flattenLocal } from '../batch';
import { chamferedCylinder, lathe, roundedBox } from '../geometry';
import type { Materials } from '../materials/materials';
import type { TextureLibrary } from '../materials/textures';
import {
  COMBATANT,
  GAIT,
  RIM,
  aimLimb,
  carryPoint,
  carrySolution,
  deriveUniformPalette,
  kitZ,
  reseat,
  sheened,
  strideFor,
  walkPose,
  type GaitPose,
} from './uniform';

export interface EnemyView {
  group: THREE.Group;
  id: number;
  healthBar: {
    sprite: THREE.Sprite;
    canvas: HTMLCanvasElement;
    texture: THREE.CanvasTexture;
    lastHealth: number;
  };
  laser: THREE.Line;
  laserDot: THREE.Sprite;
  materials: THREE.MeshStandardMaterial[];
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftKnee: THREE.Group;
  rightKnee: THREE.Group;
  leftAnkle: THREE.Group;
  rightAnkle: THREE.Group;
  /** `pose` is the interpolated render position; the sim state itself is never mutated. */
  update(enemy: EnemyState, time: number, pose: { x: number; z: number; yaw: number }): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

function part(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/**
 * A rifle held across the chest: silhouette first, then magazine and optic.
 *
 * `support` is the *glove of the support hand*, and it belongs to the weapon rather
 * than to the left arm. That is the same trick the player's view model uses: the
 * glove is on the weapon, so it can never drift off it, and the forearm is aimed at
 * it every frame. On a 0.44 m-shouldered skeleton the support grip sits ~5 cm beyond
 * the support arm's reach at the low-ready carry and ~20 cm beyond it while aiming
 * (see `uniform.ts`), and a glove that is part of the weapon turns both of those from
 * "a man with one hand on his rifle" into "a wrist 5 cm behind a glove".
 */
function buildRifle(materials: Materials, support: THREE.Material): THREE.Group {
  const rifle = new THREE.Group();
  part(rifle, roundedBox(0.062, 0.075, 0.24, 0.006), materials.gunmetal, 0, 0, -0.02);
  part(rifle, roundedBox(0.05, 0.05, 0.19, 0.006), materials.gunmetal, 0, 0, -0.2);
  part(rifle, chamferedCylinder(0.009, 0.009, 0.3, 10), materials.gunmetal, 0, 0.012, -0.42, Math.PI / 2);
  part(rifle, chamferedCylinder(0.016, 0.014, 0.06, 10), materials.steelPainted, 0, 0.012, -0.58, Math.PI / 2);
  part(rifle, roundedBox(0.03, 0.022, 0.05, 0.004), materials.gunmetal, 0, 0.05, -0.02);
  part(rifle, chamferedCylinder(0.016, 0.016, 0.06, 12), materials.gunmetal, 0, 0.058, -0.02, Math.PI / 2);
  const magazine = part(rifle, roundedBox(0.026, 0.11, 0.05, 0.006), materials.polymer, 0, -0.08, -0.03, -0.18);
  void magazine;
  part(rifle, roundedBox(0.028, 0.07, 0.035, 0.008), materials.polymer, 0, -0.062, 0.05, -0.3);
  part(rifle, roundedBox(0.03, 0.05, 0.08, 0.006), materials.polymer, 0, -0.005, 0.15);
  // The support hand, wrapped over the handguard. Built from the same constants the
  // carry solver measured the reach against, so the glove and the arithmetic cannot
  // disagree about where the hand is.
  const [sx, sy, sz] = COMBATANT.supportLocal;
  part(rifle, roundedBox(0.085, 0.075, 0.1, 0.02), support, sx, sy, sz);
  part(rifle, roundedBox(0.075, 0.03, 0.09, 0.01), support, sx - 0.012, sy + 0.045, sz - 0.01);
  part(rifle, roundedBox(0.02, 0.05, 0.035, 0.008), support, sx - 0.05, sy + 0.01, sz + 0.02);
  return rifle;
}

function buildBody(
  def: EnemyDef,
  materials: Materials,
  outfit: THREE.Material[],
  gear: THREE.Material[],
  skin: THREE.Material,
  trim: THREE.Material[],
  external: THREE.Object3D | null = null,
): {
  group: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftKnee: THREE.Group;
  rightKnee: THREE.Group;
  leftAnkle: THREE.Group;
  rightAnkle: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  torso: THREE.Group;
  rifle: THREE.Group | null;
} {

  const group = new THREE.Group();
  const torso = new THREE.Group();
  if (external) {
    torso.add(external);
    // A downloaded model is animated as a whole: its rig is not this skeleton, so the
    // joints are empty placeholders and the gait drives nothing but the body offset.
    return {
      group,
      leftLeg: new THREE.Group(),
      rightLeg: new THREE.Group(),
      leftKnee: new THREE.Group(),
      rightKnee: new THREE.Group(),
      leftAnkle: new THREE.Group(),
      rightAnkle: new THREE.Group(),
      leftArm: new THREE.Group(),
      rightArm: new THREE.Group(),
      torso,
      rifle: null,
    };
  }

  // ---- torso and kit -------------------------------------------------------
  part(torso, roundedBox(0.35, 0.26, 0.24, 0.05), outfit[0]!, 0, 1.02, 0); // pelvis
  part(torso, roundedBox(0.34, 0.3, 0.22, 0.06), outfit[0]!, 0, 1.26, 0); // abdomen
  part(torso, roundedBox(0.42, 0.36, 0.26, 0.07), outfit[0]!, 0, 1.5, 0); // chest
  // Plate carrier: front and back plates, shoulder straps, side straps.
  part(torso, roundedBox(0.36, 0.36, 0.06, 0.02), gear[0]!, 0, 1.48, 0.16);
  part(torso, roundedBox(0.34, 0.34, 0.05, 0.02), gear[0]!, 0, 1.5, -0.16);
  for (const x of [-0.11, 0.11]) {
    part(torso, roundedBox(0.07, 0.06, 0.34, 0.02), gear[0]!, x, 1.66, 0);
  }
  // Pouches: three across the belly, one on each hip. This is the detail that
  // makes a soldier read as a soldier, provided they are on the *front* — `kitZ` is
  // where that is decided, and these were all on the back.
  for (let i = -1; i <= 1; i++) {
    part(torso, roundedBox(0.09, 0.11, 0.055, 0.015), trim[0]!, i * 0.1, 1.36, kitZ('chestPouches', 0.2));
    part(torso, roundedBox(0.1, 0.03, 0.06, 0.008), gear[0]!, i * 0.1, 1.42, kitZ('chestPouches', 0.205));
  }
  part(torso, roundedBox(0.07, 0.09, 0.05, 0.012), trim[0]!, -0.17, 1.2, kitZ('hipPouches', 0.13), 0, 0.4, 0);
  part(torso, roundedBox(0.07, 0.09, 0.05, 0.012), trim[0]!, 0.17, 1.2, kitZ('hipPouches', 0.13), 0, -0.4, 0);
  // Radio on the left shoulder, with an antenna.
  part(torso, roundedBox(0.06, 0.09, 0.04, 0.01), gear[0]!, -0.19, 1.5, 0.05, 0, 0.3, 0);
  part(torso, chamferedCylinder(0.005, 0.005, 0.22, 6), gear[0]!, -0.19, 1.68, kitZ('radioAntenna', 0.08));
  // Backpack.
  part(torso, roundedBox(0.28, 0.32, 0.14, 0.04), gear[1]!, 0, 1.44, kitZ('backpack', 0.28));

  // ---- head ---------------------------------------------------------------
  part(torso, roundedBox(0.12, 0.09, 0.12, 0.03), skin, 0, 1.72, 0); // neck
  part(torso, roundedBox(0.19, 0.23, 0.21, 0.06), skin, 0, 1.86, 0.01); // skull
  part(torso, roundedBox(0.185, 0.09, 0.2, 0.04), outfit[0]!, 0, 1.78, 0.01); // shemagh wrap
  // Helmet: a lathed dome with a rim, a mount bracket and a side rail. Its own value
  // (1.35x content) between the jacket and the carrier, so the dome reads separate
  // from both the cloth shoulders and the armour.
  part(torso, lathe([[0, 0.02], [0.1, 0.02], [0.135, 0.06], [0.13, 0.13], [0.06, 0.175], [0, 0.18]], 18), trim[1]!, 0, 1.92, 0);
  part(torso, new THREE.TorusGeometry(0.132, 0.012, 6, 20), trim[1]!, 0, 1.935, 0, Math.PI / 2);
  part(torso, roundedBox(0.05, 0.045, 0.06, 0.01), gear[1]!, 0, 2.03, kitZ('nvgMount', 0.11)); // NVG mount
  part(torso, chamferedCylinder(0.02, 0.024, 0.07, 10), gear[1]!, 0, 2.03, kitZ('nvgMount', 0.15), Math.PI / 2);
  for (const side of [-1, 1]) {
    part(torso, roundedBox(0.02, 0.03, 0.09, 0.006), gear[1]!, side * 0.13, 1.95, -0.02);
  }
  // Goggles over the eyes, emissive so the archetype colour is legible at range.
  const goggles = part(torso, roundedBox(0.17, 0.055, 0.03, 0.008), gear[2]!, 0, 1.88, kitZ('goggles', 0.115));
  goggles.name = 'goggles';

  // ---- legs ---------------------------------------------------------------
  /**
   * One leg, as the three joints a walk needs: hip, knee, ankle.
   *
   * The shipped leg was a *single* pivot with everything baked into it, so the squad
   * had one joint per leg and walked on rigid sticks — no swing phase, no foot plant,
   * no toe-off, and a 0.42 rad hip swing that lifted the leading foot 8 cm off the
   * ground with nothing to correct it (AGENTS.md entry 29).
   *
   * Each joint is flattened into its own batch *while it is detached from its parent*
   * and attached afterwards, because `flattenLocal` traverses the whole subtree: a
   * knee baked into a thigh is a knee that never bends. (The weapon in the right hand
   * documents the same trap below.) The three pivots sit at the body's own dimensions
   * — 0.94 hip, -0.42 thigh, 0.46 shin, 0.08 foot, which is the 0.96 m of `GAIT`.
   */
  const leg = (side: number): { hip: THREE.Group; knee: THREE.Group; ankle: THREE.Group } => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.11, GAIT.hipHeight, 0);
    part(hip, roundedBox(0.16, 0.42, 0.17, 0.05), outfit[1]!, 0, -0.21, 0); // thigh

    const ankle = new THREE.Group();
    ankle.position.set(0, -0.88, 0); // hip -> 0.42 thigh -> 0.46 shin
    part(ankle, roundedBox(0.115, 0.09, 0.27, 0.03), trim[3]!, 0, -0.04, kitZ('toes', 0.05)); // boot
    part(ankle, roundedBox(0.115, 0.03, 0.28, 0.01), outfit[1]!, 0, -0.08, kitZ('toes', 0.05)); // sole
    flattenLocal(ankle, 'foot');

    const knee = new THREE.Group();
    knee.position.set(0, -0.42, 0);
    part(knee, roundedBox(0.14, 0.07, 0.15, 0.02), trim[2]!, 0, 0, kitZ('kneepads', 0.03)); // knee pad
    part(knee, roundedBox(0.13, 0.4, 0.14, 0.04), outfit[1]!, 0, -0.2, 0); // shin
    part(knee, roundedBox(0.11, 0.26, 0.12, 0.03), trim[3]!, 0, -0.38, kitZ('toes', 0.01)); // boot shaft
    flattenLocal(knee, 'shin');
    knee.add(ankle);

    // One draw call per material per joint instead of twenty per leg.
    flattenLocal(hip, 'thigh');
    hip.add(knee);
    group.add(hip);
    return { hip, knee, ankle };
  };
  const left = leg(-1);
  const right = leg(1);
  const leftLeg = left.hip;
  const rightLeg = right.hip;
  const leftKnee = left.knee;
  const rightKnee = right.knee;
  const leftAnkle = left.ankle;
  const rightAnkle = right.ankle;
  // Thigh holster + a knife on the chest, so the two sides differ.
  part(leftLeg, roundedBox(0.06, 0.14, 0.08, 0.015), gear[1]!, -0.1, -0.24, kitZ('thighHolster', 0.02));
  part(torso, roundedBox(0.03, 0.16, 0.05, 0.008), gear[1]!, 0.14, 1.4, kitZ('chestKnife', 0.19), 0, 0, 0.2);

  // ---- arms ---------------------------------------------------------------
  const arm = (side: number): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.22, 1.62, 0);
    group.add(pivot);
    part(pivot, roundedBox(0.12, 0.3, 0.13, 0.04), outfit[0]!, 0, -0.16, 0); // upper arm
    part(pivot, roundedBox(0.115, 0.09, 0.12, 0.03), gear[0]!, 0, -0.32, 0); // elbow pad
    // Arm-local -z is forward once the arm is pitched, so the forearm and glove sit
    // on the front of the bone rather than the back of it.
    part(pivot, roundedBox(0.105, 0.28, 0.11, 0.035), outfit[0]!, 0, -0.46, -0.01); // forearm
    part(pivot, roundedBox(0.09, 0.1, 0.13, 0.03), gear[1]!, 0, -0.62, -0.02); // glove
    return pivot;
  };
  const leftArm = arm(-1);
  const rightArm = arm(1);

  // Weapon held by the right arm, canted across the chest (a real carry). Where it
  // sits in the hand is not a guess any more: `carrySolution` puts the support grip
  // inside the support arm's reach at the low-ready pose, and `update` brings the
  // muzzle up to level as the soldier aims.
  const carry = carrySolution();
  const rifle = buildRifle(materials, gear[1]!);
  rifle.position.set(...COMBATANT.weaponInArm);
  rifle.rotation.set(...carry.restRotation);
  rightArm.add(rifle);
  if (def.melee) {
    rifle.visible = false;
    const blade = part(rightArm, roundedBox(0.012, 0.05, 0.32, 0.002), materials.steelPainted, 0.09, -0.66, -0.2, 0, 0, -0.3);
    blade.castShadow = false;
    part(rightArm, roundedBox(0.03, 0.045, 0.1, 0.01), materials.leather, 0.09, -0.68, -0.03, 0, 0, -0.3);
  }

  // The weapon hangs off the right arm, so it moves with the hand. It is batched
  // *separately* rather than with the arm, because the weapon's rotation in the hand
  // is animated (the low-ready cant swings up to level as the soldier aims) and a
  // batch cannot rotate independently of the limb it was baked into.
  // Order matters: the batcher traverses the whole subtree, so the arm must be
  // flattened while the weapon is *not* attached, or the weapon's parts get baked
  // into the arm's batch and the weapon can no longer rotate in the hand.
  if (!def.melee) rightArm.remove(rifle);
  flattenLocal(leftArm, 'arm_l');
  flattenLocal(rightArm, 'arm_r');
  if (!def.melee) {
    flattenLocal(rifle, 'enemy_rifle');
    rightArm.add(rifle);
  }
  flattenLocal(torso, 'torso');
  group.add(leftArm, rightArm, torso);

  // Resting carry: arms *forward*, elbows bent. The sign is `COMBATANT.restArm`,
  // positive, because for a -z-forward body a negative pitch swings the hand behind
  // the hip — which is what the shipped rig did, and why the squad walked around
  // holding its rifles behind its back.
  leftArm.rotation.x = COMBATANT.restArm;
  rightArm.rotation.x = COMBATANT.restArm;
  leftArm.rotation.z = 0.5;
  rightArm.rotation.z = COMBATANT.armCant;

  // A melee archetype carries a blade, not a rifle: no weapon to rotate, and its
  // support arm keeps the plain animated carry.
  return {
    group,
    leftLeg,
    rightLeg,
    leftKnee,
    rightKnee,
    leftAnkle,
    rightAnkle,
    leftArm,
    rightArm,
    torso,
    rifle: def.melee ? null : rifle,
  };
}

function makeHealthBar(): EnemyView['healthBar'] {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 8;
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }),
  );
  sprite.scale.set(0.85, 0.1, 1); // parity
  sprite.renderOrder = 50;
  return { sprite, canvas, texture, lastHealth: -1 };
}

export function createEnemyView(
  def: EnemyDef,
  id: number,
  scene: THREE.Scene,
  textures: TextureLibrary,
  materialLibrary: Materials,
  models?: ModelLibrary,
): EnemyView {
  // The palette lifts content's archetype colours into a value ladder and the
  // sheen gives every garment a rim, so a dark soldier is legible against a dark
  // street instead of being a cut-out (see characters/uniform.ts).
  const palette = deriveUniformPalette(def.render);
  const outfit = [
    sheened(materialLibrary.fabric, RIM.cloth, palette.jacket),
    sheened(materialLibrary.fabric, RIM.cloth, palette.trousers),
  ];
  const gear = [
    sheened(materialLibrary.polymer, RIM.nylon, palette.carrier, 0.7),
    sheened(materialLibrary.leather, RIM.nylon, palette.belt, 0.8),
    new THREE.MeshStandardMaterial({
      color: palette.visor,
      emissive: palette.visor,
      emissiveIntensity: 1.5,
      roughness: 0.25,
      metalness: 0.2,
    }),
  ];
  // Pouches, helmet, backpack, boots: the pieces that have to separate from the
  // garment they sit on, and which the value ladder was designed around.
  const trim = [
    sheened(materialLibrary.polymer, RIM.nylon, palette.pouches, 0.72),
    sheened(materialLibrary.leather, RIM.nylon, palette.helmet, 0.62),
    sheened(materialLibrary.polymer, RIM.nylon, palette.pouches, 0.66),
    sheened(materialLibrary.leather, RIM.nylon, palette.boots, 0.72),
  ];
  const skin = sheened(materialLibrary.skin, RIM.skin, 0x9a7355);
  const owned: THREE.MeshStandardMaterial[] = [...outfit, ...gear.slice(0, 2), ...trim, skin];

  // A downloaded character model takes over the body. It is animated as a whole
  // (yaw, hit flash, death fall) because a GLB's rig is not the procedural
  // skeleton — limbs are only driven when the baseline built them.
  const external = models?.instantiate('enemy', def.id) ?? null;
  const body = buildBody(def, materialLibrary, outfit, gear, skin, trim, external);
  const group = body.group;
  group.name = `enemy_${id}`;
  scene.add(group);

  if (def.scale !== 1) group.scale.setScalar(def.scale);

  // Laser telegraph (parity: a red line + dot that appears while aiming).
  const laserGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
  ]);
  const laserMaterial = new THREE.LineBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.55 });
  const laser = new THREE.Line(laserGeometry, laserMaterial);
  laser.visible = false;
  laser.position.set(0.22, 1.3, -0.62);
  group.add(laser);

  const laserDot = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: textures.soft,
      color: 0xff2020,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  laserDot.scale.setScalar(0.14);
  laserDot.visible = false;
  group.add(laserDot);

  const healthBar = makeHealthBar();
  healthBar.sprite.position.y = def.render.nameplateHeight;
  group.add(healthBar.sprite);

  // Hit flash lives on the *cloned* outfit materials, so one enemy lighting up
  // never lights up the squad.
  for (const material of owned) material.emissive.setHex(0x000000);

  // The carry, and the two poses the animation blends between: a low-ready cant
  // across the chest, and the same weapon levelled at the player (ADR-0015).
  const carry = carrySolution();
  const restQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(...carry.restRotation, 'XYZ'),
  );
  const aimQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(...carry.aimRotation, 'XYZ'),
  );
  const weaponQuaternion = new THREE.Quaternion();
  const weaponEuler = new THREE.Euler(0, 0, 0, 'XYZ');
  const supportPoint = new THREE.Vector3();
  const rotationArray: [number, number, number] = [0, 0, 0];
  const shoulderLeft = new THREE.Vector3(...COMBATANT.shoulderLeft);
  const handLocal = new THREE.Vector3(...COMBATANT.handLocal);
  /** 0 = low ready, 1 = weapon levelled at the player, eased like the arms. */
  let aimBlend = 0;
  /**
   * The walk cycle's phase, advanced by *distance travelled* rather than by time.
   * See `uniform.GAIT`: a phase driven by the clock skates the feet whenever the
   * simulation's speed and the animation's cadence disagree, and this is the enemy's
   * own interpolated position, so the two cannot disagree.
   */
  // Seeded off the id so a squad is not in lockstep: six soldiers stepping on the
  // same frame is the single loudest tell that an animation is procedural.
  let gaitPhase = id * 1.7;
  let lastX = Number.NaN;
  let lastZ = Number.NaN;
  let lastTime = 0;
  const gait: GaitPose = walkPose(0, GAIT.hipMin);

  const view: EnemyView = {
    group,
    id,
    healthBar,
    laser,
    laserDot,
    materials: owned,
    leftLeg: body.leftLeg,
    rightLeg: body.rightLeg,
    leftKnee: body.leftKnee,
    rightKnee: body.rightKnee,
    leftAnkle: body.leftAnkle,
    rightAnkle: body.rightAnkle,
    update(enemy: EnemyState, time: number, pose: { x: number; z: number; yaw: number }): void {
      group.position.set(pose.x, 0, pose.z);
      group.rotation.y = pose.yaw;

      if (!enemy.alive) {
        // Death: fall forward, arms limp, then sink and vanish (parity).
        const k = Math.min(1, enemy.deathTicks * (1 / 60) * 2.4);
        group.rotation.x = -k * Math.PI * 0.5;
        const fade = Math.max(0, enemy.deathTicks - 108) * (1 / 60);
        group.position.y = -fade * 0.5;
        body.torso.rotation.x = k * 0.25;
        body.leftArm.rotation.x = -0.4 + k * 1.4;
        body.rightArm.rotation.x = -0.4 + k * 1.2;
        body.leftArm.rotation.z = 0.5 + k * 0.5;
        body.rightArm.rotation.z = -0.32 - k * 0.6;
        body.leftLeg.rotation.x = k * 0.35;
        body.rightLeg.rotation.x = -k * 0.5;
        // The knees fold as the body goes down: a fall on locked knees is a felled
        // tree, and the ankle rolls so the toes stay behind the shins.
        body.leftKnee.rotation.x = -k * 0.7;
        body.rightKnee.rotation.x = -k * 0.45;
        body.leftAnkle.rotation.x = k * 0.25;
        body.rightAnkle.rotation.x = k * 0.3;
        laser.visible = false;
        laserDot.visible = false;
        healthBar.sprite.visible = false;
        return;
      }

      // Health bars appear only once you have hurt someone: a squad of floating
      // bars at full health is both a draw call each and the loudest cartoon tell
      // left in the frame.
      healthBar.sprite.visible = enemy.health < enemy.maxHealth - 0.5;

      // ---- gait ---------------------------------------------------------------
      // Hip, knee *and* ankle, solved from the ground up: the phase comes from the
      // distance covered (so the feet cannot skate), the amplitudes come from the
      // archetype's ground speed (so a rusher strides and a heavy shuffles), and the
      // body's height comes from the leg chain (so the planted foot is planted).
      const step = strideFor(enemy.def.speed);
      const moved = Number.isFinite(lastX) ? Math.hypot(pose.x - lastX, pose.z - lastZ) : 0;
      lastX = pose.x;
      lastZ = pose.z;
      const frame = lastTime > 0 ? Math.max(0, Math.min(0.1, time - lastTime)) : 1 / 60;
      lastTime = time;
      if (enemy.mode === 'move') gaitPhase += (moved / step.stride) * Math.PI * 2;
      else gaitPhase += frame * 0.9; // standing: a slow weight shift, not a stride
      walkPose(gaitPhase, step.hipSwing, gait);
      // Not moving is *less* gait, not a different pose: the same angles at 18%, which
      // is a soldier standing with their knees soft rather than a mannequin. The
      // angles are blended before the body height is re-solved, because a bob derived
      // from angles that were not applied is a floating foot.
      const walk = enemy.mode === 'move' ? 1 : 0.18;
      gait.leftHip *= walk;
      gait.rightHip *= walk;
      gait.leftKnee *= walk;
      gait.rightKnee *= walk;
      gait.leftAnkle *= walk;
      gait.rightAnkle *= walk;
      reseat(gait);
      body.leftLeg.rotation.x = gait.leftHip;
      body.rightLeg.rotation.x = gait.rightHip;
      body.leftKnee.rotation.x = gait.leftKnee;
      body.rightKnee.rotation.x = gait.rightKnee;
      body.leftAnkle.rotation.x = gait.leftAnkle;
      body.rightAnkle.rotation.x = gait.rightAnkle;
      group.position.y = gait.bob;
      // The shoulders counter-rotate the pelvis and the torso rolls over the stance
      // leg; the head takes only part of the pelvis's rise, so a walk reads as a walk
      // rather than as the whole figure riding a sine wave.
      body.torso.rotation.y = gait.yaw;
      body.torso.rotation.z = gait.roll;
      body.torso.position.y = -gait.bob * 0.35;

      const aiming = enemy.mode === 'aim' || enemy.mode === 'burst';
      const laserVisible = enemy.mode === 'aim';
      laser.visible = laserVisible;
      laserDot.visible = laserVisible;
      if (laserVisible) {
        laser.scale.set(1, 1, enemy.distance);
        laserDot.position.set(0.22, 1.3, -0.62 - enemy.distance);
      }
      // Aiming raises the weapon to the shoulder; idling lets the muzzle drift.
      // One blend drives the right arm, the weapon's rotation in the hand and the
      // support arm, so the two hands cannot disagree about the pose.
      const drift = aiming ? 0 : Math.sin(time * 2 + enemy.id) * 0.03;
      aimBlend += ((aiming ? 1 : 0) - aimBlend) * 0.25;
      const armPitch = COMBATANT.restArm + (COMBATANT.aimArm - COMBATANT.restArm) * aimBlend + drift;
      body.rightArm.rotation.x = armPitch;
      body.rightArm.rotation.z = COMBATANT.armCant;
      if (body.rifle) {
        weaponQuaternion.slerpQuaternions(restQuaternion, aimQuaternion, aimBlend);
        weaponEuler.setFromQuaternion(weaponQuaternion, 'XYZ');
        body.rifle.rotation.set(weaponEuler.x, weaponEuler.y, weaponEuler.z);
        // The support arm is solved, every frame, from where the weapon actually is
        // — not from a rest pose assumed at build time.
        rotationArray[0] = weaponEuler.x;
        rotationArray[1] = weaponEuler.y;
        rotationArray[2] = weaponEuler.z;
        carryPoint(rotationArray, armPitch, supportPoint);
        body.leftArm.quaternion.copy(aimLimb(shoulderLeft, handLocal, supportPoint));
      }

      const flash = enemy.flashT > 0;
      for (const material of owned) {
        if (flash) {
          material.emissive.setHex(0x7a1008); // parity hit flash
          material.emissiveIntensity = 0.9;
        } else if (material !== gear[2]) {
          material.emissive.setHex(0x000000);
          material.emissiveIntensity = 1;
        }
      }

      updateHealthBar(view, enemy);
    },
    setVisible(visible: boolean): void {
      group.visible = visible;
    },
    dispose(): void {
      scene.remove(group);
      for (const material of owned) material.dispose();
      gear[2]!.dispose();
      laserMaterial.dispose();
      laserGeometry.dispose();
      healthBar.texture.dispose();
      (healthBar.sprite.material as THREE.Material).dispose();
    },
  };

  return view;
}

function updateHealthBar(view: EnemyView, enemy: EnemyState): void {
  const bar = view.healthBar;
  const ratio = Math.max(0, enemy.health / enemy.maxHealth);
  if (Math.abs(bar.lastHealth - ratio) < 0.02 && bar.lastHealth >= 0) return;
  bar.lastHealth = ratio;
  const g = bar.canvas.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, 64, 8);
  g.fillStyle = '#141414';
  g.fillRect(0, 0, 64, 8);
  g.fillStyle = ratio > 0.5 ? '#8fdc46' : ratio > 0.25 ? '#ffb043' : '#ff4b3a';
  g.fillRect(1, 1, 62 * ratio, 6);
  bar.texture.needsUpdate = true;
}

/** Maintains one view per live enemy, creating and destroying as the sim changes. */
export class EnemyViewPool {
  private readonly views = new Map<number, EnemyView>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly textures: TextureLibrary,
    private readonly materials: Materials,
    private readonly models?: ModelLibrary,
  ) {}

  sync(
    poses: readonly { enemy: EnemyState; x: number; z: number; yaw: number }[],
    time: number,
  ): void {
    for (const pose of poses) {
      const enemy = pose.enemy;
      let view = this.views.get(enemy.id);
      if (!view) {
        view = createEnemyView(enemy.def, enemy.id, this.scene, this.textures, this.materials, this.models);
        this.views.set(enemy.id, view);
      }
      view.update(enemy, time, pose);
    }

    // Drop views for enemies the simulation has already cleaned up.
    for (const [id, view] of this.views) {
      const stillExists = poses.some((pose) => pose.enemy.id === id);
      if (!stillExists) {
        view.dispose();
        this.views.delete(id);
      }
    }
  }

  get count(): number {
    return this.views.size;
  }

  clear(): void {
    for (const view of this.views.values()) view.dispose();
    this.views.clear();
  }
}
