/**
 * knowledge-sync.ts — Rule-sync orchestrator framework (R28, TASK-011)
 *
 * Public surface: ensureKnowledgeFresh, reconcileKnowledge + exported types.
 * Internal helpers are co-located in this file.
 * Does NOT wire any consumers (MCP tools, doctor, watchers).
 *
 * Distinction between the two public entry points:
 *
 * - `ensureKnowledgeFresh`: detects drift, emits ledger events, invalidates cache.
 *   Does NOT rewrite agents.meta.json. Optimised for hot-path consumers (MCP tools).
 *
 * - `reconcileKnowledge`: full scan + rewrites agents.meta.json (via knowledge-meta-builder)
 *   + emits ledger events. Used by startup (TASK-022) and doctor repair (TASK-023).
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { RuleValidationError } from "@fenglimg/fabric-shared/errors";

import { contextCache } from "../cache.js";
import { readAgentsMeta, AgentsMetaFileMissingError, AgentsMetaInvalidError } from "../meta-reader.js";
import { appendEventLedgerEvent } from "./event-ledger.js";
import { sha256 } from "./_shared.js";
import { buildKnowledgeMeta, writeKnowledgeMeta } from "./knowledge-meta-builder.js";

// v2.0 dual-root knowledge layout — content_ref prefixes mirror
// knowledge-meta-builder.ts so meta entries and rule-sync scans share the
// same path vocabulary. Keeping these constants local (rather than importing
// from knowledge-meta-builder.ts) avoids exposing internal helpers and
// keeps each module's surface area minimal.
const PERSONAL_CONTENT_REF_PREFIX = "~/.fabric/knowledge/";
const TEAM_CONTENT_REF_PREFIX = ".fabric/knowledge/";

// v2.0.0-rc.22 TASK-014 Scope E: subdir whitelist for rule-sync's dual-root
// scan. Mirrors KNOWLEDGE_SUBDIRS in knowledge-meta-builder.ts. `pending` is
// included so unreviewed knowledge entries participate in drift detection;
// their lifecycle is governed by frontmatter, not directory placement.
const KNOWLEDGE_SUBDIRS = [
  "decisions",
  "pitfalls",
  "guidelines",
  "models",
  "processes",
  "pending",
] as const;

/**
 * Resolve the personal-layer fabric root. Test-friendly via FABRIC_HOME env
 * var; production callers fall through to os.homedir(). Mirrors the helper
 * with the same name in knowledge-meta-builder.ts — kept local here for
 * the same encapsulation reason as the PREFIX constants above.
 */
function resolvePersonalRoot(): string {
  return process.env.FABRIC_HOME ?? homedir();
}

/**
 * Resolve a content_ref-style path (either team-relative or personal-prefixed)
 * to an absolute filesystem path. Personal entries carry the
 * `~/.fabric/knowledge/` prefix; team entries are plain project-relative
 * paths under `.fabric/knowledge/`.
 */
