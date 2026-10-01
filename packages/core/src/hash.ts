/**
 * Hashing used for golden-replay determinism checks (ADR-0002).
 * Values are quantised before hashing so cross-machine float noise does not
 * produce false negatives, while real gameplay changes always show up.
 */
import { quantize } from './math.js';
import type { Vec3 } from './types.js';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function fnv1a32(text: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

export function fnv1aMix(hash: number, value: number): number {
  let h = hash >>> 0;
  h ^= value | 0;
  h = Math.imul(h, FNV_PRIME) >>> 0;
  return h >>> 0;
}

export function hashStrings(...parts: readonly (string | number)[]): number {
  let h = FNV_OFFSET;
  for (const part of parts) h = fnv1aMix(h, fnv1a32(String(part)));
  return h >>> 0;
}

export function toHex(hash: number): string {
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export interface HashTrace {
  /** tick -> hash */
  readonly samples: ReadonlyMap<number, string>;
  final: string;
}

export class StateHasher {
  private hash = FNV_OFFSET;
  private fields = 0;

  get fieldCount(): number {
    return this.fields;
  }

  /** Push a labelled numeric/boolean value. Floats are quantised. */
  push(label: string, value: number | boolean): this {
    this.hash = fnv1aMix(this.hash, fnv1a32(label));
    const v = typeof value === 'boolean' ? (value ? 1 : 0) : quantize(value);
    this.hash = fnv1aMix(this.hash, Math.round(v * 1000) | 0);
    this.fields++;
    return this;
  }

  pushVec(label: string, v: Vec3): this {
    this.push(`${label}.x`, v.x);
    this.push(`${label}.y`, v.y);
    this.push(`${label}.z`, v.z);
    return this;
  }

  pushString(label: string, value: string): this {
    this.hash = fnv1aMix(this.hash, fnv1a32(label));
    this.hash = fnv1aMix(this.hash, fnv1a32(value));
    this.fields++;
    return this;
  }

  value(): number {
    return this.hash >>> 0;
  }

  hex(): string {
    return toHex(this.hash);
  }
}
