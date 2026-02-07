/**
 * A simple LRU (Least Recently Used) cache backed by a Map.
 *
 * Uses the fact that JS Map iteration order is insertion order.
 * On `get`, the entry is re-inserted so it moves to the end (most recent).
 * On `set`, if the map exceeds `maxSize`, the oldest entry is evicted.
 */
export class LruMap<K, V> {
  private readonly _map = new Map<K, V>();
  private readonly _maxSize: number;

  constructor(maxSize: number) {
    if (maxSize < 1) throw new Error("LruMap maxSize must be >= 1");
    this._maxSize = maxSize;
  }

  get size(): number {
    return this._map.size;
  }

  has(key: K): boolean {
    return this._map.has(key);
  }

  get(key: K): V | undefined {
    const value = this._map.get(key);
    if (value === undefined) return undefined;

    // Move to end (most recently used)
    this._map.delete(key);
    this._map.set(key, value);
    return value;
  }

  set(key: K, value: V): this {
    // If key already exists, delete first so it moves to end
    if (this._map.has(key)) {
      this._map.delete(key);
    }

    this._map.set(key, value);

    // Evict oldest entries if over capacity
    while (this._map.size > this._maxSize) {
      const oldest = this._map.keys().next().value;
      if (oldest !== undefined) {
        this._map.delete(oldest);
      }
    }

    return this;
  }

  delete(key: K): boolean {
    return this._map.delete(key);
  }

  clear(): void {
    this._map.clear();
  }
}
