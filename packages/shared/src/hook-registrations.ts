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
  /** Hook config file, project-root-relative. */
  configFile: string;
  /** Key under which the client nests its event → entries map. */
  configRoot: "hooks" | "events";
  registrations: readonly HookRegistration[];
};

export const HOOK_REGISTRATIONS: Record<HookClient, HookClientLayout> = {
  claudeCode: {
    clientDir: ".claude",
    configFile: ".claude/settings.json",
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
      // W5 #6: a sub-agent starts with a blank conversation — it inherits
      // neither the dispatcher's SessionStart injection nor anything the
      // dispatcher recalled, yet the edit-capable sub-agents are the ones that
      // modify the repo. SubagentStart is the only event whose additionalContext
      // reaches the sub-agent itself (PreToolUse's lands in the dispatcher's
      // context). Matcher "*" — every agent type, since any of them may edit.
      { event: "SubagentStart", hookFile: "knowledge-hint-subagent.cjs", matcher: "*" },
    ],
  },
  codex: {
    clientDir: ".codex",
    configFile: ".codex/hooks.json",
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
      // W5 #6, Codex side. Same rationale as the Claude Code entry above.
      { event: "SubagentStart", hookFile: "knowledge-hint-subagent.cjs", matcher: "*" },
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

// Claude Code wraps each entry in a matcher block carrying `hooks: [{ command }]`
// and always spells the matcher out; Codex puts `command` on the entry itself
// and omits a "*" matcher. Both shapes are the client's, not ours.
function hookConfigEntry(client: HookClient, reg: HookRegistration): Record<string, unknown> {
  const command = hookCommandFor(client, reg.hookFile);
  if (client === "claudeCode") {
    return { matcher: reg.matcher, hooks: [{ type: "command", command }] };
  }
  return reg.matcher === "*" ? { command } : { matcher: reg.matcher, command };
}

/**
 * Fabric's own hook config for `client`, as a fresh object — byte-equivalent to
 * the JSON `fabric install` ships (asserted by the template-parity test), so
 * `doctor --fix` can restore a config without a second copy of the shape.
 */
export function fabricHookConfigFor(client: HookClient): Record<string, unknown> {
  const { configRoot, registrations } = HOOK_REGISTRATIONS[client];
  const byEvent: Record<string, Array<Record<string, unknown>>> = {};
  for (const reg of registrations) {
    (byEvent[reg.event] ??= []).push(hookConfigEntry(client, reg));
  }
  return { [configRoot]: byEvent };
}

function commandsOf(entry: unknown): string[] {
  if (typeof entry !== "object" || entry === null) return [];
  const record = entry as Record<string, unknown>;
  const own = typeof record.command === "string" ? [record.command] : [];
  const nested = Array.isArray(record.hooks)
    ? record.hooks.flatMap((inner) =>
        typeof inner === "object" && inner !== null &&
        typeof (inner as Record<string, unknown>).command === "string"
          ? [(inner as Record<string, unknown>).command as string]
          : [],
      )
    : [];
  return [...own, ...nested];
}

/**
 * Is `hookFile` wired into `existing` (an already-parsed client hook config)?
 *
 * The read-side twin of {@link mergeFabricHookRegistrations}, and deliberately
 * in the same file: both answer "is this command already in that event's array"
 * and they must answer it identically, or the console would report a hook as
 * unregistered that a re-install then declines to add because it is already
 * there. Sharing `commandsOf` is what makes that impossible.
 *
 * A hook registered under several events (Codex wires cite-policy-evict under
 * SessionStart only, but the shape allows more) counts as registered when ANY
 * of its registrations is present — the file runs either way.
 */
export function isHookRegistered(
  existing: unknown,
  client: HookClient,
  hookFile: string,
): boolean {
  const { configRoot, registrations } = HOOK_REGISTRATIONS[client];
  const events = registrations.filter((r) => r.hookFile === hookFile).map((r) => r.event);
  if (events.length === 0) return false;
  if (typeof existing !== "object" || existing === null || Array.isArray(existing)) return false;
  const rootValue = (existing as Record<string, unknown>)[configRoot];
  if (typeof rootValue !== "object" || rootValue === null || Array.isArray(rootValue)) return false;
  const command = hookCommandFor(client, hookFile);
  return events.some((event) => {
    const entries = (rootValue as Record<string, unknown>)[event];
    return Array.isArray(entries) && entries.some((entry) => commandsOf(entry).includes(command));
  });
}

/**
 * Append Fabric's registrations into an existing (already-parsed) client hook
 * config, returning a new object. Entries are appended, never replaced, and a
 * registration whose command is already present anywhere in that event's array
 * is skipped — so re-running is a no-op and a user's own hooks in the same slot
 * survive (KT-GLD-0003).
 *
 * `existing` is treated as an empty config when it is not a plain object; that
 * only happens for a config whose top level is an array or a scalar, which is
 * not a config any client would honour anyway.
 */
export function mergeFabricHookRegistrations(
  existing: unknown,
  client: HookClient,
): Record<string, unknown> {
  const { configRoot, registrations } = HOOK_REGISTRATIONS[client];
  const base: Record<string, unknown> =
    typeof existing === "object" && existing !== null && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};

  const rootValue = base[configRoot];
  const events: Record<string, unknown> =
    typeof rootValue === "object" && rootValue !== null && !Array.isArray(rootValue)
      ? { ...(rootValue as Record<string, unknown>) }
      : {};

  for (const reg of registrations) {
    const current = events[reg.event];
    const entries = Array.isArray(current) ? [...current] : [];
    const command = hookCommandFor(client, reg.hookFile);
    if (!entries.some((entry) => commandsOf(entry).includes(command))) {
      entries.push(hookConfigEntry(client, reg));
    }
    events[reg.event] = entries;
  }

  base[configRoot] = events;
  return base;
}
