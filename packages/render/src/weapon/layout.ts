/**
 * Weapon layout: the dimensions, in metres, of everything the first-person view
 * model is made of — plus the pose solution and the arm rig that holds it.
 *
 * This module exists because of the defect the art review found: the old view
 * model was a *plank*. `viewModel.body[2]` (0.44) was used as `depth * 1.5` for
 * the receiver, so the receiver alone was 0.66 m long, the whole weapon was a
 * metre of flat box, the muzzle flash sat 1.36 m from the eye at ADS, and the
 * stock never reached the shoulder. None of that is visible from a screenshot
 * unless you know what the numbers should be, which is what `MM` and the
 * anchors here are for: every part is authored at a size a real M4-class weapon
 * has, and `layoutProblems()` states the invariants so a test can prove them
 * rather than a reviewer asserting them.
 *
 * Nothing here touches three.js beyond vectors, and nothing here builds meshes:
 * `viewmodel.ts` consumes a `WeaponLayout` and turns it into geometry, which is
 * why the rig can be measured in a unit test with no GPU and no DOM.
 */
import * as THREE from 'three';
import type { WeaponDef } from '@iron/content';

export type WeaponMaterialKey =
  | 'gunmetal'
  | 'steel'
  | 'polymer'
  /**
   * Oiled walnut. The AK's furniture is wood, and a polymer AK is a different
   * weapon — the review asked for the weapon the game calls an AK-47.
   */
  | 'wood'
  | 'leather'
  | 'sleeve'
  | 'skin'
  | 'lens'
  | 'dot';

/**
 * The three procedural builds.
 *
 * They share the anchors, the pose solver and the arm rig, and differ in *what is on
 * the receiver*: a carbine's handguard and optic, an AK's gas system and wooden
 * furniture, a pistol's slide. That is why the archetype is a property of the layout
 * rather than a second renderer: one rig, three guns.
 */
export type WeaponArchetype = 'carbine' | 'ak' | 'pistol';

export type PartShape = 'box' | 'tube' | 'ring';

export interface WeaponPart {
  id: string;
  shape: PartShape;
  material: WeaponMaterialKey;
  /** Full extent in metres: [width(x), height(y), length(z)]. */
  size: [number, number, number];
  /** Centre in weapon-local metres. +z is rearward, -z is toward the muzzle. */
  at: [number, number, number];
  rot?: [number, number, number];
  /** Radius for `tube`/`ring` shapes, in metres. */
  radius?: number;
  radialSegments?: number;
  /**
   * Ring shape only: the hole's radius. A part with a hole is a *ring* (a sight
   * bezel, a sling loop); one without is a disc (a lens, a reticle).
   */
  innerRadius?: number;
  /**
   * A tube the player looks *down*.
   *
   * A capped cylinder is a solid disc of metal, and a capped cylinder on the sight
   * line is exactly the optic the player was looking at: at 12 cm eye relief the rear
   * cap of the sight tube filled the aim point with black. `open` builds the part
   * open-ended and double-sided, so what the player sees down the tube is the tube's
   * own inner wall and then the world — the sight picture (AGENTS.md entry 27).
   */
  open?: boolean;
}

/**
 * The real-world dimensions the layout is authored against, in metres.
 *
 * These are the numbers an armourer would recognise (an M4A1's receiver is
 * 21 cm long, its rail slots are 8.5 mm, its bore sits ~6.8 cm under the sight
 * line). The review's complaint was not "the gun needs more polygons" — it was
 * "the gun is not a gun", and a gun is a set of dimensions before it is a mesh.
 */
export const MM = {
  /** Upper + lower receiver, magazine well included. */
  receiver: 0.21,
  /** Carbine handguard over the barrel. */
  handguard: 0.16,
  /** Muzzle device. */
  flashHider: 0.065,
  /** Buffer tube + collapsed stock behind the receiver. */
  stock: 0.22,
  /** Threaded barrel inside the handguard, from the receiver's front face. */
  barrelFromReceiver: 0.36,
  /** Receiver height, upper + lower, without the optic. */
  receiverHeight: 0.062,
  /** Picatinny rail strip: 19 mm tall, 8.5 mm slot pitch. */
  railHeight: 0.019,
  railSlot: 0.0085,
  /** Bore centre above the receiver's mid-line. */
  boreAboveCentre: 0.010,
  /** Red-dot sight: tube length and its axis above the bore (lower 1/3 co-witness). */
  opticTube: 0.075,
  opticAboveBore: 0.058,
  opticMount: 0.030,
  /** Pistol grip: length under the receiver, thickness, rake. */
  gripLength: 0.10,
  gripThickness: 0.042,
  /** Magazine: body height below the well + floorplate. */
  magazine: 0.19,
  triggerGuard: 0.05,
} as const;

/**
 * Pose constants.
 *
 * `eyeRelief` is what puts the weapon in the hands at ADS: the old model kept
 * content's parity z values verbatim, which placed the muzzle 1.13–1.36 m from
 * the eye (a real carbine is 0.7–0.8 m) and the butt 44 cm *ahead* of the
 * shooter, so the weapon read as a slab floating in front of the camera.
 *
 * The hip hold is *solved*, not typed in. `supportReach` says how far along the
 * support arm the support hand sits at the hip; `hipPose` then returns the weapon
 * depth that puts it exactly there. Content's `viewModel.hip`/`ads` x/y are the
 * prototype's parity numbers and are no longer the source of the hold, because
 * they cannot be: holding content's 0.27 m hip offset 0.62 m out puts the
 * handguard 0.77 m from the left shoulder, and a 1.8 m soldier's arm is 0.57 m. A
 * weapon held there is a weapon nothing is holding.
 */
export const POSE = {
  /**
   * Rear lens to eye at full ADS, metres.
   *
   * A red dot's *mechanical* eye relief is 7–15 cm, and the sixth review is why this is
   * 0.17 rather than 0.12: the aim zoom is 1.36x (75° hip → 55° aimed), and apparent
   * size is `2 atan(radius / distance) / fov`. At 12 cm a 46 mm housing is 39% of the
   * frame's height and a 21 cm receiver fills the bottom third — the report's "a large
   * object attached to the weapon rather than a properly functioning optic". At 17 cm
   * the 41 mm housing is 25% and the 35 mm aperture is 21%: a sight picture with the
   * world visible inside it and a weapon that reads as carried rather than worn.
   *
   * **0.17 and not 0.19, because the arms decide the rest.** Moving the optic away
   * moves the support grip away with it — the grip is a point *on the weapon* — and
   * 0.19 put the kr74's support hand 99% along its own arm, which is the failure the
   * rig test exists to catch (`arm_short_left_1`). So this is the largest eye relief
   * every weapon in the loadout can hold: frame the optic as far away as the hands
   * still reach it, and no further. Pushing it needs the support hand to *slide back*
   * along the handguard as the weapon comes up, which is a bigger change than a
   * framing fix and is noted rather than done.
   *
   * This is a *presentation* distance and it is stated as one. What it is not is a
   * change to the ray: the sight line is still solved onto the camera axis (see
   * `posePosition`), so the reticle is the point of aim at any eye relief.
   */
  eyeRelief: 0.17,
  /**
   * Hip-fire hold, camera space: just right of centre, below the eye.
   *
   * 0.17 m down is a *low ready* — the weapon at chest height with the muzzle down —
   * and it is also the number that keeps the weapon in the frame. At the shipped 0.245
   * the receiver and both hands sat below the bottom edge of a 75-degree camera, so the
   * player saw the front half of a rifle floating in the corner and no hands on it.
   */
  hipX: 0.11,
  hipY: -0.17,
  /** Support grip at the hip, 0 = magazine well, 1 = out on the handguard. */
  hipForward: 0.35,
  /** Support-hand extension at the hip, as a fraction of the arm's length. */
  supportReach: 0.9,
} as const;

