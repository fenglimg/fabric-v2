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
const HOOK_SCRIPT_TEMPLATE_REL = "hooks/archive-hint.cjs";
const CLAUDE_HOOK_CONFIG_TEMPLATE_REL = "hooks/configs/claude-code.json";
const CODEX_HOOK_CONFIG_TEMPLATE_REL = "hooks/configs/codex-hooks.json";

const SKILL_DEST_REL = join("skills", "fabric-archive", "SKILL.md");
const HOOK_SCRIPT_DEST_REL = join("hooks", "archive-hint.cjs");

const POINTER_LINE =
  "> Use the fabric-archive Skill when archiving knowledge entries (see .claude/skills/fabric-archive/SKILL.md).";

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
 * Append a one-line pointer to CLAUDE.md / AGENTS.md / .cursor/rules
 * referencing the fabric-archive Skill. Idempotent: skips files that are
 * absent (does not create) and skips files where the pointer line is
 * already present (substring match on the static literal).
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
    if (existing.includes(POINTER_LINE)) {
      results.push({ step: "pointer", path: target, status: "skipped", message: "already-present" });
      continue;
    }
    const trailingNewline = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
    const next = `${existing}${trailingNewline}\n${POINTER_LINE}\n`;
    await atomicWriteText(target, next);
    results.push({ step: "pointer", path: target, status: "written" });
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
