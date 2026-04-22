import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

import pkg from "./package.json";

const target = "http://127.0.0.1:7373";

export default defineConfig({
  plugins: [preact()],
  define: {
    __DASHBOARD_VERSION__: JSON.stringify(pkg.version),
    __DASHBOARD_FAB_LANG__: JSON.stringify(process.env.FAB_LANG ?? null),
  },
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