export interface WeaponAnchors {
  bore: number;
  muzzle: THREE.Vector3;
  /** Support grip when the weapon is at the hip: back near the magazine well. */
  supportHip: THREE.Vector3;
  /** Where the flash sprite and light origin sit. */
  muzzleFlash: THREE.Vector3;
  eject: THREE.Vector3;
  optic: { front: THREE.Vector3; rear: THREE.Vector3; axis: THREE.Vector3; height: number };
  /** Right hand wraps this: the pistol grip's centre. */
  gripRight: THREE.Vector3;
  /** Left hand wraps this: the handguard. */
  handguardLeft: THREE.Vector3;
  butt: THREE.Vector3;
  magWell: THREE.Vector3;
}

export interface WeaponLayout {
  id: string;
  archetype: WeaponArchetype;
  parts: WeaponPart[];
  anchors: WeaponAnchors;
  /** Receiver length actually used, so tests can assert the plank is gone. */
  receiverLength: number;
  totalLength: number;
  /**
   * Rear lens (or rear notch) to eye at full ADS, metres.
   *
   * A weapon's own number, not a global one: a red dot sits at the back of the
   * receiver and is 12 cm from the eye, while iron sights are a hand's length
   * forward — 30 cm for a pistol at the end of the arm, and a rifle's leaf is closer
   * to the eye than that. Typing one value for every weapon is how a pistol ends up
   * aimed from inside its own slide.
   */
  eyeRelief: number;
  /**
   * The hip hold in camera space: x/y are the weapon's origin, and `reach` is how far
   * along the support arm the support hand sits as a fraction of the arm's length.
   *
   * `reach` is per weapon because the two holds are different: a rifle at the hip has
   * its support arm out on the handguard (0.9), while a pistol's low-ready has both
   * elbows bent with the weapon up at chest height (0.75). Solving them with one
   * number is how a pistol ends up either off the bottom of the frame or held at arm's
   * length in front of the player's face.
   */
  hip: { x: number; y: number; reach?: number };
}

/**
 * Build the layout.
 *
 * `def.viewModel.body` is [width, height, total length behind the barrel] and
 * `barrelLength` is measured from the receiver's front face (content parity), so
 * everything scales from those two numbers and the MM table above supplies the
 * parts that are the same on every carbine.
 */
/** The layout for a weapon def, by its archetype. */
export function weaponLayout(def: WeaponDef): WeaponLayout {
  switch (def.viewModel.archetype) {
    case 'pistol':
      return pistolLayout(def);
    case 'ak':
      return akLayout(def);
    case 'carbine':
    default:
      return carbineLayout(def);
  }
}

