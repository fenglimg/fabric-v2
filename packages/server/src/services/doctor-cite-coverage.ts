// W4-15 (ISS-018): cite-coverage / cite-audit-rollup / archive-history domain
// extracted from the doctor.ts god-file. Behaviour-preserving move — doctor.ts
// re-exports every public symbol so the package surface is unchanged. The
// inspectL1BootstrapSnapshotDrift + DoctorIssue/DoctorReport/LintMaturity refs
// import back from doctor.ts (a benign ESM function/type cycle — all cross-refs
// are resolved at call time, never at module-evaluation time).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { access, appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, posix, relative as nodeRelative, resolve, sep } from "node:path";
import { Script } from "node:vm";

import { minimatch } from "minimatch";
import { ZodError } from "zod";

import {
  agentsMetaSchema,
  AgentsMetaCountersSchema,
  createTranslator,
  forensicReportSchema,
  parseKnowledgeId,
  knowledgeTestIndexSchema,
  BOOTSTRAP_MARKER_BEGIN,
  BOOTSTRAP_MARKER_END,
  BOOTSTRAP_REGEX,
  ONBOARD_SLOT_NAMES,
  ONBOARD_SLOT_TOTAL,
  type AgentsMeta,
  type AgentsMetaCounters,
  type EventLedgerEvent,
  type ForensicReport,
  type KnowledgeTestIndex,
  type OnboardSlot,
  resolveFabricLocale,
  type Translator,
} from "@fenglimg/fabric-shared";
import { detectFramework } from "@fenglimg/fabric-shared/node";
// v2.0.0-rc.29 TASK-008 (BUG-F2): surface MCP payload thresholds in doctor.
import {
  PAYLOAD_LIMIT_DEFAULT_HARD_BYTES,
  PAYLOAD_LIMIT_DEFAULT_WARN_BYTES,
} from "@fenglimg/fabric-shared/node/mcp-payload-guard";
import { readOrphanDemoteThresholdDays, readPayloadLimits } from "../config-loader.js";

import { contextCache } from "../cache.js";
import { atomicWriteJson, atomicWriteText } from "@fenglimg/fabric-shared/node/atomic-write";
import { ensureParentDirectory, getEventLedgerPath, getMetricsLedgerPath, sha256 } from "./_shared.js";
import { collectStoreCanonicalEntries } from "./cross-store-recall.js";
import {
  appendEventLedgerEvent,
  dropEventsFromLedger,
  readEventLedger,
  rotateEventLedgerIfNeeded,
  truncateLedgerToLastNewline,
} from "./event-ledger.js";
import { appendCiteRollupRow, readCiteRollup, utcDayKey, utcDayBounds } from "./cite-rollup.js";
import type { CiteRollupRow } from "./cite-rollup.js";
import { readMetrics, METRIC_COUNTER_NAMES } from "./metrics.js";
import type { MetricsRow } from "./metrics.js";
import { INJECTION_PATTERNS } from "./extract-knowledge.js";

import { inspectL1BootstrapSnapshotDrift, normalizePath } from "./doctor.js";
import type { DoctorIssue, DoctorReport, LintMaturity } from "./doctor.js";

const CITE_POLICY_VERSION = "2.0.0-rc.20";

export async function ensureCitePolicyActivatedMarker(
  projectRoot: string,
): Promise<{ marker_ts: number; emitted_now: boolean }> {
  let existing: { ts: number } | undefined;
  try {
    const { events } = await readEventLedger(projectRoot, { event_type: "cite_policy_activated" });
    if (events.length > 0) {
      existing = events[0];
    }
  } catch {
    return { marker_ts: 0, emitted_now: false };
  }

  if (existing !== undefined) {
    return { marker_ts: existing.ts, emitted_now: false };
  }

  try {
    const stored = await appendEventLedgerEvent(projectRoot, {
      event_type: "cite_policy_activated",
      policy_version: CITE_POLICY_VERSION,
      timestamp: new Date().toISOString(),
    });
    return { marker_ts: stored.ts, emitted_now: true };
  } catch {
    return { marker_ts: 0, emitted_now: false };
  }
}

// v2.0.0-rc.24 TASK-06: ensureCiteContractPolicyActivatedMarker — drift-gated
// counterpart to ensureCitePolicyActivatedMarker (rc.20). The cite-contract
// policy upgrade introduces structured `cite_commitments` written by post-rc.24
// hooks. During the rc.23 → rc.24 half-upgrade window (server on rc.24, hooks
// still rc.23) the marker emit MUST be refused — otherwise contract metrics
// open an audit window against events that physically cannot carry the new
// commitments field, manufacturing false `contract_missing` violations.
//
// The gate reuses `inspectL1BootstrapSnapshotDrift` (rc.19): if `.fabric/
// AGENTS.md` byte-equals the canonical bootstrap body for any locale (the
// inspector tolerates a language switch), the user has run the rc.24 `fabric
// install` and the hook layer is in sync with the schema.
// 'missing' is also treated as drift (deliberate conservative choice — no
// install snapshot present means we cannot prove the hook layer matches; user
// must run `fabric install` to seed `.fabric/AGENTS.md`).
//
// Return shape mirrors `ensureCitePolicyActivatedMarker` with one added
// discriminator: `blocked_by`. `null` when activation succeeded (or marker
// already existed); `'bootstrap_drift'` when the snapshot did not byte-equal
// canonical. Caller (`runDoctorCiteCoverage` extension in TASK-08) renders
// `contract_check: skipped (bootstrap drift — run fabric install)` when this
// field is non-null.
export async function ensureCiteContractPolicyActivatedMarker(
  projectRoot: string,
): Promise<{
  marker_ts: number;
  emitted_now: boolean;
  blocked_by: "bootstrap_drift" | null;
}> {
  // Step 1: gate on bootstrap drift. Use the existing L1 inspector so the
  // drift definition stays single-sourced. Any inspector throw (permissions,
  // unreadable FS) is treated as drift — conservative: better to skip
  // activation than to falsely advance the contract window.
  let driftStatus: "ok" | "drift" | "missing";
  try {
    const inspection = await inspectL1BootstrapSnapshotDrift(projectRoot);
    driftStatus = inspection.status;
  } catch {
    driftStatus = "drift";
  }
  if (driftStatus !== "ok") {
    return { marker_ts: 0, emitted_now: false, blocked_by: "bootstrap_drift" };
  }

  // Step 2: mirror ensureCitePolicyActivatedMarker — read existing marker
  // first, then append-if-missing. Read/write failures collapse to the
  // sentinel `{ marker_ts: 0, emitted_now: false }` exactly as the rc.20
  // marker does. Note: `blocked_by` is `null` for the silent-failure path —
  // the drift gate is the only path that surfaces a blocker, the ledger
  // sentinel preserves the rc.20 "warm-up never raises" contract.
  let existing: { ts: number } | undefined;
  try {
    const { events } = await readEventLedger(projectRoot, {
      event_type: "cite_contract_policy_activated",
    });
    if (events.length > 0) {
      existing = events[0];
    }
  } catch {
    return { marker_ts: 0, emitted_now: false, blocked_by: null };
  }

  if (existing !== undefined) {
    return { marker_ts: existing.ts, emitted_now: false, blocked_by: null };
  }

  try {
    const stored = await appendEventLedgerEvent(projectRoot, {
      event_type: "cite_contract_policy_activated",
    });
    return { marker_ts: stored.ts, emitted_now: true, blocked_by: null };
  } catch {
    return { marker_ts: 0, emitted_now: false, blocked_by: null };
  }
}

// v2.0.0-rc.20 TASK-05: cite policy adherence report shape returned by
// `fabric doctor --cite-coverage`. STUB scaffolding — TASK-06 fills the
// `metrics` / `per_client` / `dismissed_reason_histogram` fields by scanning
// `assistant_turn_observed` ledger events emitted by TASK-03. The shape is
// finalized here so the CLI renderer (TASK-07) and any downstream consumers
// can compile against a stable type before metrics are populated.
//
// status:
//   - 'skipped' when no `cite_policy_activated` marker exists AND the marker
//     write also failed (degraded ledger). Callers should render this as
//     "no data yet — re-run after first AI turn" rather than as an error.
//   - 'ok' once the marker is present (newly emitted or pre-existing). Zero
//     metrics in 'ok' status are valid: it means the marker is fresh and no
//     qualifying turns have been observed yet within the requested window.
//
// per_client / dismissed_reason_histogram are intentionally optional — they
// are only emitted by TASK-06 once the underlying observation events carry
// the `client` and `dismissed_reason` fields. STUB returns neither.
//
// v2.0.0-rc.24 TASK-08: extended with contract-policy metrics. Five new
// accumulators (contract_with / contract_missing / hard_violated / skip_count
// / cite_id_unresolved) plus per-(layer, type) cross-tab and a
// contract_metrics_status discriminator gating the contract audit window.
// The rc.20 metrics block stays untouched — contract metrics are an additive
// extension. See plan.json design_decisions for the B4 marker-independence
// rationale.
export type CiteContractMetrics = {
  // Counts of strict-bucket cites (decision/pitfall) actually observed in the
  // contract window. decisions_cited + pitfalls_cited = the denominator that
  // contract_with / contract_missing / hard_violated partitions.
  decisions_cited: number;
  pitfalls_cited: number;
  // contract_with: strict-bucket cite carried at least one operator (i.e.
  // commitment.operators.length > 0). contract_missing: strict-bucket cite
  // had no operators AND no skip_reason — the lazy default the policy
  // explicitly refuses. hard_violated: cite had operators but the session
  // edits diverged from at least one operator (e.g. edit:foo.ts but no
  // session edit hit foo.ts). cite_id_unresolved: cite_id absent from
  // knowledge-meta idTypeMap (hallucinated id or stale meta).
  contract_with: number;
  contract_missing: number;
  hard_violated: number;
  cite_id_unresolved: number;
  // skip_count: histogram of skip_reason buckets. Keys are the reasons the
  // hook parser emitted verbatim — bootstrap docs canonicalize the vocabulary
  // (e.g. "sequencing", "tribal-knowledge"), but the doctor does NOT
  // gatekeeper the enum here; it surfaces whatever the parser wrote so
  // operators can data-drive vocabulary expansion (per B1 grill-me lock).
  skip_count: Record<string, number>;
};

// Per-(layer, type) cross-tab — populated whenever contract metrics are
// computed. Keyed by layer ("team"/"personal") then by PLURAL knowledge_type
// (rc.29 BUG-C1) from TASK-07's idTypeMap (so the keys match the schema enum
// verbatim).
// "unresolved" is a sixth bucket for cite_ids that did not resolve in
// idTypeMap. Counts are turn-cite occurrences, not session-level.
export type CiteLayerTypeBreakdown = {
  team: Record<string, number>;
  personal: Record<string, number>;
};