export function resolveContentRefPath(projectRoot: string, relPath: string): string {
  if (relPath.startsWith(PERSONAL_CONTENT_REF_PREFIX)) {
    return join(
      resolvePersonalRoot(),
      ".fabric",
      "knowledge",
      relPath.slice(PERSONAL_CONTENT_REF_PREFIX.length),
    );
  }
  return join(projectRoot, relPath);
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface KnowledgeSyncOptions {
  mode?: "incremental" | "full";
  /** When true, invalid frontmatter throws RuleValidationError (default: false — collect as warning). */
  throwOnInvalidFrontmatter?: boolean;
  /**
   * v2.0.0-rc.29 TASK-005 (BUG-G1): when true, `ensureKnowledgeFresh`
   * synchronously follows a drift detection with a `reconcileKnowledge`
   * call to materialize the auto-heal (rewrite agents.meta.json + emit a
   * paired `knowledge_meta_auto_healed` event). Default false preserves
   * the rc.28 hot-path semantics where drift detection never blocks the
   * MCP read on a meta rebuild. Opt-in is intended for callers that can
   * tolerate ~tens-of-ms extra latency in exchange for the invariant
   * "every knowledge_drift_detected has a paired heal event in the same
   * tail window." Audit (BUG-G1) found 5/72 drifts healed on this repo
   * (~7%) because the hot path emitted detect-only events.
   */
  autoHealOnDrift?: boolean;
}

export interface StructuredWarning {
  code: string;
  file: string;
  line?: number;
  action_hint: string;
}

/**
 * Granular ledger event shape for knowledge-sync operations.
 * These are returned in KnowledgeSyncReport and also appended to the event ledger
 * using the nearest available ledger event type (knowledge_drift_detected).
 * The shape below is what callers receive in `.events`.
 */
export interface KnowledgeSyncLedgerEvent {
  type: "rule_content_changed" | "rule_added" | "rule_removed";
  stable_id: string;
  path: string;
  prev_hash: string | null;
  new_hash: string | null;
  changed_fields: string[];
  source: "ensureKnowledgeFresh" | "reconcileKnowledge";
}

/** Alias so the public API says LedgerEvent (as documented). */
export type LedgerEvent = KnowledgeSyncLedgerEvent;

export interface KnowledgeSyncReport {
  status: "fresh" | "reconciled" | "errors";
  events: LedgerEvent[];
  warnings: StructuredWarning[];
  reconciled_files?: string[];
}

// ---------------------------------------------------------------------------
// Module-scope debounce state: filePath -> { ts: last-sync ms, hash: last-seen hash }
// ---------------------------------------------------------------------------

interface DebounceEntry {
  ts: number;
  hash: string;
}

const lastSyncState = new Map<string, DebounceEntry>();

// ---------------------------------------------------------------------------
// Module-scope cooldown registry: projectRoot -> expiry timestamp
// Optimistic skip: if a previous successful sync returned 'fresh' within
// SYNC_COOLDOWN_MS, return a cached empty report without any I/O.
// ---------------------------------------------------------------------------

const freshSyncCooldown = new Map<string, number>();
const SYNC_COOLDOWN_MS = 500;

/**
 * Clear the knowledge-sync cooldown for a projectRoot so the next ensureKnowledgeFresh
 * call performs a real I/O scan. Called by the chokidar watcher when a rule
 * file changes (see http.ts handleCacheWatcherEvent).
 */
export function invalidateKnowledgeSyncCooldown(projectRoot: string): void {
  freshSyncCooldown.delete(projectRoot);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface MetaEntry {
  stable_id: string;
  path: string; // relative posix path (content_ref style)
  content_hash: string;
}

interface MetaFile {
  nodes?: Record<string, { stable_id?: string; file?: string; content_ref?: string; hash?: string }>;
}

async function readMetaEntries(projectRoot: string): Promise<Map<string, MetaEntry>> {
  const metaPath = join(projectRoot, ".fabric", "agents.meta.json");
  const map = new Map<string, MetaEntry>();

  let raw: string;
  try {
    raw = await readFile(metaPath, "utf8");
  } catch {
    return map;
  }

  let parsed: MetaFile;
  try {
    parsed = JSON.parse(raw) as MetaFile;
  } catch {
    return map;
  }

  for (const node of Object.values(parsed.nodes ?? {})) {
    const path = node.content_ref ?? node.file;
    const stable_id = node.stable_id;
    const content_hash = node.hash;

    if (path !== undefined && stable_id !== undefined && content_hash !== undefined) {
      map.set(path, { stable_id, path, content_hash });
    }
  }

  return map;
}

/**
 * v2.0.0-rc.22 TASK-014 (Scope E): dual-root rule scan.
 *
 * Walks BOTH the team root (`<projectRoot>/.fabric/knowledge/`) and the
 * personal root (`<resolvePersonalRoot()>/.fabric/knowledge/`), returning
 * content_ref-style paths:
 *   - Team entries:     `.fabric/knowledge/<subdir>/<file>.md`     (project-relative)
 *   - Personal entries: `~/.fabric/knowledge/<subdir>/<file>.md`   (prefixed)
 *
 * Mirrors `findKnowledgeFiles` in knowledge-meta-builder.ts so the two
 * pipelines (meta build + rule-sync drift) see the same disk vocabulary —
 * which is what makes meta_entries.path comparisons against findRuleFiles
 * output work correctly across both layers.
 *
 * Personal-root materialization is deliberately NOT performed here (unlike
 * the meta builder which calls mkdir to seed the canonical layout). Rule
 * sync is a read-only scan; missing personal directories simply contribute
 * zero entries, identical to a team-only repo on a host that never used
 * personal knowledge.
 */
async function findRuleFiles(projectRoot: string): Promise<string[]> {
  const teamRoot = join(projectRoot, ".fabric", "knowledge");
  const personalRoot = join(resolvePersonalRoot(), ".fabric", "knowledge");

  const files: string[] = [];

  for (const [root, prefix] of [
    [teamRoot, TEAM_CONTENT_REF_PREFIX] as const,
    [personalRoot, PERSONAL_CONTENT_REF_PREFIX] as const,
  ]) {
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      continue;
    }

    for (const subdir of KNOWLEDGE_SUBDIRS) {
      const dir = join(root, subdir);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) {
        continue;
      }

      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          files.push(`${prefix}${subdir}/${entry.name}`);
        }
      }
    }
  }

  return files.sort();
}

