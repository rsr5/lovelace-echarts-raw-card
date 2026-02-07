import type { HomeAssistant } from "../ha-types";
import type { HistoryGenerator, HistoryMode } from "../types";
import { normalizeEntitySpec, parseTime } from "../tokens/entity";
import { coerceHistoryPointNumber } from "../tokens/transforms";
import type { HistoryStateLike } from "./decode";
import { histAttributes, histEntityId, histState, histTimestampMs } from "./decode";
import { downsample } from "./downsample";

export function historyCacheKey(
  spec: HistoryGenerator["$history"],
  startMs: number,
  endMs: number,
): string {
  const ids = (spec.entities ?? []).map((e) => normalizeEntitySpec(e).id).join(",");
  const sample = spec.sample ? `${spec.sample.max_points}:${spec.sample.method ?? "mean"}` : "";
  const overrides = spec.series_overrides ? JSON.stringify(spec.series_overrides) : "";
  const minimal = spec.minimal_response ? "1" : "0";
  return [
    ids,
    startMs,
    endMs,
    spec.attr ?? "",
    spec.coerce ?? "number",
    JSON.stringify(spec.transforms ?? {}),
    spec.mode ?? "",
    spec.series_type ?? "",
    sample,
    overrides,
    minimal,
  ].join("|");
}

type CacheEntry = { ts: number; value: unknown; expiresAt: number };

/** Minimal cache interface — satisfied by both Map and LruMap. */
interface CacheLike<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): unknown;
}

type FetchHistoryArgs = {
  hass: HomeAssistant;
  spec: HistoryGenerator["$history"];
  watchedEntities: Set<string>;
  cache: CacheLike<string, CacheEntry>;
  nowMs: number;
};

export async function fetchHistory({
  hass,
  spec,
  watchedEntities,
  cache,
  nowMs,
}: FetchHistoryArgs): Promise<unknown> {
  // bucket endMs when end is implicit so cache keys & HA params are stable inside cache_seconds
  const cacheSeconds = spec.cache_seconds ?? 30;
  let endMs = parseTime(spec.end, nowMs);
  if (spec.end == null) {
    const bucket = Math.max(1, cacheSeconds) * 1000;
    endMs = Math.floor(endMs / bucket) * bucket;
  }

  const startMs =
    spec.start != null
      ? parseTime(spec.start, endMs - 24 * 3600_000)
      : endMs - (spec.hours ?? 24) * 3600_000;

  // Guard: invalid timestamps will crash Date#toISOString with RangeError: Invalid time value.
  // We throw a tagged error so the card can downgrade it to a warning and drop the value.
  if (!Number.isFinite(endMs) || !Number.isFinite(startMs)) {
    const details = {
      start: spec.start,
      end: spec.end,
      hours: spec.hours,
      nowMs,
      computed: { startMs, endMs },
    };
    const err = new Error(
      `[echarts-raw-card] Invalid $history time range; start/end must be finite epoch-ms numbers. Details: ${JSON.stringify(
        details,
      )}`,
    ) as Error & { code?: string };
    err.code = "ECHARTS_RAW_CARD_INVALID_HISTORY_TIME";
    throw err;
  }

  for (const e of spec.entities ?? []) watchedEntities.add(normalizeEntitySpec(e).id);

  const cacheKey = historyCacheKey(spec, startMs, endMs);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs) return cached.value;

  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();
  const entityIds = (spec.entities ?? []).map((e) => normalizeEntitySpec(e).id);

  const params = new URLSearchParams();
  params.set("end_time", endIso);

  // default OFF (your own testing: commenting it fixed the chart)
  if (spec.minimal_response) params.set("minimal_response", "1");

  // IMPORTANT:
  // HA history frequently ignores repeated filter_entity_id params (keeps only the first).
  // Use a single comma-separated filter_entity_id to reliably fetch multiple entities.
  params.set("filter_entity_id", entityIds.join(","));

  const hist = (await hass.callApi!(
    "GET",
    `history/period/${startIso}?${params.toString()}`,
  )) as Array<Array<HistoryStateLike>>;

  const nameFrom = spec.name_from ?? "friendly_name";
  const seriesType = spec.series_type ?? "line";
  const showSymbol = spec.show_symbol ?? false;

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

  const perEntity: Record<string, Array<[number, number]>> = {};
  for (const id of entityIds) perEntity[id] = [];

  // HA history often returns "compressed" arrays:
  // - arr[0] has entity_id + attributes + timestamps
  // - subsequent items omit entity_id and attributes, but include state + last_changed
  for (const arr of hist ?? []) {
    if (!Array.isArray(arr) || arr.length === 0) continue;

    const arrEntityId = histEntityId(arr[0]);

    for (const s of arr) {
      const id = histEntityId(s) ?? arrEntityId;
      if (!id || !perEntity[id]) continue;

      const ts = histTimestampMs(s);
      if (ts == null) continue;

      const raw = spec.attr ? histAttributes(s)?.[spec.attr] : histState(s);
      const n = coerceHistoryPointNumber(raw, id, spec.default, spec.coerce, spec.transforms);
      if (n == null) continue;

      perEntity[id].push([ts, n]);
    }
  }

  for (const id of entityIds) perEntity[id].sort((a, b) => a[0] - b[0]);

  if (spec.sample?.max_points && spec.sample.max_points > 1) {
    const method = spec.sample.method ?? "mean";
    for (const id of entityIds) {
      perEntity[id] = downsample(
        perEntity[id] as Array<[number, unknown]>,
        spec.sample.max_points,
        method,
      ) as Array<[number, number]>;
    }
  }

  const inferredMode: HistoryMode = spec.mode ?? (entityIds.length > 1 ? "series" : "values");

  let result: unknown;

  if (inferredMode === "values") {
    const id = entityIds[0];
    result = perEntity[id] ?? [];
  } else {
    const series = entityIds.map((id) => {
      const displayName = idToName.get(id) ?? id;
      const base: Record<string, unknown> = {
        name: displayName,
        type: seriesType,
        showSymbol,
        data: perEntity[id] ?? [],
      };

      // allow overrides by display name OR by entity id
      const overridesByName = spec.series_overrides?.[displayName];
      const overridesById = spec.series_overrides?.[id];
      const overrides = overridesByName ?? overridesById;

      if (overrides && typeof overrides === "object") Object.assign(base, overrides);

      return base;
    });

    result = series;
  }

  cache.set(cacheKey, {
    ts: nowMs,
    value: result,
    expiresAt: nowMs + cacheSeconds * 1000,
  });

  return result;
}
