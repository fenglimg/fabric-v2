import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { t } from "../i18n.js";
import {
  installArchiveHintHook,
  installFabricArchiveSkill,
  installFabricReviewSkill,
  installFabricStoreSkill,
  installFabricRecallPlaybookSkill,
  installFabricSyncSkill,
  installSharedSkillLib,
  installHookLibs,
  installKnowledgeHintBroadHook,
  installKnowledgeHintNarrowHook,
  installKnowledgePretoolUseHook,
  installCitePolicyEvictHook,
  installSessionEndMarkerHook,
  installPostTooluseMutationHook,
  mergeClaudeCodeHookConfig,
  mergeCodexHookConfig,
  writeClaudeBootstrapThinShell,
  writeCodexBootstrapManagedBlock,
  type InstallStepResult,
} from "./skills-and-hooks.js";
import { writeFabricAgentsSnapshot } from "./write-bootstrap-snapshot.js";

// ---------------------------------------------------------------------------
// rc.15 relocation rationale:
//
// Pure orchestrator for hook + skill installation. Previously lived in
// `packages/cli/src/commands/hooks.ts`; relocated in rc.15 because
// `commands/` is reserved for citty command wrappers and the `fabric hooks`
// top-level command was deleted in TASK-004 (C5) while these helpers
// survive as install-stage infrastructure. Callers:
//   - `fabric install` (packages/cli/src/commands/install.ts) — primary entry
//   - `installHooks` integration + unit tests
//
// The neighbour file `skills-and-hooks.ts` provides the lower-level
// per-client copy/merge primitives that this orchestrator composes.
// ---------------------------------------------------------------------------

type InstallHooksOptions = {
  force?: boolean;
};

export type InstallHooksResult = {
  installed: string[];
  skipped: string[];
  errors: string[];
};

/**
 * v2/rc.2+rc.3+rc.4+rc.5 hook installer. Re-installable from `fabric install`
 * (and was historically also `fabric hooks install` until rc.15 deleted the
 * top-level command). Performs the full archive+review+import-feature install
 * in sequence (each idempotent):
 *   1. Copy templates/skills/fabric-archive/SKILL.md into .claude/skills/ + .codex/skills/
 *   2. Copy templates/skills/fabric-review/SKILL.md into .claude/skills/ + .codex/skills/  (rc.3)
 *   3. Copy templates/skills/fabric-import/SKILL.md into .claude/skills/ + .codex/skills/  (rc.4)
 *   4. Copy templates/hooks/fabric-hint.cjs into .claude/hooks/ + .codex/hooks/
 *      (rc.5 TASK-010: renamed from archive-hint.cjs)
 *   5. Deep-merge templates/hooks/configs/claude-code.json into .claude/settings.json
 *      (hooks.Stop[] array-append-with-dedupe — preserves user entries)
 *   6. Deep-merge templates/hooks/configs/codex-hooks.json into .codex/hooks.json
 *      (events.Stop[] array-append-with-dedupe)
 *   7. Append fabric-archive, fabric-review AND fabric-import Skill
 *      pointers to CLAUDE.md/AGENTS.md when those files
 *      already exist (does not create them; each pointer is dedup-checked
 *      independently).
 *   8. Validate that every installed client hook config resolves to the
 *      fabric-hint.cjs script on disk — guards against template / install
 *      drift (e.g. partial copy, manual edit of one config file).
 *
 * Returns the union of paths written, skipped, and any errors. Best-effort:
 * a single client's failure (missing directory, unreadable settings.json)
 * surfaces in `errors` but does not throw — the other client install still
 * runs.
 *
 * Why all 8 steps (not just hooks): rc.2 wires the Skill, hook script, and
 * config-merge as one feature. Installing only the hook script would leave
 * the Stop hook firing without a Skill to invoke.
 */
