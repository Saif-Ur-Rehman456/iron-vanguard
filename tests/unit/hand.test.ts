/**
 * The hand (AGENTS.md, the standing review).
 *
 * The report was "our own hand and arm are still not realistic, their shapes are not
 * real". Measuring the isolated view model makes that a number: the old hand was one
 * rounded box for the palm, four identical boxes for the fingers and one for the thumb,
 * and a gradient-orientation histogram of it read `axis = 0.44` with `fill = 0.67` inside
 * its own bounding box — a plate with perpendicular edges.
 *
 * So the fix is a table of real proportions and a solved chain, and the check is the same
 * arithmetic: `handShape` and `handProblems` need no GPU, no scene and no camera, which
 * is why the contract can state things a screenshot never could — that the fingers are
 * *different lengths*, that they *taper*, that every fingertip lands on the surface of
 * whatever the hand is holding rather than beside it or through it, and that the thumb
 * comes to rest a quarter turn or more around the grip from the fingertips.
 *
 * The three defects this test was written against, all found by it rather than by eye:
 * the chain applied each joint's flexion *after* its own phalanx, so every finger came
 * out perfectly straight and the fitted grip landed 12 cm in front of the knuckles; the
 * index finger was excluded from its own closure solve, so it curled 3 mm inside a 17 mm
 * grip; and the opposition check compared signed `y`, which reported a thumb 195 degrees
 * across the bar as "on the same side as every fingertip".
 */
import { describe, expect, it } from 'vitest';
import { HAND, handProblems, handShape, type HandSpec } from '../../packages/render/src/characters/hand';

/** Everything a hand is asked to hold in this game, plus both extremes. */
const GRIPS: { label: string; radius: number }[] = [
  { label: 'a thin foregrip', radius: 0.012 },
  { label: 'a pistol grip', radius: 0.0165 },
  { label: 'a magazine well', radius: 0.019 },
  { label: 'a handguard', radius: 0.024 },
  { label: 'a fat handguard', radius: 0.03 },
];

const shapeFor = (radius: number, extra: Partial<HandSpec> = {}) =>
  handShape({ side: 'right', gripRadius: radius, ...extra });

