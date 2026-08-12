import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";

import { GenericIOError } from "@fenglimg/fabric-shared/errors";

import { t } from "../i18n.js";
// T-2: was `../commands/install.js` (the retired v1 installer). The identical
// type now lives with the shipping pipeline, so this file no longer pins 1,953
// lines of production-unreachable code into the build.
import type { InitWriteAction } from "./pipeline/types.js";

export type DiffFileState =
  | "missing"
  | "present-canonical"
  | "drifted"
  | "user-modified";

type DiffDetectStrategy = "presence" | "always-rewrite";

type ClassifiedFreshPathResult = {
  path: string;
  state: DiffFileState;
  reason?: string;
};

// rc.15 (formerly rc.14 TASK-002): with --force removed this never asks the
// scaffold stage to replace a non-directory. The diff abort gate reports it as
// user-modified before any write happens.
export function shouldReplaceWritableDirectory(path: string, _options?: unknown): boolean {
  if (!existsSync(path)) {
    return false;
  }

  if (statSync(path).isDirectory()) {
    return false;
  }

  return false;
}

export function classifyFreshPath(
  path: string,
  _strategy: DiffDetectStrategy,
): ClassifiedFreshPathResult {
  if (!existsSync(path)) {
    return { path, state: "missing" };
  }

  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch (error: unknown) {
    return {
      path,
      state: "user-modified",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  if (!stat.isFile()) {
    return { path, state: "user-modified", reason: "expected a file" };
  }

  return { path, state: "present-canonical" };
}

export function diffStateToWriteAction(_state: DiffFileState): InitWriteAction {
  return "created";
}

export function formatDiffFileState(state: DiffFileState): string {
  return t(`cli.install.diff.state.${state}`);
}

export function preparePlannedPath(path: string, action: InitWriteAction): void {
  mkdirSync(dirname(path), { recursive: true });
  if (action === "overwritten" && existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
  }
}

/** Stable marker so a drift abort survives stage-level error folding. */
export const INSTALL_DRIFT_ABORT_KIND = "install-drift-abort";

export function installDriftAbortError(path: string): GenericIOError {
  return new GenericIOError(t("cli.install.diff.drift-abort", { path }), {
    actionHint: t("cli.install.diff.drift-abort.action-hint", { path }),
    fixable: true,
    details: { path, kind: INSTALL_DRIFT_ABORT_KIND },
  });
}

/**
 * True for the structured drift abort above. A stage catching this must RETHROW
 * rather than fold it into a StageResult: folding stringifies the error into
 * `errors[]` and drops `actionHint`, which is the half of the message that tells
 * the user what to actually do.
 */
export function isInstallDriftAbortError(error: unknown): boolean {
  return (
    error instanceof GenericIOError &&
    (error.details as { kind?: string } | undefined)?.kind === INSTALL_DRIFT_ABORT_KIND
  );
}
