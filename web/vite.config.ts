import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * The FastAPI service owns /api and the session cookie. In dev, proxy API
 * traffic to it so the SPA can be developed on :5173 with HMR.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.EVERSTATE_API_ORIGIN || "http://127.0.0.1:8080",
        changeOrigin: true,
      },
      "/health": {
        target: process.env.EVERSTATE_API_ORIGIN || "http://127.0.0.1:8080",
        changeOrigin: true,
      },
      "/logout": {
        target: process.env.EVERSTATE_API_ORIGIN || "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
