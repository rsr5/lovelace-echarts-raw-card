import { describe, it, expect } from "vitest";
import {
  coerceValue,
  applyNumberTransforms,
  applyTransformsWithSpec,
  coerceHistoryPointNumber,
} from "../src/tokens/transforms";
import type { TokenObject } from "../src/types";

// Helper to build a minimal TokenObject
function tok(overrides: Partial<TokenObject> = {}): TokenObject {
  return { $entity: "sensor.test", ...overrides };
}

// ---------------------------------------------------------------------------
// coerceValue
// ---------------------------------------------------------------------------
describe("coerceValue", () => {
  describe("mode = auto (default)", () => {
    it("passes through numbers", () => {
      expect(coerceValue(42)).toBe(42);
      expect(coerceValue(0)).toBe(0);
      expect(coerceValue(-3.14)).toBe(-3.14);
    });

    it("passes through booleans", () => {
      expect(coerceValue(true)).toBe(true);
      expect(coerceValue(false)).toBe(false);
    });

    it("converts numeric strings to numbers", () => {
      expect(coerceValue("42")).toBe(42);
      expect(coerceValue("  3.14  ")).toBe(3.14);
      expect(coerceValue("-100")).toBe(-100);
    });

    it("leaves non-numeric strings as strings", () => {
      expect(coerceValue("hello")).toBe("hello");
      expect(coerceValue("on")).toBe("on");
    });

    it("leaves empty string as-is", () => {
      expect(coerceValue("")).toBe("");
      expect(coerceValue("  ")).toBe("  ");
    });

    it("passes through null/undefined/objects", () => {
      expect(coerceValue(null)).toBe(null);
      expect(coerceValue(undefined)).toBe(undefined);
      const obj = { a: 1 };
      expect(coerceValue(obj)).toBe(obj);
    });
  });

  describe("mode = number", () => {
    it("converts numeric strings to numbers", () => {
      expect(coerceValue("42", "number")).toBe(42);
    });

    it("keeps numbers as-is", () => {
      expect(coerceValue(99, "number")).toBe(99);
    });

    it("returns NaN for non-numeric strings", () => {
      expect(coerceValue("hello", "number")).toBeNaN();
    });

    it("converts null to 0 (Number(null) === 0)", () => {
      expect(coerceValue(null, "number")).toBe(0);
    });
  });

  describe("mode = string", () => {
    it("converts numbers to strings", () => {
      expect(coerceValue(42, "string")).toBe("42");
    });

    it("converts null/undefined to empty string", () => {
      expect(coerceValue(null, "string")).toBe("");
      expect(coerceValue(undefined, "string")).toBe("");
    });

    it("keeps strings as-is", () => {
      expect(coerceValue("hello", "string")).toBe("hello");
    });
  });

  describe("mode = bool", () => {
    it("passes through booleans", () => {
      expect(coerceValue(true, "bool")).toBe(true);
      expect(coerceValue(false, "bool")).toBe(false);
    });

    it("converts numbers (non-zero = true)", () => {
      expect(coerceValue(1, "bool")).toBe(true);
      expect(coerceValue(0, "bool")).toBe(false);
      expect(coerceValue(-1, "bool")).toBe(true);
    });

    it("converts HA truthy strings", () => {
      for (const s of ["on", "true", "1", "yes", "home", "open"]) {
        expect(coerceValue(s, "bool")).toBe(true);
      }
    });

    it("converts HA falsy strings", () => {
      for (const s of ["off", "false", "0", "no", "not_home", "closed"]) {
        expect(coerceValue(s, "bool")).toBe(false);
      }
    });

    it("treats non-empty unknown strings as truthy", () => {
      expect(coerceValue("whatever", "bool")).toBe(true);
    });

    it("treats empty string as falsy", () => {
      expect(coerceValue("", "bool")).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// applyNumberTransforms
// ---------------------------------------------------------------------------
describe("applyNumberTransforms", () => {
  it("returns value unchanged when no transforms", () => {
    expect(applyNumberTransforms(10, tok())).toBe(10);
  });

  it("returns $default for non-finite input", () => {
    expect(applyNumberTransforms("hello", tok({ $default: 0 }))).toBe(0);
    expect(applyNumberTransforms(NaN, tok({ $default: -1 }))).toBe(-1);
  });

  it("returns original value when non-finite and no $default", () => {
    expect(applyNumberTransforms("hello", tok())).toBe("hello");
  });

  describe("$map", () => {
    it("log transform (default base 10, add 1)", () => {
      const result = applyNumberTransforms(99, tok({ $map: { type: "log" } }));
      expect(result).toBeCloseTo(Math.log(100) / Math.log(10), 10);
    });

    it("log transform with custom base and add", () => {
      const result = applyNumberTransforms(7, tok({ $map: { type: "log", base: 2, add: 1 } }));
      expect(result).toBeCloseTo(Math.log(8) / Math.log(2), 10);
    });

    it("sqrt transform", () => {
      expect(applyNumberTransforms(25, tok({ $map: { type: "sqrt" } }))).toBe(5);
    });

    it("sqrt of negative returns 0", () => {
      expect(applyNumberTransforms(-4, tok({ $map: { type: "sqrt" } }))).toBe(0);
    });

    it("pow transform", () => {
      expect(applyNumberTransforms(3, tok({ $map: { type: "pow", pow: 2 } }))).toBe(9);
    });

    it("string shorthand 'log' works like { type: 'log' }", () => {
      const obj = applyNumberTransforms(99, tok({ $map: { type: "log" } }));
      const str = applyNumberTransforms(99, tok({ $map: "log" }));
      expect(str).toBeCloseTo(obj as number, 10);
    });

    it("string shorthand 'sqrt' works like { type: 'sqrt' }", () => {
      expect(applyNumberTransforms(25, tok({ $map: "sqrt" }))).toBe(5);
    });
  });

  it("$abs", () => {
    expect(applyNumberTransforms(-5, tok({ $abs: true }))).toBe(5);
    expect(applyNumberTransforms(5, tok({ $abs: true }))).toBe(5);
  });

  it("$scale", () => {
    expect(applyNumberTransforms(10, tok({ $scale: 2.5 }))).toBe(25);
  });

  it("$offset", () => {
    expect(applyNumberTransforms(10, tok({ $offset: -3 }))).toBe(7);
  });

  it("$min (floor)", () => {
    expect(applyNumberTransforms(2, tok({ $min: 5 }))).toBe(5);
    expect(applyNumberTransforms(10, tok({ $min: 5 }))).toBe(10);
  });

  it("$max (ceiling)", () => {
    expect(applyNumberTransforms(100, tok({ $max: 50 }))).toBe(50);
    expect(applyNumberTransforms(30, tok({ $max: 50 }))).toBe(30);
  });

  it("$clamp", () => {
    expect(applyNumberTransforms(150, tok({ $clamp: [0, 100] }))).toBe(100);
    expect(applyNumberTransforms(-10, tok({ $clamp: [0, 100] }))).toBe(0);
    expect(applyNumberTransforms(50, tok({ $clamp: [0, 100] }))).toBe(50);
  });

  it("$round", () => {
    expect(applyNumberTransforms(3.14159, tok({ $round: 2 }))).toBe(3.14);
    expect(applyNumberTransforms(3.14159, tok({ $round: 0 }))).toBe(3);
  });

  it("applies transforms in correct order (scale then offset)", () => {
    // 10 * 2 = 20, then 20 + 5 = 25
    expect(applyNumberTransforms(10, tok({ $scale: 2, $offset: 5 }))).toBe(25);
  });

  it("converts string numbers before transforming", () => {
    expect(applyNumberTransforms("10", tok({ $scale: 3 }))).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// applyTransformsWithSpec
// ---------------------------------------------------------------------------
describe("applyTransformsWithSpec", () => {
  it("applies coercion + transforms from spec", () => {
    const result = applyTransformsWithSpec("42", "sensor.x", 0, "number", { scale: 2 });
    expect(result).toBe(84);
  });

  it("returns default when coercion produces NaN", () => {
    const result = applyTransformsWithSpec("hello", "sensor.x", 99, "number", undefined);
    expect(result).toBe(99);
  });

  it("defaults to 0 when NaN and no default", () => {
    const result = applyTransformsWithSpec("hello", "sensor.x", undefined, "number", undefined);
    expect(result).toBe(0);
  });

  it("works with no transforms (just coercion)", () => {
    expect(applyTransformsWithSpec("3.5", "sensor.x", 0, "auto", undefined)).toBe(3.5);
  });
});

// ---------------------------------------------------------------------------
// coerceHistoryPointNumber
// ---------------------------------------------------------------------------
describe("coerceHistoryPointNumber", () => {
  it("converts numeric strings to numbers (default coerce = number)", () => {
    expect(coerceHistoryPointNumber("42.5", "sensor.x", 0, undefined, undefined)).toBe(42.5);
  });

  it("returns 0 for non-numeric values with no default (NaN falls back to def ?? 0)", () => {
    expect(
      coerceHistoryPointNumber("unavailable", "sensor.x", undefined, undefined, undefined),
    ).toBe(0);
  });

  it("applies transforms", () => {
    expect(coerceHistoryPointNumber("10", "sensor.x", 0, "number", { scale: 3 })).toBe(30);
  });

  it("uses default when value is non-finite", () => {
    expect(coerceHistoryPointNumber("bad", "sensor.x", 5, "number", undefined)).toBe(5);
  });

  describe("binary sensor states (on/off/home/open etc)", () => {
    it("maps 'on' → 1", () => {
      expect(coerceHistoryPointNumber("on", "binary_sensor.motion", undefined, undefined, undefined)).toBe(1);
    });

    it("maps 'off' → 0", () => {
      expect(coerceHistoryPointNumber("off", "binary_sensor.motion", undefined, undefined, undefined)).toBe(0);
    });

    it("maps 'On' (case-insensitive) → 1", () => {
      expect(coerceHistoryPointNumber("On", "binary_sensor.door", undefined, undefined, undefined)).toBe(1);
    });

    it("maps 'home' → 1 for device_tracker", () => {
      expect(coerceHistoryPointNumber("home", "device_tracker.phone", undefined, undefined, undefined)).toBe(1);
    });

    it("maps 'not_home' → 0 for device_tracker", () => {
      expect(coerceHistoryPointNumber("not_home", "device_tracker.phone", undefined, undefined, undefined)).toBe(0);
    });

    it("maps 'open' → 1 for cover/door", () => {
      expect(coerceHistoryPointNumber("open", "binary_sensor.garage", undefined, undefined, undefined)).toBe(1);
    });

    it("maps 'closed' → 0 for cover/door", () => {
      expect(coerceHistoryPointNumber("closed", "binary_sensor.garage", undefined, undefined, undefined)).toBe(0);
    });

    it("maps 'true' → 1", () => {
      expect(coerceHistoryPointNumber("true", "binary_sensor.x", undefined, undefined, undefined)).toBe(1);
    });

    it("maps 'false' → 0", () => {
      expect(coerceHistoryPointNumber("false", "binary_sensor.x", undefined, undefined, undefined)).toBe(0);
    });

    it("maps 'yes' → 1", () => {
      expect(coerceHistoryPointNumber("yes", "binary_sensor.x", undefined, undefined, undefined)).toBe(1);
    });

    it("maps 'no' → 0", () => {
      expect(coerceHistoryPointNumber("no", "binary_sensor.x", undefined, undefined, undefined)).toBe(0);
    });

    it("applies transforms to binary-mapped value", () => {
      // on → 1, then scale by 100 → 100
      expect(coerceHistoryPointNumber("on", "binary_sensor.x", 0, "number", { scale: 100 })).toBe(100);
    });

    it("does not interfere with normal numeric strings", () => {
      expect(coerceHistoryPointNumber("42.5", "sensor.x", 0, undefined, undefined)).toBe(42.5);
    });
  });
});
