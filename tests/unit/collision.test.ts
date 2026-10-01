import { describe, expect, it } from 'vitest';
import { createAabbCollisionWorld, footprintOf, obstaclesFromMap } from '@iron/sim';
import { PLAZA_MAP, type MapDef, type PropDef } from '@iron/content';

function syntheticMap(props: PropDef[], bounds = { minX: -20, maxX: 20, minZ: -20, maxZ: 20 }): MapDef {
  return {
    id: 'test_map',
    name: 'TEST',
    bounds,
    playerSpawn: { x: 0, z: 0, yaw: 0 },
    groundSurface: 'concrete',
    props,
    gates: [{ x: 0, z: 20, axis: 'x' }],
    ambient: { fireLight: [0, 0, 0], smokeColumns: [], dustEnabled: false, skylineCount: 0, rockCount: 0, fogDensity: 0 },
  };
}

const origin = { x: 0, y: 1.7, z: 0 };

describe('raycast', () => {
  it('hits a crate face at the right distance and reports its surface', () => {
    const world = createAabbCollisionWorld(syntheticMap([{ kind: 'crate', x: 5, z: 0, size: 1 }]));
    // Chest height: a 1 m crate is only 1 m tall, so an eye-height ray flies over it.
    const hit = world.raycast({ x: 0, y: 0.7, z: 0 }, { x: 1, y: 0, z: 0 }, 20);
    // crate footprint half-extent = size/2 + 0.15 = 0.65 → the near face is at x = 4.35
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeCloseTo(4.35, 5);
    expect(hit!.surface).toBe('wood');
    expect(hit!.point.x).toBeCloseTo(4.35, 4);
    // ...and the same ray at eye height misses it entirely.
    expect(world.raycast(origin, { x: 1, y: 0, z: 0 }, 20)).toBeNull();
  });

  it('returns null when nothing is in the way', () => {
    const world = createAabbCollisionWorld(syntheticMap([{ kind: 'crate', x: 5, z: 0, size: 1 }]));
    expect(world.raycast({ x: 0, y: 0.7, z: 0 }, { x: 0, y: 0, z: 1 }, 20)).toBeNull();
    // and nothing beyond the far plane either
    expect(world.raycast({ x: 0, y: 0.7, z: 0 }, { x: 1, y: 0, z: 0 }, 2)).toBeNull();
  });

  it('hits the ground plane with the map surface', () => {
    const world = createAabbCollisionWorld(syntheticMap([]));
    const hit = world.raycast({ x: 0, y: 2, z: 0 }, { x: 0, y: -1, z: 0 }, 10);
    expect(hit?.surface).toBe('concrete');
    expect(hit?.distance).toBeCloseTo(2, 6);
  });

  it('maps prop kinds to the surface the FX system uses', () => {
    const cases: [PropDef['kind'], string][] = [
      ['crate', 'wood'],
      ['barrel', 'metal'],
      ['sandbags', 'sand'],
      ['jersey', 'concrete'],
      ['wall', 'concrete'],
    ];
    for (const [kind, surface] of cases) {
      const world = createAabbCollisionWorld(syntheticMap([{ kind, x: 4, z: 0, size: 2, depth: 2 }]));
      expect(world.raycast({ x: 0, y: 0.6, z: 0 }, { x: 1, y: 0, z: 0 }, 20)?.surface, kind).toBe(surface);
    }
  });
});

describe('character resolution', () => {
  it('pushes a circle out of geometry it has nudged into', () => {
    const world = createAabbCollisionWorld(syntheticMap([{ kind: 'crate', x: 5, z: 0, size: 1 }]));
    // Overlapping the east face by 0.05 m.
    const pos = { x: 5.6, y: 0, z: 0 };
    expect(world.circleCollides(pos.x, pos.z, 0.5)).toBe(true);
    world.resolve(pos, 0.5);
    expect(world.circleCollides(pos.x, pos.z, 0.5)).toBe(false);
    expect(pos.x).toBeCloseTo(6.15, 3); // 5 + 0.65 + 0.5
  });

  it('escapes along the shortest axis when the centre is inside a box', () => {
    // A hostile spawned (or shoved) inside solid geometry must be able to leave
    // it in one step, not oscillate forever in the middle of a building.
    const world = createAabbCollisionWorld(syntheticMap([{ kind: 'building', x: 0, z: 0, size: 8, depth: 8 }]));
    const pos = { x: 3.6, y: 0, z: 0 };
    world.resolve(pos, 0.5);
    expect(world.circleCollides(pos.x, pos.z, 0.5)).toBe(false);
    expect(pos.x).toBeCloseTo(4.9, 3); // 4 + 0.4 pad + 0.5 radius
  });

  it('reports blocked cells and clamps to map bounds', () => {
    const world = createAabbCollisionWorld(syntheticMap([{ kind: 'building', x: 0, z: -6, size: 8, depth: 8 }]));
    expect(world.xzBlocked(0, -6, 0.5)).toBe(true);
    expect(world.xzBlocked(0, 0, 0.5)).toBe(false);

    const pos = { x: 999, y: 0, z: -999 };
    world.clampToBounds(pos);
    expect(pos.x).toBe(20);
    expect(pos.z).toBe(-20);
  });
});

describe('footprints', () => {
  it('accounts for rotation instead of using an axis-aligned square', () => {
    // Parity defect #5: rotated barriers used to block the wrong space.
    const rotated = footprintOf({ kind: 'jersey', x: 0, z: 0, ry: Math.PI / 2 });
    const straight = footprintOf({ kind: 'jersey', x: 0, z: 0, ry: 0 });
    expect(straight!.hx).toBeCloseTo(1.2, 5);
    expect(straight!.hz).toBeCloseTo(0.28, 5);
    expect(rotated!.hx).toBeCloseTo(0.28, 5);
    expect(rotated!.hz).toBeCloseTo(1.2, 5);
  });

  it('gives every blocking prop kind a footprint and decoration none', () => {
    for (const kind of ['wall', 'building', 'crate', 'barrel', 'jersey', 'sandbags', 'kiosk', 'wreck', 'planter', 'monument', 'firepit', 'lamp', 'pole'] as const) {
      expect(footprintOf({ kind, x: 0, z: 0 }), kind).not.toBeNull();
    }
    for (const kind of ['puddle', 'tire', 'banner'] as const) {
      expect(footprintOf({ kind, x: 0, z: 0 }), kind).toBeNull();
    }
  });

  it('builds a non-trivial obstacle set from the plaza', () => {
    const obstacles = obstaclesFromMap(PLAZA_MAP);
    expect(obstacles.length).toBeGreaterThan(30);
    expect(obstacles.some((o) => o.tag === 'monument')).toBe(true);
    expect(obstacles.some((o) => o.tag === 'building')).toBe(true);
  });
});