export type CiteCoverageReport = {
  status: "ok" | "skipped";
  marker_ts: number;
  marker_emitted_now: boolean;
  since_ts: number;
  client_filter: "cc" | "codex" | "all";
  // v2.0.0-rc.24 TASK-08: layer filter for personal-layer parity. 'all' =
  // both team (KT-*) and personal (KP-*); 'team' / 'personal' = restrict
  // top-level metrics to one root. Optional (defaults to 'all') so existing
  // callers (CLI rc.20 surface) do not break before TASK-10 wires the flag.
  layer_filter?: "team" | "personal" | "all";
  metrics: {
    edits_touched: number;
    qualifying_cites: number;
    recalled_unverified: number;
    expected_but_missed: number;
    total_turns: number;
    // v2.0.0-rc.38 UX-8 (C): cite-policy compliance rate (corrected G-CITE
    // metric). See api-contracts citeCoverageReportSchema for semantics.
    cite_compliance_rate?: number | null;
    compliant_cites?: number;
    noncompliant_cites?: number;
    // v2.0.0-rc.38 UX-8 (C, hardening): edit signals lacking session_id (can't
    // correlate → silently excluded from expected_but_missed). >0 usually means
    // a stale pre-session_id hook is installed; run `fabric install`.
    uncorrelatable_edits?: number;
    // v2.1 ⑤ cite-redesign (P5): recall-based coverage口径. recall_backed_edits =
    // correlatable edits preceded (within the recall window) by an in-session
    // knowledge_context_planned whose target_paths overlap the edited file —
    // the recall→edit overlap IS the citation (no hand-written `KB:` needed).
    // recall_coverage_rate = recall_backed_edits / edits_touched (null when no
    // edits). Additive — legacy first-line-`KB:` metrics are unchanged.
    recall_backed_edits?: number;
    recall_coverage_rate?: number | null;
    // recall→edit correlation is strictly SESSION-SCOPED (an edit is recall-backed
    // only when an in-SAME-session knowledge_context_planned overlaps its path —
    // intentionally session-scoped to avoid cross-window 张冠李戴). When recalls
    // happened in-window but NONE share a session with any edit, recall_coverage
    // reads 0 not because recall discipline is poor but because the recall CALLER
    // tagged its fab_recall with a non-client session_id. These counts let the
    // surface self-diagnose that mismatch instead of showing a bare confusing 0%.
    //   recalls_in_window         = # in-session knowledge_context_planned in window
    //   recall_sessions           = distinct recall session_ids
    //   recall_sessions_correlated = recall sessions that are ALSO an edit session
    // Mismatch suspected ⇔ recalls_in_window>0 ∧ recall_sessions_correlated===0.
    recall_diagnostics?: {
      recalls_in_window: number;
      recall_sessions: number;
      recall_sessions_correlated: number;
    };
    // v2.2.0-rc.1 W1-T3 (cite 诚实拆分 / lifecycle §3): exposed_and_mutated is a
    // WEAK auxiliary signal — strictly SEPARATE from cite_compliance_rate. It MUST
    // NOT be merged into compliance (the honesty 铁律): it estimates how many
    // narrow PreToolUse-surfaced KB ids had their SPECIFIC contract glob edited
    // (mutated) in the same session without being [dismissed]. Three conditions
    // (see computeExposedAndMutated): narrow-surfaced + contract glob specific
    // (excludes `**/*` and generic guidelines) + not dismissed this round.
    // count = distinct (session, id) pairs; ids = sorted distinct stable_ids
    // (diagnostics only). Additive — never touches the compliance numerator.
    exposed_and_mutated?: { count: number; ids?: string[] };
    // lifecycle-refactor W2-T4 (§5 row7 PostToolUse / §0 下沉 doctor): mutation
    // funnel rebuilt offline from the new `file_mutated` PostToolUse marker. This
    // is the AUTHORITATIVE "mutation completed" signal (path + tool_call_id),
    // distinct from the PreToolUse `edit_intent_checked` EDIT-INTENT that feeds
    // `edits_touched`. count = distinct `file_mutated` events in window
    // (tool_call_id dedup guards the PostToolUse parallel-fire race). Strictly
    // ADDITIVE — never folded into cite_compliance_rate (honesty 铁律).
    mutations_observed?: { count: number };
    // lifecycle-refactor W2-T4 (§5 row7 mutation_pool + downgrade): low-confidence
    // attribution pool. `attributed` = a `file_mutated` whose `source_event_id`
    // links to a `hook_surface_emitted` in window (attribution key = store_id +
    // stable_id + source_event_id, distinct-dedup'd so multi-store never
    // double-counts). Everything else → `unattributed_workspace_dirty`. The §9
    // git-diff fallback is SPECULATIVE and deliberately NOT run (doctor read-only).
    mutation_pool?: { attributed: number; unattributed_workspace_dirty: number };
    // lifecycle-refactor W2-T4 (§5 row2 SessionEnd 对账下沉 doctor): distinct
    // sessions that appended a `session_ended` marker (funnel-closed boundary).
    // Pure observability marker — never joined into a rate.
    sessions_closed?: { count: number };
    // lifecycle-refactor W3-T4 (§2 store 轴 / store-qualified 观测): per-store
    // breakdown of qualifying cites, keyed by the cite's `cite_stores[i]`
    // qualifier (the project-local store collapses under the "local" key when a
    // cite carried no `<store>:` prefix). count = `applied` cites tagged with that
    // store. STRICTLY ADDITIVE — a pure diagnostic split of qualifying_cites that
    // NEVER feeds cite_compliance_rate (honesty 铁律, W1-T3). Omitted when no cite
    // was observed in window.
    by_store?: Record<string, { qualifying_cites: number }>;
  };
  per_client?: Record<string, Partial<CiteCoverageReport["metrics"]>>;
  dismissed_reason_histogram?: Record<string, number>;
  // v2.0.0-rc.23 TASK-08(c): breakdown of `KB: none` sentinel tails parsed
  // from `kb_line_raw`. Keys: 'no-relevant' (LLM searched, nothing matched),
  // 'not-applicable' (action not in cite scope), 'unspecified' (bare `KB:
  // none` — legacy/lazy). Optional — only emitted when at least one turn
  // carried the `none` cite tag.
  none_reason_histogram?: Record<string, number>;
  // v2.0.0-rc.24 TASK-08: contract-policy audit metrics. `status` discriminates:
  //   - 'ok'                       — contract metrics populated (marker present).
  //   - 'skipped:bootstrap_drift'  — `fabric install` has not run post-upgrade;
  //                                  contract_metrics shape is present but all
  //                                  counters are zero.
  //   - 'awaiting_marker'          — marker emit succeeded in the past but a
  //                                  read/write degraded the current invocation
  //                                  (rare); same zero-counter degraded mode.
  // contract_metrics is always emitted (even in skipped states) so the CLI
  // renderer (TASK-09) can iterate the shape without optional-chaining each
  // field. per_layer_type is likewise always emitted with zeroed buckets.
  contract_metrics_status?: "ok" | "skipped:bootstrap_drift" | "awaiting_marker";
  contract_metrics?: CiteContractMetrics;
  per_layer_type?: CiteLayerTypeBreakdown;
  contract_marker_ts?: number;
  generated_at: string;
  // v2.0.0-rc.39: when the --since window reaches into cite-audit-rolled-up
  // days, the rolled-up daily metrics are merged into the totals above (raw +
  // rollup are disjoint). These surface the merge for transparency + let the
  // CLI render the long-range daily compliance trend. Omitted when no rollup
  // day fell in window (the common short-window case).
  rollup_days_merged?: number;
  rollup_trend?: { date: string; generated_at: string; metrics: CiteCoverageReport["metrics"] }[];
};

// v2.0.0-rc.23 TASK-08(c): extract the `KB: none` sentinel reason from the raw
// kb-line text. Returns 'no-relevant' / 'not-applicable' for the documented
// enums, 'unspecified' for bare `KB: none` (legacy form). Unknown bracket
// payloads also collapse to 'unspecified' — we keep the histogram bounded to
// known buckets and rely on bootstrap docs to channel new emissions into the
// enum. Case-insensitive on the bracket payload, tolerant of surrounding
// whitespace.
function parseNoneSentinel(kbLineRaw: string | null | undefined): string {
  if (typeof kbLineRaw !== "string" || kbLineRaw.length === 0) return "unspecified";
  const m = kbLineRaw.match(/^KB:\s*none\b\s*(?:\[([^\]]*)\])?\s*$/i);
  if (m === null) return "unspecified";
  const inner = (m[1] ?? "").trim().toLowerCase();
  if (inner === "no-relevant" || inner === "not-applicable") return inner;
  return "unspecified";
}

// v2.0.0-rc.20 TASK-06: cite-coverage helpers.
//
// `categorizeCiteTag` normalizes the cite_tags vocabulary into one of the five
// outcome buckets the report tabulates. Tags may carry a colon-separated
// `dismissed:<reason>` payload (e.g. 'dismissed:scope-mismatch',
// 'dismissed:other:<text>'); the reason is split out for the histogram. TASK-02
// constrained the on-ledger tag enum to the bare five values, but per-turn
// dismissed reasons surface via the raw `kb_line_raw` text for now — until
// TASK-09 widens the schema, the histogram only counts `dismissed` as a
// generic bucket. The split logic is wired here so TASK-09 only needs to flip
// on a schema field without touching the aggregator.
// v2.1.0-rc.1 (ADJ-P4-1, full remap): cite_tags reaches this aggregator already
// normalized to the rc.37 NEW-1 2-state vocab — citeTagSchema's preprocess
// remaps legacy planned/recalled/chained-from → `applied` on read, so the legacy
// categories can never appear here. `applied` is the single qualifying category.
type CiteTagCategory = "applied" | "dismissed" | "none";

function categorizeCiteTag(tag: string): { category: CiteTagCategory; reason?: string } {
  if (tag === "applied" || tag === "none") {
    return { category: tag };
  }
  if (tag === "dismissed") {
    return { category: "dismissed", reason: "unspecified" };
  }
  if (tag.startsWith("dismissed:")) {
    const remainder = tag.slice("dismissed:".length);
    if (remainder.startsWith("other:")) {
      return { category: "dismissed", reason: remainder.slice("other:".length) || "other" };
    }
    return { category: "dismissed", reason: remainder || "unspecified" };
  }
  // Unknown tag — treat as 'none' so the aggregator does not blow up on a
  // future schema bump. Mirrors how `buildLastActiveIndex` ignores unrecognized
  // event_types via its default branch.
  return { category: "none" };
}

function matchesRelevancePath(editPath: string, relevancePaths: readonly string[]): boolean {
  if (relevancePaths.length === 0) {
    return false;
  }
  const normalized = normalizePath(editPath);
  for (const glob of relevancePaths) {
    if (minimatch(normalized, glob, { dot: true, matchBase: false })) {
      return true;
    }
  }
  return false;
}

// v2.1 ⑤ cite-redesign (P5): does an edited file fall within a fab_recall's
// target_paths? Mirror of the cite-policy-evict.cjs hook's pathPairOverlaps so
// the hook's runtime nudge and doctor's recall-based口径 use the SAME overlap
// definition. True on exact match, path-boundary suffix (abs-vs-rel skew), or
// ancestor-directory containment. Conservative — no basename-only matches.
function recallPathOverlaps(editPath: string, recallPaths: readonly string[]): boolean {
  if (recallPaths.length === 0) return false;
  const e = normalizePath(editPath);
  if (e.length === 0) return false;
  for (const rp of recallPaths) {
    const r = normalizePath(rp);
    if (r.length === 0) continue;
    if (e === r) return true;
    if (e.endsWith("/" + r) || r.endsWith("/" + e)) return true;
    if (e.startsWith(r + "/") || r.startsWith(e + "/")) return true;
  }
  return false;
}

