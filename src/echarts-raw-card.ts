import { LitElement, css, html, nothing } from "lit";
import type { ECharts, EChartsOption, SetOptionOpts } from "echarts";
import type { HomeAssistant, LovelaceCardConfig } from "./ha-types";

import type {
  DataGenerator,
  DataMode,
  EchartsRawCardConfig,
  EntitySpec,
  HistoryGenerator,
  HistoryMode,
  TokenMap,
  TokenObject
} from "./types";

import {
  containsHistoryToken,
  isDataGenerator,
  isHistoryGenerator,
  isTokenObject
} from "./tokens/guards";
import { normalizeEntitySpec, parseTime, resolveEntityNowValue } from "./tokens/entity";
import {
  applyNumberTransforms,
  applyTransformsWithSpec,
  coerceHistoryPointNumber,
  coerceValue
} from "./tokens/transforms";
import { deepResolveTokensAsync } from "./tokens/resolve";

import { minHistoryCacheSecondsInOptionTree } from "./history/cache-ttl";
import { fetchHistory } from "./history/fetch";

import {
  disposeChart,
  getAttachedInstance,
  getContainer,
  hasSize,
  initChart,
  safeResize
} from "./echarts/instance";

/* ------------------------------------------------------------------
 * Guards + helpers
 * ------------------------------------------------------------------ */

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

  // history cache
  private _historyCache = new Map<string, { ts: number; value: unknown; expiresAt: number }>();

  // prevent hass-driven re-fetch storms
  private _nextHistoryAllowedMs = 0;

  // track current ECharts theme ("dark" | undefined)
  private _echartsTheme: string | undefined;

  public setConfig(config: LovelaceCardConfig): void {
    if (!config) throw new Error("Invalid configuration");
    if (!("option" in config)) throw new Error("Missing required `option`");

    this._config = { height: "300px", renderer: "canvas", ...config } as EchartsRawCardConfig;

    this._error = undefined;
    this._loading = false;
    this._watchedEntities.clear();
    this._lastFingerprints.clear();

    // reset throttle on config change
    this._nextHistoryAllowedMs = 0;

    // ensure theme is re-evaluated after config changes
    this._echartsTheme = undefined;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;

    disposeChart(this._chart);
    this._chart = undefined;

    this._runId++;
  }

  // HA dark-mode helpers
  private _isHassDarkMode(hass: HomeAssistant | undefined): boolean {
    return Boolean(hass?.themes?.darkMode);
  }

  private _desiredEchartsTheme(hass: HomeAssistant | undefined): string | undefined {
    // ECharts built-in theme: "dark". Light is default (undefined)
    return this._isHassDarkMode(hass) ? "dark" : undefined;
  }

  // ---- NEW: size-safe init helpers ---------------------------------

  private _getContainer(): HTMLDivElement | null {
    return getContainer(this.renderRoot as ShadowRoot);
  }

  private _hasSize(el: HTMLElement): boolean {
    return hasSize(el);
  }

  private _ensureChart(): void {
    const el = this._getContainer();
    if (!el) return;

    // If element isn't laid out yet, wait for ResizeObserver
    if (!this._hasSize(el)) return;

    // If a chart instance is already bound to this DOM node, reuse it.
    const existing = getAttachedInstance(el);
    if (existing) {
      this._chart = existing;
      return;
    }

    // Create a new instance
    this._echartsTheme = this._desiredEchartsTheme(this.hass);
    this._chart = initChart(el, this._echartsTheme, this._config?.renderer ?? "canvas");
  }

  private _recreateChartForTheme(): void {
    const el = this._getContainer();
    if (!el) return;

    // If not laid out, drop chart; observer will recreate later when size returns.
    if (!this._hasSize(el)) {
      disposeChart(this._chart);
      this._chart = undefined;
      this._echartsTheme = this._desiredEchartsTheme(this.hass);
      return;
    }

    // Dispose old instance
    disposeChart(this._chart);
    this._chart = undefined;

    // Create new instance safely
    this._ensureChart();

    if (this._chart) {
      safeResize(this._chart, el);
    }
  }

  protected firstUpdated(): void {
    const el = this._getContainer();
    if (!el) return;

    const onResize = () => {
      // Ensure we have a chart once size exists
      this._ensureChart();

      // If we still don't have one (because size is 0), stop here
      if (!this._chart) return;

      // If size is 0, DO NOT call resize()
      if (!this._hasSize(el)) return;

      safeResize(this._chart, el);
      // If safeResize disposed it (due to an exception), drop reference.
      if (!getAttachedInstance(el)) this._chart = undefined;
    };

    this._resizeObserver = new ResizeObserver(onResize);
    this._resizeObserver.observe(el);

    // Try once now (may no-op if 0×0)
    onResize();

    // Only apply option when we actually have a chart
    if (this._chart) this._applyOption();
  }

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has("_config")) {
      // If renderer changed, recreate chart too (init opts include renderer)
      // Also, ensure chart exists (config can arrive before layout).
      if (this._chart) this._recreateChartForTheme();
      else this._ensureChart();

      this._applyOption();
      return;
    }

    if (changed.has("hass")) {
      // Detect HA theme (dark/light) switch and recreate ECharts instance
      const nextTheme = this._desiredEchartsTheme(this.hass);
      if (nextTheme !== this._echartsTheme) {
        this._recreateChartForTheme();
        this._applyOption();
        return;
      }

      // While a $history option is currently loading, don't restart due to hass churn.
      if (this._loading && this._config?.option && containsHistoryToken(this._config.option)) {
        return;
      }

      // If the card contains $history, do NOT continuously re-run on hass churn;
      // only allow once per cache window (minimum of all cache_seconds tokens).
      if (this._config?.option && containsHistoryToken(this._config.option)) {
        if (Date.now() < this._nextHistoryAllowedMs) return;
      }

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

  private async _fetchHistory(spec: HistoryGenerator["$history"]): Promise<unknown> {
    if (!this.hass) return [];

    return fetchHistory({
      hass: this.hass,
      spec,
      watchedEntities: this._watchedEntities,
      cache: this._historyCache,
      nowMs: Date.now()
    });
  }

  private _applyOption(): void {
    void this._applyOptionAsync();
  }

  private async _applyOptionAsync(): Promise<void> {
    const hass = this.hass;
    const config = this._config;

    if (!config?.option) return;

    // If container isn't laid out yet, wait for ResizeObserver to call again.
    const el = this._getContainer();
    if (!el || !this._hasSize(el)) return;

    // Ensure we have a valid chart instance
    this._ensureChart();
    if (!this._chart) return;

    const runId = ++this._runId;

    const needsHistory = containsHistoryToken(config.option);

    // optimistic throttle BEFORE awaiting history fetch, so hass churn can't restart mid-flight
    if (needsHistory) {
      const ttl = minHistoryCacheSecondsInOptionTree(config.option, 30) * 1000;
      this._nextHistoryAllowedMs = Date.now() + ttl;
      this._loading = true;
    }

    this._error = undefined;

    try {
      const watched = new Set<string>();

      const resolved = (await deepResolveTokensAsync(
        config.option,
        hass,
        watched,
        async (spec) => this._fetchHistory(spec)
      )) as EChartsOption;

      // cancelled/replaced
      if (runId !== this._runId) return;

      // chart might have been recreated while we awaited history
      this._ensureChart();
      if (!this._chart) return;

      this._watchedEntities = watched;

      const opt = resolved as Record<string, unknown>;
      const option: EChartsOption =
        opt && Object.prototype.hasOwnProperty.call(opt, "backgroundColor")
          ? resolved
          : ({ backgroundColor: "transparent", ...resolved } as EChartsOption);

      const opts: SetOptionOpts = { notMerge: true, lazyUpdate: true };

      this._chart.setOption(option, opts);
      this._snapshotFingerprints();

      // Resize once after setting option (helps when HA lays out late)
      safeResize(this._chart, el);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._error = msg;

      // DO NOT clear() here; it can wedge ECharts into a blank state during resize/layout churn.
      // If you want a hard reset, dispose and let the ResizeObserver recreate it.
      disposeChart(this._chart);
      this._chart = undefined;

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
