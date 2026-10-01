/**
 * A hand, built from anatomy, once, for everybody who has one.
 *
 * The review's wording was "our own hand and arm are still not realistic, their shapes
 * are not real" — and measuring the shape rather than arguing about it says exactly why.
 * The old first-person hand was one `roundedBox` for the palm, **four identical boxes**
 * for the fingers (two per finger, same length, same thickness, no taper) and **one**
 * box for the thumb; the enemy's was a single 9 x 10 x 13 cm box with no fingers at
 * all. A gradient-orientation histogram of the isolated view model (`.captures/mask.py`)
 * put it at `axis = 0.44` with `fill = 0.67` inside its own bounding box — a plate with
 * perpendicular edges, i.e. a mitten.
 *
 * None of that is fixable by adding detail. A hand reads as a hand because of four
 * things, and all four are arithmetic:
 *
 *  1. **The palm is a wedge with a lump on it.** Widest across the knuckles, narrowing
 *     to the wrist, and carrying a *thenar mass* at the base of the thumb — the most
 *     recognisable lump on the back of a hand.
 *  2. **The fingers are three-phalanx chains, longest in the middle.** Real adult
 *     proportions run middle > ring > index > little, and each phalanx is ~9% narrower
 *     than the one before. Four equal boxes are four equals, which is the one thing a
 *     hand's fingers never are.
 *  3. **The fingers wrap what they hold and close on it.** MCP flexion carries the
 *     proximal phalanx across the bar, the PIP turns the middle phalanx back along the
 *     palm, the DIP presses the tip in. Parallel slabs beside the grip are not a grip.
 *  4. **The thumb opposes.** It leaves the wrist on the thumb side, out of the palm's
 *     plane, and its tip comes to rest on the far side of the bar from the fingertips.
 *
 * The one thing this module does *not* do is guess the two numbers the old hand guessed:
 * **where the bar sits inside the fist** and **how far the hand closes on it**. Both are
 * solved. A bar held in a fist is tangent to two phalanges at once, so its axis is where
 * those two lines meet once each is offset inward by the bar's radius; and how far each
 * finger closes is whatever puts *that* fingertip on the bar's surface — which is why a
 * hand on a 17 mm pistol grip curls tighter than a hand under a 24 mm handguard, and why
 * the little finger closes further than the middle, exactly as a real one does.
 *
 * So: one table of real proportions, one forward-kinematic chain, and `handShape()` —
 * pure arithmetic, no three, no GPU — which `tests/unit/hand.test.ts` checks and
 * `buildHand()` only renders.
 *
 * One module for the player's hands and the enemies', because two hands built in two
 * files are two hands that drift, and this project's bug list is full of pairs that
 * disagreed.
 */
import * as THREE from 'three';
import { lathe, roundedBox, uvMetres, withAoUv } from '../geometry';

// ---------------------------------------------------------------------------
// Real proportions, in metres
// ---------------------------------------------------------------------------

/**
 * The anatomy, from adult male anthropometry, in metres.
 *
 * Phalanx lengths are the averages that put the finger totals at middle 90 mm, ring 83,
 * index 81, little 68 — the textbook order and spread. `pad` is the glove: a gloved hand
 * is about 4 mm fatter in every dimension than the hand inside it, and the builder adds
 * that rather than the table hiding it.
 */
export const HAND = {
  /** Wrist crease to the middle knuckle. */
  palmLength: 0.099,
  /**
   * The palm across the knuckle heads.
   *
   * 76 mm, not the 89 mm an anthropometry table calls "hand breadth": that figure is
   * measured across the *metacarpals including the thenar mass*, so putting 89 mm on a
   * `palm` slab double-counts the thumb and a hand comes out 116 mm wide. The thenar is a
   * separate part, and `breadth` adds it back.
   */
  palmBreadth: 0.076,
  /** Across the wrist, where a palm really does narrow. */
  wristBreadth: 0.058,
  /** Front to back, at the knuckles and at the wrist. */
  palmDepth: 0.026,
  wristDepth: 0.022,
  /** Thenar mass: length along the palm, breadth across it, how far it stands proud. */
  thenar: [0.046, 0.03, 0.01] as const,

  /** Phalanx lengths [proximal, middle, distal], base breadth, offset from the palm's centre. */
  fingers: [
    { id: 'index', segs: [0.038, 0.024, 0.019], base: 0.0185, at: 0.0285 },
    { id: 'middle', segs: [0.042, 0.027, 0.021], base: 0.019, at: 0.0095 },
    { id: 'ring', segs: [0.039, 0.025, 0.019], base: 0.0175, at: -0.0095 },
    { id: 'little', segs: [0.031, 0.02, 0.017], base: 0.015, at: -0.0285 },
  ] as const,

  /** A finger tapers to this share of its base breadth by the distal phalanx. */
  taper: 0.76,

  /** Segmental thickness [proximal, middle, distal]. */
  thickness: [0.018, 0.0145, 0.0115] as const,

  /** Thumb: metacarpal, proximal, distal, and the breadth and thickness of all three. */
  thumb: [0.042, 0.03, 0.023] as const,
  thumbBreadth: 0.019,
  thumbThickness: [0.02, 0.017, 0.014] as const,

  /**
   * Flexion at each joint of a closed grip, radians, as *ratios* of the closing amount:
   * MCP ~77 degrees, PIP ~86, DIP ~52. Anatomical joint flexion, so it is a fact about
   * hands rather than a number that happened to look right.
   *
   * Ratios, not absolute angles, because how far a hand closes is *solved* per finger —
   * see `handShape`.
   */
  flexion: { mcp: 1.35, pip: 1.5, dip: 0.9 } as const,

  /**
   * Thumb joint ratios. `spread` opens the metacarpal away from the index finger,
   * `flex` bends it at the first joint and `tip` at the last.
   */
  thumbJoint: { spread: 0.62, flex: 1.05, tip: 0.8 } as const,

  /** Glove padding: added to every dimension of a gloved hand. */
  pad: 0.004,

  /** How tightly a hand may close, and how far open it may stay. */
  closeRange: [0.35, 1.5] as const,
} as const;

