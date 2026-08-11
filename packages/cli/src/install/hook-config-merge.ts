import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { atomicWriteJson } from "@fenglimg/fabric-shared/node/atomic-write";

import { deepMerge } from "../config/json.js";
import {
  CLAUDE_HOOK_CONFIG_TEMPLATE_REL,
  CODEX_HOOK_CONFIG_TEMPLATE_REL,
  HOOK_CONFIG_ARRAY_PATHS,
  HOOK_CONFIG_TARGETS,
} from "./distribution-targets.js";
import type { InstallStepResult } from "./step-result.js";
import { readJsonTemplate } from "./template-io.js";

/**
 * Registers Fabric's hooks in each client's own config file.
 *
 * Unlike every other install artifact these files are MERGED, not copied: they
 * are the user's, and they hold hooks fabric does not own. Two rules follow —
 * arrays are append-with-dedupe (never replace), and a non-object config is a
 * hard error rather than something to "heal" by overwriting.
 *
 * The pre-merge sweep is what makes a matcher edit in a template actually reach
 * an upgraded project: dedupe matches on the `command` string, so without first
 * stripping the old entry the merge would see a match and keep the stale
 * matcher forever.
 */

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
const FABRIC_HOOK_SCRIPT_BASENAMES: ReadonlySet<string> = new Set([
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
  // ISS-20260711-258: refuse to "heal" a non-object settings/hooks file by
  // replacing it with {}. That silently destroyed user content (e.g. a
  // settings.json that was accidentally an array or primitive) and then
  // overwrote the path with only the fabric fragment.
  let existing: Record<string, unknown>;
  try {
    existing = await readJsonObjectOrEmpty(target);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { step, path: target, status: "error", message };
  }
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
      throw new Error(
        `refusing to merge into non-object JSON at ${path} (got ${
          parsed === null ? "null" : Array.isArray(parsed) ? "array" : typeof parsed
        }) — fix or rename the file before re-running fabric install`,
      );
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
