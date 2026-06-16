import { isAbsolute, resolve } from "node:path";

export type DevModeSource = "cli" | "env" | "cwd";

export type DevModeResolution = {
  target: string;
  source: DevModeSource;
  chain: string[];
};

export type DebugLogger = (message: string) => void;

// rc.17 (R-cut): the fabric.config.json fixture-path step was removed —
// the resolution chain is now 3 sources (cli → env → cwd). The
// `EXTERNAL_FIXTURE_PATH` env var is the sole dev/test fixture-path source.
export function resolveDevMode(cliTarget?: string, workspaceRoot: string = process.cwd()): DevModeResolution {
  const envTarget = normalizeTarget(process.env.EXTERNAL_FIXTURE_PATH, workspaceRoot);
  const directTarget = normalizeTarget(cliTarget, workspaceRoot);

  const chain = [
    formatResolutionStep("cliTarget", directTarget),
    formatResolutionStep("EXTERNAL_FIXTURE_PATH", envTarget),
    formatResolutionStep("process.cwd()", workspaceRoot),
  ];

  if (directTarget !== undefined) {
    return { target: directTarget, source: "cli", chain };
  }

  if (envTarget !== undefined) {
    return { target: envTarget, source: "env", chain };
  }

  return { target: workspaceRoot, source: "cwd", chain };
}

export function resolveDevModeTarget(cliTarget?: string): string {
  return resolveDevMode(cliTarget).target;
}

export function isDevMode(cliTarget?: string): boolean {
  return normalizeTarget(cliTarget) !== undefined || normalizeTarget(process.env.EXTERNAL_FIXTURE_PATH) !== undefined;
}

export function createDebugLogger(debug?: boolean): DebugLogger {
  const enabled = debug === true || process.env.FABRIC_DEBUG === "1";

  return (message: string) => {
    if (!enabled) {
      return;
    }

    process.stderr.write(`[fabric:debug] ${message}\n`);
  };
}

function normalizeTarget(value: string | undefined, workspaceRoot: string = process.cwd()): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  return isAbsolute(value) ? value : resolve(workspaceRoot, value);
}

function formatResolutionStep(source: string, value: string | undefined): string {
  return `${source}: ${value ?? "<unset>"}`;
}
