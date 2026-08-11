/**
 * WHAT `fabric install` distributes, and WHERE — the whole set, as data.
 *
 * Every path fabric writes into a project appears in exactly one table here,
 * and both directions read them: the writers in `install-skills.ts` /
 * `install-hook-scripts.ts` / `hook-config-merge.ts` to place files, and
 * `uninstall-skills-and-hooks.ts` to remove them. A destination that is not in
 * this file is a path fabric does not manage — there is no second list.
 *
 * Deliberately io-free. Reading it tells you the complete payload without
 * tracing any control flow, which is what the install-payload census and the
 * `write-install-manifest.ts` file set both depend on.
 *
 * Templates all resolve under packages/cli/templates/:
 *   - skills/<slug>/SKILL.md + skills/<slug>/ref/*.md  (slugs in SKILL_DESTINATIONS)
 *   - skills/lib/*.md                                  (SKILL_LIB_DESTINATIONS)
 *   - hooks/*.cjs + hooks/lib/*.cjs                    (HOOK_SCRIPT/LIB_DESTINATIONS)
 *   - hooks/configs/{claude-code,codex-hooks}.json     (HOOK_CONFIG_TARGETS)
 *
 * The shipped hook configs are pinned byte-for-byte against `HOOK_REGISTRATIONS`
 * (packages/shared) by a template-parity test, so a hook added to one side
 * cannot go unchecked by doctor on the other.
 */

