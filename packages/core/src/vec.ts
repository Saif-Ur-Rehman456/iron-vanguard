/**
 * Minimal mutable 3-component vector maths.
 * Deliberately not three.js: the simulation must stay engine-free (ADR-0002),
 * and all operations write into a caller-owned `out` to avoid per-tick garbage.
 */
import type { Vec3 } from './types';

export type { Vec3 };

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function copy(out: Vec3, a: Vec3): Vec3 {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

export function clone(a: Vec3): Vec3 {
  return { x: a.x, y: a.y, z: a.z };
}

export function add(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  return set(out, a.x + b.x, a.y + b.y, a.z + b.z);
}

export function sub(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  return set(out, a.x - b.x, a.y - b.y, a.z - b.z);
}

export function scale(out: Vec3, a: Vec3, s: number): Vec3 {
  return set(out, a.x * s, a.y * s, a.z * s);
}

export function addScaled(out: Vec3, a: Vec3, b: Vec3, s: number): Vec3 {
  return set(out, a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
}

export function mul(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  return set(out, a.x * b.x, a.y * b.y, a.z * b.z);
}

export function lenSq(a: Vec3): number {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function len(a: Vec3): number {
  return Math.sqrt(lenSq(a));
}

export function distSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function dist(a: Vec3, b: Vec3): number {
  return Math.sqrt(distSq(a, b));
}

export function distSqXZ(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function distXZ(a: Vec3, b: Vec3): number {
  return Math.sqrt(distSqXZ(a, b));
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  return set(out, x, y, z);
}

export function normalize(out: Vec3, a: Vec3): Vec3 {
  const l = len(a);
  if (l < 1e-9) return set(out, 0, 0, 0);
  return scale(out, a, 1 / l);
}

export function normalizeXZ(out: Vec3, a: Vec3): Vec3 {
  const l = Math.hypot(a.x, a.z);
  if (l < 1e-9) return set(out, 0, 0, 0);
  return set(out, a.x / l, 0, a.z / l);
}

export function lerpVec(out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
  return set(out, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
}

export function isZero(a: Vec3, eps = 1e-9): boolean {
  return Math.abs(a.x) < eps && Math.abs(a.y) < eps && Math.abs(a.z) < eps;
}
