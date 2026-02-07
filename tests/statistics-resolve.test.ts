import { describe, it, expect, vi } from "vitest";
import { deepResolveTokensAsync } from "../src/tokens/resolve";
import { fetchStatistics, statisticsCacheKey } from "../src/statistics/fetch";
import type { HomeAssistant } from "../src/ha-types";
import type { StatisticsGenerator } from "../src/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHass(overrides?: Partial<HomeAssistant>): HomeAssistant {
  return {
    states: {
      "sensor.energy_cost": {
        entity_id: "sensor.energy_cost",
        state: "3.42",
        attributes: { friendly_name: "Energy Cost", unit_of_measurement: "£" },
        last_changed: "",
        last_updated: "",
      },
      "sensor.solar_production": {
        entity_id: "sensor.solar_production",
        state: "12.5",
        attributes: { friendly_name: "Solar Production" },
        last_changed: "",
        last_updated: "",
      },
    },
    themes: { darkMode: false },
    ...overrides,
  };
}

const noopHistory = async () => [];

// ---------------------------------------------------------------------------
// deepResolveTokensAsync — $statistics token resolution
// ---------------------------------------------------------------------------
describe("deepResolveTokensAsync — $statistics", () => {
  it("resolves a $statistics token inside series[0].data", async () => {
    const mockResult = [
      [1707264000000, 2.15],
      [1707350400000, 3.42],
    ];
    const fetchStats = vi.fn().mockResolvedValue(mockResult);

    // This mirrors the exact structure from the user's YAML config
    const input = {
      xAxis: { type: "time" },
      yAxis: { type: "value" },
      series: [
        {
          type: "bar",
          data: {
            $statistics: {
              entities: ["sensor.energy_cost"],
              period: "day",
              stat_type: "change",
              days: 14,
            },
          },
          name: "Daily Cost",
          barMaxWidth: 28,
        },
      ],
    };

    const watched = new Set<string>();
    const result = (await deepResolveTokensAsync(
      input,
      makeHass(),
      watched,
      noopHistory,
      fetchStats,
    )) as Record<string, unknown>;

    // The $statistics token should be replaced with the mock data
    const series = result.series as Array<Record<string, unknown>>;
    expect(series).toHaveLength(1);
    expect(series[0].data).toEqual(mockResult);
    expect(series[0].type).toBe("bar");
    expect(series[0].name).toBe("Daily Cost");
    expect(series[0].barMaxWidth).toBe(28);

    // Entity should be watched
    expect(watched.has("sensor.energy_cost")).toBe(true);

    // fetchStats called with the inner spec (not the wrapper)
    expect(fetchStats).toHaveBeenCalledTimes(1);
    expect(fetchStats).toHaveBeenCalledWith({
      entities: ["sensor.energy_cost"],
      period: "day",
      stat_type: "change",
      days: 14,
    });
  });

  it("resolves $statistics in series-mode (series key is the token)", async () => {
    const mockSeries = [
      { name: "Solar Production", type: "bar", data: [[1707264000000, 5.0]] },
      { name: "Energy Cost", type: "bar", data: [[1707264000000, 3.0]] },
    ];
    const fetchStats = vi.fn().mockResolvedValue(mockSeries);

    const input = {
      xAxis: { type: "time" },
      yAxis: { type: "value" },
      series: {
        $statistics: {
          entities: ["sensor.solar_production", "sensor.energy_cost"],
          period: "day",
          stat_type: "change",
          days: 30,
          mode: "series",
          series_type: "bar",
        },
      },
    };

    const watched = new Set<string>();
    const result = (await deepResolveTokensAsync(
      input,
      makeHass(),
      watched,
      noopHistory,
      fetchStats,
    )) as Record<string, unknown>;

    expect(result.series).toEqual(mockSeries);
    expect(watched.has("sensor.solar_production")).toBe(true);
    expect(watched.has("sensor.energy_cost")).toBe(true);
  });

  it("returns [] when fetchStatistics is not provided", async () => {
    const input = {
      series: [
        {
          type: "bar",
          data: {
            $statistics: {
              entities: ["sensor.energy_cost"],
              period: "day",
              stat_type: "change",
              days: 14,
            },
          },
        },
      ],
    };

    const watched = new Set<string>();
    const result = (await deepResolveTokensAsync(
      input,
      makeHass(),
      watched,
      noopHistory,
      // no fetchStatistics callback
    )) as Record<string, unknown>;

    const series = result.series as Array<Record<string, unknown>>;
    expect(series[0].data).toEqual([]);
    expect(watched.has("sensor.energy_cost")).toBe(true);
  });

  it("preserves non-token sibling keys alongside $statistics", async () => {
    const fetchStats = vi.fn().mockResolvedValue([[1, 2]]);

    const input = {
      backgroundColor: "transparent",
      title: { text: "Test" },
      series: [
        {
          type: "bar",
          data: {
            $statistics: {
              entities: ["sensor.energy_cost"],
            },
          },
          itemStyle: {
            borderRadius: [4, 4, 0, 0],
            color: { type: "linear", colorStops: [{ offset: 0, color: "#42a5f5" }] },
          },
          emphasis: { itemStyle: { color: "#fff" } },
        },
      ],
    };

    const result = (await deepResolveTokensAsync(
      input,
      makeHass(),
      new Set(),
      noopHistory,
      fetchStats,
    )) as Record<string, unknown>;

    expect(result.backgroundColor).toBe("transparent");
    expect((result.title as Record<string, unknown>).text).toBe("Test");

    const series = result.series as Array<Record<string, unknown>>;
    expect(series[0].data).toEqual([[1, 2]]);
    expect(series[0].type).toBe("bar");
    expect((series[0].itemStyle as Record<string, unknown>).borderRadius).toEqual([4, 4, 0, 0]);
  });

  it("does not confuse $statistics with $history", async () => {
    const fetchHistory = vi.fn().mockResolvedValue([[1, 99]]);
    const fetchStats = vi.fn().mockResolvedValue([[1, 42]]);

    const input = {
      series: [
        {
          data: {
            $history: { entities: ["sensor.energy_cost"], hours: 24 },
          },
        },
        {
          data: {
            $statistics: { entities: ["sensor.solar_production"], period: "day" },
          },
        },
      ],
    };

    const result = (await deepResolveTokensAsync(
      input,
      makeHass(),
      new Set(),
      fetchHistory,
      fetchStats,
    )) as Record<string, unknown>;

    const series = result.series as Array<Record<string, unknown>>;
    expect(series[0].data).toEqual([[1, 99]]);
    expect(series[1].data).toEqual([[1, 42]]);
    expect(fetchHistory).toHaveBeenCalledTimes(1);
    expect(fetchStats).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// fetchStatistics — values mode (single entity)
// ---------------------------------------------------------------------------
describe("fetchStatistics — values mode", () => {
  it("returns [timestamp, value] pairs for a single entity", async () => {
    const mockCallWS = vi.fn().mockResolvedValue({
      "sensor.energy_cost": [
        { start: "2025-02-01T00:00:00Z", end: "2025-02-02T00:00:00Z", change: 2.15 },
        { start: "2025-02-02T00:00:00Z", end: "2025-02-03T00:00:00Z", change: 3.42 },
        { start: "2025-02-03T00:00:00Z", end: "2025-02-04T00:00:00Z", change: 1.87 },
      ],
    });

    const hass = makeHass({ callWS: mockCallWS });
    const cache = new Map<string, { ts: number; value: unknown; expiresAt: number }>();

    const result = await fetchStatistics({
      hass,
      spec: {
        entities: ["sensor.energy_cost"],
        period: "day",
        stat_type: "change",
        days: 14,
      },
      watchedEntities: new Set(),
      cache,
      nowMs: Date.now(),
    });

    expect(result).toEqual([
      [new Date("2025-02-01T00:00:00Z").getTime(), 2.15],
      [new Date("2025-02-02T00:00:00Z").getTime(), 3.42],
      [new Date("2025-02-03T00:00:00Z").getTime(), 1.87],
    ]);

    // Verify WS call shape
    expect(mockCallWS).toHaveBeenCalledTimes(1);
    const msg = mockCallWS.mock.calls[0][0];
    expect(msg.type).toBe("recorder/statistics_during_period");
    expect(msg.statistic_ids).toEqual(["sensor.energy_cost"]);
    expect(msg.period).toBe("day");
    expect(msg.types).toEqual(["change"]);
  });

  it("skips null / NaN values in statistics records", async () => {
    const mockCallWS = vi.fn().mockResolvedValue({
      "sensor.energy_cost": [
        { start: "2025-02-01T00:00:00Z", end: "2025-02-02T00:00:00Z", change: 2.15 },
        { start: "2025-02-02T00:00:00Z", end: "2025-02-03T00:00:00Z", change: null },
        { start: "2025-02-03T00:00:00Z", end: "2025-02-04T00:00:00Z", change: 1.0 },
      ],
    });

    const result = await fetchStatistics({
      hass: makeHass({ callWS: mockCallWS }),
      spec: { entities: ["sensor.energy_cost"], period: "day", stat_type: "change" },
      watchedEntities: new Set(),
      cache: new Map(),
      nowMs: Date.now(),
    });

    expect(result).toEqual([
      [new Date("2025-02-01T00:00:00Z").getTime(), 2.15],
      [new Date("2025-02-03T00:00:00Z").getTime(), 1.0],
    ]);
  });

  it("rounds values to 2 decimal places", async () => {
    const mockCallWS = vi.fn().mockResolvedValue({
      "sensor.energy_cost": [
        { start: "2025-02-01T00:00:00Z", end: "2025-02-02T00:00:00Z", change: 2.15678 },
      ],
    });

    const result = await fetchStatistics({
      hass: makeHass({ callWS: mockCallWS }),
      spec: { entities: ["sensor.energy_cost"], period: "day", stat_type: "change" },
      watchedEntities: new Set(),
      cache: new Map(),
      nowMs: Date.now(),
    });

    expect(result).toEqual([[new Date("2025-02-01T00:00:00Z").getTime(), 2.16]]);
  });
});

// ---------------------------------------------------------------------------
// fetchStatistics — series mode (multi entity)
// ---------------------------------------------------------------------------
describe("fetchStatistics — series mode", () => {
  it("returns ECharts series array for multiple entities", async () => {
    const mockCallWS = vi.fn().mockResolvedValue({
      "sensor.energy_cost": [
        { start: "2025-02-01T00:00:00Z", end: "2025-02-02T00:00:00Z", change: 2.0 },
      ],
      "sensor.solar_production": [
        { start: "2025-02-01T00:00:00Z", end: "2025-02-02T00:00:00Z", change: 5.5 },
      ],
    });

    const result = await fetchStatistics({
      hass: makeHass({ callWS: mockCallWS }),
      spec: {
        entities: ["sensor.energy_cost", "sensor.solar_production"],
        period: "day",
        stat_type: "change",
        mode: "series",
        series_type: "bar",
      },
      watchedEntities: new Set(),
      cache: new Map(),
      nowMs: Date.now(),
    });

    expect(result).toEqual([
      {
        name: "Energy Cost",
        type: "bar",
        data: [[new Date("2025-02-01T00:00:00Z").getTime(), 2.0]],
      },
      {
        name: "Solar Production",
        type: "bar",
        data: [[new Date("2025-02-01T00:00:00Z").getTime(), 5.5]],
      },
    ]);
  });

  it("applies series_overrides by friendly name", async () => {
    const mockCallWS = vi.fn().mockResolvedValue({
      "sensor.energy_cost": [
        { start: "2025-02-01T00:00:00Z", end: "2025-02-02T00:00:00Z", change: 2.0 },
      ],
    });

    const result = (await fetchStatistics({
      hass: makeHass({ callWS: mockCallWS }),
      spec: {
        entities: ["sensor.energy_cost"],
        mode: "series",
        series_overrides: {
          "Energy Cost": { color: "#f00", areaStyle: {} },
        },
      },
      watchedEntities: new Set(),
      cache: new Map(),
      nowMs: Date.now(),
    })) as Array<Record<string, unknown>>;

    expect(result[0].color).toBe("#f00");
    expect(result[0].areaStyle).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// fetchStatistics — pairs mode
// ---------------------------------------------------------------------------
describe("fetchStatistics — pairs mode", () => {
  it("returns {name, value} pairs with summed totals", async () => {
    const mockCallWS = vi.fn().mockResolvedValue({
      "sensor.energy_cost": [
        { start: "2025-02-01T00:00:00Z", end: "2025-02-02T00:00:00Z", sum: 10 },
        { start: "2025-02-02T00:00:00Z", end: "2025-02-03T00:00:00Z", sum: 20 },
      ],
      "sensor.solar_production": [
        { start: "2025-02-01T00:00:00Z", end: "2025-02-02T00:00:00Z", sum: 50 },
      ],
    });

    const result = await fetchStatistics({
      hass: makeHass({ callWS: mockCallWS }),
      spec: {
        entities: ["sensor.energy_cost", "sensor.solar_production"],
        period: "day",
        stat_type: "sum",
        mode: "pairs",
      },
      watchedEntities: new Set(),
      cache: new Map(),
      nowMs: Date.now(),
    });

    expect(result).toEqual([
      { name: "Energy Cost", value: 30 },
      { name: "Solar Production", value: 50 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// fetchStatistics — caching
// ---------------------------------------------------------------------------
describe("fetchStatistics — caching", () => {
  it("returns cached value on second call within TTL", async () => {
    const mockCallWS = vi.fn().mockResolvedValue({
      "sensor.energy_cost": [
        { start: "2025-02-01T00:00:00Z", end: "2025-02-02T00:00:00Z", change: 2.0 },
      ],
    });

    const hass = makeHass({ callWS: mockCallWS });
    const cache = new Map<string, { ts: number; value: unknown; expiresAt: number }>();
    const nowMs = Date.now();

    const spec: StatisticsGenerator["$statistics"] = {
      entities: ["sensor.energy_cost"],
      period: "day",
      stat_type: "change",
      days: 14,
      cache_seconds: 300,
    };

    // First call — hits WS
    await fetchStatistics({ hass, spec, watchedEntities: new Set(), cache, nowMs });
    expect(mockCallWS).toHaveBeenCalledTimes(1);

    // Second call same nowMs — should use cache
    await fetchStatistics({ hass, spec, watchedEntities: new Set(), cache, nowMs });
    expect(mockCallWS).toHaveBeenCalledTimes(1); // still 1
  });
});

// ---------------------------------------------------------------------------
// fetchStatistics — error handling
// ---------------------------------------------------------------------------
describe("fetchStatistics — error handling", () => {
  it("throws if hass.callWS is not available", async () => {
    const hass = makeHass(); // no callWS

    await expect(
      fetchStatistics({
        hass,
        spec: { entities: ["sensor.energy_cost"] },
        watchedEntities: new Set(),
        cache: new Map(),
        nowMs: Date.now(),
      }),
    ).rejects.toThrow("hass.callWS");
  });
});

// ---------------------------------------------------------------------------
// statisticsCacheKey
// ---------------------------------------------------------------------------
describe("statisticsCacheKey", () => {
  it("produces a stable key", () => {
    const spec: StatisticsGenerator["$statistics"] = {
      entities: ["sensor.a", "sensor.b"],
      period: "day",
      stat_type: "change",
    };
    const k1 = statisticsCacheKey(spec, "2025-01-01T00:00:00Z", "2025-01-15T00:00:00Z");
    const k2 = statisticsCacheKey(spec, "2025-01-01T00:00:00Z", "2025-01-15T00:00:00Z");
    expect(k1).toBe(k2);
  });

  it("differs when entities change", () => {
    const base = { period: "day" as const, stat_type: "change" as const };
    const k1 = statisticsCacheKey(
      { entities: ["sensor.a"], ...base },
      "2025-01-01T00:00:00Z",
      "2025-01-15T00:00:00Z",
    );
    const k2 = statisticsCacheKey(
      { entities: ["sensor.b"], ...base },
      "2025-01-01T00:00:00Z",
      "2025-01-15T00:00:00Z",
    );
    expect(k1).not.toBe(k2);
  });
});
