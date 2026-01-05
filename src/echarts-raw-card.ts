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

type TokenObject = {
  $entity: string;
  $attr?: string;
  $coerce?: "auto" | "number" | "string" | "bool";
  $default?: unknown;
};

function isTokenObject(v: unknown): v is TokenObject {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.prototype.hasOwnProperty.call(v, "$entity");
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

function deepResolveTokens(
  input: unknown,
  hass: HomeAssistant | undefined,
  watched: Set<string>
): unknown {
  if (isTokenObject(input)) {
    const entityId = input.$entity;
    watched.add(entityId);

    const st = hass?.states?.[entityId];
    if (!st) return input.$default;

    const raw = input.$attr
      ? (st.attributes?.[input.$attr] as unknown)
      : (st.state as unknown);

    const coerced = coerceValue(raw, input.$coerce ?? "auto");

    if (typeof coerced === "number" && Number.isNaN(coerced)) {
    return input.$default ?? 0;
    }
    return coerced ?? input.$default;
  }

  if (Array.isArray(input)) {
    return input.map((x) => deepResolveTokens(x, hass, watched));
  }

  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = deepResolveTokens(v, hass, watched);
    }
    return out;
  }

  return input;
}

export class EchartsRawCard extends LitElement {
  // Lit reactive properties (no decorators)
  static properties = {
    hass: { attribute: false },
    _config: { state: true },
    _error: { state: true }
  };

  public hass?: HomeAssistant;

  // "state" properties (tracked by Lit)
  private _config?: EchartsRawCardConfig;
  private _error?: string;

  private _chart?: ECharts;
  private _resizeObserver?: ResizeObserver;

  // Phase 2.1: keep track of referenced entities and their last seen values
  private _watchedEntities = new Set<string>();
  private _lastFingerprints = new Map<string, string>();

  public setConfig(config: LovelaceCardConfig): void {
    if (!config) throw new Error("Invalid configuration");
    if (!("option" in config)) throw new Error("Missing required `option`");

    this._config = {
      height: "300px",
      renderer: "canvas",
      ...config
    } as EchartsRawCardConfig;

    this._error = undefined;
    // Recompute watched entities on next apply
    this._watchedEntities.clear();
    this._lastFingerprints.clear();
  }

  public getCardSize(): number {
    return 3;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();

    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = undefined;
    }
    if (this._chart) {
      this._chart.dispose();
      this._chart = undefined;
    }
  }

  protected firstUpdated(): void {
    const container = this.renderRoot.querySelector(
      ".echarts-container"
    ) as HTMLDivElement | null;

    if (!container) return;

    this._chart = echarts.init(container, undefined, {
      renderer: this._config?.renderer ?? "canvas"
    });

    this._resizeObserver = new ResizeObserver(() => {
      this._chart?.resize();
    });
    this._resizeObserver.observe(container);

    this._applyOption();
  }

  protected updated(changed: Map<string, unknown>): void {
    // Config changes
    if (changed.has("_config")) {
      const oldConfig = changed.get("_config") as EchartsRawCardConfig | undefined;

      if (
        oldConfig?.renderer &&
        this._config?.renderer &&
        oldConfig.renderer !== this._config.renderer
      ) {
        this._reinitChart();
        return;
      }

      this._applyOption();
      return;
    }

    // Phase 2.1: hass updates — re-render only if a referenced entity changed
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
      // Fingerprint includes state + last_updated; good enough for Phase 2.1
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

  private _reinitChart(): void {
    const container = this.renderRoot.querySelector(
      ".echarts-container"
    ) as HTMLDivElement | null;

    if (!container) return;

    if (this._chart) {
      this._chart.dispose();
      this._chart = undefined;
    }

    this._chart = echarts.init(container, undefined, {
      renderer: this._config?.renderer ?? "canvas"
    });

    this._applyOption();
    this._chart.resize();
  }

  private _applyOption(): void {
    if (!this._config?.option) return;
    if (!this._chart) return;

    this._error = undefined;

    // Resolve entity tokens (Phase 2.1)
    const watched = new Set<string>();
    const resolved = deepResolveTokens(this._config.option, this.hass, watched) as EChartsOption;
    this._watchedEntities = watched;

    // Default transparent background unless user set backgroundColor
    const opt = resolved as Record<string, unknown>;
    const option: EChartsOption =
      opt && Object.prototype.hasOwnProperty.call(opt, "backgroundColor")
        ? resolved
        : ({ backgroundColor: "transparent", ...resolved } as EChartsOption);

    const opts: SetOptionOpts = {
      notMerge: true,
      lazyUpdate: true
    };

    try {
      this._chart.setOption(option, opts);
      // Capture fingerprints after successful render so future hass updates can be diffed
      this._snapshotFingerprints();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._error = msg;
      // eslint-disable-next-line no-console
      console.error("[echarts-raw-card] setOption error:", err);
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

        <div
          class="echarts-container"
          style="height: ${this._config.height ?? "300px"}"
        ></div>
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
    .echarts-container {
      width: 100%;
      min-height: 120px;
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
