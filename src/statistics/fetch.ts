import type { HomeAssistant } from "../ha-types";
import type { StatisticsGenerator, StatisticsMode, StatisticType } from "../types";
import { normalizeEntitySpec, parseTime } from "../tokens/entity";

/* ------------------------------------------------------------------
 * HA WebSocket statistics response shape
 * ------------------------------------------------------------------ */

interface StatisticsRecord {
  start: string; // ISO timestamp for the period start
  end: string;
  mean?: number | null;
  min?: number | null;
  max?: number | null;
  sum?: number | null;
  change?: number | null;
  state?: number | null;
}

type StatisticsResponse = Record<string, StatisticsRecord[]>;

/* ------------------------------------------------------------------
 * Cache
 * ------------------------------------------------------------------ */

type CacheEntry = { ts: number; value: unknown; expiresAt: number };

interface CacheLike<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): unknown;
}

export function statisticsCacheKey(
  spec: StatisticsGenerator["$statistics"],
  startIso: string,
  endIso: string,
): string {
  const ids = (spec.entities ?? []).map((e) => normalizeEntitySpec(e).id).join(",");
  return [
    ids,
    startIso,
    endIso,
    spec.period ?? "day",
    spec.stat_type ?? "change",
    spec.mode ?? "",
    spec.series_type ?? "",
    JSON.stringify(spec.series_overrides ?? {}),
  ].join("|");
}

/* ------------------------------------------------------------------
 * Fetch
 * ------------------------------------------------------------------ */

type FetchStatisticsArgs = {
  hass: HomeAssistant;
  spec: StatisticsGenerator["$statistics"];
  watchedEntities: Set<string>;
  cache: CacheLike<string, CacheEntry>;
  nowMs: number;
};

export async function fetchStatistics({
  hass,
  spec,
  watchedEntities,
  cache,
  nowMs,
}: FetchStatisticsArgs): Promise<unknown> {
  const cacheSeconds = spec.cache_seconds ?? 300;
  const period = spec.period ?? "day";
  const statType: StatisticType = spec.stat_type ?? "change";
  const days = spec.days ?? 14;
  const seriesType = spec.series_type ?? "bar";
  const nameFrom = spec.name_from ?? "friendly_name";

  // Compute time range
  let endMs = spec.end != null ? parseTime(spec.end, nowMs) : nowMs;
  // Bucket end time for cache stability
  const bucket = Math.max(1, cacheSeconds) * 1000;
  endMs = Math.floor(endMs / bucket) * bucket;

  const startMs =
    spec.start != null ? parseTime(spec.start, endMs - days * 86400_000) : endMs - days * 86400_000;

  const entityIds = (spec.entities ?? []).map((e) => normalizeEntitySpec(e).id);
  for (const id of entityIds) watchedEntities.add(id);

  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();

  // Check cache
  const key = statisticsCacheKey(spec, startIso, endIso);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > nowMs) return cached.value;

  // Call HA WebSocket API
  if (!hass.callWS) {
    throw new Error(
      "[echarts-raw-card] $statistics requires hass.callWS — ensure HA version >= 2023.8",
    );
  }

  const response = await hass.callWS<StatisticsResponse>({
    type: "recorder/statistics_during_period",
    start_time: startIso,
    end_time: endIso,
    statistic_ids: entityIds,
    period,
    types: [statType],
  });

  // Build display name map
  const idToName = new Map<string, string>();
  for (const raw of spec.entities ?? []) {
    const { id, name: override } = normalizeEntitySpec(raw);
    const st = hass.states?.[id];
    const displayName =
      override ??
      (nameFrom === "entity_id"
        ? id
        : ((st?.attributes?.friendly_name as string | undefined) ?? id));
    idToName.set(id, displayName);
  }

  // Extract data per entity
  const perEntity: Record<string, Array<[number, number]>> = {};
  for (const id of entityIds) {
    perEntity[id] = [];
    const records = response[id] ?? [];
    for (const rec of records) {
      const ts = new Date(rec.start).getTime();
      const val = rec[statType];
      if (val == null || !Number.isFinite(val)) continue;
      perEntity[id].push([ts, Math.round(val * 100) / 100]);
    }
  }

  // Determine output mode
  const inferredMode: StatisticsMode = spec.mode ?? (entityIds.length > 1 ? "series" : "values");

  let result: unknown;

  if (inferredMode === "values") {
    const id = entityIds[0];
    result = perEntity[id] ?? [];
  } else if (inferredMode === "pairs") {
    // Aggregate: sum all values per entity into a single {name, value} pair
    result = entityIds.map((id) => {
      const displayName = idToName.get(id) ?? id;
      const total = (perEntity[id] ?? []).reduce((sum, [, v]) => sum + v, 0);
      return { name: displayName, value: Math.round(total * 100) / 100 };
    });
  } else {
    // series mode
    const series = entityIds.map((id) => {
      const displayName = idToName.get(id) ?? id;
      const base: Record<string, unknown> = {
        name: displayName,
        type: seriesType,
        data: perEntity[id] ?? [],
      };

      const overridesByName = spec.series_overrides?.[displayName];
      const overridesById = spec.series_overrides?.[id];
      const overrides = overridesByName ?? overridesById;
      if (overrides && typeof overrides === "object") Object.assign(base, overrides);

      return base;
    });

    result = series;
  }

  cache.set(key, {
    ts: nowMs,
    value: result,
    expiresAt: nowMs + cacheSeconds * 1000,
  });

  return result;
}