// v2.2.0-rc.1 W1-T3 (cite 诚实拆分 / lifecycle §3): compute the WEAK auxiliary
// `exposed_and_mutated` signal. This is intentionally factored out of
// runDoctorCiteCoverage so the honesty boundary is reviewable in one place: it
// returns its own object and NEVER mutates the compliance accumulators. It must
// stay strictly separate from cite_compliance_rate.
//
// A (session_id, stable_id) pair qualifies when ALL THREE conditions hold:
//   (1) narrow-surfaced  — the id appears in the rendered_ids of a
//       `hook_surface_emitted` event whose hook_name === "knowledge-hint-narrow"
//       in that session (the PreToolUse narrow injection).
//   (2) contract glob specific — the id resolves to a NARROW kb entry whose
//       relevance_paths are specific: at least one glob that is not the `**/*`
//       (or `**`) catch-all, AND the entry's knowledge type is not a generic
//       guideline (guidelines/processes are excluded — they are broad-by-nature
//       and would dilute the signal).
//   (3) mutated, not dismissed — a later `edit_intent_checked` in the SAME
//       session edited a path matched by that id's specific relevance_paths, and
//       the id was NOT carried under a `dismissed` cite_tag in that session.
//
// `narrowSurfacedBySession` maps session_id → Set<stable_id> from condition (1);
// `dismissedBySession` maps session_id → Set<stable_id> dismissed in that session.
// The join walks edits and checks the id's specific glob against the edit path —
// the "exposed AND mutated" definition (lifecycle §3: 曝光且路径变更).
type ExposedKbEntry = {
  relevance_paths: readonly string[];
  relevance_scope: "narrow" | "broad";
};
function isSpecificGlob(glob: string): boolean {
  const g = glob.trim();
  if (g.length === 0) return false;
  // Exclude the catch-all wildcards that match everything — they carry no
  // path-specific contract and would inflate the signal.
  return g !== "**/*" && g !== "**" && g !== "*";
}
export function computeExposedAndMutated(args: {
  narrowSurfacedBySession: Map<string, Set<string>>;
  dismissedBySession: Map<string, Set<string>>;
  editPathsBySession: Map<string, string[]>;
  kbIndex: Map<string, ExposedKbEntry>;
  idTypeMap: Map<string, string>;
}): { count: number; ids: string[] } {
  const { narrowSurfacedBySession, dismissedBySession, editPathsBySession, kbIndex, idTypeMap } = args;
  const qualifiedIds = new Set<string>();
  let count = 0;
  for (const [sessionId, surfacedIds] of narrowSurfacedBySession) {
    const editPaths = editPathsBySession.get(sessionId);
    if (editPaths === undefined || editPaths.length === 0) continue;
    const dismissed = dismissedBySession.get(sessionId);
    for (const id of surfacedIds) {
      // (3) not dismissed this round.
      if (dismissed !== undefined && dismissed.has(id)) continue;
      // (2a) must resolve to a NARROW kb entry with specific relevance_paths.
      const kb = kbIndex.get(id);
      if (kb === undefined || kb.relevance_scope !== "narrow") continue;
      const specificGlobs = kb.relevance_paths.filter(isSpecificGlob);
      if (specificGlobs.length === 0) continue;
      // (2b) exclude generic guideline/process types — broad-by-nature.
      const type = idTypeMap.get(id);
      if (type === "guidelines" || type === "processes") continue;
      // (3, join) mutated: a same-session edit matched a specific glob.
      let mutated = false;
      for (const p of editPaths) {
        if (matchesRelevancePath(p, specificGlobs)) {
          mutated = true;
          break;
        }
      }
      if (!mutated) continue;
      count += 1;
      qualifiedIds.add(id);
    }
  }
  return { count, ids: [...qualifiedIds].sort() };
}

// v2.0.0-rc.39 (P1 emit-fold reader merge): empty-shell assistant_turn_observed
// turns no longer hit events.jsonl — the fabric-hint Stop hook (and the one-time
// doctor --fix purge) fold them into metrics.jsonl counter rows keyed
// `assistant_turn_observed[:<client>]`. To keep total_turns byte-for-byte
// invariant across the fold, the live cite-coverage / emit-cadence readers add
// these counters back. This helper sums the in-window folded turns, honouring
// the same client + `[since, until)` window semantics the raw-turn loop applies.
//
// Window: a row counts when `since <= row.ts (< until)`. The fold writer stamps
// each row with a ts inside the original turns' day (min ts of the folded
// group), so day-level windowing matches the raw-event filter exactly for any
// since/until that does not bisect a folded group's day — the real corpora keep
// all folded empties strictly inside the live window, so this is exact.
//
// Client filter mirrors filteredTurns: 'all' sums every namespace (incl. the
// bare, client-undefined key); a specific client sums ONLY that client's
// namespaced key (a bare-key fold has no client discriminator, exactly as a
// client-undefined raw turn is excluded from a narrowed query).
const ASSISTANT_TURN_COUNTER_PREFIX = "assistant_turn_observed";
export function sumFoldedTurnCounters(
  rows: MetricsRow[],
  options: { since: number; until?: number; client: "cc" | "codex" | "all" },
): number {
  let sum = 0;
  for (const row of rows) {
    const ts = Date.parse(row.timestamp);
    if (!Number.isFinite(ts)) continue;
    if (ts < options.since) continue;
    if (options.until !== undefined && ts >= options.until) continue;
    for (const [key, value] of Object.entries(row.counters)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      let matches = false;
      if (options.client === "all") {
        matches = key === ASSISTANT_TURN_COUNTER_PREFIX || key.startsWith(`${ASSISTANT_TURN_COUNTER_PREFIX}:`);
      } else {
        matches = key === `${ASSISTANT_TURN_COUNTER_PREFIX}:${options.client}`;
      }
      if (matches) sum += value;
    }
  }
  return sum;
}