type Vec3 = [number, number, number];

export interface HandSpec {
  side: 'right' | 'left';
  /** The thing being held: its radius, in metres. */
  gripRadius: number;
  /** Flexion released on the index finger, for a hand on a trigger. */
  trigger?: number;
  /** Flexion released across the whole hand, for an open palm. */
  slack?: number;
  /** Glove padding; defaults to `HAND.pad`, 0 gives a bare hand. */
  pad?: number;
}

export interface Segment {
  /** Centre of the phalanx, in the hand's own space. */
  at: Vec3;
  /** Unit direction along the phalanx, in the hand's (y, z) plane. */
  dir: Vec3;
  length: number;
  /** Across the digit, along the grip's axis. */
  width: number;
  /** Through the digit, toward and away from the palm. */
  thickness: number;
}

export interface Finger {
  id: string;
  /** Lateral offset from the palm's centre, thumb side positive. */
  at: number;
  segments: Segment[];
  /** The fingertip, in the hand's own space. */
  tip: Vec3;
  /** Total phalanx length. */
  length: number;
  /** Distance from the fingertip to the grip's axis. */
  tipReach: number;
  /** How far this finger closed, as a multiple of the anatomical grip flexion. */
  close: number;
}

export interface HandShape {
  side: 'right' | 'left';
  /** The grip's axis, in the hand's own space. Always (0, y, z) after the shift. */
  grip: { y: number; z: number; radius: number };
  /** Where the solve put the axis, before the shift — the number the fingers were fitted to. */
  axisRaw: { y: number; z: number };
  palm: { at: Vec3; size: Vec3 };
  wrist: { at: Vec3; size: Vec3 };
  thenar: { at: Vec3; size: Vec3 };
  /** Knuckle bumps: one per finger, where the MCP heads are. */
  knuckles: Vec3[];
  fingers: Finger[];
  thumb: { segments: Segment[]; tip: Vec3; tipReach: number; close: number };
  /** Wrist crease to the middle fingertip, gloved. */
  span: number;
  /** Across the knuckle heads, including the glove. */
  breadth: number;
  pad: number;
  /** How far the hand closed as a whole: the middle finger's amount. */
  close: number;
  /** Whatever the solve could not satisfy, if anything. */
  problems: string[];
}

/** A direction in the hand's (y, z) plane. Angle 0 is +y, and flexion *adds*. */
function unit(angle: number): [number, number] {
  return [-Math.sin(angle), -Math.cos(angle)];
}

/** Straight down the palm, so flexion turns the finger toward `-z`. */
const FORWARD = -Math.PI / 2;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

interface Chain {
  /** Four points: the knuckle and the three joints, in the (y, z) plane. */
  points: [number, number][];
  /** Three directions, one per phalanx. */
  dirs: [number, number][];
}

/**
 * Forward kinematics of a phalanx chain: a start angle, then `joints[i]` flexes the
 * joint *before* phalanx `i`.
 *
 * The order is the whole point. The first version of this added `flex[i]` *after*
 * phalanx `i`, which meant the MCP flexion was being applied to the PIP joint and every
 * finger started out perfectly straight — a fist that gripped nothing, with the grip's
 * fitted axis landing 12 cm in front of the knuckles because the chain it was fitted to
 * had no curve in it. `joints[0]` is the MCP (between the metacarpal and the proximal
 * phalanx), `joints[1]` the PIP, `joints[2]` the DIP.
 */
function chain(
  base: [number, number],
  start: number,
  lengths: readonly number[],
  joints: readonly number[],
): Chain {
  const points: [number, number][] = [base];
  const dirs: [number, number][] = [];
  let [y, z] = base;
  let angle = start;
  for (let i = 0; i < lengths.length; i++) {
    angle += joints[i] ?? 0;
    const [dy, dz] = unit(angle);
    dirs.push([dy, dz]);
    y += dy * lengths[i]!;
    z += dz * lengths[i]!;
    points.push([y, z]);
  }
  return { points, dirs };
}

/**
 * Where two inward-offset phalanx axes cross: the bar both are tangent to.
 *
 * A fist around a bar has two phalanges touching it at once, so the bar's centre is the
 * intersection of those two phalanx lines pushed inward by the bar's radius plus half a
 * finger. Solving it means the grip is inside the hand by construction, at any radius
 * and any flexion, instead of at the one radius somebody tuned by eye.
 */
