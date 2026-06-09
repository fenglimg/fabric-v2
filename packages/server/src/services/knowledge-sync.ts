/**
 * knowledge-sync.ts — Rule-sync orchestrator framework (R28, TASK-011)
 *
 * Public surface: ensureKnowledgeFresh + exported types.
 * Internal helpers are co-located in this file.
 * Does NOT wire any consumers (MCP tools, doctor, watchers).
 *
 * `ensureKnowledgeFresh` used to detect drift between disk and the co-location
 * `agents.meta.json` index. That co-location index is retired; the public
 * entry point is now a compatibility no-op so hot-path MCP tools do not scan
 * project-local or legacy non-store knowledge roots.
 *
 * v2.2 W5 R2 (agents.meta decolo): the `reconcileKnowledge` entry point —
 * which rebuilt the co-location `agents.meta.json` from disk via
 * knowledge-meta-builder — has been retired. Knowledge now lives in mounted
 * stores; the co-location index has no readers (read paths cut over to the
 * cross-store model) and is removed at decolo close-out, so periodically
 * rebuilding it served no consumer. Drift detection moved to store-aware
 * surfaces; this module no longer scans the retired dual-root knowledge trees.
 */

/**
 * Retired compatibility helper. The old content_ref resolver mapped non-store
 * roots to disk. Store-backed read paths now resolve files through the store
 * resolver, so accepting legacy content_ref paths here would re-open the
 * retired local/global knowledge scan path.
 */
export function resolveContentRefPath(projectRoot: string, relPath: string): string {
  void projectRoot;
  throw new Error(`legacy non-store knowledge content_ref resolution is retired: ${relPath}`);
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface KnowledgeSyncOptions {
  mode?: "incremental" | "full";
  /** Retained for backward compatibility; ignored by the store-only no-op. */
  throwOnInvalidFrontmatter?: boolean;
  /**
   * v2.0.0-rc.29 TASK-005 (BUG-G1): originally opted the hot path into a
   * follow-up `reconcileKnowledge` (rewrite agents.meta.json) so every
   * detected drift got a paired heal event.
   *
   * v2.2 W5 R2 (agents.meta decolo): retained as a NO-OP for backward
   * compatibility — the co-location agents.meta.json it used to rebuild no
   * longer exists (knowledge lives in stores; read paths cut over to the
   * cross-store model). MCP tool call sites still pass `autoHealOnDrift: true`;
   * it is now ignored.
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
// Module-scope cooldown registry: projectRoot -> expiry timestamp
// Kept only for the watcher invalidation API; ensureKnowledgeFresh is a
// store-only compatibility no-op and performs no filesystem scan.
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
// Public API
// ---------------------------------------------------------------------------

/**
 * Compatibility shim for MCP hot paths. Knowledge now lives in mounted stores,
 * and recall/plan-context read those stores directly. This deliberately does no
 * filesystem scan so retired non-store roots are never treated as a current
 * source of truth.
 */
export async function ensureKnowledgeFresh(
  projectRoot: string,
  opts?: KnowledgeSyncOptions,
): Promise<KnowledgeSyncReport> {
  void opts;
  freshSyncCooldown.set(projectRoot, Date.now() + SYNC_COOLDOWN_MS);
  return { status: "fresh", events: [], warnings: [] };
}
