import { LitElement, css, html, nothing } from "lit";
import type { ECharts, EChartsOption, SetOptionOpts } from "echarts";
import * as echarts from "echarts";
import type { HomeAssistant, LovelaceCardConfig } from "./ha-types";

type EchartsRawCardConfig = LovelaceCardConfig & {
  option: EChartsOption;
  height?: string;
  renderer?: "canvas" | "svg";
  title?: string;
};

/* ------------------------------------------------------------------
 * Token + transform types
 * ------------------------------------------------------------------ */

type TokenMap =
  | { type: "log"; base?: number; add?: number }
  | { type: "sqrt" }
  | { type: "pow"; pow: number };

type TokenObject = {
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

type DataMode = "pairs" | "names" | "values";

type EntitySpec = string | { id: string; name?: string };

type DataGenerator = {
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
    exclude_unavailable?: boolean;
    exclude_zero?: boolean;
    sort?: "asc" | "desc" | "none";
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
 * Type guards + helpers
 * ------------------------------------------------------------------ */

function isDataGenerator(v: unknown): v is DataGenerator {
  return !!v && typeof v === "object" && !Array.isArray(v) && "$data" in v;
}

function isTokenObject(v: unknown): v is TokenObject {
  return !!v && typeof v === "object" && !Array.isArray(v) && "$entity" in v;
}

function normalizeEntitySpec(e: EntitySpec): { id: string; name?: string } {
  return typeof e === "string" ? { id: e } : e;
}

function coerceValue(raw: unknown, mode: TokenObject["$coerce"] = "auto"): unknown {
  if (mode === "string") return raw == null ? "" : String(raw);

  if (mode === "bool") {
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "number") return raw !== 0;
    if (typeof raw === "string") {
      const s = raw.toLowerCase().trim();
      if (["on", "true", "1", "yes", "home", "open"].includes(s)) return true;
      if (["off", "false", "0", "no", "not_home", "closed"].includes(s)) return false;
    }
    return Boolean(raw);
  }

  if (mode === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : NaN;
  }

  if (typeof raw === "string") {
    const s = raw.trim();
    if (s === "") return raw;
    const n = Number(s);
    return Number.isFinite(n) ? n : raw;
  }

  return raw;
}

function applyNumberTransforms(value: unknown, token: TokenObject): unknown {
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

function resolveEntityValue(
  hass: HomeAssistant | undefined,
  entityId: string,
  spec: DataGenerator["$data"],
  watched: Set<string>
): unknown {
  watched.add(entityId);

  const st = hass?.states?.[entityId];
  if (!st) return spec.default;

  const raw = spec.attr ? st.attributes?.[spec.attr] : st.state;
  const coerced = coerceValue(raw, spec.coerce ?? "auto");

  if (typeof coerced === "number" && Number.isNaN(coerced)) return spec.default ?? 0;

  const token: TokenObject = {
    $entity: entityId,
    $coerce: spec.coerce,
    $default: spec.default,
    $map: spec.transforms?.map,
    $abs: spec.transforms?.abs,
    $scale: spec.transforms?.scale,
    $offset: spec.transforms?.offset,
    $min: spec.transforms?.min,
    $max: spec.transforms?.max,
    $clamp: spec.transforms?.clamp,
    $round: spec.transforms?.round
  };

  return applyNumberTransforms(coerced, token);
}

/* ------------------------------------------------------------------
 * Token resolver
 * ------------------------------------------------------------------ */

function deepResolveTokens(
  input: unknown,
  hass: HomeAssistant | undefined,
  watched: Set<string>
): unknown {
  if (isDataGenerator(input)) {
    const spec = input.$data;

    const mode = spec.mode ?? "pairs";
    const nameFrom = spec.name_from ?? "friendly_name";

    const includeLegacy = spec.include_unavailable ?? false;
    const excludeUnavailable = spec.exclude_unavailable ?? true;
    const includeMissing = includeLegacy || !excludeUnavailable;

    let rows: Array<{ name: string; value: unknown }> = [];

    for (const raw of spec.entities) {
      const { id, name: override } = normalizeEntitySpec(raw);
      const st = hass?.states?.[id];

      if (!st && !includeMissing) continue;

      const name =
        override ??
        (nameFrom === "entity_id"
          ? id
          : (st?.attributes?.friendly_name as string | undefined) ?? id);

      const value = resolveEntityValue(hass, id, spec, watched);

      if (spec.exclude_zero && Number(value) === 0) continue;

      rows.push({ name, value });
    }

    if (spec.sort === "asc" || spec.sort === "desc") {
      rows.sort((a, b) =>
        (Number(a.value) - Number(b.value)) * (spec.sort === "asc" ? 1 : -1)
      );
    }

    if (typeof spec.limit === "number") {
      rows = rows.slice(0, spec.limit);
    }

    if (mode === "names") return rows.map((r) => r.name);
    if (mode === "values") return rows.map((r) => r.value);
    return rows;
  }

  if (isTokenObject(input)) {
    const st = hass?.states?.[input.$entity];
    watched.add(input.$entity);
    if (!st) return input.$default;

    const raw = input.$attr ? st.attributes?.[input.$attr] : st.state;
    const coerced = coerceValue(raw, input.$coerce ?? "auto");
    return applyNumberTransforms(coerced, input);
  }

  if (Array.isArray(input)) {
    return input.map((x) => deepResolveTokens(x, hass, watched));
  }

  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      out[k] = deepResolveTokens(v, hass, watched);
    }
    return out;
  }

  return input;
}

