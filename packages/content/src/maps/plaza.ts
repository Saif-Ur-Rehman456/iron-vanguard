import type { MapDef, PropDef } from '../types';

/**
 * plaza_alpha — parity recreation of the prototype's Al-Kadim Plaza
 * (legacy/callofduty.r128.html, the `map` section).
 *
 * In the prototype every prop was authored in code. Here it is data, so the
 * level editor (apps/editor) and Blender kits (M2) can replace entries one at a
 * time without touching the simulation.
 */

const WALL_HEIGHT = 5; // parity

/** Perimeter walls: gap of +/-8 units at each gate. */
const walls: PropDef[] = [
  { kind: 'wall', x: -34, z: 60, size: 52, depth: 2, height: WALL_HEIGHT },
  { kind: 'wall', x: 34, z: 60, size: 52, depth: 2, height: WALL_HEIGHT },
  { kind: 'wall', x: -34, z: -60, size: 52, depth: 2, height: WALL_HEIGHT },
  { kind: 'wall', x: 34, z: -60, size: 52, depth: 2, height: WALL_HEIGHT },
  { kind: 'wall', x: 60, z: -34, size: 2, depth: 52, height: WALL_HEIGHT },
  { kind: 'wall', x: 60, z: 34, size: 2, depth: 52, height: WALL_HEIGHT },
  { kind: 'wall', x: -60, z: -34, size: 2, depth: 52, height: WALL_HEIGHT },
  { kind: 'wall', x: -60, z: 34, size: 2, depth: 52, height: WALL_HEIGHT },
];

/** Buildings: height 12 unless noted; `damaged` buildings grow rubble in render. */
const buildings: PropDef[] = [
  { kind: 'building', x: -30, z: -26, size: 14, depth: 16, height: 12, variant: 0 },
  { kind: 'building', x: -46, z: -40, size: 12, depth: 22, height: 12, variant: 1, tag: 'damaged' },
  { kind: 'building', x: 30, z: -26, size: 16, depth: 13, height: 12, variant: 1 },
  { kind: 'building', x: 44, z: -42, size: 12, depth: 18, height: 12, variant: 2, tag: 'damaged' },
  { kind: 'building', x: -28, z: 26, size: 12, depth: 10, height: 12, variant: 2 },
  { kind: 'building', x: -44, z: 40, size: 14, depth: 14, height: 12, variant: 0, tag: 'damaged' },
  { kind: 'building', x: 28, z: 28, size: 12, depth: 11, height: 14, variant: 1 },
  { kind: 'building', x: 44, z: 42, size: 10, depth: 16, height: 10, variant: 0 },
  { kind: 'building', x: 2, z: -42, size: 18, depth: 20, height: 12, variant: 2, tag: 'damaged' },
  { kind: 'building', x: -2, z: 42, size: 16, depth: 12, height: 12, variant: 1 },
];

/** Barrels: alternating red/green variants, 30 hp each, chain-explode. */
const barrels: PropDef[] = [
  { kind: 'barrel', x: -8, z: -9, variant: 0 },
  { kind: 'barrel', x: 12, z: 5, variant: 1 },
  { kind: 'barrel', x: -17, z: 9, variant: 0 },
  { kind: 'barrel', x: 21, z: -15, variant: 1 },
  { kind: 'barrel', x: -6, z: 19, variant: 0 },
  { kind: 'barrel', x: 15, z: 16, variant: 1 },
  { kind: 'barrel', x: -27, z: -12, variant: 0 },
  { kind: 'barrel', x: 31, z: 6, variant: 1 },
  { kind: 'barrel', x: -35, z: 26, variant: 0 },
  { kind: 'barrel', x: 26, z: -33, variant: 1 },
];

const cover: PropDef[] = [
  { kind: 'jersey', x: 5, z: 6, ry: 0 },
  { kind: 'jersey', x: -5, z: 6, ry: 0 },
  { kind: 'jersey', x: 6, z: -5, ry: 1.57 },
  { kind: 'jersey', x: -6, z: -5, ry: 1.57 },
  { kind: 'jersey', x: 16, z: 2, ry: 1.2 },
  { kind: 'jersey', x: -16, z: -3, ry: 0.4 },
  { kind: 'jersey', x: 3, z: -16, ry: 0.2 },
  { kind: 'jersey', x: -3, z: 16, ry: -0.3 },
  { kind: 'jersey', x: 20, z: -9, ry: 0 },
  { kind: 'jersey', x: -20, z: 9, ry: 0.9 },
  { kind: 'sandbags', x: 2, z: 56, ry: 0 },
  { kind: 'sandbags', x: -2, z: -56, ry: 0 },
  { kind: 'sandbags', x: 56, z: 2, ry: 1.5708 },
  { kind: 'sandbags', x: -56, z: -2, ry: 1.5708 },
  { kind: 'sandbags', x: 22, z: -20, ry: 0.5 },
  { kind: 'sandbags', x: -22, z: 20, ry: -0.7 },
];