function fitAxis(path: Chain, offset: number): { y: number; z: number } | null {
  const p = path.points[0]!;
  const q = path.points[1]!;
  const a = path.dirs[0]!;
  const b = path.dirs[1]!;
  // Inward normals: a phalanx direction turned a quarter turn toward the palm.
  const pa: [number, number] = [p[0] + a[1] * offset, p[1] - a[0] * offset];
  const qb: [number, number] = [q[0] + b[1] * offset, q[1] - b[0] * offset];
  const det = a[0] * -b[1] + b[0] * a[1];
  if (Math.abs(det) < 1e-9) return null;
  const t = ((qb[0] - pa[0]) * -b[1] + (qb[1] - pa[1]) * b[0]) / det;
  return { y: pa[0] + a[0] * t, z: pa[1] + a[1] * t };
}

/**
 * Mount a built hand onto the thing it holds.
 *
 * A hand's own space is defined by what it is gripping, so a caller has to say three
 * directions: which way the bar runs, which way the knuckles point, and which way the
 * palm faces. Given those, this is the whole of the placement — and `mountProblems`
 * checks them, because getting the third one backwards is a hand mounted inside-out and
 * nothing else in the build would notice.
 */
export function mountHand(group: THREE.Object3D, mount: HandMount): void {
  const axis = new THREE.Vector3(...mount.axis).normalize();
  const forward = new THREE.Vector3(...mount.forward).normalize();
  const palm = new THREE.Vector3(...mount.palmNormal).normalize();
  // Re-orthogonalise: a caller reads these off a weapon, and a grip that is 3 degrees off
  // square would otherwise shear the fingers instead of turning them.
  const x = axis.clone();
  const z = palm.clone().sub(x.clone().multiplyScalar(palm.dot(x))).normalize();
  // `forward` is the caller's, not recomputed from the other two: the three are
  // over-determined and the caller's is the one that says which way the knuckles point.
  // `mountProblems` is what catches a set that cannot be a hand of this side.
  const y = forward.clone().sub(x.clone().multiplyScalar(forward.dot(x))).sub(z.clone().multiplyScalar(forward.dot(z))).normalize();
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  if (mount.roll) group.rotateOnAxis(new THREE.Vector3(0, 1, 0), mount.roll);
  group.position.set(...mount.at);
}

export interface HandMount {
  /** Where the grip's axis crosses the hand, in the parent's space. */
  at: Vec3;
  /** Unit vector along the grip's axis, thumb side positive. */
  axis: Vec3;
  /** Unit vector the knuckles point along. */
  forward: Vec3;
  /**
   * The direction the **palm faces**, which on a grip is *into* the grip.
   *
   * Not the direction of the palm's mass, and the distinction is not pedantry: a palm
   * faces the bar it is holding and its mass sits on the far side of the bar from the
   * fingers, so "toward the palm's centre" and "the way the palm faces" are opposite
   * vectors. Naming it `palm` invited exactly that mistake, and the first mount built with
   * the palm's centre as the vector came out as a degenerate basis — the two directions
   * nearly parallel, the hand smeared down the grip's axis.
   */
  palmNormal: Vec3;
  /** A turn about the grip's axis, applied after the rest, radians. */
  roll?: number;
}

/**
 * Whether a mount is one a hand of this side can actually take.
 *
 * Measured on the built shape: both hands have the *same* `y` and `z` throughout — a left
 * hand is a right hand mirrored in `x`, and nothing else — so a mount's consistency rule
 * is not side-dependent. `forward` must agree with `palmNormal x axis`, and a mount where
 * it does not is a hand with its knuckles turned the wrong way up the grip.
 */
export function mountProblems(mount: Omit<HandMount, 'at' | 'roll'>): HandProblem[] {
  const a = new THREE.Vector3(...mount.axis).normalize();
  const f = new THREE.Vector3(...mount.forward).normalize();
  const p = new THREE.Vector3(...mount.palmNormal).normalize();
  const out: HandProblem[] = [];
  const det = new THREE.Matrix4().makeBasis(a, f, p).determinant();
  if (!Number.isFinite(det) || Math.abs(det) < 0.2) {
    out.push({ id: 'mountDegenerate', detail: `mount basis is degenerate (det ${det.toFixed(3)})` });
    return out;
  }
  // The antecedent: with `axis` along the bar and `palm` facing out of it, a *right* hand
  // can only point its knuckles one way — `palm x axis`. If the caller's `forward` says
  // the other way, the mount is a mirror and every finger, knuckle and thumb will be on
  // the wrong side of the grip while the hand's own shape stays perfectly correct.
  const x = a.clone();
  const z = p.clone().sub(x.clone().multiplyScalar(p.dot(x))).normalize();
  const implied = new THREE.Vector3().crossVectors(z, x).normalize();
  if (implied.dot(f) <= 0) {
    out.push({
      id: 'mountBackwards',
      detail: 'knuckles point the wrong way: forward disagrees with palmNormal x axis',
    });
  }
  return out;
}

/**
 * A two-bone IK in the hand's (y, z) plane: the joint that puts two segments' ends at
 * `target`, and how far short it fell if it could not reach.
 *
 * The same closed form `solveElbow` uses for a shoulder and a wrist, and for the same
 * reason: a limb can never be asked to be longer than it is, and a joint that silently
 * stops reaching is a joint that rattles. `clamped` is the number of metres it came up
 * short, so a caller can say so out loud instead of rendering a gap.
 *
 * `bulgeAwayFrom` picks between the two solutions (a two-bone chain has two): the elbow
 * of a gripping thumb points away from what it is gripping, so the axis is the tiebreak.
 */
