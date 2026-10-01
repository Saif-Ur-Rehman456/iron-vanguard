/**
 * Geometry construction: the bevel rule, the detail budget, and an opening that is an opening
 * (ADR-0021).
 *
 * The seventh review's PHASE 04 is eighteen items about *shapes*, and three of them are
 * arithmetic rather than art direction:
 *
 *  - **item 2, "edges bahut sharp aur CG-looking hain"**: a bevel is the *edge of a real part*,
 *    so its radius is a small share of that part — the shipped rule clamped it to a third of
 *    the smallest dimension, which turned every 60 mm detail into a capsule.
 *  - **item 14, "polygon/detail distribution consistent nahi"**: an asset's detail has to follow
 *    what the asset is *for* (hero / mid / far), not a global constant.
 *  - **item 7, "windows mostly flat surfaces jaisi hain"**: a window is a hole with a frame
 *    around it, and what the eye reads as the hole is the distance between the glass and the
 *    thing that overhangs it. The shipped version put the *glass in front of its own frame*.
 *
 * All three are values, so all three are checkable here with no GPU.
 */
import { describe, expect, it } from 'vitest';
import {
  BEVEL,
  BEVEL_SHARE,
  DETAIL,
  bevelFor,
  detailFor,
  roundedBox,
  tierBevel,
  windowConstruction,
  type AssetTier,
} from '@iron/render';

describe('the bevel rule', () => {
  it('keeps the default on anything big enough to carry it', () => {
    // A crate, a wall, a barrier: the absolute radius is what was tuned, and it survives.
    expect(bevelFor(0.4, 0.4, 0.55)).toBeCloseTo(BEVEL, 6);
    expect(bevelFor(5, 3, 0.4)).toBeCloseTo(BEVEL, 6);
  });

  it('scales a small part by its own size instead of melting it', () => {
    // The defect: a 60 mm box got a 20 mm radius (a third of it) and read as a lozenge.
    const detail = bevelFor(0.06, 0.05, 0.04);
    expect(detail).toBeLessThanOrEqual(0.05 * BEVEL_SHARE + 1e-9);
    expect(detail).toBeLessThan(BEVEL / 3);
    // A 60 mm part keeps a ~7 mm edge, which is a machined round rather than a capsule.
    expect(detail).toBeGreaterThan(0.004);
    expect(detail / 0.05).toBeLessThan(0.2);
  });

  it('never reaches a third of the part, whatever it is asked for', () => {
    // A third is where a rounded box starts eating its own faces; nothing may cross it.
    for (const size of [0.004, 0.01, 0.03, 0.06, 0.12, 0.5, 2]) {
      const r = bevelFor(size, size, size, 0.5);
      expect(r, `${size} m`).toBeLessThanOrEqual(size / 3 + 1e-9);
      expect(r, `${size} m`).toBeGreaterThan(0);
    }
  });

  it('is monotone in the part, and in the request', () => {
    const small = bevelFor(0.05, 0.05, 0.05);
    const medium = bevelFor(0.2, 0.2, 0.2);
    const large = bevelFor(1, 1, 1);
    expect(medium).toBeGreaterThanOrEqual(small);
    expect(large).toBeGreaterThanOrEqual(medium);
    // A caller asking for a *smaller* radius than the share allows gets it: the share is a
    // ceiling, not a floor.
    expect(bevelFor(1, 1, 1, 0.004)).toBeCloseTo(0.004, 6);
  });

  it('is what `roundedBox` actually uses', () => {
    // The rule is only real if the workhorse reads it: the cache key includes the radius, so
    // two parts of different size cannot share a geometry.
    const thin = roundedBox(0.06, 0.05, 0.04);
    const thick = roundedBox(0.6, 0.5, 0.4);
    expect(thin).not.toBe(thick);
  });
});