function carbineLayout(def: WeaponDef): WeaponLayout {
  const [width, , bodyLength] = def.viewModel.body;
  const barrel = def.viewModel.barrelLength;
  const s = bodyLength / 0.44;

  const recvLen = MM.receiver * s;
  const recvH = MM.receiverHeight * s;
  const recvRear = 0.095 * s;
  const recvFront = recvRear - recvLen;
  const handguardLen = Math.min(MM.handguard * s, Math.max(0.06, barrel * 0.6));
  const handguardFront = recvFront - handguardLen;
  const barrelEnd = recvFront - barrel;
  const tip = barrelEnd - MM.flashHider;
  const bore = MM.boreAboveCentre * s;
  const railTop = recvH / 2 + MM.railHeight;
  const opticY = railTop + MM.opticMount;
  const opticZ = recvRear - 0.055 * s;
  const buttZ = recvRear + MM.stock * s;

  const parts: WeaponPart[] = [];

  const add = (part: WeaponPart): void => {
    parts.push(part);
  };

  // ---- receiver ------------------------------------------------------------
  add({ id: 'recv_lower', shape: 'box', material: 'gunmetal', size: [width, recvH * 0.52, recvLen], at: [0, -recvH * 0.16, recvRear - recvLen / 2] });
  add({ id: 'recv_upper', shape: 'box', material: 'gunmetal', size: [width, recvH * 0.56, recvLen * 0.94], at: [0, recvH * 0.2, recvRear - recvLen * 0.47] });
  // Machined seam between the two forgings — the line that says "assembly".
  add({ id: 'recv_seam', shape: 'box', material: 'steel', size: [width * 0.99, 0.003, recvLen * 0.9], at: [0, -recvH * 0.02, recvRear - recvLen * 0.47] });
  // Brass deflector, ejection port lip and the forward assist.
  add({ id: 'deflector', shape: 'box', material: 'gunmetal', size: [0.014, 0.022, 0.03], at: [width * 0.5, bore + 0.006, recvRear - recvLen * 0.22] });
  // The ejection port is a dark opening, not a bright plate: steel here caught the
  // view light as a pale rectangle on the receiver's flank.
  add({ id: 'port', shape: 'box', material: 'gunmetal', size: [0.005, 0.028, 0.062], at: [width * 0.5, bore + 0.004, recvRear - recvLen * 0.36] });
  add({ id: 'forward_assist', shape: 'tube', material: 'steel', radius: 0.009, size: [0.018, 0.018, 0.03], at: [width * 0.36, bore + 0.014, recvRear - 0.012], rot: [Math.PI / 2, 0, 0] });
  add({ id: 'charging_handle', shape: 'box', material: 'gunmetal', size: [0.03, 0.012, 0.028], at: [-width * 0.32, recvH * 0.34, recvRear + 0.006] });
  add({ id: 'bolt_catch', shape: 'box', material: 'steel', size: [0.008, 0.016, 0.026], at: [-width * 0.42, -recvH * 0.14, recvRear - recvLen * 0.3] });
  add({ id: 'mag_release', shape: 'box', material: 'steel', size: [0.01, 0.012, 0.016], at: [width * 0.42, -recvH * 0.2, recvRear - recvLen * 0.5] });
  add({ id: 'safety', shape: 'tube', material: 'steel', radius: 0.007, size: [0.014, 0.014, 0.024], at: [-width * 0.44, -recvH * 0.1, recvRear - recvLen * 0.72], rot: [0, 0, Math.PI / 2] });

  // ---- top rail ------------------------------------------------------------
  // A picatinny rail's cross slots are *gaps*, not features: the old build drew a
  // continuous rail and then stood a bright steel slab 1 mm proud of it every 17 mm,
  // which strobed as bright rungs under the view light — the review's banding. The
  // honest build is the real one: dark base one step below the rail's top face (so
  // every gap reads as a shadow), and the rail itself as the segments between the
  // slots. Gaps cannot strobe; proud slabs always do.
  const railLen = recvLen * 0.92;
  const railZ = recvRear - recvLen * 0.48;
  add({ id: 'rail_base', shape: 'box', material: 'gunmetal', size: [width * 0.5, MM.railHeight, railLen], at: [0, recvH / 2 + MM.railHeight / 2 - 0.0005, railZ] });
  const railSegments = Math.floor(railLen / (MM.railSlot * 2));
  const segmentLen = MM.railSlot; // 50% duty: 8.5 mm land, 8.5 mm gap
  for (let i = 0; i < railSegments; i++) {
    add({
      id: `rail_seg_${i}`,
      shape: 'box',
      material: 'gunmetal',
      size: [width * 0.58, MM.railHeight, segmentLen],
      at: [0, recvH / 2 + MM.railHeight / 2, railZ + railLen / 2 - segmentLen / 2 - i * MM.railSlot * 2],
    });
  }

  // ---- handguard -----------------------------------------------------------
  add({ id: 'handguard', shape: 'box', material: 'gunmetal', size: [width * 0.86, recvH * 0.86, handguardLen], at: [0, 0, handguardFront + handguardLen / 2] });
  add({ id: 'delta_ring', shape: 'tube', material: 'steel', radius: 0.019, size: [0.038, 0.038, 0.024], at: [0, 0, recvFront - 0.012], rot: [Math.PI / 2, 0, 0] });
  // M-LOK is a *recessed* channel: the old tabs stood 2 mm proud of the handguard in
  // bright gunmetal and the handguard read as a ladder. The side slots survive as
  // flush-dark slivers (1 mm proud, same material, inside the host's silhouette in z)
  // so the eye reads a shadow line where a slot is. The *bottom* row is gone
  // entirely: seen from behind at ADS every proud edge on the handguard's underside
  // stacks into rungs — the review's banding — and a bottom rail reads fine as the
  // handguard's own bevelled edge.
  const guardSlots = Math.max(2, Math.floor(handguardLen / 0.032));
  const guardHalfW = width * 0.43;
  for (let i = 0; i < guardSlots; i++) {
    const z = handguardFront + 0.026 + i * 0.032;
    for (const side of [-1, 1]) {
      add({ id: `mlok_${i}_${side}`, shape: 'box', material: 'gunmetal', size: [0.003, recvH * 0.3, 0.012], at: [side * (guardHalfW - 0.0005), 0, z] });
    }
  }
  // Heat-shield vents, in the two positions a shooter actually sees. Dark, flush:
  // a vent is a hole, and a proud bright 2 mm slab is a ladder rung.
  for (const side of [-1, 1]) {
    add({ id: `vent_a_${side}`, shape: 'box', material: 'gunmetal', size: [0.002, recvH * 0.26, 0.05], at: [side * (guardHalfW - 0.0008), recvH * 0.1, handguardFront + 0.05] });
    add({ id: `vent_b_${side}`, shape: 'box', material: 'gunmetal', size: [0.002, recvH * 0.26, 0.05], at: [side * (guardHalfW - 0.0008), recvH * 0.1, handguardFront + 0.11] });
  }

  // ---- barrel, gas system, muzzle device ----------------------------------
  add({ id: 'barrel', shape: 'tube', material: 'steel', radius: 0.0105, size: [0, 0, barrel], at: [0, bore, recvFront - barrel / 2], rot: [Math.PI / 2, 0, 0], radialSegments: 16 });
  add({ id: 'barrel_chamber', shape: 'tube', material: 'steel', radius: 0.0145, size: [0, 0, 0.07], at: [0, bore, recvFront - 0.028], rot: [Math.PI / 2, 0, 0], radialSegments: 16 });
  add({ id: 'gas_block', shape: 'box', material: 'gunmetal', size: [0.026, 0.028, 0.034], at: [0, bore + 0.008, handguardFront + 0.03] });
  add({ id: 'gas_tube', shape: 'tube', material: 'steel', radius: 0.0035, size: [0, 0, handguardLen], at: [0, bore + 0.018, handguardFront + handguardLen / 2], rot: [Math.PI / 2, 0, 0], radialSegments: 8 });
  add({ id: 'flash_hider', shape: 'tube', material: 'steel', radius: 0.0185, size: [0.037, 0.037, MM.flashHider], at: [0, bore, barrelEnd - MM.flashHider / 2], rot: [Math.PI / 2, 0, 0], radialSegments: 16 });
  for (let i = 0; i < 3; i++) {
    add({ id: `hider_prong_${i}`, shape: 'box', material: 'gunmetal', size: [0.005, 0.026, MM.flashHider * 0.6], at: [0, bore + 0.014, barrelEnd - MM.flashHider * 0.3 - i * 0.019] });
  }

  // ---- optic ---------------------------------------------------------------
  // Everything on the sight line is authored so the sight line is *clear*: the tube
  // and its bezel are open rings rather than capped discs, the turret and the
  // windage knob are bolted to the outside of the tube instead of standing in the
  // aperture, and the only two things in the bore are the glass (transparent, and thin
  // enough to see through — materials/weapon.ts) and the reticle.
  //
  // The sixth pass took 2 mm off the bezel's wall (23 → 20.5 mm outer on an 18.5 mm
  // aperture) and pulled the turret and the knob in to the tube's own surface, because
  // "the optic housing should frame the sight picture without taking up unnecessary
  // screen space": *housing* is the frame minus the aperture, and at 19 cm of eye
  // relief every millimetre of wall is 0.3° of a 55° frame.
  //
  // The mount reaches from the rail to the tube's *underside*, not to its centre: a
  // block as tall as `opticMount` (0.030) overlaps the lower 19 mm of a sight tube whose
  // radius is 19 mm, i.e. it fills the bottom half of the aperture. The ray test found
  // it: the sight picture was the top half of the tube and a wall of rail mount below.
  const opticMountHeight = MM.opticMount - 0.019;
  add({ id: 'optic_mount', shape: 'box', material: 'gunmetal', size: [width * 0.6, opticMountHeight, 0.062], at: [0, railTop + opticMountHeight / 2, opticZ] });
  add({ id: 'optic_tube', shape: 'tube', material: 'gunmetal', radius: 0.019, size: [0.038, 0.038, MM.opticTube], at: [0, opticY, opticZ], rot: [Math.PI / 2, 0, 0], radialSegments: 20, open: true });
  add({ id: 'optic_bezel', shape: 'ring', material: 'gunmetal', radius: 0.0205, innerRadius: 0.0185, size: [0.041, 0.041, 0.006], at: [0, opticY, opticZ + MM.opticTube / 2 + 0.001] });
  // Elevation turret and windage knob: on the tube's *surface*, where a real sight bolts
  // them, so neither one stands in the aperture — and the offset is `tube radius + their
  // own radius`, not eyeballed, because a stub whose base dips below 19 mm from the axis
  // is a stub you can see through the sight. The ray test sweeps the whole aperture
  // (0.0175 of the 0.0185 it is), so "mostly out of the way" is not good enough.
  add({ id: 'optic_turret', shape: 'tube', material: 'gunmetal', radius: 0.0085, size: [0.017, 0.017, 0.010], at: [0, opticY + 0.0275, opticZ], radialSegments: 12 });
  add({ id: 'optic_knob', shape: 'tube', material: 'gunmetal', radius: 0.0085, size: [0.017, 0.017, 0.010], at: [0.0275, opticY, opticZ], rot: [0, 0, Math.PI / 2], radialSegments: 12 });
  add({ id: 'lens_rear', shape: 'ring', material: 'lens', radius: 0.0175, size: [0.035, 0.035, 0.004], at: [0, opticY, opticZ + MM.opticTube / 2 - 0.006] });
  add({ id: 'lens_front', shape: 'ring', material: 'lens', radius: 0.0175, size: [0.035, 0.035, 0.004], at: [0, opticY, opticZ - MM.opticTube / 2 + 0.006] });
  // The reticle: a crisp 2.4 mm dot inside a 5.2 mm ring, on the bore's own axis, drawn
  // unlit so it reads as a source in a night frame rather than as a lit dot of paint.
  //
  // Both halves are deliberate. The dot is the precision cue and it is small (14 px of a
  // 1080p frame at 1.36x — a dot you can put on a head), and the ring is the acquisition
  // cue: a *shape* reads against a bright background (pale pavement, a muzzle flash) and
  // against a dark one, where a red dot alone washes out into the scene. Neither one
  // blooms (materials/weapon.ts), because a glowing reticle's centre is not where you
  // are aiming — and at 31 px across, this one has no room to be a blob.
  add({ id: 'dot', shape: 'ring', material: 'dot', radius: 0.0012, size: [0.0024, 0.0024, 0.0008], at: [0, opticY, opticZ - 0.008] });
  add({ id: 'dot_ring', shape: 'ring', material: 'dot', radius: 0.0026, innerRadius: 0.0021, size: [0.0052, 0.0052, 0.0008], at: [0, opticY, opticZ - 0.0082] });

  // ---- grip, trigger, magazine --------------------------------------------
  add({ id: 'grip', shape: 'box', material: 'polymer', size: [0.032, MM.gripLength, MM.gripThickness], at: [0, -recvH * 0.5 - MM.gripLength * 0.42, recvRear - recvLen * 0.66], rot: [-0.34, 0, 0] });
  add({ id: 'grip_heel', shape: 'box', material: 'polymer', size: [0.034, 0.02, 0.05], at: [0, -recvH * 0.5 - MM.gripLength * 0.86, recvRear - recvLen * 0.74] });
  add({ id: 'trigger_guard_front', shape: 'box', material: 'steel', size: [0.008, 0.026, 0.008], at: [0, -recvH * 0.5 - 0.02, recvRear - recvLen * 0.44] });
  add({ id: 'trigger_guard_bar', shape: 'box', material: 'steel', size: [0.026, 0.004, MM.triggerGuard], at: [0, -recvH * 0.5 - 0.032, recvRear - recvLen * 0.55] });
  add({ id: 'trigger', shape: 'box', material: 'steel', size: [0.006, 0.024, 0.008], at: [0, -recvH * 0.5 - 0.012, recvRear - recvLen * 0.55], rot: [0.2, 0, 0] });
  add({ id: 'mag_well', shape: 'box', material: 'gunmetal', size: [width * 0.82, recvH * 0.3, 0.075], at: [0, -recvH * 0.58, recvRear - recvLen * 0.36] });
  add({ id: 'magazine', shape: 'box', material: 'polymer', size: [0.058, MM.magazine, 0.03], at: [0, -recvH * 0.62 - MM.magazine / 2, recvRear - recvLen * 0.34], rot: [0.16, 0, 0] });
  // Magazine witness ribs removed: three proud polymer bands down the magazine
  // stacked with the handguard slots and stock holes into the ladder the review
  // photographed. The stippled polymer texture carries the "moulded magazine" read
  // at the distance the magazine is actually inspected (it is 0.5 m from the eye,
  // not 40 cm) — geometry here only added edges.
  add({ id: 'mag_floor', shape: 'box', material: 'polymer', size: [0.062, 0.012, 0.036], at: [0, -recvH * 0.62 - MM.magazine + 0.006, recvRear - recvLen * 0.34] });

  // ---- stock ---------------------------------------------------------------
  add({ id: 'buffer_tube', shape: 'tube', material: 'steel', radius: 0.019, size: [0.038, 0.038, MM.stock * s * 0.86], at: [0, -0.004, recvRear + MM.stock * s * 0.42], rot: [Math.PI / 2, 0, 0], radialSegments: 14 });
  add({ id: 'stock_body', shape: 'box', material: 'polymer', size: [width * 0.48, recvH * 0.86, MM.stock * s * 0.72], at: [0, -0.004, recvRear + MM.stock * s * 0.44] });
  add({ id: 'stock_cheek', shape: 'box', material: 'polymer', size: [width * 0.42, 0.026, MM.stock * s * 0.5], at: [0, 0.024, recvRear + MM.stock * s * 0.42] });
  add({ id: 'butt_pad', shape: 'box', material: 'polymer', size: [width * 0.54, recvH * 0.94, 0.018], at: [0, -0.006, buttZ - 0.01] });
  // Sling-stock holes removed: four proud 6 mm steel boxes down the stock's flank
  // each caught the view light as a bright dot, and the row read as rivets on a
  // boiler plate. A collapsed-stock hole is a *recess*; the stock reads fine without
  // them (the steel sling_loop below carries the same story at one scale).
  add({ id: 'sling_loop', shape: 'ring', material: 'steel', radius: 0.011, innerRadius: 0.007, size: [0.022, 0.022, 0.005], at: [-width * 0.34, -recvH * 0.44, recvRear - 0.01], rot: [0, Math.PI / 2, 0] });
  add({ id: 'qd_point', shape: 'tube', material: 'steel', radius: 0.006, size: [0.012, 0.012, 0.014], at: [-width * 0.45, -recvH * 0.3, handguardFront + 0.02], rot: [0, 0, Math.PI / 2] });

  const magWell = new THREE.Vector3(0, -recvH * 0.62, recvRear - recvLen * 0.34);
  const handguardLeft = new THREE.Vector3(0, -0.004, handguardFront + handguardLen * 0.45);
  // A shooter's support hand sits back by the magazine well while the weapon is
  // at the hip and slides out along the handguard as it comes up — partly because
  // that is what the hand does, and partly because it is the difference between a
  // support arm that reaches its grip and one that does not.
  const supportHip = magWell.clone().lerp(handguardLeft, POSE.hipForward);

  const anchors: WeaponAnchors = {
    bore,
    supportHip,
    muzzle: new THREE.Vector3(0, bore, tip),
    muzzleFlash: new THREE.Vector3(0, bore, tip - 0.02),
    eject: new THREE.Vector3(width * 0.5 + 0.014, bore + 0.008, recvRear - recvLen * 0.32),
    optic: {
      axis: new THREE.Vector3(0, 0, -1),
      height: opticY,
      front: new THREE.Vector3(0, opticY, opticZ - MM.opticTube / 2 - 0.004),
      rear: new THREE.Vector3(0, opticY, opticZ + MM.opticTube / 2 + 0.004),
    },
    gripRight: new THREE.Vector3(0, -recvH * 0.5 - MM.gripLength * 0.42, recvRear - recvLen * 0.66),
    handguardLeft,
    butt: new THREE.Vector3(0, -0.006, buttZ),
    magWell,
  };

  return {
    id: def.id,
    archetype: 'carbine',
    parts,
    anchors,
    receiverLength: recvLen,
    totalLength: buttZ - tip,
    eyeRelief: POSE.eyeRelief,
    hip: { x: POSE.hipX, y: POSE.hipY },
  };
}

