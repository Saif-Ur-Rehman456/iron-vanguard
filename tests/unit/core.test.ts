import { describe, expect, it } from 'vitest';
import {
  FixedStepClock,
  MAX_TICKS_PER_FRAME,
  StateHasher,
  TICK_DT,
  clamp,
  createPool,
  createRng,
  createRngStreams,
  damp,
  fnv1a32,
  quantize,
  shortestAngle,
  shuffle,
  streamSeed,
  weightedIndex,
  wrapAngle,
  yawFromDirection,
} from '@iron/core';

describe('math', () => {
  it('clamps and damps toward a target without overshooting', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    // damp is exponential: it approaches but never passes the target.
    let value = 0;
    for (let i = 0; i < 600; i++) value = damp(value, 10, 8, TICK_DT);
    expect(value).toBeGreaterThan(9.99);
    expect(value).toBeLessThanOrEqual(10);
  });

  it('wraps angles into (-pi, pi]', () => {
    expect(wrapAngle(0)).toBeCloseTo(0, 12);
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 12);
    // The range is [-pi, pi]: a negative multiple comes back as -pi, not +pi.
    expect(wrapAngle(-Math.PI * 3)).toBeCloseTo(-Math.PI, 12);
    expect(shortestAngle(3.0, -3.0)).toBeCloseTo(0.2831853, 5);
  });

  it('maps a direction to the yaw convention the player forward vector uses', () => {
    // yaw 0 faces -Z; the forward vector is (-sin yaw, -cos yaw).
    expect(yawFromDirection(0, -1)).toBeCloseTo(0, 12);
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0.5, -0.5],
    ] as const) {
      const yaw = yawFromDirection(dx, dz);
      const length = Math.hypot(dx, dz);
      expect(-Math.sin(yaw)).toBeCloseTo(dx / length, 10);
      expect(-Math.cos(yaw)).toBeCloseTo(dz / length, 10);
    }
  });

  it('quantises for state hashing', () => {
    expect(quantize(1.23456)).toBeCloseTo(1.235, 10);
    expect(quantize(1.2345, 0.01)).toBeCloseTo(1.23, 10);
  });
});

describe('deterministic rng', () => {
  it('reproduces the same sequence for the same seed', () => {
    const a = createRng(7);
    const b = createRng(7);
    const first = Array.from({ length: 32 }, () => a.next());
    const second = Array.from({ length: 32 }, () => b.next());
    expect(first).toEqual(second);
    for (const value of first) expect(value).toBeGreaterThanOrEqual(0);
    expect(first.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('produces different sequences for different seeds', () => {
    const a = Array.from({ length: 8 }, () => createRng(1).next());
    const b = Array.from({ length: 8 }, () => createRng(2).next());
    expect(a).not.toEqual(b);
  });

  it('keeps named streams independent', () => {
    // Consuming the ai stream must not shift the spawn stream: that independence
    // is what stops a new particle effect from changing enemy behaviour.
    const reference = createRngStreams(1234);
    const first = reference.spawn.next();
    const second = reference.spawn.next();

    const streams = createRngStreams(1234);
    expect(streams.spawn.next()).toBe(first);
    for (let i = 0; i < 100; i++) streams.ai.next();
    expect(streams.spawn.next()).toBe(second);

    // A stream seed is a pure function of (run seed, stream name).
    expect(streamSeed(1234, 'ai')).toBe(streamSeed(1234, 'ai'));
    expect(streamSeed(1234, 'ai')).not.toBe(streamSeed(1235, 'ai'));
    expect(streamSeed(1234, 'ai')).not.toBe(streamSeed(1234, 'fx'));
    expect(createRngStreams(1).ai.next()).not.toBe(createRngStreams(2).ai.next());
  });

  it('shuffles deterministically and never picks a zero-weight entry', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(shuffle(createRng(9), [...items])).toEqual(shuffle(createRng(9), [...items]));
    expect(shuffle(createRng(9), [...items]).sort()).toEqual(items);

    const rng = createRng(99);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 400; i++) {
      const index = weightedIndex(rng, [1, 0, 3, 0.5]);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(4);
      counts[index]!++;
    }
    expect(counts[1]).toBe(0); // zero weight is never chosen
    expect(counts[2]).toBeGreaterThan(counts[3]!); // heavier weight wins more often
  });
});

describe('state hashing', () => {
  it('is stable for identical input and moves for real change', () => {
    const build = (health: number, y: number): string => {
      const h = new StateHasher();
      h.push('tick', 120);
      h.push('health', health);
      h.pushVec('pos', { x: 1, y, z: -2 });
      h.pushString('mode', 'burst');
      return h.hex();
    };
    expect(build(100, 1.7)).toBe(build(100, 1.7));
    expect(build(100, 1.7)).not.toBe(build(99, 1.7));
    expect(build(100, 1.7)).not.toBe(build(100, 1.8));
    expect(build(100, 1.7)).toHaveLength(8);
  });

  it('ignores float noise below the quantisation step', () => {
    const a = new StateHasher().push('x', 1.0000001).hex();
    const b = new StateHasher().push('x', 1.0000002).hex();
    expect(a).toBe(b);
    expect(fnv1a32('iron')).toBe(fnv1a32('iron'));
    expect(fnv1a32('iron')).not.toBe(fnv1a32('iro'));
  });
});

describe('fixed step clock', () => {
  it('advances in whole ticks and reports the interpolation alpha', () => {
    const clock = new FixedStepClock();
    expect(clock.advance(TICK_DT)).toBe(1);
    expect(clock.tick).toBe(1);
    expect(clock.advance(TICK_DT / 2)).toBe(0);
    expect(clock.alpha).toBeCloseTo(0.5, 6);
    expect(clock.advance(TICK_DT / 2)).toBe(1);
  });

  it('caps catch-up work and counts what it dropped', () => {
    const clock = new FixedStepClock();
    const steps = clock.advance(0.25); // a 250 ms hitch
    expect(steps).toBe(MAX_TICKS_PER_FRAME);
    expect(clock.droppedTicks).toBeGreaterThan(0);
    clock.reset();
    expect(clock.droppedTicks).toBe(0);
    expect(clock.tick).toBe(0);
  });
});

describe('pool', () => {
  it('never allocates past capacity and recycles the oldest entry', () => {
    const pool = createPool(() => ({ used: false }), 3);
    const first = pool.acquire();
    pool.acquire();
    pool.acquire();
    expect(pool.live).toBe(3);
    expect(pool.free).toBe(0);
    const recycled = pool.acquire();
    expect(recycled).toBe(first);
    expect(pool.live).toBe(3);

    pool.release(recycled);
    expect(pool.free).toBe(1);
  });
});