describe('the detail budget (item 14)', () => {
  const tiers: AssetTier[] = ['hero', 'mid', 'far'];

  it('orders the tiers: most detail where the player stands', () => {
    expect(DETAIL.hero.bevel).toBeLessThanOrEqual(DETAIL.mid.bevel);
    expect(DETAIL.hero.segments).toBeGreaterThanOrEqual(DETAIL.mid.segments);
    expect(DETAIL.mid.segments).toBeGreaterThanOrEqual(DETAIL.far.segments);
    // A hero asset is at arm's length and a far one is under haze: the difference has to be
    // real rather than nominal, or the budget is decoration.
    expect(DETAIL.hero.segments).toBeGreaterThan(DETAIL.far.segments * 2);
    expect(DETAIL.far.secondary).toBe(false);
    expect(DETAIL.hero.secondary).toBe(true);
  });

  it('states real-world numbers, and says what each tier is for', () => {
    for (const tier of tiers) {
      const budget = detailFor(tier);
      expect(budget.bevel, tier).toBeGreaterThanOrEqual(0);
      expect(budget.bevel, tier).toBeLessThan(0.08);
      expect(budget.segments, tier).toBeGreaterThanOrEqual(6);
      expect(budget.segments, tier).toBeLessThanOrEqual(32);
      expect(budget.why.length, tier).toBeGreaterThan(10);
    }
  });

  it('scales a tier bevel down for a small part of that tier', () => {
    // A hero asset's 2 cm round is an edge on a receiver and a capsule on a 20 mm screw.
    expect(tierBevel('hero', 0.5)).toBeCloseTo(DETAIL.hero.bevel, 6);
    expect(tierBevel('hero', 0.02)).toBeLessThan(DETAIL.hero.bevel);
    expect(tierBevel('hero', 0.02)).toBeLessThanOrEqual(0.02 * 0.12 + 1e-9);
    // The `far` tier has no bevel at all: its edges are 100 m away and never read.
    expect(tierBevel('far', 4)).toBe(0);
  });
});

describe('a window is an opening (item 7)', () => {
  const paneW = 1.15;
  const paneH = 1.3;
  const window = windowConstruction(paneW, paneH);
  const front = (piece: { size: [number, number, number]; at: [number, number, number] }): number =>
    piece.at[2] + piece.size[2] / 2;

  it('sets the glass behind the frame that surrounds it', () => {
    // The shipped version placed the pane 9 cm *in front* of its own reveal, so the glass
    // covered the frame and the window was a dark plate standing off the wall.
    expect(front(window.pane)).toBeLessThan(front(window.lintel));
    expect(front(window.pane)).toBeLessThan(front(window.sill));
    // The reveal has to be deep enough to read as shadow at 20 m: over 10 cm.
    expect(front(window.lintel) - front(window.pane)).toBeGreaterThan(0.1);
    expect(front(window.sill) - front(window.pane)).toBeGreaterThan(0.1);
  });

  it('caps the opening instead of covering it', () => {
    const lintelBottom = window.lintel.at[1] - window.lintel.size[1] / 2;
    const sillTop = window.sill.at[1] + window.sill.size[1] / 2;
    // The lintel's bottom edge is the top of the glass and the sill's top edge is the bottom
    // of it, so nothing overlaps the pane: the opening is glazed, not boarded.
    expect(lintelBottom).toBeGreaterThanOrEqual(paneH / 2 - 1e-9);
    expect(sillTop).toBeLessThanOrEqual(-paneH / 2 + 1e-9);
    // ...and both are wider than the opening, or the frame does not frame anything.
    expect(window.lintel.size[0]).toBeGreaterThan(paneW);
    expect(window.sill.size[0]).toBeGreaterThan(paneW);
  });

  it('keeps the glass on the wall rather than inside the building', () => {
    // A building shell is one solid box, so a pane set *behind* the wall plane is inside the
    // building and invisible. This is the honest approximation, and it is worth stating: the
    // pane's back face is at the wall and the frame stands proud of it.
    expect(window.pane.at[2] - window.pane.size[2] / 2).toBeGreaterThanOrEqual(-1e-9);
    // The frame is seated in the wall rather than floating off it.
    expect(window.lintel.at[2] - window.lintel.size[2] / 2).toBeLessThan(0);
    expect(window.sill.at[2] - window.sill.size[2] / 2).toBeLessThan(0);
  });

  it('gives the sill a ledge the light can catch', () => {
    expect(window.sill.size[2]).toBeGreaterThan(window.pane.size[2] * 3);
    expect(window.sill.size[1]).toBeLessThan(paneH / 4);
  });
});
