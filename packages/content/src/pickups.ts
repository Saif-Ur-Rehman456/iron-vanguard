import type { PickupDef, RankDef } from './types';

/** Drop table. Weights are relative within the drop roll. */
export const PICKUPS: readonly PickupDef[] = [
  {
    id: 'medkit',
    displayName: 'FIELD MEDKIT',
    amount: 40, // parity
    color: 0x9dff57,
    lifetimeSeconds: 30, // parity
    pickupRadius: 1.5, // parity
    weight: 0.55, // parity: medkit is the more common drop
  },
  {
    id: 'ammo',
    displayName: 'AMMUNITION',
    amount: 60, // parity
    color: 0xffb043,
    lifetimeSeconds: 30,
    pickupRadius: 1.5,
    weight: 0.45,
  },
];

export const PICKUPS_BY_ID: Readonly<Record<string, PickupDef>> = Object.fromEntries(
  PICKUPS.map((p) => [p.id, p]),
);

/** Combat rating thresholds, evaluated best-first (parity values). */
export const RANKS: readonly RankDef[] = [
  { id: 'S', label: 'COMBAT RATING', minScore: 8200, minAccuracy: 32 },
  { id: 'A', label: 'COMBAT RATING', minScore: 6800, minAccuracy: 0 },
  { id: 'B', label: 'COMBAT RATING', minScore: 5200, minAccuracy: 0 },
  { id: 'C', label: 'COMBAT RATING', minScore: 3800, minAccuracy: 0 },
  { id: 'D', label: 'COMBAT RATING', minScore: 0, minAccuracy: 0 },
];

export function rankFor(score: number, accuracyPercent: number): RankDef {
  for (const rank of RANKS) {
    if (score >= rank.minScore && accuracyPercent >= rank.minAccuracy) return rank;
  }
  return RANKS[RANKS.length - 1]!;
}
