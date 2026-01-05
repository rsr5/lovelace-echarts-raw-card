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
  }

  public getCardSize(): number {
    return 3;
  }

  connectedCallback(): void {
    super.connectedCallback();
    // Create observer lazily after first render, but keep hook here
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
      // If renderer changed, need full re-init
      const oldConfig = changed.get("_config") as EchartsRawCardConfig | undefined;
      if (oldConfig?.renderer && this._config?.renderer && oldConfig.renderer !== this._config.renderer) {
        this._reinitChart();
        return;
      }
      this._applyOption();
    }

    // If hass changes: Phase 1 does nothing with it, but keep hook.
    if (changed.has("hass")) {
      // no-op (Phase 2 will use this)
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
    if (!this._chart || !this._config?.option) return;

    // Phase 1: pass through option as-is
    const option: EChartsOption = this._config.option;

    const opts: SetOptionOpts = {
      notMerge: true,
      lazyUpdate: true
    };

    try {
      this._chart.setOption(option, opts);
    } catch (err) {
      // Render error message in card if option is invalid
      // eslint-disable-next-line no-console
      console.error("[echarts-raw-card] setOption error:", err);
    }
  }

  protected render() {
    if (!this._config) return nothing;

    const title = (this._config.title as string | undefined) ?? "";

    return html`
      <ha-card>
        ${title
          ? html`<div class="header">${title}</div>`
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
  `;
}

// Allow TS to accept HA card custom element usage
declare global {
  interface HTMLElementTagNameMap {
    "echarts-raw-card": EchartsRawCard;
  }
}
