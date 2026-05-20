import { defineCommand } from "citty";

import { planContext } from "@fenglimg/fabric-server";

import { resolveDevMode } from "../dev-mode.js";

// ---------------------------------------------------------------------------
// rc.5 D1 — `fabric plan-context-hint`
//
// Thin CLI adapter over the server's `planContext()` engine. Emits a
// versioned, machine-readable JSON document to stdout so out-of-process
// consumers (rc.6 SessionStart / PreToolUse hooks, and the `fabric-import`
// skill for default-broad pending creation) can read knowledge hints
// without spawning a full MCP stdio session.
//
// Contract (stable JSON):
//   {
//     version: 2,
//     revision_hash: string,         // agents.meta revision at time of call
//     target_paths: string[],        // paths passed to planContext (after
//                                    // normalization); `--all` => ["**"]
//     entries: Array<{               // mode-agnostic description_index slice
//       id: string,                  //   stable_id
//       type: string,                //   knowledge_type (model/decision/...)
//       maturity: string,            //   draft|verified|proven
//       summary: string,             //   description.summary
//     }>,
//     broad_count: number,           // total broad/cross-cutting entries
//                                    // in the registry (today: all entries,
//                                    // see rc.5 C1/C3 for the relevance_scope
//                                    // schema that will refine this split)
//   }
//
// Stderr is intentionally empty on success — rendering (human-readable
// summary, grouping, truncation) is the hook's responsibility per the rc.5
// MCP-vs-CLI adapter boundary. The CLI ships only the structured payload.
//
// Failure mode: any error (missing agents.meta, planContext throw, etc.) is
// printed to stderr and the process exits non-zero. JSON is NOT emitted on
// failure so callers can distinguish empty-payload from malformed-output.
// ---------------------------------------------------------------------------

type PlanContextHintArgs = {
  paths?: string;
  all?: boolean;
  target?: string;
};

export interface PlanContextHintEntry {
  id: string;
  type: string;
  maturity: string;
  summary: string;
  // v2.0.0-rc.27 TASK-002 (audit §2.5/§2.7): relevance_scope per-entry so the
  // PreToolUse narrow hook can filter out broad-scoped entries. rc.26 emitted
  // the union of narrow+broad without this discriminator, and the hook
  // rendered every entry as "narrow" regardless — bug surface §2.5. The
  // server-side `shouldIncludeByRelevance` already filters narrow vs broad
  // per-path; this field forwards that scope to the CLI consumer.
  relevance_scope: "narrow" | "broad";
}

// Protocol v2 (rc.18): renamed `narrow` → `entries` (field is mode-agnostic —
// covers both --paths union and --all degenerate); v1 emission is removed
// without a compat shim per pre-user clean-slate policy.
//
// v2.0.0-rc.22 Scope D T-D3 (TASK-010): additive optional auto-heal banner
// fields. Surfaced ONLY when the server's planContext() detected meta drift
// and rebuilt the meta in-place (auto_healed === true). Both fields stay
// omitted on the steady-state path so the wire shape remains minimal in the
// common case. Version stays at 2 — additive optional fields preserve v2
// compat for hook consumers that don't read them.
//
// v2.0.0-rc.27 TASK-002 (audit §2.5/§2.7): added per-entry relevance_scope
// (above) + the dedicated narrow_count / broad_count totals. The legacy
// `broad_count` field was misleadingly named — it actually reported the
// sharedIndex total (narrow + broad combined). We retain it as-is to avoid
// breaking v2 consumers, but introduce explicit narrow_count / broad_count
// computed from the entry's relevance_scope. Hook scripts should prefer the
// split fields and treat the legacy `broad_count` as deprecated.
export interface PlanContextHintOutput {
  version: 2;
  revision_hash: string;
  target_paths: string[];
  entries: PlanContextHintEntry[];
  /** @deprecated rc.27 — semantically broken (reports total, not broad-only). Prefer narrow_count + broad_count. */
  broad_count: number;
  narrow_count: number;
  broad_only_count: number;
  auto_healed?: boolean;
  previous_revision_hash?: string;
}

// Sentinel path used when `--all` is set. planContext requires at least one
// path; the repo root + "**" idiom matches every cross-cutting entry whose
// scope_glob is "**" and is the conventional "everything" probe shared with
// the MCP adapter.
const ALL_PATHS_SENTINEL = "**";

