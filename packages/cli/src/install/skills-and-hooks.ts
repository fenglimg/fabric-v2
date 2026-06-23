import { chmodSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveGlobalLocale } from "@fenglimg/fabric-shared";
import { atomicWriteJson, atomicWriteText } from "@fenglimg/fabric-shared/node/atomic-write";
import {
  BOOTSTRAP_MARKER_BEGIN,
  BOOTSTRAP_MARKER_END,
  BOOTSTRAP_REGEX,
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

// B2 skill-router: the fabric/ router skill — the single human-facing entry
// point that dispatches to the 7 leaf skills. Its Intent Map + S_CLASSIFY enum
// are regenerated from the leaf descriptions at install time (see
// installFabricRouterSkill), so the template is NOT a plain byte-copy.
const SKILL_ROUTER_TEMPLATE_REL = "skills/fabric/SKILL.md";
// B2 skill-router (A2/A3): marker pair wrapping the generated Intent Map +
// S_CLASSIFY task_type enum inside fabric/SKILL.md. install regenerates the
// content between these markers from the 7 leaf descriptions; everything
// outside the markers (Routing Contract / S_CHAIN / Guardrails / Report) is
// hand-authored prose preserved verbatim. Comment-style markers mirror the
// BOOTSTRAP_MARKER pair so a reader sees the block is install-managed.
const ROUTER_INTENT_MARKER_BEGIN = "<!-- fabric:router-intent:begin -->";
const ROUTER_INTENT_MARKER_END = "<!-- fabric:router-intent:end -->";
const ROUTER_INTENT_GENERATED_NOTE =
  "<!-- 本块由 `fabric install` 从 7 个 leaf skill 的 description Triggers 子句生成。严禁手编;改 leaf description 后重跑 `fabric install`。 -->";
const ROUTER_INTENT_REGEX =
  /<!-- fabric:router-intent:begin -->[\s\S]*?<!-- fabric:router-intent:end -->/u;
const SKILL_TEMPLATE_REL = "skills/fabric-archive/SKILL.md";
const SKILL_REVIEW_TEMPLATE_REL = "skills/fabric-review/SKILL.md";
const SKILL_IMPORT_TEMPLATE_REL = "skills/fabric-import/SKILL.md";
// v2.1.0-rc.1 P4 (S46): multi-store git sync assistant skill.
const SKILL_SYNC_TEMPLATE_REL = "skills/fabric-sync/SKILL.md";
// v2.1 ADJ-NEWN-1/#4: fabric-store knowledge-store ops skill template.
const SKILL_STORE_TEMPLATE_REL = "skills/fabric-store/SKILL.md";
// v2.2 SK1-audit (W2-T5): semantic-deprecation audit skill template.
const SKILL_AUDIT_TEMPLATE_REL = "skills/fabric-audit/SKILL.md";
// v2.2 SK2-connect (W3-T2): knowledge-graph relation skill template.
const SKILL_CONNECT_TEMPLATE_REL = "skills/fabric-connect/SKILL.md";
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
// ux-w2-6: single PreToolUse orchestrator (merges narrow + cite into one envelope).
const HOOK_PRETOOLUSE_SCRIPT_TEMPLATE_REL = "hooks/knowledge-pretooluse.cjs";
// v2.0.0-rc.34 TASK-06: cite-policy long-session evict sidecar.
const HOOK_CITE_EVICT_SCRIPT_TEMPLATE_REL = "hooks/cite-policy-evict.cjs";
// lifecycle-refactor W2-T2: SessionEnd marker hook (zero-compute session_ended
// append). Sibling to knowledge-hint-*.cjs — same install/copy plumbing,
// registered against the SessionEnd event in each client config.
const HOOK_SESSION_END_SCRIPT_TEMPLATE_REL = "hooks/session-end-marker.cjs";
// lifecycle-refactor W2-T3: PostToolUse marker hook. Emits `file_mutated` on
// Edit/Write/MultiEdit (per-call key) and, since W3-3/KT-DEC-0030,
// `knowledge_body_read` on a Read of a store knowledge body — so its matcher
// adds `Read` to the Edit|Write|MultiEdit set. Sibling to the narrow hook —
// same install/copy plumbing.
const HOOK_POST_TOOLUSE_SCRIPT_TEMPLATE_REL = "hooks/post-tooluse-mutation.cjs";
// rc.16 TASK-004 (F2-tests): shared `.cjs` helpers consumed by the three
// hook scripts at runtime via `require("./lib/<name>.cjs")`. Currently
// houses banner-i18n.cjs (rc.16 TASK-001) and session-digest-writer.cjs
// (pre-existing). The install pipeline copies EVERY `.cjs` file in this
// directory into each client's `<client>/hooks/lib/` so future additions
// ship without further wiring (e.g. a new `lib/foo.cjs` is auto-picked).
const HOOK_LIB_TEMPLATE_DIR_REL = "hooks/lib";
const CLAUDE_HOOK_CONFIG_TEMPLATE_REL = "hooks/configs/claude-code.json";
const CODEX_HOOK_CONFIG_TEMPLATE_REL = "hooks/configs/codex-hooks.json";

/**
 * Project-root-relative destination paths for the three v2 Skill markdown
 * files, one entry per supported client. Source of truth shared by `fabric install`
 * (install) and `fabric uninstall` (removal). Paths are stored with forward
 * slashes; callers must run them through `join(projectRoot, ...)` to obtain
 * absolute, OS-normalized targets.
 *
 * Client coverage: Skills are only meaningful for Claude Code and Codex CLI
 * (the two clients that surface a Skills directory).
 */
export const SKILL_DESTINATIONS = {
  // B2 skill-router: the fabric/ router skill — single-file (no ref/), installed
  // alongside the 7 leaf skills as the human-facing dispatch entry point.
  fabricRouter: [
    ".claude/skills/fabric/SKILL.md",
    ".codex/skills/fabric/SKILL.md",
  ],
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
  // v2.1.0-rc.1 P4 (S46): fabric-sync mirrors the sibling skills' 2-client
  // coverage (Claude Code + Codex CLI surface a Skills directory).
  fabricSync: [
    ".claude/skills/fabric-sync/SKILL.md",
    ".codex/skills/fabric-sync/SKILL.md",
  ],
  // v2.1 ADJ-NEWN-1/#4: fabric-store knowledge-store ops skill, same 2-client
  // coverage as the sibling skills.
  fabricStore: [
    ".claude/skills/fabric-store/SKILL.md",
    ".codex/skills/fabric-store/SKILL.md",
  ],
  // v2.2 SK1-audit (W2-T5): fabric-audit semantic-deprecation skill, same
  // 2-client coverage as the sibling skills.
  fabricAudit: [
    ".claude/skills/fabric-audit/SKILL.md",
    ".codex/skills/fabric-audit/SKILL.md",
  ],
  // v2.2 SK2-connect (W3-T2): fabric-connect knowledge-graph relation skill.
  fabricConnect: [
    ".claude/skills/fabric-connect/SKILL.md",
    ".codex/skills/fabric-connect/SKILL.md",
  ],
} as const;

type FabricSkillInstallSpec = {
  slug: string;
  templateRel: string;
  destinations: readonly string[];
  step: string;
  includeRefFiles?: boolean;
};

const FABRIC_SKILL_INSTALL_SPECS = {
  fabricRouter: {
    slug: "fabric",
    templateRel: SKILL_ROUTER_TEMPLATE_REL,
    destinations: SKILL_DESTINATIONS.fabricRouter,
    step: "skill-router",
  },
  fabricArchive: {
    slug: "fabric-archive",
    templateRel: SKILL_TEMPLATE_REL,
    destinations: SKILL_DESTINATIONS.fabricArchive,
    step: "skill",
    includeRefFiles: true,
  },
  fabricReview: {
    slug: "fabric-review",
    templateRel: SKILL_REVIEW_TEMPLATE_REL,
    destinations: SKILL_DESTINATIONS.fabricReview,
    step: "skill-review",
    includeRefFiles: true,
  },
  fabricImport: {
    slug: "fabric-import",
    templateRel: SKILL_IMPORT_TEMPLATE_REL,
    destinations: SKILL_DESTINATIONS.fabricImport,
    step: "skill-import",
    includeRefFiles: true,
  },
  fabricSync: {
    slug: "fabric-sync",
    templateRel: SKILL_SYNC_TEMPLATE_REL,
    destinations: SKILL_DESTINATIONS.fabricSync,
    step: "skill-sync",
  },
  fabricStore: {
    slug: "fabric-store",
    templateRel: SKILL_STORE_TEMPLATE_REL,
    destinations: SKILL_DESTINATIONS.fabricStore,
    step: "skill-store",
  },
  fabricAudit: {
    slug: "fabric-audit",
    templateRel: SKILL_AUDIT_TEMPLATE_REL,
    destinations: SKILL_DESTINATIONS.fabricAudit,
    step: "skill-audit",
  },
  fabricConnect: {
    slug: "fabric-connect",
    templateRel: SKILL_CONNECT_TEMPLATE_REL,
    destinations: SKILL_DESTINATIONS.fabricConnect,
    step: "skill-connect",
  },
} as const satisfies Record<keyof typeof SKILL_DESTINATIONS, FabricSkillInstallSpec>;

// rc.35 TASK-03 (P2-6): legacy Skill directories that `fabric install` must
// remove. The template directory was already deleted, but rc.30-and-earlier
// installs still carry the residual copy in `.codex/skills/` and
// `.claude/skills/`. Listed as full directories (not just SKILL.md) because
// the skill ships supporting files; rm -rf the whole subtree is the only
// safe cleanup. Removal is best-effort and runs before the modern skills
// are installed so users see the deprecation as a single install side-effect.
export const DEPRECATED_SKILL_DIRS = [
  ".claude/skills/fabric-init",
  ".codex/skills/fabric-init",
] as const;


/**
 * Project-root-relative destination paths for the two cross-client hook
 * scripts (Stop / SessionStart / PreToolUse). Source of truth shared by
 * `fabric install` (install) and `fabric uninstall` (removal). Both clients —
 * Claude Code and Codex CLI — receive every script.
 */
export const HOOK_SCRIPT_DESTINATIONS = {
  fabricHint: [
    ".claude/hooks/fabric-hint.cjs",
    ".codex/hooks/fabric-hint.cjs",
  ],
  knowledgeHintBroad: [
    ".claude/hooks/knowledge-hint-broad.cjs",
    ".codex/hooks/knowledge-hint-broad.cjs",
  ],
  knowledgeHintNarrow: [
    ".claude/hooks/knowledge-hint-narrow.cjs",
    ".codex/hooks/knowledge-hint-narrow.cjs",
  ],
  // ux-w2-6: the single PreToolUse orchestrator. Requires knowledge-hint-narrow
  // + cite-policy-evict as libs (both still copied) and merges their output into
  // one envelope, so the Edit|Write|MultiEdit matcher carries ONE command (was
  // two = 双弹).
  knowledgePretoolUse: [
    ".claude/hooks/knowledge-pretooluse.cjs",
    ".codex/hooks/knowledge-pretooluse.cjs",
  ],
  // v2.0.0-rc.34 TASK-06: Claude Code — UserPromptSubmit cite-policy long-
  // session evict sidecar.
  // v2.0.0-rc.37 NEW-21: extended to Codex SessionStart slot.
  // Codex doesn't have an equivalent per-prompt event, so cite-policy-
  // evict.cjs runs in "SessionStart mode" (one-shot stderr emit per session
  // boot, no turn-counter). Cadence is lower than Claude Code's per-prompt
  // window but strictly better than 0 (rc.32 baseline measured Codex
  // at 3.1% cite coverage when no cite-reminder surface existed).
  citePolicyEvict: [
    ".claude/hooks/cite-policy-evict.cjs",
    ".codex/hooks/cite-policy-evict.cjs",
  ],
  // lifecycle-refactor W2-T2: SessionEnd marker hook — both clients.
  sessionEndMarker: [
    ".claude/hooks/session-end-marker.cjs",
    ".codex/hooks/session-end-marker.cjs",
  ],
  // lifecycle-refactor W2-T3: PostToolUse mutation marker hook — both.
  postTooluseMutation: [
    ".claude/hooks/post-tooluse-mutation.cjs",
    ".codex/hooks/post-tooluse-mutation.cjs",
  ],
} as const;

/**
 * Project-root-relative destination DIRECTORIES (one per client) for the
 * shared hook-lib `.cjs` helpers. The lib directory is co-located next to
 * each client's hook scripts so the scripts can `require("./lib/<name>.cjs")`
 * with a relative path that works identically in dev (templates/) and in
 * the user's installed workspace.
 *
 * Source of truth shared by `fabric install` (copy) and `fabric uninstall` (prune).
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
] as const;

/**
 * Project-root-relative paths of each client's hook-config JSON file that
 * `fabric install` merges fabric entries into. Source of truth shared with
 * `fabric uninstall` (which must locate and prune those entries).
 */
export const HOOK_CONFIG_TARGETS = {
  claudeCode: ".claude/settings.json",
  codex: ".codex/hooks.json",
} as const;

/**
 * Dotted JSON-path locations of the array slots each client's hook-config
 * uses for the three fabric events. Mirrors the `arrayAppendPaths` argument
 * passed to {@link mergeJsonIdempotent}. Source of truth shared with
 * `fabric uninstall` (which must prune fabric entries from those same arrays).
 *
 * Note the client-specific shape: Claude Code groups under `hooks.*`
 * (PascalCase event names) and Codex under `events.*` (PascalCase).
 * Preserve the upstream schemas exactly — these dotted paths MUST byte-match
 * each template's top-level keys, otherwise `arrayAppendWithDedupe` in
 * `deepMerge` silently falls back to array-REPLACE on re-install.
 */
export const HOOK_CONFIG_ARRAY_PATHS = {
  // F2: "hooks.UserPromptSubmit" MUST be listed — the Claude Code template
  // ships a UserPromptSubmit cite-policy hook, so without this path deepMerge
  // array-REPLACEs (instead of append-with-dedupe) on re-install, silently
  // clobbering any user-defined UserPromptSubmit hook.
  // lifecycle-refactor W2-T2/T3: PostToolUse + SessionEnd arrays added so
  // deepMerge append-with-dedupes them on re-install (omitting them would
  // array-REPLACE, clobbering any user-defined entries in those slots).
  claudeCode: [
    "hooks.Stop",
    "hooks.SessionStart",
    "hooks.PreToolUse",
    "hooks.UserPromptSubmit",
    "hooks.PostToolUse",
    "hooks.SessionEnd",
  ],
  codex: ["events.Stop", "events.SessionStart", "events.PreToolUse", "events.PostToolUse", "events.SessionEnd"],
} as const;

/**
 * Per-client `command` field values that identify a fabric-owned hook entry
 * inside a hook-config array. Source of truth shared with `fabric uninstall`
 * (which prunes entries whose `command` matches one of these literals).
 * Values match the strings shipped in templates/hooks/configs/*.json.
 */
export const FABRIC_HOOK_COMMAND_PATHS = {
  claudeCode: {
    fabricHint: "${CLAUDE_PROJECT_DIR}/.claude/hooks/fabric-hint.cjs",
    knowledgeHintBroad: "${CLAUDE_PROJECT_DIR}/.claude/hooks/knowledge-hint-broad.cjs",
    knowledgeHintNarrow: "${CLAUDE_PROJECT_DIR}/.claude/hooks/knowledge-hint-narrow.cjs",
    // ux-w2-6: the single PreToolUse orchestrator command (wired in claude-code.json).
    knowledgePretoolUse: "${CLAUDE_PROJECT_DIR}/.claude/hooks/knowledge-pretooluse.cjs",
    // F3: the UserPromptSubmit cite-policy-evict hook must be a known fabric
    // command so uninstall prunes it (matches the literal in claude-code.json).
    citePolicyEvict: "${CLAUDE_PROJECT_DIR}/.claude/hooks/cite-policy-evict.cjs",
    // lifecycle-refactor W2-T2/T3: SessionEnd + PostToolUse marker hooks.
    sessionEndMarker: "${CLAUDE_PROJECT_DIR}/.claude/hooks/session-end-marker.cjs",
    postTooluseMutation: "${CLAUDE_PROJECT_DIR}/.claude/hooks/post-tooluse-mutation.cjs",
  },
  codex: {
    fabricHint: "\"$(git rev-parse --show-toplevel)/.codex/hooks/fabric-hint.cjs\"",
    knowledgeHintBroad: "\"$(git rev-parse --show-toplevel)/.codex/hooks/knowledge-hint-broad.cjs\"",
    knowledgeHintNarrow: "\"$(git rev-parse --show-toplevel)/.codex/hooks/knowledge-hint-narrow.cjs\"",
    knowledgePretoolUse: "\"$(git rev-parse --show-toplevel)/.codex/hooks/knowledge-pretooluse.cjs\"",
    citePolicyEvict: "\"$(git rev-parse --show-toplevel)/.codex/hooks/cite-policy-evict.cjs\"",
    sessionEndMarker: "\"$(git rev-parse --show-toplevel)/.codex/hooks/session-end-marker.cjs\"",
    postTooluseMutation: "\"$(git rev-parse --show-toplevel)/.codex/hooks/post-tooluse-mutation.cjs\"",
  },
} as const;

/**
 * rc.19 TASK-003 — bootstrap marker constants are now owned by
 * `@fenglimg/fabric-shared/templates/bootstrap-canonical` so the CLI install
 * pipeline (writer) and the server doctor (drift comparator) consume the same
 * source of truth. Re-exported here for backwards-compatible imports
 * (uninstall helper + integration tests still reach for them via this module).
 *
 * The pre-rc.19 `fabric:knowledge-base` marker pair is fully retired: install
 * neither writes nor migrates it (clean-slate, no migration shim — 0 users,
 * feedback_clean_slate.md memory). `fabric:bootstrap` is the only managed
 * marker.
 */
export {
  BOOTSTRAP_MARKER_BEGIN,
  BOOTSTRAP_MARKER_END,
  BOOTSTRAP_REGEX,
};

/**
 * Resolve the language base tone used by the bootstrap section writer.
 *
 * grill-6fixes (D1): language is a single machine-wide value in
 * `~/.fabric/fabric-global.json` → `language`, governing both display and
 * knowledge. The old per-project `fabric_language` read (and the
 * `match-existing` / `zh-CN-hybrid` placeholders) were removed; this now
 * delegates to {@link resolveGlobalLocale} (global language → env fallback).
 * `projectRoot` is retained for call-site compatibility but unused.
 */
export function readFabricLanguagePreference(_projectRoot: string): string {
  return resolveGlobalLocale();
}

// rc.34 TASK-02: SKILL.md size pre-check + stale-install detection.
//
// Backstory: rc.33 W3-6 introduced a doctor skill_token_budget lint that
// estimates SKILL.md size as chars/3. It flagged canonical templates AND
// installed copies — but install-time silence meant users could end up with
// 19K-char stale installs from older RCs (rc.21 era) sitting on disk
// indefinitely. This pre-check + stale signal closes that loop:
//
//   - Pre-check: if the canonical template itself estimates > ERROR_TOKENS,
//     install throws (drift→abort, per cli-design philosophy). Fabric must
//     ship clean; oversized templates are a release bug, not a recoverable
//     runtime state.
//   - Stale detection: if an existing target estimates > STALE_INSTALL_RATIO
//     × canonical, we surface a `stale-replaced` message in the
//     InstallStepResult. copyTextIdempotent already overwrites diff content;
//     the message tells operators *why* they saw a write.
//
// Thresholds mirror server/src/services/doctor.ts inspectSkillTokenBudget
// (chars/3 token estimate, 10K ERROR). Kept duplicated rather than imported
// because shared has no canonical home for these and importing from server
// into cli would invert the dependency direction.
const SKILL_TOKEN_ERROR_TOKENS = 10_000;
const STALE_INSTALL_RATIO = 1.5;

export function estimateSkillTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

export function validateSkillCanonicalSize(source: string, slug: string): void {
  const tokens = estimateSkillTokens(source);
  if (tokens > SKILL_TOKEN_ERROR_TOKENS) {
    throw new Error(
      `Skill '${slug}' canonical SKILL.md estimates ${tokens} tok ` +
        `(>${SKILL_TOKEN_ERROR_TOKENS} ERROR threshold). Install aborted — ` +
        `this is a Fabric release bug, not a user-recoverable state. ` +
        `Re-split SKILL.md via progressive disclosure (see fabric-archive/phases/* ` +
        `as canonical example) and rebuild.`,
    );
  }
}

export function inspectStaleInstall(target: string, source: string): string | null {
  if (!existsSync(target)) return null;
  let existing: string;
  try {
    existing = readFileSync(target, "utf8");
  } catch {
    return null;
  }
  const existingTok = estimateSkillTokens(existing);
  const sourceTok = estimateSkillTokens(source);
  if (existingTok > sourceTok * STALE_INSTALL_RATIO) {
    return `stale-replaced (${existingTok} tok → ${sourceTok} tok canonical)`;
  }
  return null;
}

async function installFabricSkill(
  projectRoot: string,
  spec: FabricSkillInstallSpec,
): Promise<InstallStepResult[]> {
  const source = await readTemplate(spec.templateRel);
  validateSkillCanonicalSize(source, spec.slug);
  const targets = spec.destinations.map((rel) => join(projectRoot, rel));
  const results: InstallStepResult[] = [];
  for (const target of targets) {
    const staleMsg = inspectStaleInstall(target, source);
    const result = await copyTextIdempotent(spec.step, source, target);
    if (staleMsg && result.status === "written") {
      result.message = result.message ? `${staleMsg}; ${result.message}` : staleMsg;
    }
    results.push(result);
  }
  if (spec.includeRefFiles) {
    results.push(...(await installSkillRefFiles(projectRoot, spec.slug)));
  }
  return results;
}

/**
 * Copy templates/skills/fabric-archive/SKILL.md into both .claude/skills/
 * and .codex/skills/ subtrees under the project root. Idempotent: if the
 * destination already contains an identical copy, no write occurs.
 *
 * v2.0.0-rc.28 TASK-01 (audit §3.1): also walks the skill's `ref/` directory
 * and ships every `*.md` companion to the same client subtrees so
 * load-on-demand references resolve at runtime.
 *
 * v2.0.0-rc.34 TASK-02: validates canonical SKILL.md size before copy
 * (throws if > 10K tok ERROR threshold); annotates results with
 * `stale-replaced` when existing target is > 1.5× canonical.
 */
export async function installFabricArchiveSkill(
  projectRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult[]> {
  return installFabricSkill(projectRoot, FABRIC_SKILL_INSTALL_SPECS.fabricArchive);
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
  return installFabricSkill(projectRoot, FABRIC_SKILL_INSTALL_SPECS.fabricReview);
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
  return installFabricSkill(projectRoot, FABRIC_SKILL_INSTALL_SPECS.fabricImport);
}

/**
 * v2.1.0-rc.1 P4 (S46): install the fabric-sync Skill — the AI-assisted layer
 * over `fabric sync` (multi-store git traversal + rebase-conflict resolution).
 * Sibling installer to archive/review/import; same 2-client coverage. No `ref/`
 * dir (single-file skill), so installSkillRefFiles records a `no-ref-dir` skip.
 */
export async function installFabricSyncSkill(
  projectRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult[]> {
  return installFabricSkill(projectRoot, FABRIC_SKILL_INSTALL_SPECS.fabricSync);
}

/**
 * v2.1 ADJ-NEWN-1/#4: install the fabric-store Skill — the conversational
 * façade over `fabric store …` (create/add/bind/list/switch-write). Sibling
 * installer to archive/review/import/sync; same 2-client coverage. Single-file
 * skill (no `ref/` dir).
 */
export async function installFabricStoreSkill(
  projectRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult[]> {
  return installFabricSkill(projectRoot, FABRIC_SKILL_INSTALL_SPECS.fabricStore);
}

/**
 * v2.2 SK1-audit (W2-T5): install the fabric-audit Skill — the conversational
 * façade over `fabric doctor`-driven KB lifecycle audit, enforcing the
 * deprecate-over-delete + rescue-before-delete red lines (D3 lifecycle
 * governance). Sibling installer to archive/review/import/sync/store; same
 * 2-client coverage. Single-file skill (no `ref/` dir).
 */
export async function installFabricAuditSkill(
  projectRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult[]> {
  return installFabricSkill(projectRoot, FABRIC_SKILL_INSTALL_SPECS.fabricAudit);
}

/**
 * v2.2 SK2-connect (W3-T2): install the fabric-connect Skill — the conversational
 * façade over knowledge-graph relation discovery (writes H2 `related` edges via
 * the fabric-review write path). Sibling installer to audit/store/etc; same
 * 2-client coverage. Single-file skill (no `ref/` dir).
 */
export async function installFabricConnectSkill(
  projectRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult[]> {
  return installFabricSkill(projectRoot, FABRIC_SKILL_INSTALL_SPECS.fabricConnect);
}

/**
 * B2 skill-router (A3): extract the `description:` frontmatter value from a leaf
 * SKILL.md source. Returns "" when frontmatter or the field is absent.
 */
function extractSkillMdDescription(skillMd: string): string {
  const fm = skillMd.match(/^---\n([\s\S]*?)\n---/u);
  if (!fm) return "";
  const desc = fm[1]!.match(/^description:\s*(.+?)\s*$/mu);
  if (!desc) return "";
  return desc[1]!.replace(/^["'](.+)["']$/u, "$1").trim();
}

/**
 * B2 skill-router (A3): isolate the `Triggers …` clause of a leaf description —
 * the routing signal that becomes the Intent Map cell. Takes everything after
 * the `Triggers` keyword to end-of-string, drops a trailing period (`.`/`。`),
 * and escapes any `|` so it cannot break the markdown table. Returns "" when no
 * `Triggers` clause is present (defensive — every leaf description carries one).
 */
function extractTriggersClause(description: string): string {
  const m = description.match(/Triggers?\s+([\s\S]+)$/u);
  if (!m) return "";
  return m[1]!.trim().replace(/[.。]\s*$/u, "").replace(/\|/gu, "\\|");
}

/**
 * B2 skill-router (A3): render the generated ROUTER_INTENT block — the Intent
 * Map table (one row per leaf, cell = its Triggers clause) plus the canonical
 * `task_type` enum (leaf slugs minus the `fabric-` prefix). Output byte-format
 * is fixed so re-running install against unchanged leaf descriptions produces
 * an identical block (idempotent copy).
 */
function renderRouterIntentBlock(leaves: ReadonlyArray<{ slug: string; triggers: string }>): string {
  const rows = leaves.map((l) => `| ${l.triggers} | \`${l.slug}\` |`).join("\n");
  const enumVals = leaves.map((l) => l.slug.replace(/^fabric-/u, "")).join(" | ");
  return [
    ROUTER_INTENT_MARKER_BEGIN,
    ROUTER_INTENT_GENERATED_NOTE,
    "",
    "| 用户意图(leaf description Triggers) | 下游 skill |",
    "| --- | --- |",
    rows,
    "",
    `\`S_CLASSIFY\` 的 \`task_type\` 枚举:\`${enumVals}\``,
    ROUTER_INTENT_MARKER_END,
  ].join("\n");
}

/**
 * B2 skill-router (A3): build the router SKILL.md content that install writes —
 * the canonical template with its ROUTER_INTENT marker block replaced by a
 * block freshly generated from the 7 leaf descriptions (read from their
 * canonical templates). The source of truth is therefore the leaf
 * descriptions' `Triggers` clauses; adding a leaf to FABRIC_SKILL_INSTALL_SPECS
 * makes its row appear here on the next install with no hand-edit.
 *
 * Throws if the template lost its marker pair (a release bug — the template was
 * hand-edited away from the A2 contract), so the failure is loud rather than
 * silently shipping a stale Intent Map.
 */
async function buildRouterSkillSource(): Promise<string> {
  const template = await readTemplate(SKILL_ROUTER_TEMPLATE_REL);
  if (!ROUTER_INTENT_REGEX.test(template)) {
    throw new Error(
      `fabric/SKILL.md is missing the ${ROUTER_INTENT_MARKER_BEGIN} … ${ROUTER_INTENT_MARKER_END} ` +
        `marker pair — cannot regenerate the Intent Map. This is a Fabric release bug ` +
        `(router template was hand-edited away from the managed-block contract).`,
    );
  }
  // Iterate every spec except the router itself, in declaration order — that
  // order is the Intent Map row order and the enum order.
  const leafSpecs = Object.values(FABRIC_SKILL_INSTALL_SPECS).filter(
    (spec) => spec.slug !== "fabric",
  );
  const leaves: Array<{ slug: string; triggers: string }> = [];
  for (const spec of leafSpecs) {
    const leafMd = await readTemplate(spec.templateRel);
    leaves.push({ slug: spec.slug, triggers: extractTriggersClause(extractSkillMdDescription(leafMd)) });
  }
  return template.replace(ROUTER_INTENT_REGEX, renderRouterIntentBlock(leaves));
}

/**
 * B2 skill-router: install the fabric/ router Skill — the single human-facing
 * dispatch entry point over the 7 leaf skills. Sibling installer to
 * archive/review/import/etc; same 2-client coverage. Single-file skill (no
 * `ref/` dir).
 *
 * Unlike the leaf installers this is NOT a plain byte-copy: it regenerates the
 * ROUTER_INTENT marker block (Intent Map + S_CLASSIFY enum) from the leaf
 * descriptions via {@link buildRouterSkillSource} before the idempotent copy,
 * so both client copies are byte-identical and re-running install is a no-op.
 */
export async function installFabricRouterSkill(
  projectRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult[]> {
  const source = await buildRouterSkillSource();
  validateSkillCanonicalSize(source, "fabric");
  const spec = FABRIC_SKILL_INSTALL_SPECS.fabricRouter;
  const targets = spec.destinations.map((rel) => join(projectRoot, rel));
  const results: InstallStepResult[] = [];
  for (const target of targets) {
    const staleMsg = inspectStaleInstall(target, source);
    const result = await copyTextIdempotent(spec.step, source, target);
    if (staleMsg && result.status === "written") {
      result.message = result.message ? `${staleMsg}; ${result.message}` : staleMsg;
    }
    results.push(result);
  }
  return results;
}

/**
 * v2.0.0-rc.35 TASK-03 (P2-6): remove deprecated skill directories left over
 * from rc.30-and-earlier installs. Idempotent: absent paths become `skipped /
 * absent` rows; present paths are removed via `rm -rf` and recorded as
 * `written / removed-deprecated`. Failures are surfaced as `error` rows but
 * never abort `fabric install` (caller wraps in runBestEffort).
 *
 * Must run BEFORE the modern installFabric*Skill calls so a user upgrading
 * from rc.30 sees the deprecated removal and the modern install as a single
 * coherent diff in stdout.
 */
export async function cleanupDeprecatedSkills(
  projectRoot: string,
): Promise<InstallStepResult[]> {
  const results: InstallStepResult[] = [];
  for (const rel of DEPRECATED_SKILL_DIRS) {
    const target = join(projectRoot, rel);
    if (!existsSync(target)) {
      results.push({ step: "skill-deprecated-cleanup", path: target, status: "skipped", message: "absent" });
      continue;
    }
    try {
      await rm(target, { recursive: true, force: true });
      results.push({
        step: "skill-deprecated-cleanup",
        path: target,
        status: "written",
        message: "removed-deprecated",
      });
    } catch (error: unknown) {
      results.push({
        step: "skill-deprecated-cleanup",
        path: target,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

/**
 * v2.0.0-rc.28 TASK-01 (audit §3.1): copy every `*.md` file under the
 * skill's `templates/skills/<slug>/ref/` directory to BOTH `.claude/skills/
 * <slug>/ref/` and `.codex/skills/<slug>/ref/`. Idempotent — unchanged files
 * skip the write. Missing template `ref/` directory degrades silently with a
 * single `skipped` row noting `no-ref-files` so retro-fitting older skills
 * doesn't require schema migration. Only Claude Code and Codex CLI surface a
 * Skills directory, matching SKILL_DESTINATIONS coverage.
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
 * v2.0.0-rc.37 NEW-13: copy the cross-skill shared policy lib
 * (templates/skills/lib/*.md) into each client's `skills/lib/` ONCE. The three
 * skills' ref files reference `../../lib/shared-policy.md` for the common core
 * (protected tokens / AskUserQuestion routing keys / layer heuristic / events
 * emit) instead of each re-prosing it. Sibling to the per-skill ref walk; uses
 * the same two client prefixes (.claude + .codex). `skills/lib/` carries no
 * SKILL.md so the client skill loader ignores it, and skill_ref_mirror only
 * scans the three named skill ref/ dirs — so the lib dir never trips parity.
 */
export async function installSharedSkillLib(
  projectRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult[]> {
  let libTemplateDir: string;
  try {
    libTemplateDir = findTemplatePath("skills/lib");
  } catch {
    return [{ step: "skill-lib", path: "skills/lib", status: "skipped", message: "no-lib-dir" }];
  }
  let libFiles: string[];
  try {
    libFiles = readdirSync(libTemplateDir).filter((name) => name.endsWith(".md"));
  } catch {
    return [{ step: "skill-lib", path: libTemplateDir, status: "skipped", message: "no-lib-files" }];
  }
  const clientPrefixes = [".claude", ".codex"] as const;
  const results: InstallStepResult[] = [];
  for (const libFile of libFiles) {
    let source: string;
    try {
      source = readFileSync(join(libTemplateDir, libFile), "utf8");
    } catch (error: unknown) {
      results.push({
        step: "skill-lib",
        path: join(libTemplateDir, libFile),
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    for (const prefix of clientPrefixes) {
      const target = join(projectRoot, prefix, "skills", "lib", libFile);
      results.push(await copyTextIdempotent("skill-lib", source, target));
    }
  }
  return results;
}

/**
 * Copy templates/hooks/fabric-hint.cjs into both supported clients'
 * hooks directories: .claude/hooks/ and .codex/hooks/.
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
 * Copy templates/hooks/knowledge-hint-broad.cjs into both supported
 * clients' hooks directories: .claude/hooks/ and .codex/hooks/.
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
 * Copy templates/hooks/knowledge-hint-narrow.cjs into both supported
 * clients' hooks directories: .claude/hooks/ and .codex/hooks/.
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
 * ux-w2-6: copy templates/hooks/knowledge-pretooluse.cjs (the single PreToolUse
 * orchestrator) into both clients' hooks directories. Sibling copy plumbing to
 * {@link installKnowledgeHintNarrowHook}; the orchestrator requires narrow +
 * cite-policy-evict at runtime, so those two are still copied as well.
 */
export async function installKnowledgePretoolUseHook(
  projectRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult[]> {
  const source = await readTemplate(HOOK_PRETOOLUSE_SCRIPT_TEMPLATE_REL);
  const targets = HOOK_SCRIPT_DESTINATIONS.knowledgePretoolUse.map((rel) => join(projectRoot, rel));
  const results: InstallStepResult[] = [];
  for (const target of targets) {
    const result = await copyTextIdempotent("hook-pretooluse-script", source, target);
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
 * v2.0.0-rc.34 TASK-06: copy templates/hooks/cite-policy-evict.cjs into the
 * Claude Code hooks directory ONLY. The sidecar relies on Claude Code's
 * UserPromptSubmit event + hookSpecificOutput stdout JSON envelope, neither
 * of which Codex CLI exposes. Defaults to OFF
 * (`cite_evict_interval = 0`); opt-in via fabric-config.json.
 */
export async function installCitePolicyEvictHook(
  projectRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult[]> {
  const source = await readTemplate(HOOK_CITE_EVICT_SCRIPT_TEMPLATE_REL);
  const targets = HOOK_SCRIPT_DESTINATIONS.citePolicyEvict.map((rel) => join(projectRoot, rel));
  const results: InstallStepResult[] = [];
  for (const target of targets) {
    const result = await copyTextIdempotent("hook-cite-evict-script", source, target);
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
 * lifecycle-refactor W2-T2: copy templates/hooks/session-end-marker.cjs into
 * both clients' hooks directories (.claude/.codex). chmod 0o755 on
 * POSIX. Sibling installer to {@link installKnowledgeHintNarrowHook}; same copy
 * plumbing, differs only in which hook event the per-client config wires it to
 * (SessionEnd). The script is a pure marker — appends one `session_ended` event
 * per session teardown (zero compute, advisory-locked append).
 */
export async function installSessionEndMarkerHook(
  projectRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult[]> {
  const source = await readTemplate(HOOK_SESSION_END_SCRIPT_TEMPLATE_REL);
  const targets = HOOK_SCRIPT_DESTINATIONS.sessionEndMarker.map((rel) => join(projectRoot, rel));
  const results: InstallStepResult[] = [];
  for (const target of targets) {
    const result = await copyTextIdempotent("hook-session-end-script", source, target);
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
 * lifecycle-refactor W2-T3: copy templates/hooks/post-tooluse-mutation.cjs into
 * both clients' hooks directories (.claude/.codex). chmod 0o755 on
 * POSIX. Sibling installer to {@link installKnowledgeHintNarrowHook}; same copy
 * plumbing, registered against PostToolUse with Edit|Write|MultiEdit matchers.
 * The script appends one `file_mutated` event per edited path (per-call key
 * pairs with the PreToolUse narrow hint; advisory-locked append).
 */
export async function installPostTooluseMutationHook(
  projectRoot: string,
  _options: InstallOptions = {},
): Promise<InstallStepResult[]> {
  const source = await readTemplate(HOOK_POST_TOOLUSE_SCRIPT_TEMPLATE_REL);
  const targets = HOOK_SCRIPT_DESTINATIONS.postTooluseMutation.map((rel) => join(projectRoot, rel));
  const results: InstallStepResult[] = [];
  for (const target of targets) {
    const result = await copyTextIdempotent("hook-post-tooluse-script", source, target);
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
 * `<client>/hooks/lib/` directory (.claude/hooks/lib/, .codex/hooks/lib/).
 * Idempotent per file via {@link copyTextIdempotent}.
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
 * across 2 clients = 2N rows. Empty lib directory is allowed (returns
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

// ===========================================================================
// rc.19 TASK-003 — three-end bootstrap propagation
// ===========================================================================
//
// The legacy single-writer `addFabricKnowledgeBaseSection` has been split into
// per-client thin-shell writers, each tailored to how that client
// actually consumes the bootstrap:
//
//   - Claude Code: real `@`-import directives in CLAUDE.md (no managed block).
//   - Codex CLI:   byte-copy managed block in root AGENTS.md.
//
// Both writers consume the L1 bootstrap snapshot at `.fabric/AGENTS.md`
// (written by `writeFabricAgentsSnapshot` from write-bootstrap-snapshot.ts in
// TASK-002) plus the optional `.fabric/project-rules.md` (user-authored, only-
// if-exists). The shared helper {@link buildManagedBlockBody} concatenates
// these two sources so the Codex managed block contains the expected content.
//
// Clean-slate (no migration shim): `fabric:bootstrap` is the only managed
// marker across CLAUDE.md / AGENTS.md (no legacy `fabric:knowledge-base`
// migration — 0 users).
//
// Idempotency contract: each writer must produce a byte-identical destination
// state on second invocation against an unchanged input (snapshot + optional
// project-rules). The integration test matrix in TASK-008 asserts this across
// both targets.

/**
 * Build the byte content embedded inside the Codex managed block.
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
 * writer to ensure consistent marker formatting around the managed block.
 */
function wrapInBootstrapMarkers(body: string): string {
  return `${BOOTSTRAP_MARKER_BEGIN}\n${body}\n${BOOTSTRAP_MARKER_END}`;
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

  // Phase 1: drop stale project-rules @-import when the companion file is
  // absent on disk. Keeps the import set consistent with reality.
  let next = existing;
  if (!projectRulesPresent) {
    next = removeImportLine(next, CLAUDE_PROJECT_RULES_IMPORT_LINE);
  }

  // Phase 2: seed header if file did not pre-exist (or was wiped to empty
  // by the import-strip above).
  if (!preExisted && next.length === 0) {
    next = `${CLAUDE_BOOTSTRAP_HEADER}\n`;
  }

  // Phase 3: append `@`-import lines as needed (line-level idempotent).
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

  // In-place replace of the fabric:bootstrap section, else append.
  let next: string;
  const match = existing.match(BOOTSTRAP_REGEX);
  if (match !== null) {
    const before = existing.slice(0, match.index ?? 0);
    const after = existing.slice((match.index ?? 0) + match[0].length);
    const cleaned = `${before}${after.replace(/^\r?\n/, "")}`;
    const trailingNewline = cleaned.length === 0 || cleaned.endsWith("\n") ? "" : "\n";
    next = `${cleaned}${trailingNewline}${cleaned.length === 0 ? "" : "\n"}${managedBlock}\n`;
  } else {
    if (existing.length === 0) {
      next = `${managedBlock}\n`;
    } else {
      const trailingNewline = existing.endsWith("\n") ? "" : "\n";
      next = `${existing}${trailingNewline}\n${managedBlock}\n`;
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
 * install-time sweep below and by `fabric doctor`'s SettingsHookDuplicates
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
  // ux-w2-6: the single PreToolUse orchestrator — must be in the strip set so a
  // template matcher edit re-syncs on re-install (same reason as the others below).
  "knowledge-pretooluse.cjs",
  // dual-sink W5-1: the strip set must enumerate the COMPLETE fabric-owned hook
  // surface — same set as FABRIC_HOOK_COMMAND_PATHS. Otherwise a matcher change
  // in the template (e.g. adding `apply_patch` to the Codex PreToolUse/PostToolUse
  // matchers) silently fails to propagate on upgrade: stripStaleHookEntries
  // leaves the un-listed entry in place, and the subsequent append-with-dedupe
  // matches it by `command` and SKIPS the new-matcher fragment, preserving the
  // stale matcher. Listing these three makes the canonical template entry the
  // sole survivor on every re-install, so matcher edits actually sync.
  "cite-policy-evict.cjs",
  "post-tooluse-mutation.cjs",
  "session-end-marker.cjs",
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
  // Trim trailing quotes / whitespace that Codex templates wrap.
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
      // Claude/Codex shape: hooks[].command.
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
      // Also tolerate the flat shape `{ command: "..." }` without a
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
