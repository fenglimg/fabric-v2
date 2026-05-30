import { existsSync } from "node:fs";
import { readdir, readFile, rm, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { atomicWriteJson, atomicWriteText } from "@fenglimg/fabric-shared/node/atomic-write";
import { BOOTSTRAP_REGEX } from "@fenglimg/fabric-shared/templates/bootstrap-canonical";

import {
  FABRIC_HOOK_COMMAND_PATHS,
  HOOK_CONFIG_ARRAY_PATHS,
  HOOK_CONFIG_TARGETS,
  HOOK_LIB_DESTINATIONS,
  HOOK_SCRIPT_DESTINATIONS,
  SKILL_DESTINATIONS,
} from "./skills-and-hooks.js";
import { fabricAgentsSnapshotPath } from "./write-bootstrap-snapshot.js";

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
 * Wiring site: TASK-002's `fabric uninstall` command bootstrap stage invokes
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

/**
 * Inverse of `installFabricSyncSkill` (v2.1 P4). Removes each SKILL.md at
 * `SKILL_DESTINATIONS.fabricSync`, then attempts to remove the empty parent.
 */
export async function uninstallFabricSyncSkill(
  projectRoot: string,
): Promise<UninstallStepResult[]> {
  return removeSkill("skill-sync", SKILL_DESTINATIONS.fabricSync, projectRoot);
}

/**
 * Inverse of `installFabricStoreSkill` (v2.1 ADJ-NEWN-1/#4). Removes each
 * SKILL.md at `SKILL_DESTINATIONS.fabricStore`, then removes the empty parent.
 */
export async function uninstallFabricStoreSkill(
  projectRoot: string,
): Promise<UninstallStepResult[]> {
  return removeSkill("skill-store", SKILL_DESTINATIONS.fabricStore, projectRoot);
}

/**
 * v2.2 SK1-audit (W2-T5). Inverse of `installFabricAuditSkill`. Removes each
 * SKILL.md at `SKILL_DESTINATIONS.fabricAudit`, then removes the empty parent.
 */
export async function uninstallFabricAuditSkill(
  projectRoot: string,
): Promise<UninstallStepResult[]> {
  return removeSkill("skill-audit", SKILL_DESTINATIONS.fabricAudit, projectRoot);
}

/**
 * v2.2 SK2-connect (W3-T2). Inverse of `installFabricConnectSkill`. Removes each
 * SKILL.md at `SKILL_DESTINATIONS.fabricConnect`, then removes the empty parent.
 */
export async function uninstallFabricConnectSkill(
  projectRoot: string,
): Promise<UninstallStepResult[]> {
  return removeSkill("skill-connect", SKILL_DESTINATIONS.fabricConnect, projectRoot);
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

/**
 * F3: inverse of `installCitePolicyEvictHook`. Removes the
 * `cite-policy-evict.cjs` script from each client's `.<client>/hooks/`
 * directory. Without this the script lingered after `fabric uninstall`.
 */
export async function removeCitePolicyEvictHook(
  projectRoot: string,
): Promise<UninstallStepResult[]> {
  return removeHookScripts(
    "hook-cite-policy-evict-script",
    HOOK_SCRIPT_DESTINATIONS.citePolicyEvict,
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

/**
 * Inverse of `installHookLibs`. For each client's `<client>/hooks/lib/`
 * directory listed in {@link HOOK_LIB_DESTINATIONS}, deletes every `.cjs`
 * file present (best-effort — an absent directory yields a single skipped
 * row), then attempts to rmdir the now-empty `lib/` directory.
 *
 * The `.cjs` glob is intentional: future non-`.cjs` files in `<client>/
 * hooks/lib/` (e.g. user-authored helpers, README) are preserved per the
 * same conservatism that keeps `<client>/hooks/` itself in place.
 *
 * rc.16 TASK-004 (F2-tests): added in lock-step with installHookLibs so
 * `fabric uninstall` returns the workspace to a clean state without orphan
 * lib files.
 */
export async function removeHookLibs(
  projectRoot: string,
): Promise<UninstallStepResult[]> {
  const results: UninstallStepResult[] = [];
  for (const dirRel of HOOK_LIB_DESTINATIONS) {
    const dirAbs = join(projectRoot, dirRel);
    if (!existsSync(dirAbs)) {
      results.push({ step: "hook-lib", path: dirAbs, status: "skipped", message: "absent" });
      continue;
    }
    let entries: string[];
    try {
      entries = await readdir(dirAbs);
    } catch (error: unknown) {
      results.push({
        step: "hook-lib",
        path: dirAbs,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".cjs")) continue;
      results.push(await rmIfExists("hook-lib", join(dirAbs, entry)));
    }
    results.push(await rmDirIfEmpty("hook-lib-dir", dirAbs));
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
 * rc.19 TASK-003 — inverse of the three propagation writers
 * (`writeClaudeBootstrapThinShell`, `writeCodexBootstrapManagedBlock`,
 * `writeCursorBootstrapManagedBlock`).
 *
 * Strips Fabric-owned content from each propagation target:
 *   - `CLAUDE.md`: removes the `@.fabric/AGENTS.md` and `@.fabric/project-rules.md`
 *     `@`-import lines (line-level strip; leaves any user content alone).
 *   - `AGENTS.md`: strips the BOOTSTRAP managed block (markers inclusive,
 *     with optional preceding blank-line separator) via {@link BOOTSTRAP_REGEX}.
 *   - `.cursor/rules/fabric-bootstrap.mdc`: strips the BOOTSTRAP managed
 *     block; if the only remaining content is the YAML front-matter (i.e.
 *     no user-authored body), the file itself is deleted.
 *
 * Idempotent: when nothing fabric-owned is found in a target the step
 * records `skipped/no-fabric-section`. Running uninstall twice back-to-back
 * reports 100% skipped on the second pass.
 *
 * Files are NEVER deleted (except the Cursor mdc per the rule above), even
 * if all that remained was the managed block — install cannot prove it was
 * the file's creator, so uninstall preserves user-authored content
 * surrounding it (mirrors the rc.4 pointer-strip conservatism).
 *
 * Renamed from `stripFabricKnowledgeBaseSection` (rc.12 broad-gate-fabric-
 * lang TASK-006) when rc.19 split the writer into three per-client
 * propagators with distinct strip rules per target.
 */
export async function stripFabricBootstrapBlocks(
  projectRoot: string,
): Promise<UninstallStepResult[]> {
  const results: UninstallStepResult[] = [];

  // 1. CLAUDE.md — remove `@.fabric/AGENTS.md` + `@.fabric/project-rules.md` lines.
  results.push(await stripClaudeBootstrapImports(projectRoot));

  // 2. AGENTS.md — strip BOOTSTRAP managed block (regex-based).
  results.push(await stripManagedBlock(projectRoot, "AGENTS.md", { deleteWhenEmpty: false }));

  // 3. .cursor/rules/fabric-bootstrap.mdc — strip BOOTSTRAP managed block;
  // delete the file when the body is just YAML front-matter (i.e. fabric
  // was the only producer of meaningful content).
  results.push(
    await stripManagedBlock(projectRoot, join(".cursor", "rules", "fabric-bootstrap.mdc"), {
      deleteWhenEmpty: true,
    }),
  );

  return results;
}

/**
 * Remove `@.fabric/AGENTS.md` and `@.fabric/project-rules.md` lines from
 * `CLAUDE.md`. Line-level strip; whitespace-tolerant exact-match (mirrors
 * the install-side `hasExactLine` semantics).
 */
async function stripClaudeBootstrapImports(projectRoot: string): Promise<UninstallStepResult> {
  const step = "bootstrap-claude";
  const target = join(projectRoot, "CLAUDE.md");
  if (!existsSync(target)) {
    return { step, path: target, status: "skipped", message: "absent" };
  }
  let existing: string;
  try {
    existing = await readFile(target, "utf8");
  } catch (error: unknown) {
    return {
      step,
      path: target,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const managedLines = new Set(["@.fabric/AGENTS.md", "@.fabric/project-rules.md"]);
  const lines = existing.split(/\r?\n/);
  const filtered = lines.filter((l) => !managedLines.has(l.replace(/\s+$/, "")));
  if (filtered.length === lines.length) {
    return { step, path: target, status: "skipped", message: "no-fabric-section" };
  }
  // Collapse runs of trailing empty lines that the line removal may have
  // left behind. Idempotency target: re-running strip is a no-op.
  while (filtered.length > 1 && filtered[filtered.length - 1] === "" && filtered[filtered.length - 2] === "") {
    filtered.pop();
  }
  const next = filtered.join("\n");
  if (next === existing) {
    return { step, path: target, status: "skipped", message: "no-fabric-section" };
  }
  try {
    await atomicWriteText(target, next);
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

/**
 * Strip the BOOTSTRAP managed block (regex-matched, markers inclusive) from
 * the file at `projectRoot/relPath`. When `deleteWhenEmpty` is true and the
 * post-strip content has no user-authored body beyond YAML front-matter, the
 * file is deleted instead of left as an orphan front-matter shell.
 */
async function stripManagedBlock(
  projectRoot: string,
  relPath: string,
  options: { deleteWhenEmpty: boolean },
): Promise<UninstallStepResult> {
  const step = relPath.endsWith(".mdc") ? "bootstrap-cursor" : "bootstrap-codex";
  const target = join(projectRoot, relPath);
  if (!existsSync(target)) {
    return { step, path: target, status: "skipped", message: "absent" };
  }
  let existing: string;
  try {
    existing = await readFile(target, "utf8");
  } catch (error: unknown) {
    return {
      step,
      path: target,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const match = existing.match(BOOTSTRAP_REGEX);
  if (match === null) {
    return { step, path: target, status: "skipped", message: "no-fabric-section" };
  }
  const before = existing.slice(0, match.index ?? 0);
  const after = existing.slice((match.index ?? 0) + match[0].length);
  const filtered = `${before}${after.replace(/^\r?\n/, "")}`;

  if (options.deleteWhenEmpty && isFrontMatterOnly(filtered)) {
    try {
      await rm(target, { force: true });
      return { step, path: target, status: "removed", message: "front-matter-only" };
    } catch (error: unknown) {
      return {
        step,
        path: target,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  try {
    await atomicWriteText(target, filtered);
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

/**
 * True when `content` consists of nothing but a YAML front-matter block
 * (`---` … `---`) optionally followed by whitespace-only trailing content.
 * Used by {@link stripManagedBlock} to decide whether to delete the file
 * after a Cursor managed-block strip.
 */
function isFrontMatterOnly(content: string): boolean {
  // Strip leading whitespace, then attempt to match a front-matter block at
  // the head, then ensure the remainder is pure whitespace.
  const trimmed = content.replace(/^\s+/, "");
  const match = trimmed.match(/^---\n[\s\S]*?\n---\s*$/);
  if (match === null) return trimmed.length === 0;
  return true;
}

// -----------------------------------------------------------------------
// rc.19 TASK-002 — bootstrap snapshot uninstall
// -----------------------------------------------------------------------

/**
 * Inverse of `writeFabricAgentsSnapshot` — removes `.fabric/AGENTS.md` if
 * present. Idempotent: a missing file returns `status: 'skipped'` rather
 * than throwing. The companion file `.fabric/project-rules.md` is
 * intentionally preserved on uninstall because it holds user-authored
 * content (per locked decision NEW-4).
 */
export async function deleteFabricAgentsSnapshot(
  projectRoot: string,
): Promise<UninstallStepResult> {
  const target = fabricAgentsSnapshotPath(projectRoot);
  return rmIfExists("bootstrap-snapshot", target);
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
 *   3. Hook-lib removal (lib/*.cjs across all 3 client hook dirs — rc.16 TASK-004)
 *   4. Hook-script removal (knowledge-narrow → knowledge-broad → fabric-hint)
 *   5. Skill removal (fabric-import → fabric-review → fabric-archive)
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

  // 1. Three-end bootstrap blocks first (cheapest, reverses TASK-003
  // propagation writers from install). rc.19 TASK-003: renamed from
  // `stripFabricKnowledgeBaseSection`; the single-regex strip across three
  // identical targets is gone, replaced by per-client strip rules.
  await runAndCollect(results, "bootstrap-blocks", projectRoot, () =>
    stripFabricBootstrapBlocks(projectRoot),
  );

  // 1b. rc.19 TASK-002: remove the L1 bootstrap snapshot at .fabric/AGENTS.md.
  // The companion .fabric/project-rules.md is preserved (user-authored).
  await runAndCollectOne(results, "bootstrap-snapshot", projectRoot, () =>
    deleteFabricAgentsSnapshot(projectRoot),
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

  // 3. Hook libs (reverse of install order — libs come AFTER scripts in
  // install, so they come BEFORE scripts in uninstall). rc.16 TASK-004.
  await runAndCollect(results, "hook-lib", projectRoot, () => removeHookLibs(projectRoot));

  // 4. Hook scripts (reverse of install order)
  await runAndCollect(results, "hook-narrow-script", projectRoot, () =>
    removeKnowledgeHintNarrowHook(projectRoot),
  );
  await runAndCollect(results, "hook-broad-script", projectRoot, () =>
    removeKnowledgeHintBroadHook(projectRoot),
  );
  await runAndCollect(results, "hook-script", projectRoot, () =>
    removeArchiveHintHook(projectRoot),
  );
  // F3: cite-policy-evict.cjs (rc.34 TASK-06) was installed but never removed.
  await runAndCollect(results, "hook-cite-policy-evict-script", projectRoot, () =>
    removeCitePolicyEvictHook(projectRoot),
  );

  // 5. Skill files (reverse of install order: connect → audit → sync → import → review → archive)
  await runAndCollect(results, "skill-connect", projectRoot, () =>
    uninstallFabricConnectSkill(projectRoot),
  );
  await runAndCollect(results, "skill-audit", projectRoot, () =>
    uninstallFabricAuditSkill(projectRoot),
  );
  await runAndCollect(results, "skill-sync", projectRoot, () =>
    uninstallFabricSyncSkill(projectRoot),
  );
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
