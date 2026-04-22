import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");
const dashboardDist = resolve(repoRoot, "packages/dashboard/dist");
const serverStatic = resolve(packageRoot, "dist/static");

try {
  await rm(serverStatic, { recursive: true, force: true });
  await mkdir(serverStatic, { recursive: true });
  await cp(dashboardDist, serverStatic, { recursive: true });
  process.stderr.write(`[fabric-server] copied dashboard dist to ${serverStatic}\n`);
} catch (error) {
  process.stderr.write(
    `[fabric-server] dashboard dist copy skipped from ${dashboardDist}: ${error instanceof Error ? error.message : String(error)}\n`,
  );
}
