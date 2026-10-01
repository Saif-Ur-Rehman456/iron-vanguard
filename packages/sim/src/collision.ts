/**
 * Collision provider.
 *
 * The simulation only ever talks to this interface, so the collision backend can
 * be swapped: `createAabbCollisionWorld` (below) is the dependency-free,
 * deterministic default used by tests and headless runs, and M2 adds a
 * three-mesh-bvh provider built from real level meshes in @iron/render.
 *
 * Fixes a prototype defect: rotated props were registered as axis-aligned
 * squares, so barriers blocked the wrong space (legacy/PARITY_NOTES.md #5).
 */
import { clamp, type Obstacle, type RayHit, type Vec3 } from '@iron/core';
import type { MapDef, PropDef } from '@iron/content';

export interface CollisionWorld {
  readonly obstacles: readonly Obstacle[];
  /** Ray against world geometry only; `far` is in metres. */
  raycast(origin: Vec3, dir: Vec3, far: number): RayHit | null;
  circleCollides(x: number, z: number, radius: number): boolean;
  /** Push a character circle out of geometry (step-and-slide). */
  resolve(pos: Vec3, radius: number): void;
  clampToBounds(pos: Vec3): void;
  xzBlocked(x: number, z: number, radius: number): boolean;
}

/**
 * Barrel size, shared by collision and ballistics.
 *
 * These must be the same number. When the movement footprint was larger than
 * the shootable box, every shot at a barrel landed on its own collision box: the
 * round hit the world, dealt no damage, and the barrel-chain feature was dead
 * code that no test could see.
 */
export const BARREL_RADIUS = 0.45;
export const BARREL_HEIGHT = 1.15;

/** Axis-aligned footprint of a possibly rotated box. */
function rotatedFootprint(halfW: number, halfD: number, ry: number): { hx: number; hz: number } {
  const c = Math.abs(Math.cos(ry));
  const s = Math.abs(Math.sin(ry));
  return { hx: halfW * c + halfD * s, hz: halfW * s + halfD * c };
}

/** Footprint rules per prop kind. Values mirror the prototype's addObstacle calls. */
export function footprintOf(prop: PropDef): Obstacle | null {
  const ry = prop.ry ?? 0;
  switch (prop.kind) {
    case 'wall': {
      const w = prop.size ?? 2;
      const d = prop.depth ?? 2;
      return { x: prop.x, z: prop.z, hx: w / 2, hz: d / 2, height: prop.height ?? 5, tag: prop.kind };
    }
    case 'building': {
      const w = (prop.size ?? 12) / 2 + 0.4;
      const d = (prop.depth ?? 12) / 2 + 0.4;
      return { x: prop.x, z: prop.z, hx: w, hz: d, height: prop.height ?? 12, tag: prop.kind };
    }
    case 'crate': {
      const h = (prop.size ?? 1.2) / 2 + 0.15;
      return { x: prop.x, z: prop.z, hx: h, hz: h, height: prop.size ?? 1.2, tag: prop.kind };
    }
    case 'barrel':
      return {
        x: prop.x,
        z: prop.z,
        hx: BARREL_RADIUS,
        hz: BARREL_RADIUS,
        height: BARREL_HEIGHT,
        tag: prop.kind,
      };
    case 'jersey': {
      const f = rotatedFootprint(1.2, 0.28, ry);
      return { x: prop.x, z: prop.z, hx: f.hx, hz: f.hz, height: 0.95, tag: prop.kind };
    }
    case 'sandbags': {
      const f = rotatedFootprint(3, 0.7, ry);
      return { x: prop.x, z: prop.z, hx: f.hx, hz: f.hz, height: 1, tag: prop.kind };
    }
    case 'kiosk': {
      const f = rotatedFootprint(1.5, 1.4, ry);
      return { x: prop.x, z: prop.z, hx: f.hx, hz: f.hz, height: 2.6, tag: prop.kind };
    }
    case 'wreck': {
      const f = rotatedFootprint(2.3, 2.3, ry);
      return { x: prop.x, z: prop.z, hx: f.hx, hz: f.hz, height: 1.9, tag: prop.kind };
    }
    case 'planter':
      return { x: prop.x, z: prop.z, hx: 0.9, hz: 0.9, height: 0.8, tag: prop.kind };
    case 'monument':
      return { x: prop.x, z: prop.z, hx: 4.2, hz: 4.2, height: 8.5, tag: prop.kind };
    case 'firepit':
      return { x: prop.x, z: prop.z, hx: 0.9, hz: 0.9, height: 1.1, tag: prop.kind };
    case 'lamp':
    case 'pole':
      return { x: prop.x, z: prop.z, hx: 0.3, hz: 0.3, height: 5, tag: prop.kind };
    // Decorative only: tires, puddles, banners, rocks, distant skyline.
    default:
      return null;
  }
}