// v2.0.0-rc.20 TASK-06: Real cite-coverage report. Single readEventLedger pass
// (event-type filter is intentionally omitted so the discriminated-union
// partitioning happens in a single for-loop, per the buildLastActiveIndex
// structural twin at L2885). Aggregates five metrics:
//
//   - total_turns:           assistant_turn_observed in window (filtered by
//                            client when options.client !== 'all').
//   - qualifying_cites:      cite_tags === 'applied' (rc.37 2-state vocab; the
//                            legacy planned/recalled/chained-from are remapped
//                            to 'applied' on read — see ADJ-P4-1).
//   - recalled_unverified:   'applied' tag with no knowledge_body_read in the
//                            same session within ±60s (the [applied]
//                            verification-obligation check; field name retained
//                            for report-contract stability). KT-DEC-0030: the
//                            verification signal migrated from the retired MCP
//                            knowledge_sections_fetched to the native-Read
//                            knowledge_body_read — the [applied] obligation is
//                            now "did the model actually open the body" (the
//                            funnel's planned → body_read → cite[applied] middle).
//   - edits_touched:         edit_intent_checked events in window.
//   - expected_but_missed:   edit_intent_checked whose path matches some kb
//                            entry's relevance_paths but no assistant_turn in
//                            the same session cited that kb_id.
//
// Narrow vs. broad denominator: per the cite-policy spec, narrow KBs
// (relevance_paths.length > 0) should only be expected when an edit touched
// a matching path; broad KBs are always-on. This shapes `expected_but_missed`:
// narrow KBs contribute only when a path-match exists, broad KBs are not
// counted here (they never produce 'missed' — they are by definition always
// in scope, so the qualifying_cites/total_turns ratio is the broad signal).
//
// Performance: O(N events + M turns × cite_ids + E edits × K narrow_kbs).
// For typical ledgers (<10k events, <100 narrow kbs) this stays well under
// 100ms — matches the buildLastActiveIndex envelope.
export async function runDoctorCiteCoverage(
  projectRoot: string,
  options: {
    since: number;
    client: "cc" | "codex" | "all";
    // v2.0.0-rc.24 TASK-08: layer filter for personal-layer parity. Optional
    // — defaults to 'all' so the CLI rc.20 surface (which has not yet wired
    // --layer; TASK-10 owns that change) keeps working byte-for-byte.
    layer?: "team" | "personal" | "all";
    // rc.39: optional exclusive upper bound (ms). When set, only events with
    // ts < until are aggregated. Additive — omitting it preserves byte-for-byte
    // behaviour. Used by the cite-audit rollup to compute a single UTC-day
    // window {since: dayStart, until: dayEnd} by reusing this exact aggregation
    // (no duplicate metric logic that could drift from the live report).
    until?: number;
    // v2.1 ⑤ cite-redesign (P5): how far back (ms) an in-session fab_recall
    // counts as "informing" a subsequent edit for the recall-based口径.
    // Default 30min (mirrors cite_recall_window_minutes default). 0 = unbounded.
    recallWindowMs?: number;
  },
): Promise<CiteCoverageReport> {
  const layerFilter = options.layer ?? "all";
  // v2.1 ⑤: recall→edit correlation window. Default 30min; 0 = unbounded.
  const recallWindowMs =
    typeof options.recallWindowMs === "number" && options.recallWindowMs >= 0
      ? options.recallWindowMs
      : 30 * 60_000;
  const marker = await ensureCitePolicyActivatedMarker(projectRoot);
  // v2.0.0-rc.24 TASK-08: contract marker (independent audit window from the
  // rc.20 cite_policy_activated marker — see plan B4). The drift gate inside
  // ensureCiteContractPolicyActivatedMarker bridges the rc.23→rc.24
  // half-upgrade window: when `.fabric/AGENTS.md` does NOT byte-equal the
  // canonical bootstrap body for any locale we refuse activation, so contract
  // metrics surface as 'skipped:bootstrap_drift' until the user reruns
  // `fabric install`.
  const contractMarker = await ensureCiteContractPolicyActivatedMarker(projectRoot);
  // v2.2 W5 R6 (读侧 cutover): id→knowledge_type map built from the read-set
  // STORES (cross-store on-the-fly), replacing the retired co-location
  // loadKbIdTypeMap(agents.meta). Indexed under BOTH the local stable_id and the
  // store-qualified id so a cite line in either form resolves. Walked once per
  // invocation — typical corpora <200 entries so <5ms, no caching needed. An
  // empty read-set collapses every cite into the cite_id_unresolved bucket,
  // which is the correct degraded mode.
  const canonicalEntries = await collectStoreCanonicalEntries(projectRoot);
  const idTypeMap = new Map<string, string>();
  for (const entry of canonicalEntries) {
    const kt = entry.description.knowledge_type;
    if (typeof kt !== "string" || kt.length === 0) continue;
    idTypeMap.set(entry.stableId, kt);
    idTypeMap.set(entry.qualifiedId, kt);
  }
  const generatedAt = new Date().toISOString();
  const zeroMetrics: CiteCoverageReport["metrics"] = {
    edits_touched: 0,
    qualifying_cites: 0,
    recalled_unverified: 0,
    expected_but_missed: 0,
    total_turns: 0,
  };

  // Contract-metrics status discriminator. Resolved here (before any ledger
  // I/O) so all early-return branches can attach the same zeroed contract
  // shape — the CLI renderer never has to optional-chain.
  const contractStatus: "ok" | "skipped:bootstrap_drift" | "awaiting_marker" =
    contractMarker.blocked_by === "bootstrap_drift"
      ? "skipped:bootstrap_drift"
      : contractMarker.marker_ts === 0
        ? "awaiting_marker"
        : "ok";
  const zeroContractMetrics: CiteContractMetrics = {
    decisions_cited: 0,
    pitfalls_cited: 0,
    contract_with: 0,
    contract_missing: 0,
    hard_violated: 0,
    cite_id_unresolved: 0,
    skip_count: {},
  };
  const zeroLayerType: CiteLayerTypeBreakdown = {
    team: {},
    personal: {},
  };

  if (marker.marker_ts === 0) {
    return {
      status: "skipped",
      marker_ts: 0,
      marker_emitted_now: false,
      since_ts: options.since,
      client_filter: options.client,
      layer_filter: layerFilter,
      metrics: zeroMetrics,
      contract_metrics_status: contractStatus,
      contract_metrics: zeroContractMetrics,
      per_layer_type: zeroLayerType,
      contract_marker_ts: contractMarker.marker_ts,
      generated_at: generatedAt,
    };
  }

  // effectiveSince anchors the window at the policy marker — observations
  // recorded before the policy activated are not coverable under it.
  const effectiveSince = Math.max(marker.marker_ts, options.since);

  // v2.0.0-rc.24 TASK-08: contract metrics open their OWN audit window — the
  // rc.20 marker (which gates qualifying_cites/recalled_unverified) is
  // intentionally NOT used here. When contractStatus !== 'ok', this bound
  // stays at Infinity (no event qualifies). Otherwise we take max with the
  // user's `since` so --since narrows both windows symmetrically.
  const contractEffectiveSince = contractStatus === "ok"
    ? Math.max(contractMarker.marker_ts, options.since)
    : Number.POSITIVE_INFINITY;

  // Single ledger pass — collect ALL events in window, partition by type.
  let ledgerEvents: EventLedgerEvent[] = [];
  try {
    const result = await readEventLedger(projectRoot, { since: effectiveSince });
    // rc.39: apply optional exclusive upper bound for single-day rollup windows.
    ledgerEvents = options.until === undefined
      ? result.events
      : result.events.filter((e) => e.ts < (options.until as number));
  } catch {
    // Degraded ledger — fall back to ok-with-zero rather than 'skipped' since
    // the marker is present. CLI renderer (TASK-07) surfaces zero metrics as
    // "no qualifying turns yet" which is the correct user-facing message.
    return {
      status: "ok",
      marker_ts: marker.marker_ts,
      marker_emitted_now: marker.emitted_now,
      since_ts: effectiveSince,
      client_filter: options.client,
      layer_filter: layerFilter,
      metrics: zeroMetrics,
      contract_metrics_status: contractStatus,
      contract_metrics: zeroContractMetrics,
      per_layer_type: zeroLayerType,
      contract_marker_ts: contractMarker.marker_ts,
      generated_at: generatedAt,
    };
  }

  type TurnEvent = Extract<EventLedgerEvent, { event_type: "assistant_turn_observed" }>;
  type EditEvent = Extract<EventLedgerEvent, { event_type: "edit_intent_checked" }>;
  // KT-DEC-0030: the [applied] verification signal is now the native-Read
  // knowledge_body_read marker (the retired knowledge_sections_fetched MCP event
  // is no longer emitted). Old ledgers still parse it; this report stops reading
  // it. `FetchEvent` keeps its name for blast-radius minimalism — it now carries
  // the body-read shape.
  type FetchEvent = Extract<EventLedgerEvent, { event_type: "knowledge_body_read" }>;
  // v2.1 ⑤ cite-redesign (P5): knowledge_context_planned is the recall event
  // (target_paths + final_stable_ids + session_id) — the recall→edit overlap
  // is the recall-based citation.
  type PlannedEvent = Extract<EventLedgerEvent, { event_type: "knowledge_context_planned" }>;
  // v2.2.0-rc.1 W1-T3: narrow PreToolUse surface events feed the WEAK
  // exposed_and_mutated signal (condition 1).
  type HookSurfaceEvent = Extract<EventLedgerEvent, { event_type: "hook_surface_emitted" }>;
  // lifecycle-refactor W2-T4 (§5 row7/row2): PostToolUse `file_mutated` (the
  // authoritative mutation-completed marker) + SessionEnd `session_ended`
  // (funnel-closed boundary). New events, zero prior consumers — see plan.
  type FileMutatedEvent = Extract<EventLedgerEvent, { event_type: "file_mutated" }>;
  type SessionEndedEvent = Extract<EventLedgerEvent, { event_type: "session_ended" }>;
  const assistantTurns: TurnEvent[] = [];
  const editEvents: EditEvent[] = [];
  const fetchEvents: FetchEvent[] = [];
  const plannedEvents: PlannedEvent[] = [];
  const hookSurfaceEvents: HookSurfaceEvent[] = [];
  const fileMutatedEvents: FileMutatedEvent[] = [];
  const sessionEndedEvents: SessionEndedEvent[] = [];
  for (const event of ledgerEvents) {
    switch (event.event_type) {
      case "assistant_turn_observed":
        assistantTurns.push(event);
        break;
      case "edit_intent_checked":
        editEvents.push(event);
        break;
      case "knowledge_body_read":
        fetchEvents.push(event);
        break;
      case "knowledge_context_planned":
        plannedEvents.push(event);
        break;
      case "hook_surface_emitted":
        hookSurfaceEvents.push(event);
        break;
      case "file_mutated":
        fileMutatedEvents.push(event);
        break;
      case "session_ended":
        sessionEndedEvents.push(event);
        break;
      default:
        break;
    }
  }

  // v2.1 ⑤: per-session recall index for the recall-based口径. Each session maps
  // to its knowledge_context_planned events (ts + target_paths), ts-ascending.
  const plannedBySession = new Map<string, { ts: number; target_paths: readonly string[] }[]>();
  for (const planned of plannedEvents) {
    const sid = planned.session_id;
    if (typeof sid !== "string" || sid.length === 0) continue;
    const list = plannedBySession.get(sid) ?? [];
    list.push({ ts: planned.ts, target_paths: planned.target_paths ?? [] });
    plannedBySession.set(sid, list);
  }
  for (const list of plannedBySession.values()) {
    list.sort((a, b) => a.ts - b.ts);
  }

  // Apply client filter to assistant turns (edit/fetch events are not
  // client-scoped — they originate from the hook layer regardless of which
  // assistant produced the upstream turn).
  const filteredTurns = options.client === "all"
    ? assistantTurns
    : assistantTurns.filter((t) => t.client === options.client);

  // Cross-client denominator guard. Edit events carry no `client` field, so a
  // naive walk would let codex-session edits inflate edits_touched and trigger
  // expected_but_missed against a cc-filtered cited-kb map that never had a
  // chance to populate (its source turns were filtered out). We rebuild a set
  // of session_ids whose turns include at least one matching-client turn from
  // the UNFILTERED assistant turn list, then gate the edit loop on it. When
  // the client filter is 'all', this set stays null and every edit counts.
  let clientSessionIds: Set<string> | null = null;
  if (options.client !== "all") {
    clientSessionIds = new Set<string>();
    for (const turn of assistantTurns) {
      if (turn.client === options.client) {
        const sid = turn.session_id;
        if (typeof sid === "string" && sid.length > 0) {
          clientSessionIds.add(sid);
        }
      }
    }
  }

  // Build kb index from agents.meta.json. Map stable_id → relevance metadata.
  // A missing meta file (fresh project, doctor pre-init) collapses to an empty
  // index — narrow denominator becomes zero, broad logic still functions on
  // turn data alone.
  type KbEntry = { relevance_paths: readonly string[]; relevance_scope: "narrow" | "broad" };
  const kbIndex = new Map<string, KbEntry>();
  // v2.2 W5 R6 (读侧 cutover): build the kb relevance index from the read-set
  // STORES (cross-store on-the-fly) instead of the retired co-location
  // agents.meta nodes. Index under BOTH the local stable_id and the
  // store-qualified id (`<alias>:<id>`) so a cite line in either form (bare or
  // store-qualified per the v2.1 multi-store cite policy) resolves to the same
  // relevance metadata. An empty read-set collapses to an empty index — the
  // narrow denominator becomes zero, broad logic still functions on turn data.
  // Reverse map: each distinct KbEntry → the set of index keys (local +
  // qualified) that point at it. Lets the expected_but_missed walk treat the
  // entry as a single unit — count it once and suppress when a cite used EITHER
  // of its keys.
  const kbEntryKeys = new Map<KbEntry, string[]>();
  for (const entry of canonicalEntries) {
    const paths = entry.description.relevance_paths ?? [];
    const scope = entry.description.relevance_scope ?? "broad";
    const kbEntry: KbEntry = {
      relevance_paths: paths,
      // A broad entry with no paths is the safe default. A narrow entry must
      // carry at least one path; an empty-paths narrow is treated as broad.
      relevance_scope: scope === "narrow" && paths.length > 0 ? "narrow" : "broad",
    };
    kbIndex.set(entry.stableId, kbEntry);
    kbIndex.set(entry.qualifiedId, kbEntry);
    kbEntryKeys.set(kbEntry, [entry.stableId, entry.qualifiedId]);
  }

  // Per-session lookup of fetch events for recalled_unverified correlation.
  // Key: session_id, Value: sorted timestamps of fetch events in that session.
  const fetchesBySession = new Map<string, number[]>();
  for (const fetch of fetchEvents) {
    const sid = fetch.session_id;
    if (typeof sid !== "string" || sid.length === 0) continue;
    const list = fetchesBySession.get(sid) ?? [];
    list.push(fetch.ts);
    fetchesBySession.set(sid, list);
  }
  for (const list of fetchesBySession.values()) {
    list.sort((a, b) => a - b);
  }
  const RECALL_WINDOW_MS = 60_000;
  const isRecallVerified = (turn: TurnEvent): boolean => {
    const sid = turn.session_id;
    if (typeof sid !== "string" || sid.length === 0) return false;
    const fetches = fetchesBySession.get(sid);
    if (fetches === undefined || fetches.length === 0) return false;
    for (const ft of fetches) {
      if (Math.abs(ft - turn.ts) <= RECALL_WINDOW_MS) return true;
    }
    return false;
  };

  // Aggregation pass — single sweep over filtered turns. Build both the
  // top-level metrics and per-client buckets in one walk.
  const dismissedHistogram: Record<string, number> = {};
  // v2.0.0-rc.23 TASK-08(c): `KB: none` sentinel breakdown. Keyed by
  // 'no-relevant' / 'not-applicable' / 'unspecified'.
  const noneHistogram: Record<string, number> = {};
  const perClientAccum = new Map<string, CiteCoverageReport["metrics"]>();
  const emptyMetrics = (): CiteCoverageReport["metrics"] => ({
    edits_touched: 0,
    qualifying_cites: 0,
    recalled_unverified: 0,
    expected_but_missed: 0,
    total_turns: 0,
  });
  const bumpClient = (client: string | undefined, mut: (m: CiteCoverageReport["metrics"]) => void): void => {
    if (typeof client !== "string" || client.length === 0) return;
    const existing = perClientAccum.get(client) ?? emptyMetrics();
    mut(existing);
    perClientAccum.set(client, existing);
  };

  // session_id → Set<cite_id> for expected_but_missed correlation.
  const sessionCitedKbs = new Map<string, Set<string>>();

  // v2.2.0-rc.1 W1-T3: session_id → Set<cite_id> that were [dismissed] this
  // session — condition (3) of the WEAK exposed_and_mutated signal. Populated
  // index-aligned (cite_tags[i] ⋈ cite_ids[i]) in the turn loop below.
  const dismissedBySession = new Map<string, Set<string>>();

  // v2.0.0-rc.24 TASK-08: per-session edit-path index for contract operator
  // evaluation. Built once from the edit events partition; reused across the
  // turn loop. Each session maps to its observed edit paths (normalized).
  const sessionEditPaths = new Map<string, string[]>();
  for (const edit of editEvents) {
    const sid = edit.session_id;
    if (typeof sid !== "string" || sid.length === 0) continue;
    const list = sessionEditPaths.get(sid) ?? [];
    list.push(normalizePath(edit.path));
    sessionEditPaths.set(sid, list);
  }

  // v2.0.0-rc.24 TASK-08: contract accumulators.
  let decisionsCited = 0;
  let pitfallsCited = 0;
  let contractWith = 0;
  let contractMissing = 0;
  let hardViolated = 0;
  let citeIdUnresolved = 0;
  const skipCount: Record<string, number> = {};
  const layerTypeAccum: CiteLayerTypeBreakdown = { team: {}, personal: {} };
  const bumpLayerType = (citeId: string, type: string): void => {
    const layer = citeId.startsWith("KP-") ? "personal" : citeId.startsWith("KT-") ? "team" : null;
    if (layer === null) return;
    layerTypeAccum[layer][type] = (layerTypeAccum[layer][type] ?? 0) + 1;
  };
  // Layer filter helper — decides whether a cite_id contributes to the
  // top-level rc.20 metrics (qualifying_cites etc.) AND to the contract
  // accumulators. Edits don't carry layer info (they describe filesystem
  // paths, not knowledge entries) so edits are NOT layer-filtered. Cites
  // with neither KP-/KT- prefix (rare/legacy) pass through under 'all' but
  // are dropped under any narrowed filter — conservative.
  const passesLayerFilter = (citeId: string): boolean => {
    if (layerFilter === "all") return true;
    if (layerFilter === "team") return citeId.startsWith("KT-");
    return citeId.startsWith("KP-");
  };

  // Operator-vs-edits comparator. session_id is required to evaluate edits;
  // a turn lacking a session_id is treated as having NO observable edits,
  // which means edit:/not_edit: operators violate on edit: and pass on
  // not_edit:. This matches the conservative "no evidence the edit
  // happened" interpretation.
  //
  // require:/forbid: operator vs diff content: the edit_intent_checked
  // event schema (event-ledger.ts L53-L68) carries no full diff content —
  // only path / compliant / intent / optional diff_stat (numeric summary)
  // / optional annotation. We therefore SCOPE the require:/forbid: check
  // to "<symbol present in any changed file PATH>" — a strict downgrade
  // from the planned diff-content match, documented in TASK-08 summary so
  // TASK-09 i18n can label this honestly. If a future rc widens the
  // ledger schema to carry the textual diff, only this comparator function
  // changes.
  const evaluateOperatorViolation = (
    sessionId: string | undefined,
    operators: ReadonlyArray<{ kind: "edit" | "not_edit" | "require" | "forbid"; target: string }>,
  ): boolean => {
    const editPaths = (typeof sessionId === "string" && sessionId.length > 0)
      ? (sessionEditPaths.get(sessionId) ?? [])
      : [];
    for (const op of operators) {
      switch (op.kind) {
        case "edit": {
          let matched = false;
          for (const p of editPaths) {
            if (minimatch(p, op.target, { dot: true, matchBase: false })) {
              matched = true;
              break;
            }
          }
          if (!matched) return true;
          break;
        }
        case "not_edit": {
          for (const p of editPaths) {
            if (minimatch(p, op.target, { dot: true, matchBase: false })) {
              return true;
            }
          }
          break;
        }
        case "require": {
          // Scoped to file-path symbol match (substring) — diff content not
          // available in ledger. Documented in TASK-08 summary.
          let found = false;
          for (const p of editPaths) {
            if (p.includes(op.target)) {
              found = true;
              break;
            }
          }
          if (!found) return true;
          break;
        }
        case "forbid": {
          for (const p of editPaths) {
            if (p.includes(op.target)) {
              return true;
            }
          }
          break;
        }
        default:
          break;
      }
    }
    return false;
  };

  let totalTurns = 0;
  let qualifyingCites = 0;
  let recalledUnverified = 0;

  // lifecycle-refactor W3-T4 (§2 store 轴 / store-qualified 观测): per-store
  // qualifying-cite accumulator. Keyed by the cite's `cite_stores[i]` qualifier;
  // a null/absent qualifier (project-local cite) buckets under "local". STRICTLY
  // a diagnostic split of qualifying_cites — it is built ALONGSIDE the qualifying
  // count and NEVER feeds the compliance numerator/denominator (honesty 铁律).
  const STORE_LOCAL_KEY = "local";
  const byStoreQualifying: Record<string, number> = {};

  for (const turn of filteredTurns) {
    totalTurns += 1;
    bumpClient(turn.client, (m) => {
      m.total_turns += 1;
    });

    const sid = turn.session_id;
    if (typeof sid === "string" && sid.length > 0) {
      const set = sessionCitedKbs.get(sid) ?? new Set<string>();
      for (const id of turn.cite_ids) {
        set.add(id);
      }
      sessionCitedKbs.set(sid, set);

      // v2.2.0-rc.1 W1-T3: record dismissed ids for the WEAK exposed_and_mutated
      // signal (condition 3). cite_tags[i] is index-aligned with cite_ids[i]
      // (same parallel-array convention the contract walk relies on). A
      // `dismissed`/`dismissed:<reason>` tag on a real id marks that id dismissed
      // this session. Bounds-checked: a trailing `KB: none` sentinel tag has no
      // matching cite_ids slot and is skipped.
      for (let i = 0; i < turn.cite_tags.length; i += 1) {
        const id = turn.cite_ids[i];
        if (typeof id !== "string" || id.length === 0) continue;
        if (categorizeCiteTag(turn.cite_tags[i]).category === "dismissed") {
          const dset = dismissedBySession.get(sid) ?? new Set<string>();
          dset.add(id);
          dismissedBySession.set(sid, dset);
        }
      }
    }

    // -------------------------------------------------------------------
    // rc.20 cite_tags walk (unchanged behavior — touch only if the
    // categorize/dismissed/none shape needs widening).
    // -------------------------------------------------------------------
    let turnHadApplied = false;
    for (const tag of turn.cite_tags) {
      const { category, reason } = categorizeCiteTag(tag);
      switch (category) {
        case "applied":
          qualifyingCites += 1;
          bumpClient(turn.client, (m) => {
            m.qualifying_cites += 1;
          });
          turnHadApplied = true;
          break;
        case "dismissed": {
          const key = reason ?? "unspecified";
          dismissedHistogram[key] = (dismissedHistogram[key] ?? 0) + 1;
          break;
        }
        case "none": {
          // v2.0.0-rc.23 TASK-08(c): parse sentinel tail from kb_line_raw and
          // bump the breakdown bucket. Bare `KB: none` → 'unspecified'.
          const sentinel = parseNoneSentinel(turn.kb_line_raw);
          noneHistogram[sentinel] = (noneHistogram[sentinel] ?? 0) + 1;
          break;
        }
        default:
          break;
      }
    }

    // lifecycle-refactor W3-T4 (§2 store 轴): per-store qualifying-cite split.
    // Walk cite_ids[i] ⋈ cite_tags[i] ⋈ cite_stores[i] (index-aligned by
    // construction — the cite-line-parser builds all three from the same primary
    // id group). An `applied` cite bumps its store bucket; a missing/ null
    // qualifier (local cite) buckets under "local". This stays SEPARATE from the
    // qualifying_cites total above and is never folded into compliance.
    const turnCiteStores = turn.cite_stores ?? [];
    for (let i = 0; i < turn.cite_ids.length; i += 1) {
      const tag = turn.cite_tags[i];
      if (categorizeCiteTag(typeof tag === "string" ? tag : "none").category !== "applied") continue;
      const rawStore = turnCiteStores[i];
      const storeKey = typeof rawStore === "string" && rawStore.length > 0 ? rawStore : STORE_LOCAL_KEY;
      byStoreQualifying[storeKey] = (byStoreQualifying[storeKey] ?? 0) + 1;
    }

    // v2.1.0-rc.1 (ADJ-P4-1): `recalled_unverified` retains its report-contract
    // name but now measures the rc.37 NEW-1 `[applied]` verification obligation
    // directly — an `applied` cite with no knowledge_body_read in the same
    // session within ±60s (KT-DEC-0030; legacy `recalled` is remapped to
    // `applied` on read).
    if (turnHadApplied && !isRecallVerified(turn)) {
      recalledUnverified += 1;
      bumpClient(turn.client, (m) => {
        m.recalled_unverified += 1;
      });
    }

    // -------------------------------------------------------------------
    // v2.0.0-rc.24 TASK-08: per-cite contract walk. Iterates index-aligned
    // (cite_ids[i], cite_commitments[i]). cite_tags is NOT index-aligned
    // with cite_ids (sentinel `KB: none` produces a cite_tags entry but no
    // cite_ids entry — see plan B3 and the cite_commitments parallel-array
    // doc on event-ledger.ts L424). Skipped entirely when the contract
    // marker has not been emitted (contractStatus !== 'ok').
    // -------------------------------------------------------------------
    if (contractStatus === "ok" && turn.ts >= contractEffectiveSince) {
      const commitments = turn.cite_commitments ?? [];
      for (let i = 0; i < turn.cite_ids.length; i += 1) {
        const citeId = turn.cite_ids[i];
        if (typeof citeId !== "string" || citeId.length === 0) continue;
        if (!passesLayerFilter(citeId)) continue;

        const kbType = idTypeMap.get(citeId);
        if (kbType === undefined) {
          // Hallucinated or pre-meta id — dedicated bucket so the user can
          // distinguish "AI made up an id" from "AI cited a real id without
          // an operator".
          citeIdUnresolved += 1;
          bumpLayerType(citeId, "unresolved");
          continue;
        }

        // Cross-tab by (layer, type) for every resolved cite, regardless of
        // bucket — this is the breakdown TASK-09's i18n renderer surfaces.
        bumpLayerType(citeId, kbType);

        // Plural knowledge_type enum (rc.29 BUG-C1 unification). Matching
        // against the canonical plural literals.
        if (kbType === "decisions" || kbType === "pitfalls") {
          if (kbType === "decisions") decisionsCited += 1;
          else pitfallsCited += 1;

          const commitment = commitments[i];
          // Missing commitment slot is equivalent to "lazy default" — no
          // operators, no skip. Counts as contract_missing.
          const operators = commitment?.operators ?? [];
          const skipReason = commitment?.skip_reason ?? null;

          if (skipReason !== null) {
            skipCount[skipReason] = (skipCount[skipReason] ?? 0) + 1;
            // skip:<reason> exits the contract_with/contract_missing
            // partition — operator is explicitly waived.
            continue;
          }

          if (operators.length === 0) {
            contractMissing += 1;
            continue;
          }

          contractWith += 1;
          if (evaluateOperatorViolation(sid, operators)) {
            hardViolated += 1;
          }
        }
        // model → reference-only (no contract check), already cross-tabbed.
        // guideline / process → deferred to rc.25 LLM-judge (no contract
        // check), already cross-tabbed.
      }
    }
  }

  // expected_but_missed: walk edit events, for each one find narrow kbs whose
  // relevance_paths cover the edit's path; if no assistant_turn in the same
  // session cited that kb, increment. Edits without a session_id cannot be
  // correlated and are skipped (conservative — better to under-count than to
  // raise false positives).
  let editsTouched = 0;
  let expectedButMissed = 0;
  // v2.0.0-rc.38 UX-8 (C, hardening): edits with no session_id can never be
  // correlated against assistant_turn cite lines, so they silently never reach
  // expected_but_missed. Surfacing the count turns the previous SILENT
  // undercount (a stale pre-session_id hook emits edits without session_id)
  // into a visible signal — exactly the confound that pinned compliance at a
  // misleading 100% for two prior closure attempts.
  let uncorrelatableEdits = 0;
  // v2.1 ⑤ cite-redesign (P5): recall-based coverage口径. An edit is
  // "recall-backed" when an in-session knowledge_context_planned with
  // overlapping target_paths preceded it within the recall window. Counted over
  // the SAME population as edits_touched (post client-filter, with session_id).
  let recallBackedEdits = 0;
  for (const edit of editEvents) {
    // Edit events have no `client` field; per-client edits_touched stays at 0
    // (per_client only tabulates assistant-side metrics — see comment block).
    // When a client filter is active, skip edits whose session never produced
    // a matching-client turn — otherwise cross-client edits pollute both the
    // edits_touched denominator and expected_but_missed (the session's
    // cited-kb map is empty under the filter, so every narrow match would
    // false-positive). Edits whose session_id is missing fall through to the
    // legacy conservative count when the filter is 'all', and are likewise
    // skipped under a narrowed filter (no way to attribute them).
    const sid = edit.session_id;
    const hasSid = typeof sid === "string" && sid.length > 0;
    // No session_id → uncorrelatable under ANY client filter. Count once.
    if (!hasSid) uncorrelatableEdits += 1;
    if (clientSessionIds !== null) {
      if (!hasSid) continue;
      if (!clientSessionIds.has(sid)) continue;
    }
    editsTouched += 1;
    if (!hasSid) continue;

    // v2.1 ⑤: recall-backed check. Scan this session's recalls for one that
    // (a) happened at-or-before this edit, (b) within the recall window
    // (recallWindowMs <= 0 = unbounded), and (c) targeted an overlapping path.
    const recalls = plannedBySession.get(sid);
    if (recalls !== undefined) {
      for (const recall of recalls) {
        if (recall.ts > edit.ts) break; // ts-ascending — no earlier match past here
        if (recallWindowMs > 0 && edit.ts - recall.ts > recallWindowMs) continue;
        if (recallPathOverlaps(edit.path, recall.target_paths)) {
          recallBackedEdits += 1;
          break;
        }
      }
    }

    const citedSet = sessionCitedKbs.get(sid) ?? new Set<string>();
    // v2.2 W5 R6/R2 (agents.meta decolo): the kb index keys every store entry
    // under BOTH its local stable_id and its store-qualified id (`<alias>:<id>`)
    // — both pointing at the SAME KbEntry object — so a cite line in either form
    // resolves. The expected_but_missed walk must therefore count each distinct
    // kb entry once per edit, not once per index key; track counted entries by
    // object identity to avoid the dual-key double-count. A cite in EITHER form
    // (citedSet may hold either key) suppresses the miss.
    const countedThisEdit = new Set<KbEntry>();
    for (const [, kb] of kbIndex) {
      if (kb.relevance_scope !== "narrow") continue;
      if (!matchesRelevancePath(edit.path, kb.relevance_paths)) continue;
      if (countedThisEdit.has(kb)) continue;
      countedThisEdit.add(kb);
      // Suppress the miss when a cite used EITHER of this entry's keys (local
      // stable_id or store-qualified id).
      const keys = kbEntryKeys.get(kb) ?? [];
      const citedInAnyForm = keys.some((k) => citedSet.has(k));
      if (!citedInAnyForm) {
        expectedButMissed += 1;
      }
    }
  }

  // recall→edit session-mismatch diagnostics: count in-window recalls, their
  // distinct sessions, and how many of those sessions also produced an edit. When
  // recalls happened but none share an edit session, recall_coverage's 0 is a
  // session_id-mismatch artifact (recall caller passed a non-client session_id),
  // not a recall-discipline gap — the surface uses this to self-diagnose.
  const editSessionIds = new Set<string>();
  for (const edit of editEvents) {
    if (typeof edit.session_id === "string" && edit.session_id.length > 0) {
      editSessionIds.add(edit.session_id);
    }
  }
  let recallsInWindow = 0;
  for (const list of plannedBySession.values()) recallsInWindow += list.length;
  let recallSessionsCorrelated = 0;
  for (const sid of plannedBySession.keys()) {
    if (editSessionIds.has(sid)) recallSessionsCorrelated += 1;
  }

  // v2.0.0-rc.38 UX-8 (C): cite-policy COMPLIANCE rate. Compliant = every valid
  // cite line: qualifying id-cites + ALL `KB: none [reason]` sentinels (the
  // policy permits the none sentinel as compliant). Non-compliant = turns where
  // a cite was expected but none was written (expected_but_missed). null when no
  // cite-expected turns exist (no compliant + no missed) → avoids 0/0 reading as
  // "0% compliant" when the AI simply had nothing to cite.
  const noneTotal = Object.values(noneHistogram).reduce((a, b) => a + b, 0);
  const compliantCites = qualifyingCites + noneTotal;
  const noncompliantCites = expectedButMissed;
  const complianceDenom = compliantCites + noncompliantCites;
  const citeComplianceRate = complianceDenom > 0 ? compliantCites / complianceDenom : null;

  // v2.1 ⑤: recall-based coverage rate over the correlatable edit population.
  const recallCoverageRate = editsTouched > 0 ? recallBackedEdits / editsTouched : null;

  // v2.2.0-rc.1 W1-T3 (cite 诚实拆分 / lifecycle §3): compute the WEAK
  // exposed_and_mutated signal — STRICTLY SEPARATE from cite_compliance_rate.
  // Build narrowSurfacedBySession from the narrow PreToolUse hook_surface_emitted
  // events (condition 1), then delegate the three-condition filter to
  // computeExposedAndMutated. This object is attached to metrics as its OWN field
  // and never feeds the compliance numerator/denominator above.
  const narrowSurfacedBySession = new Map<string, Set<string>>();
  for (const surface of hookSurfaceEvents) {
    if (surface.hook_name !== "knowledge-hint-narrow") continue;
    if (surface.delivery_status !== "delivered") continue;
    const sid = surface.session_id;
    if (typeof sid !== "string" || sid.length === 0) continue;
    const set = narrowSurfacedBySession.get(sid) ?? new Set<string>();
    for (const id of surface.rendered_ids) {
      if (typeof id === "string" && id.length > 0) set.add(id);
    }
    narrowSurfacedBySession.set(sid, set);
  }
  const exposedAndMutated = computeExposedAndMutated({
    narrowSurfacedBySession,
    dismissedBySession,
    editPathsBySession: sessionEditPaths,
    kbIndex,
    idTypeMap,
  });

  // lifecycle-refactor W2-T4 (§5 row7 PostToolUse mutation funnel + mutation_pool
  // downgrade / §0 下沉 doctor): consume the new `file_mutated` PostToolUse marker
  // OFFLINE here (前台 hook only O(1)-appended it). This rebuild is strictly
  // ADDITIVE — it stands ALONGSIDE the W1-T3 exposed_and_mutated join and the
  // edit_intent_checked `edits_touched` count, touching NEITHER. Three derived
  // signals:
  //   - mutations_observed.count: distinct `file_mutated` events (dedup on
  //     tool_call_id, the per-call key that pairs Pre/Post and guards the
  //     PostToolUse parallel-fire race). This is the AUTHORITATIVE
  //     mutation-COMPLETED count, vs the PreToolUse edit-INTENT `edits_touched`.
  //   - mutation_pool.attributed: a file_mutated whose `source_event_id` resolves
  //     to a `hook_surface_emitted` (surfaced knowledge) in window. Attribution
  //     key = store_id + stable_id + source_event_id (distinct-dedup'd so
  //     multi-store never double-counts the same surfaced id).
  //   - mutation_pool.unattributed_workspace_dirty: every file_mutated that does
  //     NOT attribute (no source_event_id, or a source_event_id that resolves to
  //     no surfaced event). §9 git-diff fallback to upgrade these via a session
  //     shell event + baseline is SPECULATIVE and deliberately NOT implemented —
  //     doctor stays read-only (no git diff / no disk write); the events.jsonl
  //     source_event_id link is the sole attribution path here.
  //     TODO(§9 future): git-diff + session shell baseline fallback to reclaim
  //     unattributed_workspace_dirty into fallback-attributed. Out of scope (W2-T4
  //     keeps doctor read-only).
  // surfacedEventIds: the envelope `id` of every hook_surface_emitted in window —
  // the link target of file_mutated.source_event_id. surfacedIdsByEvent maps that
  // event id → its rendered_ids (the stable_ids surfaced), used to build the
  // distinct attribution key.
  const surfacedIdsByEvent = new Map<string, readonly string[]>();
  for (const surface of hookSurfaceEvents) {
    surfacedIdsByEvent.set(surface.id, surface.rendered_ids);
  }
  const seenMutationKeys = new Set<string>(); // tool_call_id dedup
  const attributionKeys = new Set<string>(); // store_id|stable_id|source_event_id
  let mutationsObserved = 0;
  let unattributedWorkspaceDirty = 0;
  for (const mutation of fileMutatedEvents) {
    // Distinct mutation count keyed by tool_call_id (per-call key). A repeated
    // tool_call_id (e.g. a duplicated append on retry) collapses to one.
    if (seenMutationKeys.has(mutation.tool_call_id)) continue;
    seenMutationKeys.add(mutation.tool_call_id);
    mutationsObserved += 1;

    const sourceEventId = mutation.source_event_id;
    const surfacedRenderedIds =
      typeof sourceEventId === "string" && sourceEventId.length > 0
        ? surfacedIdsByEvent.get(sourceEventId)
        : undefined;
    if (surfacedRenderedIds === undefined || surfacedRenderedIds.length === 0) {
      // No source_event_id, or it links to no surfaced event → low confidence.
      unattributedWorkspaceDirty += 1;
      continue;
    }
    // Attributed: register one distinct attribution key per surfaced stable_id.
    // store_id is optional (single-store default) — collapse undefined to "" so
    // the key stays stable; the triple still prevents cross-store double-count
    // when store_id IS present.
    const storeId = mutation.store_id ?? "";
    for (const stableId of surfacedRenderedIds) {
      if (typeof stableId !== "string" || stableId.length === 0) continue;
      attributionKeys.add(`${storeId}|${stableId}|${sourceEventId}`);
    }
  }
  const mutationPoolAttributed = attributionKeys.size;

  // lifecycle-refactor W2-T4 (§5 row2 SessionEnd funnel-closed boundary): count
  // distinct sessions that appended a `session_ended` marker. Pure observability
  // boundary — never joined into any rate. Falls back to the event id when an
  // event carries no session_id (degraded marker) so each marker still counts.
  const closedSessions = new Set<string>();
  for (const ended of sessionEndedEvents) {
    const sid =
      typeof ended.session_id === "string" && ended.session_id.length > 0
        ? ended.session_id
        : ended.id;
    closedSessions.add(sid);
  }

  const metrics: CiteCoverageReport["metrics"] = {
    edits_touched: editsTouched,
    qualifying_cites: qualifyingCites,
    recalled_unverified: recalledUnverified,
    expected_but_missed: expectedButMissed,
    total_turns: totalTurns,
    cite_compliance_rate: citeComplianceRate,
    compliant_cites: compliantCites,
    noncompliant_cites: noncompliantCites,
    uncorrelatable_edits: uncorrelatableEdits,
    recall_backed_edits: recallBackedEdits,
    recall_coverage_rate: recallCoverageRate,
    recall_diagnostics: {
      recalls_in_window: recallsInWindow,
      recall_sessions: plannedBySession.size,
      recall_sessions_correlated: recallSessionsCorrelated,
    },
    exposed_and_mutated: {
      count: exposedAndMutated.count,
      ...(exposedAndMutated.ids.length > 0 ? { ids: exposedAndMutated.ids } : {}),
    },
    // lifecycle-refactor W2-T4: PostToolUse mutation funnel (own fields, NEVER
    // folded into cite_compliance_rate — honesty 铁律).
    mutations_observed: { count: mutationsObserved },
    mutation_pool: {
      attributed: mutationPoolAttributed,
      unattributed_workspace_dirty: unattributedWorkspaceDirty,
    },
    sessions_closed: { count: closedSessions.size },
    // lifecycle-refactor W3-T4 (§2 store 轴): per-store qualifying-cite breakdown.
    // Diagnostic split of qualifying_cites only — never touches compliance.
    // Omitted when no cite was observed (empty map → no field).
    ...(Object.keys(byStoreQualifying).length > 0
      ? {
          by_store: Object.fromEntries(
            Object.entries(byStoreQualifying).map(([store, count]) => [store, { qualifying_cites: count }]),
          ),
        }
      : {}),
  };

  // rc.39: merge cite-audit rollup days into the totals. Rolled-up turns were
  // physically dropped from the raw ledger, so rollup rows and the raw metrics
  // above are temporally DISJOINT — summing is exact, no double-count. Gated on
  // `options.until === undefined` so the per-day rollup-computation calls (which
  // always set `until`) never recursively merge prior rollup rows into
  // themselves. With the default 7d window no rollup row qualifies (cutoff ≥ 7d),
  // so the common-case report stays byte-for-byte identical.
  let rollupDaysMerged = 0;
  let rollupTrend: CiteRollupRow[] | undefined;
  if (options.until === undefined) {
    let rollupRows: CiteRollupRow[] = [];
    try {
      rollupRows = await readCiteRollup(projectRoot);
    } catch {
      rollupRows = [];
    }
    const inWindow = rollupRows.filter((r) => utcDayBounds(r.date).end > effectiveSince);
    if (inWindow.length > 0) {
      rollupTrend = inWindow;
      rollupDaysMerged = inWindow.length;
      for (const r of inWindow) {
        metrics.total_turns += r.metrics.total_turns;
        metrics.qualifying_cites += r.metrics.qualifying_cites;
        metrics.recalled_unverified += r.metrics.recalled_unverified;
        metrics.expected_but_missed += r.metrics.expected_but_missed;
        metrics.edits_touched += r.metrics.edits_touched;
        metrics.compliant_cites = (metrics.compliant_cites ?? 0) + (r.metrics.compliant_cites ?? 0);
        metrics.noncompliant_cites =
          (metrics.noncompliant_cites ?? 0) + (r.metrics.noncompliant_cites ?? 0);
        metrics.uncorrelatable_edits =
          (metrics.uncorrelatable_edits ?? 0) + (r.metrics.uncorrelatable_edits ?? 0);
        // v2.1 ⑤: recall-backed edits are disjoint per day, so summing is exact.
        metrics.recall_backed_edits =
          (metrics.recall_backed_edits ?? 0) + (r.metrics.recall_backed_edits ?? 0);
      }
      const mergedDenom = (metrics.compliant_cites ?? 0) + (metrics.noncompliant_cites ?? 0);
      metrics.cite_compliance_rate = mergedDenom > 0 ? (metrics.compliant_cites ?? 0) / mergedDenom : null;
      // v2.1 ⑤: recompute recall coverage over the merged edit population.
      metrics.recall_coverage_rate =
        metrics.edits_touched > 0 ? (metrics.recall_backed_edits ?? 0) / metrics.edits_touched : null;
    }

    // rc.39 emit-fold: add the folded empty-shell turns back into total_turns.
    // Same gate as the rollup merge (only the live report, never the per-day
    // until-bounded rollup-computation calls — those aggregate raw events only,
    // and the live reader adds the folded counters once). Empty shells carry
    // zero cite signal, so they touch ONLY total_turns: compliance
    // (compliant/(compliant+noncompliant)) and every other metric are unchanged.
    // per_client is intentionally left raw-event-only here, mirroring the rollup
    // merge above which also updates top-level metrics only.
    try {
      const metricsRows = await readMetrics(projectRoot);
      const foldedTurns = sumFoldedTurnCounters(metricsRows, {
        since: effectiveSince,
        client: options.client,
      });
      metrics.total_turns += foldedTurns;
    } catch {
      // metrics.jsonl is best-effort observability — a read failure degrades to
      // "no folded turns" rather than throwing (consistent with readCiteRollup).
    }
  }

  // per_client breakdown is only emitted when client filter is 'all' — for a
  // narrowed query the top-level metrics already represent that client and a
  // single-entry record would be redundant noise.
  let perClient: CiteCoverageReport["per_client"];
  if (options.client === "all" && perClientAccum.size > 0) {
    perClient = {};
    for (const [client, m] of perClientAccum) {
      perClient[client] = m;
    }
  }

  const contractMetrics: CiteContractMetrics = {
    decisions_cited: decisionsCited,
    pitfalls_cited: pitfallsCited,
    contract_with: contractWith,
    contract_missing: contractMissing,
    hard_violated: hardViolated,
    cite_id_unresolved: citeIdUnresolved,
    skip_count: skipCount,
  };

  return {
    status: "ok",
    marker_ts: marker.marker_ts,
    marker_emitted_now: marker.emitted_now,
    since_ts: effectiveSince,
    client_filter: options.client,
    layer_filter: layerFilter,
    metrics,
    ...(perClient !== undefined ? { per_client: perClient } : {}),
    ...(Object.keys(dismissedHistogram).length > 0 ? { dismissed_reason_histogram: dismissedHistogram } : {}),
    ...(Object.keys(noneHistogram).length > 0 ? { none_reason_histogram: noneHistogram } : {}),
    contract_metrics_status: contractStatus,
    contract_metrics: contractMetrics,
    per_layer_type: layerTypeAccum,
    contract_marker_ts: contractMarker.marker_ts,
    generated_at: generatedAt,
    ...(rollupDaysMerged > 0 ? { rollup_days_merged: rollupDaysMerged, rollup_trend: rollupTrend } : {}),
  };
}

