import * as childProcess from "node:child_process";
import { join } from "node:path";

export const LOCAL_FABRIC_SERVER_PATH = join("node_modules", "@fenglimg", "fabric-server", "dist", "index.js");

const FABRIC_SERVER_PACKAGE = "@fenglimg/fabric-server";

export function installLocalFabricServer(target: string, manager: "pnpm" | "npm" | "yarn"): void {
  const installArgs = manager === "npm"
    ? ["install", "-D", FABRIC_SERVER_PACKAGE]
    : ["add", "-D", FABRIC_SERVER_PACKAGE];

  childProcess.execFileSync(manager, installArgs, {
    cwd: target,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}
