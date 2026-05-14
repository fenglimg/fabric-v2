import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { defineCommand } from "citty";

import { t } from "../i18n.js";
import {
  addFabricKnowledgeBaseSection,
  installArchiveHintHook,
  installFabricArchiveSkill,
  installFabricImportSkill,
  installFabricReviewSkill,
  installKnowledgeHintBroadHook,
  installKnowledgeHintNarrowHook,
  mergeClaudeCodeHookConfig,
  mergeCodexHookConfig,
  mergeCursorHookConfig,
  readFabricLanguagePreference,
  type InstallStepResult,
} from "../install/skills-and-hooks.js";

type HooksInstallArgs = {
  target: string;
};

type InstallHooksOptions = {
  force?: boolean;
};

export type InstallHooksResult = {
  installed: string[];
  skipped: string[];
  errors: string[];
};

export const hooksCommand = defineCommand({
  meta: {
    name: "hooks",
    description: t("cli.hooks.description"),
  },
  subCommands: {
    install: defineCommand({
      meta: {
        name: "install",
        description: t("cli.hooks.install.description"),
      },
      args: {
        target: {
          type: "string",
          description: t("cli.hooks.install.args.target.description"),
          default: process.cwd(),
        },
      },
      async run({ args }: { args: HooksInstallArgs }) {
        const result = await installHooks(args.target);
        for (const path of result.installed) {
          console.log(`installed ${path}`);
        }
        for (const path of result.skipped) {
          console.log(`skipped ${path}`);
        }
        for (const message of result.errors) {
          console.error(`error ${message}`);
        }
      },
    }),
  },
});

export default hooksCommand;

/**
 * v2/rc.2+rc.3+rc.4+rc.5 hook installer. Re-installable from `fabric hooks
 * install` and also invoked from `fabric install` via the bootstrap stage
 * helpers. Performs the full archive+review+import-feature install in
 * sequence (each idempotent):
 *   1. Copy templates/skills/fabric-archive/SKILL.md into .claude/skills/ + .codex/skills/
 *   2. Copy templates/skills/fabric-review/SKILL.md into .claude/skills/ + .codex/skills/  (rc.3)
 *   3. Copy templates/skills/fabric-import/SKILL.md into .claude/skills/ + .codex/skills/  (rc.4)
 *   4. Copy templates/hooks/fabric-hint.cjs into .claude/hooks/ + .codex/hooks/ + .cursor/hooks/
 *      (rc.5 TASK-010: renamed from archive-hint.cjs; Cursor added as third client)
 *   5. Deep-merge templates/hooks/configs/claude-code.json into .claude/settings.json
 *      (hooks.Stop[] array-append-with-dedupe — preserves user entries)
 *   6. Deep-merge templates/hooks/configs/codex-hooks.json into .codex/hooks.json
 *      (events.Stop[] array-append-with-dedupe)
 *   7. Deep-merge templates/hooks/configs/cursor-hooks.json into .cursor/hooks.json
 *      (events.Stop[] array-append-with-dedupe — rc.5 TASK-010)
 *   8. Append fabric-archive, fabric-review AND fabric-import Skill
 *      pointers to CLAUDE.md/AGENTS.md/.cursor/rules when those files
 *      already exist (does not create them; each pointer is dedup-checked
 *      independently).
 *   9. Validate that every installed client hook config resolves to the
 *      fabric-hint.cjs script on disk — guards against template / install
 *      drift (e.g. partial copy, manual edit of one config file).
 *
 * Returns the union of paths written, skipped, and any errors. Best-effort:
 * a single client's failure (missing directory, unreadable settings.json)
 * surfaces in `errors` but does not throw — the other client install still
 * runs.
 *
 * Why all 9 steps (not just hooks): rc.2 wires the Skill, hook script, and
 * config-merge as one feature. `fabric hooks install` is the user's
 * re-apply entry point — installing only the hook script would leave the
 * Stop hook firing without a Skill to invoke.
 */
export async function installHooks(
  target: string,
  _options: InstallHooksOptions = {},
): Promise<InstallHooksResult> {
  const normalizedTarget = normalizeTarget(target);
  assertExistingDirectory(normalizedTarget);

  const results: InstallStepResult[] = [];
  results.push(...await runStep(() => installFabricArchiveSkill(normalizedTarget)));
  results.push(...await runStep(() => installFabricReviewSkill(normalizedTarget)));
  results.push(...await runStep(() => installFabricImportSkill(normalizedTarget)));
  results.push(...await runStep(() => installArchiveHintHook(normalizedTarget)));
  // rc.6 TASK-019 (E1): SessionStart broad-injection hook script. Mirrors
  // the fabric-hint.cjs copy step — same three client dest dirs, same
  // chmod 0o755 on POSIX. Order vs config-merge matters: copy first so the
  // validateHookPaths post-step finds the script on disk.
  results.push(...await runStep(() => installKnowledgeHintBroadHook(normalizedTarget)));
  // rc.6 TASK-020 (E2 + E4): PreToolUse narrow-injection hook script +
  // edit-counter sidecar. Same copy plumbing as the broad sibling — three
  // dest dirs, chmod 0o755 on POSIX, copy before merge so validate finds it.
  results.push(...await runStep(() => installKnowledgeHintNarrowHook(normalizedTarget)));
  results.push(await runSingleStep("claude-hook-config", () => mergeClaudeCodeHookConfig(normalizedTarget)));
  results.push(await runSingleStep("codex-hook-config", () => mergeCodexHookConfig(normalizedTarget)));
  results.push(await runSingleStep("cursor-hook-config", () => mergeCursorHookConfig(normalizedTarget)));
  // rc.12 broad-gate-fabric-lang TASK-006: managed-section writer replaces
  // the rc.4-era POINTER_LINE substring appender. Resolve fabric_language
  // from the workspace's .fabric/fabric-config.json so the section's
  // "Language" line interpolates the active preference; falls back to
  // "match-existing" when the config has not yet been scaffolded.
  const fabricLanguage = readFabricLanguagePreference(normalizedTarget);
  results.push(...await runStep(() => addFabricKnowledgeBaseSection(normalizedTarget, fabricLanguage)));
  results.push(...validateHookPaths(normalizedTarget));

  return summarizeResults(results);
}

