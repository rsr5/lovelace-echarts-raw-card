import type { HomeAssistant } from "../ha-types";
import type { DataGenerator, EntitySpec, TokenObject } from "../types";
import { applyTransformsWithSpec } from "./transforms";

export function normalizeEntitySpec(e: EntitySpec): { id: string; name?: string } {
  return typeof e === "string" ? { id: e } : e;
}

export function resolveEntityNowValue(
  hass: HomeAssistant | undefined,
  entityId: string,
  spec: DataGenerator["$data"],
  watched: Set<string>
): unknown {
  watched.add(entityId);

  const st = hass?.states?.[entityId];
  if (!st) return spec.default;

  const raw = spec.attr ? st.attributes?.[spec.attr] : st.state;
  return applyTransformsWithSpec(raw, entityId, spec.default, spec.coerce, spec.transforms);
}

export function parseTime(t: string | number | undefined, fallbackMs: number): number {
  if (t == null) return fallbackMs;
  if (typeof t === "number") return t;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : fallbackMs;
}

export function coerceValueFallback(raw: unknown, mode: TokenObject["$coerce"] = "auto"): unknown {
  // Kept for backward-compat if older code imports from entity.ts in future refactors.
  // Prefer importing `coerceValue` from `./transforms`.
  if (mode === "string") return raw == null ? "" : String(raw);
  return raw;
}
