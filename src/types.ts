import type { EChartsOption } from "echarts";
import type { LovelaceCardConfig } from "./ha-types";

export type EchartsRawCardConfig = LovelaceCardConfig & {
  option: EChartsOption;
  height?: string;
  renderer?: "canvas" | "svg";
  title?: string;
  debug?:
    | boolean
    | {
        show_resolved_option?: boolean;
        log_resolved_option?: boolean;
        max_chars?: number;
      };
};

/* ------------------------------------------------------------------
 * Token + transform types
 * ------------------------------------------------------------------ */

export type TokenMap =
  | { type: "log"; base?: number; add?: number }
  | { type: "sqrt" }
  | { type: "pow"; pow: number };

export type TokenObject = {
  $entity: string;
  $attr?: string;
  $coerce?: "auto" | "number" | "string" | "bool";
  $default?: unknown;

  $map?: TokenMap;
  $abs?: boolean;
  $scale?: number;
  $offset?: number;
  $min?: number;
  $max?: number;
  $clamp?: [number, number];
  $round?: number;
};

/* ------------------------------------------------------------------
 * $data generator (Phase 2.2C)
 * ------------------------------------------------------------------ */

export type DataMode = "pairs" | "names" | "values";
export type EntitySpec = string | { id: string; name?: string };

export type DataGenerator = {
  $data: {
    entities: EntitySpec[];
    mode?: DataMode;
    name_from?: "friendly_name" | "entity_id";

    attr?: string;
    coerce?: TokenObject["$coerce"];
    default?: unknown;

    // legacy
    include_unavailable?: boolean;

    // 2.2C
    exclude_unavailable?: boolean; // default true
    exclude_zero?: boolean; // default false
    sort?: "asc" | "desc" | "none"; // default none
    limit?: number;

    transforms?: {
      map?: TokenObject["$map"];
      abs?: boolean;
      scale?: number;
      offset?: number;
      min?: number;
      max?: number;
      clamp?: [number, number];
      round?: number;
    };
  };
};

/* ------------------------------------------------------------------
 * $history generator (Phase 2.3)
 * ------------------------------------------------------------------ */

export type HistoryMode = "values" | "series";

export type HistoryGenerator = {
  $history: {
    entities: EntitySpec[];

    hours?: number;
    start?: string | number;
    end?: string | number;

    mode?: HistoryMode; // default "values" if one entity, otherwise "series"
    name_from?: "friendly_name" | "entity_id";

    attr?: string;
    coerce?: TokenObject["$coerce"];
    default?: unknown;

    transforms?: DataGenerator["$data"]["transforms"];

    series_type?: "line" | "bar" | "scatter"; // default "line"
    show_symbol?: boolean; // default false

    sample?: { max_points: number; method?: "mean" | "last" };

    cache_seconds?: number;

    // optional per-series override by display name OR entity_id
    series_overrides?: Record<string, Record<string, any>>;

    // optional: you can re-enable minimal_response later if you want
    minimal_response?: boolean; // default false
  };
};