/**
 * AK-pattern rifle: gas system over the barrel, wooden furniture, rocking magazine.
 *
 * The parts that make it not-an-M4 are the ones an armourer would name: the gas tube
 * and its block sit *above* the bore and are visible over the handguard, the lower
 * handguard and stock are walnut rather than polymer, the magazine rocks forward in
 * four segments rather than dropping straight, the bolt handle is on the right, and
 * it aims down the iron sights — a leaf at the front of the receiver and a post on
 * the gas block — so `eyeRelief` is 0.28 m and the sight line is 5 cm over the bore
 * rather than a red dot's 3 cm.
 */
function akLayout(def: WeaponDef): WeaponLayout {
  const [width, , bodyLength] = def.viewModel.body;
  const barrel = def.viewModel.barrelLength;
  const s = bodyLength / 0.44;

  const recvLen = MM.receiver * s;
  const recvH = MM.receiverHeight * s;
  const recvRear = 0.095 * s;
  const recvFront = recvRear - recvLen;
  const barrelEnd = recvFront - barrel;
  const brake = 0.055; // slant brake
  const tip = barrelEnd - brake;
  const bore = MM.boreAboveCentre * s;
  const sightY = bore + 0.05;
  const guardLen = 0.2 * s;
  const guardFront = recvFront - guardLen;
  const buttZ = recvRear + 0.3 * s;
  const gasZ = recvFront - 0.17;
  const parts: WeaponPart[] = [];
  const add = (part: WeaponPart): void => {
    parts.push(part);
  };

  // ---- receiver ------------------------------------------------------------
  add({ id: 'recv_lower', shape: 'box', material: 'gunmetal', size: [width, recvH * 0.6, recvLen], at: [0, -recvH * 0.14, recvRear - recvLen / 2] });
  // The AK's dust cover: a rounded top that is a separate, replaceable part.
  add({ id: 'dust_cover', shape: 'box', material: 'gunmetal', size: [width * 0.92, recvH * 0.4, recvLen * 0.8], at: [0, recvH * 0.3, recvRear - recvLen * 0.46] });
  add({ id: 'recv_seam', shape: 'box', material: 'steel', size: [width * 0.94, 0.003, recvLen * 0.78], at: [0, recvH * 0.1, recvRear - recvLen * 0.46] });
  // The bolt handle: the AK's most recognisable control, on the right, forward of the
  // rear sight. It rides in a machined channel, so it sits *inside* the dust cover's
  // silhouette — the old placement at exactly half-width had it half-buried, reading
  // as a bright nub sticking out of the receiver's flank.
  add({ id: 'bolt_handle', shape: 'tube', material: 'gunmetal', radius: 0.007, size: [0.014, 0.014, 0.05], at: [width * 0.46, recvH * 0.18, recvRear - recvLen * 0.42], rot: [0, 0, Math.PI / 2] });
  add({ id: 'safety_lever', shape: 'box', material: 'steel', size: [0.008, 0.05, 0.012], at: [width * 0.46, -recvH * 0.2, recvRear - recvLen * 0.3] });
  add({ id: 'mag_release', shape: 'box', material: 'steel', size: [0.012, 0.014, 0.018], at: [0, -recvH * 0.5, recvRear - recvLen * 0.52] });
  add({ id: 'takedown_pin', shape: 'tube', material: 'steel', radius: 0.006, size: [0.012, 0.012, 0.016], at: [0, -recvH * 0.06, recvRear - recvLen * 0.62], rot: [0, 0, Math.PI / 2] });

  // ---- gas system and sights -----------------------------------------------
  add({ id: 'barrel', shape: 'tube', material: 'steel', radius: 0.0095, size: [0, 0, barrel], at: [0, bore, recvFront - barrel / 2], rot: [Math.PI / 2, 0, 0], radialSegments: 16 });
  add({ id: 'gas_block', shape: 'box', material: 'gunmetal', size: [0.03, 0.034, 0.038], at: [0, bore + 0.012, gasZ] });
  add({ id: 'gas_tube', shape: 'tube', material: 'steel', radius: 0.008, size: [0, 0, recvFront - gasZ], at: [0, bore + 0.036, (recvFront + gasZ) / 2], rot: [Math.PI / 2, 0, 0], radialSegments: 10 });
  // The rear sight block sits *below* the sight line: its top face is the notch's
  // floor, so the aim point passes over it and between the two leaf shoulders. (It
  // used to stand 3 mm proud of the line, i.e. the notch looked at its own block.)
  add({ id: 'rear_sight_block', shape: 'box', material: 'gunmetal', size: [0.03, 0.022, 0.03], at: [0, sightY - 0.016, recvFront + 0.02] });
  // The leaf, in two halves with the notch between them.
  for (const side of [-1, 1]) {
    add({ id: `rear_leaf_${side}`, shape: 'box', material: 'steel', size: [0.012, 0.008, 0.052], at: [side * 0.009, sightY, recvFront - 0.006] });
  }
  // The front sight *block* also has to clear the line: the post is what the shooter
  // aims with, the block it stands on is not.
  add({ id: 'front_sight_block', shape: 'box', material: 'gunmetal', size: [0.028, 0.02, 0.028], at: [0, sightY - 0.013, barrelEnd + 0.03] });
  add({ id: 'front_post', shape: 'box', material: 'steel', size: [0.005, 0.018, 0.005], at: [0, sightY, barrelEnd + 0.03] });
  add({ id: 'slant_brake', shape: 'tube', material: 'steel', radius: 0.014, size: [0.028, 0.028, brake], at: [0, bore, barrelEnd - brake / 2], rot: [Math.PI / 2, 0, 0], radialSegments: 14 });

  // ---- wooden furniture -----------------------------------------------------
  add({ id: 'handguard_lower', shape: 'box', material: 'wood', size: [width * 0.78, recvH * 0.9, guardLen], at: [0, -0.006, guardFront + guardLen / 2] });
  add({ id: 'handguard_upper', shape: 'box', material: 'wood', size: [width * 0.6, recvH * 0.62, guardLen * 0.78], at: [0, bore + 0.022, guardFront + guardLen * 0.42] });
  // Finger grooves and the two metal ferrules the wood is pinned with.
  for (let i = 0; i < 3; i++) {
    add({ id: `guard_groove_${i}`, shape: 'box', material: 'wood', size: [width * 0.8, 0.004, 0.012], at: [0, -recvH * 0.42, guardFront + 0.05 + i * 0.05] });
  }
  add({ id: 'guard_ferrule', shape: 'tube', material: 'steel', radius: 0.017, size: [0.034, 0.034, 0.016], at: [0, 0, recvFront - 0.008], rot: [Math.PI / 2, 0, 0], radialSegments: 12 });
  add({ id: 'buttstock', shape: 'box', material: 'wood', size: [width * 0.5, recvH * 0.94, 0.3 * s], at: [0, -0.006, recvRear + 0.3 * s * 0.5] });
  add({ id: 'stock_comb', shape: 'box', material: 'wood', size: [width * 0.44, 0.03, 0.3 * s * 0.7], at: [0, 0.026, recvRear + 0.3 * s * 0.42] });
  add({ id: 'butt_pad', shape: 'box', material: 'steel', size: [width * 0.54, recvH * 1.0, 0.014], at: [0, -0.008, buttZ - 0.008] });
  add({ id: 'sling_loop', shape: 'ring', material: 'steel', radius: 0.012, innerRadius: 0.008, size: [0.024, 0.024, 0.005], at: [-width * 0.36, -recvH * 0.5, recvRear + 0.03], rot: [0, Math.PI / 2, 0] });

  // ---- grip, trigger, rocking magazine -------------------------------------
  add({ id: 'grip', shape: 'box', material: 'wood', size: [0.034, 0.11, 0.05], at: [0, -recvH * 0.5 - 0.05, recvRear - recvLen * 0.62], rot: [-0.3, 0, 0] });
  add({ id: 'trigger_guard_bar', shape: 'box', material: 'steel', size: [0.028, 0.004, 0.05], at: [0, -recvH * 0.5 - 0.034, recvRear - recvLen * 0.5] });
  add({ id: 'trigger_guard_front', shape: 'box', material: 'steel', size: [0.008, 0.028, 0.008], at: [0, -recvH * 0.5 - 0.022, recvRear - recvLen * 0.4] });
  add({ id: 'trigger', shape: 'box', material: 'steel', size: [0.006, 0.024, 0.008], at: [0, -recvH * 0.5 - 0.014, recvRear - recvLen * 0.5], rot: [0.2, 0, 0] });
  const magTop = -recvH * 0.62;
  const magZ = recvRear - recvLen * 0.5;
  // Four segments, each rotated a little further forward: the AK's magazine rocks
  // into the well, and a straight box is a magazine for a different rifle.
  for (let i = 0; i < 4; i++) {
    add({
      id: `magazine_${i}`,
      shape: 'box',
      material: 'polymer',
      size: [0.052, 0.062, 0.032],
      at: [0, magTop - 0.028 - i * 0.052, magZ + i * 0.022],
      rot: [-0.16 - i * 0.09, 0, 0],
    });
  }
  add({ id: 'mag_floor', shape: 'box', material: 'steel', size: [0.054, 0.012, 0.034], at: [0, magTop - 0.21, magZ + 0.088], rot: [-0.4, 0, 0] });

  const magWell = new THREE.Vector3(0, magTop, magZ);
  const handguardLeft = new THREE.Vector3(0, -0.01, guardFront + guardLen * 0.5);
  const supportHip = magWell.clone().lerp(handguardLeft, POSE.hipForward);

  const anchors: WeaponAnchors = {
    bore,
    supportHip,
    muzzle: new THREE.Vector3(0, bore, tip),
    muzzleFlash: new THREE.Vector3(0, bore, tip - 0.02),
    eject: new THREE.Vector3(width * 0.5 + 0.014, recvH * 0.24, recvRear - recvLen * 0.4),
    optic: {
      axis: new THREE.Vector3(0, 0, -1),
      height: sightY,
      front: new THREE.Vector3(0, sightY, barrelEnd + 0.03),
      rear: new THREE.Vector3(0, sightY, recvFront - 0.006),
    },
    gripRight: new THREE.Vector3(0, -recvH * 0.5 - 0.05, recvRear - recvLen * 0.62),
    handguardLeft,
    butt: new THREE.Vector3(0, -0.008, buttZ),
    magWell,
  };

  return {
    id: def.id,
    archetype: 'ak',
    parts,
    anchors,
    receiverLength: recvLen,
    totalLength: buttZ - tip,
    // Iron sights, not a red dot: the leaf is 28 cm from the eye when the rifle is
    // shouldered.
    eyeRelief: 0.28,
    hip: { x: POSE.hipX, y: POSE.hipY },
  };
}

