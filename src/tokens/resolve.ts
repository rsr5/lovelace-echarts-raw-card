import type { HomeAssistant } from "../ha-types";
import type { DataMode, HistoryGenerator, StatisticsGenerator } from "../types";
import {
  isDataGenerator,
  isHistoryGenerator,
  isStatisticsGenerator,
  isTokenObject,
} from "./guards";
import { normalizeEntitySpec } from "./entity";
import { applyNumberTransforms, applyTransformsWithSpec, coerceValue } from "./transforms";

export async function deepResolveTokensAsync(
  input: unknown,
  hass: HomeAssistant | undefined,
  watched: Set<string>,
  fetchHistory: (spec: HistoryGenerator["$history"]) => Promise<unknown>,
  fetchStatistics?: (spec: StatisticsGenerator["$statistics"]) => Promise<unknown>,
): Promise<unknown> {
  if (!input) return input;

  // $history
  if (isHistoryGenerator(input)) {
    const spec = input.$history;
    for (const e of spec.entities ?? []) watched.add(normalizeEntitySpec(e).id);
    return fetchHistory(spec);
  }

  // $statistics
  if (isStatisticsGenerator(input)) {
    const spec = input.$statistics;
    for (const e of spec.entities ?? []) watched.add(normalizeEntitySpec(e).id);
    if (!fetchStatistics) return [];
    return fetchStatistics(spec);
  }

  // $data
  if (isDataGenerator(input)) {
    const spec = input.$data;

    const excludeUnavailable = spec.exclude_unavailable ?? true;
    const includeLegacy = spec.include_unavailable ?? false;
    const excludeZero = spec.exclude_zero ?? false;
    const sort = spec.sort ?? "none";
    const limit = spec.limit;
    const mode: DataMode = spec.mode ?? "pairs";
    const nameFrom = spec.name_from ?? "friendly_name";

    const rows: Array<{ id: string; name: string; value: unknown; num?: number }> = [];

    for (const rawSpec of spec.entities ?? []) {
      const { id, name: override } = normalizeEntitySpec(rawSpec);

      watched.add(id);

      const st = hass?.states?.[id];
      const unavailable = !st || st.state === "unavailable" || st.state === "unknown";
      if (unavailable) {
        if ((excludeUnavailable && !includeLegacy) || !st) continue;
        if (!includeLegacy) continue;
      }

      const displayName =
        override ??
        (nameFrom === "entity_id"
          ? id
          : ((st?.attributes?.friendly_name as string | undefined) ?? id));

      const raw = spec.attr ? st?.attributes?.[spec.attr] : st?.state;
      const value = applyTransformsWithSpec(raw, id, spec.default, spec.coerce, spec.transforms);

      const n = typeof value === "number" ? value : Number(value);
      const num = Number.isFinite(n) ? n : undefined;

      if (excludeZero && num === 0) continue;

      rows.push({ id, name: displayName, value, num });
    }

    if (sort === "asc") rows.sort((a, b) => (a.num ?? Infinity) - (b.num ?? Infinity));
    else if (sort === "desc") rows.sort((a, b) => (b.num ?? -Infinity) - (a.num ?? -Infinity));

    const sliced = typeof limit === "number" && limit > 0 ? rows.slice(0, limit) : rows;

    if (mode === "names") return sliced.map((r) => r.name);
    if (mode === "values") return sliced.map((r) => r.value);

    // pairs
    return sliced.map((r) => ({ name: r.name, value: r.value }));
  }

  // $entity token object
  if (isTokenObject(input)) {
    const entityId = input.$entity;
    watched.add(entityId);

    const st = hass?.states?.[entityId];
    if (!st) return input.$default;

    const raw = input.$attr ? st.attributes?.[input.$attr] : st.state;
    const coerced = coerceValue(raw, input.$coerce ?? "auto");
    return applyNumberTransforms(coerced, input);
  }

  if (Array.isArray(input)) {
    const out = [];
    for (const x of input)
      out.push(await deepResolveTokensAsync(x, hass, watched, fetchHistory, fetchStatistics));
    return out;
  }

  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = await deepResolveTokensAsync(v, hass, watched, fetchHistory, fetchStatistics);
    }
    return out;
  }

  return input;
}
