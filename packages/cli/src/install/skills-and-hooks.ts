import { chmodSync, existsSync, readFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { atomicWriteJson, atomicWriteText } from "@fenglimg/fabric-shared/node/atomic-write";

import { deepMerge } from "../config/json.js";

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

export type InstallStepStatus = "written" | "skipped" | "error";

export type InstallStepResult = {
  step: string;
  path: string;
  status: InstallStepStatus;
  message?: string;
};

export type InstallOptions = {
  /**
   * When true, force-overwrite even when destination already matches the
   * template. Reserved for callers that want to revert local edits to the
   * skill / hook script. Currently unused — copy is always idempotent.
   */
  force?: boolean;
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
    fabricHint: ".claude/hooks/fabric-hint.cjs",
    knowledgeHintBroad: ".claude/hooks/knowledge-hint-broad.cjs",
    knowledgeHintNarrow: ".claude/hooks/knowledge-hint-narrow.cjs",
  },
  codex: {
    fabricHint: ".codex/hooks/fabric-hint.cjs",
    knowledgeHintBroad: ".codex/hooks/knowledge-hint-broad.cjs",
    knowledgeHintNarrow: ".codex/hooks/knowledge-hint-narrow.cjs",
  },
  cursor: {
    fabricHint: ".cursor/hooks/fabric-hint.cjs",
    knowledgeHintBroad: ".cursor/hooks/knowledge-hint-broad.cjs",
    knowledgeHintNarrow: ".cursor/hooks/knowledge-hint-narrow.cjs",
  },
} as const;

/**
 * Project-root-relative paths of files that receive the managed Fabric
 * Knowledge Base section written by {@link addFabricKnowledgeBaseSection}.
 * Source of truth shared with `fab uninstall` (which strips the marker-
 * delimited region from each present file).
 *
 * rc.12 broad-gate-fabric-lang TASK-006: renamed from `POINTER_TARGETS` when
 * the three POINTER_LINE constants were collapsed into a single HTML-comment-
 * wrapped managed section.
 */
export const SECTION_TARGETS = ["CLAUDE.md", "AGENTS.md", join(".cursor", "rules")];

/**
 * HTML-comment marker pair that delimits the managed "Fabric Knowledge Base"
 * section. Re-exported for the uninstall helper (which strips the region in
 * the inverse direction) and for tests asserting marker presence. The literal
 * strings here MUST stay byte-identical to the markers embedded in
 * {@link buildFabricKnowledgeBaseSection}'s output — they are matched as plain
 * substrings by both install (idempotent in-place replace) and uninstall
 * (clean removal).
 */
export const FABRIC_SECTION_BEGIN_MARKER = "<!-- fabric:knowledge-base:begin -->";
export const FABRIC_SECTION_END_MARKER = "<!-- fabric:knowledge-base:end -->";

/**
 * Regex that matches the entire managed section, markers inclusive, with an
 * optional preceding blank-line separator (so re-install / uninstall don't
 * leave orphan blank lines). Non-greedy body matches any content between the
 * begin/end markers, including newlines. Source of truth shared with the
 * uninstall helper.
 */
export const FABRIC_SECTION_REGEX =
  /(?:\r?\n){0,2}<!-- fabric:knowledge-base:begin -->[\s\S]*?<!-- fabric:knowledge-base:end -->/;

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
 * Build the managed "Fabric Knowledge Base" section text wrapped in HTML
 * comment markers. The section is owned by `fab install` — user edits between
 * the markers are intentionally NOT preserved on re-run (managed-section
 * convention, mirrors all-contributors-cli's `<!-- ALL-CONTRIBUTORS-LIST -->`
 * idiom).
 *
 * The `fabricLanguage` argument is interpolated into the "Language" bullet so
 * users discover the field they need to flip in `.fabric/fabric-config.json`
 * to change the language preference. Re-running install with a different
 * value updates this line in place (no duplication, no orphan section).
 */
