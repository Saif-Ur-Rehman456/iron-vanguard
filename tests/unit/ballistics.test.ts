import { describe, expect, it } from 'vitest';
import { damageAtDistance, hitGroupMultiplier, traceShot } from '@iron/sim';
import { getWeapon } from '@iron/content';
import { placeEnemy, quietWorld } from '../helpers/world';

const m4 = getWeapon('m4_vanguard');

/**
 * The plaza player spawn is (0, 30) and the ground up to z = 36 is clear of
 * props apart from the monument at the origin, so these rays run down the -Z
 * axis from the spawn at a hostile standing at (0, 20).
 */
const EYE = 1.7;
const back = { x: 0, y: 0, z: -1 };
const spawn = { x: 0, y: EYE, z: 30 };

function shot(world: ReturnType<typeof quietWorld>, y: number, x = 0, ignore = 0) {
  return traceShot(world, { x, y, z: spawn.z }, back, 40, ignore);
}

describe('hitscan hitboxes', () => {
  it('distinguishes a headshot from a torso hit', () => {
    const world = quietWorld();
    const enemy = placeEnemy(world, 'rifleman', 0, 20);
    // spawnEnemyState faces the hostile at the player: +Z is yaw +/-pi.
    expect(Math.abs(enemy.yaw)).toBeCloseTo(Math.PI, 6);

    const head = shot(world, 1.75);
    expect(head?.enemy).toBe(enemy);
    expect(head?.head).toBe(true);
    expect(head?.group).toBe('head');
    expect(head?.distance).toBeCloseTo(9.83, 2);

    const torso = shot(world, 1.15);
    expect(torso?.enemy).toBe(enemy);
    expect(torso?.head).toBe(false);
    expect(torso?.group).toBe('torso');
    expect(torso?.distance).toBeCloseTo(9.8, 4);
  });

  it('misses when the ray passes over or beside a hostile', () => {
    const world = quietWorld();
    placeEnemy(world, 'rifleman', 0, 20);
    // Head top is 1.75 + 0.17 = 1.92, so a 2.4 m ray clears it...
    expect(shot(world, 2.4)?.enemy ?? null).toBeNull();
    // ...and the torso is only 0.3 m wide either side of centre.
    expect(shot(world, 1.2, 1.5)?.enemy ?? null).toBeNull();
  });

  it('scales hitboxes with the archetype render scale', () => {
    const world = quietWorld();
    const heavy = placeEnemy(world, 'heavy', 0, 20);
    expect(heavy.def.scale).toBeGreaterThan(1);
    // The heavy's torso is 0.3 * 1.18 = 0.354 m half-width, so a ray 0.35 m off
    // centre still connects — the same ray misses a rifleman.
    expect(shot(world, 1.15, 0.35)?.enemy).toBe(heavy);

    const rifleWorld = quietWorld();
    placeEnemy(rifleWorld, 'rifleman', 0, 20);
    expect(shot(rifleWorld, 1.15, 0.35)?.enemy ?? null).toBeNull();
  });

  it('stops at world geometry in front of a hostile', () => {
    const world = quietWorld();
    placeEnemy(world, 'rifleman', 0, 20);
    // Shoot from inside the plaza monument (a 4.2 m half-extent at the origin):
    // the ray must report concrete, never a body.
    const hit = traceShot(world, { x: 0, y: 1.2, z: 3 }, back, 40);
    expect(hit?.enemy).toBeNull();
    expect(hit?.group).toBe('world');
  });

  it('hits barrels and identifies them by negative entity id', () => {
    const world = quietWorld();
    const barrel = world.barrels[0]!;
    expect(barrel.x).toBe(-8);
    expect(barrel.z).toBe(-9);
    // Approach the barrel down the +X lane so nothing else is in the way.
    const hit = traceShot(
      world,
      { x: barrel.x - 5, y: 0.7, z: barrel.z },
      { x: 1, y: 0, z: 0 },
      40,
    );
    expect(hit?.group).toBe('barrel');
    expect(hit?.entityId).toBe(-(barrel.id + 1));
    expect(hit?.surface).toBe('metal');
  });

  it('ignores a hostile when its id is excluded (a shooter cannot shoot itself)', () => {
    const world = quietWorld();
    const enemy = placeEnemy(world, 'rifleman', 0, 20);
    expect(shot(world, 1.2, 0, enemy.id)?.enemy ?? null).toBeNull();
  });

  it('ignores dead hostiles', () => {
    const world = quietWorld();
    const enemy = placeEnemy(world, 'rifleman', 0, 20);
    enemy.alive = false;
    expect(shot(world, 1.2)?.enemy ?? null).toBeNull();
  });
});

describe('damage model', () => {
  it('applies the M4 falloff curve', () => {
    expect(damageAtDistance(m4, m4.damage, 5)).toBe(34);
    expect(damageAtDistance(m4, m4.damage, 45)).toBe(34);
    expect(damageAtDistance(m4, m4.damage, 90)).toBeCloseTo(34 * 0.7, 6);
    expect(damageAtDistance(m4, m4.damage, 200)).toBeCloseTo(34 * 0.7, 6);
    // Midpoint of the falloff window sits halfway to the floor.
    expect(damageAtDistance(m4, m4.damage, 67.5)).toBeCloseTo(34 * 0.85, 4);
  });

  it('rewards headshots with the weapon multiplier', () => {
    expect(hitGroupMultiplier(m4, true)).toBe(2.1);
    expect(hitGroupMultiplier(m4, false)).toBe(1);
  });
});