function solveTwoBone(
  from: [number, number],
  target: [number, number],
  l1: number,
  l2: number,
  bulgeAwayFrom?: [number, number],
): {
  joint: [number, number];
  tip: [number, number];
  dir1: [number, number];
  dir2: [number, number];
  clamped: number;
} {
  const dx = target[0] - from[0];
  const dz = target[1] - from[1];
  const dist = Math.hypot(dx, dz);
  const reach = clamp(dist, Math.abs(l1 - l2) + 1e-6, l1 + l2 - 1e-6);
  const clamped = Math.max(0, dist - (l1 + l2 - 1e-6));
  const ux = dist > 1e-9 ? dx / dist : 1;
  const uz = dist > 1e-9 ? dz / dist : 0;
  const tip: [number, number] = [from[0] + ux * reach, from[1] + uz * reach];
  const cosA = clamp((l1 * l1 + reach * reach - l2 * l2) / (2 * l1 * Math.max(1e-6, reach)), -1, 1);
  const a = Math.acos(cosA);
  const candidates: [number, number][] = [];
  for (const sign of [1, -1]) {
    const ca = Math.cos(sign * a);
    const sa = Math.sin(sign * a);
    candidates.push([from[0] + (ux * ca - uz * sa) * l1, from[1] + (ux * sa + uz * ca) * l1]);
  }
  const pick = bulgeAwayFrom
    ? candidates.reduce((best, c) =>
        Math.hypot(c[0] - bulgeAwayFrom[0], c[1] - bulgeAwayFrom[1]) >
        Math.hypot(best[0] - bulgeAwayFrom[0], best[1] - bulgeAwayFrom[1])
          ? c
          : best,
      )
    : candidates[0]!;
  const n1 = Math.hypot(pick[0] - from[0], pick[1] - from[1]) || 1;
  const n2 = Math.hypot(tip[0] - pick[0], tip[1] - pick[1]) || 1;
  return {
    joint: pick,
    tip,
    dir1: [(pick[0] - from[0]) / n1, (pick[1] - from[1]) / n1],
    dir2: [(tip[0] - pick[0]) / n2, (tip[1] - pick[1]) / n2],
    clamped,
  };
}

/**
 * The hand as points and lengths, in its own space.
 *
 * Space: the origin is on the **grip's axis**, `+x` runs along that axis with the thumb
 * side positive (so the fingers are stacked along it), `+y` points out through the
 * knuckles — the direction the fingers wrap — and `+z` points **toward the palm**, out of
 * the bar through the back of the hand. Everything the builder draws and everything a
 * test checks is in this frame, which is why the shape can be verified with no renderer
 * and the same object can hang off a camera or an arm.
 */
