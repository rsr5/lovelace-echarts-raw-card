import { defineConfig } from "vite";

const isProd = !!process.env.CI || process.env.BUILD_MODE === "production";

export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env": {},
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
      "Access-Control-Allow-Headers": "*",
    },
  },

  // ─────────────────────────────────────────────
  // Build for Home Assistant
  // ─────────────────────────────────────────────
  build: {
    // HA + modern browsers are fine with this
    target: "es2022",

    // Source maps always (readable stack traces)
    sourcemap: true,

    // Minify in production (CI / BUILD_MODE=production), skip for local dev debugging
    minify: isProd ? "esbuild" : false,

    // HA prefers single-file JS
    cssCodeSplit: false,

    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "echarts-raw-card.js",
    },

    rollupOptions: {
      output: {
        // 🔴 Force everything into ONE file
        inlineDynamicImports: true,
      },
    },

    outDir: "dist",
    emptyOutDir: true,
  },

  // ─────────────────────────────────────────────
  // esbuild settings — keep function/class names in dev for readable stack traces
  // ─────────────────────────────────────────────
  esbuild: {
    keepNames: !isProd,
  },
});
