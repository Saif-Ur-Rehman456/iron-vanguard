/** Spatialisation helpers: stereo pan for cheap cues, HRTF panner for positioned sources. */
import type { Vec3 } from '@iron/core';

export interface Listener {
  x: number;
  z: number;
  yaw: number;
}

/**
 * Pan value for a world position relative to the listener, -1 (left) .. 1 (right).
 * parity: the prototype used `(dx*rightX + dz*rightZ) / 32` clamped.
 */
export function panFor(pos: Vec3, listener: Listener, falloffMetres = 32): number {
  const dx = pos.x - listener.x;
  const dz = pos.z - listener.z;
  const rightX = Math.cos(listener.yaw);
  const rightZ = -Math.sin(listener.yaw);
  const pan = (dx * rightX + dz * rightZ) / falloffMetres;
  return pan < -1 ? -1 : pan > 1 ? 1 : pan;
}

/** Distance attenuation with a floor so distant gunfire is still audible. */
export function distanceGain(pos: Vec3, listener: Listener, falloffMetres = 60): number {
  const dx = pos.x - listener.x;
  const dz = pos.z - listener.z;
  const distance = Math.hypot(dx, dz);
  const gain = 1 - distance / falloffMetres;
  return gain < 0.12 ? 0.12 : gain > 1 ? 1 : gain;
}

/** Indices of the two ears for HRTF panning (M2: real PannerNode per source). */
export function hrtfPosition(pos: Vec3, listener: Listener): { x: number; y: number; z: number } {
  const dx = pos.x - listener.x;
  const dy = pos.y - 1.7;
  const dz = pos.z - listener.z;
  const cos = Math.cos(-listener.yaw);
  const sin = Math.sin(-listener.yaw);
  // Rotate into listener space so the panner hears what the player hears.
  return { x: dx * cos - dz * sin, y: dy, z: dx * sin + dz * cos };
}
