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

import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { RuleValidationError } from "@fenglimg/fabric-shared/errors";

import { contextCache } from "../cache.js";
import { appendEventLedgerEvent } from "./event-ledger.js";
import { sha256 } from "./_shared.js";

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
  /** When true, invalid frontmatter throws RuleValidationError (default: false — collect as warning). */
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
 * Retired rule scan. Store-backed read paths walk mounted stores directly;
 * this compatibility helper must not enumerate non-store knowledge roots.
 */
async function findRuleFiles(projectRoot: string): Promise<string[]> {
  void projectRoot;
  return [];
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
  // Compatibility path only. resolveContentRefPath now rejects retired
  // non-store content_refs, so this cannot read legacy roots.
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
