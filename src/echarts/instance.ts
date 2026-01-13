import type { ECharts } from "echarts";
import * as echarts from "echarts";

export function getContainer(root: ShadowRoot): HTMLDivElement | null {
  return root.querySelector(".echarts-container") as HTMLDivElement | null;
}

export function hasSize(el: HTMLElement): boolean {
  return el.clientWidth > 0 && el.clientHeight > 0;
}

export function getAttachedInstance(el: HTMLElement): ECharts | undefined {
  try {
    return echarts.getInstanceByDom(el) as unknown as ECharts | undefined;
  } catch {
    return undefined;
  }
}

export function initChart(
  el: HTMLElement,
  theme: string | undefined,
  renderer: "canvas" | "svg"
): ECharts {
  return echarts.init(el, theme, { renderer }) as unknown as ECharts;
}

export function disposeChart(chart?: ECharts): void {
  if (!chart) return;
  try {
    chart.dispose();
  } catch {
    // ignore
  }
}

export function safeResize(chart: ECharts, el: HTMLElement): void {
  if (!hasSize(el)) return;
  try {
    chart.resize();
  } catch {
    // If resize throws, dispose and let caller recreate cleanly.
    disposeChart(chart);
  }
}
