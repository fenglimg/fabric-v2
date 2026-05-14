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
//     version: 1,
//     revision_hash: string,         // agents.meta revision at time of call
//     target_paths: string[],        // paths passed to planContext (after
//                                    // normalization); `--all` => ["**"]
//     narrow: Array<{                // path-relevant description_index slice
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

export interface PlanContextHintNarrowEntry {
  id: string;
  type: string;
  maturity: string;
  summary: string;
}

export interface PlanContextHintOutput {
  version: 1;
  revision_hash: string;
  target_paths: string[];
  narrow: PlanContextHintNarrowEntry[];
  broad_count: number;
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

  const narrow: PlanContextHintNarrowEntry[] = narrowSource.map((item) => ({
    id: item.stable_id,
    type: item.type ?? item.description.knowledge_type ?? "",
    maturity: item.maturity ?? item.description.maturity ?? "",
    summary: item.description.summary,
  }));

  return {
    version: 1,
    revision_hash: result.revision_hash,
    target_paths: targetPaths,
    narrow,
    broad_count: sharedIndex.length,
  };
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
