/**
 * rule-sync.ts — Rule-sync orchestrator framework (R28, TASK-011)
 *
 * Public surface: ensureRulesFresh, reconcileRules + exported types.
 * Internal helpers are co-located in this file.
 * Does NOT wire any consumers (MCP tools, doctor, watchers).
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { RuleValidationError } from "@fenglimg/fabric-shared/errors";

import { contextCache } from "../cache.js";
import { appendEventLedgerEvent } from "./event-ledger.js";
import { sha256 } from "./_shared.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RuleSyncOptions {
  mode?: "incremental" | "full";
}

export interface StructuredWarning {
  code: string;
  file: string;
  line?: number;
  action_hint: string;
}

/**
 * Granular ledger event shape for rule-sync operations.
 * These are returned in RuleSyncReport and also appended to the event ledger
 * using the nearest available ledger event type (rule_drift_detected /
 * baseline_synced). The shape below is what callers receive in `.events`.
 */
export interface RuleSyncLedgerEvent {
  type: "rule_content_changed" | "rule_added" | "rule_removed";
  stable_id: string;
  path: string;
  prev_hash: string | null;
  new_hash: string | null;
  changed_fields: string[];
  source: "ensureRulesFresh" | "reconcileRules";
}

/** Alias so the public API says LedgerEvent (as documented). */
export type LedgerEvent = RuleSyncLedgerEvent;

export interface RuleSyncReport {
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
  const rulesRoot = join(projectRoot, ".fabric", "rules");

  if (!existsSync(rulesRoot) || !statSync(rulesRoot).isDirectory()) {
    return [];
  }

  const files: string[] = [];
  const stack = [rulesRoot];

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

function validateFrontmatter(source: string, filePath: string): void {
  // If the file starts with frontmatter delimiter, attempt basic YAML parse
  if (!source.startsWith("---")) {
    return;
  }

  const endIdx = source.indexOf("\n---", 3);
  if (endIdx === -1) {
    throw new RuleValidationError(
      `Unterminated YAML frontmatter in ${filePath}`,
      {
        actionHint: "Run `fab doctor --fix` to repair frontmatter",
        fixable: true,
        details: { file: filePath },
      },
    );
  }

  const frontmatter = source.slice(3, endIdx).trim();

  // Detect obviously broken YAML: unbalanced braces / colons in wrong positions
  for (const line of frontmatter.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    // A valid YAML scalar line must have key: value or be a list item
    if (!trimmed.includes(":") && !trimmed.startsWith("-")) {
      throw new RuleValidationError(
        `Invalid YAML frontmatter line "${trimmed}" in ${filePath}`,
        {
          actionHint: "Run `fab doctor --fix` to repair frontmatter",
          fixable: true,
          details: { file: filePath, line: trimmed },
        },
      );
    }
  }
}

async function processSingleFile(
  projectRoot: string,
  relPath: string,
  metaEntry: MetaEntry | undefined,
  source: "ensureRulesFresh" | "reconcileRules",
): Promise<RuleSyncLedgerEvent | null> {
  const absPath = join(projectRoot, relPath);

  let diskMtime: number;
  try {
    const s = await stat(absPath);
    diskMtime = s.mtimeMs;
  } catch {
    // File was removed
    if (metaEntry !== undefined) {
      return {
        type: "rule_removed",
        stable_id: metaEntry.stable_id,
        path: relPath,
        prev_hash: metaEntry.content_hash,
        new_hash: null,
        changed_fields: ["content"],
        source,
      };
    }

    return null;
  }

  let content: string;
  try {
    content = await readFile(absPath, "utf8");
  } catch {
    return null;
  }

  const newHash = sha256(content);
  const now = Date.now();
  const debounce = lastSyncState.get(relPath);

  // Debounce: if last sync was < 500ms ago AND hash is the same as we last saw, skip
  if (debounce !== undefined && now - debounce.ts < 500 && newHash === debounce.hash) {
    return null;
  }

  // Hash-identical save: content matches meta on disk -> no event (but record check)
  if (metaEntry !== undefined && newHash === metaEntry.content_hash) {
    lastSyncState.set(relPath, { ts: now, hash: newHash });
    return null;
  }

  // Content changed — validate frontmatter before emitting (throws on invalid)
  validateFrontmatter(content, relPath);

  const prevHash = metaEntry?.content_hash ?? debounce?.hash ?? null;
  const stableId = metaEntry?.stable_id ?? relPath;
  const eventType: RuleSyncLedgerEvent["type"] = metaEntry === undefined ? "rule_added" : "rule_content_changed";

  lastSyncState.set(relPath, { ts: now, hash: newHash });

  return {
    type: eventType,
    stable_id: stableId,
    path: relPath,
    prev_hash: prevHash,
    new_hash: newHash,
    changed_fields: ["content"],
    source,
  };
}

async function appendRuleSyncEvents(projectRoot: string, events: RuleSyncLedgerEvent[]): Promise<void> {
  if (events.length === 0) {
    return;
  }

  const driftedIds = events.map((e) => e.stable_id);
  const missingFiles = events.filter((e) => e.type === "rule_removed").map((e) => e.path);
  const staleFiles = events.filter((e) => e.type !== "rule_removed").map((e) => e.path);

  if (missingFiles.length > 0 || staleFiles.length > 0) {
    await appendEventLedgerEvent(projectRoot, {
      event_type: "rule_drift_detected",
      drifted_stable_ids: driftedIds,
      missing_files: missingFiles,
      stale_files: staleFiles,
    });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function ensureRulesFresh(
  projectRoot: string,
  opts?: RuleSyncOptions,
): Promise<RuleSyncReport> {
  const mode = opts?.mode ?? "incremental";
  const source = "ensureRulesFresh";
  const events: RuleSyncLedgerEvent[] = [];
  const warnings: StructuredWarning[] = [];

  const metaEntries = await readMetaEntries(projectRoot);
  const ruleFiles = await findRuleFiles(projectRoot);

  const filesToCheck = mode === "full"
    ? ruleFiles
    : ruleFiles.filter((f) => {
        // In incremental mode include: new files (no meta) + files we haven't checked recently
        const debounce = lastSyncState.get(f);
        return debounce === undefined || Date.now() - debounce.ts >= 500;
      });

  for (const relPath of filesToCheck) {
    const metaEntry = metaEntries.get(relPath);
    const event = await processSingleFile(projectRoot, relPath, metaEntry, source);
    if (event !== null) {
      events.push(event);
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
    return { status: "fresh", events: [], warnings: [] };
  }

  if (events.length > 0) {
    await appendRuleSyncEvents(projectRoot, events);
    contextCache.invalidate("file_watch", projectRoot);
  }

  return {
    status: warnings.length > 0 ? "errors" : "reconciled",
    events,
    warnings,
    reconciled_files: events.map((e) => e.path),
  };
}

export async function reconcileRules(projectRoot: string): Promise<RuleSyncReport> {
  return ensureRulesFresh(projectRoot, { mode: "full" });
}
