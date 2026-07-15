import { defineCommand } from "citty";

import {
  buildAlwaysActiveBodies,
  buildKnowledgeCensus,
  planContext,
  type KnowledgeCensus,
} from "@fenglimg/fabric-server";

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
  // W2-2 (KT-DEC-0027): the entry's `must_read_if` trigger hook. The SessionStart
  // spine renders decision/pitfall/process broad entries as `title — must_read_if`
  // (situational reference, read on demand) rather than injecting their body.
  // Omitted when the frontmatter declares none.
  must_read_if?: string;
  // TASK-003 (impact-map MVP): the entry's impact list (consequences of ignoring
  // the knowledge). Forwarded so the narrow PreToolUse hint can surface it as a
  // ⚠️ consequence line when editing a matching relevance path. Omitted when the
  // frontmatter declares none / an empty list.
  impact?: string[];
  // v2.0.0-rc.27 TASK-002 (audit §2.5/§2.7): relevance_scope per-entry so the
  // PreToolUse narrow hook can filter out broad-scoped entries. rc.26 emitted
  // the union of narrow+broad without this discriminator, and the hook
  // rendered every entry as "narrow" regardless — bug surface §2.5. The
  // server-side `shouldIncludeByRelevance` already filters narrow vs broad
  // per-path; this field forwards that scope to the CLI consumer.
  relevance_scope: "narrow" | "broad";
  // lifecycle-refactor W3-T2 (§7 图谱消费 / §5 hook 沿 related 二阶召回): when this
  // entry was pulled into the hint by following a surfaced entry's one-hop
  // `related` graph edge (NOT by its own ranking), this carries the source id.
  // Hooks render it as `related-to-<id>` provenance. Omitted for ordinarily-ranked
  // entries — its presence is the honest "this came from the graph" marker.
  related_to?: string;
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
// v2.2 dual-sink (Goal A / D9): one always-active (broad guideline/model) entry.
// The hook renders these as ALWAYS-ACTIVE RULES — INDEX lines (title + summary),
// never the eager body (KT-DEC-0036); the body is one on-demand fetch away. The
// `body` field is retained on the wire for callers that still want it, but the
// SessionStart sink no longer injects it. Decisions/pitfalls/processes render as
// situational REFERENCE (title + must_read_if).
export interface PlanContextHintAlwaysBody {
  id: string;
  type: string;
  layer: "team" | "personal";
  summary: string;
  /** Always empty on SessionStart wire (ISS-20260713-014 index-only). */
  body: string;
}

export interface PlanContextHintOutput {
  version: 2;
  revision_hash: string;
  target_paths: string[];
  entries: PlanContextHintEntry[];
  /** @deprecated rc.27 — semantically broken (reports total, not broad-only). Prefer narrow_count + broad_count. */
  broad_count: number;
  narrow_count: number;
  broad_only_count: number;
  // v2.2 dual-sink (Goal A / D9): always-active bodies for the AI sink. Always
  // present (possibly empty); the hook only consumes it on the SessionStart
  // (`--all`) path.
  always_bodies: PlanContextHintAlwaysBody[];
  // v2.2 dual-sink (Goal A / D8): unsliced read-set census for the human sink's
  // grouped banner (per-type + per-layer + dropped-other-project). Distinct from
  // `entries` (top_k-sliced AI candidate list).
  census: KnowledgeCensus;
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
    // rc.15 TASK-004 (C8): hidden from `fabric --help` listing. The command stays
    // callable so hook scripts and the fabric-import skill can still invoke
    // it via `fabric plan-context-hint ...`; it just no longer appears in the
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
    // lifecycle-refactor W3-T2 (§7 图谱消费 / §5): default-enable graph二阶召回 for
    // the hint path. planContext appends the one-hop `related` neighbours that
    // ranked outside top_k of the surfaced set and reports them in
    // `related_appended` (appended id → source id). Honest no-op when the
    // surfaced set declares no in-corpus related edge.
    include_related: true,
  });

  // v2.0.0-rc.38 UX-1: the server collapsed per-path `description_index` into a
  // single top-level `candidates` array (since rc.37 A1 every per-path index
  // was a copy of the shared one). `--all` and path mode now read the same
  // candidate list. UX-3 removed the top-level mirrors, so type/maturity/
  // relevance_scope are read off `description.*`.
  const candidates = result.candidates;

  // lifecycle-refactor W3-T2 (§7): related-expansion provenance. Omitted by the
  // server on the graph-empty / steady-state path, so this stays empty and no
  // entry gets a fake `related_to` marker.
  const relatedAppended: Record<string, string> = result.related_appended ?? {};

  const entries: PlanContextHintEntry[] = candidates.map((item) => {
    const relatedTo = relatedAppended[item.stable_id];
    return {
      id: item.stable_id,
      type: item.description.knowledge_type ?? "",
      maturity: item.description.maturity ?? "",
      summary: item.description.summary,
      relevance_scope: item.description.relevance_scope ?? "broad",
      // W2-2 (KT-DEC-0027): forward the must_read_if trigger hook for the
      // SessionStart REFERENCE rendering. Omitted when absent/empty.
      ...(typeof item.description.must_read_if === "string" && item.description.must_read_if.length > 0
        ? { must_read_if: item.description.must_read_if }
        : {}),
      // TASK-003 (impact-map MVP): forward the impact list for the narrow hint's
      // ⚠️ consequence rendering. Omitted when absent/empty so the wire shape and
      // downstream rendering stay unchanged for entries with no declared impact.
      ...(Array.isArray(item.description.impact) && item.description.impact.length > 0
        ? { impact: item.description.impact }
        : {}),
      // Only set when this entry was pulled in via a graph edge — its presence
      // is the honest signal, never synthesized for ordinarily-ranked entries.
      ...(typeof relatedTo === "string" ? { related_to: relatedTo } : {}),
    };
  });

  // v2.0.0-rc.27 TASK-002: compute split totals from the result entries so
  // hook consumers can drop the deprecated `broad_count` (which conflated
  // total with broad-only). narrow_count + broad_only_count == entries.length.
  let narrow_count = 0;
  let broad_only_count = 0;
  for (const e of entries) {
    if (e.relevance_scope === "narrow") narrow_count += 1;
    else broad_only_count += 1;
  }

  // v2.2 dual-sink (Goal A / D9): collect always-active (guideline/model) bodies
  // for the AI sink + the unsliced census for the human sink. Same project-filter
  // as recall (shared filterByActiveProject). Never throws — degrade to safe
  // empties so the hint payload stays valid.
  const alwaysBodies = await buildAlwaysActiveBodies(resolution.target).catch(() => []);
  const census = await buildKnowledgeCensus(resolution.target).catch(
    (): KnowledgeCensus => ({
      by_type: {},
      by_layer: { team: 0, personal: 0, project: 0 },
      broad_by_type: {},
      narrow_total: 0,
      dropped_other_project: 0,
      total: 0,
    }),
  );

  const output: PlanContextHintOutput = {
    version: 2,
    revision_hash: result.revision_hash,
    target_paths: targetPaths,
    entries,
    // Legacy field — preserved for v2 consumers that haven't migrated. Value
    // semantics unchanged from rc.18 (total candidate count).
    broad_count: candidates.length,
    narrow_count,
    broad_only_count,
    always_bodies: alwaysBodies.map((b) => ({
      id: b.stable_id,
      type: b.type,
      layer: b.layer,
      summary: b.summary,
      // ISS-20260713-014: never re-ship body even if server regresses.
      body: "",
    })),
    census,
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