// ---------------------------------------------------------------------------
// v2.0.0-rc.39: cite-audit rollup
// ---------------------------------------------------------------------------
//
// assistant_turn_observed dominates events.jsonl (~96% in heavy dogfood). Each
// turn carries a cite audit payload that cite-coverage reads, but once a turn is
// older than the cite window it is dead weight in the main ledger. This pass
// rolls every such turn's day into ONE cite-rollup.jsonl row (computed by
// replaying runDoctorCiteCoverage over a single-UTC-day window — same metric
// logic as the live report, no drift) then DROPS the rolled-up turns from the
// main ledger (archived to events.archive/, never deleted). Net effect: the
// main ledger stays bounded near the cite window while the long-range compliance
// trend survives as compact daily rows.
//
// Only assistant_turn_observed is rolled/dropped — every other (low-volume)
// event stays in the ledger untouched. The per-day metrics are computed BEFORE
// the drop, while turns + edit_intent_checked + knowledge_body_read are
// all still present, so correlation-based metrics (expected_but_missed etc.)
// stay correct (modulo sessions that straddle a UTC midnight — an accepted
// observability approximation, not exact accounting).
export type CiteRollupResult = {
  days_rolled_up: number;
  turns_dropped: number;
  cutoff_ts: number;
};

export async function rollupCiteAuditIfNeeded(
  projectRoot: string,
  opts: { cutoffDays?: number; now?: Date } = {},
): Promise<CiteRollupResult> {
  const now = opts.now ?? new Date();
  // Default cutoff mirrors the cite-coverage default window (7d): turns younger
  // than this stay raw so the live report is unaffected; older ones roll up.
  const cutoffDays = typeof opts.cutoffDays === "number" && opts.cutoffDays >= 0 ? opts.cutoffDays : 7;
  const cutoffMs = now.getTime() - cutoffDays * 86_400_000;

  // Find the distinct UTC days that have at least one rollable turn.
  let events: EventLedgerEvent[] = [];
  try {
    const result = await readEventLedger(projectRoot);
    events = result.events;
  } catch {
    return { days_rolled_up: 0, turns_dropped: 0, cutoff_ts: cutoffMs };
  }
  const days = new Set<string>();
  let rollableTurns = 0;
  for (const e of events) {
    if (e.event_type === "assistant_turn_observed" && e.ts < cutoffMs) {
      days.add(utcDayKey(e.ts));
      rollableTurns += 1;
    }
  }
  if (rollableTurns === 0) {
    return { days_rolled_up: 0, turns_dropped: 0, cutoff_ts: cutoffMs };
  }

  // One rollup row per day — reuse runDoctorCiteCoverage with a single-day
  // {since, until} window so the stored metrics are byte-identical to what the
  // live report would have produced for that day.
  let daysRolledUp = 0;
  const rolledDays = new Set<string>();
  for (const date of [...days].sort()) {
    const { start, end } = utcDayBounds(date);
    // Boundary day is split at the exact cutoff ms: only turns that will be
    // DROPPED (ts < cutoffMs) belong in the rollup row, so raw + rollup stay
    // disjoint and the Task-4 merge can sum them without double-counting.
    const report = await runDoctorCiteCoverage(projectRoot, {
      since: start,
      until: Math.min(end, cutoffMs),
      client: "all",
    });
    // A day that cannot be rolled up (no cite-policy marker → status 'skipped',
    // or zero coverable turns) is LEFT in the ledger — never silently drop a
    // turn whose cite signal was not captured. Such turns fall to the general
    // 30d rotation instead. This is the no-marker repo's safe path.
    if (report.status !== "ok" || report.metrics.total_turns === 0) continue;
    await appendCiteRollupRow(projectRoot, {
      date,
      generated_at: now.toISOString(),
      metrics: report.metrics,
    });
    rolledDays.add(date);
    daysRolledUp += 1;
  }

  if (rolledDays.size === 0) {
    return { days_rolled_up: 0, turns_dropped: 0, cutoff_ts: cutoffMs };
  }

  // Drop ONLY turns whose day was successfully rolled up (archived, not
  // deleted). Day-aware so un-rolled-up turns (pre-marker / skipped days) stay.
  const dropResult = await dropEventsFromLedger(projectRoot, {
    label: "cite-rolled",
    now,
    predicate: (parsed) =>
      parsed["event_type"] === "assistant_turn_observed" &&
      typeof parsed["ts"] === "number" &&
      (parsed["ts"] as number) < cutoffMs &&
      rolledDays.has(utcDayKey(parsed["ts"] as number)),
  });

  return {
    days_rolled_up: daysRolledUp,
    turns_dropped: dropResult.archivedCount,
    cutoff_ts: cutoffMs,
  };
}

