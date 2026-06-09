import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";

import { GenericIOError } from "@fenglimg/fabric-shared/errors";

import { t } from "../i18n.js";
import type { InitWriteAction } from "../commands/install.js";

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

export function installDriftAbortError(path: string): GenericIOError {
  return new GenericIOError(t("cli.install.diff.drift-abort", { path }), {
    actionHint: t("cli.install.diff.drift-abort.action-hint", { path }),
    fixable: true,
    details: { path },
  });
}
