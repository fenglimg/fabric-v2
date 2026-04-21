/**
 * ContextCache — unified hot-path cache for the Fabric server.
 *
 * Three logical slots:
 *   1. "meta"    — agents.meta.json content (TTL-based, default 5 s)
 *   2. "context" — GetRulesContext per projectRoot (TTL-based, default 5 s)
 *   3. "audit"   — sliding-window byte-offset cursor for audit.jsonl reads
 *
 * Invalidation reasons:
 *   - "meta_write"  — eager invalidation when a write service mutates agents.meta.json
 *   - "file_watch"  — chokidar detected an on-disk change
 */

export type InvalidationReason = "meta_write" | "file_watch";

type CacheEntry<T> = {
  value: T;
  expiresAt: number; // ms timestamp; 0 = never expires (invalidation-only)
};

export type AuditCursor = {
  offset: number;
  remainder: string;
  windowEntries: Array<{ ts: number }>;
};

export class ContextCache {
  // Slot 1: raw AgentsMeta keyed by projectRoot
  private readonly metaSlot = new Map<string, CacheEntry<unknown>>();

  // Slot 2: GetRulesContext keyed by projectRoot
  private readonly contextSlot = new Map<string, CacheEntry<unknown>>();

  // Slot 3: audit sliding-window cursor keyed by projectRoot
  private readonly auditSlot = new Map<string, AuditCursor>();

  constructor(private readonly defaultTtlMs: number = 5_000) {}

  // ---------------------------------------------------------------------------
  // Generic get / set / invalidate
  // ---------------------------------------------------------------------------

  get<T>(slot: "meta" | "context", key: string): T | undefined {
    const store = this.slotStore(slot);
    const entry = store.get(key) as CacheEntry<T> | undefined;

    if (entry === undefined) {
      return undefined;
    }

    if (entry.expiresAt !== 0 && Date.now() > entry.expiresAt) {
      store.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set<T>(slot: "meta" | "context", key: string, value: T, ttlMs?: number): void {
    const store = this.slotStore(slot);
    const resolvedTtl = ttlMs ?? this.defaultTtlMs;
    const expiresAt = resolvedTtl > 0 ? Date.now() + resolvedTtl : 0;

    store.set(key, { value, expiresAt });
  }

  // ---------------------------------------------------------------------------
  // Audit cursor (separate API — not TTL-based)
  // ---------------------------------------------------------------------------

  getAuditCursor(projectRoot: string): AuditCursor | undefined {
    return this.auditSlot.get(projectRoot);
  }

  setAuditCursor(projectRoot: string, cursor: AuditCursor): void {
    this.auditSlot.set(projectRoot, cursor);
  }

  resetAuditCursor(projectRoot: string): void {
    this.auditSlot.delete(projectRoot);
  }

  // ---------------------------------------------------------------------------
  // Invalidation
  // ---------------------------------------------------------------------------

  /**
   * Invalidate cache slots based on what changed.
   *
   * @param reason  "meta_write"  — only the meta slot for this projectRoot
   *                "file_watch"  — meta + context slots (AGENTS.md may have changed)
   * @param projectRoot  Optional; if omitted, clears ALL keys in affected slots.
   */
  invalidate(reason: InvalidationReason, projectRoot?: string): void {
    if (reason === "meta_write") {
      if (projectRoot !== undefined) {
        this.metaSlot.delete(projectRoot);
      } else {
        this.metaSlot.clear();
      }
      return;
    }

    // "file_watch" — clear both meta and context
    if (projectRoot !== undefined) {
      this.metaSlot.delete(projectRoot);
      this.contextSlot.delete(projectRoot);
    } else {
      this.metaSlot.clear();
      this.contextSlot.clear();
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private slotStore(slot: "meta" | "context"): Map<string, CacheEntry<unknown>> {
    return slot === "meta" ? this.metaSlot : this.contextSlot;
  }
}

// Module-level singleton — import and use directly.
export const contextCache = new ContextCache(5_000);
