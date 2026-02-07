/*
 * History decoding helpers
 * Works for:
 *  - normal objects with entity_id/state/attributes/last_changed
 *  - compressed arrays where only first element has entity_id/attributes
 *  - (optional) minimal_response short keys (e/s/a/lc/lu)
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- HA history objects have unpredictable shapes
export type HistoryStateLike = Record<string, any>;

export function histEntityId(s: HistoryStateLike): string | undefined {
  return (s.entity_id ?? s.e ?? s.id) as string | undefined;
}

export function histState(s: HistoryStateLike): unknown {
  return s.state ?? s.s ?? s.st;
}

export function histAttributes(s: HistoryStateLike): Record<string, unknown> | undefined {
  const a = s.attributes ?? s.a ?? s.attr;
  return a && typeof a === "object" ? (a as Record<string, unknown>) : undefined;
}

export function histTimestampMs(s: HistoryStateLike): number | undefined {
  const t = (s.last_changed ??
    s.last_updated ??
    s.lc ??
    s.lu ??
    s.c ??
    s.u ??
    s.ts ??
    s.t ??
    s.time_fired) as string | number | undefined;

  if (t == null) return undefined;

  if (typeof t === "number") {
    const ms = t < 1e12 ? t * 1000 : t;
    return Number.isFinite(ms) ? ms : undefined;
  }

  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : undefined;
}
