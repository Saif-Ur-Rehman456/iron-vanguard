/** Tiny typed event emitter. Systems talk through this instead of reaching into each other. */

type Listener<T> = (payload: T) => void;

export class Emitter<Events extends Record<string, unknown>> {
  private listeners = new Map<string, Set<Listener<never>>>();

  on<K extends keyof Events & string>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => {
      set?.delete(listener as Listener<never>);
    };
  }

  once<K extends keyof Events & string>(event: K, listener: Listener<Events[K]>): () => void {
    const off = this.on(event, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  emit<K extends keyof Events & string>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) (listener as Listener<Events[K]>)(payload);
  }

  clear(event?: keyof Events & string): void {
    if (event) this.listeners.delete(event);
    else this.listeners.clear();
  }

  listenerCount(event: keyof Events & string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

export function createEmitter<Events extends Record<string, unknown>>(): Emitter<Events> {
  return new Emitter<Events>();
}
