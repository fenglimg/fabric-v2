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
import { join, relative, sep } from "node:path";

import { RuleValidationError } from "@fenglimg/fabric-shared/errors";

import { contextCache } from "../cache.js";
import { appendEventLedgerEvent } from "./event-ledger.js";
import { sha256 } from "./_shared.js";
import { writeKnowledgeMeta } from "./knowledge-meta-builder.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface KnowledgeSyncOptions {
  mode?: "incremental" | "full";
  /** When true, invalid frontmatter throws RuleValidationError (default: false — collect as warning). */
  throwOnInvalidFrontmatter?: boolean;
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

async function findRuleFiles(projectRoot: string): Promise<string[]> {
  const knowledgeRoot = join(projectRoot, ".fabric", "knowledge");

  if (!existsSync(knowledgeRoot) || !statSync(knowledgeRoot).isDirectory()) {
    return [];
  }

  const files: string[] = [];
  const stack = [knowledgeRoot];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }

    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolutePath = join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const rel = toPosixPath(relative(projectRoot, absolutePath));
        files.push(rel);
      }
    }
  }

  return files.sort();
}

function toPosixPath(p: string): string {
  return p.split(sep).join("/");
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
        actionHint: "Run `fab doctor --fix` to repair frontmatter",
        fixable: true,
        details: { file: filePath },
      });
    }

    return {
      code: "rule_frontmatter_invalid",
      file: filePath,
      action_hint: "Run `fab doctor --fix` to repair frontmatter",
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
          actionHint: "Run `fab doctor --fix` to repair frontmatter",
          fixable: true,
          details: { file: filePath, line: trimmed },
        });
      }

      return {
        code: "rule_frontmatter_invalid",
        file: filePath,
        action_hint: "Run `fab doctor --fix` to repair frontmatter",
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
  const absPath = join(projectRoot, relPath);

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

  // Check for removals: meta entries whose files no longer exist on disk
  for (const [relPath, entry] of metaEntries) {
    if (!ruleFiles.includes(relPath)) {
      const absPath = join(projectRoot, relPath);
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

  const status = warnings.length > 0 ? "errors" : "reconciled";

  return {
    status,
    events,
    warnings,
    reconciled_files: events.map((e) => e.path),
  };
}

export interface ReconcileKnowledgeOptions {
  /** Identifies who triggered the reconcile; controls which summary ledger event is written. */
  trigger?: "startup" | "doctor" | "manual";
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

  // Check for removals
  for (const [relPath, entry] of metaEntries) {
    if (!ruleFiles.includes(relPath)) {
      const absPath = join(projectRoot, relPath);
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

  // High 2: Rewrite agents.meta.json with ground-truth disk state when drift detected.
  // writeKnowledgeMeta rebuilds from disk (hashes, stable_ids, paths) and writes atomically.
  if (events.length > 0) {
    await writeKnowledgeMeta(projectRoot, { source: "sync_meta" });
    await appendRuleSyncEvents(projectRoot, events);
    contextCache.invalidate("file_watch", projectRoot);
  }

  const duration_ms = Date.now() - startTime;
  const reconciledFiles = events.map((e) => e.path);

  // Emit summary ledger event when a trigger is specified and drift was found.
  if (trigger !== undefined && events.length > 0) {
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
      });
    }
  }

  if (events.length === 0 && warnings.length === 0) {
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