/**
 * Validate frontmatter in a rule file.
 * Returns a StructuredWarning when frontmatter is invalid, or null when valid.
 * When `throwOnInvalid` is true, throws RuleValidationError instead.
 */
function validateFrontmatter(
  source: string,
  filePath: string,
  throwOnInvalid: boolean,
): StructuredWarning | null {
  if (!source.startsWith("---")) {
    return null;
  }

  const endIdx = source.indexOf("\n---", 3);
  if (endIdx === -1) {
    const msg = `Unterminated YAML frontmatter in ${filePath}`;
    if (throwOnInvalid) {
      throw new RuleValidationError(msg, {
        actionHint: "Run `fabric doctor --fix` to repair frontmatter",
        fixable: true,
        details: { file: filePath },
      });
    }

    return {
      code: "rule_frontmatter_invalid",
      file: filePath,
      action_hint: "Run `fabric doctor --fix` to repair frontmatter",
    };
  }

  const frontmatter = source.slice(3, endIdx).trim();

  for (const line of frontmatter.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    if (!trimmed.includes(":") && !trimmed.startsWith("-")) {
      const msg = `Invalid YAML frontmatter line "${trimmed}" in ${filePath}`;
      if (throwOnInvalid) {
        throw new RuleValidationError(msg, {
          actionHint: "Run `fabric doctor --fix` to repair frontmatter",
          fixable: true,
          details: { file: filePath, line: trimmed },
        });
      }

      return {
        code: "rule_frontmatter_invalid",
        file: filePath,
        action_hint: "Run `fabric doctor --fix` to repair frontmatter",
      };
    }
  }

  return null;
}

/**
 * Process a single rule file and return a ledger event if drift is detected.
 *
 * High 1 fix: ALWAYS reads the current disk hash first.
 * Debounce skips ONLY when hash-equal AND within 500ms window.
 */
