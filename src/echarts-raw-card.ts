import { LitElement, css, html, nothing } from "lit";
import type { ECharts, EChartsOption, SetOptionOpts } from "echarts";
import type { HomeAssistant, LovelaceCardConfig } from "./ha-types";

import type { EchartsRawCardConfig, HistoryGenerator } from "./types";

import { containsHistoryToken } from "./tokens/guards";
import { deepResolveTokensAsync } from "./tokens/resolve";

import { minHistoryCacheSecondsInOptionTree } from "./history/cache-ttl";
import { fetchHistory } from "./history/fetch";

import {
  disposeChart,
  getAttachedInstance,
  getContainer,
  hasSize,
  initChart,
  safeResize,
} from "./echarts/instance";

import { shouldUpdateForHassChange, snapshotFingerprints } from "./card/watched";

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
    _warning: { state: true },
    _loading: { state: true },
    _debugResolvedOptionText: { state: true },
  };

  public hass?: HomeAssistant;

  private _config?: EchartsRawCardConfig;
  private _error?: string;
  private _warning?: string;
  private _loading?: boolean;
  private _debugResolvedOptionText?: string;
  private _runId = 0;

  private _chart?: ECharts;
  private _resizeObserver?: ResizeObserver;

  private _isConnected = false;
  private _onVisibilityOrPageShow?: () => void;

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
    this._warning = undefined;
    this._loading = false;
    this._debugResolvedOptionText = undefined;
    this._watchedEntities.clear();
    this._lastFingerprints.clear();

    // reset throttle on config change
    this._nextHistoryAllowedMs = 0;

    // ensure theme is re-evaluated after config changes
    this._echartsTheme = undefined;
  }

  private _debugFlags(): {
    showResolvedOption: boolean;
    logResolvedOption: boolean;
    maxChars: number;
  } {
    const dbg = this._config?.debug;

    // default: off
    if (!dbg) return { showResolvedOption: false, logResolvedOption: false, maxChars: 50_000 };

    // debug: true => enable both
    if (dbg === true)
      return { showResolvedOption: true, logResolvedOption: true, maxChars: 50_000 };

    const showResolvedOption = dbg.show_resolved_option ?? false;
    const logResolvedOption = dbg.log_resolved_option ?? false;
    const maxChars =
      typeof dbg.max_chars === "number" && dbg.max_chars > 0 ? dbg.max_chars : 50_000;
    return { showResolvedOption, logResolvedOption, maxChars };
  }

  private _safeStringify(value: unknown, maxChars: number): string {
    const seen = new WeakSet<object>();

    const json = JSON.stringify(
      value,
      (_key, v) => {
        if (typeof v === "object" && v !== null) {
          if (seen.has(v as object)) return "[Circular]";
          seen.add(v as object);
        }
        if (typeof v === "bigint") return v.toString();
        if (typeof v === "function") return "[Function]";
        return v;
      },
      2,
    );

    if (json.length <= maxChars) return json;
    return `${json.slice(0, maxChars)}\n\n… [truncated: ${json.length - maxChars} chars omitted]`;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._isConnected = false;

    if (this._onVisibilityOrPageShow) {
      window.removeEventListener("pageshow", this._onVisibilityOrPageShow);
      document.removeEventListener("visibilitychange", this._onVisibilityOrPageShow);
      this._onVisibilityOrPageShow = undefined;
    }

    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;

    disposeChart(this._chart);
    this._chart = undefined;

    this._runId++;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._isConnected = true;

    // When navigating between Lovelace views, cards can be kept alive and become
    // hidden/shown without a full disconnect. ECharts frequently needs an
    // explicit resize once the element is visible again; otherwise it can render
    // as a blank canvas/SVG.
    if (!this._onVisibilityOrPageShow) {
      this._onVisibilityOrPageShow = () => {
        if (!this._isConnected) return;

        const el = this._getContainer();
        if (!el) return;

        // If we're still not laid out, let ResizeObserver handle it later.
        if (!this._hasSize(el)) return;

        // Ensure chart exists and then resize/apply option defensively.
        this._ensureChart();
        if (!this._chart) return;

        safeResize(this._chart, el);

        // If we have config but chart became detached/recreated, re-apply.
        // This is safe due to the internal runId cancellation.
        if (this._config?.option) this._applyOption();
      };

      window.addEventListener("pageshow", this._onVisibilityOrPageShow);
      document.addEventListener("visibilitychange", this._onVisibilityOrPageShow);
    }
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
    // If debug is enabled, log once early so users can confirm config is being read.
    // (applyOption can be deferred until the container has a real size.)
    if (this._config?.debug) {
      console.info("[echarts-raw-card] debug enabled:", this._config.debug);
    }

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

      // When HA navigates between views, the container can bounce through 0x0.
      // After size returns, we may need to re-apply the option to avoid a blank chart.
      if (this._chart && this._config?.option) this._applyOption();
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

      if (shouldUpdateForHassChange(this.hass, this._watchedEntities, this._lastFingerprints)) {
        this._applyOption();
      }
    }
  }

  private async _fetchHistory(spec: HistoryGenerator["$history"]): Promise<unknown> {
    if (!this.hass) return [];

    try {
      return await fetchHistory({
        hass: this.hass,
        spec,
        watchedEntities: this._watchedEntities,
        cache: this._historyCache,
        nowMs: Date.now(),
      });
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e?.code === "ECHARTS_RAW_CARD_INVALID_HISTORY_TIME") {
        // Non-fatal: drop this $history value, keep rendering the rest of the option.
        this._warning = e.message;

        // Preserve the expected data shape as best we can.
        // - mode=values expects array of [ts,value]
        // - mode=series expects array of series objects
        const mode = spec.mode ?? (spec.entities && spec.entities.length > 1 ? "series" : "values");
        if (mode === "series") return [];
        return [];
      }
      throw err;
    }
  }

  private _applyOption(): void {
    void this._applyOptionAsync();
  }

  private _findFunctions(value: unknown, path = "option"): string[] {
    const out: string[] = [];
    const seen = new WeakSet<object>();

    const walk = (v: unknown, p: string) => {
      if (typeof v === "function") {
        out.push(p);
        return;
      }
      if (typeof v !== "object" || v === null) return;
      if (seen.has(v as object)) return;
      seen.add(v as object);

      if (Array.isArray(v)) {
        v.forEach((item, idx) => walk(item, `${p}[${idx}]`));
        return;
      }
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        walk(child, `${p}.${k}`);
      }
    };

    walk(value, path);
    return out;
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
    this._warning = undefined;

    try {
      const watched = new Set<string>();

      const resolved = (await deepResolveTokensAsync(config.option, hass, watched, async (spec) =>
        this._fetchHistory(spec),
      )) as EChartsOption;

      // cancelled/replaced
      if (runId !== this._runId) return;

      // chart might have been recreated while we awaited history
      this._ensureChart();
      if (!this._chart) return;

      this._watchedEntities = watched;
      this._warning = undefined;

      const opt = resolved as Record<string, unknown>;
      const option: EChartsOption =
        opt && Object.prototype.hasOwnProperty.call(opt, "backgroundColor")
          ? resolved
          : ({ backgroundColor: "transparent", ...resolved } as EChartsOption);

      // YAML card configs can't express real JS functions; users often paste
      // `(p) => ...` expecting it to work. If we detect any functions, surface
      // a clear warning because ECharts can fail silently and render blank.
      const fnPaths = this._findFunctions(option);
      if (fnPaths.length > 0) {
        const msg =
          `This card config contains JavaScript functions at: ${fnPaths.join(", ")}. ` +
          `Home Assistant YAML config does not support real function values inside the ` +
          `ECharts option. Use string templates supported by ECharts, or move advanced ` +
          `formatting into a token/transform. Disabling those functions should make the ` +
          `chart render.`;

        this._warning = `[echarts-raw-card] ${msg}`;

        if (this._debugFlags().logResolvedOption) {
          console.warn("[echarts-raw-card]", msg);
        }
      }

      // Debug: store and/or log the *resolved* option (after token resolution)
      const dbg = this._debugFlags();
      if (dbg.showResolvedOption || dbg.logResolvedOption) {
        const text = this._safeStringify(option, dbg.maxChars);
        this._debugResolvedOptionText = text;
        if (dbg.logResolvedOption) {
          console.debug("[echarts-raw-card] resolved option:", option);
        }
      } else {
        this._debugResolvedOptionText = undefined;
      }

      const opts: SetOptionOpts = { notMerge: true, lazyUpdate: true };

      this._chart.setOption(option, opts);
      snapshotFingerprints(this.hass, this._watchedEntities, this._lastFingerprints);

      // Resize once after setting option (helps when HA lays out late)
      safeResize(this._chart, el);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._error = msg;

      // DO NOT clear() here; it can wedge ECharts into a blank state during resize/layout churn.
      // If you want a hard reset, dispose and let the ResizeObserver recreate it.
      disposeChart(this._chart);
      this._chart = undefined;

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
    const dbg = this._debugFlags();

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
        ${this._warning
          ? html`
              <div class="warning">
                <div class="warning-title">Warning</div>
                <pre class="warning-details">${this._warning}</pre>
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

        ${dbg.showResolvedOption && this._debugResolvedOptionText
          ? html`
              <details class="debug">
                <summary>Debug: resolved ECharts option</summary>
                <div class="debug-hint">Tip: open this card in the editor and copy from below.</div>
                <pre class="debug-pre">${this._debugResolvedOptionText}</pre>
              </details>
            `
          : nothing}
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

    .warning {
      margin: 12px 16px 0 16px;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--warning-color, #b26a00);
      background: color-mix(in srgb, var(--warning-color, #b26a00) 10%, transparent);
    }
    .warning-title {
      font-weight: 600;
      margin-bottom: 6px;
    }
    .warning-details {
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
      opacity: 0.9;
    }

    details.debug {
      margin: 10px 16px 14px 16px;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid color-mix(in srgb, var(--primary-text-color) 18%, transparent);
      background: color-mix(in srgb, var(--card-background-color) 85%, #000 0%);
    }
    details.debug > summary {
      cursor: pointer;
      user-select: none;
      font-weight: 600;
    }
    .debug-hint {
      margin-top: 6px;
      font-size: 12px;
      opacity: 0.75;
    }
    .debug-pre {
      margin: 10px 0 0 0;
      max-height: 320px;
      overflow: auto;
      white-space: pre;
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