const props: PropDef[] = [
  ...walls,
  ...buildings,
  ...barrels,
  ...cover,
  { kind: 'monument', x: 0, z: 0 },
  { kind: 'crate', x: 6, z: 20, size: 1.15 },
  { kind: 'crate', x: 7.2, z: 20.8, size: 1.05 },
  { kind: 'crate', x: -20, z: -6, size: 1.25 },
  { kind: 'crate', x: 24, z: 14, size: 1.1 },
  { kind: 'wreck', x: 11, z: 9, ry: 0.6 },
  { kind: 'wreck', x: -15, z: 12, ry: -0.9, burning: true },
  { kind: 'wreck', x: 9, z: -15, ry: 2.2 },
  { kind: 'wreck', x: -10, z: -13, ry: 0.25 },
  { kind: 'planter', x: 7, z: 14 },
  { kind: 'planter', x: -7, z: -14 },
  { kind: 'planter', x: 14, z: -7 },
  { kind: 'planter', x: -14, z: 7 },
  { kind: 'kiosk', x: 16, z: -2, ry: 1.5708 },
  { kind: 'kiosk', x: -16, z: 4, ry: -1.5708 },
  { kind: 'lamp', x: 12, z: 2 },
  { kind: 'lamp', x: -12, z: -2 },
  { kind: 'pole', x: 6, z: -30, tag: 'cable' },
  { kind: 'pole', x: 6, z: -12, tag: 'cable' },
  { kind: 'pole', x: -6, z: 12, tag: 'cable' },
  { kind: 'pole', x: -6, z: 30, tag: 'cable' },
  { kind: 'banner', x: 12.6, z: 2, ry: 0, height: 5.2 },
  { kind: 'banner', x: -12.6, z: -2, ry: 0, height: 5.2 },
  { kind: 'banner', x: 6.4, z: -30, ry: 1.5708, height: 5.2 },
  { kind: 'puddle', x: -6, z: 8, size: 2.6 },
  { kind: 'puddle', x: 10, z: -6, size: 1.8 },
  { kind: 'puddle', x: -12, z: -10, size: 2.2 },
  { kind: 'puddle', x: 4, z: 16, size: 1.5 },
  { kind: 'tire', x: 8, z: 55 },
  { kind: 'tire', x: -8, z: 55 },
  { kind: 'tire', x: 55, z: 8 },
  { kind: 'tire', x: -55, z: -8 },
  { kind: 'tire', x: 12, z: -52 },
  { kind: 'firepit', x: -21, z: 16.5 },
];

export const PLAZA_MAP: MapDef = {
  id: 'plaza_alpha',
  name: 'AL KADIM PLAZA',
  bounds: { minX: -58, maxX: 58, minZ: -58, maxZ: 58 }, // parity: player clamp
  playerSpawn: { x: 0, z: 30, yaw: 0 }, // parity
  groundSurface: 'concrete',
  props,
  gates: [
    { x: 0, z: 60, axis: 'x' },
    { x: 0, z: -60, axis: 'x' },
    { x: 60, z: 0, axis: 'z' },
    { x: -60, z: 0, axis: 'z' },
  ],
  ambient: {
    fireLight: [-21, 1.2, 16.5], // parity
    smokeColumns: [
      [-50, 0.5, -50],
      [52, 0.5, 40],
      [-15, 1.5, 12.5],
      [48, 0.5, -46],
      [-46, 0.5, 44],
    ],
    dustEnabled: true,
    skylineCount: 16, // parity
    rockCount: 50, // parity
    fogDensity: 0.0125, // parity
  },
};

export const MAPS: readonly MapDef[] = [PLAZA_MAP];

export function getMap(id: string): MapDef {
  const map = MAPS.find((m) => m.id === id);
  if (!map) throw new Error(`unknown map id: ${id}`);
  return map;
}

export function propsOfKind(map: MapDef, kind: PropDef['kind']): PropDef[] {
  return map.props.filter((p) => p.kind === kind);
}