export function handShape(spec: HandSpec): HandShape {
  const pad = spec.pad ?? HAND.pad;
  const trigger = spec.trigger ?? 0;
  const slack = spec.slack ?? 0;
  const mirror = spec.side === 'left' ? -1 : 1;
  // Spelled as `number` because the table is `as const`: without it the literal types
  // (0.35 and 1.5) propagate into the binary search and the midpoint stops being
  // assignable — a type error about a number that was never a constant.
  const closeLo: number = HAND.closeRange[0];
  const closeHi: number = HAND.closeRange[1];
  const problems: string[] = [];

  const palmDepth = HAND.palmDepth + pad * 2;
  const palmLength = HAND.palmLength + pad;
  const gripRadius = Math.max(0.003, spec.gripRadius);
  const reference = HAND.fingers[1]!;
  const halfFinger = (HAND.thickness[0]! + HAND.thickness[1]!) / 2 + pad * 2;
  const inner = gripRadius + halfFinger;

  const knuckleY = palmLength;
  const knuckleZ = -palmDepth / 2;

  // `trigger` *releases* the index finger. Adding it instead was the first version, and
  // it curled the finger harder — a hand that grips tighter on a trigger than on a grip,
  // which is backwards. The sign is the whole meaning of the word.
  const flexOf = (close: number, id: string): number[] => [
    HAND.flexion.mcp * close - (id === 'index' ? trigger : 0),
    HAND.flexion.pip * close,
    HAND.flexion.dip * close,
  ];
  const pathOf = (id: string, close: number, base = knuckleY): Chain =>
    chain([base, knuckleZ], FORWARD, HAND.fingers.find((f) => f.id === id)!.segs, flexOf(close, id));

  // ---- solve the bar's axis, and the closing amount, together ------------------
  // The two depend on each other: the axis is the tangent intersection, and the closing
  // amount is what puts the fingertip on the axis's surface. Fixed point; four passes is
  // an order of magnitude more than it needs.
  let close = clamp(1 - slack, closeLo, closeHi);
  let axis = { y: knuckleY - 0.04, z: knuckleZ - 0.02 };
  for (let pass = 0; pass < 6; pass++) {
    const fitted = fitAxis(pathOf('middle', close), inner);
    if (fitted) axis = fitted;
    // Tighter close brings the tip nearer the axis. Search the amount that lands it
    // exactly on the surface.
    let lo = closeLo;
    let hi = closeHi;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const tip = pathOf('middle', mid).points[3]!;
      if (Math.hypot(tip[0] - axis.y, tip[1] - axis.z) > gripRadius + HAND.thickness[2]! / 2 + pad) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    close = (lo + hi) / 2;
  }

  // ---- fingers ---------------------------------------------------------------
  const fingers: Finger[] = HAND.fingers.map((finger) => {
    // Every finger closes as far as the bar lets *it* close, and they are four different
    // amounts: a 68 mm little finger reaches the bar's surface with less wrap than a
    // 90 mm middle finger, so it closes *less* (0.87 against 0.94 on a 19 mm grip). The
    // spread is the point — one flexion shared by four fingers is what makes a hand read
    // as a comb — and the direction is the opposite of the one guessed here first.
    // The one exception is a finger that has *left* the grip for a trigger: with
    // `trigger` set the index keeps the middle finger's closing amount and is released
    // from it, so it stays where a trigger puts it instead of being solved back onto a
    // bar it is no longer touching.
    let fingerClose = close;
    if (finger.id !== 'index' || trigger === 0) {
      let lo = closeLo;
      let hi = closeHi;
      const target = gripRadius + HAND.thickness[2]! / 2 + pad;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        const tip = pathOf(finger.id, mid).points[3]!;
        if (Math.hypot(tip[0] - axis.y, tip[1] - axis.z) > target) lo = mid;
        else hi = mid;
      }
      fingerClose = (lo + hi) / 2;
    }
    const path = pathOf(finger.id, fingerClose);
    const width0 = finger.base + pad * 2;
    const segments: Segment[] = finger.segs.map((length, i) => {
      const a = path.points[i]!;
      const b = path.points[i + 1]!;
      const w = width0 * (1 - (1 - HAND.taper) * (i / finger.segs.length));
      return {
        at: [mirror * finger.at, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        dir: [0, path.dirs[i]![0], path.dirs[i]![1]],
        length,
        width: w,
        thickness: HAND.thickness[Math.min(i, HAND.thickness.length - 1)]! + pad * 2,
      };
    });
    const tip = path.points[3]!;
    return {
      id: finger.id,
      at: mirror * finger.at,
      segments,
      tip: [mirror * finger.at, tip[0], tip[1]],
      length: finger.segs.reduce((s, v) => s + v, 0),
      tipReach: Math.hypot(tip[0] - axis.y, tip[1] - axis.z),
      close: fingerClose,
    };
  });

  // ---- thumb -----------------------------------------------------------------
  // Its own chain from the thenar, out of the palm's plane, closing on the same bar. Its
  // base is on the far side of the axis from the fingers', so opposition falls out of the
  // geometry instead of being asserted.
  const thumbBaseY = palmLength * 0.2;
  const thumbBaseZ = knuckleZ - HAND.thenar[2] - pad;
  const thumbTarget = gripRadius + HAND.thumbThickness[2]! / 2 + pad;
  // The metacarpal keeps its own anatomical direction and the two phalanges are **solved**
  // onto the bar, not curled by hand: a two-bone IK from the metacarpal's far end to the
  // point on the bar's surface diametrically opposite the middle of the fingertips.
  //
  // Hand-tuning this chain was the wrong tool and it showed: with the flexion ratios set
  // by eye, the first version's thumb tip finished 64 mm off a 17 mm grip and the second
  // flipped its sign and finished 69 mm off the other way, because a three-segment chain
  // whose two joints both bend has an S-shape in it that no single scale factor unwinds.
  // The IK has no such freedom — it either reaches or it does not, and it says so.
  const dirOf = (a: number): [number, number] => unit(a);
  const thumbBase: [number, number] = [thumbBaseY, thumbBaseZ];
  const metacarpalDir = dirOf(FORWARD - HAND.thumbJoint.spread);
  const thumbMcp: [number, number] = [
    thumbBase[0] + metacarpalDir[0] * HAND.thumb[0]!,
    thumbBase[1] + metacarpalDir[1] * HAND.thumb[0]!,
  ];
  // Where the bar's surface sits, on the far side of the axis from the fingertips.
  const fingerAngle =
    fingers.reduce((s, f) => s + Math.atan2(f.tip[2] - axis.z, f.tip[1] - axis.y), 0) / fingers.length;
  const target: [number, number] = [
    axis.y + Math.cos(fingerAngle + Math.PI) * thumbTarget,
    axis.z + Math.sin(fingerAngle + Math.PI) * thumbTarget,
  ];
  const ik = solveTwoBone(thumbMcp, target, HAND.thumb[1]!, HAND.thumb[2]!, [axis.y, axis.z]);
  if (ik.clamped > 0.0005) {
    problems.push(`thumb falls ${(ik.clamped * 1000).toFixed(1)} mm short of the grip`);
  }
  const thumbPoints: [number, number][] = [thumbBase, thumbMcp, ik.joint, ik.tip];
  const thumbDirs: [number, number][] = [metacarpalDir, ik.dir1, ik.dir2];
  const thumbTip = ik.tip;
  const thumbTipReach = Math.hypot(thumbTip[0] - axis.y, thumbTip[1] - axis.z);
  const thumbX = HAND.palmBreadth / 2 - 0.011;
  const thumbSegments: Segment[] = HAND.thumb.map((length, i) => {
    const a = thumbPoints[i]!;
    const b = thumbPoints[i + 1]!;
    // The chain crosses toward the palm's centre line as it goes, which is what puts the
    // thumb over the bar rather than alongside the index finger.
    const x = thumbX - (thumbX - HAND.thumbBreadth * 0.5) * (i / 2);
    return {
      at: [mirror * x, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      dir: [0, thumbDirs[i]![0], thumbDirs[i]![1]],
      length,
      width: HAND.thumbBreadth * (1 - 0.16 * i) + pad * 2,
      thickness: HAND.thumbThickness[Math.min(i, HAND.thumbThickness.length - 1)]! + pad * 2,
    };
  });
  if (thumbTipReach < gripRadius) {
    problems.push(`thumb tip is ${((gripRadius - thumbTipReach) * 1000).toFixed(1)} mm inside the grip`);
  }

  // ---- shift to the grip's axis, and flip the plane ---------------------------
  // A caller anchors a hand to the thing it holds, so the origin is the bar's centre.
  //
  // The z flip is the handedness fix, and it is not cosmetic. The chain is built with the
  // fingers wrapping toward `-z` and the palm's mass ending up at `+z`, which makes `+z`
  // the **back** of the hand — and `(thumb-side, knuckles, back-of-hand)` is a *left*-handed
  // triple for a right hand. Any caller would then have to mount a right hand with a
  // mirroring matrix, and a mirroring matrix turns a right hand into a left one. So the
  // space is defined with `+z` on the **palm** side instead: `(thumb-side, knuckles,
  // toward-palm)` is right-handed for a right hand and left-handed for a left hand — which
  // is exactly what mirroring a hand means, and is why `mountProblems` can check it.
  const move = (p: Vec3): Vec3 => [p[0], p[1] - axis.y, -(p[2] - axis.z)];
  const moveSeg = (s: Segment): Segment => ({ ...s, at: move(s.at), dir: [0, s.dir[1], -s.dir[2]] });

  return {
    side: spec.side,
    grip: { y: 0, z: 0, radius: gripRadius },
    axisRaw: { y: axis.y, z: axis.z },
    palm: {
      at: move([0, knuckleY - palmLength / 2, knuckleZ + palmDepth / 2]),
      size: [HAND.palmBreadth + pad * 2, palmLength, palmDepth],
    },
    wrist: {
      at: move([0, -pad * 0.5, knuckleZ + palmDepth / 2]),
      size: [HAND.wristBreadth + pad * 2, palmDepth * 0.9, HAND.wristDepth + pad * 2],
    },
    thenar: {
      at: move([
        mirror * (HAND.palmBreadth / 2 - HAND.thenar[1] * 0.35),
        thumbBaseY,
        thumbBaseZ + HAND.thenar[2] * 0.3,
      ]),
      size: [HAND.thenar[1], HAND.thenar[0], HAND.thenar[2] + pad * 2],
    },
    knuckles: fingers.map((f) => move([f.at, knuckleY, knuckleZ])),
    fingers: fingers.map((f) => ({ ...f, segments: f.segments.map(moveSeg), tip: move(f.tip) })),
    thumb: {
      segments: thumbSegments.map(moveSeg),
      tip: move([thumbSegments[2]!.at[0], thumbTip[0], thumbTip[1]]),
      tipReach: thumbTipReach,
      close: 1,
    },
    span: palmLength + reference.segs.reduce((s, v) => s + v, 0),
    // Hand breadth, as the anthropometry tables mean it: across the metacarpals, which
    // includes the thenar mass on the thumb side but not twice.
    breadth: HAND.palmBreadth + pad * 2 + HAND.thenar[1] * 0.4,
    pad,
    close,
    problems,
  };
}

// Exported for the diagnostics probe and the tests: the raw chain, before the shift.
export function handChainPoints(spec: HandSpec, id: string, close: number): [number, number][] {
  const pad = spec.pad ?? HAND.pad;
  const finger = HAND.fingers.find((f) => f.id === id)!;
  const base: [number, number] = [HAND.palmLength + pad, -(HAND.palmDepth + pad * 2) / 2];
  return chain(base, FORWARD, finger.segs, [
    HAND.flexion.mcp * close,
    HAND.flexion.pip * close,
    HAND.flexion.dip * close,
  ]).points;
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

export interface HandProblem {
  id: string;
  detail: string;
}

/**
 * What makes a hand a hand, as arithmetic.
 *
 * Same shape as `layoutProblems` and `RigProblem`: a list of concrete failures with a
 * number in each, so "the hand is not realistic" is a test result rather than a review
 * note. Everything here is measured on `handShape`, which needs no GPU — which is what
 * lets the contract be this specific.
 */
export function handProblems(shape: HandShape): HandProblem[] {
  const out: HandProblem[] = [];
  const add = (id: string, detail: string): void => {
    out.push({ id, detail });
  };
  const pad = shape.pad;
  const distalRadius = shape.grip.radius + HAND.thickness[2]! / 2 + pad;

  // 1. A hand is 16-21 cm from the wrist crease to the middle fingertip, gloved.
  if (shape.span < 0.16 || shape.span > 0.21) {
    add('span', `wrist to middle fingertip is ${(shape.span * 1000).toFixed(1)} mm, not 160-210`);
  }
  // 2. And 78-98 mm across the knuckles.
  if (shape.breadth < 0.078 || shape.breadth > 0.098) {
    add('breadth', `knuckle breadth is ${(shape.breadth * 1000).toFixed(1)} mm, not 78-98`);
  }
  // 3. The palm narrows: knuckles wider than the wrist by at least a quarter.
  const palmTaper = shape.palm.size[0] / shape.wrist.size[0];
  if (palmTaper < 1.25) {
    add('palmTaper', `palm is only ${palmTaper.toFixed(2)}x the wrist, and a palm is a wedge`);
  }
  // 4. A wrist is not a pipe: it is wider across than it is deep.
  const wristRatio = shape.wrist.size[0] / shape.wrist.size[2];
  if (wristRatio < 1.15 || wristRatio > 3.0) {
    add('wrist', `wrist is ${wristRatio.toFixed(2)}x wider than deep, and a wrist is flattened`);
  }
  // 5. Three phalanges per finger, three segments in the thumb.
  for (const finger of shape.fingers) {
    if (finger.segments.length !== 3) {
      add(`segments:${finger.id}`, `${finger.segments.length} phalanges, not 3`);
    }
  }
  if (shape.thumb.segments.length !== 3) {
    add('segments:thumb', `${shape.thumb.segments.length} thumb segments, not 3`);
  }
  // 6. The fingers are not equal: middle > ring > index > little, each by 2 mm.
  const byId = new Map(shape.fingers.map((f) => [f.id, f.length]));
  const order = ['middle', 'ring', 'index', 'little'];
  for (let i = 0; i + 1 < order.length; i++) {
    const a = byId.get(order[i]!)!;
    const b = byId.get(order[i + 1]!)!;
    // The gap *between* them, not their absolute difference: the first version of this
    // test compared `b >= a - 0.002` and flagged a perfectly correct 2 mm gap between
    // the ring and the index finger as a failure (ring 83 mm, index 81 mm is the real
    // anthropometry, and it is *supposed* to be the closest pair).
    if (a - b < 0.002) {
      add('fingerOrder',
        `${order[i]} ${(a * 1000).toFixed(0)} mm vs ${order[i + 1]} ${(b * 1000).toFixed(0)} mm: too close`);
    }
  }
  // 7. Every finger tapers along its length.
  for (const finger of shape.fingers) {
    const widths = finger.segments.map((s) => s.width);
    for (let i = 0; i + 1 < widths.length; i++) {
      if (widths[i + 1]! >= widths[i]!) {
        add(`taper:${finger.id}`, `phalanx ${i + 1} is not narrower than ${i}`);
      }
    }
  }
  // 8. The hand closes on what it holds: each fingertip is on the grip's surface, not
  //    through it and not hanging off it.
  for (const finger of shape.fingers) {
    if (finger.tipReach < shape.grip.radius) {
      add(`through:${finger.id}`,
        `fingertip is ${((shape.grip.radius - finger.tipReach) * 1000).toFixed(1)} mm inside the grip`);
    } else if (finger.tipReach > distalRadius + 0.006) {
      add(`open:${finger.id}`,
        `fingertip stands ${((finger.tipReach - distalRadius) * 1000).toFixed(1)} mm off the grip`);
    }
  }
  // 9. Opposition: the thumb's tip is on the grip, and at least a quarter turn around the
  //    grip's axis away from a fingertip. That is what opposition *is*, and the first
  //    version of this test compared signed `y` instead — which reported a thumb resting
  //    195 degrees across the bar from the middle finger as "on the same side as every
  //    fingertip", because two points on opposite sides of a circle can share a sign.
  const thumbRadius = shape.grip.radius + HAND.thumbThickness[2]! / 2 + pad;
  if (shape.thumb.tipReach < shape.grip.radius) {
    add('thumbThrough', 'thumb tip is inside the grip');
  } else if (shape.thumb.tipReach > thumbRadius + 0.008) {
    add('thumbOpen',
      `thumb tip stands ${((shape.thumb.tipReach - thumbRadius) * 1000).toFixed(1)} mm off the grip`);
  }
  const angleOf = (p: Vec3): number => Math.atan2(p[2], p[1]);
  const thumbAngle = angleOf(shape.thumb.tip);
  const separation = (a: number, b: number): number => {
    const d = Math.abs(a - b) % (Math.PI * 2);
    return d > Math.PI ? Math.PI * 2 - d : d;
  };
  const opposed = shape.fingers.some(
    (f) => separation(thumbAngle, angleOf(f.tip)) >= Math.PI / 2,
  );
  if (!opposed) {
    const closest = Math.min(...shape.fingers.map((f) => separation(thumbAngle, angleOf(f.tip))));
    add('opposition',
      `thumb tip is only ${((closest * 180) / Math.PI).toFixed(0)} degrees around the grip from the nearest fingertip`);
  }
  // 10. The closing amounts stay inside the range a hand can reach.
  const [lo, hi] = HAND.closeRange;
  for (const finger of shape.fingers) {
    if (finger.close < lo || finger.close > hi) {
      add(`close:${finger.id}`, `closes at ${finger.close.toFixed(2)}, outside [${lo}, ${hi}]`);
    }
  }
  // 11. And the solve itself did not give up.
  for (const p of shape.problems) {
    add('solve', p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Building it
// ---------------------------------------------------------------------------

export interface HandMaterials {
  /** The glove: leather, four millimetres thick. */
  glove: THREE.Material;
  /** Bare skin at the wrist, where the sleeve and the glove do not meet. */
  skin?: THREE.Material;
}

/**
 * The hand as geometry, in the same space `handShape` describes.
 *
 * Every part is a rounded box placed by the shape's own numbers, so a change to the
 * anatomy table moves the meshes and the contract together. UVs come from each part's
 * real size (`uvMetres`), because a glove's leather has a texel density like any other
 * surface and the view model sits 40 cm from the eye.
 */
export function buildHand(shape: HandShape, materials: HandMaterials, tileMetres = 0.25): THREE.Group {
  const group = new THREE.Group();
  group.name = `hand_${shape.side}`;

  /**
   * A phalanx, placed by its own numbers.
   *
   * The part is authored with its **width along x, its length along y and its thickness
   * along z**; `dir` lies in the hand's (y, z) plane, so a single rotation about x aims
   * it — and the sign matters: a rotation about x by theta takes +y to `(0, cos, sin)`,
   * so theta is `atan2(dir.z, dir.y)`. Getting that backwards aims every finger 180
   * degrees out, which is exactly the class of bug this file exists to end.
   */
  const bone = (at: Vec3, size: Vec3, dir: Vec3, material: THREE.Material): THREE.Mesh => {
    const smallest = Math.min(size[0], size[1], size[2]);
    const item = new THREE.Mesh(
      uvMetres(roundedBox(size[0], size[1], size[2], Math.min(0.004, smallest / 3)), size[0], size[1], tileMetres),
      material,
    );
    item.position.set(at[0], at[1], at[2]);
    item.rotation.x = Math.atan2(dir[2], dir[1]);
    item.castShadow = false;
    item.receiveShadow = false;
    group.add(item);
    return item;
  };

  const glove = materials.glove;
  const up: Vec3 = [0, 1, 0];
  // Palm, wrist, thenar: the three masses that make a palm read as a palm.
  bone(shape.palm.at, shape.palm.size, up, glove);
  bone(shape.wrist.at, shape.wrist.size, up, materials.skin ?? glove);
  bone(shape.thenar.at, shape.thenar.size, up, glove);

  // The knuckle row — the four MCP heads, which is the bump the eye actually reads.
  const knuckleWidth = HAND.fingers[1]!.base + shape.pad * 2;
  for (const at of shape.knuckles) {
    bone(at, [knuckleWidth, 0.017 + shape.pad, HAND.thickness[0]! + shape.pad * 2], up, glove);
  }

  for (const finger of shape.fingers) {
    for (const segment of finger.segments) {
      bone(segment.at, [segment.width, segment.length, segment.thickness], segment.dir, glove);
    }
    // A tip is a finger's tip: a short cap continuing the distal phalanx.
    const last = finger.segments[finger.segments.length - 1]!;
    const out = last.length / 2 + 0.004;
    const at: Vec3 = [
      last.at[0],
      last.at[1] + last.dir[1] * out,
      last.at[2] + last.dir[2] * out,
    ];
    bone(at, [last.width * 0.9, last.thickness * 0.7, last.thickness * 0.9], last.dir, glove);
  }

  for (const segment of shape.thumb.segments) {
    bone(segment.at, [segment.width, segment.length, segment.thickness], segment.dir, glove);
  }

  return group;
}

/**
 * A forearm and an upper arm, as an ellipse rather than a pipe.
 *
 * `limb()` lathes a *round* profile, and a limb is not round: a forearm is about a
 * quarter wider across than it is deep, and the flatness is most of what the eye reads
 * when an arm is 40 cm away. The anisotropy is applied to the **vertex positions**, not
 * to the mesh's `scale`, because scaling a mesh scales its UVs with it — a defect this
 * project has already shipped twice (AGENTS.md 22 and 36).
 */
export function limbElliptic(
  bottom: { across: number; deep: number },
  top: { across: number; deep: number },
  length: number,
  segments = 18,
): THREE.BufferGeometry {
  const rBottom = (bottom.across + bottom.deep) / 2;
  const rTop = (top.across + top.deep) / 2;
  const cap = 4;
  const shaft = 4;
  const h = Math.max(0.002, length / 2 - Math.min(rBottom, rTop));
  const points: [number, number][] = [];
  for (let i = 0; i <= cap; i++) {
    const t = -Math.PI / 2 + (i / cap) * (Math.PI / 2);
    points.push([rBottom * Math.cos(t), -h + rBottom * Math.sin(t)]);
  }
  for (let i = 1; i < shaft; i++) {
    const k = i / shaft;
    points.push([rBottom + (rTop - rBottom) * k, -h + k * 2 * h]);
  }
  for (let i = 0; i <= cap; i++) {
    const t = (i / cap) * (Math.PI / 2);
    points.push([rTop * Math.cos(t), h + rTop * Math.sin(t)]);
  }
  const geometry = lathe(points, segments);
  const mean = (bottom.across / Math.max(1e-6, bottom.deep) + top.across / Math.max(1e-6, top.deep)) / 2;
  const stretch = Math.sqrt(Math.max(1e-6, mean));
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    position.setX(i, position.getX(i) * stretch);
    position.setZ(i, position.getZ(i) / stretch);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return withAoUv(geometry);
}
