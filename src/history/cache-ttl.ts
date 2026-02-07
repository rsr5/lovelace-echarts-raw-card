import { isHistoryGenerator } from "../tokens/guards";

export function minHistoryCacheSecondsInOptionTree(option: unknown, fallback = 30): number {
  let min = Infinity;

  const walk = (v: unknown) => {
    if (!v) return;
    if (isHistoryGenerator(v)) {
      const cs = v.$history.cache_seconds;
      if (typeof cs === "number" && cs > 0) min = Math.min(min, cs);
      return;
    }
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v === "object") Object.values(v as Record<string, unknown>).forEach(walk);
  };

  walk(option);
  return Number.isFinite(min) ? min : fallback;
}