async function processSingleFile(
  projectRoot: string,
  relPath: string,
  metaEntry: MetaEntry | undefined,
  source: "ensureKnowledgeFresh" | "reconcileKnowledge",
  throwOnInvalidFrontmatter: boolean,
): Promise<{ event: KnowledgeSyncLedgerEvent | null; warning: StructuredWarning | null }> {
  // v2.0.0-rc.22 TASK-014: paths may be team-relative or personal-prefixed
  // (`~/.fabric/knowledge/...`); resolveContentRefPath handles both.
  const absPath = resolveContentRefPath(projectRoot, relPath);

  try {
    await stat(absPath);
  } catch {
    // File was removed
    if (metaEntry !== undefined) {
      return {
        event: {
          type: "rule_removed",
          stable_id: metaEntry.stable_id,
          path: relPath,
          prev_hash: metaEntry.content_hash,
          new_hash: null,
          changed_fields: ["content"],
          source,
        },
        warning: null,
      };
    }

    return { event: null, warning: null };
  }

  let content: string;
  try {
    content = await readFile(absPath, "utf8");
  } catch {
    return { event: null, warning: null };
  }

  const newHash = sha256(content);
  const now = Date.now();
  // Key by absolute path so different project roots with identical relative paths
  // do not share debounce state (important for multi-project and test isolation).
  const debounce = lastSyncState.get(absPath);

  // High 1: Debounce only when hash-equal AND within 500ms window.
  // We always read the file first — never skip pre-read on time alone.
  if (debounce !== undefined && newHash === debounce.hash && now - debounce.ts < 500) {
    return { event: null, warning: null };
  }

  // Hash-identical save: content matches meta on disk -> no event (but record check)
  if (metaEntry !== undefined && newHash === metaEntry.content_hash) {
    lastSyncState.set(absPath, { ts: now, hash: newHash });
    return { event: null, warning: null };
  }

  // Content changed — validate frontmatter before emitting
  const warning = validateFrontmatter(content, relPath, throwOnInvalidFrontmatter);
  if (warning !== null) {
    // Invalid frontmatter in warning mode: record state but do not emit content event
    lastSyncState.set(absPath, { ts: now, hash: newHash });
    return { event: null, warning };
  }

  const prevHash = metaEntry?.content_hash ?? debounce?.hash ?? null;
  const stableId = metaEntry?.stable_id ?? relPath;
  const eventType: KnowledgeSyncLedgerEvent["type"] = metaEntry === undefined ? "rule_added" : "rule_content_changed";

  lastSyncState.set(absPath, { ts: now, hash: newHash });

  return {
    event: {
      type: eventType,
      stable_id: stableId,
      path: relPath,
      prev_hash: prevHash,
      new_hash: newHash,
      changed_fields: ["content"],
      source,
    },
    warning: null,
  };
}