// rc.5 TASK-010: cross-client hook path validation. After all three client
// configs have been merged and the hook script has been copied into all three
// `<client>/hooks/fabric-hint.cjs` destinations, verify each config's
// registered command path actually resolves on disk. This guards against
// template drift (e.g. a future change to the config template that updates
// the path without updating the destination, or a user manually editing one
// config file to point to an old `archive-hint.cjs`).
//
// Each client contributes a `hook-validate` step keyed by client name. An
// existing-but-resolved entry yields `skipped/ok`; an existing-but-missing
// entry yields `error`; a non-existent config yields `skipped/missing-config`
// (fresh install where deep-merge hadn't run — should never happen in this
// pipeline ordering, but the defensive branch keeps validateHookPaths
// callable from contexts that skip the merge step).
function validateHookPaths(projectRoot: string): InstallStepResult[] {
  // Each client contributes one validate row per registered hook script. rc.5
  // shipped the Stop-hook (fabric-hint.cjs) only; rc.6 TASK-019 adds the
  // SessionStart broad-injection hook (knowledge-hint-broad.cjs); rc.6
  // TASK-020 adds the PreToolUse narrow-injection hook
  // (knowledge-hint-narrow.cjs). All three scripts share the same
  // `<client>/hooks/` destination tree, so the check shape is identical —
  // we just iterate over the script names.
  const scripts: Array<{ stepSuffix: string; hookFile: string }> = [
    { stepSuffix: "", hookFile: "fabric-hint.cjs" },
    { stepSuffix: "-broad", hookFile: "knowledge-hint-broad.cjs" },
    { stepSuffix: "-narrow", hookFile: "knowledge-hint-narrow.cjs" },
  ];
  const clients: Array<{ client: string; configRel: string; hookDir: string }> = [
    {
      client: "claude",
      configRel: join(".claude", "settings.json"),
      hookDir: join(".claude", "hooks"),
    },
    {
      client: "codex",
      configRel: join(".codex", "hooks.json"),
      hookDir: join(".codex", "hooks"),
    },
    {
      client: "cursor",
      configRel: join(".cursor", "hooks.json"),
      hookDir: join(".cursor", "hooks"),
    },
  ];

  const results: InstallStepResult[] = [];
  for (const { client, configRel, hookDir } of clients) {
    const configPath = resolve(projectRoot, configRel);
    if (!existsSync(configPath)) {
      // Single missing-config row per client — same as rc.5 behaviour.
      results.push({
        step: `hook-validate-${client}`,
        path: configPath,
        status: "skipped",
        message: "missing-config",
      });
      continue;
    }
    for (const { stepSuffix, hookFile } of scripts) {
      const expectedHookPath = resolve(projectRoot, hookDir, hookFile);
      const expectedHookRel = join(hookDir, hookFile);
      const step = `hook-validate-${client}${stepSuffix}`;
      if (!existsSync(expectedHookPath)) {
        results.push({
          step,
          path: expectedHookPath,
          status: "error",
          message: `hook script missing: ${expectedHookRel}`,
        });
        continue;
      }
      results.push({ step, path: expectedHookPath, status: "skipped", message: "ok" });
    }
  }
  return results;
}

async function runStep(
  fn: () => Promise<InstallStepResult[]>,
): Promise<InstallStepResult[]> {
  try {
    return await fn();
  } catch (error: unknown) {
    return [
      {
        step: "hook-install",
        path: "",
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      },
    ];
  }
}

async function runSingleStep(
  step: string,
  fn: () => Promise<InstallStepResult>,
): Promise<InstallStepResult> {
  try {
    return await fn();
  } catch (error: unknown) {
    return {
      step,
      path: "",
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function summarizeResults(results: InstallStepResult[]): InstallHooksResult {
  const installed: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  for (const r of results) {
    switch (r.status) {
      case "written":
        installed.push(r.path);
        break;
      case "skipped":
        skipped.push(r.path);
        break;
      case "error":
        errors.push(`${r.step} ${r.path}: ${r.message ?? "unknown error"}`);
        break;
    }
  }
  return { installed, skipped, errors };
}

function normalizeTarget(targetInput: string): string {
  return isAbsolute(targetInput) ? targetInput : resolve(process.cwd(), targetInput);
}

function assertExistingDirectory(target: string): void {
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(t("cli.shared.target-invalid", { target }));
  }
}
