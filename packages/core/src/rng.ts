/**
 * Deterministic pseudo-random number generation (ADR-0002).
 *
 * Rules:
 *  - Never call Math.random in sim/core. Ask for a named stream.
 *  - Streams are independent, so adding a particle effect cannot shift a spawn roll.
 *  - Streams are seeded from a single run seed, so a replay reproduces exactly.
 */
import { fnv1a32 } from './hash.js';

export interface Rng {
  /** [0,1) */
  next(): number;
  /** [min,max) */
  range(min: number, max: number): number;
  /** integer in [minInclusive, maxExclusive) */
  int(minInclusive: number, maxExclusive: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  sign(): number;
}

export type RngStreamName = 'spawn' | 'ai' | 'fx' | 'ballistics' | 'loot' | 'world';

export const RNG_STREAMS: readonly RngStreamName[] = [
  'spawn',
  'ai',
  'fx',
  'ballistics',
  'loot',
  'world',
];

/** mulberry32 — small, fast, well-distributed, and trivially reproducible. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (minInclusive, maxExclusive) =>
      minInclusive + Math.floor(next() * Math.max(1, maxExclusive - minInclusive)),
    chance: (probability) => next() < probability,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('Rng.pick called with an empty list');
      return items[Math.floor(next() * items.length)]!;
    },
    sign: () => (next() < 0.5 ? -1 : 1),
  };
}

/** Derive a stable stream seed from a run seed + stream name. */
export function streamSeed(runSeed: number, name: RngStreamName): number {
  return (fnv1a32(name) ^ Math.imul(runSeed >>> 0, 0x9e3779b1)) >>> 0;
}

export type RngStreams = Record<RngStreamName, Rng>;

export function createRngStreams(runSeed: number): RngStreams {
  const streams = {} as RngStreams;
  for (const name of RNG_STREAMS) streams[name] = createRng(streamSeed(runSeed, name));
  return streams;
}

/** Deterministic in-place Fisher-Yates. */
export function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(0, i + 1);
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}

/** Weighted pick: returns the index of the chosen weight. */
export function weightedIndex(rng: Rng, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  let roll = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return i;
  }
  return weights.length - 1;
}
