// src/index.ts

// ECharts (or its deps) can reference `process` in browser bundles.
// Home Assistant's frontend doesn't define it, so provide a minimal shim.
const w = window as any;
w.process = w.process || { env: {} };

// Now load the card after the shim exists.
import("./echarts-raw-card");

// Optional: show up in the Lovelace “Custom cards” list
w.customCards = w.customCards || [];
w.customCards.push({
  type: "echarts-raw-card",
  name: "ECharts Raw Card",
  description: "Render raw Apache ECharts option objects in Lovelace."
});
