import { describe, expect, it } from 'vitest';
import { TICK_HZ } from '@iron/core';
import { aliveEnemyCount, createInputState, enemyHitChance, stepWorld } from '@iron/sim';
import { getEnemy } from '@iron/content';
import { distanceToPlayer, idle, placeEnemy, quietWorld } from '../helpers/world';

function enemyShotCount(world: ReturnType<typeof quietWorld>): number {
  return world.events.filter((e) => e.type === 'enemyShot').length;
}

describe('enemy perception', () => {
  it('sees the player across open ground and does not see through buildings', () => {
    const open = quietWorld();
    const visible = placeEnemy(open, 'rifleman', 0, 20);
    idle(open, 1);
    expect(visible.hasLineOfSight).toBe(true);

    // The north building (x -10..6, z 36..48) blocks the line from (0,30) to (0,52).
    const blocked = quietWorld();
    const hidden = placeEnemy(blocked, 'rifleman', 0, 52);
    idle(blocked, 5);
    expect(hidden.hasLineOfSight).toBe(false);
    expect(enemyShotCount(blocked)).toBe(0);
    expect(hidden.mode).toBe('move');
  });
});

describe('enemy engagement', () => {
  it('telegraphs with a laser, then fires a burst that hurts the player', () => {
    const world = quietWorld();
    placeEnemy(world, 'rifleman', 0, 20);
    const input = createInputState();
    let sawAim = false;
    let sawBurst = false;
    for (let i = 0; i < 6 * TICK_HZ; i++) {
      stepWorld(world, input);
      const enemy = world.enemies[0]!;
      if (enemy.mode === 'aim') sawAim = true;
      if (enemy.mode === 'burst') sawBurst = true;
    }
    expect(sawAim).toBe(true);
    expect(sawBurst).toBe(true);
    expect(world.player.health).toBeLessThan(world.player.maxHealth);
  });

  it('models hit chance as base minus distance and evasion, clamped', () => {
    const rifleman = getEnemy('rifleman');
    const pointBlankStill = enemyHitChance(rifleman, 1, 0, 0);
    expect(pointBlankStill).toBeCloseTo(rifleman.burst.accuracyBase, 5);

    // Distance and player speed both make the player harder to hit.
    expect(enemyHitChance(rifleman, 1, 20, 0)).toBeLessThan(pointBlankStill);
    expect(enemyHitChance(rifleman, 1, 45, 0)).toBeLessThan(enemyHitChance(rifleman, 1, 20, 0));
    expect(enemyHitChance(rifleman, 1, 10, 10.5)).toBeLessThan(enemyHitChance(rifleman, 1, 10, 0));

    // Harder difficulties sharpen the aim, and the model stays clamped even for
    // an absurdly accurate archetype. Zero speed means no evasion term.
    expect(enemyHitChance(rifleman, 1.4, 10, 0)).toBeGreaterThan(enemyHitChance(rifleman, 1, 10, 0));
    expect(enemyHitChance(rifleman, 100, 0, 0)).toBeLessThanOrEqual(0.5);
    expect(enemyHitChance(rifleman, 0, 500, 10.5)).toBeGreaterThanOrEqual(0.07);
  });

  it('closes to melee and lunges as a rusher', () => {
    const world = quietWorld();
    const rusher = placeEnemy(world, 'rusher', 0, 24);
    const input = createInputState();
    let sawLunge = false;
    for (let i = 0; i < 8 * TICK_HZ; i++) {
      stepWorld(world, input);
      if (rusher.mode === 'lunge') sawLunge = true;
    }
    expect(sawLunge).toBe(true);
    expect(world.player.health).toBeLessThan(world.player.maxHealth);
  });

  it('keeps out of the player\u2019s face instead of standing on top of them', () => {
    const world = quietWorld();
    placeEnemy(world, 'rifleman', 0, 20);
    idle(world, 10 * TICK_HZ);
    expect(distanceToPlayer(world, world.enemies[0]!.pos.x, world.enemies[0]!.pos.z)).toBeGreaterThan(2);
  });
});

describe('pathing (regression: the wedge)', () => {
  it('walks around a lamp post instead of grinding into its corner', () => {
    // Reproduces the exact wedge found in a seed-185 sweep: a rifleman parked in
    // the notch between the lamp at (12,2) and the barrel at (12,5) never moved
    // again, so the wave could never be cleared. The single long probe used to
    // accept directions that were clear at 1.8 m but blocked for the next step.
    const world = quietWorld({ playerAt: { x: -4, z: -9 } });
    const enemy = placeEnemy(world, 'rifleman', 12.66, 2.65);
    expect(distanceToPlayer(world, enemy.pos.x, enemy.pos.z)).toBeGreaterThan(17);

    let closest = Infinity;
    for (let i = 0; i < 30 * TICK_HZ; i++) {
      stepWorld(world, createInputState());
      closest = Math.min(closest, distanceToPlayer(world, enemy.pos.x, enemy.pos.z));
    }
    expect(closest).toBeLessThan(12);
  });

  it('never leaves a hostile permanently stationary', () => {
    const world = quietWorld({ playerAt: { x: -4, z: -9 } });
    const enemy = placeEnemy(world, 'rifleman', 12.66, 2.65);
    let movedRecently = false;
    for (let second = 0; second < 20; second++) {
      const before = { x: enemy.pos.x, z: enemy.pos.z };
      idle(world, TICK_HZ);
      if (Math.hypot(enemy.pos.x - before.x, enemy.pos.z - before.z) > 0.5) movedRecently = true;
    }
    expect(movedRecently).toBe(true);
  });

  it('escapes when spawned inside a building', () => {
    const world = quietWorld();
    // Inside the north building footprint (x -10..6, z 36..48).
    const enemy = placeEnemy(world, 'rifleman', 0, 42);
    idle(world, 3 * TICK_HZ);
    expect(world.colliders.circleCollides(enemy.pos.x, enemy.pos.z, 0.5)).toBe(false);
  });
});

describe('squad bookkeeping', () => {
  it('counts only living hostiles and clears corpses', () => {
    const world = quietWorld();
    const a = placeEnemy(world, 'rifleman', 0, 20);
    placeEnemy(world, 'rusher', 4, 20);
    expect(aliveEnemyCount(world)).toBe(2);
    a.alive = false;
    expect(aliveEnemyCount(world)).toBe(1);

    idle(world, Math.round(4.3 * TICK_HZ));
    expect(world.enemies.some((e) => e.id === a.id)).toBe(false);
  });
});