/**
 * Pistol: a slide, a frame, a raked grip and iron sights, 27 cm overall.
 *
 * Two things about a pistol are not a scaled-down rifle, and both matter. It has no
 * stock, so `butt` is the back of the slide and the weapon sits entirely in front of
 * the eye. And it has no handguard, so the support hand grips beside the firing hand
 * — which is what `handguardLeft` is, 5 cm forward of the firing hand on the frame's
 * dust cover, and why the two anchors are close together rather than a handguard
 * apart.
 */
function pistolLayout(def: WeaponDef): WeaponLayout {
  const [width, height, bodyLength] = def.viewModel.body;
  const bore = 0.021;
  // The sight line sits clear of the slide's top rib, so the player looks *over* the
  // slide and through the notch rather than at the rib's own top face — the rib top
  // is at bore + 0.022 and the line is 30 mm above the bore.
  const sightY = bore + 0.03;
  const buttZ = 0.012;
  // A pistol's slide is about two thirds of its overall length, so `body[2]` still
  // drives the build — the rest is the barrel that protrudes and the beavertail.
  const slideLen = Math.max(0.14, bodyLength * 0.63);
  const slideFront = buttZ - slideLen;
  const tip = slideFront - def.viewModel.barrelLength;
  const parts: WeaponPart[] = [];
  const add = (part: WeaponPart): void => {
    parts.push(part);
  };

  // ---- slide ----------------------------------------------------------------
  add({ id: 'slide', shape: 'box', material: 'gunmetal', size: [width * 0.72, height * 0.27, slideLen], at: [0, bore, slideFront + slideLen / 2] });
  add({ id: 'slide_top_rib', shape: 'box', material: 'gunmetal', size: [width * 0.42, 0.012, slideLen * 0.92], at: [0, bore + 0.022, slideFront + slideLen / 2] });
  // Cocking serrations, front and rear: the slide's only texture, and a slide without
  // them reads as a bar of metal. Serrations are cut *grooves*, so they are darker and
  // barely proud (0.3 mm) — the old bright steel slabs 0.8 mm proud turned the slide's
  // flanks into zebra striping.
  for (let i = 0; i < 7; i++) {
    add({ id: `serration_rear_${i}`, shape: 'box', material: 'gunmetal', size: [width * 0.73, height * 0.18, 0.005], at: [0, bore, -0.03 - i * 0.011] });
    add({ id: `serration_front_${i}`, shape: 'box', material: 'gunmetal', size: [width * 0.73, height * 0.18, 0.005], at: [0, bore, slideFront + 0.02 + i * 0.011] });
  }
  add({ id: 'ejection_port', shape: 'box', material: 'steel', size: [0.006, height * 0.16, slideLen * 0.3], at: [width * 0.36, bore + 0.008, slideFront + slideLen * 0.35] });
  add({ id: 'extractor', shape: 'box', material: 'steel', size: [0.005, 0.008, slideLen * 0.18], at: [width * 0.36, bore + 0.018, slideFront + slideLen * 0.42] });
  // ---- barrel, muzzle and the guide rod under it -----------------------------
  add({ id: 'barrel', shape: 'tube', material: 'steel', radius: 0.0125, size: [0.025, 0.025, def.viewModel.barrelLength], at: [0, bore, slideFront - def.viewModel.barrelLength / 2], rot: [Math.PI / 2, 0, 0], radialSegments: 16 });
  add({ id: 'barrel_crown', shape: 'tube', material: 'steel', radius: 0.0145, size: [0.029, 0.029, 0.012], at: [0, bore, tip + 0.006], rot: [Math.PI / 2, 0, 0], radialSegments: 16 });
  add({ id: 'guide_rod', shape: 'tube', material: 'steel', radius: 0.007, size: [0.014, 0.014, 0.05], at: [0, bore - 0.021, slideFront + 0.03], rot: [Math.PI / 2, 0, 0], radialSegments: 10 });
  // ---- frame ----------------------------------------------------------------
  add({ id: 'frame', shape: 'box', material: 'gunmetal', size: [width * 0.66, height * 0.19, 0.115], at: [0, bore - 0.016, slideFront + 0.062] });
  add({ id: 'frame_rail', shape: 'box', material: 'steel', size: [width * 0.8, 0.01, 0.1], at: [0, bore - 0.007, slideFront + 0.06] });
  add({ id: 'beavertail', shape: 'box', material: 'gunmetal', size: [width * 0.6, 0.02, 0.032], at: [0, bore - 0.018, buttZ + 0.004] });
  add({ id: 'hammer', shape: 'box', material: 'steel', size: [0.009, 0.022, 0.009], at: [0, bore + 0.008, buttZ + 0.012] });
  add({ id: 'safety', shape: 'box', material: 'steel', size: [0.008, 0.008, 0.016], at: [-width * 0.3, bore - 0.012, -0.028] });
  add({ id: 'slide_stop', shape: 'box', material: 'steel', size: [0.006, 0.009, 0.022], at: [-width * 0.34, bore - 0.002, -0.056] });
  add({ id: 'trigger_guard_bar', shape: 'box', material: 'steel', size: [0.03, 0.004, 0.044], at: [0, -0.012, -0.05] });
  add({ id: 'trigger_guard_front', shape: 'box', material: 'steel', size: [0.008, 0.03, 0.008], at: [0, 0.002, -0.072] });
  add({ id: 'trigger', shape: 'box', material: 'steel', size: [0.006, 0.022, 0.008], at: [0, 0.003, -0.05], rot: [0.2, 0, 0] });
  // ---- grip and magazine (inside it) ---------------------------------------
  add({ id: 'grip', shape: 'box', material: 'polymer', size: [0.046, 0.1, 0.052], at: [0, -0.056, -0.048], rot: [-0.18, 0, 0] });
  for (const side of [-1, 1]) {
    add({ id: `grip_panel_${side}`, shape: 'box', material: 'polymer', size: [0.006, 0.078, 0.044], at: [side * 0.024, -0.056, -0.046], rot: [-0.18, 0, 0] });
  }
  add({ id: 'magazine', shape: 'box', material: 'steel', size: [0.032, 0.088, 0.028], at: [0, -0.07, -0.052], rot: [-0.18, 0, 0] });
  add({ id: 'mag_floor', shape: 'box', material: 'polymer', size: [0.042, 0.01, 0.034], at: [0, -0.117, -0.06], rot: [-0.18, 0, 0] });
  // ---- sights ---------------------------------------------------------------
  // A pistol's rear sight is a *notch*, not a blade: two shoulders with a 5 mm gap
  // and a floor below the sight line. The shipped one was a single full-width box
  // across the aim point, which is a pistol you cannot aim with (you looked at the
  // back of your own sight to the exclusion of everything else).
  for (const side of [-1, 1]) {
    add({ id: `rear_sight_${side}`, shape: 'box', material: 'steel', size: [0.0075, 0.011, 0.009], at: [side * 0.0063, sightY, -0.012] });
  }
  add({ id: 'rear_sight_notch', shape: 'box', material: 'steel', size: [0.021, 0.004, 0.009], at: [0, sightY - 0.0075, -0.012] });
  add({ id: 'front_sight', shape: 'box', material: 'steel', size: [0.006, 0.013, 0.006], at: [0, sightY, slideFront + 0.012] });

  const magWell = new THREE.Vector3(0, -0.055, -0.05);
  // The support hand, on the frame ahead of the firing hand: the two-handed hold, and
  // the reason these two anchors are 5 cm apart rather than a handguard apart.
  const handguardLeft = new THREE.Vector3(0, -0.036, -0.1);
  const supportHip = magWell.clone().lerp(handguardLeft, POSE.hipForward);

  const anchors: WeaponAnchors = {
    bore,
    supportHip,
    muzzle: new THREE.Vector3(0, bore, tip),
    muzzleFlash: new THREE.Vector3(0, bore, tip - 0.015),
    eject: new THREE.Vector3(width * 0.36, bore + 0.014, slideFront + 0.06),
    optic: {
      axis: new THREE.Vector3(0, 0, -1),
      height: sightY,
      front: new THREE.Vector3(0, sightY, slideFront + 0.012),
      rear: new THREE.Vector3(0, sightY, -0.012),
    },
    gripRight: new THREE.Vector3(0, -0.052, -0.046),
    handguardLeft,
    butt: new THREE.Vector3(0, -0.006, buttZ),
    magWell,
  };

  return {
    id: def.id,
    archetype: 'pistol',
    parts,
    anchors,
    receiverLength: slideLen,
    totalLength: buttZ - tip,
    // Held at the end of the arm with iron sights: 30 cm from the eye to the notch.
    eyeRelief: 0.3,
    // The hip hold: inboard and *up*, because a pistol's low-ready is at chest height.
    // At 0.17 m right and 0.31 m down on a 75-degree camera the whole weapon was below
    // the bottom of the frame — the player saw a sliver of muzzle and nothing else,
    // which is what "the pistol is tiny and incomplete and has no hands" was.
    hip: { x: 0.12, y: -0.125, reach: 0.75 },
  };
}

