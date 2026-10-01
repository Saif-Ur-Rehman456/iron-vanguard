/** Scalar maths. Pure, allocation-free, deterministic. */

export const TAU = Math.PI * 2;
export const HALF_PI = Math.PI / 2;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function saturate(v: number): number {
  return clamp(v, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function invLerp(a: number, b: number, v: number): number {
  return b === a ? 0 : (v - a) / (b - a);
}

/** Frame-rate independent exponential approach (the only smoothing we use). */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

export function smoothstep(t: number): number {
  const x = saturate(t);
  return x * x * (3 - 2 * x);
}

export function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

export function moveTowards(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + sign(d) * maxDelta;
}

export function roundTo(v: number, step: number): number {
  return step <= 0 ? v : Math.round(v / step) * step;
}

/**
 * Quantised value used for state hashing. 1e-3 keeps replay comparison stable
 * across the tiny float differences browsers introduce (see ADR-0002).
 */
export function quantize(v: number, step = 1e-3): number {
  return roundTo(v, step);
}

export function wrapAngle(a: number): number {
  let x = a % TAU;
  if (x > Math.PI) x -= TAU;
  if (x < -Math.PI) x += TAU;
  return x;
}

export function shortestAngle(from: number, to: number): number {
  return wrapAngle(to - from);
}

export function approx(a: number, b: number, eps = 1e-4): boolean {
  return Math.abs(a - b) <= eps;
}

export function yawFromDirection(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}
