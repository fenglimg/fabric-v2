import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

const target = "http://127.0.0.1:7373";

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target, changeOrigin: true },
      "/mcp": { target, changeOrigin: true, ws: false },
      "/events": { target, changeOrigin: true, ws: false },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
