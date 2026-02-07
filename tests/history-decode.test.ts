import { describe, it, expect } from "vitest";
import { histEntityId, histState, histAttributes, histTimestampMs } from "../src/history/decode";

// ---------------------------------------------------------------------------
// histEntityId
// ---------------------------------------------------------------------------
describe("histEntityId", () => {
  it("reads entity_id (normal format)", () => {
    expect(histEntityId({ entity_id: "sensor.temp" })).toBe("sensor.temp");
  });

  it("reads e (minimal_response format)", () => {
    expect(histEntityId({ e: "sensor.temp" })).toBe("sensor.temp");
  });

  it("reads id (alternate format)", () => {
    expect(histEntityId({ id: "sensor.temp" })).toBe("sensor.temp");
  });

  it("prefers entity_id over e over id", () => {
    expect(histEntityId({ entity_id: "a", e: "b", id: "c" })).toBe("a");
    expect(histEntityId({ e: "b", id: "c" })).toBe("b");
  });

  it("returns undefined when no key present", () => {
    expect(histEntityId({ state: "on" })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// histState
// ---------------------------------------------------------------------------
describe("histState", () => {
  it("reads state (normal format)", () => {
    expect(histState({ state: "22.5" })).toBe("22.5");
  });

  it("reads s (minimal_response format)", () => {
    expect(histState({ s: "on" })).toBe("on");
  });

  it("reads st (alternate format)", () => {
    expect(histState({ st: "off" })).toBe("off");
  });

  it("prefers state over s over st", () => {
    expect(histState({ state: "a", s: "b", st: "c" })).toBe("a");
    expect(histState({ s: "b", st: "c" })).toBe("b");
  });

  it("returns undefined when no key present", () => {
    expect(histState({ entity_id: "sensor.x" })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// histAttributes
// ---------------------------------------------------------------------------
describe("histAttributes", () => {
  it("reads attributes (normal format)", () => {
    const attrs = { friendly_name: "Temp", unit: "°C" };
    expect(histAttributes({ attributes: attrs })).toEqual(attrs);
  });

  it("reads a (minimal_response format)", () => {
    const attrs = { friendly_name: "Foo" };
    expect(histAttributes({ a: attrs })).toEqual(attrs);
  });

  it("reads attr (alternate format)", () => {
    const attrs = { unit: "W" };
    expect(histAttributes({ attr: attrs })).toEqual(attrs);
  });

  it("returns undefined for non-object attributes", () => {
    expect(histAttributes({ attributes: "not-an-object" })).toBeUndefined();
    expect(histAttributes({ attributes: 42 })).toBeUndefined();
    expect(histAttributes({ attributes: null })).toBeUndefined();
  });

  it("returns undefined when no key present", () => {
    expect(histAttributes({ state: "on" })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// histTimestampMs
// ---------------------------------------------------------------------------
describe("histTimestampMs", () => {
  it("parses ISO string from last_changed", () => {
    const ts = histTimestampMs({ last_changed: "2026-01-15T12:00:00.000Z" });
    expect(ts).toBe(Date.parse("2026-01-15T12:00:00.000Z"));
  });

  it("parses ISO string from last_updated", () => {
    const ts = histTimestampMs({ last_updated: "2026-01-15T12:00:00.000Z" });
    expect(ts).toBe(Date.parse("2026-01-15T12:00:00.000Z"));
  });

  it("reads lc (minimal_response)", () => {
    const ts = histTimestampMs({ lc: "2026-01-15T12:00:00.000Z" });
    expect(ts).toBe(Date.parse("2026-01-15T12:00:00.000Z"));
  });

  it("reads lu (minimal_response)", () => {
    const ts = histTimestampMs({ lu: "2026-01-15T12:00:00.000Z" });
    expect(ts).toBe(Date.parse("2026-01-15T12:00:00.000Z"));
  });

  it("reads numeric timestamp in milliseconds", () => {
    const ms = 1705312800000; // > 1e12, treated as ms
    expect(histTimestampMs({ last_changed: ms })).toBe(ms);
  });

  it("reads numeric timestamp in seconds (auto-converts to ms)", () => {
    const sec = 1705312800; // < 1e12, treated as seconds
    expect(histTimestampMs({ last_changed: sec })).toBe(sec * 1000);
  });

  it("reads ts key", () => {
    expect(histTimestampMs({ ts: 1705312800000 })).toBe(1705312800000);
  });

  it("reads t key", () => {
    expect(histTimestampMs({ t: "2026-01-15T12:00:00.000Z" })).toBe(
      Date.parse("2026-01-15T12:00:00.000Z"),
    );
  });

  it("reads time_fired key", () => {
    expect(histTimestampMs({ time_fired: "2026-01-15T12:00:00.000Z" })).toBe(
      Date.parse("2026-01-15T12:00:00.000Z"),
    );
  });

  it("prefers last_changed over other keys", () => {
    const ts = histTimestampMs({
      last_changed: "2026-01-15T12:00:00.000Z",
      lc: "2025-01-01T00:00:00.000Z",
    });
    expect(ts).toBe(Date.parse("2026-01-15T12:00:00.000Z"));
  });

  it("returns undefined when no timestamp key", () => {
    expect(histTimestampMs({ entity_id: "sensor.x", state: "42" })).toBeUndefined();
  });

  it("returns undefined for invalid date string", () => {
    expect(histTimestampMs({ last_changed: "not-a-date" })).toBeUndefined();
  });

  it("returns undefined for NaN numeric", () => {
    expect(histTimestampMs({ last_changed: NaN })).toBeUndefined();
  });

  it("returns undefined for Infinity", () => {
    expect(histTimestampMs({ last_changed: Infinity })).toBeUndefined();
  });
});