// ---------------------------------------------------------------------------
// Pose
// ---------------------------------------------------------------------------

/**
 * Where the weapon's origin sits in camera space, for a given aim blend.
 *
 * Both ends are *solved* from the layout rather than read from content:
 *
 *  - ADS y so the sight line lands on the camera axis. Content's `ads[1]` is
 *    -0.178, which with the old geometry put the optic 10 cm below the crosshair:
 *    the player was aiming off the top of the receiver.
 *  - ADS z so the rear lens sits `eyeRelief` from the eye, and the muzzle ~0.74 m
 *    from the eye instead of 1.36 m.
 *  - Hip x/y from `POSE`, and hip z from the support arm's reach (`hipPose`).
 *
 * The blend is linear and both ends are reachable, so every pose in between is
 * reachable too: |lerp(A, B, t) - S| <= max(|A - S|, |B - S|) for a fixed S, which
 * is what `armReaches` relies on when it only has to check the two endpoints and
 * the midpoint.
 */
export function posePosition(
  def: WeaponDef,
  layout: WeaponLayout,
  adsT: number,
): { x: number; y: number; z: number } {
  const t = clamp01(adsT);
  const optic = layout.anchors.optic;
  const ads = { x: def.viewModel.ads[0], y: -optic.height, z: -(layout.eyeRelief + optic.rear.z) };
  const hip = hipPose(layout);
  const mix = (a: number, b: number): number => a + (b - a) * t;
  return { x: mix(hip.x, ads.x), y: mix(hip.y, ads.y), z: mix(hip.z, ads.z) };
}

