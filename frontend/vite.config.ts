/// <reference types="vitest" />
import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const BACKEND = "http://localhost:8000";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/auth": { target: BACKEND, changeOrigin: true, cookieDomainRewrite: "" },
      "/snapshots": { target: BACKEND, changeOrigin: true, cookieDomainRewrite: "" },
      "/dashboard": { target: BACKEND, changeOrigin: true, cookieDomainRewrite: "" },
      "/parties": { target: BACKEND, changeOrigin: true, cookieDomainRewrite: "" },
      "/invoices": { target: BACKEND, changeOrigin: true, cookieDomainRewrite: "" },
      "/exceptions": { target: BACKEND, changeOrigin: true, cookieDomainRewrite: "" },
      "/follow-ups": { target: BACKEND, changeOrigin: true, cookieDomainRewrite: "" },
      "/config": { target: BACKEND, changeOrigin: true, cookieDomainRewrite: "" },
      "/admin": { target: BACKEND, changeOrigin: true, cookieDomainRewrite: "" },
      "/health": { target: BACKEND, changeOrigin: true, cookieDomainRewrite: "" },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
