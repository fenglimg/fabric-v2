import { chmodSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { atomicWriteJson, atomicWriteText } from "@fenglimg/fabric-shared/node/atomic-write";
import {
  BOOTSTRAP_MARKER_BEGIN,
  BOOTSTRAP_MARKER_END,
  BOOTSTRAP_REGEX,
  LEGACY_KB_REGEX,
} from "@fenglimg/fabric-shared/templates/bootstrap-canonical";

import { deepMerge } from "../config/json.js";
import {
  fabricAgentsSnapshotPath,
  projectRulesPath,
  readProjectRulesIfPresent,
} from "./write-bootstrap-snapshot.js";

/**
 * Install helpers for the v2 fabric-archive / fabric-review / fabric-import
 * Skills + the cross-client fabric-hint Stop hook (renamed from archive-hint
 * in rc.5 TASK-010). Each helper is idempotent — re-running `fabric install` (or
 * `fabric hooks install`) after the first successful run produces no diff.
 *
 * Wiring sites:
 *   - packages/cli/src/commands/install.ts  bootstrap stage (skill + hook + pointer)
 *   - packages/cli/src/commands/hooks.ts hooks command (re-install only)
 *
 * Templates resolved:
 *   - packages/cli/templates/skills/fabric-archive/SKILL.md          (TASK-002)
 *   - packages/cli/templates/skills/fabric-review/SKILL.md           (TASK-006)
 *   - packages/cli/templates/skills/fabric-import/SKILL.md           (rc.4 TASK-005)
 *   - packages/cli/templates/hooks/fabric-hint.cjs                   (rc.5 TASK-010)
 *   - packages/cli/templates/hooks/configs/claude-code.json          (TASK-004)
 *   - packages/cli/templates/hooks/configs/codex-hooks.json          (TASK-004)
 *   - packages/cli/templates/hooks/configs/cursor-hooks.json         (rc.5 TASK-010)
 */

// rc.14 TASK-002: diff-mode classification.
//   - "written"         : a write occurred (created or overwrote).
//   - "skipped"         : destination already matches canonical (no write).
//   - "error"           : the step failed.
//   - "drift"           : destination exists but content diverges from canonical
//                         (detected only when InstallOptions.detectDrift is set);
//                         the diff-mode caller is expected to abort the run.
//   - "missing-managed" : a managed file was deleted by the user and is being
//                         restored. Treated like "written" by most consumers
//                         (it is a write); the distinct label lets diff-mode
//                         reporting list which files were restored vs. freshly
//                         created.
export type InstallStepStatus =
  | "written"
  | "skipped"
  | "error"
  | "drift"
  | "missing-managed";

export type InstallStepResult = {
  step: string;
  path: string;
  status: InstallStepStatus;
  message?: string;
};

export type InstallOptions = {
  // rc.15 TASK-007: the `force?: boolean` field was deleted as dead code —
  // it was reserved for callers that wanted to revert local edits to a
  // skill / hook script, but no consumer ever passed it and copy semantics
  // are always idempotent. The type is intentionally left empty so the
  // public surface is unchanged (consumers continue passing `{}`).
};

const SKILL_TEMPLATE_REL = "skills/fabric-archive/SKILL.md";
const SKILL_REVIEW_TEMPLATE_REL = "skills/fabric-review/SKILL.md";
const SKILL_IMPORT_TEMPLATE_REL = "skills/fabric-import/SKILL.md";
const HOOK_SCRIPT_TEMPLATE_REL = "hooks/fabric-hint.cjs";
// rc.6 TASK-019 (E1): SessionStart broad-injection hook script. Sibling to
// fabric-hint.cjs — shares install/copy plumbing but is registered against a
// different hook event (SessionStart instead of Stop) in each client config.
const HOOK_BROAD_SCRIPT_TEMPLATE_REL = "hooks/knowledge-hint-broad.cjs";
// rc.6 TASK-020 (E2 + E4): PreToolUse narrow-injection hook script + edit-
// counter sidecar. Sibling to knowledge-hint-broad.cjs — same install/copy
// plumbing but registered against PreToolUse with Edit|Write|MultiEdit
// matchers in each client config.
const HOOK_NARROW_SCRIPT_TEMPLATE_REL = "hooks/knowledge-hint-narrow.cjs";
// rc.16 TASK-004 (F2-tests): shared `.cjs` helpers consumed by the three
// hook scripts at runtime via `require("./lib/<name>.cjs")`. Currently
// houses banner-i18n.cjs (rc.16 TASK-001) and session-digest-writer.cjs
// (pre-existing). The install pipeline copies EVERY `.cjs` file in this
// directory into each client's `<client>/hooks/lib/` so future additions
// ship without further wiring (e.g. a new `lib/foo.cjs` is auto-picked).
const HOOK_LIB_TEMPLATE_DIR_REL = "hooks/lib";
const CLAUDE_HOOK_CONFIG_TEMPLATE_REL = "hooks/configs/claude-code.json";
const CODEX_HOOK_CONFIG_TEMPLATE_REL = "hooks/configs/codex-hooks.json";
const CURSOR_HOOK_CONFIG_TEMPLATE_REL = "hooks/configs/cursor-hooks.json";

/**
 * Project-root-relative destination paths for the three v2 Skill markdown
 * files, one entry per supported client. Source of truth shared by `fab install`
 * (install) and `fab uninstall` (removal). Paths are stored with forward
 * slashes; callers must run them through `join(projectRoot, ...)` to obtain
 * absolute, OS-normalized targets.
 *
 * Client coverage: Skills are only meaningful for Claude Code and Codex CLI
 * (the two clients that surface a Skills directory); Cursor is intentionally
 * absent because it has no Skills concept.
 */
export const SKILL_DESTINATIONS = {
  fabricArchive: [
    ".claude/skills/fabric-archive/SKILL.md",
    ".codex/skills/fabric-archive/SKILL.md",
  ],
  fabricReview: [
    ".claude/skills/fabric-review/SKILL.md",
    ".codex/skills/fabric-review/SKILL.md",
  ],
  fabricImport: [
    ".claude/skills/fabric-import/SKILL.md",
    ".codex/skills/fabric-import/SKILL.md",
  ],
} as const;


/**
 * Project-root-relative destination paths for the three cross-client hook
 * scripts (Stop / SessionStart / PreToolUse). Source of truth shared by
 * `fab install` (install) and `fab uninstall` (removal). All three clients —
 * Claude Code, Codex CLI, and Cursor — receive every script.
 */
export const HOOK_SCRIPT_DESTINATIONS = {
  fabricHint: [
    ".claude/hooks/fabric-hint.cjs",
    ".codex/hooks/fabric-hint.cjs",
    ".cursor/hooks/fabric-hint.cjs",
  ],
  knowledgeHintBroad: [
    ".claude/hooks/knowledge-hint-broad.cjs",
    ".codex/hooks/knowledge-hint-broad.cjs",
    ".cursor/hooks/knowledge-hint-broad.cjs",
  ],
  knowledgeHintNarrow: [
    ".claude/hooks/knowledge-hint-narrow.cjs",
    ".codex/hooks/knowledge-hint-narrow.cjs",
    ".cursor/hooks/knowledge-hint-narrow.cjs",
  ],
} as const;

/**
 * Project-root-relative destination DIRECTORIES (one per client) for the
 * shared hook-lib `.cjs` helpers. The lib directory is co-located next to
 * each client's hook scripts so the scripts can `require("./lib/<name>.cjs")`
 * with a relative path that works identically in dev (templates/) and in
 * the user's installed workspace.
 *
 * Source of truth shared by `fab install` (copy) and `fab uninstall` (prune).
 *
 * rc.16 TASK-004 (F2-tests): added when banner-i18n.cjs (rc.16 TASK-001)
 * became the second `lib/*.cjs` file required at hook runtime. The pre-
 * existing session-digest-writer.cjs was historically NOT shipped — it
 * was either tolerated as a soft-fail (writer wraps require in try/catch)
 * or shipped via an out-of-band path; this constant unifies the install
 * pipeline so every `.cjs` under templates/hooks/lib/ ships uniformly.
 */
export const HOOK_LIB_DESTINATIONS = [
  ".claude/hooks/lib",
  ".codex/hooks/lib",
  ".cursor/hooks/lib",
] as const;

/**
 * Project-root-relative paths of each client's hook-config JSON file that
 * `fab install` merges fabric entries into. Source of truth shared with
 * `fab uninstall` (which must locate and prune those entries).
 */
export const HOOK_CONFIG_TARGETS = {
  claudeCode: ".claude/settings.json",
  codex: ".codex/hooks.json",
  cursor: ".cursor/hooks.json",
} as const;

/**
 * Dotted JSON-path locations of the array slots each client's hook-config
 * uses for the three fabric events. Mirrors the `arrayAppendPaths` argument
 * passed to {@link mergeJsonIdempotent}. Source of truth shared with
 * `fab uninstall` (which must prune fabric entries from those same arrays).
 *
 * Note the client-specific shape: Claude Code groups under `hooks.*`
 * (PascalCase event names), Codex under `events.*` (PascalCase), and Cursor
 * under `hooks.*` (camelCase event names per https://cursor.com/cn/docs/hooks).
 * Preserve the upstream schemas exactly — these dotted paths MUST byte-match
 * each template's top-level keys, otherwise `arrayAppendWithDedupe` in
 * `deepMerge` silently falls back to array-REPLACE on re-install.
 */
export const HOOK_CONFIG_ARRAY_PATHS = {
  claudeCode: ["hooks.Stop", "hooks.SessionStart", "hooks.PreToolUse"],
  codex: ["events.Stop", "events.SessionStart", "events.PreToolUse"],
  cursor: ["hooks.stop", "hooks.sessionStart", "hooks.preToolUse"],
} as const;

/**
 * Per-client `command` field values that identify a fabric-owned hook entry
 * inside a hook-config array. Source of truth shared with `fab uninstall`
 * (which prunes entries whose `command` matches one of these literals).
 * Values match the strings shipped in templates/hooks/configs/*.json.
 */
export const FABRIC_HOOK_COMMAND_PATHS = {
  claudeCode: {
    fabricHint: "${CLAUDE_PROJECT_DIR}/.claude/hooks/fabric-hint.cjs",
    knowledgeHintBroad: "${CLAUDE_PROJECT_DIR}/.claude/hooks/knowledge-hint-broad.cjs",
    knowledgeHintNarrow: "${CLAUDE_PROJECT_DIR}/.claude/hooks/knowledge-hint-narrow.cjs",
  },
  codex: {
    fabricHint: "\"$(git rev-parse --show-toplevel)/.codex/hooks/fabric-hint.cjs\"",
    knowledgeHintBroad: "\"$(git rev-parse --show-toplevel)/.codex/hooks/knowledge-hint-broad.cjs\"",
    knowledgeHintNarrow: "\"$(git rev-parse --show-toplevel)/.codex/hooks/knowledge-hint-narrow.cjs\"",
  },
  cursor: {
    fabricHint: ".cursor/hooks/fabric-hint.cjs",
    knowledgeHintBroad: ".cursor/hooks/knowledge-hint-broad.cjs",
    knowledgeHintNarrow: ".cursor/hooks/knowledge-hint-narrow.cjs",
  },
} as const;

/**
 * rc.19 TASK-003 — bootstrap marker constants are now owned by
 * `@fenglimg/fabric-shared/templates/bootstrap-canonical` so the CLI install
 * pipeline (writer) and the server doctor (drift comparator) consume the same
 * source of truth. Re-exported here for backwards-compatible imports
 * (uninstall helper + integration tests still reach for them via this module).
 *
 * The legacy `fabric:knowledge-base` marker pair has been retired from active
 * use: install no longer writes it, and any pre-existing occurrence in the
 * three propagation targets is cleaned up by the per-client writers below
 * (clean-slate, no migration shim — feedback_clean_slate.md memory).
 */
export {
  BOOTSTRAP_MARKER_BEGIN,
  BOOTSTRAP_MARKER_END,
  BOOTSTRAP_REGEX,
};

/**
 * Read the `fabric_language` value from `.fabric/fabric-config.json` at
 * `projectRoot`. Returns the raw string value (one of `"match-existing" |
 * "zh-CN" | "en" | "zh-CN-hybrid"`) when present, else `"match-existing"` as
 * the documented default. Tolerant of missing files and malformed JSON: the
 * fallback keeps the install path robust even when called before the
 * fabric-config has been scaffolded (e.g. an isolated `fab hooks install` on
 * a half-initialized workspace).
 *
 * rc.12 broad-gate-fabric-lang TASK-006: extracted from install.ts so the
 * section writer can resolve the value without coupling to scan.ts's
 * heavier `resolveFabricLanguage` / `detectExistingLanguage` machinery.
 */
export function readFabricLanguagePreference(projectRoot: string): string {
  const configPath = join(projectRoot, ".fabric", "fabric-config.json");
  if (!existsSync(configPath)) {
    return "match-existing";
  }
  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "match-existing";
    }
    const value = (parsed as Record<string, unknown>)["fabric_language"];
    return typeof value === "string" && value.length > 0 ? value : "match-existing";
  } catch {
    return "match-existing";
  }
}