export async function installHooks(
  target: string,
  _options: InstallHooksOptions = {},
): Promise<InstallHooksResult> {
  const normalizedTarget = normalizeTarget(target);
  assertExistingDirectory(normalizedTarget);

  const results: InstallStepResult[] = [];
  // W3-C + S2: 5-skill terminal set (0 router) — archive/review/sync/store/recall-playbook.
  results.push(...await runStep(() => installFabricArchiveSkill(normalizedTarget)));
  results.push(...await runStep(() => installFabricReviewSkill(normalizedTarget)));
  results.push(...await runStep(() => installFabricSyncSkill(normalizedTarget)));
  results.push(...await runStep(() => installFabricStoreSkill(normalizedTarget)));
  results.push(...await runStep(() => installFabricRecallPlaybookSkill(normalizedTarget)));
  // rc.37 NEW-13: cross-skill shared policy lib (single source the 3 skills'
  // ref files reference for protected tokens / routing keys / layer heuristic).
  results.push(...await runStep(() => installSharedSkillLib(normalizedTarget)));
  results.push(...await runStep(() => installArchiveHintHook(normalizedTarget)));
  // rc.6 TASK-019 (E1): SessionStart broad-injection hook script. Mirrors
  // the fabric-hint.cjs copy step — same two client dest dirs, same
  // chmod 0o755 on POSIX. Order vs config-merge matters: copy first so the
  // validateHookPaths post-step finds the script on disk.
  results.push(...await runStep(() => installKnowledgeHintBroadHook(normalizedTarget)));
  // rc.6 TASK-020 (E2 + E4): PreToolUse narrow-injection hook script +
  // edit-counter sidecar. Same copy plumbing as the broad sibling — three
  // dest dirs, chmod 0o755 on POSIX, copy before merge so validate finds it.
  results.push(...await runStep(() => installKnowledgeHintNarrowHook(normalizedTarget)));
  // v2.0.0-rc.34 TASK-06: Claude Code-only UserPromptSubmit cite-policy
  // long-session evict sidecar. Single destination (.claude/hooks/) — Codex
  // lacks the event registration. Default OFF; user opt-in via
  // fabric-config.json#cite_evict_interval.
  results.push(...await runStep(() => installCitePolicyEvictHook(normalizedTarget)));
  // ux-w2-6: single PreToolUse orchestrator (requires narrow + cite above).
  results.push(...await runStep(() => installKnowledgePretoolUseHook(normalizedTarget)));
  // lifecycle-refactor W2-T2: SessionEnd marker hook (session_ended append).
  // lifecycle-refactor W2-T3: PostToolUse mutation marker hook (file_mutated
  // append). Both copy across both clients (chmod 0o755 on POSIX) BEFORE
  // the config merge so validateHookPaths finds the scripts on disk.
  results.push(...await runStep(() => installSessionEndMarkerHook(normalizedTarget)));
  results.push(...await runStep(() => installPostTooluseMutationHook(normalizedTarget)));
  // rc.16 TASK-004 (F2-tests): copy shared lib/*.cjs helpers (banner-i18n,
  // session-digest-writer) into each client's <client>/hooks/lib/ dir. The
  // hook scripts above hard-require these via `./lib/<name>.cjs` and crash
  // at runtime if absent — the install step closes that packaging gap.
  results.push(...await runStep(() => installHookLibs(normalizedTarget)));
  results.push(await runSingleStep("claude-hook-config", () => mergeClaudeCodeHookConfig(normalizedTarget)));
  results.push(await runSingleStep("codex-hook-config", () => mergeCodexHookConfig(normalizedTarget)));
  // rc.19 TASK-002: L1 bootstrap snapshot — mirror of install.ts bootstrap
  // stage. Writes `.fabric/AGENTS.md` from BOOTSTRAP_CANONICAL first so the
  // two propagation writers below see a populated snapshot when they
  // build their managed-block bodies.
  results.push(await runSingleStep("bootstrap-snapshot", () => writeFabricAgentsSnapshot(normalizedTarget)));
  // rc.19 TASK-003: two-end propagation. Mirrors install.ts ordering —
  // Claude thin-shell → Codex managed block.
  results.push(await runSingleStep("bootstrap-claude", () => writeClaudeBootstrapThinShell(normalizedTarget)));
  results.push(await runSingleStep("bootstrap-codex", () => writeCodexBootstrapManagedBlock(normalizedTarget)));
  results.push(...validateHookPaths(normalizedTarget));

  return summarizeResults(results);
}

// rc.5 TASK-010: cross-client hook path validation. After both client
// configs have been merged and the hook script has been copied into both
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
export function validateHookPaths(projectRoot: string): InstallStepResult[] {
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
    // ux-w2-6: single PreToolUse orchestrator (merges narrow + cite).
    { stepSuffix: "-pretooluse", hookFile: "knowledge-pretooluse.cjs" },
    // lifecycle-refactor W2-T2/T3: SessionEnd + PostToolUse marker hooks.
    { stepSuffix: "-session-end", hookFile: "session-end-marker.cjs" },
    { stepSuffix: "-post-tooluse", hookFile: "post-tooluse-mutation.cjs" },
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
