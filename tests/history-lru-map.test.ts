import { describe, it, expect } from "vitest";
import { LruMap } from "../src/history/lru-map";

describe("LruMap", () => {
  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------
  it("throws on maxSize < 1", () => {
    expect(() => new LruMap(0)).toThrow("maxSize must be >= 1");
    expect(() => new LruMap(-5)).toThrow("maxSize must be >= 1");
  });

  it("creates an empty map", () => {
    const lru = new LruMap<string, number>(10);
    expect(lru.size).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Basic get / set / has
  // ---------------------------------------------------------------------------
  it("stores and retrieves a value", () => {
    const lru = new LruMap<string, number>(5);
    lru.set("a", 1);
    expect(lru.get("a")).toBe(1);
    expect(lru.has("a")).toBe(true);
    expect(lru.size).toBe(1);
  });

  it("returns undefined for missing keys", () => {
    const lru = new LruMap<string, number>(5);
    expect(lru.get("missing")).toBeUndefined();
    expect(lru.has("missing")).toBe(false);
  });

  it("overwrites existing keys", () => {
    const lru = new LruMap<string, number>(5);
    lru.set("a", 1);
    lru.set("a", 2);
    expect(lru.get("a")).toBe(2);
    expect(lru.size).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Eviction
  // ---------------------------------------------------------------------------
  it("evicts the oldest entry when capacity is exceeded", () => {
    const lru = new LruMap<string, number>(3);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("c", 3);
    expect(lru.size).toBe(3);

    // Adding a 4th should evict "a"
    lru.set("d", 4);
    expect(lru.size).toBe(3);
    expect(lru.has("a")).toBe(false);
    expect(lru.get("b")).toBe(2);
    expect(lru.get("c")).toBe(3);
    expect(lru.get("d")).toBe(4);
  });

  it("accessing a key makes it recently used (not evicted)", () => {
    const lru = new LruMap<string, number>(3);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("c", 3);

    // Access "a" so it becomes most recently used
    lru.get("a");

    // Now add "d" — should evict "b" (oldest untouched), not "a"
    lru.set("d", 4);
    expect(lru.has("a")).toBe(true);
    expect(lru.has("b")).toBe(false);
    expect(lru.has("c")).toBe(true);
    expect(lru.has("d")).toBe(true);
  });

  it("overwriting a key refreshes its position", () => {
    const lru = new LruMap<string, number>(3);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("c", 3);

    // Overwrite "a" — moves it to end
    lru.set("a", 10);

    // Add "d" — should evict "b"
    lru.set("d", 4);
    expect(lru.has("a")).toBe(true);
    expect(lru.get("a")).toBe(10);
    expect(lru.has("b")).toBe(false);
  });

  it("evicts multiple entries if maxSize is 1", () => {
    const lru = new LruMap<string, number>(1);
    lru.set("a", 1);
    lru.set("b", 2);
    expect(lru.size).toBe(1);
    expect(lru.has("a")).toBe(false);
    expect(lru.get("b")).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // delete / clear
  // ---------------------------------------------------------------------------
  it("deletes a key", () => {
    const lru = new LruMap<string, number>(5);
    lru.set("a", 1);
    lru.set("b", 2);
    expect(lru.delete("a")).toBe(true);
    expect(lru.has("a")).toBe(false);
    expect(lru.size).toBe(1);
  });

  it("delete returns false for missing key", () => {
    const lru = new LruMap<string, number>(5);
    expect(lru.delete("missing")).toBe(false);
  });

  it("clears all entries", () => {
    const lru = new LruMap<string, number>(5);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("c", 3);
    lru.clear();
    expect(lru.size).toBe(0);
    expect(lru.has("a")).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // set() returns this (chainable)
  // ---------------------------------------------------------------------------
  it("set returns this for chaining", () => {
    const lru = new LruMap<string, number>(5);
    const result = lru.set("a", 1);
    expect(result).toBe(lru);
  });

  // ---------------------------------------------------------------------------
  // Stress / larger capacity
  // ---------------------------------------------------------------------------
  it("handles many insertions without exceeding capacity", () => {
    const cap = 50;
    const lru = new LruMap<number, number>(cap);

    for (let i = 0; i < 1000; i++) {
      lru.set(i, i * 10);
    }

    expect(lru.size).toBe(cap);

    // Only the last `cap` entries should remain
    for (let i = 950; i < 1000; i++) {
      expect(lru.get(i)).toBe(i * 10);
    }

    // Early entries should be gone
    expect(lru.has(0)).toBe(false);
    expect(lru.has(949)).toBe(false);
  });
});
