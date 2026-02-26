type EventHandler<T> = (data: T) => void;

/**
 * Lightweight typed event emitter (no Node.js dependency).
 * Generic parameter T maps event names to payload types.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class TypedEventEmitter<T extends Record<string, any>> {
  private handlers = new Map<keyof T, Set<EventHandler<unknown>>>();

  on<K extends keyof T & string>(event: K, handler: EventHandler<T[K]>): this {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as EventHandler<unknown>);
    return this;
  }

  off<K extends keyof T & string>(event: K, handler: EventHandler<T[K]>): this {
    this.handlers.get(event)?.delete(handler as EventHandler<unknown>);
    return this;
  }

  protected emit<K extends keyof T & string>(event: K, data: T[K]): void {
    const set = this.handlers.get(event);
    if (set) {
      for (const handler of set) {
        handler(data);
      }
    }
  }

  removeAllListeners(): void {
    this.handlers.clear();
  }
}