describe('the hand', () => {
  it('satisfies its own contract around everything it has to hold', () => {
    for (const grip of GRIPS) {
      for (const side of ['right', 'left'] as const) {
        const shape = handShape({ side, gripRadius: grip.radius });
        expect(handProblems(shape), `${side} hand on ${grip.label}`).toEqual([]);
      }
    }
  });

  it('is a hand-sized hand', () => {
    const shape = shapeFor(0.019);
    // Wrist crease to middle fingertip, and across the knuckles — the two numbers an
    // anthropometry table means by "hand length" and "hand breadth".
    expect(shape.span).toBeGreaterThan(0.16);
    expect(shape.span).toBeLessThan(0.21);
    expect(shape.breadth).toBeGreaterThan(0.078);
    expect(shape.breadth).toBeLessThan(0.098);
    // A palm is a wedge: the knuckles are wider than the wrist by a quarter or more.
    expect(shape.palm.size[0] / shape.wrist.size[0]).toBeGreaterThan(1.25);
    // And a wrist is flattened, not a pipe.
    expect(shape.wrist.size[0] / shape.wrist.size[2]).toBeGreaterThan(1.15);
  });

  it('has four fingers that are four different lengths, longest in the middle', () => {
    const shape = shapeFor(0.019);
    const total = new Map(shape.fingers.map((f) => [f.id, f.length]));
    // The order and the spread, both: four equal boxes would pass neither.
    expect(total.get('middle')!).toBeGreaterThan(total.get('ring')!);
    expect(total.get('ring')!).toBeGreaterThan(total.get('index')!);
    expect(total.get('index')!).toBeGreaterThan(total.get('little')!);
    for (const [a, b] of [
      ['middle', 'ring'],
      ['ring', 'index'],
      ['index', 'little'],
    ] as const) {
      expect(total.get(a)! - total.get(b)!, `${a} vs ${b}`).toBeGreaterThanOrEqual(0.002);
    }
  });

  it('tapers every phalanx and gives every finger three of them', () => {
    const shape = shapeFor(0.019);
    for (const finger of shape.fingers) {
      expect(finger.segments, finger.id).toHaveLength(3);
      const widths = finger.segments.map((s) => s.width);
      expect(widths[1]!, `${finger.id} proximal > middle`).toBeLessThan(widths[0]!);
      expect(widths[2]!, `${finger.id} middle > distal`).toBeLessThan(widths[1]!);
    }
    expect(shape.thumb.segments).toHaveLength(3);
  });

  it('closes on what it holds, at every radius and for every finger', () => {
    for (const grip of GRIPS) {
      const shape = shapeFor(grip.radius);
      const surface = grip.radius + HAND.thickness[2]! / 2 + shape.pad;
      for (const finger of shape.fingers) {
        // On the surface, not beside it and not through it.
        expect(finger.tipReach, `${finger.id} on ${grip.label}`).toBeGreaterThan(grip.radius);
        expect(finger.tipReach, `${finger.id} on ${grip.label}`).toBeLessThan(surface + 0.006);
      }
    }
  });

  it('gives every finger its own closing amount', () => {
    // Four fingers of four different lengths wrap one bar by four different amounts, and
    // they must: a 68 mm little finger and a 90 mm middle finger cannot share one flexion
    // and both touch the surface. One shared flexion for all four is exactly what "four
    // identical boxes" means, and the spread below is what rules it out.
    //
    // The direction is worth stating because it was guessed backwards first: the *shorter*
    // finger closes *less*, not more. Reaching the bar's surface is about the tip's
    // distance from the axis, and a shorter finger, starting from the same knuckle line,
    // gets there with less wrap — 0.87 for the little against 0.94 for the middle.
    for (const grip of GRIPS) {
      const shape = shapeFor(grip.radius);
      const amounts = shape.fingers.map((f) => f.close);
      const spread = Math.max(...amounts) - Math.min(...amounts);
      // Measured across the game's grips: 0.085 on a 12 mm bar, 0.066 on a magazine well,
      // 0.054 on a handguard, 0.039 on a 30 mm one. The spread *compresses* as the bar gets
      // fatter — a fat bar is easier for a short finger — so the floor is the fat end's
      // number with a little room under it, and what it rules out is the shared flexion a
      // comb of identical boxes implies, which is a spread of exactly zero.
      expect(spread, `closing spread on ${grip.label}`).toBeGreaterThan(0.03);
      const little = shape.fingers.find((f) => f.id === 'little')!;
      const middle = shape.fingers.find((f) => f.id === 'middle')!;
      expect(little.close, `little vs middle on ${grip.label}`).toBeLessThan(middle.close);
    }
  });

  it('puts the thumb across the grip from the fingers, not beside them', () => {
    const separation = (a: number, b: number): number => {
      const d = Math.abs(a - b) % (Math.PI * 2);
      return d > Math.PI ? Math.PI * 2 - d : d;
    };
    for (const grip of GRIPS) {
      const shape = shapeFor(grip.radius);
      const thumbAngle = Math.atan2(shape.thumb.tip[2], shape.thumb.tip[1]);
      const widest = Math.max(
        ...shape.fingers.map((f) => separation(thumbAngle, Math.atan2(f.tip[2], f.tip[1]))),
      );
      // Opposition, stated as an angle: the thumb rests more than a quarter turn around
      // the bar from at least one fingertip. Signed `y` cannot see this — two points on
      // opposite sides of a circle can share a sign — which is how the first version of
      // this assertion passed a thumb that was sitting on top of the index finger.
      expect(widest, `opposition on ${grip.label}`).toBeGreaterThanOrEqual(Math.PI / 2);
    }
  });

  it('holds a trigger finger out of the grip instead of solving it onto one', () => {
    const onTrigger = shapeFor(0.0165, { trigger: 0.55 });
    const closed = shapeFor(0.0165);
    const index = (shape: ReturnType<typeof shapeFor>): number =>
      shape.fingers.find((f) => f.id === 'index')!.tipReach;
    // Released by the trigger, the index reaches further out than a finger curled onto
    // the grip — and further than its own solved closure would put it.
    expect(index(onTrigger)).toBeGreaterThan(index(closed));
    // The other three are unaffected: a trigger finger is one finger, not a hand.
    for (const id of ['middle', 'ring', 'little']) {
      const a = onTrigger.fingers.find((f) => f.id === id)!.tipReach;
      const b = closed.fingers.find((f) => f.id === id)!.tipReach;
      expect(Math.abs(a - b), id).toBeLessThan(0.001);
    }
  });

  it('mirrors without changing its size', () => {
    const right = shapeFor(0.019);
    const left = handShape({ side: 'left', gripRadius: 0.019 });
    expect(left.span).toBeCloseTo(right.span, 9);
    expect(left.breadth).toBeCloseTo(right.breadth, 9);
    // The width is mirrored, not the geometry: every finger's X flips sign.
    for (let i = 0; i < right.fingers.length; i++) {
      expect(left.fingers[i]!.at).toBeCloseTo(-right.fingers[i]!.at, 9);
    }
  });

  it('releases the trigger finger instead of gripping harder with it', () => {
    // `trigger` is a *release*. Adding it to the MCP flexion was the first version, and
    // it made a hand hold a trigger tighter than a grip — the opposite of the word.
    const straighter = shapeFor(0.0165, { trigger: 0.55 });
    const gripped = shapeFor(0.0165);
    const reach = (shape: ReturnType<typeof shapeFor>, id: string): number =>
      shape.fingers.find((f) => f.id === id)!.tipReach;
    expect(reach(straighter, 'index')).toBeGreaterThan(reach(gripped, 'index'));
  });

  it('does not solve for a bar it cannot close on', () => {
    // A 90 mm grip is a fence post. The solve must not pretend: the contract fails, and
    // it fails with a number rather than by rendering a gap nobody notices.
    const shape = shapeFor(0.09);
    const problems = handProblems(shape);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.id.startsWith('open:') || p.id === 'solve')).toBe(true);
  });
});
