import { describe, it, expect } from "vitest";
import { downsample } from "../src/history/downsample";

describe("downsample", () => {
  // ---------------------------------------------------------------------------
  // Edge cases — should return input unchanged
  // ---------------------------------------------------------------------------
  it("returns input when points <= maxPoints", () => {
    const pts: Array<[number, unknown]> = [
      [1000, 10],
      [2000, 20],
      [3000, 30],
    ];
    expect(downsample(pts, 5, "mean")).toBe(pts);
    expect(downsample(pts, 3, "mean")).toBe(pts);
  });

  it("returns input when maxPoints <= 1", () => {
    const pts: Array<[number, unknown]> = [
      [1000, 10],
      [2000, 20],
    ];
    expect(downsample(pts, 1, "mean")).toBe(pts);
    expect(downsample(pts, 0, "mean")).toBe(pts);
  });

  it("returns input for empty array", () => {
    const pts: Array<[number, unknown]> = [];
    expect(downsample(pts, 5, "mean")).toBe(pts);
  });

  // ---------------------------------------------------------------------------
  // method = "last"
  // ---------------------------------------------------------------------------
  describe("method = last", () => {
    it("picks the last value from each bucket", () => {
      // 10 points, downsample to 2 buckets
      const pts: Array<[number, unknown]> = [];
      for (let i = 0; i < 10; i++) {
        pts.push([i * 100, i * 10]);
      }

      const result = downsample(pts, 2, "last");

      // Each bucket should have the last point's value
      for (const [, v] of result) {
        expect(typeof v).toBe("number");
      }
      // Result should be significantly smaller than input
      expect(result.length).toBeLessThanOrEqual(4); // 2 buckets + possible last point guarantee
    });
  });

  // ---------------------------------------------------------------------------
  // method = "mean"
  // ---------------------------------------------------------------------------
  describe("method = mean", () => {
    it("averages numeric values in each bucket", () => {
      // 6 evenly-spaced points with known values, downsample to 2
      const pts: Array<[number, unknown]> = [
        [0, 10],
        [1, 20],
        [2, 30],
        [3, 40],
        [4, 50],
        [5, 60],
      ];

      const result = downsample(pts, 2, "mean");

      // Should produce ~2 buckets (plus possible last point)
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result.length).toBeLessThanOrEqual(4);

      // All values should be finite numbers (averages)
      for (const [, v] of result) {
        expect(Number.isFinite(v as number)).toBe(true);
      }
    });

    it("handles non-numeric values in mean (falls back to last)", () => {
      const pts: Array<[number, unknown]> = [
        [0, "unavailable"],
        [1, "unavailable"],
        [2, "unavailable"],
        [3, "unavailable"],
      ];

      const result = downsample(pts, 2, "mean");

      // When no numeric values exist, should fall back to last value
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Last-point guarantee
  // ---------------------------------------------------------------------------
  it("preserves the last point of the input", () => {
    const pts: Array<[number, unknown]> = [
      [0, 1],
      [100, 2],
      [200, 3],
      [300, 4],
      [400, 5],
      [500, 6],
      [600, 7],
      [700, 8],
      [800, 9],
      [999, 100], // last point with distinct timestamp
    ];

    const result = downsample(pts, 3, "mean");
    const lastResult = result[result.length - 1];
    const lastInput = pts[pts.length - 1];

    expect(lastResult[0]).toBe(lastInput[0]);
  });

  // ---------------------------------------------------------------------------
  // Output length
  // ---------------------------------------------------------------------------
  it("output length is bounded by maxPoints (+ 1 for last point guarantee)", () => {
    const pts: Array<[number, unknown]> = [];
    for (let i = 0; i < 1000; i++) {
      pts.push([i, Math.random() * 100]);
    }

    const result = downsample(pts, 50, "mean");

    // At most maxPoints buckets + 1 for last-point guarantee
    expect(result.length).toBeLessThanOrEqual(51);
    // Should actually produce some downsampling
    expect(result.length).toBeLessThan(pts.length);
  });
});
