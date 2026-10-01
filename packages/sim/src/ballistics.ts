/**
 * Hitscan resolution (parity: the prototype's `shoot()` / `enemyFire()`).
 * Enemy hitboxes are resolved in simulation space so results are identical in
 * headless runs and in the browser; the renderer only visualises them.
 *
 * Penetration and projectile flight are M3 work (docs/ROADMAP.md) — the surface
 * table already carries penetrationLoss so the data is in place.
 */
import { clamp, type RayHit, type Vec3, vec3 } from '@iron/core';
import { BARREL_HEIGHT, BARREL_RADIUS } from './collision';
import type { EnemyState, World } from './types';
import type { WeaponDef } from '@iron/content';

export interface ShotHit extends RayHit {
  enemy: EnemyState | null;
  head: boolean;
}

const HITBOX = {
  /** Half extents in metres, scaled by the archetype's render scale. */
  head: { half: 0.17, centerY: 1.75 },
  torso: { halfX: 0.3, halfY: 0.5, halfZ: 0.2, centerY: 1.15 },
} as const;

/** Rays are computed in the enemy's local space so rotation is exact. */
function rayEnemy(enemy: EnemyState, origin: Vec3, dir: Vec3, far: number): { t: number; head: boolean } | null {
  const scale = enemy.def.scale;
  const dx = origin.x - enemy.pos.x;
  const dz = origin.z - enemy.pos.z;
  const cos = Math.cos(-enemy.yaw);
  const sin = Math.sin(-enemy.yaw);
  // Rotate the ray origin and direction into local space (yaw around Y).
  const ox = dx * cos - dz * sin;
  const oz = dx * sin + dz * cos;
  const rx = dir.x * cos - dir.z * sin;
  const rz = dir.x * sin + dir.z * cos;

  const test = (
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    minZ: number,
    maxZ: number,
  ): number | null => {
    let tmin = 0;
    let tmax = far;
    const axis = (o: number, d: number, min: number, max: number): boolean => {
      if (Math.abs(d) < 1e-9) return o >= min && o <= max;
      const inv = 1 / d;
      let t1 = (min - o) * inv;
      let t2 = (max - o) * inv;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      return tmin <= tmax;
    };
    if (!axis(ox, rx, minX, maxX)) return null;
    if (!axis(origin.y, dir.y, minY, maxY)) return null;
    if (!axis(oz, rz, minZ, maxZ)) return null;
    return tmin >= 0 ? tmin : null;
  };

  const headHalf = HITBOX.head.half * scale;
  const headT = test(
    -headHalf,
    headHalf,
    (HITBOX.head.centerY - HITBOX.head.half) * scale,
    (HITBOX.head.centerY + HITBOX.head.half) * scale,
    -headHalf,
    headHalf,
  );
  if (headT !== null) return { t: headT, head: true };

  const torsoT = test(
    -HITBOX.torso.halfX * scale,
    HITBOX.torso.halfX * scale,
    (HITBOX.torso.centerY - HITBOX.torso.halfY) * scale,
    (HITBOX.torso.centerY + HITBOX.torso.halfY) * scale,
    -HITBOX.torso.halfZ * scale,
    HITBOX.torso.halfZ * scale,
  );
  return torsoT !== null ? { t: torsoT, head: false } : null;
}

/** Nearest world/enemy/barrel hit along a ray. `ignoreEnemyId` keeps shots from hitting their owner. */
export function traceShot(
  world: World,
  origin: Vec3,
  dir: Vec3,
  far: number,
  ignoreEnemyId = 0,
): ShotHit | null {
  let best: ShotHit | null = null;

  const worldHit = world.colliders.raycast(origin, dir, far);
  if (worldHit) {
    best = { ...worldHit, enemy: null, head: false };
  }
  const limit = best ? best.distance : far;

  for (const enemy of world.enemies) {
    if (!enemy.alive || enemy.id === ignoreEnemyId) continue;
    const hit = rayEnemy(enemy, origin, dir, limit);
    if (hit && hit.t < (best ? best.distance : Infinity)) {
      const point = vec3(
        origin.x + dir.x * hit.t,
        origin.y + dir.y * hit.t,
        origin.z + dir.z * hit.t,
      );
      best = {
        distance: hit.t,
        point,
        normal: { x: -dir.x, y: -dir.y, z: -dir.z },
        surface: 'flesh',
        entityId: enemy.id,
        group: hit.head ? 'head' : 'torso',
        enemy,
        head: hit.head,
      };
    }
  }

  for (const barrel of world.barrels) {
    if (!barrel.alive) continue;
    const localX = origin.x - barrel.x;
    const localZ = origin.z - barrel.z;
    // Cylinder approximated as an AABB — parity (radius .42 visual, .45 volume).
    const t = rayBox(
      localX,
      origin.y,
      localZ,
      dir.x,
      dir.y,
      dir.z,
      BARREL_RADIUS,
      0,
      BARREL_HEIGHT,
      BARREL_RADIUS,
      best ? best.distance : limit,
    );
    // A barrel is also a movement obstacle, so its faces sit at exactly the
    // same distance as the world hit that represents it. Without a tie-break in
    // the barrel's favour the world hit always won, and a red fuel barrel could
    // never be shot — which silently disabled the whole chain-explosion feature.
    if (t !== null && (!best || t <= best.distance + 1e-4)) {
      const point = vec3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
      best = {
        distance: t,
        point,
        normal: { x: -dir.x, y: -dir.y, z: -dir.z },
        surface: 'metal',
        entityId: -(barrel.id + 1),
        group: 'barrel',
        enemy: null,
        head: false,
      };
    }
  }

  return best;
}

function rayBox(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  hx: number,
  minY: number,
  maxY: number,
  hz: number,
  far: number,
): number | null {
  let tmin = 0;
  let tmax = far;
  const axis = (o: number, d: number, min: number, max: number): boolean => {
    if (Math.abs(d) < 1e-9) return o >= min && o <= max;
    const inv = 1 / d;
    let t1 = (min - o) * inv;
    let t2 = (max - o) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    return tmin <= tmax;
  };
  if (!axis(ox, dx, -hx, hx)) return null;
  if (!axis(oy, dy, minY, maxY)) return null;
  if (!axis(oz, dz, -hz, hz)) return null;
  return tmin >= 0 ? tmin : null;
}

/** Damage after distance falloff (data-driven per weapon). */
export function damageAtDistance(weapon: WeaponDef, baseDamage: number, distance: number): number {
  const { falloffStart, falloffEnd, falloffMinMultiplier } = weapon.ballistics;
  if (distance <= falloffStart) return baseDamage;
  if (distance >= falloffEnd) return baseDamage * falloffMinMultiplier;
  const t = (distance - falloffStart) / (falloffEnd - falloffStart);
  return baseDamage * (1 - t * (1 - falloffMinMultiplier));
}

/**
 * Hit-group damage multiplier.
 *
 * The hitbox model has head and torso only, so limbs are 1x for now;
 * `weapon.limbMultiplier` is carried in the data ready for the per-bone hitboxes
 * M3 adds (docs/ROADMAP.md).
 */
export function hitGroupMultiplier(weapon: WeaponDef, head: boolean): number {
  return head ? weapon.headshotMultiplier : 1;
}

export function clampDamage(damage: number): number {
  return clamp(damage, 0, 10_000);
}
