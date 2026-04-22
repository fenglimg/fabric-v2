import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import type { FabricHttpApp } from "./_error.js";

const DEFAULT_STATIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "static");

export type RegisterDashboardStaticOptions = {
  dashboardDistPath?: string;
  dev?: boolean;
};

export function registerDashboardStatic(
  app: FabricHttpApp,
  options: RegisterDashboardStaticOptions = {},
): void {
  if (options.dev ?? process.env.NODE_ENV === "development") {
    return;
  }

  const staticDir = resolve(options.dashboardDistPath ?? DEFAULT_STATIC_DIR);
  const indexPath = resolve(staticDir, "index.html");

  if (!existsSync(indexPath)) {
    warnMissingDashboard(staticDir);
    app.get("/", (_req, res) => {
      res.status(404).json({
        error: {
          code: "DASHBOARD_DIST_MISSING",
          message: `Fabric dashboard dist was not found at ${staticDir}. Run pnpm --filter @fenglimg/fabric-dashboard build.`,
        },
      });
    });
    return;
  }

  app.use("/", express.static(staticDir, { index: "index.html", fallthrough: true }));
  app.get(/^\/(?!api(?:\/|$)|mcp(?:\/|$)|events(?:\/|$)).*/, (_req, res) => {
    res.sendFile(indexPath);
  });
}

function warnMissingDashboard(staticDir: string): void {
  process.stderr.write(
    `[fabric-server] dashboard dist missing at ${staticDir}; '/' will return 404 until dashboard assets are built.\n`,
  );
}
