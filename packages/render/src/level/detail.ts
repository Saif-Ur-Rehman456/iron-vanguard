/**
 * The detail budget: how much geometry an asset class is allowed to carry (ADR-0021).
 *
 * The seventh review's PHASE 04 asked for an *importance system* — "hero assets: weapon,
 * player-near vehicle, important landmark → highest detail; mid assets: buildings, barriers,
 * street props → medium; far assets: skyline/background → simplified" — and for the two
 * failure modes it rules out: giving every object the same detail, and keeping them all low.
 *
 * A budget has to be data for the same reason a surface class is (ADR-0020): it is a property
 * of *what an asset is for*, and it has to be the same number everywhere that asset is built.
 * It also has to be checkable without a GPU, and "hero ≥ mid ≥ far" is arithmetical.
 *
 * What a tier decides is deliberately narrow — a bevel, a segment count, and whether the
 * secondary forms get built at all. It does **not** decide the look: a quality tier may never
 * change one of these numbers (ADR-0014/ADR-0017), because a player on `low` is looking at the
 * same world, and the same object has to be the same object in every frame of a replay.
 *
 * The numbers are real-world sizes rather than pixel budgets:
 *
 *  - `bevel` is how far a hard edge is rounded, in metres. A hero asset is looked at from
 *    arm's length and its edge *is* a highlight line (a 2 cm round on a receiver is a
 *    14 cm-radius read at 40 cm, which is what makes a hard surface read as machined metal);
 *    a wall is read at 10 m and needs a bigger absolute radius to catch the same light; a
 *    skyline block's edges are 100 m away and its silhouette is all that is left.
 *  - `segments` is the radial count for anything round. A 20-sided barrel at 2 m is a barrel;
 *    the same barrel at 90 m is a shadow on a wall, and 8 sides is a silhouette too.
 *  - `secondary` is whether the small forms — window reveals, door frames, housings, hardware,
 *    mirror stalks — are built. This is the single biggest cost in the arena, and it is the
 *    one that has to be spent where the player actually stands.
 */
export type AssetTier = 'hero' | 'mid' | 'far';

export interface DetailBudget {
  /** How far a hard edge is rounded, in metres. `0` means a mathematically sharp edge. */
  bevel: number;
  /** Radial segments for round forms (a barrel, a pipe, a wheel). */
  segments: number;
  /** Whether secondary forms are built at all (frames, seams, housings, hardware). */
  secondary: boolean;
  /** What this tier is for, in one line, so a mis-assignment is obvious in review. */
  why: string;
}

export const DETAIL: Record<AssetTier, DetailBudget> = {
  /**
   * The weapon, a vehicle within a few metres, the landmark the mission is fought around.
   * These are the objects the player can walk up to, so their edges, their fasteners and
   * their panel breaks are geometry rather than a texture.
   */
  hero: {
    bevel: 0.02,
    segments: 20,
    secondary: true,
    why: "held or walked up to: the edge is the highlight that says 'machined metal'",
  },
  /**
   * Buildings, barriers, street props, a car at the far end of the plaza. Their *form* is
   * read (a window is an opening, a barrier has a chamfered waist) but their hardware is not,
   * so they get real secondary geometry at a coarser bevel and a cheaper segment count.
   */
  mid: {
    bevel: 0.03,
    segments: 14,
    secondary: true,
    why: 'read at 5–40 m: the form matters, the hardware does not',
  },
  /**
   * The skyline and the blocks beyond the playable edge. Nothing here is looked at: the
   * silhouette is the whole asset, and every extra edge is a triangle spent on a surface
   * that a haze already covers.
   */
  far: {
    bevel: 0,
    segments: 8,
    secondary: false,
    why: 'silhouette only, under haze at 100 m+',
  },
};

export function detailFor(tier: AssetTier): DetailBudget {
  return DETAIL[tier];
}

/**
 * The bevel a tier uses for a part of a given size.
 *
 * The tier's absolute radius is the *ceiling* and `BEVEL_SHARE`-style scaling is the floor, so
 * a hero asset's 2 cm round cannot melt a 3 cm bracket into a capsule — the same lesson as
 * `geometry.bevelFor`, applied to the tier table rather than to a single call.
 */
export function tierBevel(tier: AssetTier, smallestDimension: number): number {
  const budget = DETAIL[tier].bevel;
  if (budget <= 0) return 0;
  return Math.min(budget, Math.max(0.0015, smallestDimension * 0.12));
}