// ---------------------------------------------------------------------------
// v2.0.0-rc.39 (P1 emit-fold, one-time backlog purge):
//
// The rc.39 hook folds NEW empty-shell turns at the source. This function folds
// the EXISTING backlog of empty-shell assistant_turn_observed events already
// sitting in events.jsonl (heavy dogfood repos accrued tens of thousands). It
// runs inside `doctor --fix` AFTER the cite-audit rollup (which sweeps every
// turn ≥7d, cite-bearing or empty), so this targets the live-window (<7d) empty
// shells the rollup intentionally leaves raw.
//
// Fold mechanism mirrors the hook: empties are tallied into metrics.jsonl
// counter rows keyed `assistant_turn_observed[:<client>]`, then dropped from the
// ledger (archived, never deleted). To keep cite-coverage total_turns invariant
// across the purge, each counter row is stamped with the MIN original ts of its
// (UTC-day, client) group: the reader's window filter (`ts >= effectiveSince`)
// then treats the folded group exactly as it treated the raw events, as long as
// the group's day does not straddle a window boundary — which holds because the
// rollup already removed everything ≥7d, leaving only recent days strictly
// inside the live window. The immediate cite-coverage re-check (dogfood
// verification) confirms the number is unchanged.
//
// Empty-shell predicate is identical to the hook's: no KB: line (kb_line_raw
// null/absent) AND no cite_ids AND no cite_commitments — i.e. zero cite signal.
export type EmptyShellPurgeResult = {
  turns_folded: number;
  groups_written: number;
};

