import "./echarts-raw-card";

// Optional: show up in the Lovelace “Custom cards” list in the UI
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).customCards = (window as any).customCards || [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).customCards.push({
  type: "echarts-raw-card",
  name: "ECharts Raw Card",
  description: "Render raw Apache ECharts option objects in Lovelace."
});
