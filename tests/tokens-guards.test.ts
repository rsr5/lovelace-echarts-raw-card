import { describe, it, expect } from "vitest";
import {
  isDataGenerator,
  isHistoryGenerator,
  isStatisticsGenerator,
  isTokenObject,
  containsHistoryToken,
} from "../src/tokens/guards";

// ---------------------------------------------------------------------------
// isDataGenerator
// ---------------------------------------------------------------------------
describe("isDataGenerator", () => {
  it("returns true for a valid $data object", () => {
    expect(isDataGenerator({ $data: { entities: ["sensor.foo"] } })).toBe(true);
  });

  it("returns true even if $data value is empty", () => {
    expect(isDataGenerator({ $data: {} })).toBe(true);
  });

  it("returns false for null / undefined / primitives", () => {
    expect(isDataGenerator(null)).toBe(false);
    expect(isDataGenerator(undefined)).toBe(false);
    expect(isDataGenerator(0)).toBe(false);
    expect(isDataGenerator("")).toBe(false);
    expect(isDataGenerator(true)).toBe(false);
  });

  it("returns false for arrays (even with $data element)", () => {
    expect(isDataGenerator([{ $data: {} }])).toBe(false);
  });

  it("returns false for objects without $data key", () => {
    expect(isDataGenerator({ $entity: "sensor.foo" })).toBe(false);
    expect(isDataGenerator({ $history: {} })).toBe(false);
    expect(isDataGenerator({ foo: "bar" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isHistoryGenerator
// ---------------------------------------------------------------------------
describe("isHistoryGenerator", () => {
  it("returns true for a valid $history object", () => {
    expect(isHistoryGenerator({ $history: { entities: ["sensor.foo"], hours: 24 } })).toBe(true);
  });

  it("returns false for null / undefined / primitives", () => {
    expect(isHistoryGenerator(null)).toBe(false);
    expect(isHistoryGenerator(undefined)).toBe(false);
    expect(isHistoryGenerator(42)).toBe(false);
  });

  it("returns false for arrays", () => {
    expect(isHistoryGenerator([{ $history: {} }])).toBe(false);
  });

  it("returns false for objects without $history", () => {
    expect(isHistoryGenerator({ $data: {} })).toBe(false);
    expect(isHistoryGenerator({ $entity: "sensor.foo" })).toBe(false);
    expect(isHistoryGenerator({ $statistics: {} })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isStatisticsGenerator
// ---------------------------------------------------------------------------
describe("isStatisticsGenerator", () => {
  it("returns true for a valid $statistics object", () => {
    expect(
      isStatisticsGenerator({ $statistics: { entities: ["sensor.foo"], period: "day" } }),
    ).toBe(true);
  });

  it("returns true even if $statistics value is empty", () => {
    expect(isStatisticsGenerator({ $statistics: {} })).toBe(true);
  });

  it("returns false for null / undefined / primitives", () => {
    expect(isStatisticsGenerator(null)).toBe(false);
    expect(isStatisticsGenerator(undefined)).toBe(false);
    expect(isStatisticsGenerator(42)).toBe(false);
  });

  it("returns false for arrays", () => {
    expect(isStatisticsGenerator([{ $statistics: {} }])).toBe(false);
  });

  it("returns false for objects without $statistics", () => {
    expect(isStatisticsGenerator({ $data: {} })).toBe(false);
    expect(isStatisticsGenerator({ $history: {} })).toBe(false);
    expect(isStatisticsGenerator({ $entity: "sensor.foo" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isTokenObject
// ---------------------------------------------------------------------------
describe("isTokenObject", () => {
  it("returns true for a valid $entity object", () => {
    expect(isTokenObject({ $entity: "sensor.temperature" })).toBe(true);
  });

  it("returns true with extra token fields", () => {
    expect(isTokenObject({ $entity: "sensor.x", $coerce: "number", $round: 2 })).toBe(true);
  });

  it("returns false for null / undefined / primitives", () => {
    expect(isTokenObject(null)).toBe(false);
    expect(isTokenObject(undefined)).toBe(false);
    expect(isTokenObject("sensor.foo")).toBe(false);
  });

  it("returns false for arrays", () => {
    expect(isTokenObject([{ $entity: "sensor.foo" }])).toBe(false);
  });

  it("returns false for objects without $entity", () => {
    expect(isTokenObject({ $data: {} })).toBe(false);
    expect(isTokenObject({ $history: {} })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// containsHistoryToken
// ---------------------------------------------------------------------------
describe("containsHistoryToken", () => {
  it("returns false for falsy inputs", () => {
    expect(containsHistoryToken(null)).toBe(false);
    expect(containsHistoryToken(undefined)).toBe(false);
    expect(containsHistoryToken(0)).toBe(false);
    expect(containsHistoryToken("")).toBe(false);
    expect(containsHistoryToken(false)).toBe(false);
  });

  it("returns false for objects with no $history", () => {
    expect(containsHistoryToken({ series: [{ data: [1, 2, 3] }] })).toBe(false);
  });

  it("returns true for a direct $history object", () => {
    expect(containsHistoryToken({ $history: { entities: ["sensor.x"] } })).toBe(true);
  });

  it("finds $history nested in an object tree", () => {
    const option = {
      series: [
        {
          type: "line",
          data: { $history: { entities: ["sensor.temp"], hours: 12 } },
        },
      ],
    };
    expect(containsHistoryToken(option)).toBe(true);
  });

  it("finds $history in an array", () => {
    expect(containsHistoryToken(["not-history", { $history: { entities: ["sensor.x"] } }])).toBe(
      true,
    );
  });

  it("returns true for a direct $statistics object", () => {
    expect(containsHistoryToken({ $statistics: { entities: ["sensor.x"] } })).toBe(true);
  });

  it("finds $statistics nested in an object tree", () => {
    const option = {
      series: [
        {
          type: "bar",
          data: { $statistics: { entities: ["sensor.cost"], period: "day", days: 14 } },
        },
      ],
    };
    expect(containsHistoryToken(option)).toBe(true);
  });

  it("returns false for $data and $entity tokens", () => {
    expect(containsHistoryToken({ $data: { entities: ["sensor.x"] } })).toBe(false);
    expect(containsHistoryToken({ $entity: "sensor.x" })).toBe(false);
  });
});
