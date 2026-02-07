import type { DataGenerator, TokenObject } from "../types";

export function coerceValue(raw: unknown, mode: TokenObject["$coerce"] = "auto"): unknown {
  if (mode === "string") return raw == null ? "" : String(raw);

  if (mode === "bool") {
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "number") return raw !== 0;
    if (typeof raw === "string") {
      const s = raw.toLowerCase().trim();
      if (["on", "true", "1", "yes", "home", "open"].includes(s)) return true;
      if (["off", "false", "0", "no", "not_home", "closed"].includes(s)) return false;
      return Boolean(s);
    }
    return Boolean(raw);
  }

  if (mode === "number") {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : NaN;
  }

  // auto
  if (typeof raw === "number" || typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s === "") return raw;
    const n = Number(s);
    return Number.isFinite(n) ? n : raw;
  }
  return raw;
}

export function applyNumberTransforms(value: unknown, token: TokenObject): unknown {
  let x = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(x)) return token.$default ?? value;

  if (token.$map) {
    const m = token.$map;
    if (m.type === "log") {
      const base = m.base ?? 10;
      const add = m.add ?? 1;
      x = Math.log(x + add) / Math.log(base);
    } else if (m.type === "sqrt") {
      x = x < 0 ? 0 : Math.sqrt(x);
    } else if (m.type === "pow") {
      x = Math.pow(x, m.pow);
    }
  }

  if (token.$abs) x = Math.abs(x);
  if (typeof token.$scale === "number") x *= token.$scale;
  if (typeof token.$offset === "number") x += token.$offset;
  if (typeof token.$min === "number") x = Math.max(token.$min, x);
  if (typeof token.$max === "number") x = Math.min(token.$max, x);

  if (token.$clamp) {
    const [min, max] = token.$clamp;
    x = Math.min(max, Math.max(min, x));
  }

  if (typeof token.$round === "number") {
    const p = Math.pow(10, token.$round);
    x = Math.round(x * p) / p;
  }

  return x;
}

export function applyTransformsWithSpec(
  value: unknown,
  entityId: string,
  def: unknown,
  coerce: TokenObject["$coerce"] | undefined,
  transforms: DataGenerator["$data"]["transforms"] | undefined,
): unknown {
  const coerced = coerceValue(value, coerce ?? "auto");
  if (typeof coerced === "number" && Number.isNaN(coerced)) return def ?? 0;

  const token: TokenObject = {
    $entity: entityId,
    $default: def,
    $coerce: coerce,
    $map: transforms?.map,
    $abs: transforms?.abs,
    $scale: transforms?.scale,
    $offset: transforms?.offset,
    $min: transforms?.min,
    $max: transforms?.max,
    $clamp: transforms?.clamp,
    $round: transforms?.round,
  };

  return applyNumberTransforms(coerced, token);
}

export function coerceHistoryPointNumber(
  raw: unknown,
  entityId: string,
  def: unknown,
  coerce: TokenObject["$coerce"] | undefined,
  transforms: DataGenerator["$data"]["transforms"] | undefined,
): number | undefined {
  const coerceMode: TokenObject["$coerce"] = coerce ?? "number";
  const v = applyTransformsWithSpec(raw, entityId, def, coerceMode, transforms);
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  return n;
}
