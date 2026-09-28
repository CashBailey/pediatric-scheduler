import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/*.test.js", "shared/**/*.test.js"],
    environment: "jsdom",
    setupFiles: ["src/test-setup.js"]
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:6174"
      }
    }
  },
  preview: {
    host: "127.0.0.1",
    port: 4173
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    modulePreload: {
      polyfill: false
    }
  }
});