export const planContextHintCommand = defineCommand({
  meta: {
    name: "plan-context-hint",
    description:
      "Emit versioned knowledge hint JSON to stdout. Used by rc.6 hooks and the fabric-import skill.",
    // rc.15 TASK-004 (C8): hidden from `fab --help` listing. The command stays
    // callable so hook scripts and the fabric-import skill can still invoke
    // it via `fab plan-context-hint ...`; it just no longer appears in the
    // top-level usage banner alongside install/doctor/serve/uninstall/config.
    hidden: true,
  },
  args: {
    paths: {
      type: "string",
      description: "Comma-separated list of file paths to compute narrow hints for.",
    },
    all: {
      type: "boolean",
      description: "Return the full broad+narrow set with no path filter.",
      default: false,
    },
    target: {
      type: "string",
      description: "Override the project root (defaults to cwd / dev-mode resolution).",
    },
  },
  async run({ args }: { args: PlanContextHintArgs }) {
    try {
      const output = await runPlanContextHint({
        paths: parsePathsArg(args.paths),
        all: args.all === true,
        target: args.target,
      });
      process.stdout.write(`${JSON.stringify(output)}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`plan-context-hint failed: ${message}\n`);
      process.exitCode = 1;
    }
  },
});

export default planContextHintCommand;

/**
 * Pure handler — exported for unit tests so callers can exercise the JSON
 * shape without spawning the CLI binary.
 */
export async function runPlanContextHint(opts: {
  paths?: string[];
  all?: boolean;
  target?: string;
}): Promise<PlanContextHintOutput> {
  const all = opts.all === true;
  const explicitPaths = (opts.paths ?? []).filter((p) => p.length > 0);

  // `--all` and `--paths` are not mutually exclusive at the protocol layer,
  // but if `--all` is set we ignore any explicit paths and probe the whole
  // registry. The contract favors the simpler `target_paths = ["**"]` shape
  // so hook consumers can detect the "no filter" mode without inspecting
  // flag state.
  const targetPaths = all
    ? [ALL_PATHS_SENTINEL]
    : explicitPaths.length > 0
      ? explicitPaths
      : [ALL_PATHS_SENTINEL]; // default behavior when neither flag is set

  const resolution = resolveDevMode(opts.target, process.cwd());
  const result = await planContext(resolution.target, {
    paths: targetPaths,
  });

  // Today (pre-C1/C3) the registry has no `relevance_scope` field, so every
  // entry is treated as broad. `narrow` therefore returns the description
  // index for the requested path(s), and `broad_count` reports the total
  // number of broad entries available in the registry (== shared index size
  // when no path filter is active). Once C3 lands, `narrow` will be
  // pre-filtered by `relevance_paths` glob match inside planContext itself.
  const sharedIndex = result.shared.description_index;
  const narrowSource = all
    ? sharedIndex
    : // Path mode: union of per-entry description_index across requested
      // paths, deduped by stable_id. This is identical to `shared` for L0/L1
      // entries (always included) and additionally captures L2 entries whose
      // scope_glob matches the requested path.
      dedupeByStableId(result.entries.flatMap((entry) => entry.description_index));

  const entries: PlanContextHintEntry[] = narrowSource.map((item) => ({
    id: item.stable_id,
    type: item.type ?? item.description.knowledge_type ?? "",
    maturity: item.maturity ?? item.description.maturity ?? "",
    summary: item.description.summary,
    // v2.0.0-rc.27 TASK-002 (§2.5/§2.7): forward the server-side scope.
    // RuleDescriptionIndexItem already carries this field — knowledge-meta-
    // builder defaults to "broad" for entries without an explicit
    // relevance_scope frontmatter, so this read is total and never undefined.
    relevance_scope: item.relevance_scope ?? "broad",
  }));

  // v2.0.0-rc.27 TASK-002: compute split totals from the result entries so
  // hook consumers can drop the deprecated `broad_count` (which conflated
  // total with broad-only). narrow_count + broad_only_count == entries.length.
  let narrow_count = 0;
  let broad_only_count = 0;
  for (const e of entries) {
    if (e.relevance_scope === "narrow") narrow_count += 1;
    else broad_only_count += 1;
  }

  const output: PlanContextHintOutput = {
    version: 2,
    revision_hash: result.revision_hash,
    target_paths: targetPaths,
    entries,
    // Legacy field — preserved for v2 consumers that haven't migrated. Value
    // semantics unchanged from rc.18 (sharedIndex total).
    broad_count: sharedIndex.length,
    narrow_count,
    broad_only_count,
  };

  // v2.0.0-rc.22 Scope D T-D3 (TASK-010): thread auto-heal banner pair through
  // to the wire payload, but ONLY when the server actually healed. Omitting
  // both fields on the steady-state path keeps the JSON tidy and lets hook
  // consumers branch on `auto_healed === true` without a tri-state check.
  if (result.auto_healed === true) {
    output.auto_healed = true;
    if (typeof result.previous_revision_hash === "string") {
      output.previous_revision_hash = result.previous_revision_hash;
    }
  }

  return output;
}

function parsePathsArg(raw: string | undefined): string[] {
  if (raw === undefined || raw.length === 0) {
    return [];
  }
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function dedupeByStableId<T extends { stable_id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (seen.has(item.stable_id)) continue;
    seen.add(item.stable_id);
    result.push(item);
  }
  return result;
}
