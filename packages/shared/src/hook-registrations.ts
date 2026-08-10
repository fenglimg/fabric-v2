// ---------------------------------------------------------------------------
// The set of hooks Fabric registers in each client's hook config — ONE table,
// consumed by both ends of the contract:
//
//   * `fabric install` ships `templates/hooks/configs/{claude-code,codex-hooks}.json`,
//     which a test asserts is byte-equivalent to this table (see
//     packages/cli/__tests__/hook-registrations-template-parity.test.ts);
//   * `fabric doctor` derives "which hooks must be wired" from this table, so a
//     hook added to the templates cannot be silently unchecked.
//
// The hand-maintained twin this replaces had drifted: doctor asserted 3 of the
// 5 Claude Code registrations and none of Codex's, so a settings.json that had
// lost PostToolUse / SessionEnd reported OK. A silently-dead hook produces no
// error anywhere else — doctor is the only surface that can notice.
//
// The command string is client-specific because the two clients expand the
// project root differently: Claude Code substitutes `${CLAUDE_PROJECT_DIR}`,
// Codex runs the command through a shell, so the path is a quoted
// `git rev-parse` subshell.
// ---------------------------------------------------------------------------

export const HOOK_CLIENTS = ["claudeCode", "codex"] as const;
export type HookClient = (typeof HOOK_CLIENTS)[number];

export type HookRegistration = {
  /** Client hook event the entry is registered under. */
  event: string;
  /** Basename of the `.cjs` script under `<client-dir>/hooks/`. */
  hookFile: string;
  /**
   * Tool-name matcher, or `"*"` for every invocation. Claude Code always
   * carries the field; Codex omits it when it would be `"*"`.
   */
  matcher: string;
};

export type HookClientLayout = {
  /** Client config directory, project-root-relative. */
  clientDir: string;
  /** Key under which the client nests its event → entries map. */
  configRoot: "hooks" | "events";
  registrations: readonly HookRegistration[];
};

export const HOOK_REGISTRATIONS: Record<HookClient, HookClientLayout> = {
  claudeCode: {
    clientDir: ".claude",
    configRoot: "hooks",
    registrations: [
      { event: "Stop", hookFile: "fabric-hint.cjs", matcher: "*" },
      { event: "SessionStart", hookFile: "knowledge-hint-broad.cjs", matcher: "*" },
      { event: "PreToolUse", hookFile: "knowledge-pretooluse.cjs", matcher: "Edit|Write|MultiEdit" },
      {
        event: "PostToolUse",
        hookFile: "post-tooluse-mutation.cjs",
        matcher: "Edit|Write|MultiEdit|Read",
      },
      { event: "SessionEnd", hookFile: "session-end-marker.cjs", matcher: "*" },
    ],
  },
  codex: {
    clientDir: ".codex",
    configRoot: "events",
    registrations: [
      { event: "Stop", hookFile: "fabric-hint.cjs", matcher: "*" },
      { event: "SessionStart", hookFile: "knowledge-hint-broad.cjs", matcher: "*" },
      // Codex has no per-prompt event, so the cite-policy evictor runs in
      // SessionStart mode (one-shot per session boot) instead.
      { event: "SessionStart", hookFile: "cite-policy-evict.cjs", matcher: "*" },
      {
        event: "PreToolUse",
        hookFile: "knowledge-pretooluse.cjs",
        matcher: "Edit|Write|MultiEdit|apply_patch",
      },
      {
        event: "PostToolUse",
        hookFile: "post-tooluse-mutation.cjs",
        matcher: "Edit|Write|MultiEdit|apply_patch|Read",
      },
      { event: "SessionEnd", hookFile: "session-end-marker.cjs", matcher: "*" },
    ],
  },
};

/**
 * The exact `command` string a client's hook config carries for `hookFile`.
 * Doctor matches installed entries against this, and the template-parity test
 * asserts the shipped JSON uses it verbatim.
 */
export function hookCommandFor(client: HookClient, hookFile: string): string {
  return client === "claudeCode"
    ? `\${CLAUDE_PROJECT_DIR}/.claude/hooks/${hookFile}`
    : `"$(git rev-parse --show-toplevel)/.codex/hooks/${hookFile}"`;
}

/**
 * Dotted paths whose arrays must be array-APPEND-WITH-DEDUPE rather than
 * replaced when merging Fabric's config into a user's existing one — omitting
 * an event here silently clobbers the user's own hooks in that slot
 * (KT-GLD-0003). Derived from the table so a new event cannot be forgotten.
 */
export function hookConfigArrayPaths(client: HookClient): string[] {
  const { configRoot, registrations } = HOOK_REGISTRATIONS[client];
  const events = [...new Set(registrations.map((r) => r.event))];
  return events.map((event) => `${configRoot}.${event}`);
}