/**
 * The hip hold, solved so the support hand lands `supportReach` along its arm.
 *
 * A carbine at the hip has its support hand ~10 cm ahead of the receiver, not out
 * at the muzzle, and a 1.8 m soldier is 0.57 m from shoulder to wrist. Those two
 * facts plus `hipX`/`hipY` fix the weapon's depth, so the depth is arithmetic here
 * instead of a magic number, and `layoutProblems` fails if it ever stops
 * reaching. The square root is clamped because an infeasible hold should degrade
 * to a straight arm, not to NaN in a matrix.
 */
function hipPose(layout: WeaponLayout): { x: number; y: number; z: number } {
  const hand = layout.anchors.supportHip;
  const [sx, sy, sz] = ARMS.shoulderLeft;
  const dx = layout.hip.x - sx;
  const dy = layout.hip.y + hand.y - sy;
  const reach = (layout.hip.reach ?? POSE.supportReach) * ARM_LENGTH;
  const dz = -Math.sqrt(Math.max(0.0004, reach * reach - dx * dx - dy * dy));
  return { x: layout.hip.x, y: layout.hip.y, z: dz + sz - hand.z };
}

/** The muzzle's distance from the eye for a pose, in metres. Used by tests. */
export function eyeToMuzzle(def: WeaponDef, layout: WeaponLayout, adsT: number): number {
  const pose = posePosition(def, layout, adsT);
  return Math.abs(pose.z + layout.anchors.muzzle.z);
}

// ---------------------------------------------------------------------------
// Arms
// ---------------------------------------------------------------------------

/**
 * Arm rig constants, in metres, in camera space.
 *
 * The shoulders are placed where a person's are relative to their own eye:
 * ~17 cm either side, 15 cm down, 5 cm back; a 1.8 m adult is 0.57 m from
 * shoulder to wrist. The point of putting them here rather than inside the mesh
 * builder is that "the hands hold the weapon and the arms reach the hands"
 * becomes arithmetic a test can check.
 */
export const ARMS = {
  shoulderRight: [0.17, -0.15, 0.05] as const,
  shoulderLeft: [-0.17, -0.15, 0.05] as const,
  upper: 0.3,
  fore: 0.27,
  /** Elbows fall out and down, so the arms frame the weapon. */
  poleRight: [1, -1.1, 0.4] as const,
  poleLeft: [-1, -1.1, 0.4] as const,
  /** Glove dimensions: palm plus finger segments. */
  palm: [0.052, 0.086, 0.03] as const,
  finger: [0.016, 0.042, 0.014] as const,
} as const;

/** Shoulder to wrist, in metres. The reach every hand target must sit inside. */
export const ARM_LENGTH = ARMS.upper + ARMS.fore;

/** Where the support hand grips, weapon-local, for a given aim blend. */
export function supportAnchor(
  layout: WeaponLayout,
  adsT: number,
  out: THREE.Vector3 = new THREE.Vector3(),
): THREE.Vector3 {
  return out.copy(layout.anchors.supportHip).lerp(layout.anchors.handguardLeft, clamp01(adsT));
}