/* ------------------------------------------------------------------
 * Card
 * ------------------------------------------------------------------ */

export class EchartsRawCard extends LitElement {
  static properties = {
    hass: { attribute: false },
    _config: { state: true },
    _error: { state: true }
  };

  public hass?: HomeAssistant;
  private _config?: EchartsRawCardConfig;
  private _error?: string;

  private _chart?: ECharts;
  private _resizeObserver?: ResizeObserver;

  private _watchedEntities = new Set<string>();
  private _lastFingerprints = new Map<string, string>();

  public setConfig(config: LovelaceCardConfig): void {
    this._config = { height: "300px", renderer: "canvas", ...config } as EchartsRawCardConfig;
    this._watchedEntities.clear();
    this._lastFingerprints.clear();
    this._error = undefined;
  }

  protected firstUpdated(): void {
    const el = this.renderRoot.querySelector(".echarts-container") as HTMLDivElement | null;
    if (!el) return;

    this._chart = echarts.init(el, undefined, { renderer: this._config?.renderer ?? "canvas" });
    this._resizeObserver = new ResizeObserver(() => this._chart?.resize());
    this._resizeObserver.observe(el);

    this._applyOption();
  }

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has("_config") || (changed.has("hass") && this._shouldUpdate())) {
      this._applyOption();
    }
  }

  private _shouldUpdate(): boolean {
    if (!this.hass) return false;
    for (const id of this._watchedEntities) {
      const st = this.hass.states[id];
      const fp = st ? `${st.state}|${st.last_updated}` : "missing";
      if (this._lastFingerprints.get(id) !== fp) return true;
    }
    return false;
  }

  private _snapshot(): void {
    if (!this.hass) return;
    for (const id of this._watchedEntities) {
      const st = this.hass.states[id];
      this._lastFingerprints.set(id, st ? `${st.state}|${st.last_updated}` : "missing");
    }
  }

  private _applyOption(): void {
    if (!this._chart || !this._config?.option) return;

    const watched = new Set<string>();
    const resolved = deepResolveTokens(this._config.option, this.hass, watched) as EChartsOption;
    this._watchedEntities = watched;

    const option: EChartsOption = {
      backgroundColor: "transparent",
      ...resolved
    };

    try {
      this._chart.setOption(option, { notMerge: true, lazyUpdate: true });
      this._snapshot();
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
      console.error("[echarts-raw-card]", err);
    }
  }

  protected render() {
    if (!this._config) return nothing;

    return html`
      <ha-card>
        ${this._config.title ? html`<div class="header">${this._config.title}</div>` : nothing}
        ${this._error
          ? html`<pre class="error">${this._error}</pre>`
          : nothing}
        <div class="echarts-container" style="height:${this._config.height}"></div>
      </ha-card>
    `;
  }

  static styles = css`
    :host { display: block; }
    ha-card { overflow: hidden; }
    .header { padding: 12px 16px 0; font-size: 16px; font-weight: 600; }
    .echarts-container { width: 100%; min-height: 120px; }
    .error { margin: 12px; color: var(--error-color); white-space: pre-wrap; }
  `;
}

if (!customElements.get("echarts-raw-card")) {
  customElements.define("echarts-raw-card", EchartsRawCard);
}