/**
 * Copy templates/skills/fabric-archive/SKILL.md into both .claude/skills/
 * and .codex/skills/ subtrees under the project root. Idempotent: if the
 * destination already contains an identical copy, no write occurs.
 *
 * v2.0.0-rc.28 TASK-01 (audit §3.1): also walks the skill's `ref/` directory
 * and ships every `*.md` companion to the same client subtrees so
 * load-on-demand references resolve at runtime.
 */
export async function installFabricArchiveSkill(
  projectRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult[]> {
  const source = await readTemplate(SKILL_TEMPLATE_REL);
  const targets = SKILL_DESTINATIONS.fabricArchive.map((rel) => join(projectRoot, rel));
  const results: InstallStepResult[] = [];
  for (const target of targets) {
    results.push(await copyTextIdempotent("skill", source, target));
  }
  results.push(...(await installSkillRefFiles(projectRoot, "fabric-archive")));
  return results;
}

/**
 * Copy templates/skills/fabric-review/SKILL.md into both .claude/skills/
 * and .codex/skills/ subtrees under the project root. Idempotent: if the
 * destination already contains an identical copy, no write occurs.
 *
 * Sibling installer to {@link installFabricArchiveSkill}; the v2/rc.3
 * fabric-review Skill is deployed alongside fabric-archive so the user's
 * AI client surfaces both archive (write-side) and review (read-side)
 * knowledge flows.
 */
export async function installFabricReviewSkill(
  projectRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult[]> {
  const source = await readTemplate(SKILL_REVIEW_TEMPLATE_REL);
  const targets = SKILL_DESTINATIONS.fabricReview.map((rel) => join(projectRoot, rel));
  const results: InstallStepResult[] = [];
  for (const target of targets) {
    results.push(await copyTextIdempotent("skill-review", source, target));
  }
  results.push(...(await installSkillRefFiles(projectRoot, "fabric-review")));
  return results;
}

/**
 * Copy templates/skills/fabric-import/SKILL.md into both .claude/skills/
 * and .codex/skills/ subtrees under the project root. Idempotent: if the
 * destination already contains an identical copy, no write occurs.
 *
 * Sibling installer to {@link installFabricArchiveSkill} and
 * {@link installFabricReviewSkill}; the v2/rc.4 fabric-import Skill is
 * deployed alongside archive (write-side) and review (read-side) so the
 * user's AI client surfaces the cold-start enrichment flow that backfills
 * knowledge entries from git history and existing docs.
 */
export async function installFabricImportSkill(
  projectRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult[]> {
  const source = await readTemplate(SKILL_IMPORT_TEMPLATE_REL);
  const targets = SKILL_DESTINATIONS.fabricImport.map((rel) => join(projectRoot, rel));
  const results: InstallStepResult[] = [];
  for (const target of targets) {
    results.push(await copyTextIdempotent("skill-import", source, target));
  }
  results.push(...(await installSkillRefFiles(projectRoot, "fabric-import")));
  return results;
}

/**
 * v2.0.0-rc.28 TASK-01 (audit §3.1): copy every `*.md` file under the
 * skill's `templates/skills/<slug>/ref/` directory to BOTH `.claude/skills/
 * <slug>/ref/` and `.codex/skills/<slug>/ref/`. Idempotent — unchanged files
 * skip the write. Missing template `ref/` directory degrades silently with a
 * single `skipped` row noting `no-ref-files` so retro-fitting older skills
 * doesn't require schema migration. Cursor is intentionally absent: it has
 * no Skills concept, matching SKILL_DESTINATIONS coverage.
 */
async function installSkillRefFiles(
  projectRoot: string,
  skillSlug: string,
): Promise<InstallStepResult[]> {
  let refTemplateDir: string;
  try {
    refTemplateDir = findTemplatePath(`skills/${skillSlug}/ref`);
  } catch {
    // No ref/ directory in this skill's template tree — silently skip. Most
    // skills do not have ref/ companions; only those refactored under rc.28
    // TASK-01 do. The single-row 'skipped' return preserves the install
    // summary's installed/skipped/error accounting.
    return [
      {
        step: "skill-ref",
        path: `skills/${skillSlug}/ref`,
        status: "skipped",
        message: `no-ref-dir: ${skillSlug}`,
      },
    ];
  }
  let refFiles: string[];
  try {
    refFiles = readdirSync(refTemplateDir).filter((name) => name.endsWith(".md"));
  } catch {
    return [
      {
        step: "skill-ref",
        path: refTemplateDir,
        status: "skipped",
        message: `no-ref-files: ${skillSlug}`,
      },
    ];
  }
  if (refFiles.length === 0) {
    return [
      {
        step: "skill-ref",
        path: refTemplateDir,
        status: "skipped",
        message: `no-ref-files: ${skillSlug}`,
      },
    ];
  }
  const clientPrefixes = [".claude", ".codex"] as const;
  const results: InstallStepResult[] = [];
  for (const refFile of refFiles) {
    const sourcePath = join(refTemplateDir, refFile);
    let source: string;
    try {
      source = readFileSync(sourcePath, "utf8");
    } catch (error: unknown) {
      results.push({
        step: "skill-ref",
        path: sourcePath,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    for (const prefix of clientPrefixes) {
      const target = join(projectRoot, prefix, "skills", skillSlug, "ref", refFile);
      results.push(await copyTextIdempotent("skill-ref", source, target));
    }
  }
  return results;
}

/**
 * Copy templates/hooks/fabric-hint.cjs into all three supported clients'
 * hooks directories: .claude/hooks/, .codex/hooks/, and .cursor/hooks/.
 * Marked executable on POSIX (chmod 0o755). Skipped on Windows where the
 * platform ignores the bit.
 *
 * Renamed from archive-hint in rc.5 TASK-010 to reflect the script's
 * expanded three-signal scope (archive / review / import). The function
 * name `installArchiveHintHook` is preserved for call-site compatibility.
 */
export async function installArchiveHintHook(
  projectRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult[]> {
  const source = await readTemplate(HOOK_SCRIPT_TEMPLATE_REL);
  const targets = HOOK_SCRIPT_DESTINATIONS.fabricHint.map((rel) => join(projectRoot, rel));
  const results: InstallStepResult[] = [];
  for (const target of targets) {
    const result = await copyTextIdempotent("hook-script", source, target);
    if (result.status === "written" && process.platform !== "win32") {
      try {
        chmodSync(target, 0o755);
      } catch {
        // best-effort — hook still functions when invoked via `node script.cjs`
      }
    }
    results.push(result);
  }
  return results;
}

/**
 * Copy templates/hooks/knowledge-hint-broad.cjs into all three supported
 * clients' hooks directories: .claude/hooks/, .codex/hooks/, .cursor/hooks/.
 * Marked executable on POSIX (chmod 0o755). Skipped on Windows where the
 * platform ignores the bit.
 *
 * rc.6 TASK-019 (E1) — SessionStart broad-injection hook. Sibling to
 * {@link installArchiveHintHook}; both helpers share the copy plumbing but
 * each script is wired to a different hook event (Stop vs SessionStart) in
 * the per-client config templates.
 */
export async function installKnowledgeHintBroadHook(
  projectRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult[]> {
  const source = await readTemplate(HOOK_BROAD_SCRIPT_TEMPLATE_REL);
  const targets = HOOK_SCRIPT_DESTINATIONS.knowledgeHintBroad.map((rel) => join(projectRoot, rel));
  const results: InstallStepResult[] = [];
  for (const target of targets) {
    const result = await copyTextIdempotent("hook-broad-script", source, target);
    if (result.status === "written" && process.platform !== "win32") {
      try {
        chmodSync(target, 0o755);
      } catch {
        // best-effort — hook still functions when invoked via `node script.cjs`
      }
    }
    results.push(result);
  }
  return results;
}

/**
 * Copy templates/hooks/knowledge-hint-narrow.cjs into all three supported
 * clients' hooks directories: .claude/hooks/, .codex/hooks/, .cursor/hooks/.
 * Marked executable on POSIX (chmod 0o755). Skipped on Windows where the
 * platform ignores the bit.
 *
 * rc.6 TASK-020 (E2 + E4) — PreToolUse narrow-injection hook + edit-counter
 * sidecar. Sibling to {@link installKnowledgeHintBroadHook}; all three
 * cross-client hook scripts share the same copy plumbing and only differ in
 * the hook event their per-client config templates wire them to:
 *   - fabric-hint.cjs           → Stop          (rc.5 TASK-010)
 *   - knowledge-hint-broad.cjs  → SessionStart  (rc.6 TASK-019)
 *   - knowledge-hint-narrow.cjs → PreToolUse    (rc.6 TASK-020)
 */
export async function installKnowledgeHintNarrowHook(
  projectRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult[]> {
  const source = await readTemplate(HOOK_NARROW_SCRIPT_TEMPLATE_REL);
  const targets = HOOK_SCRIPT_DESTINATIONS.knowledgeHintNarrow.map((rel) => join(projectRoot, rel));
  const results: InstallStepResult[] = [];
  for (const target of targets) {
    const result = await copyTextIdempotent("hook-narrow-script", source, target);
    if (result.status === "written" && process.platform !== "win32") {
      try {
        chmodSync(target, 0o755);
      } catch {
        // best-effort — hook still functions when invoked via `node script.cjs`
      }
    }
    results.push(result);
  }
  return results;
}

/**
 * Copy every `.cjs` file from templates/hooks/lib/ into each client's
 * `<client>/hooks/lib/` directory (.claude/hooks/lib/, .codex/hooks/lib/,
 * .cursor/hooks/lib/). Idempotent per file via {@link copyTextIdempotent}.
 *
 * The directory listing is read at install time (not hard-coded) so
 * adding a new `templates/hooks/lib/foo.cjs` in a future RC ships
 * automatically without further wiring — keeps the lib directory the
 * single source of truth for hook-side helpers.
 *
 * rc.16 TASK-004 (F2-tests): introduced when banner-i18n.cjs became a
 * hard runtime dependency of fabric-hint.cjs and knowledge-hint-broad.cjs.
 * Without this step the user-facing hook scripts crash with
 * `Cannot find module './lib/banner-i18n.cjs'` on the first Stop /
 * SessionStart event after install.
 *
 * rc.24 TASK-04: also ships `cite-line-parser.cjs` — a hand-authored CJS
 * twin of `packages/shared/src/cite-line-parser.ts` that fabric-hint.cjs
 * `require()`s to parse `KB:` cite lines (including the rc.24 contract-
 * syntax operators that populate `cite_commitments` on
 * assistant_turn_observed events). The auto-glob pattern (every `.cjs`
 * under templates/hooks/lib/) means the new file is picked up here
 * without further wiring; behavioral parity with the TS source is pinned
 * by packages/cli/__tests__/cite-line-parser-parity.test.ts. The parser
 * uses `parseCiteLine(raw)` as its single entry point — both this comment
 * and the parity test reference that name, so a grep for `parseCiteLine`
 * or `cite-line-parser` finds the install-side wiring.
 *
 * Returns one InstallStepResult per (client × lib file) — N libs shipped
 * across 3 clients = 3N rows. Empty lib directory is allowed (returns
 * a single skipped row noting the absence) so the function is safe to
 * call before any libs have been authored.
 */
export async function installHookLibs(
  projectRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult[]> {
  const libTemplateDir = findTemplatePath(HOOK_LIB_TEMPLATE_DIR_REL);
  let libFiles: string[];
  try {
    libFiles = readdirSync(libTemplateDir).filter((name) => name.endsWith(".cjs"));
  } catch (error: unknown) {
    return [
      {
        step: "hook-lib",
        path: libTemplateDir,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      },
    ];
  }

  if (libFiles.length === 0) {
    return [
      {
        step: "hook-lib",
        path: libTemplateDir,
        status: "skipped",
        message: "no-libs-to-ship",
      },
    ];
  }

  const results: InstallStepResult[] = [];
  for (const libFile of libFiles) {
    const sourcePath = join(libTemplateDir, libFile);
    let source: string;
    try {
      source = readFileSync(sourcePath, "utf8");
    } catch (error: unknown) {
      results.push({
        step: "hook-lib",
        path: sourcePath,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    for (const destDirRel of HOOK_LIB_DESTINATIONS) {
      const target = join(projectRoot, destDirRel, libFile);
      results.push(await copyTextIdempotent("hook-lib", source, target));
    }
  }
  return results;
}

/**
 * Deep-merge templates/hooks/configs/claude-code.json into the user's
 * `.claude/settings.json`. `hooks.Stop`, `hooks.SessionStart`, and
 * `hooks.PreToolUse` arrays are array-append-with-dedupe (preserves
 * user-authored entries; never duplicates the fabric entries on re-run).
 *
 * rc.6 TASK-019: SessionStart array added alongside Stop.
 * rc.6 TASK-020: PreToolUse array added alongside SessionStart. Each event
 * slot has its own dedupe key per the deepMerge contract — the three event
 * arrays never interleave.
 */
export async function mergeClaudeCodeHookConfig(
  projectRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult> {
  const fragment = await readJsonTemplate(CLAUDE_HOOK_CONFIG_TEMPLATE_REL);
  const targetPath = join(projectRoot, HOOK_CONFIG_TARGETS.claudeCode);
  return mergeJsonIdempotent(
    "claude-hook-config",
    targetPath,
    fragment,
    [...HOOK_CONFIG_ARRAY_PATHS.claudeCode],
  );
}

/**
 * Deep-merge templates/hooks/configs/codex-hooks.json into the user's
 * `.codex/hooks.json`. `events.Stop`, `events.SessionStart`, and
 * `events.PreToolUse` arrays are array-append-with-dedupe.
 *
 * rc.6 TASK-019: SessionStart added.
 * rc.6 TASK-020: PreToolUse added.
 */
export async function mergeCodexHookConfig(
  projectRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult> {
  const fragment = await readJsonTemplate(CODEX_HOOK_CONFIG_TEMPLATE_REL);
  const targetPath = join(projectRoot, HOOK_CONFIG_TARGETS.codex);
  return mergeJsonIdempotent(
    "codex-hook-config",
    targetPath,
    fragment,
    [...HOOK_CONFIG_ARRAY_PATHS.codex],
  );
}

/**
 * Deep-merge templates/hooks/configs/cursor-hooks.json into the user's
 * `.cursor/hooks.json`. `hooks.stop`, `hooks.sessionStart`, and
 * `hooks.preToolUse` arrays are array-append-with-dedupe. Top-level envelope
 * is `{version: 1, hooks: {…}}` per https://cursor.com/cn/docs/hooks.
 *
 * Added in rc.5 TASK-010 to bring Cursor to parity with Claude Code and
 * Codex CLI for the cross-client hook surface. rc.6 TASK-019 filled the
 * SessionStart slot; rc.6 TASK-020 fills the PreToolUse slot. rc.14 TASK-001
 * corrected the top-level envelope shape (was wrong `events.*` PascalCase).
 */
export async function mergeCursorHookConfig(
  projectRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult> {
  const fragment = await readJsonTemplate(CURSOR_HOOK_CONFIG_TEMPLATE_REL);
  const targetPath = join(projectRoot, HOOK_CONFIG_TARGETS.cursor);
  return mergeJsonIdempotent(
    "cursor-hook-config",
    targetPath,
    fragment,
    [...HOOK_CONFIG_ARRAY_PATHS.cursor],
  );
}

// ===========================================================================
// rc.19 TASK-003 — three-end bootstrap propagation
// ===========================================================================
//
// The legacy single-writer `addFabricKnowledgeBaseSection` has been split into
// three per-client thin-shell writers, each tailored to how that client
// actually consumes the bootstrap:
//
//   - Claude Code: real `@`-import directives in CLAUDE.md (no managed block).
//   - Codex CLI:   byte-copy managed block in root AGENTS.md.
//   - Cursor:      byte-copy managed block in `.cursor/rules/fabric-bootstrap.mdc`
//                  prefixed with YAML front-matter (Cursor directory-rule
//                  contract: `alwaysApply: true`).
//
// All three writers consume the L1 bootstrap snapshot at `.fabric/AGENTS.md`
// (written by `writeFabricAgentsSnapshot` from write-bootstrap-snapshot.ts in
// TASK-002) plus the optional `.fabric/project-rules.md` (user-authored, only-
// if-exists). The shared helper {@link buildManagedBlockBody} concatenates
// these two sources so the Codex and Cursor managed blocks contain byte-
// identical content.
//
// Clean-slate (no migration shim):
//   - CLAUDE.md / AGENTS.md / .cursor/rules/fabric-bootstrap.mdc: any pre-
//     existing legacy `fabric:knowledge-base` marker pair is stripped at
//     install time. The new `fabric:bootstrap` marker is the only managed
//     marker going forward.
//   - .cursor/rules (legacy flat-file path): deleted on install when present.
//     Cursor's real convention is the directory-rule `.cursor/rules/*.mdc`.
//
// Idempotency contract: each writer must produce a byte-identical destination
// state on second invocation against an unchanged input (snapshot + optional
// project-rules). The integration test matrix in TASK-008 asserts this across
// all three targets.

/**
 * Build the byte content embedded inside the Codex / Cursor managed blocks.
 *
 * Concatenates:
 *   1. `.fabric/AGENTS.md` (BOOTSTRAP_CANONICAL snapshot written by TASK-002)
 *   2. `\n---\n` separator + `.fabric/project-rules.md` content WHEN that
 *      user-authored companion file exists (only-if-exists per locked
 *      decision NEW-4; never scaffolded by install).
 *
 * Pure read — no filesystem mutation. Caller is responsible for ensuring the
 * snapshot exists (the bootstrap-stage install order guarantees this since
 * `writeFabricAgentsSnapshot` runs immediately before the three propagation
 * writers).
 *
 * Throws if `.fabric/AGENTS.md` is missing: the propagation writers depend on
 * the snapshot being present, and missing snapshot indicates an install-order
 * regression that should fail loudly rather than emit an empty managed block.
 */
export function buildManagedBlockBody(targetRoot: string): string {
  const snapshotPath = fabricAgentsSnapshotPath(targetRoot);
  const snapshot = readFileSync(snapshotPath, "utf8");
  const projectRules = readProjectRulesIfPresent(targetRoot);
  if (projectRules === null) {
    return snapshot;
  }
  return `${snapshot}\n---\n${projectRules}`;
}

/**
 * Wrap a managed-block body in the BOOTSTRAP marker pair. Used by the Codex
 * and Cursor writers to ensure byte-identical marker formatting across the
 * two targets (only difference between them is the file path and the
 * Cursor-specific YAML front-matter prefix).
 */
function wrapInBootstrapMarkers(body: string): string {
  return `${BOOTSTRAP_MARKER_BEGIN}\n${body}\n${BOOTSTRAP_MARKER_END}`;
}

/**
 * Strip any legacy `fabric:knowledge-base` marker region from `existing`,
 * including an optional preceding blank-line separator (mirrors the
 * BOOTSTRAP_REGEX shape). Returns the cleaned string. Idempotent: no-op when
 * the legacy marker is absent.
 *
 * Used by all three TASK-003 writers as the first transform on any pre-
 * existing target file so clean-slate migration happens transparently on
 * install (per memory feedback_clean_slate.md — no compat shim).
 */
function stripLegacyKnowledgeBaseSection(existing: string): string {
  const match = existing.match(LEGACY_KB_REGEX);
  if (match === null) return existing;
  const before = existing.slice(0, match.index ?? 0);
  const after = existing.slice((match.index ?? 0) + match[0].length);
  return `${before}${after.replace(/^\r?\n/, "")}`;
}

const CLAUDE_BOOTSTRAP_HEADER = "# Project Knowledge";
const CLAUDE_AGENTS_IMPORT_LINE = "@.fabric/AGENTS.md";
const CLAUDE_PROJECT_RULES_IMPORT_LINE = "@.fabric/project-rules.md";

/**
 * Write `CLAUDE.md` as a thin-shell with real Claude `@`-import directives
 * pointing at the canonical L1 snapshot (and the optional project-rules
 * companion). No managed block — Claude Code resolves `@<path>` lines at
 * runtime so we want the actual references in plain markdown.
 *
 * Idempotency: each `@`-import line is line-level idempotent. We grep the
 * file for an exact-line match before appending; if present, we leave it
 * alone. The project-rules `@`-line is only written when the companion file
 * exists; if it does not, we also strip any stale `@.fabric/project-rules.md`
 * line from CLAUDE.md so the import set stays consistent with on-disk
 * reality.
 *
 * Clean-slate: any legacy `fabric:knowledge-base` managed-section region is
 * stripped on first invocation (one-shot migration; idempotent on re-run).
 *
 * Bootstrap header: when CLAUDE.md does not pre-exist, we seed it with a
 * single `# Project Knowledge` header before the imports so the file is
 * self-explanatory; when CLAUDE.md does exist we leave user content alone
 * and just append the missing import lines at the end (separated by a
 * blank line for readability).
 */
export async function writeClaudeBootstrapThinShell(
  targetRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult> {
  const step = "bootstrap-claude";
  const target = join(targetRoot, "CLAUDE.md");
  const projectRulesPresent = existsSync(projectRulesPath(targetRoot));

  let existing = "";
  let preExisted = false;
  if (existsSync(target)) {
    preExisted = true;
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
  }

  // Phase 1: clean-slate strip of any legacy fabric:knowledge-base section.
  let next = stripLegacyKnowledgeBaseSection(existing);

  // Phase 2: drop stale project-rules @-import when the companion file is
  // absent on disk. Keeps the import set consistent with reality.
  if (!projectRulesPresent) {
    next = removeImportLine(next, CLAUDE_PROJECT_RULES_IMPORT_LINE);
  }

  // Phase 3: seed header if file did not pre-exist (or was wiped to empty
  // by the legacy-strip + import-strip above).
  if (!preExisted && next.length === 0) {
    next = `${CLAUDE_BOOTSTRAP_HEADER}\n`;
  }

  // Phase 4: append `@`-import lines as needed (line-level idempotent).
  next = ensureImportLine(next, CLAUDE_AGENTS_IMPORT_LINE);
  if (projectRulesPresent) {
    next = ensureImportLine(next, CLAUDE_PROJECT_RULES_IMPORT_LINE);
  }

  if (next === existing) {
    return { step, path: target, status: "skipped", message: "up-to-date" };
  }

  try {
    await mkdir(dirname(target), { recursive: true });
    await atomicWriteText(target, next);
    return { step, path: target, status: "written" };
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
 * Append `line` to `content` as its own newline-terminated line IFF no exact
 * line-match already exists. Separates the new line from the previous file
 * content with a single blank line (when previous content does not already
 * end with one). Returns the new content.
 */
function ensureImportLine(content: string, line: string): string {
  if (hasExactLine(content, line)) return content;
  if (content.length === 0) return `${line}\n`;
  const endsWithBlank = content.endsWith("\n\n");
  const endsWithNewline = content.endsWith("\n");
  if (endsWithBlank) {
    return `${content}${line}\n`;
  }
  if (endsWithNewline) {
    return `${content}\n${line}\n`;
  }
  return `${content}\n\n${line}\n`;
}

/**
 * Strip every line whose trimmed-right content exactly equals `line` from
 * `content`. Returns the cleaned content. Idempotent on absence.
 */
function removeImportLine(content: string, line: string): string {
  const lines = content.split(/\r?\n/);
  const filtered = lines.filter((l) => l.replace(/\s+$/, "") !== line);
  // Reassemble using \n (we normalize to LF on write — CRLF preservation is
  // an explicit non-goal per the rc.19 byte-comparison contract).
  return filtered.join("\n");
}

/**
 * True when `content` contains a line whose trimmed-right content exactly
 * equals `line`. Trailing whitespace tolerated so user-edited copies do not
 * trigger spurious re-append on second install.
 */
function hasExactLine(content: string, line: string): boolean {
  const lines = content.split(/\r?\n/);
  return lines.some((l) => l.replace(/\s+$/, "") === line);
}

/**
 * Write the BOOTSTRAP managed block to root `AGENTS.md`, sourced from
 * `buildManagedBlockBody`. In-place replace when the BOOTSTRAP marker pair is
 * already present; append with a blank-line separator when absent. Pre-
 * existing user content outside the markers is preserved verbatim (managed-
 * section invariant).
 *
 * Clean-slate: any legacy `fabric:knowledge-base` region is stripped on first
 * invocation so a single managed block (the new `fabric:bootstrap` one) is
 * the only Fabric-owned region after install.
 *
 * Creates AGENTS.md if missing (root anchor responsibility moved to bootstrap-
 * stage per rc.19 TASK-003 — scaffold-stage no longer writes it).
 */
export async function writeCodexBootstrapManagedBlock(
  targetRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult> {
  const step = "bootstrap-codex";
  const target = join(targetRoot, "AGENTS.md");

  let existing = "";
  if (existsSync(target)) {
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
  }

  const body = buildManagedBlockBody(targetRoot);
  const managedBlock = wrapInBootstrapMarkers(body);

  // Phase 1: clean-slate strip of any legacy fabric:knowledge-base section.
  const stripped = stripLegacyKnowledgeBaseSection(existing);

  // Phase 2: in-place replace of new fabric:bootstrap section, else append.
  let next: string;
  const match = stripped.match(BOOTSTRAP_REGEX);
  if (match !== null) {
    const before = stripped.slice(0, match.index ?? 0);
    const after = stripped.slice((match.index ?? 0) + match[0].length);
    const cleaned = `${before}${after.replace(/^\r?\n/, "")}`;
    const trailingNewline = cleaned.length === 0 || cleaned.endsWith("\n") ? "" : "\n";
    next = `${cleaned}${trailingNewline}${cleaned.length === 0 ? "" : "\n"}${managedBlock}\n`;
  } else {
    if (stripped.length === 0) {
      next = `${managedBlock}\n`;
    } else {
      const trailingNewline = stripped.endsWith("\n") ? "" : "\n";
      next = `${stripped}${trailingNewline}\n${managedBlock}\n`;
    }
  }

  if (next === existing) {
    return { step, path: target, status: "skipped", message: "up-to-date" };
  }

  try {
    await mkdir(dirname(target), { recursive: true });
    await atomicWriteText(target, next);
    return { step, path: target, status: "written" };
  } catch (error: unknown) {
    return {
      step,
      path: target,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

const CURSOR_RULE_FRONT_MATTER =
  "---\nalwaysApply: true\ndescription: Fabric Protocol bootstrap rules\n---\n\n";

const CURSOR_LEGACY_FLAT_FILE_REL = join(".cursor", "rules");
const CURSOR_BOOTSTRAP_MDC_REL = join(".cursor", "rules", "fabric-bootstrap.mdc");

/**
 * Write the BOOTSTRAP managed block to `.cursor/rules/fabric-bootstrap.mdc`,
 * prefixed with the Cursor directory-rule YAML front-matter
 * (`alwaysApply: true`) so the rule is always active.
 *
 * Clean-slate migration: if the legacy `.cursor/rules` flat-file (pre-
 * directory-rule convention) exists AS A FILE (not a directory), delete it.
 * Per memory feedback_clean_slate.md — the pre-user phase prefers clean-slate
 * refactors over preservation. Cursor's real convention is directory-rule
 * `.cursor/rules/*.mdc`; the flat-file path was a drift bug in rc.12-rc.18.
 *
 * Idempotency: front-matter + managed block produced via byte-identical
 * concatenation; re-runs against unchanged inputs produce identical output.
 */
export async function writeCursorBootstrapManagedBlock(
  targetRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult> {
  const step = "bootstrap-cursor";
  const target = join(targetRoot, CURSOR_BOOTSTRAP_MDC_REL);
  const legacyFlatFile = join(targetRoot, CURSOR_LEGACY_FLAT_FILE_REL);

  // Phase 1: clean-slate delete legacy flat-file `.cursor/rules` IFF it is
  // a regular file (not a directory). The directory case is the intended
  // post-migration state and must be preserved (it hosts the .mdc rules).
  try {
    if (existsSync(legacyFlatFile)) {
      const stat = statSync(legacyFlatFile);
      if (stat.isFile()) {
        await rm(legacyFlatFile, { force: true });
      }
    }
  } catch {
    // best-effort — a failure to delete the legacy file should not abort the
    // new-file write below
  }

  const body = buildManagedBlockBody(targetRoot);
  const managedBlock = wrapInBootstrapMarkers(body);
  const expected = `${CURSOR_RULE_FRONT_MATTER}${managedBlock}\n`;

  let existing = "";
  if (existsSync(target)) {
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
  }

  if (existing === expected) {
    return { step, path: target, status: "skipped", message: "up-to-date" };
  }

  try {
    await mkdir(dirname(target), { recursive: true });
    await atomicWriteText(target, expected);
    return { step, path: target, status: "written" };
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
// internals
// -----------------------------------------------------------------------

async function copyTextIdempotent(
  step: string,
  source: string,
  target: string,
): Promise<InstallStepResult> {
  if (existsSync(target)) {
    try {
      const existing = readFileSync(target, "utf8");
      if (existing === source) {
        return { step, path: target, status: "skipped", message: "up-to-date" };
      }
    } catch {
      // unreadable target — fall through to overwrite
    }
  }
  await mkdir(dirname(target), { recursive: true });
  await atomicWriteText(target, source);
  return { step, path: target, status: "written" };
}

/**
 * v2.0.0-rc.27 TASK-004 (audit §2.6): canonical basenames for the three
 * cross-client hook scripts plus the rc.5-era legacy name. Used by the
 * install-time sweep below and by `fab doctor`'s SettingsHookDuplicates
 * invariant to identify fabric-owned entries inside each client's hook
 * config — regardless of which path form (relative / `${CLAUDE_PROJECT_DIR}`
 * sigil / Codex `$(git rev-parse ...)` substitution) the entry was authored
 * with. A workspace that upgraded across the rc.5 rename
 * (archive-hint → fabric-hint) used to accumulate BOTH names as separate
 * entries because deepMerge's dedupe compared raw command strings; the
 * sweep removes any matching entry pre-merge so the template re-adds the
 * canonical entry as the sole survivor.
 */
export const FABRIC_HOOK_SCRIPT_BASENAMES: ReadonlySet<string> = new Set([
  "fabric-hint.cjs",
  "knowledge-hint-broad.cjs",
  "knowledge-hint-narrow.cjs",
  // rc.5 TASK-010 rename — old hook scripts that pre-upgrade workspaces
  // may still have registered. Sweeping them prevents the double-fire
  // documented in audit §2.6.
  "archive-hint.cjs",
]);

/**
 * Extract the basename of a hook command string. Handles:
 *   - bare relative paths: ".claude/hooks/foo.cjs" → "foo.cjs"
 *   - sigil-prefixed paths: "${CLAUDE_PROJECT_DIR}/.claude/hooks/foo.cjs" → "foo.cjs"
 *   - Codex shell-substitution: "\"$(git rev-parse ...)/codex/hooks/foo.cjs\"" → "foo.cjs"
 *   - Windows backslashes (defensive).
 *
 * Returns null when the command doesn't end in a `.cjs` file (likely a
 * user-authored hook unrelated to fabric).
 */
function commandBasename(command: string): string | null {
  // Trim trailing quotes / whitespace that Codex/Cursor templates wrap.
  const trimmed = command.trim().replace(/^"+|"+$/g, "");
  const match = /([^/\\]+\.cjs)$/u.exec(trimmed);
  return match === null ? null : match[1];
}

/**
 * v2.0.0-rc.27 TASK-004 (audit §2.6): pre-merge sweep that strips any
 * existing array entries whose hook command basename is in
 * FABRIC_HOOK_SCRIPT_BASENAMES. Run before deepMerge so the merge pass
 * cleanly re-adds the canonical template entry. Walks the dotted
 * arrayAppendPaths (e.g. `hooks.Stop`) without disturbing other keys.
 *
 * Entry shape (claude-code form, matched by hook-config templates):
 *   { matcher: "...", hooks: [{ type: "command", command: "..." }] }
 *
 * An entry is fabric-owned when ANY of its `hooks[].command` basenames is
 * in the known set — we drop the entire entry (matcher + sibling hooks)
 * because mixing fabric and non-fabric hooks under a single matcher
 * shouldn't happen with the template-only writers in this file. User
 * configs with such mixed entries pre-existing are degenerate and the
 * sweep gives them a clean slate (pre-user clean-slate policy).
 */
function stripStaleHookEntries(
  existing: Record<string, unknown>,
  arrayAppendPaths: string[],
): { swept: Record<string, unknown>; removed: number } {
  // Shallow clone then walk-and-mutate so callers' input is untouched.
  const swept = JSON.parse(JSON.stringify(existing)) as Record<string, unknown>;
  let removed = 0;

  for (const dottedPath of arrayAppendPaths) {
    const segments = dottedPath.split(".");
    // Descend to the array slot — bail on the first missing segment so
    // missing arrays (e.g. user never wrote a Stop slot) are no-ops.
    let cursor: unknown = swept;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]!;
      if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) {
        cursor = undefined;
        break;
      }
      cursor = (cursor as Record<string, unknown>)[seg];
    }
    if (cursor === null || cursor === undefined || typeof cursor !== "object" || Array.isArray(cursor)) {
      continue;
    }
    const finalSeg = segments[segments.length - 1]!;
    const arr = (cursor as Record<string, unknown>)[finalSeg];
    if (!Array.isArray(arr)) continue;

    const filtered: unknown[] = [];
    for (const item of arr) {
      if (item === null || typeof item !== "object") {
        filtered.push(item);
        continue;
      }
      const entry = item as Record<string, unknown>;
      const hooks = entry.hooks;
      // Claude/Codex shape: hooks[].command. Cursor shape: same key.
      let isFabricOwned = false;
      if (Array.isArray(hooks)) {
        for (const h of hooks) {
          if (h !== null && typeof h === "object") {
            const cmd = (h as Record<string, unknown>).command;
            if (typeof cmd === "string") {
              const base = commandBasename(cmd);
              if (base !== null && FABRIC_HOOK_SCRIPT_BASENAMES.has(base)) {
                isFabricOwned = true;
                break;
              }
            }
          }
        }
      }
      // Also tolerate the cursor flat shape `{ command: "..." }` without a
      // nested hooks[] wrapper — defensive against schema drift.
      if (!isFabricOwned && typeof entry.command === "string") {
        const base = commandBasename(entry.command);
        if (base !== null && FABRIC_HOOK_SCRIPT_BASENAMES.has(base)) {
          isFabricOwned = true;
        }
      }
      if (isFabricOwned) {
        removed += 1;
      } else {
        filtered.push(item);
      }
    }
    (cursor as Record<string, unknown>)[finalSeg] = filtered;
  }

  return { swept, removed };
}

async function mergeJsonIdempotent(
  step: string,
  target: string,
  fragment: Record<string, unknown>,
  arrayAppendPaths: string[],
): Promise<InstallStepResult> {
  const existing = await readJsonObjectOrEmpty(target);
  // v2.0.0-rc.27 TASK-004 (audit §2.6): sweep stale fabric-owned hook
  // entries BEFORE the merge so the upgrade path
  // (rc.5 archive-hint → rc.5+ fabric-hint, or relative-path → sigil-path)
  // doesn't accumulate duplicates. The merge then re-adds the canonical
  // entry from the template fragment as the sole survivor.
  const { swept } = stripStaleHookEntries(existing, arrayAppendPaths);
  const merged = deepMerge(swept, fragment, { arrayAppendPaths });
  if (jsonEqual(existing, merged)) {
    return { step, path: target, status: "skipped", message: "up-to-date" };
  }
  await mkdir(dirname(target), { recursive: true });
  await atomicWriteJson(target, merged, { indent: 2 });
  return { step, path: target, status: "written" };
}

async function readJsonObjectOrEmpty(path: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path, "utf8");
    if (raw.trim().length === 0) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function readTemplate(relativePath: string): Promise<string> {
  const path = findTemplatePath(relativePath);
  return readFile(path, "utf8");
}

async function readJsonTemplate(relativePath: string): Promise<Record<string, unknown>> {
  const raw = await readTemplate(relativePath);
  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Template at ${relativePath} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Resolve a `templates/...` path that ships inside the @fenglimg/fabric-cli
 * package. Walks up from the current module's directory looking for a
 * `templates/<relativePath>` sibling — which works in both:
 *   - dev/test (this file at packages/cli/src/install/skills-and-hooks.ts;
 *     templates at packages/cli/templates/...)
 *   - bundled (this file packed into packages/cli/dist/<chunk>.js;
 *     templates at packages/cli/templates/...)
 */
function findTemplatePath(relativePath: string): string {
  const startDir = dirname(fileURLToPath(import.meta.url));
  let current = resolve(startDir);
  while (true) {
    const candidate = join(current, "templates", relativePath);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current || parse(current).root === current) {
      throw new Error(`Template not found: templates/${relativePath} (searched up from ${startDir})`);
    }
    current = parent;
  }
}