/**
 * Two-bone IK: the elbow's position for a hand that must reach `target`.
 *
 * Standard closed form, with the reach clamped into [|a-b|, a+b] so a limb can
 * never be asked to be longer than it is — which is what stops the old rig's
 * detached look (arms that visibly did not reach the hands) from coming back.
 */
export function solveElbow(
  shoulder: THREE.Vector3,
  target: THREE.Vector3,
  upper: number,
  fore: number,
  pole: THREE.Vector3,
): THREE.Vector3 {
  const delta = target.clone().sub(shoulder);
  const reach = Math.max(Math.abs(upper - fore) + 0.005, Math.min(upper + fore - 0.005, delta.length()));
  const dir = delta.clone().normalize();
  const cosA = (upper * upper + reach * reach - fore * fore) / (2 * upper * reach);
  const a = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const axis = new THREE.Vector3().crossVectors(dir, pole);
  if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0);
  axis.normalize();
  const elbowDir = dir.clone().applyAxisAngle(axis, a);
  return shoulder.clone().addScaledVector(elbowDir, upper);
}

export interface RigProblem {
  id: string;
  detail: string;
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Where each hand is in camera space at rest (no sway, no kick, no bob), because
 * that is the pose the arm rig has to satisfy with no slack anywhere.
 */
export function handInCameraSpace(
  def: WeaponDef,
  layout: WeaponLayout,
  adsT: number,
): { right: THREE.Vector3; left: THREE.Vector3 } {
  const pose = posePosition(def, layout, adsT);
  const offset = new THREE.Vector3(pose.x, pose.y, pose.z);
  const right = layout.anchors.gripRight.clone().add(offset);
  const left = supportAnchor(layout, adsT).add(offset);
  return { right, left };
}

export interface ArmReach {
  side: 'right' | 'left';
  adsT: number;
  /** Shoulder to hand, metres. */
  distance: number;
  /** Fraction of the arm's length that represents: 1 = locked straight. */
  extension: number;
}

/**
 * How far each hand is from its own shoulder, at a given aim blend.
 *
 * This is the check the review's first complaint reduces to: the old model's
 * support hand was 0.77 m from its shoulder with a 0.55 m arm, so the arm simply
 * stopped short and the weapon floated. Anything at or over `ARM_LENGTH` is a
 * gap, and anything under the bone-length difference is a fold that cannot exist.
 */
export function armReaches(def: WeaponDef, layout: WeaponLayout, adsT: number): ArmReach[] {
  const hands = handInCameraSpace(def, layout, adsT);
  const right = new THREE.Vector3(...ARMS.shoulderRight);
  const left = new THREE.Vector3(...ARMS.shoulderLeft);
  const build = (side: 'right' | 'left', shoulder: THREE.Vector3, hand: THREE.Vector3): ArmReach => {
    const distance = shoulder.distanceTo(hand);
    return { side, adsT, distance, extension: distance / ARM_LENGTH };
  };
  return [build('right', right, hands.right), build('left', left, hands.left)];
}

/**
 * The invariants, stated once, so the rig can be *proved* rather than eyeballed.
 *
 * Every entry here is a defect the review found in the old model: a receiver
 * three times its real length, a sight line below the crosshair, a muzzle over a
 * metre from the eye, fingers on the weapon's centre line.
 */
export function layoutProblems(def: WeaponDef, layout: WeaponLayout): RigProblem[] {
  const problems: RigProblem[] = [];
  const push = (id: string, detail: string): void => {
    problems.push({ id, detail });
  };
  const width = def.viewModel.body[0];

  // Ranges per archetype, because "the weapon is the wrong size" means a different
  // number for a pistol than for a rifle — and asserting a rifle's 80-90 cm against a
  // pistol is how the first version of this check would have rejected every handgun.
  const pistol = layout.archetype === 'pistol';
  const [minLength, maxLength, minMuzzle, maxMuzzle] = pistol
    ? [0.19, 0.36, 0.32, 0.62]
    : [0.5, 0.98, 0.5, 0.85];

  if (layout.receiverLength > MM.receiver * 1.35) {
    push('receiver_too_long', `receiver is ${(layout.receiverLength * 100).toFixed(1)} cm; a carbine's is 21 cm`);
  }
  if (layout.totalLength > maxLength) {
    push(
      'weapon_too_long',
      `${(layout.totalLength * 100).toFixed(1)} cm overall; the limit for a ${layout.archetype} is ${(maxLength * 100).toFixed(0)} cm`,
    );
  }
  if (layout.totalLength < minLength) {
    push(
      'weapon_too_short',
      `${(layout.totalLength * 100).toFixed(1)} cm overall; the floor for a ${layout.archetype} is ${(minLength * 100).toFixed(0)} cm`,
    );
  }
  if (eyeToMuzzle(def, layout, 1) > maxMuzzle) {
    push('ads_muzzle_far', `muzzle ${eyeToMuzzle(def, layout, 1).toFixed(2)} m from the eye at ADS`);
  }
  if (eyeToMuzzle(def, layout, 1) < minMuzzle) {
    push('ads_muzzle_near', `muzzle ${eyeToMuzzle(def, layout, 1).toFixed(2)} m from the eye at ADS`);
  }
  const ads = posePosition(def, layout, 1);
  if (Math.abs(ads.y + layout.anchors.optic.height) > 0.002) {
    push(
      'sight_line_off_axis',
      `the sight line is ${(ads.y + layout.anchors.optic.height).toFixed(3)} m off the camera axis at ADS`,
    );
  }
  // The holds: if a hand cannot be reached the arm stops short of it, and the
  // weapon reads as pasted on the screen rather than carried.
  for (const adsT of [0, 0.5, 1]) {
    for (const arm of armReaches(def, layout, adsT)) {
      if (arm.distance > ARM_LENGTH - 0.005) {
        push(
          `arm_short_${arm.side}_${adsT}`,
          `the ${arm.side} hand is ${arm.distance.toFixed(3)} m from its shoulder with a ${ARM_LENGTH.toFixed(2)} m arm (${(arm.extension * 100).toFixed(0)}%)`,
        );
      }
      if (arm.distance < Math.abs(ARMS.upper - ARMS.fore) + 0.02) {
        push(
          `arm_folded_${arm.side}_${adsT}`,
          `the ${arm.side} hand is ${arm.distance.toFixed(3)} m from its shoulder: closer than the bones allow`,
        );
      }
    }
  }
  const muzzleAheadOfButt = layout.anchors.muzzle.z < layout.anchors.butt.z;
  if (!muzzleAheadOfButt) push('orientation', 'the muzzle is not ahead of the butt');
  // The trigger hand is behind the support hand — on a carbine by ~15 cm, on a pistol
  // by the width of a fist. (This comparison is the one the rig test caught: written
  // the other way round it fires on every weapon that is held correctly.)
  if (layout.anchors.gripRight.z < layout.anchors.handguardLeft.z + (pistol ? 0.04 : 0.05)) {
    push(
      'trigger_hand_ahead_of_support',
      `the trigger hand is ${(layout.anchors.handguardLeft.z - layout.anchors.gripRight.z).toFixed(3)} m ahead of the support hand`,
    );
  }
  for (const part of layout.parts) {
    if (part.size[0] > width * 1.6) push(`part_wide_${part.id}`, `${part.size[0].toFixed(3)} m wide`);
    if (part.size[2] > 0.4) push(`part_long_${part.id}`, `${part.size[2].toFixed(3)} m long`);
  }
  return problems;
}
