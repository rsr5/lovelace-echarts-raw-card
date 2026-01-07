import { defineConfig } from "vite";

export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env": {}
  },
  // ─────────────────────────────────────────────
  // Dev server (unchanged from yours)
  // ─────────────────────────────────────────────
  server: {
    host: true,
    port: 5173,
    cors: true,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  },

  // ─────────────────────────────────────────────
  // Build for Home Assistant
  // ─────────────────────────────────────────────
  build: {
    // HA + modern browsers are fine with this
    target: "es2022",

    // 🔴 KEEP stack traces readable while debugging
    sourcemap: true,

    // 🔴 DO NOT minify (critical for ECharts debugging)
    minify: false,

    // HA prefers single-file JS
    cssCodeSplit: false,

    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "echarts-raw-card.js"
    },

    rollupOptions: {
      output: {
        // 🔴 Force everything into ONE file
        inlineDynamicImports: true
      }
    },

    outDir: "dist",
    emptyOutDir: true
  },

  // ─────────────────────────────────────────────
  // Ensure esbuild doesn’t sneak minification in
  // ─────────────────────────────────────────────
  esbuild: {
    minify: false,
    keepNames: true
  }
});
