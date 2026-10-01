import { describe, expect, it } from 'vitest';
import {
  ENEMIES,
  MAPS,
  MISSIONS,
  PICKUPS,
  RANKS,
  TOTAL_HOSTILES,
  WAVES,
  WEAPONS,
  assertContentValid,
  getDifficulty,
  getEnemy,
  getMap,
  getMission,
  getWeapon,
  propsOfKind,
  validateContent,
  EnemySchema,
  MapSchema,
  MissionSchema,
  WeaponSchema,
} from '@iron/content';

describe('content contracts', () => {
  it('passes schema and cross-reference validation', () => {
    const issues = validateContent();
    expect(issues.map((i) => `${i.where}: ${i.message}`)).toEqual([]);
    expect(() => assertContentValid()).not.toThrow();
  });

  it('rejects malformed rows the schema is there to catch', () => {
    const weapon = WEAPONS[0]!;
    expect(WeaponSchema.safeParse({ ...weapon, damage: -1 }).success).toBe(false);
    expect(WeaponSchema.safeParse({ ...weapon, magazine: 0 }).success).toBe(false);
    expect(WeaponSchema.safeParse({ ...weapon, id: '' }).success).toBe(false);
    expect(WeaponSchema.safeParse({ ...weapon, headshotMultiplier: 0.5 }).success).toBe(false);

    const enemy = ENEMIES[0]!;
    expect(EnemySchema.safeParse({ ...enemy, dropChance: 1.5 }).success).toBe(false);
    expect(
      EnemySchema.safeParse({ ...enemy, burst: { ...enemy.burst, damageDelayTicks: 1.5 } }).success,
    ).toBe(false);

    const map = MAPS[0]!;
    expect(MapSchema.safeParse({ ...map, props: [] }).success).toBe(false);
    expect(MapSchema.safeParse({ ...map, gates: [{ x: 0, z: 0, axis: 'y' }] }).success).toBe(false);

    const mission = MISSIONS[0]!;
    expect(MissionSchema.safeParse({ ...mission, objectives: [] }).success).toBe(false);
    expect(MissionSchema.safeParse({ ...mission, waves: [] }).success).toBe(false);
  });

  it('throws a clear error for unknown ids instead of returning undefined', () => {
    expect(() => getWeapon('nope')).toThrow(/unknown weapon id/);
    expect(() => getEnemy('nope')).toThrow(/unknown enemy id/);
    expect(() => getMap('nope')).toThrow(/unknown map id/);
    expect(() => getMission('nope')).toThrow(/unknown mission id/);
    expect(() => getDifficulty('nope')).toThrow(/unknown difficulty id/);
  });
});

