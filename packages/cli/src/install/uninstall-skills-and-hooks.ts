import { existsSync } from "node:fs";
import { readdir, readFile, rm, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { atomicWriteJson, atomicWriteText } from "@fenglimg/fabric-shared/node/atomic-write";

import {
  FABRIC_HOOK_COMMAND_PATHS,
  HOOK_CONFIG_ARRAY_PATHS,
  HOOK_CONFIG_TARGETS,
  HOOK_SCRIPT_DESTINATIONS,
  IMPORT_POINTER_LINE,
  POINTER_LINE,
  POINTER_TARGETS,
  REVIEW_POINTER_LINE,
  SKILL_DESTINATIONS,
} from "./skills-and-hooks.js";

/**
 * Uninstall helpers — symmetric inverse of the install pipeline shipped in
 * {@link ./skills-and-hooks.ts}. Each helper is idempotent + best-effort:
 *   - Missing artifacts produce `status: 'skipped'` (never throw).
 *   - Hook-config un-merge is conservative by default: fabric entries are
 *     filtered out by `command`-path match against
 *     {@link FABRIC_HOOK_COMMAND_PATHS}; user-authored entries are preserved.
 *     The optional `cleanEmpties` flag cascades empty arrays/objects up.
 *   - Pointer stripping NEVER deletes the file even when all remaining lines
 *     were fabric pointers — install cannot prove it created the file, so
 *     uninstall preserves it to avoid clobbering pre-existing user content.
 *
 * Wiring site: TASK-002's `fab uninstall` command bootstrap stage invokes
 * {@link uninstallBootstrapStage} which fans out to every helper here in the
 * exact reverse order of `fabric init`'s install pipeline.
 *
 * Scope: project-local artifacts only. Personal root (`$FABRIC_HOME/.fabric/`)
 * is OUTSIDE bootstrap scope and is never touched by any helper here.
 */

export type UninstallStepStatus = "removed" | "skipped" | "error";

export type UninstallStepResult = {
  step: string;
  path: string;
  status: UninstallStepStatus;
  message?: string;
};

export type UninstallOptions = {
  /**
   * When true, after fabric entries are filtered out, recursively delete
   * empty container keys (empty arrays' parent keys, then empty objects)
   * up the JSON tree until the first non-empty container is encountered or
   * the document root is reached. When false (default), empty containers
   * are left behind — cosmetic but loss-less.
   */
  cleanEmpties?: boolean;
};

// -----------------------------------------------------------------------
// Skill removers
// -----------------------------------------------------------------------

/**
 * Inverse of `installFabricArchiveSkill`. Removes each SKILL.md at
 * `SKILL_DESTINATIONS.fabricArchive`, then attempts to remove the parent
 * `fabric-archive/` directory if it is empty.
 */
export async function uninstallFabricArchiveSkill(
  projectRoot: string,
): Promise<UninstallStepResult[]> {
  return removeSkill("skill", SKILL_DESTINATIONS.fabricArchive, projectRoot);
}

/**
 * Inverse of `installFabricReviewSkill`. Removes each SKILL.md at
 * `SKILL_DESTINATIONS.fabricReview`, then attempts to remove the parent
 * `fabric-review/` directory if it is empty.
 */
export async function uninstallFabricReviewSkill(
  projectRoot: string,
): Promise<UninstallStepResult[]> {
  return removeSkill("skill-review", SKILL_DESTINATIONS.fabricReview, projectRoot);
}

/**
 * Inverse of `installFabricImportSkill`. Removes each SKILL.md at
 * `SKILL_DESTINATIONS.fabricImport`, then attempts to remove the parent
 * `fabric-import/` directory if it is empty.
 */
export async function uninstallFabricImportSkill(
  projectRoot: string,
): Promise<UninstallStepResult[]> {
  return removeSkill("skill-import", SKILL_DESTINATIONS.fabricImport, projectRoot);
}

async function removeSkill(
  step: string,
  rels: readonly string[],
  projectRoot: string,
): Promise<UninstallStepResult[]> {
  const results: UninstallStepResult[] = [];
  for (const rel of rels) {
    const target = join(projectRoot, rel);
    results.push(await rmIfExists(step, target));
    results.push(await rmDirIfEmpty(`${step}-dir`, dirname(target)));
  }
  return results;
}

// -----------------------------------------------------------------------
// Hook script removers
// -----------------------------------------------------------------------

/**
 * Inverse of `installArchiveHintHook`. Removes the `fabric-hint.cjs` script
 * from each client's `.<client>/hooks/` directory. Does NOT remove the
 * parent `hooks/` directory (it may contain user-authored hooks).
 */
export async function removeArchiveHintHook(
  projectRoot: string,
): Promise<UninstallStepResult[]> {
  return removeHookScripts("hook-script", HOOK_SCRIPT_DESTINATIONS.fabricHint, projectRoot);
}

/**
 * Inverse of `installKnowledgeHintBroadHook`. Removes the
 * `knowledge-hint-broad.cjs` script from each client's `.<client>/hooks/`
 * directory.
 */
export async function removeKnowledgeHintBroadHook(
  projectRoot: string,
): Promise<UninstallStepResult[]> {
  return removeHookScripts(
    "hook-broad-script",
    HOOK_SCRIPT_DESTINATIONS.knowledgeHintBroad,
    projectRoot,
  );
}

/**
 * Inverse of `installKnowledgeHintNarrowHook`. Removes the
 * `knowledge-hint-narrow.cjs` script from each client's `.<client>/hooks/`
 * directory.
 */
export async function removeKnowledgeHintNarrowHook(
  projectRoot: string,
): Promise<UninstallStepResult[]> {
  return removeHookScripts(
    "hook-narrow-script",
    HOOK_SCRIPT_DESTINATIONS.knowledgeHintNarrow,
    projectRoot,
  );
}

async function removeHookScripts(
  step: string,
  rels: readonly string[],
  projectRoot: string,
): Promise<UninstallStepResult[]> {
  const results: UninstallStepResult[] = [];
  for (const rel of rels) {
    const target = join(projectRoot, rel);
    results.push(await rmIfExists(step, target));
  }
  return results;
}

// -----------------------------------------------------------------------
// Hook-config un-merge
// -----------------------------------------------------------------------

/**
 * Inverse of `mergeClaudeCodeHookConfig`. Reads `.claude/settings.json`,
 * filters every fabric entry out of each `hooks.Stop` / `hooks.SessionStart`
 * / `hooks.PreToolUse` array (matching by descending one nesting level into
 * each matcher-wrapper's `hooks: [{ command }]` field against the literals
 * in `FABRIC_HOOK_COMMAND_PATHS.claudeCode`), then atomically writes the
 * pruned object back. With `opts.cleanEmpties = true`, empty arrays' keys
 * cascade up: empty `hooks.Stop` → delete `hooks.Stop`; if `hooks` then
 * becomes empty → delete `hooks` too.
 */
export async function unmergeClaudeCodeHookConfig(
  projectRoot: string,
  opts: UninstallOptions = {},
): Promise<UninstallStepResult> {
  return unmergeHookConfig({
    step: "claude-hook-config",
    projectRoot,
    configRel: HOOK_CONFIG_TARGETS.claudeCode,
    arrayPaths: [...HOOK_CONFIG_ARRAY_PATHS.claudeCode],
    fabricCommands: Object.values(FABRIC_HOOK_COMMAND_PATHS.claudeCode),
    extractCommands: extractClaudeCommands,
    cleanEmpties: opts.cleanEmpties === true,
  });
}

/**
 * Inverse of `mergeCodexHookConfig`. Reads `.codex/hooks.json`, filters
 * every fabric entry out of each `events.Stop` / `events.SessionStart` /
 * `events.PreToolUse` array (matching by top-level `command` field), then
 * atomically writes the pruned object back.
 */
export async function unmergeCodexHookConfig(
  projectRoot: string,
  opts: UninstallOptions = {},
): Promise<UninstallStepResult> {
  return unmergeHookConfig({
    step: "codex-hook-config",
    projectRoot,
    configRel: HOOK_CONFIG_TARGETS.codex,
    arrayPaths: [...HOOK_CONFIG_ARRAY_PATHS.codex],
    fabricCommands: Object.values(FABRIC_HOOK_COMMAND_PATHS.codex),
    extractCommands: extractFlatCommands,
    cleanEmpties: opts.cleanEmpties === true,
  });
}

/**
 * Inverse of `mergeCursorHookConfig`. Reads `.cursor/hooks.json`, filters
 * every fabric entry out of each `events.Stop` / `events.SessionStart` /
 * `events.PreToolUse` array (matching by top-level `command` field), then
 * atomically writes the pruned object back.
 */
export async function unmergeCursorHookConfig(
  projectRoot: string,
  opts: UninstallOptions = {},
): Promise<UninstallStepResult> {
  return unmergeHookConfig({
    step: "cursor-hook-config",
    projectRoot,
    configRel: HOOK_CONFIG_TARGETS.cursor,
    arrayPaths: [...HOOK_CONFIG_ARRAY_PATHS.cursor],
    fabricCommands: Object.values(FABRIC_HOOK_COMMAND_PATHS.cursor),
    extractCommands: extractFlatCommands,
    cleanEmpties: opts.cleanEmpties === true,
  });
}

// -----------------------------------------------------------------------
// Pointer-line stripping
// -----------------------------------------------------------------------

/**
 * Inverse of `addArchiveSkillPointer`. For each path in `POINTER_TARGETS`
 * (CLAUDE.md / AGENTS.md / .cursor/rules), reads the file (if present) and
 * removes every line that contains the fabric-archive, fabric-review, or
 * fabric-import pointer literal. Writes the result atomically when changed.
 *
 * The file is NEVER deleted even if all lines were fabric pointers — install
 * cannot prove it was the creator of the file, so uninstall preserves it to
 * avoid clobbering pre-existing user content.
 */
export async function stripArchiveSkillPointers(
  projectRoot: string,
): Promise<UninstallStepResult[]> {
  const results: UninstallStepResult[] = [];
  for (const rel of POINTER_TARGETS) {
    const target = join(projectRoot, rel);
    if (!existsSync(target)) {
      results.push({ step: "pointer", path: target, status: "skipped", message: "absent" });
      continue;
    }
    let existing: string;
    try {
      existing = await readFile(target, "utf8");
    } catch (error: unknown) {
      results.push({
        step: "pointer",
        path: target,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const pointerLiterals = [POINTER_LINE, REVIEW_POINTER_LINE, IMPORT_POINTER_LINE];
    const filtered = existing
      .split("\n")
      .filter((line) => !pointerLiterals.some((literal) => line.includes(literal)))
      .join("\n");

    if (filtered === existing) {
      results.push({
        step: "pointer",
        path: target,
        status: "skipped",
        message: "no-fabric-pointers",
      });
      continue;
    }

    try {
      await atomicWriteText(target, filtered);
      results.push({ step: "pointer", path: target, status: "removed" });
    } catch (error: unknown) {
      results.push({
        step: "pointer",
        path: target,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

// -----------------------------------------------------------------------
// Orchestrator
// -----------------------------------------------------------------------

/**
 * Bootstrap-stage uninstall orchestrator. Runs every helper in this module
 * in the exact reverse order of `fabric init`'s install pipeline:
 *
 *   1. Pointer-line strip (CLAUDE.md / AGENTS.md / .cursor/rules)
 *   2. Hook-config un-merge (cursor → codex → claude — reverse of install)
 *   3. Hook-script removal (knowledge-narrow → knowledge-broad → fabric-hint)
 *   4. Skill removal (fabric-import → fabric-review → fabric-archive)
 *
 * Each helper invocation is try/catch-wrapped: a thrown error becomes a
 * `{ status: 'error', message }` entry in the returned results array. The
 * orchestrator itself NEVER throws — callers can rely on always receiving a
 * complete result list even on a partially-broken filesystem.
 */
export async function uninstallBootstrapStage(
  projectRoot: string,
  opts: UninstallOptions = {},
): Promise<UninstallStepResult[]> {
  const results: UninstallStepResult[] = [];

  // 1. Pointers first (cheapest, reverses last step of install)
  await runAndCollect(results, "pointer", projectRoot, () =>
    stripArchiveSkillPointers(projectRoot),
  );

  // 2. Hook configs (reverse of install order: cursor → codex → claude)
  await runAndCollectOne(results, "cursor-hook-config", projectRoot, () =>
    unmergeCursorHookConfig(projectRoot, opts),
  );
  await runAndCollectOne(results, "codex-hook-config", projectRoot, () =>
    unmergeCodexHookConfig(projectRoot, opts),
  );
  await runAndCollectOne(results, "claude-hook-config", projectRoot, () =>
    unmergeClaudeCodeHookConfig(projectRoot, opts),
  );

  // 3. Hook scripts (reverse of install order)
  await runAndCollect(results, "hook-narrow-script", projectRoot, () =>
    removeKnowledgeHintNarrowHook(projectRoot),
  );
  await runAndCollect(results, "hook-broad-script", projectRoot, () =>
    removeKnowledgeHintBroadHook(projectRoot),
  );
  await runAndCollect(results, "hook-script", projectRoot, () =>
    removeArchiveHintHook(projectRoot),
  );

  // 4. Skill files (reverse of install order: import → review → archive)
  await runAndCollect(results, "skill-import", projectRoot, () =>
    uninstallFabricImportSkill(projectRoot),
  );
  await runAndCollect(results, "skill-review", projectRoot, () =>
    uninstallFabricReviewSkill(projectRoot),
  );
  await runAndCollect(results, "skill", projectRoot, () =>
    uninstallFabricArchiveSkill(projectRoot),
  );

  return results;
}

async function runAndCollect(
  results: UninstallStepResult[],
  step: string,
  projectRoot: string,
  fn: () => Promise<UninstallStepResult[]>,
): Promise<void> {
  try {
    const sub = await fn();
    results.push(...sub);
  } catch (error: unknown) {
    results.push({
      step,
      path: projectRoot,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runAndCollectOne(
  results: UninstallStepResult[],
  step: string,
  projectRoot: string,
  fn: () => Promise<UninstallStepResult>,
): Promise<void> {
  try {
    results.push(await fn());
  } catch (error: unknown) {
    results.push({
      step,
      path: projectRoot,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

// -----------------------------------------------------------------------
// Internals — filesystem helpers
// -----------------------------------------------------------------------

async function rmIfExists(step: string, target: string): Promise<UninstallStepResult> {
  if (!existsSync(target)) {
    return { step, path: target, status: "skipped", message: "absent" };
  }
  try {
    await rm(target, { force: true });
    return { step, path: target, status: "removed" };
  } catch (error: unknown) {
    return {
      step,
      path: target,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function rmDirIfEmpty(step: string, target: string): Promise<UninstallStepResult> {
  if (!existsSync(target)) {
    return { step, path: target, status: "skipped", message: "absent" };
  }
  let entries: string[];
  try {
    entries = await readdir(target);
  } catch (error: unknown) {
    return {
      step,
      path: target,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  if (entries.length > 0) {
    return { step, path: target, status: "skipped", message: "not-empty" };
  }
  try {
    await rmdir(target);
    return { step, path: target, status: "removed" };
  } catch (error: unknown) {
    return {
      step,
      path: target,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

// -----------------------------------------------------------------------
// Internals — hook config un-merge engine
// -----------------------------------------------------------------------

type UnmergeArgs = {
  step: string;
  projectRoot: string;
  configRel: string;
  arrayPaths: string[];
  fabricCommands: string[];
  extractCommands: (entry: unknown) => string[];
  cleanEmpties: boolean;
};

async function unmergeHookConfig(args: UnmergeArgs): Promise<UninstallStepResult> {
  const target = join(args.projectRoot, args.configRel);
  if (!existsSync(target)) {
    return { step: args.step, path: target, status: "skipped", message: "absent" };
  }

  let raw: string;
  try {
    raw = await readFile(target, "utf8");
  } catch (error: unknown) {
    return {
      step: args.step,
      path: target,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (raw.trim().length === 0) {
    return { step: args.step, path: target, status: "skipped", message: "empty" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    return {
      step: args.step,
      path: target,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { step: args.step, path: target, status: "skipped", message: "not-an-object" };
  }

  // Deep-clone via JSON round-trip so mutations don't escape this scope.
  const next = JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>;

  for (const dotted of args.arrayPaths) {
    pruneArrayAtPath(next, dotted, args.fabricCommands, args.extractCommands, args.cleanEmpties);
  }

  if (jsonEqual(parsed, next)) {
    return { step: args.step, path: target, status: "skipped", message: "no-fabric-entries" };
  }

  try {
    await atomicWriteJson(target, next, { indent: 2 });
    return { step: args.step, path: target, status: "removed" };
  } catch (error: unknown) {
    return {
      step: args.step,
      path: target,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Walks `root` via the dotted `path`, filters the array found at the leaf,
 * and (when `cleanEmpties` is true) cascades empty containers upward by
 * deleting the array's key from its parent, then the parent's key from its
 * grandparent if the parent is itself empty — recursing up the chain.
 */
function pruneArrayAtPath(
  root: Record<string, unknown>,
  path: string,
  fabricCommands: string[],
  extractCommands: (entry: unknown) => string[],
  cleanEmpties: boolean,
): void {
  const keys = path.split(".");
  // Track the chain of (parent, keyInParent) so we can delete upward.
  const chain: Array<{ parent: Record<string, unknown>; key: string }> = [];
  let cursor: unknown = root;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) {
      return;
    }
    const parent = cursor as Record<string, unknown>;
    if (!(key in parent)) {
      return;
    }
    chain.push({ parent, key });
    cursor = parent[key];
  }

  if (!Array.isArray(cursor)) {
    return;
  }

  const filtered = cursor.filter((entry) => {
    const cmds = extractCommands(entry);
    if (cmds.length === 0) {
      return true;
    }
    return !cmds.some((cmd) => fabricCommands.some((fabric) => cmd === fabric || cmd.endsWith(fabric)));
  });

  const leaf = chain[chain.length - 1];
  leaf.parent[leaf.key] = filtered;

  if (!cleanEmpties || filtered.length > 0) {
    return;
  }

  // Cascade: delete the now-empty array key, then walk upward deleting
  // any container that became empty as a result. Stop when we hit a non-
  // empty container or the document root.
  for (let i = chain.length - 1; i >= 0; i--) {
    const { parent, key } = chain[i];
    const value = parent[key];
    const isEmpty =
      (Array.isArray(value) && value.length === 0) ||
      (value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value as Record<string, unknown>).length === 0);
    if (!isEmpty) {
      return;
    }
    delete parent[key];
  }
}

/**
 * Claude Code hook entry shape:
 *   { matcher: '*', hooks: [{ type: 'command', command: '...' }, ...] }
 * Descend one level into `hooks[]` and collect each entry's `command`.
 */
function extractClaudeCommands(entry: unknown): string[] {
  if (entry === null || typeof entry !== "object") {
    return [];
  }
  const obj = entry as Record<string, unknown>;
  const inner = obj["hooks"];
  if (!Array.isArray(inner)) {
    return [];
  }
  const out: string[] = [];
  for (const sub of inner) {
    if (sub === null || typeof sub !== "object") {
      continue;
    }
    const cmd = (sub as Record<string, unknown>)["command"];
    if (typeof cmd === "string") {
      out.push(cmd);
    }
  }
  return out;
}

/**
 * Codex / Cursor hook entry shape: top-level `{ command: '...' }` (optionally
 * with a `matcher` sibling). Read the `command` field directly.
 */
function extractFlatCommands(entry: unknown): string[] {
  if (entry === null || typeof entry !== "object") {
    return [];
  }
  const cmd = (entry as Record<string, unknown>)["command"];
  return typeof cmd === "string" ? [cmd] : [];
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