async function appendRuleSyncEvents(projectRoot: string, events: KnowledgeSyncLedgerEvent[]): Promise<void> {
  if (events.length === 0) {
    return;
  }

  const driftedIds = events.map((e) => e.stable_id);
  const missingFiles = events.filter((e) => e.type === "rule_removed").map((e) => e.path);
  const staleFiles = events.filter((e) => e.type !== "rule_removed").map((e) => e.path);

  if (missingFiles.length > 0 || staleFiles.length > 0) {
    await appendEventLedgerEvent(projectRoot, {
      event_type: "knowledge_drift_detected",
      drifted_stable_ids: driftedIds,
      missing_files: missingFiles,
      stale_files: staleFiles,
    });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detects drift between disk and agents.meta.json, emits ledger events, and
 * invalidates the cache. Does NOT rewrite agents.meta.json. Optimised for
 * hot-path consumers (MCP tools).
 */
export async function ensureKnowledgeFresh(
  projectRoot: string,
  opts?: KnowledgeSyncOptions,
): Promise<KnowledgeSyncReport> {
  const mode = opts?.mode ?? "incremental";

  // Global optimistic skip: if the last sync for this projectRoot returned
  // 'fresh' within SYNC_COOLDOWN_MS and mode is not 'full', return the cached
  // empty report without touching the filesystem at all.
  const cooldownExpiry = freshSyncCooldown.get(projectRoot);
  if (cooldownExpiry !== undefined && Date.now() < cooldownExpiry && mode !== "full") {
    return { status: "fresh", events: [], warnings: [] };
  }

  const throwOnInvalidFrontmatter = opts?.throwOnInvalidFrontmatter ?? false;
  const source = "ensureKnowledgeFresh" as const;
  const events: KnowledgeSyncLedgerEvent[] = [];
  const warnings: StructuredWarning[] = [];

  const metaEntries = await readMetaEntries(projectRoot);
  const ruleFiles = await findRuleFiles(projectRoot);

  // High 1 fix: Never pre-skip files based on time alone. The debounce check
  // inside processSingleFile deduplicates correctly: it reads the disk hash first
  // and only skips when hash-equal AND within the 500ms window.
  // Incremental and full modes both process all files; the difference is purely
  // about whether we re-read files we haven't seen before (incremental includes
  // all, full also includes all — the modes are now equivalent here, kept for
  // future use by callers that may add per-mode behaviour).
  const filesToCheck = ruleFiles;

  for (const relPath of filesToCheck) {
    const metaEntry = metaEntries.get(relPath);
    const result = await processSingleFile(projectRoot, relPath, metaEntry, source, throwOnInvalidFrontmatter);

    if (result.event !== null) {
      events.push(result.event);
    }

    if (result.warning !== null) {
      warnings.push(result.warning);
    }
  }

  // Check for removals: meta entries whose files no longer exist on disk.
  // v2.0.0-rc.22 TASK-014: meta paths may carry the personal prefix —
  // resolve via resolveContentRefPath to check both layers correctly.
  for (const [relPath, entry] of metaEntries) {
    if (!ruleFiles.includes(relPath)) {
      const absPath = resolveContentRefPath(projectRoot, relPath);
      if (!existsSync(absPath)) {
        events.push({
          type: "rule_removed",
          stable_id: entry.stable_id,
          path: relPath,
          prev_hash: entry.content_hash,
          new_hash: null,
          changed_fields: ["content"],
          source,
        });
      }
    }
  }

  if (events.length === 0 && warnings.length === 0) {
    // Fresh: set cooldown so rapid follow-up calls skip I/O entirely.
    freshSyncCooldown.set(projectRoot, Date.now() + SYNC_COOLDOWN_MS);
    return { status: "fresh", events: [], warnings: [] };
  }

  if (events.length > 0) {
    await appendRuleSyncEvents(projectRoot, events);
    contextCache.invalidate("file_watch", projectRoot);
  }

  // Status is 'reconciled' or 'errors' — something changed; clear cooldown so
  // the next call re-verifies quickly instead of returning stale cached fresh.
  freshSyncCooldown.delete(projectRoot);

  // v2.0.0-rc.29 TASK-005 (BUG-G1): when the caller opts in, immediately
  // chain a reconcileKnowledge so the drift detected above gets paired with
  // a `meta_reconciled` summary event + the implied heal observed through
  // loadActiveMetaOrStale on the next read. This is the structural answer
  // to "only 7% of drifts auto-heal" — the hot path emitted drift-only
  // events because heal was a separate caller's responsibility. Opt-in
  // (default off) so the existing hot-path latency contract is preserved.
  if (opts?.autoHealOnDrift === true && events.length > 0) {
    try {
      await reconcileKnowledge(projectRoot, { trigger: "auto-heal-after-drift" });
    } catch {
      // Heal failures must not propagate — the caller already has the
      // detected events, and a subsequent reconcileKnowledge call (doctor,
      // startup) will close the gap on the next pass.
    }
  }

  const status = warnings.length > 0 ? "errors" : "reconciled";

  return {
    status,
    events,
    warnings,
    reconciled_files: events.map((e) => e.path),
  };
}

export interface ReconcileKnowledgeOptions {
  /**
   * Identifies who triggered the reconcile; controls which summary ledger event is written.
   *
   * v2.0.0-rc.23 TASK-005 (a-B): `auto-heal-description` added so plan_context
   * can drive a full reconcile when it detects nodes with `description === undefined`
   * (legacy meta drift the revision-hash gate cannot detect).
   *
   * v2.0.0-rc.27 TASK-001 (§2.9 root): `post-approve` / `post-modify` added so
   * `fab_review` approve/modify-layer-flip can drive an immediate meta rebuild
   * — without this the new entry's `nodes[id]` stays empty until the next
   * plan_context call's auto-heal, which leaves the entry undiscoverable in
   * the description_index window between approve and the next hint call.
   */
  // v2.0.0-rc.29 TASK-005 (BUG-G1): `auto-heal-after-drift` added so the
  // ensureKnowledgeFresh hot-path can chain a reconcile that closes the
  // drift→heal gap without leaking a separate trigger label into the audit.
  trigger?:
    | "startup"
    | "doctor"
    | "manual"
    | "auto-heal-description"
    | "auto-heal-after-drift"
    | "post-approve"
    | "post-modify";
}

/**
 * Full scan + rewrites agents.meta.json with ground-truth disk state + emits
 * ledger events. Used by startup (TASK-022) and doctor repair (TASK-023).
 * Returns reconciled_files listing all paths whose meta was updated.
 *
 * When `opts.trigger` is `'startup'`, a `meta_reconciled_on_startup` summary
 * ledger event is appended after per-file drift events. Other trigger values
 * append a `meta_reconciled` event. Omitting the trigger skips the summary.
 */
export async function reconcileKnowledge(projectRoot: string, opts?: ReconcileKnowledgeOptions): Promise<KnowledgeSyncReport> {
  // Full scan — always clears the cooldown so ensureKnowledgeFresh re-checks on
  // the next MCP call after reconcile completes (avoids stale-fresh after write).
  freshSyncCooldown.delete(projectRoot);

  const trigger = opts?.trigger;
  const startTime = Date.now();
  const source = "reconcileKnowledge" as const;
  const events: KnowledgeSyncLedgerEvent[] = [];
  const warnings: StructuredWarning[] = [];

  const metaEntries = await readMetaEntries(projectRoot);
  const ruleFiles = await findRuleFiles(projectRoot);

  // Full scan — process every rule file
  for (const relPath of ruleFiles) {
    const metaEntry = metaEntries.get(relPath);
    const result = await processSingleFile(projectRoot, relPath, metaEntry, source, false);

    if (result.event !== null) {
      events.push(result.event);
    }

    if (result.warning !== null) {
      warnings.push(result.warning);
    }
  }

  // Check for removals. v2.0.0-rc.22 TASK-014: resolve dual-root paths.
  for (const [relPath, entry] of metaEntries) {
    if (!ruleFiles.includes(relPath)) {
      const absPath = resolveContentRefPath(projectRoot, relPath);
      if (!existsSync(absPath)) {
        events.push({
          type: "rule_removed",
          stable_id: entry.stable_id,
          path: relPath,
          prev_hash: entry.content_hash,
          new_hash: null,
          changed_fields: ["content"],
          source,
        });
      }
    }
  }

  // v2.0.0-rc.22 TASK-014 (Scope E): top-level revision-drift detection.
  //
  // The per-file content-hash gate above is necessary but not sufficient: it
  // only fires when SOME knowledge file's bytes diverge from its meta entry.
  // Top-level schema/revision drift (e.g. old meta with null knowledge_type
  // from a v1.x baseline, or revision-string corruption) leaves every per-file
  // hash matching while the agents.meta.json envelope is still stale.
  //
  // Recompute the meta from disk, compare its revision against the on-disk
  // copy, and force a write when they diverge. This is the symmetric
  // counterpart to loadActiveMeta's auto-heal on the read path: read-side
  // auto-heal closes the gap when no one calls reconcile; this closes the
  // gap when something explicitly calls reconcile (doctor --fix, startup,
  // manual).
  //
  // We deliberately call buildKnowledgeMeta + readAgentsMeta directly rather
  // than reusing loadActiveMeta. loadActiveMeta would also persist on drift
  // (good) — but it lives in load-active-meta.ts which itself imports from
  // this module's neighbour (knowledge-meta-builder.ts). Going through
  // loadActiveMeta here would invert the dependency direction in a way that
  // risks future circular imports. The direct comparison keeps the
  // dependency arrow stable: knowledge-sync depends only on
  // knowledge-meta-builder + meta-reader.
  let revisionDrift = false;
  try {
    const derived = await buildKnowledgeMeta(projectRoot);
    const onDisk = await readAgentsMeta(projectRoot);
    revisionDrift = onDisk.revision !== derived.meta.revision;
  } catch (error) {
    // Missing/invalid on-disk meta is NOT a revisionDrift case for this
    // gate — the higher-level doctor/startup flows handle agents_meta_missing
    // / agents_meta_invalid separately. Per-file events (if any) will still
    // trigger writeKnowledgeMeta below, which creates the meta from scratch.
    if (
      !(error instanceof AgentsMetaFileMissingError) &&
      !(error instanceof AgentsMetaInvalidError)
    ) {
      throw error;
    }
  }

  // v2.0.0-rc.23 TASK-005 (a-B): the `auto-heal-description` trigger forces a
  // writeKnowledgeMeta even when neither per-file content nor top-level
  // revision drift is detected. Rationale: `computeRevision` hashes only
  // `id|hash|stable_id|identity_source`, so stripping or never-populating the
  // `description` field on an entry leaves the revision unchanged. The
  // per-file and revision-drift gates above both miss this case. plan_context
  // detects it on the read path (any node with `description === undefined`)
  // and calls in here to drive an unconditional rebuild from disk.
  const forceWriteForDescriptionHeal = trigger === "auto-heal-description";

  // High 2: Rewrite agents.meta.json with ground-truth disk state when drift
  // detected (either per-file or top-level revision drift). writeKnowledgeMeta
  // rebuilds from disk (hashes, stable_ids, paths) and writes atomically.
  if (events.length > 0 || revisionDrift || forceWriteForDescriptionHeal) {
    await writeKnowledgeMeta(projectRoot, { source: "sync_meta" });
    if (events.length > 0) {
      await appendRuleSyncEvents(projectRoot, events);
    }
    contextCache.invalidate("file_watch", projectRoot);
    // The contextCache "meta" slot was populated by readAgentsMeta above; bust
    // it so subsequent reads see the freshly-written meta.
    contextCache.invalidate("meta_write", projectRoot);
  }

  const duration_ms = Date.now() - startTime;
  const reconciledFiles = events.map((e) => e.path);

  // Emit summary ledger event when a trigger is specified and ANY write
  // happened (per-file drift OR top-level revision drift OR the rc.23
  // description-heal force-write). The force_write_reason field disambiguates
  // revision-only writes from standard per-file flows so the audit trail is
  // unambiguous.
  if (trigger !== undefined && (events.length > 0 || revisionDrift || forceWriteForDescriptionHeal)) {
    if (trigger === "startup") {
      await appendEventLedgerEvent(projectRoot, {
        event_type: "meta_reconciled_on_startup",
        reconciled_files: reconciledFiles,
        duration_ms,
        source: "reconcileKnowledge",
      });
    } else {
      await appendEventLedgerEvent(projectRoot, {
        event_type: "meta_reconciled",
        reconciled_files: reconciledFiles,
        duration_ms,
        trigger,
        source: "reconcileKnowledge",
        ...(events.length === 0 && revisionDrift
          ? { force_write_reason: "revision_drift" as const }
          : {}),
      });
    }
  }

  if (events.length === 0 && warnings.length === 0 && !revisionDrift) {
    return { status: "fresh", events: [], warnings: [] };
  }

  const status = warnings.length > 0 ? "errors" : "reconciled";

  return {
    status,
    events,
    warnings,
    reconciled_files: reconciledFiles,
  };
}
