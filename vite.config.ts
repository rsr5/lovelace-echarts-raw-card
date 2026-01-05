import { defineConfig } from "vite";

export default defineConfig({
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
        // Keep it as a single file for easy HACS resource loading
        inlineDynamicImports: true
      }
    },
    outDir: "dist",
    emptyOutDir: true
  }
});