export function buildFabricKnowledgeBaseSection(fabricLanguage: string): string {
  return `${FABRIC_SECTION_BEGIN_MARKER}

## Fabric Knowledge Base

This project uses Fabric for persistent project knowledge under \`.fabric/knowledge/\`.

- **Discovery**: SessionStart lists available entries (broad menu); editing files may surface narrow hints
- **Usage**: call \`fab_get_knowledge_sections\` to fetch full content of any entry by id
- **Write flows**: see fabric-archive (record), fabric-review (validate), fabric-import (backfill) Skills
- **Language**: rendered per \`fabric_language\` in \`.fabric/fabric-config.json\` (current: \`${fabricLanguage}\`)

${FABRIC_SECTION_END_MARKER}`;
}

/**
 * Copy templates/skills/fabric-archive/SKILL.md into both .claude/skills/
 * and .codex/skills/ subtrees under the project root. Idempotent: if the
 * destination already contains an identical copy, no write occurs.
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

/**
 * Write the managed "Fabric Knowledge Base" section into CLAUDE.md /
 * AGENTS.md / .cursor/rules. The section is wrapped in HTML-comment markers
 * (`<!-- fabric:knowledge-base:begin -->` … `<!-- fabric:knowledge-base:end
 * -->`) so it is invisible in rendered Markdown but discoverable via plain-
 * text search.
 *
 * Idempotent + in-place replace:
 *   - When markers are absent: append the section to the file (preceded by a
 *     blank-line separator).
 *   - When markers are present: replace the entire begin→end region in place
 *     (so changing `fabric_language` updates the language line without
 *     duplicating the section, and user edits between markers are
 *     intentionally overwritten — managed-section convention).
 *   - Files that don't already exist are skipped (install never creates the
 *     anchor files; that's executeInitFabricPlan's job for AGENTS.md).
 *
 * rc.12 broad-gate-fabric-lang TASK-006: replaces the rc.4-era
 * `addArchiveSkillPointer` substring-append helper. The three POINTER_LINE
 * constants and their per-line dedupe logic are gone; the section is now the
 * single managed surface that pointers to all three v2 Skills (archive /
 * review / import) plus the `fabric_language` config knob.
 */
export async function addFabricKnowledgeBaseSection(
  projectRoot: string,
  fabricLanguage: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult[]> {
  const sectionBody = buildFabricKnowledgeBaseSection(fabricLanguage);
  const results: InstallStepResult[] = [];
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

    let next: string;
    const match = existing.match(FABRIC_SECTION_REGEX);
    if (match !== null) {
      // Section already present — replace in place. We strip the matched
      // region (markers + optional preceding blank line) entirely, then re-
      // append via the same code path as the absent branch so the leading-
      // separator + trailing-newline shape is byte-identical regardless of
      // which branch fired. This guarantees idempotency across re-runs and
      // language-change re-runs.
      const before = existing.slice(0, match.index ?? 0);
      const after = existing.slice((match.index ?? 0) + match[0].length);
      // Strip a leading newline carry-over from `after` so we don't end up
      // with an orphan blank line where the section used to sit.
      const stripped = `${before}${after.replace(/^\r?\n/, "")}`;
      const trailingNewline = stripped.length === 0 || stripped.endsWith("\n") ? "" : "\n";
      next = `${stripped}${trailingNewline}\n${sectionBody}\n`;
    } else {
      // Section absent — append with a blank-line separator. Normalize the
      // trailing newline so the separator is always exactly one blank line.
      const trailingNewline = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
      next = `${existing}${trailingNewline}\n${sectionBody}\n`;
    }

    if (next === existing) {
      results.push({ step: "section", path: target, status: "skipped", message: "up-to-date" });
      continue;
    }

    try {
      await atomicWriteText(target, next);
      results.push({ step: "section", path: target, status: "written" });
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

async function mergeJsonIdempotent(
  step: string,
  target: string,
  fragment: Record<string, unknown>,
  arrayAppendPaths: string[],
): Promise<InstallStepResult> {
  const existing = await readJsonObjectOrEmpty(target);
  const merged = deepMerge(existing, fragment, { arrayAppendPaths });
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
