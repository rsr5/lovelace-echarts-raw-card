import { defineConfig } from "vite";

export default defineConfig({
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
  build: {
    target: "es2022",
    sourcemap: false,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "echarts-raw-card.js"
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    },
    outDir: "dist",
    emptyOutDir: true
  }
});

