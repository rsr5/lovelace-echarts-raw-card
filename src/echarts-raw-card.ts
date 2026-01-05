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

type HistoryMode = "values" | "series";

type HistoryGenerator = {
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
  };
};

/* ------------------------------------------------------------------
 * Guards + helpers
 * ------------------------------------------------------------------ */

function isDataGenerator(v: unknown): v is DataGenerator {
  return !!v && typeof v === "object" && !Array.isArray(v) && "$data" in v;
}

function isHistoryGenerator(v: unknown): v is HistoryGenerator {
  return !!v && typeof v === "object" && !Array.isArray(v) && "$history" in v;
}

function isTokenObject(v: unknown): v is TokenObject {
  return !!v && typeof v === "object" && !Array.isArray(v) && "$entity" in v;
}

function containsHistoryToken(input: unknown): boolean {
  if (!input) return false;
  if (isHistoryGenerator(input)) return true;
  if (Array.isArray(input)) return input.some(containsHistoryToken);
  if (typeof input === "object") {
    return Object.values(input as Record<string, unknown>).some(containsHistoryToken);
  }
  return false;
}

function normalizeEntitySpec(e: EntitySpec): { id: string; name?: string } {
  return typeof e === "string" ? { id: e } : e;
}

function parseTime(t: string | number | undefined, fallbackMs: number): number {
  if (t == null) return fallbackMs;
  if (typeof t === "number") return t;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : fallbackMs;
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

/**
 * Apply coerce + transforms (used by $data and by $history).
 */
function applyTransformsWithSpec(
  value: unknown,
  entityId: string,
  def: unknown,
  coerce: TokenObject["$coerce"] | undefined,
  transforms: DataGenerator["$data"]["transforms"] | undefined
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
    $round: transforms?.round
  };

  return applyNumberTransforms(coerced, token);
}

/**
 * History datapoints MUST be numeric for ECharts time/value series.
 * Default coerce for history is "number" (HA history states are strings).
 */
