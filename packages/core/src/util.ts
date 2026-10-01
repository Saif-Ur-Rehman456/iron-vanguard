/** Asserts, id allocation and pooling. Deliberately console-free (sim purity). */

export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`invariant: ${message}`);
}

export function assertNever(value: never, context = 'value'): never {
  throw new Error(`unexpected ${context}: ${JSON.stringify(value)}`);
}

export function createIdAllocator(prefix = 'e'): () => string {
  let next = 1;
  return () => `${prefix}${next++}`;
}

export interface Pool<T> {
  acquire(): T;
  release(item: T): void;
  readonly live: number;
  readonly free: number;
  forEachLive(fn: (item: T) => void): void;
}

/**
 * Fixed-capacity pool. Used by every FX system so the frame loop never
 * allocates (the prototype allocated a material per particle — see
 * legacy/PARITY_NOTES.md).
 */
export function createPool<T>(factory: () => T, capacity: number): Pool<T> {
  const free: T[] = Array.from({ length: capacity }, factory);
  const live: T[] = [];
  return {
    acquire(): T {
      // Pool exhausted: recycle the oldest live entry rather than growing.
      // It must be re-added to `live`, or the pool would silently leak entries
      // and `live` would drift away from the number of items in circulation.
      const item = free.pop() ?? live.shift();
      if (item === undefined) throw new Error('pool exhausted with no live entries');
      live.push(item);
      return item;
    },
    release(item: T): void {
      const i = live.indexOf(item);
      if (i >= 0) live.splice(i, 1);
      free.push(item);
    },
    get live() {
      return live.length;
    },
    get free() {
      return free.length;
    },
    forEachLive(fn: (item: T) => void): void {
      for (const item of live) fn(item);
    },
  };
}
