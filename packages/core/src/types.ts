/** Shared primitive types used across core, sim and content. */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Axis-aligned footprint obstacle used by the default collision provider. */
export interface Obstacle {
  x: number;
  z: number;
  hx: number;
  hz: number;
  /** Optional: how tall the obstacle is (0 = full height wall). */
  height?: number;
  /** Free-form label for debug draw and tooling. */
  tag?: string;
}

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

export interface RayHit {
  /** Distance along the ray. */
  distance: number;
  point: Vec3;
  normal: Vec3;
  /** Surface material id, resolved through content/surfaces.ts. */
  surface: string;
  /** Entity id when the hit is an entity, else 0. */
  entityId: number;
  /** Hit group name: 'head' | 'torso' | 'limb' | 'world'. */
  group: string;
}