function coerceHistoryPointNumber(
  raw: unknown,
  entityId: string,
  def: unknown,
  coerce: TokenObject["$coerce"] | undefined,
  transforms: DataGenerator["$data"]["transforms"] | undefined
): number | undefined {
  const coerceMode: TokenObject["$coerce"] = coerce ?? "number";
  const v = applyTransformsWithSpec(raw, entityId, def, coerceMode, transforms);
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function resolveEntityNowValue(
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

/* ------------------------------------------------------------------
 * History decoding helpers (supports "compressed" arrays)
 * ------------------------------------------------------------------ */

type HistoryStateLike = Record<string, any>;

function histEntityId(s: HistoryStateLike): string | undefined {
  return (s.entity_id ?? s.e ?? s.id) as string | undefined;
}

function histState(s: HistoryStateLike): unknown {
  return s.state ?? s.s ?? s.st;
}

function histAttributes(s: HistoryStateLike): Record<string, unknown> | undefined {
  const a = s.attributes ?? s.a ?? s.attr;
  return a && typeof a === "object" ? (a as Record<string, unknown>) : undefined;
}

function histTimestampMs(s: HistoryStateLike): number | undefined {
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

/* ------------------------------------------------------------------
 * Simple downsampling (bucket mean/last)
 * ------------------------------------------------------------------ */

function downsample(
  points: Array<[number, unknown]>,
  maxPoints: number,
  method: "mean" | "last"
): Array<[number, unknown]> {
  if (points.length <= maxPoints || maxPoints <= 1) return points;
  const firstT = points[0][0];
  const lastT = points[points.length - 1][0];
  const span = Math.max(1, lastT - firstT);
  const bucketSize = span / maxPoints;

  const buckets: Array<Array<[number, unknown]>> = Array.from({ length: maxPoints }, () => []);
  for (const p of points) {
    const idx = Math.min(maxPoints - 1, Math.floor((p[0] - firstT) / bucketSize));
    buckets[idx].push(p);
  }

  const out: Array<[number, unknown]> = [];
  for (const b of buckets) {
    if (b.length === 0) continue;
    const t = b[b.length - 1][0];

    if (method === "last") {
      out.push([t, b[b.length - 1][1]]);
      continue;
    }

    let sum = 0;
    let count = 0;
    for (const [, v] of b) {
      const n = Number(v);
      if (Number.isFinite(n)) {
        sum += n;
        count += 1;
      }
    }
    out.push([t, count ? sum / count : b[b.length - 1][1]]);
  }

  return out;
}

/* ------------------------------------------------------------------
 * Resolver (async for $history)
 * ------------------------------------------------------------------ */

async function deepResolveTokensAsync(
  input: unknown,
  hass: HomeAssistant | undefined,
  watched: Set<string>,
  fetchHistory: (spec: HistoryGenerator["$history"]) => Promise<unknown>
): Promise<unknown> {
  if (isHistoryGenerator(input)) {
    return fetchHistory(input.$history);
  }

  if (isDataGenerator(input)) {
    const spec = input.$data;
    const mode: DataMode = spec.mode ?? "pairs";
    const nameFrom = spec.name_from ?? "friendly_name";

    const includeLegacy = spec.include_unavailable ?? false;
    const excludeUnavailable = spec.exclude_unavailable ?? true;
    const includeMissing = includeLegacy || !excludeUnavailable;

    const excludeZero = spec.exclude_zero ?? false;
    const sort = spec.sort ?? "none";
    const limit = spec.limit;

    let rows: Array<{ name: string; value: unknown }> = [];

    for (const rawSpec of spec.entities ?? []) {
      const { id, name: override } = normalizeEntitySpec(rawSpec);
      const st = hass?.states?.[id];
      if (!st && !includeMissing) continue;

      const name =
        override ??
        (nameFrom === "entity_id"
          ? id
          : (st?.attributes?.friendly_name as string | undefined) ?? id);

      const value = resolveEntityNowValue(hass, id, spec, watched);

      if (excludeZero && Number(value) === 0) continue;
      rows.push({ name, value });
    }

    if (sort === "asc" || sort === "desc") {
      rows.sort((a, b) => (Number(a.value) - Number(b.value)) * (sort === "asc" ? 1 : -1));
    }

    if (typeof limit === "number") rows = rows.slice(0, limit);

    if (mode === "pairs") return rows;
    if (mode === "names") return rows.map((r) => r.name);
    return rows.map((r) => r.value);
  }

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
    for (const x of input) out.push(await deepResolveTokensAsync(x, hass, watched, fetchHistory));
    return out;
  }

  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = await deepResolveTokensAsync(v, hass, watched, fetchHistory);
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
    _error: { state: true },
    _loading: { state: true }
  };

  public hass?: HomeAssistant;

  private _config?: EchartsRawCardConfig;
  private _error?: string;
  private _loading?: boolean;
  private _runId = 0;

  private _chart?: ECharts;
  private _resizeObserver?: ResizeObserver;

  private _watchedEntities = new Set<string>();
  private _lastFingerprints = new Map<string, string>();

  private _historyCache = new Map<string, { ts: number; value: unknown; expiresAt: number }>();

  public setConfig(config: LovelaceCardConfig): void {
    if (!config) throw new Error("Invalid configuration");
    if (!("option" in config)) throw new Error("Missing required `option`");

    this._config = { height: "300px", renderer: "canvas", ...config } as EchartsRawCardConfig;

    this._error = undefined;
    this._loading = false;
    this._watchedEntities.clear();
    this._lastFingerprints.clear();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
    this._chart?.dispose();
    this._chart = undefined;
    this._runId++;
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
    if (changed.has("_config")) {
      this._applyOption();
      return;
    }

    if (changed.has("hass")) {
      if (this._shouldUpdateForHassChange()) {
        this._applyOption();
      }
    }
  }

  private _shouldUpdateForHassChange(): boolean {
    if (!this._config?.option) return false;
    if (this._watchedEntities.size === 0) return false;
    if (!this.hass?.states) return false;

    for (const entityId of this._watchedEntities) {
      const st = this.hass.states[entityId];
      const fp = st ? `${st.state}|${st.last_updated}` : "missing";
      const prev = this._lastFingerprints.get(entityId);
      if (prev !== fp) return true;
    }
    return false;
  }

  private _snapshotFingerprints(): void {
    if (!this.hass?.states) return;
    for (const entityId of this._watchedEntities) {
      const st = this.hass.states[entityId];
      const fp = st ? `${st.state}|${st.last_updated}` : "missing";
      this._lastFingerprints.set(entityId, fp);
    }
  }

  private _historyCacheKey(spec: HistoryGenerator["$history"], startMs: number, endMs: number): string {
    const ids = (spec.entities ?? []).map((e) => normalizeEntitySpec(e).id).join(",");
    const sample = spec.sample ? `${spec.sample.max_points}:${spec.sample.method ?? "mean"}` : "";
    return [
      ids,
      startMs,
      endMs,
      spec.attr ?? "",
      spec.coerce ?? "number",
      JSON.stringify(spec.transforms ?? {}),
      spec.mode ?? "",
      spec.series_type ?? "",
      sample
    ].join("|");
  }

  private async _fetchHistory(spec: HistoryGenerator["$history"]): Promise<unknown> {
    if (!this.hass) return [];

    const now = Date.now();
    const endMs = parseTime(spec.end, now);
    const startMs =
      spec.start != null
        ? parseTime(spec.start, endMs - 24 * 3600_000)
        : endMs - (spec.hours ?? 24) * 3600_000;

    for (const e of spec.entities ?? []) this._watchedEntities.add(normalizeEntitySpec(e).id);

    const cacheSeconds = spec.cache_seconds ?? 30;
    const cacheKey = this._historyCacheKey(spec, startMs, endMs);
    const cached = this._historyCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.value;

    const startIso = new Date(startMs).toISOString();
    const endIso = new Date(endMs).toISOString();
    const entityIds = (spec.entities ?? []).map((e) => normalizeEntitySpec(e).id);

    const params = new URLSearchParams();
    params.set("end_time", endIso);
    params.set("minimal_response", "1");
    for (const id of entityIds) params.append("filter_entity_id", id);

    // @ts-expect-error: HA has callApi at runtime
    const hist = (await this.hass.callApi(
      "GET",
      `history/period/${startIso}?${params.toString()}`
    )) as Array<Array<Record<string, any>>>;

    const nameFrom = spec.name_from ?? "friendly_name";
    const seriesType = spec.series_type ?? "line";
    const showSymbol = spec.show_symbol ?? false;

    const idToName = new Map<string, string>();
    for (const raw of spec.entities ?? []) {
      const { id, name: override } = normalizeEntitySpec(raw);
      const st = this.hass.states?.[id];
      const name =
        override ??
        (nameFrom === "entity_id"
          ? id
          : (st?.attributes?.friendly_name as string | undefined) ?? id);
      idToName.set(id, name);
    }

    const perEntity: Record<string, Array<[number, number]>> = {};
    for (const id of entityIds) perEntity[id] = [];

    // IMPORTANT FIX:
    // Each inner array is ONE ENTITY'S history. First row may contain entity_id/attrs,
    // later rows often only contain state + last_changed.
    for (const arr of hist ?? []) {
      let currentId: string | undefined;
      let lastAttrs: Record<string, unknown> | undefined;

      for (const s of arr ?? []) {
        const maybeId = histEntityId(s);
        if (maybeId) currentId = maybeId;

        const attrs = histAttributes(s);
        if (attrs) lastAttrs = attrs;

        if (!currentId || !perEntity[currentId]) {
          // If the first row hasn't told us the id yet, we can't do anything with this datapoint.
          continue;
        }

        const ts = histTimestampMs(s);
        if (ts == null) continue;

        const raw = spec.attr ? (attrs ?? lastAttrs)?.[spec.attr] : histState(s);

        const n = coerceHistoryPointNumber(raw, currentId, spec.default, spec.coerce, spec.transforms);
        if (n == null) continue;

        perEntity[currentId].push([ts, n]);
      }
    }

    for (const id of entityIds) perEntity[id].sort((a, b) => a[0] - b[0]);

    if (spec.sample?.max_points && spec.sample.max_points > 1) {
      const method = spec.sample.method ?? "mean";
      for (const id of entityIds) {
        perEntity[id] = downsample(
          perEntity[id] as Array<[number, unknown]>,
          spec.sample.max_points,
          method
        ) as Array<[number, number]>;
      }
    }

    const inferredMode: HistoryMode = spec.mode ?? (entityIds.length > 1 ? "series" : "values");

    let result: unknown;

    if (inferredMode === "values") {
      const id = entityIds[0];
      result = perEntity[id] ?? [];
    } else {
      result = entityIds.map((id) => ({
        name: idToName.get(id) ?? id,
        type: seriesType,
        showSymbol,
        data: perEntity[id] ?? []
      }));
    }

    this._historyCache.set(cacheKey, {
      ts: now,
      value: result,
      expiresAt: now + cacheSeconds * 1000
    });

    return result;
  }

  private _applyOption(): void {
    void this._applyOptionAsync();
  }

  private async _applyOptionAsync(): Promise<void> {
    const chart = this._chart;
    const hass = this.hass;
    const config = this._config;

    if (!config?.option || !chart) return;

    const runId = ++this._runId;

    const needsHistory = containsHistoryToken(config.option);
    if (needsHistory) this._loading = true;
    this._error = undefined;

    try {
      const watched = new Set<string>();

      const resolved = (await deepResolveTokensAsync(
        config.option,
        hass,
        watched,
        async (spec) => this._fetchHistory(spec)
      )) as EChartsOption;

      if (runId !== this._runId) return;
      if (this._chart !== chart) return;

      this._watchedEntities = watched;

      const opt = resolved as Record<string, unknown>;
      const option: EChartsOption =
        opt && Object.prototype.hasOwnProperty.call(opt, "backgroundColor")
          ? resolved
          : ({ backgroundColor: "transparent", ...resolved } as EChartsOption);

      const opts: SetOptionOpts = { notMerge: true, lazyUpdate: true };

      chart.setOption(option, opts);
      this._snapshotFingerprints();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._error = msg;
      // eslint-disable-next-line no-console
      console.error("[echarts-raw-card] applyOption error:", err);
    } finally {
      if (runId === this._runId) {
        this._loading = false;
      }
    }
  }

  protected render() {
    if (!this._config) return nothing;
    const title = (this._config.title as string | undefined) ?? "";

    return html`
      <ha-card>
        ${title ? html`<div class="header">${title}</div>` : nothing}

        ${this._error
          ? html`
              <div class="error">
                <div class="error-title">ECharts configuration error</div>
                <pre class="error-details">${this._error}</pre>
              </div>
            `
          : nothing}

        <div class="wrap" style="height: ${this._config.height ?? "300px"}">
          <div class="echarts-container"></div>
          ${this._loading
            ? html`
                <div class="loading">
                  <div class="spinner"></div>
                  <div class="loading-text">Loading…</div>
                </div>
              `
            : nothing}
        </div>
      </ha-card>
    `;
  }

  static styles = css`
    :host {
      display: block;
    }
    ha-card {
      overflow: hidden;
    }
    .header {
      padding: 12px 16px 0 16px;
      font-size: 16px;
      font-weight: 600;
    }

    .wrap {
      position: relative;
      width: 100%;
      min-height: 120px;
    }

    .echarts-container {
      width: 100%;
      height: 100%;
      min-height: 120px;
    }

    .loading {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      background: color-mix(in srgb, var(--card-background-color) 70%, transparent);
      backdrop-filter: blur(2px);
    }
    .spinner {
      width: 18px;
      height: 18px;
      border-radius: 999px;
      border: 2px solid color-mix(in srgb, var(--primary-text-color) 30%, transparent);
      border-top-color: var(--primary-text-color);
      animation: spin 0.9s linear infinite;
    }
    .loading-text {
      font-size: 13px;
      opacity: 0.8;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    .error {
      margin: 12px 16px 0 16px;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--error-color);
      background: color-mix(in srgb, var(--error-color) 10%, transparent);
    }
    .error-title {
      font-weight: 600;
      margin-bottom: 6px;
    }
    .error-details {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: var(
        --code-font-family,
        ui-monospace,
        SFMono-Regular,
        Menlo,
        Monaco,
        Consolas,
        "Liberation Mono",
        "Courier New",
        monospace
      );
      font-size: 12px;
      line-height: 1.35;
    }
  `;
}

// Register element (no decorators)
if (!customElements.get("echarts-raw-card")) {
  customElements.define("echarts-raw-card", EchartsRawCard);
}

declare global {
  interface HTMLElementTagNameMap {
    "echarts-raw-card": EchartsRawCard;
  }
}