// W3-C + S2: skill set = 5 (archive/review real + store/sync shim + recall-playbook) with
// 0 router — the router template + its generated Intent-Map machinery are gone.
export const SKILL_TEMPLATE_REL = "skills/fabric-archive/SKILL.md";
export const SKILL_REVIEW_TEMPLATE_REL = "skills/fabric-review/SKILL.md";
// v2.1.0-rc.1 P4 (S46): multi-store git sync assistant skill.
export const SKILL_SYNC_TEMPLATE_REL = "skills/fabric-sync/SKILL.md";
// v2.1 ADJ-NEWN-1/#4: fabric-store knowledge-store ops skill template.
export const SKILL_STORE_TEMPLATE_REL = "skills/fabric-store/SKILL.md";
// S2 (sivtr inspiration): retrieval protocol playbook for agents.
export const SKILL_RECALL_PLAYBOOK_TEMPLATE_REL = "skills/fabric-recall-playbook/SKILL.md";
// config-single-home W9: config checkup + conversational tuning. Thin shim over
// `fabric config` — it translates what a user FEELS ("too noisy") into the key
// and the layer, and reads the localized copy straight off `--list --json` so
// there is no second description of a knob to drift.
export const SKILL_CONFIG_TEMPLATE_REL = "skills/fabric-config/SKILL.md";
export const HOOK_SCRIPT_TEMPLATE_REL = "hooks/fabric-hint.cjs";
// rc.6 TASK-019 (E1): SessionStart broad-injection hook script. Sibling to
// fabric-hint.cjs — shares install/copy plumbing but is registered against a
// different hook event (SessionStart instead of Stop) in each client config.
export const HOOK_BROAD_SCRIPT_TEMPLATE_REL = "hooks/knowledge-hint-broad.cjs";
// rc.6 TASK-020 (E2 + E4): PreToolUse narrow-injection hook script + edit-
// counter sidecar. Sibling to knowledge-hint-broad.cjs — same install/copy
// plumbing but registered against PreToolUse with Edit|Write|MultiEdit
// matchers in each client config.
export const HOOK_NARROW_SCRIPT_TEMPLATE_REL = "hooks/knowledge-hint-narrow.cjs";
// ux-w2-6: single PreToolUse orchestrator (merges narrow + cite into one envelope).
export const HOOK_PRETOOLUSE_SCRIPT_TEMPLATE_REL = "hooks/knowledge-pretooluse.cjs";
// v2.0.0-rc.34 TASK-06: cite-policy long-session evict sidecar.
export const HOOK_CITE_EVICT_SCRIPT_TEMPLATE_REL = "hooks/cite-policy-evict.cjs";
// lifecycle-refactor W2-T2: SessionEnd marker hook (zero-compute session_ended
// append). Sibling to knowledge-hint-*.cjs — same install/copy plumbing,
// registered against the SessionEnd event in each client config.
export const HOOK_SESSION_END_SCRIPT_TEMPLATE_REL = "hooks/session-end-marker.cjs";
// lifecycle-refactor W2-T3: PostToolUse marker hook. Emits `file_mutated` on
// Edit/Write/MultiEdit (per-call key) and, since W3-3/KT-DEC-0030,
// `knowledge_body_read` on a Read of a store knowledge body — so its matcher
// adds `Read` to the Edit|Write|MultiEdit set. Sibling to the narrow hook —
// same install/copy plumbing.
export const HOOK_POST_TOOLUSE_SCRIPT_TEMPLATE_REL = "hooks/post-tooluse-mutation.cjs";
// rc.16 TASK-004 (F2-tests): shared `.cjs` helpers consumed by the three
// hook scripts at runtime via `require("./lib/<name>.cjs")`. Currently
// houses banner-i18n.cjs (rc.16 TASK-001) and session-digest-writer.cjs
// (pre-existing). The install pipeline copies EVERY `.cjs` file in this
// directory into each client's `<client>/hooks/lib/` so future additions
// ship without further wiring (e.g. a new `lib/foo.cjs` is auto-picked).
export const HOOK_LIB_TEMPLATE_DIR_REL = "hooks/lib";
export const CLAUDE_HOOK_CONFIG_TEMPLATE_REL = "hooks/configs/claude-code.json";
export const CODEX_HOOK_CONFIG_TEMPLATE_REL = "hooks/configs/codex-hooks.json";

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
// Terminal skill set = 2 real leaf (archive/review) + 2 thin shim (store/sync)
// + 1 protocol playbook (recall-playbook) + 1 config checkup = 6, and 0 router.
// The W3-C collapse folded the fabric router and three leaves into these:
// import→archive `source` mode, audit→review `retire`, connect→review `relate`.
//
// This list is the WHOLE set install writes. It carries no residue-sweeping for
// the folded skills: the sweep of their installed directories was retired once
// the project confirmed it has no users predating the collapse, so a path that
// is not here is a path fabric simply does not manage.
export const SKILL_DESTINATIONS = {
  fabricArchive: [
    ".claude/skills/fabric-archive/SKILL.md",
    ".codex/skills/fabric-archive/SKILL.md",
  ],
  fabricReview: [
    ".claude/skills/fabric-review/SKILL.md",
    ".codex/skills/fabric-review/SKILL.md",
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
  // S2: agent retrieval protocol (when/how/safety + failure paths).
  fabricRecallPlaybook: [
    ".claude/skills/fabric-recall-playbook/SKILL.md",
    ".codex/skills/fabric-recall-playbook/SKILL.md",
  ],
  // config-single-home W9: config checkup + conversational tuning.
  fabricConfig: [
    ".claude/skills/fabric-config/SKILL.md",
    ".codex/skills/fabric-config/SKILL.md",
  ],
} as const;

export type FabricSkillInstallSpec = {
  slug: string;
  templateRel: string;
  destinations: readonly string[];
  step: string;
};

export const FABRIC_SKILL_INSTALL_SPECS = {
  fabricArchive: {
    slug: "fabric-archive",
    templateRel: SKILL_TEMPLATE_REL,
    destinations: SKILL_DESTINATIONS.fabricArchive,
    step: "skill",
  },
  fabricReview: {
    slug: "fabric-review",
    templateRel: SKILL_REVIEW_TEMPLATE_REL,
    destinations: SKILL_DESTINATIONS.fabricReview,
    step: "skill-review",
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
  fabricRecallPlaybook: {
    slug: "fabric-recall-playbook",
    templateRel: SKILL_RECALL_PLAYBOOK_TEMPLATE_REL,
    destinations: SKILL_DESTINATIONS.fabricRecallPlaybook,
    step: "skill-recall-playbook",
  },
  fabricConfig: {
    slug: "fabric-config",
    templateRel: SKILL_CONFIG_TEMPLATE_REL,
    destinations: SKILL_DESTINATIONS.fabricConfig,
    step: "skill-config",
  },
} as const satisfies Record<keyof typeof SKILL_DESTINATIONS, FabricSkillInstallSpec>;

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
 * Project-root-relative `skills/lib/` directories that {@link installSharedSkillLib}
 * ships the cross-skill shared policy (`templates/skills/lib/*.md`) into. Source
 * of truth shared with `fabric uninstall`'s `removeSharedSkillLib` so the two
 * stay in lock-step (KT-PIT-0004: hand-mirrored client paths silently drift).
 */
export const SKILL_LIB_DESTINATIONS = [
  ".claude/skills/lib",
  ".codex/skills/lib",
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
// This list is a SUPERSET of the events Fabric currently registers
// (`hookConfigArrayPaths` in @fenglimg/fabric-shared derives that set from the
// registration table). The extra slots are legacy-only: "hooks.UserPromptSubmit"
// is where pre-v2.1 installs put cite-policy-evict. It is inert on the install
// side — deepMerge never touches a slot Fabric's own config lacks — but
// load-bearing on the uninstall side, which only walks the paths it is handed,
// so dropping it would strand that entry in an upgraded project's settings.json
// forever. Covered by "prunes a legacy UserPromptSubmit fabric entry" in
// __tests__/integration/uninstall-skills-and-hooks.test.ts.
export const HOOK_CONFIG_ARRAY_PATHS = {
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
 * inside a hook-config array. Consumed by `fabric uninstall`, which prunes
 * entries whose `command` matches one of these literals.
 *
 * Like {@link HOOK_CONFIG_ARRAY_PATHS} this is deliberately a SUPERSET of what
 * the current templates register: `knowledgeHintNarrow` (a lib since the
 * PreToolUse orchestrator merge) and Claude Code's `citePolicyEvict` (moved off
 * UserPromptSubmit in v2.1) are commands only an OLDER install can have left
 * behind. Uninstall must still recognize them, so entries are retired from this
 * map only once no supported upgrade path can still carry them.
 */
export const FABRIC_HOOK_COMMAND_PATHS = {
  claudeCode: {
    fabricHint: "${CLAUDE_PROJECT_DIR}/.claude/hooks/fabric-hint.cjs",
    knowledgeHintBroad: "${CLAUDE_PROJECT_DIR}/.claude/hooks/knowledge-hint-broad.cjs",
    knowledgeHintNarrow: "${CLAUDE_PROJECT_DIR}/.claude/hooks/knowledge-hint-narrow.cjs",
    knowledgePretoolUse: "${CLAUDE_PROJECT_DIR}/.claude/hooks/knowledge-pretooluse.cjs",
    citePolicyEvict: "${CLAUDE_PROJECT_DIR}/.claude/hooks/cite-policy-evict.cjs",
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