function isEmptyShellTurn(parsed: Record<string, unknown>): boolean {
  if (parsed["event_type"] !== "assistant_turn_observed") return false;
  const kb = parsed["kb_line_raw"];
  if (kb !== null && kb !== undefined) return false;
  const citeIds = parsed["cite_ids"];
  if (Array.isArray(citeIds) && citeIds.length > 0) return false;
  const citeCommitments = parsed["cite_commitments"];
  if (Array.isArray(citeCommitments) && citeCommitments.length > 0) return false;
  return true;
}

export async function purgeEmptyShellTurnsIfNeeded(
  projectRoot: string,
  opts: { now?: Date } = {},
): Promise<EmptyShellPurgeResult> {
  const now = opts.now ?? new Date();

  let events: EventLedgerEvent[] = [];
  try {
    const result = await readEventLedger(projectRoot);
    events = result.events;
  } catch {
    return { turns_folded: 0, groups_written: 0 };
  }

  // Group empty shells by (UTC-day, client). Value tracks count + min ts so the
  // folded counter row lands inside the original turns' window.
  const groups = new Map<string, { client: string | undefined; count: number; minTs: number }>();
  for (const e of events) {
    const parsed = e as unknown as Record<string, unknown>;
    if (!isEmptyShellTurn(parsed)) continue;
    const ts = typeof parsed["ts"] === "number" ? (parsed["ts"] as number) : now.getTime();
    const client = typeof parsed["client"] === "string" ? (parsed["client"] as string) : undefined;
    const key = `${utcDayKey(ts)}::${client ?? ""}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, { client, count: 1, minTs: ts });
    } else {
      existing.count += 1;
      if (ts < existing.minTs) existing.minTs = ts;
    }
  }

  if (groups.size === 0) {
    return { turns_folded: 0, groups_written: 0 };
  }

  // Write the folded counter rows BEFORE dropping (mirrors the rollup's
  // sidecar-then-drop order). Each row carries one (day, client) group.
  const metricsPath = getMetricsLedgerPath(projectRoot);
  await ensureParentDirectory(metricsPath);
  let turnsFolded = 0;
  let groupsWritten = 0;
  for (const { client, count, minTs } of groups.values()) {
    const counterKey =
      client !== undefined ? `${ASSISTANT_TURN_COUNTER_PREFIX}:${client}` : ASSISTANT_TURN_COUNTER_PREFIX;
    const row: MetricsRow = {
      timestamp: new Date(minTs).toISOString(),
      window: "purge-fold",
      counters: { [counterKey]: count },
    };
    await appendFile(metricsPath, `${JSON.stringify(row)}\n`);
    turnsFolded += count;
    groupsWritten += 1;
  }

  // Drop the folded empty shells (archived to events.archive/, never deleted).
  await dropEventsFromLedger(projectRoot, {
    label: "empty-shell-fold",
    now,
    predicate: (parsed) => isEmptyShellTurn(parsed),
  });

  return { turns_folded: turnsFolded, groups_written: groupsWritten };
}

// ---------------------------------------------------------------------------
// v2.0.0-rc.25 TASK-10: `fabric doctor --archive-history`
// ---------------------------------------------------------------------------
//
// Read-only audit surface that renders one row per session showing the MOST
// RECENT `session_archive_attempted` event observed within the `--since`
// window. Mirrors the rc.20 `runDoctorCiteCoverage` precedent (parallel
// subcommand wired through the same CLI dispatch) but with a much smaller
// algorithm — a single readEventLedger pass + group-by-session reduction.
//
// Source-of-truth: events.jsonl rows whose `event_type` is
// `session_archive_attempted` (schema landed in rc.25 TASK-01). Each row
// carries `session_id`, `outcome`, `covered_through_ts`, `candidates_proposed`,
// and the event envelope `ts`. We project a stable, render-friendly shape so
// the CLI renderer (and any future JSON consumers) never has to walk the
// raw event union.
//
// Performance: O(N events in window). For typical pcf-grade corpora
// (<10k events) this stays under 50ms — well within the doctor budget.

export type ArchiveHistoryEntry = {
  // First 8 chars of the session_id, suffix `...` if truncated. The full
  // session_id is intentionally omitted from the projection — operators who
  // need it run `jq` against events.jsonl directly. Mirrors the truncation
  // convention used by the archive Skill's onboarding output.
  session_id_short: string;
  // ISO-8601 timestamp of the most recent attempt for this session. Derived
  // from the event envelope `ts` (epoch-ms) so all downstream sorting is
  // numeric-stable across timezones.
  last_attempted_at: string;
  // The terminal outcome of the most recent attempt. Closed enum mirrored
  // from the schema literal.
  outcome: "proposed" | "viability_failed" | "user_dismissed" | "skipped_no_signal";
  // Count of pending knowledge entries written on that attempt. Zero for
  // non-`proposed` outcomes.
  candidates_proposed: number;
  // The latest event `ts` value the attempt scanned. Carries epoch-ms to
  // match the schema; downstream renderers convert to ISO.
  covered_through_ts: number;
  // Time elapsed (in hours, rounded down) between `covered_through_ts` and
  // `Date.now()` at the moment the report is generated. The "gap" surface
  // operators eyeball to spot sessions where archive coverage has stalled.
  age_since_covered_hours: number;
};

export type ArchiveHistoryReport = {
  entries: ArchiveHistoryEntry[];
  // Distinct session count (== entries.length). Surfaced explicitly so JSON
  // consumers don't have to count.
  total: number;
  // Epoch-ms floor of the `--since` window the caller passed in. Echoed back
  // so the renderer can interpolate it into the header line.
  since_ms: number;
  // ISO-8601 timestamp captured at the moment the report was assembled.
  // Provides a stable anchor for `age_since_covered_hours` so successive runs
  // are comparable even when wall-clock skews.
  generated_at: string;
};

export async function runDoctorArchiveHistory(
  projectRoot: string,
  options: { since: number },
): Promise<ArchiveHistoryReport> {
  const generatedAt = new Date().toISOString();
  const nowMs = Date.now();

  // Single ledger pass scoped to the requested window + event_type filter.
  // Both filters are pushed into readEventLedger so we never deserialize
  // events outside the report's surface area.
  let events: EventLedgerEvent[] = [];
  try {
    const result = await readEventLedger(projectRoot, {
      event_type: "session_archive_attempted",
      since: options.since,
    });
    events = result.events;
  } catch {
    // Degraded ledger — surface empty report rather than throw. Matches the
    // best-effort policy used by runDoctorCiteCoverage and downstream
    // observability emitters.
    return {
      entries: [],
      total: 0,
      since_ms: options.since,
      generated_at: generatedAt,
    };
  }

  // Group by session_id, keep the row with the MAX `ts` per session. Events
  // lacking session_id (envelope field is optional) are skipped — without a
  // session anchor there is no meaningful "last attempt for session X" to
  // render.
  type AttemptEvent = Extract<EventLedgerEvent, { event_type: "session_archive_attempted" }>;
  const mostRecentBySession = new Map<string, AttemptEvent>();
  for (const event of events) {
    if (event.event_type !== "session_archive_attempted") {
      // Defensive — the readEventLedger filter already gates this, but the
      // discriminated-union narrow below requires the runtime check.
      continue;
    }
    const sessionId = event.session_id;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      continue;
    }
    const prior = mostRecentBySession.get(sessionId);
    if (prior === undefined || event.ts > prior.ts) {
      mostRecentBySession.set(sessionId, event);
    }
  }

  // Project + sort. Descending by `last_attempted_at` (epoch-ms order is
  // identical to ISO order for `new Date(...).toISOString()`).
  const entries: ArchiveHistoryEntry[] = [];
  for (const [sessionId, event] of mostRecentBySession.entries()) {
    const ageHours = Math.max(
      0,
      Math.floor((nowMs - event.covered_through_ts) / 3_600_000),
    );
    entries.push({
      session_id_short: truncateSessionId(sessionId),
      last_attempted_at: new Date(event.ts).toISOString(),
      outcome: event.outcome,
      candidates_proposed: event.candidates_proposed,
      covered_through_ts: event.covered_through_ts,
      age_since_covered_hours: ageHours,
    });
  }
  entries.sort((a, b) =>
    a.last_attempted_at < b.last_attempted_at
      ? 1
      : a.last_attempted_at > b.last_attempted_at
        ? -1
        : 0,
  );

  return {
    entries,
    total: entries.length,
    since_ms: options.since,
    generated_at: generatedAt,
  };
}

// rc.37 NEW-33: unified history view. Aggregates doctor_run + archive
// attempt events into a per-day rollup over the --since window. Lightweight
// projection — daily counts only; for per-session detail operators continue
// to use the original --archive-history surface.
export type HistoryDayRow = {
  date: string; // YYYY-MM-DD (UTC)
  doctor_runs_lint: number;
  doctor_runs_fix: number;
  doctor_total_issues: number;
  doctor_total_mutations: number;
  archive_attempts: number;
  archive_proposed: number;
};

export type HistoryAllReport = {
  rows: HistoryDayRow[];
  since_ms: number;
  generated_at: string;
};

export async function runDoctorHistoryAll(
  projectRoot: string,
  options: { since: number },
): Promise<HistoryAllReport> {
  const generatedAt = new Date().toISOString();
  const buckets = new Map<string, HistoryDayRow>();
  const getBucket = (ts: number): HistoryDayRow => {
    const date = new Date(ts).toISOString().slice(0, 10);
    let row = buckets.get(date);
    if (row === undefined) {
      row = {
        date,
        doctor_runs_lint: 0,
        doctor_runs_fix: 0,
        doctor_total_issues: 0,
        doctor_total_mutations: 0,
        archive_attempts: 0,
        archive_proposed: 0,
      };
      buckets.set(date, row);
    }
    return row;
  };

  // doctor_run events
  try {
    const { events } = await readEventLedger(projectRoot, {
      event_type: "doctor_run",
      since: options.since,
    });
    for (const event of events) {
      if (event.event_type !== "doctor_run") continue;
      const row = getBucket(event.ts);
      if (event.mode === "lint") {
        row.doctor_runs_lint += 1;
      } else {
        row.doctor_runs_fix += 1;
      }
      row.doctor_total_issues += event.issues;
      row.doctor_total_mutations += event.mutations ?? 0;
    }
  } catch {
    // Degraded ledger — proceed with archive arm only.
  }

  // session_archive_attempted events
  try {
    const { events } = await readEventLedger(projectRoot, {
      event_type: "session_archive_attempted",
      since: options.since,
    });
    for (const event of events) {
      if (event.event_type !== "session_archive_attempted") continue;
      const row = getBucket(event.ts);
      row.archive_attempts += 1;
      if (event.outcome === "proposed") {
        row.archive_proposed += event.candidates_proposed;
      }
    }
  } catch {
    // Degraded — empty archive arm.
  }

  const rows = Array.from(buckets.values()).sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );

  return { rows, since_ms: options.since, generated_at: generatedAt };
}

// session_id truncation helper. The schema does not constrain session_id
// length (CLI clients pick arbitrary opaque strings — UUIDs, short prefixes,
// "sess-<n>" patterns) so the rule is: keep the first 8 chars and append
// `...` when truncation actually shortened the string. Short ids (<= 8 chars)
// render verbatim without a suffix.
function truncateSessionId(sessionId: string): string {
  if (sessionId.length <= 8) {
    return sessionId;
  }
  return `${sessionId.slice(0, 8)}...`;
}
