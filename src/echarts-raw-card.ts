import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ECharts, EChartsOption, SetOptionOpts } from "echarts";
import * as echarts from "echarts";
import type { HomeAssistant, LovelaceCardConfig } from "./ha-types";

type EchartsRawCardConfig = LovelaceCardConfig & {
  option: EChartsOption;
  height?: string;
  renderer?: "canvas" | "svg";
  title?: string;
};

@customElement("echarts-raw-card")
export class EchartsRawCard extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: EchartsRawCardConfig;
  @state() private _error?: string;

  private _chart?: ECharts;
  private _resizeObserver?: ResizeObserver;

  public setConfig(config: LovelaceCardConfig): void {
    if (!config) throw new Error("Invalid configuration");
    if (!("option" in config)) throw new Error("Missing required `option`");

    this._config = {
      height: "300px",
      renderer: "canvas",
      ...config
    } as EchartsRawCardConfig;

    // Clear any previous error on new config
    this._error = undefined;
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
    // If config changes, re-apply options
    if (changed.has("_config")) {
      const oldConfig = changed.get("_config") as EchartsRawCardConfig | undefined;

      // If renderer changed, need full re-init
      if (
        oldConfig?.renderer &&
        this._config?.renderer &&
        oldConfig.renderer !== this._config.renderer
      ) {
        this._reinitChart();
        return;
      }

      this._applyOption();
    }

    // Phase 1: hass isn't used yet
    if (changed.has("hass")) {
      // no-op
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

    // Chart might not be initialised yet (e.g., config set before firstUpdated)
    if (!this._chart) return;

    // Clear previous render error before trying again
    this._error = undefined;

    // Default to transparent background unless user explicitly set one
    const opt = this._config.option as Record<string, unknown>;
    const option: EChartsOption =
      opt && Object.prototype.hasOwnProperty.call(opt, "backgroundColor")
        ? this._config.option
        : ({ backgroundColor: "transparent", ...this._config.option } as EChartsOption);

    const opts: SetOptionOpts = {
      notMerge: true,
      lazyUpdate: true
    };

    try {
      this._chart.setOption(option, opts);
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
      font-family: var(--code-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);
      font-size: 12px;
      line-height: 1.35;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "echarts-raw-card": EchartsRawCard;
  }
}
