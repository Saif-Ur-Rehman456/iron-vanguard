/**
 * Golden replay (ADR-0002).
 *
 * A recorded trace of one quantised state hash per simulated second. Any
 * accidental gameplay change — a tweaked constant, a new system inserted into
 * the tick order, a stray Math.random — moves the trace and fails here.
 *
 * When a change is *intended*, re-record deliberately and say why in the commit:
 *   npm run hash -- --seed=7 --seconds=420 --out=tests/golden/prologue.seed7.hash
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TICK_HZ } from '@iron/core';
import { HashTrace, createWorld, hashWorld, stepWorld } from '@iron/sim';
import { ScriptedBot } from '@iron/tools';

const GOLDEN_PATH = fileURLToPath(new URL('./prologue.seed7.hash', import.meta.url));

interface GoldenSample {
  tick: number;
  hash: string;
}

function readGolden(): GoldenSample[] {
  return readFileSync(GOLDEN_PATH, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [tick, hash] = line.split(' ');
      return { tick: Number(tick), hash: hash ?? '' };
    });
}

function replay(): { samples: GoldenSample[]; complete: boolean; final: string } {
  const world = createWorld({ seed: 7, missionId: 'm00_prologue', difficultyId: 'regular' });
  const bot = new ScriptedBot();
  const trace = new HashTrace();

  for (let tick = 0; tick < 420 * TICK_HZ; tick++) {
    if (world.missionComplete || world.missionFailed) break;
    const { input, actions } = bot.tick(world);
    stepWorld(world, input, actions);
    trace.maybeSample(world);
  }
  return { samples: trace.samples, complete: world.missionComplete, final: hashWorld(world) };
}

describe('golden replay', () => {
  const golden = readGolden();

  it('records one hash per simulated second', () => {
    expect(golden.length).toBeGreaterThan(60);
    expect(golden[0]!.tick).toBe(60);
    expect(golden.every((s, i) => s.tick === (i + 1) * 60)).toBe(true);
    expect(golden.every((s) => /^[0-9a-f]{8}$/.test(s.hash))).toBe(true);
  });

  it('reproduces every recorded sample exactly', () => {
    const { samples, complete } = replay();
    expect(complete).toBe(true);
    expect(samples).toHaveLength(golden.length);

    const mismatches = samples
      .map((sample, index) => ({ sample, expected: golden[index]! }))
      .filter(({ sample, expected }) => sample.tick !== expected.tick || sample.hash !== expected.hash);

    // Report the first few differences so a failure is actionable rather than
    // just "somewhere in 160 samples something changed".
    const detail = mismatches
      .slice(0, 5)
      .map(({ sample, expected }) => `tick ${expected.tick}: expected ${expected.hash}, got ${sample.hash}`)
      .join('\n');
    expect(mismatches.length, `golden mismatches:\n${detail}`).toBe(0);
  });

  it('is stable across repeated in-process runs', () => {
    // Guards against hidden global state: two runs in the same process must
    // agree, which is the property Playwright fast-forwards rely on.
    const a = replay();
    const b = replay();
    expect(b.final).toBe(a.final);
    expect(b.samples).toEqual(a.samples);
  });
});