describe('prototype parity values', () => {
  // These are the numbers lifted from legacy/callofduty.r128.html. If one of
  // them changes, the golden replay must be re-recorded and the change
  // explained — that is the whole point of pinning them here.
  it('keeps the M4 exactly as the prototype had it', () => {
    const m4 = getWeapon('m4_vanguard');
    expect(m4.magazine).toBe(30);
    expect(m4.reserveMax).toBe(360);
    expect(m4.reloadSeconds).toBe(1.85);
    expect(m4.shotInterval).toBe(0.098);
    expect(m4.damage).toBe(34);
    expect(m4.headshotMultiplier).toBe(2.1);
    expect(m4.spread.hip).toBe(0.012);
    expect(m4.spread.ads).toBe(0.0025);
    expect(m4.ads.fovDeg).toBe(42);
  });

  it('keeps enemy archetypes as the prototype had them', () => {
    const rifleman = getEnemy('rifleman');
    expect(rifleman.health).toBe(100);
    expect(rifleman.speed).toBe(3.2);
    expect(rifleman.score).toBe(100);
    expect(rifleman.burst.telegraphSeconds).toBe(0.45);
    expect(rifleman.burst.damageMin).toBe(6);
    expect(rifleman.burst.damageMax).toBe(10);
    expect(rifleman.burst.engageRange).toBe(26);

    const rusher = getEnemy('rusher');
    expect(rusher.health).toBe(70);
    expect(rusher.speed).toBe(5.4);
    expect(rusher.melee?.damage).toBe(24);
    expect(rusher.melee?.range).toBe(2.6);

    const heavy = getEnemy('heavy');
    expect(heavy.health).toBe(260);
    expect(heavy.speed).toBe(2.1);
    expect(heavy.burst.damageMin).toBe(10);
    expect(heavy.burst.engageRange).toBe(30);
  });

  it('keeps the difficulty curve and rank thresholds sane', () => {
    const regular = getDifficulty('regular');
    expect(regular.playerHealth).toBe(100);
    expect(regular.regenDelaySeconds).toBe(4.2);
    expect(regular.regenPerSecond).toBe(16);

    // Harder difficulties must be strictly harder on every axis.
    const order = ['recruit', 'regular', 'hardened', 'veteran'].map((id) => getDifficulty(id));
    for (let i = 1; i < order.length; i++) {
      expect(order[i]!.enemyDamageMultiplier).toBeGreaterThan(order[i - 1]!.enemyDamageMultiplier);
      expect(order[i]!.enemyHealthMultiplier).toBeGreaterThanOrEqual(order[i - 1]!.enemyHealthMultiplier);
      expect(order[i]!.regenPerSecond).toBeLessThanOrEqual(order[i - 1]!.regenPerSecond);
    }
    for (let i = 1; i < RANKS.length; i++) {
      expect(RANKS[i]!.minScore).toBeLessThan(RANKS[i - 1]!.minScore);
    }
    expect(PICKUPS.some((p) => p.id === 'medkit')).toBe(true);
    expect(PICKUPS.some((p) => p.id === 'ammo')).toBe(true);
  });

  it('keeps the five-wave prologue composition', () => {
    expect(WAVES).toHaveLength(5);
    expect(WAVES.map((w) => [w.composition.rifleman, w.composition.rusher, w.composition.heavy])).toEqual([
      [6, 0, 0],
      [8, 2, 0],
      [9, 3, 1],
      [10, 4, 2],
      [12, 5, 3],
    ]);
    expect(TOTAL_HOSTILES).toBe(65);
    expect(WAVES.every((w) => w.spawnIntervalSeconds === 0.75)).toBe(true);
    expect(WAVES.every((w) => w.intermissionSeconds === 4.5)).toBe(true);
  });

  it('keeps the plaza map and its gates', () => {
    const map = getMap('plaza_alpha');
    expect(map.bounds).toEqual({ minX: -58, maxX: 58, minZ: -58, maxZ: 58 });
    expect(map.playerSpawn).toEqual({ x: 0, z: 30, yaw: 0 });
    expect(map.gates).toHaveLength(4);
    expect(propsOfKind(map, 'barrel')).toHaveLength(10);
    expect(propsOfKind(map, 'building')).toHaveLength(10);
    expect(map.props.some((p) => p.kind === 'monument')).toBe(true);

    // Nothing that matters is authored outside the playable bounds.
    for (const prop of map.props) {
      expect(prop.x).toBeGreaterThanOrEqual(map.bounds.minX - 4);
      expect(prop.x).toBeLessThanOrEqual(map.bounds.maxX + 4);
      expect(prop.z).toBeGreaterThanOrEqual(map.bounds.minZ - 4);
      expect(prop.z).toBeLessThanOrEqual(map.bounds.maxZ + 4);
    }

    // Spawn must not be inside geometry.
    expect(map.props.some((p) => p.kind === 'building' && p.x === map.playerSpawn.x)).toBe(false);
  });

  it('extraction zone is reachable from the spawn inside the north gate', () => {
    const mission = getMission('m00_prologue');
    const extract = mission.objectives.find((o) => o.kind === 'extract');
    expect(extract?.params.zone).toEqual({ x: 0, z: 56, radius: 6 });
    const map = getMap(mission.mapId);
    const zone = extract!.params.zone!;
    expect(zone.z).toBeLessThanOrEqual(map.bounds.maxZ);
    expect(zone.radius).toBeGreaterThan(2);
  });

  it('has exactly one campaign mission in the M1 vertical slice', () => {
    expect(MISSIONS).toHaveLength(1);
    expect(MISSIONS[0]!.id).toBe('m00_prologue');
    expect(MISSIONS[0]!.checkpoints).toEqual([3]);
  });
});
