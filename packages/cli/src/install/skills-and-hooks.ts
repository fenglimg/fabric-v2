import { chmodSync, existsSync, readFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { atomicWriteJson, atomicWriteText } from "@fenglimg/fabric-shared/node/atomic-write";

import { deepMerge } from "../config/json.js";

/**
 * Install helpers for the v2/rc.2 fabric-archive Skill + archive-hint Stop
 * hook. Each helper is idempotent — re-running `fabric init` (or `fabric
 * hooks install`) after the first successful run produces no diff.
 *
 * Wiring sites:
 *   - packages/cli/src/commands/init.ts  bootstrap stage (skill + hook + pointer)
 *   - packages/cli/src/commands/hooks.ts hooks command (re-install only)
 *
 * Templates resolved:
 *   - packages/cli/templates/skills/fabric-archive/SKILL.md         (TASK-002)
 *   - packages/cli/templates/hooks/archive-hint.cjs                  (TASK-003)
 *   - packages/cli/templates/hooks/configs/claude-code.json          (TASK-004)
 *   - packages/cli/templates/hooks/configs/codex-hooks.json          (TASK-004)
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
const HOOK_SCRIPT_TEMPLATE_REL = "hooks/archive-hint.cjs";
const CLAUDE_HOOK_CONFIG_TEMPLATE_REL = "hooks/configs/claude-code.json";
const CODEX_HOOK_CONFIG_TEMPLATE_REL = "hooks/configs/codex-hooks.json";

const SKILL_DEST_REL = join("skills", "fabric-archive", "SKILL.md");
const SKILL_REVIEW_DEST_REL = join("skills", "fabric-review", "SKILL.md");
const SKILL_IMPORT_DEST_REL = join("skills", "fabric-import", "SKILL.md");
const HOOK_SCRIPT_DEST_REL = join("hooks", "archive-hint.cjs");

const POINTER_LINE =
  "> Use the fabric-archive Skill when archiving knowledge entries (see .claude/skills/fabric-archive/SKILL.md).";
const REVIEW_POINTER_LINE =
  "> Use the fabric-review Skill to review pending knowledge entries (see .claude/skills/fabric-review/SKILL.md).";
const IMPORT_POINTER_LINE =
  "> Use the fabric-import Skill for cold-start enrichment from git history and docs (see .claude/skills/fabric-import/SKILL.md).";

const POINTER_TARGETS = ["CLAUDE.md", "AGENTS.md", join(".cursor", "rules")];

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
  const targets = [
    join(projectRoot, ".claude", SKILL_DEST_REL),
    join(projectRoot, ".codex", SKILL_DEST_REL),
  ];
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
  const targets = [
    join(projectRoot, ".claude", SKILL_REVIEW_DEST_REL),
    join(projectRoot, ".codex", SKILL_REVIEW_DEST_REL),
  ];
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
  const targets = [
    join(projectRoot, ".claude", SKILL_IMPORT_DEST_REL),
    join(projectRoot, ".codex", SKILL_IMPORT_DEST_REL),
  ];
  const results: InstallStepResult[] = [];
  for (const target of targets) {
    results.push(await copyTextIdempotent("skill-import", source, target));
  }
  return results;
}

/**
 * Copy templates/hooks/archive-hint.cjs into both .claude/hooks/ and
 * .codex/hooks/. Marked executable on POSIX (chmod 0o755). Skipped on
 * Windows where the platform ignores the bit.
 */
export async function installArchiveHintHook(
  projectRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult[]> {
  const source = await readTemplate(HOOK_SCRIPT_TEMPLATE_REL);
  const targets = [
    join(projectRoot, ".claude", HOOK_SCRIPT_DEST_REL),
    join(projectRoot, ".codex", HOOK_SCRIPT_DEST_REL),
  ];
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
 * Deep-merge templates/hooks/configs/claude-code.json into the user's
 * `.claude/settings.json`. The `hooks.Stop` array is array-append-with-
 * dedupe (preserves user-authored Stop entries; never duplicates the
 * fabric-archive entry on re-run).
 */
export async function mergeClaudeCodeHookConfig(
  projectRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult> {
  const fragment = await readJsonTemplate(CLAUDE_HOOK_CONFIG_TEMPLATE_REL);
  const targetPath = join(projectRoot, ".claude", "settings.json");
  return mergeJsonIdempotent("claude-hook-config", targetPath, fragment, ["hooks.Stop"]);
}

/**
 * Deep-merge templates/hooks/configs/codex-hooks.json into the user's
 * `.codex/hooks.json`. The `events.Stop` array is array-append-with-
 * dedupe.
 */
export async function mergeCodexHookConfig(
  projectRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult> {
  const fragment = await readJsonTemplate(CODEX_HOOK_CONFIG_TEMPLATE_REL);
  const targetPath = join(projectRoot, ".codex", "hooks.json");
  return mergeJsonIdempotent("codex-hook-config", targetPath, fragment, ["events.Stop"]);
}

/**
 * Append one-line pointers to CLAUDE.md / AGENTS.md / .cursor/rules
 * referencing the fabric-archive, fabric-review AND fabric-import Skills.
 * Idempotent: skips files that are absent (does not create) and skips
 * appending a given pointer when its exact literal is already present
 * (substring match). Each pointer is dedup-checked independently so a
 * user who deletes one manually still gets the other re-added on
 * `fab init`.
 *
 * v2/rc.3 (TASK-006): extended from rc.2's archive-only pointer to cover
 * both fabric-archive and fabric-review.
 * v2/rc.4 (TASK-005): further extended to include fabric-import. The
 * function name is preserved for call-site compatibility; callers do not
 * need to invoke separate review/import-pointer helpers.
 */
export async function addArchiveSkillPointer(
  projectRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult[]> {
  const results: InstallStepResult[] = [];
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

    let next = existing;
    let wrote = false;

    // Append fabric-archive pointer if not present
    if (next.includes(POINTER_LINE)) {
      results.push({ step: "pointer", path: target, status: "skipped", message: "already-present" });
    } else {
      const trailingNewline = next.length === 0 || next.endsWith("\n") ? "" : "\n";
      next = `${next}${trailingNewline}\n${POINTER_LINE}\n`;
      wrote = true;
      results.push({ step: "pointer", path: target, status: "written" });
    }

    // Append fabric-review pointer if not present (independent dedup)
    if (next.includes(REVIEW_POINTER_LINE)) {
      results.push({ step: "pointer-review", path: target, status: "skipped", message: "already-present" });
    } else {
      const trailingNewline = next.length === 0 || next.endsWith("\n") ? "" : "\n";
      next = `${next}${trailingNewline}\n${REVIEW_POINTER_LINE}\n`;
      wrote = true;
      results.push({ step: "pointer-review", path: target, status: "written" });
    }

    // Append fabric-import pointer if not present (independent dedup)
    if (next.includes(IMPORT_POINTER_LINE)) {
      results.push({ step: "pointer-import", path: target, status: "skipped", message: "already-present" });
    } else {
      const trailingNewline = next.length === 0 || next.endsWith("\n") ? "" : "\n";
      next = `${next}${trailingNewline}\n${IMPORT_POINTER_LINE}\n`;
      wrote = true;
      results.push({ step: "pointer-import", path: target, status: "written" });
    }

    if (wrote) {
      await atomicWriteText(target, next);
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