export function obstaclesFromMap(map: MapDef): Obstacle[] {
  const out: Obstacle[] = [];
  for (const prop of map.props) {
    const obstacle = footprintOf(prop);
    if (obstacle) out.push(obstacle);
  }
  return out;
}

/** Slab test against an AABB with its base at y=0. */
function rayAabb(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number,
  far: number,
): number | null {
  let tmin = 0;
  let tmax = far;

  const axis = (origin: number, dir: number, min: number, max: number): boolean => {
    if (Math.abs(dir) < 1e-9) return origin >= min && origin <= max;
    const inv = 1 / dir;
    let t1 = (min - origin) * inv;
    let t2 = (max - origin) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    return tmin <= tmax;
  };

  if (!axis(ox, dx, minX, maxX)) return null;
  if (!axis(oy, dy, minY, maxY)) return null;
  if (!axis(oz, dz, minZ, maxZ)) return null;
  return tmin >= 0 ? tmin : null;
}

export function createAabbCollisionWorld(map: MapDef, extra: readonly Obstacle[] = []): CollisionWorld {
  const obstacles: Obstacle[] = [...obstaclesFromMap(map), ...extra];

  // Uniform grid broadphase. The prototype tested every obstacle for every
  // entity every frame; bucketing by cell keeps per-tick cost flat as maps grow.
  const CELL = 10;
  const grid = new Map<string, number[]>();
  const cellKey = (cx: number, cz: number): string => `${cx}:${cz}`;
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i]!;
    const minX = Math.floor((o.x - o.hx) / CELL);
    const maxX = Math.floor((o.x + o.hx) / CELL);
    const minZ = Math.floor((o.z - o.hz) / CELL);
    const maxZ = Math.floor((o.z + o.hz) / CELL);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const key = cellKey(cx, cz);
        const bucket = grid.get(key);
        if (bucket) bucket.push(i);
        else grid.set(key, [i]);
      }
    }
  }

  const nearby = (x: number, z: number, radius: number, out: number[]): number[] => {
    out.length = 0;
    const minX = Math.floor((x - radius) / CELL);
    const maxX = Math.floor((x + radius) / CELL);
    const minZ = Math.floor((z - radius) / CELL);
    const maxZ = Math.floor((z + radius) / CELL);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const bucket = grid.get(cellKey(cx, cz));
        if (!bucket) continue;
        for (const index of bucket) if (!out.includes(index)) out.push(index);
      }
    }
    return out;
  };

  const scratch: number[] = [];
  const candidate = (o: Obstacle, radius: number, x: number, z: number): boolean => {
    const nx = clamp(x, o.x - o.hx, o.x + o.hx);
    const nz = clamp(z, o.z - o.hz, o.z + o.hz);
    const dx = x - nx;
    const dz = z - nz;
    return dx * dx + dz * dz < radius * radius;
  };

  const worldHit = (origin: Vec3, dir: Vec3, far: number): RayHit | null => {
    let bestT = far;
    let best: Obstacle | null = null;

    // Cheap slab prefilter: obstacles outside the ray's bounding box cannot be hit.
    const endX = origin.x + dir.x * far;
    const endZ = origin.z + dir.z * far;
    const boxMinX = Math.min(origin.x, endX);
    const boxMaxX = Math.max(origin.x, endX);
    const boxMinZ = Math.min(origin.z, endZ);
    const boxMaxZ = Math.max(origin.z, endZ);

    // Ground plane at y = 0.
    if (dir.y < -1e-6) {
      const t = -origin.y / dir.y;
      if (t >= 0 && t < bestT) {
        // Ground wins outright: `best` stays null, which the caller never sees
        // because this branch returns.
        return {
          distance: t,
          point: { x: origin.x + dir.x * t, y: 0, z: origin.z + dir.z * t },
          normal: { x: 0, y: 1, z: 0 },
          surface: map.groundSurface,
          entityId: 0,
          group: 'world',
        };
      }
    }

    for (const o of obstacles) {
      if (o.x + o.hx < boxMinX || o.x - o.hx > boxMaxX) continue;
      if (o.z + o.hz < boxMinZ || o.z - o.hz > boxMaxZ) continue;
      const height = o.height ?? 6;
      const t = rayAabb(
        origin.x,
        origin.y,
        origin.z,
        dir.x,
        dir.y,
        dir.z,
        o.x - o.hx,
        o.x + o.hx,
        0,
        height,
        o.z - o.hz,
        o.z + o.hz,
        bestT,
      );
      if (t !== null && t < bestT) {
        bestT = t;
        best = o;
      }
    }

    if (!best) return null;
    const point: Vec3 = {
      x: origin.x + dir.x * bestT,
      y: origin.y + dir.y * bestT,
      z: origin.z + dir.z * bestT,
    };
    return {
      distance: bestT,
      point,
      normal: surfaceNormal(best, point),
      surface: surfaceForTag(best.tag),
      entityId: 0,
      group: 'world',
    };
  };

  const xzBlocked = (x: number, z: number, radius: number): boolean => {
    const indices = nearby(x, z, radius + 1, scratch);
    for (const index of indices) {
      if (candidate(obstacles[index]!, radius, x, z)) return true;
    }
    return false;
  };

  return {
    obstacles,
    raycast: worldHit,
    circleCollides: xzBlocked,
    xzBlocked,
    resolve(pos: Vec3, radius: number): void {
      // Three passes: a push can move a body into a neighbouring cell's obstacle.
      for (let pass = 0; pass < 3; pass++) {
        const indices = nearby(pos.x, pos.z, radius + 1, scratch);
        for (const index of indices) {
          const o = obstacles[index]!;
          const nx = clamp(pos.x, o.x - o.hx, o.x + o.hx);
          const nz = clamp(pos.z, o.z - o.hz, o.z + o.hz);
          const dx = pos.x - nx;
          const dz = pos.z - nz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= radius * radius) continue;

          if (d2 < 1e-9) {
            // The centre is inside the box, so "push to the nearest face" is
            // meaningless — escape along the axis of least penetration instead.
            // Without this, a body spawned inside a building could never leave
            // it (the old code picked +X and oscillated in place).
            const toWest = pos.x - (o.x - o.hx);
            const toEast = o.x + o.hx - pos.x;
            const toSouth = pos.z - (o.z - o.hz);
            const toNorth = o.z + o.hz - pos.z;
            const least = Math.min(toWest, toEast, toSouth, toNorth);
            if (least === toWest) pos.x = o.x - o.hx - radius;
            else if (least === toEast) pos.x = o.x + o.hx + radius;
            else if (least === toSouth) pos.z = o.z - o.hz - radius;
            else pos.z = o.z + o.hz + radius;
            continue;
          }

          const d = Math.sqrt(d2);
          pos.x += (dx / d) * (radius - d);
          pos.z += (dz / d) * (radius - d);
        }
      }
      this.clampToBounds(pos);
    },
    clampToBounds(pos: Vec3): void {
      pos.x = clamp(pos.x, map.bounds.minX, map.bounds.maxX);
      pos.z = clamp(pos.z, map.bounds.minZ, map.bounds.maxZ);
    },
  };
}

function surfaceForTag(tag: string | undefined): string {
  switch (tag) {
    case 'crate':
      return 'wood';
    case 'barrel':
    case 'kiosk':
    case 'wreck':
    case 'lamp':
    case 'pole':
      return 'metal';
    case 'sandbags':
      return 'sand';
    case 'jersey':
    case 'monument':
    case 'wall':
    case 'building':
    case 'planter':
      return 'concrete';
    default:
      return 'concrete';
  }
}

function surfaceNormal(o: Obstacle, point: Vec3): Vec3 {
  const eps = 1e-4;
  if (Math.abs(point.x - (o.x - o.hx)) < eps) return { x: -1, y: 0, z: 0 };
  if (Math.abs(point.x - (o.x + o.hx)) < eps) return { x: 1, y: 0, z: 0 };
  if (Math.abs(point.z - (o.z - o.hz)) < eps) return { x: 0, y: 0, z: -1 };
  if (Math.abs(point.z - (o.z + o.hz)) < eps) return { x: 0, y: 0, z: 1 };
  return { x: 0, y: 1, z: 0 };
}
