import { existsSync } from "node:fs";
import { readdir, readFile, rm, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { atomicWriteJson, atomicWriteText } from "@fenglimg/fabric-shared/node/atomic-write";

import {
  FABRIC_HOOK_COMMAND_PATHS,
  FABRIC_SECTION_REGEX,
  HOOK_CONFIG_ARRAY_PATHS,
  HOOK_CONFIG_TARGETS,
  HOOK_SCRIPT_DESTINATIONS,
  SECTION_TARGETS,
  SKILL_DESTINATIONS,
} from "./skills-and-hooks.js";

/**
 * Uninstall helpers — symmetric inverse of the install pipeline shipped in
 * {@link ./skills-and-hooks.ts}. Each helper is idempotent + best-effort:
 *   - Missing artifacts produce `status: 'skipped'` (never throw).
 *   - Hook-config un-merge filters fabric entries out by `command`-path match
 *     against {@link FABRIC_HOOK_COMMAND_PATHS}; user-authored entries are
 *     preserved. After filtering, empty arrays/objects unconditionally
 *     cascade-prune up the JSON tree (rc.15 TASK-002 — cleanEmpties became
 *     default-on and the option was deleted).
 *   - Pointer stripping NEVER deletes the file even when all remaining lines
 *     were fabric pointers — install cannot prove it created the file, so
 *     uninstall preserves it to avoid clobbering pre-existing user content.
 *
 * Wiring site: TASK-002's `fab uninstall` command bootstrap stage invokes
 * {@link uninstallBootstrapStage} which fans out to every helper here in the
 * exact reverse order of `fabric install`'s install pipeline.
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

export type UninstallOptions = Record<string, never>;

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
 * pruned object back. Empty arrays' keys unconditionally cascade up: empty
 * `hooks.Stop` → delete `hooks.Stop`; if `hooks` then becomes empty →
 * delete `hooks` too (rc.15 TASK-002 made this default-on behavior).
 */
export async function unmergeClaudeCodeHookConfig(
  projectRoot: string,
): Promise<UninstallStepResult> {
  return unmergeHookConfig({
    step: "claude-hook-config",
    projectRoot,
    configRel: HOOK_CONFIG_TARGETS.claudeCode,
    arrayPaths: [...HOOK_CONFIG_ARRAY_PATHS.claudeCode],
    fabricCommands: Object.values(FABRIC_HOOK_COMMAND_PATHS.claudeCode),
    extractCommands: extractClaudeCommands,
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
): Promise<UninstallStepResult> {
  return unmergeHookConfig({
    step: "codex-hook-config",
    projectRoot,
    configRel: HOOK_CONFIG_TARGETS.codex,
    arrayPaths: [...HOOK_CONFIG_ARRAY_PATHS.codex],
    fabricCommands: Object.values(FABRIC_HOOK_COMMAND_PATHS.codex),
    extractCommands: extractFlatCommands,
  });
}

/**
 * Inverse of `mergeCursorHookConfig`. Reads `.cursor/hooks.json`, filters
 * every fabric entry out of each `hooks.stop` / `hooks.sessionStart` /
 * `hooks.preToolUse` array (matching by top-level `command` field), then
 * atomically writes the pruned object back. Schema per
 * https://cursor.com/cn/docs/hooks; corrected in rc.14 TASK-001.
 */
export async function unmergeCursorHookConfig(
  projectRoot: string,
): Promise<UninstallStepResult> {
  return unmergeHookConfig({
    step: "cursor-hook-config",
    projectRoot,
    configRel: HOOK_CONFIG_TARGETS.cursor,
    arrayPaths: [...HOOK_CONFIG_ARRAY_PATHS.cursor],
    fabricCommands: Object.values(FABRIC_HOOK_COMMAND_PATHS.cursor),
    extractCommands: extractFlatCommands,
  });
}

// -----------------------------------------------------------------------
// Pointer-line stripping
// -----------------------------------------------------------------------

/**
 * Inverse of `addFabricKnowledgeBaseSection`. For each path in
 * {@link SECTION_TARGETS} (CLAUDE.md / AGENTS.md / .cursor/rules), reads the
 * file (if present) and strips the entire managed section delimited by
 * `<!-- fabric:knowledge-base:begin -->` … `<!-- fabric:knowledge-base:end
 * -->` markers (inclusive of any preceding blank-line separator so we don't
 * leave an orphan blank line). Writes the result atomically when changed.
 *
 * Idempotent: when the markers are absent the file is left untouched and the
 * step records a `skipped/no-fabric-section` result. Running uninstall twice
 * back-to-back therefore reports 100 % skipped on the second pass.
 *
 * The file is NEVER deleted even if all that remained was the section —
 * install cannot prove it was the creator of the file, so uninstall preserves
 * it to avoid clobbering pre-existing user content (mirrors the rc.4 pointer-
 * strip conservatism).
 *
 * rc.12 broad-gate-fabric-lang TASK-006: replaces `stripArchiveSkillPointers`.
 * The three POINTER_LINE substring filters are gone; a single regex captures
 * the marker-delimited region in one pass.
 */
export async function stripFabricKnowledgeBaseSection(
  projectRoot: string,
): Promise<UninstallStepResult[]> {
  const results: UninstallStepResult[] = [];
  for (const rel of SECTION_TARGETS) {
    const target = join(projectRoot, rel);
    if (!existsSync(target)) {
      results.push({ step: "section", path: target, status: "skipped", message: "absent" });
      continue;
    }
    let existing: string;
    try {
      existing = await readFile(target, "utf8");
    } catch (error: unknown) {
      results.push({
        step: "section",
        path: target,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const match = existing.match(FABRIC_SECTION_REGEX);
    if (match === null) {
      results.push({
        step: "section",
        path: target,
        status: "skipped",
        message: "no-fabric-section",
      });
      continue;
    }

    const before = existing.slice(0, match.index ?? 0);
    const after = existing.slice((match.index ?? 0) + match[0].length);
    // Strip a leading newline that would otherwise survive as an orphan blank
    // line where the section used to sit.
    const filtered = `${before}${after.replace(/^\r?\n/, "")}`;

    if (filtered === existing) {
      results.push({
        step: "section",
        path: target,
        status: "skipped",
        message: "no-fabric-section",
      });
      continue;
    }

    try {
      await atomicWriteText(target, filtered);
      results.push({ step: "section", path: target, status: "removed" });
    } catch (error: unknown) {
      results.push({
        step: "section",
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
 * in the exact reverse order of `fabric install`'s install pipeline:
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
  _opts: UninstallOptions = {},
): Promise<UninstallStepResult[]> {
  const results: UninstallStepResult[] = [];

  // 1. Managed section first (cheapest, reverses last step of install)
  await runAndCollect(results, "section", projectRoot, () =>
    stripFabricKnowledgeBaseSection(projectRoot),
  );

  // 2. Hook configs (reverse of install order: cursor → codex → claude)
  await runAndCollectOne(results, "cursor-hook-config", projectRoot, () =>
    unmergeCursorHookConfig(projectRoot),
  );
  await runAndCollectOne(results, "codex-hook-config", projectRoot, () =>
    unmergeCodexHookConfig(projectRoot),
  );
  await runAndCollectOne(results, "claude-hook-config", projectRoot, () =>
    unmergeClaudeCodeHookConfig(projectRoot),
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
    pruneArrayAtPath(next, dotted, args.fabricCommands, args.extractCommands);
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
 * then unconditionally cascades empty containers upward by deleting the
 * array's key from its parent, then the parent's key from its grandparent
 * if the parent is itself empty — recursing up the chain. rc.15 TASK-002
 * made this default behavior; the cleanEmpties opt-in flag was deleted.
 */
function pruneArrayAtPath(
  root: Record<string, unknown>,
  path: string,
  fabricCommands: string[],
  extractCommands: (entry: unknown) => string[],
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

  if (filtered.length > 0) {
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
