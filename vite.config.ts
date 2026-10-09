import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  optimizeDeps: { entries: ["index.html"], include: ["dxf-viewer", "dxf-viewer/src/DxfScene.js", "three"] },
  build: {
    target: "chrome64",
    sourcemap: false,
  },
  worker: {
    format: "es",
  },
});
