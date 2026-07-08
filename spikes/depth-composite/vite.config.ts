import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// @TASK T0.2 — Vite config (depth-composite spike)
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // render-pipeline/out 에셋을 /assets 로 서빙
  server: {
    port: 5174,
    fs: {
      allow: [".", "../../render-pipeline/out"],
    },
  },
  // 빌드 시 에셋 경로 설정
  base: "./",
});
