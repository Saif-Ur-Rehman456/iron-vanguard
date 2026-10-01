import type { DifficultyDef } from './types';

/** Difficulty curve. `regular` reproduces prototype ballistics exactly. */
export const DIFFICULTIES: readonly DifficultyDef[] = [
  {
    id: 'recruit',
    displayName: 'RECRUIT',
    enemyHealthMultiplier: 0.8,
    enemyDamageMultiplier: 0.6,
    enemyAccuracyMultiplier: 0.7,
    playerHealth: 125,
    regenDelaySeconds: 3.4,
    regenPerSecond: 18,
    resupplyMultiplier: 1.25,
  },
  {
    id: 'regular',
    displayName: 'REGULAR',
    enemyHealthMultiplier: 1,
    enemyDamageMultiplier: 1,
    enemyAccuracyMultiplier: 1,
    playerHealth: 100, // parity
    regenDelaySeconds: 4.2, // parity
    regenPerSecond: 16, // parity
    resupplyMultiplier: 1,
  },
  {
    id: 'hardened',
    displayName: 'HARDENED',
    enemyHealthMultiplier: 1.3,
    enemyDamageMultiplier: 1.35,
    enemyAccuracyMultiplier: 1.2,
    playerHealth: 100,
    regenDelaySeconds: 5.5,
    regenPerSecond: 11,
    resupplyMultiplier: 0.85,
  },
  {
    id: 'veteran',
    displayName: 'VETERAN',
    enemyHealthMultiplier: 1.6,
    enemyDamageMultiplier: 1.7,
    enemyAccuracyMultiplier: 1.4,
    playerHealth: 100,
    regenDelaySeconds: 6.5,
    regenPerSecond: 8,
    resupplyMultiplier: 0.7,
  },
];

export const DIFFICULTIES_BY_ID: Readonly<Record<string, DifficultyDef>> = Object.fromEntries(
  DIFFICULTIES.map((d) => [d.id, d]),
);

export function getDifficulty(id: string): DifficultyDef {
  const difficulty = DIFFICULTIES_BY_ID[id];
  if (!difficulty) throw new Error(`unknown difficulty id: ${id}`);
  return difficulty;
}
