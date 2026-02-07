import "./echarts-raw-card";

// Console banner (similar vibe to other HA custom cards)
(() => {
  const name = "ECharts Raw Card";
  const version = "1.0.3"; // keep in sync with package.json or replace later
  const badgeStyle =
    "background:#1f2937;color:#fff;padding:2px 8px;border-radius:999px;font-weight:600;";
  const nameStyle =
    "background:#111827;color:#fff;padding:2px 8px;border-radius:6px 0 0 6px;font-weight:700;";
  const verStyle =
    "background:#374151;color:#fff;padding:2px 8px;border-radius:0 6px 6px 0;font-weight:700;";

  // One line banner
  console.info(`%c${name}%c v${version}`, nameStyle, verStyle);

  // Optional extra line (like many cards do)
  console.info(`%cLoaded`, badgeStyle);
})();

// Register for Lovelace custom cards list
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- HA global window.customCards is untyped
(window as any).customCards = (window as any).customCards || [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- HA global window.customCards is untyped
(window as any).customCards.push({
  type: "echarts-raw-card",
  name: "ECharts Raw Card",
  description: "Render raw Apache ECharts option objects in Lovelace.",
});
