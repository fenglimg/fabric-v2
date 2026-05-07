/**
 * startup-rule-sync.test.ts — TASK-022
 *
 * Verifies that reconcileRules({ trigger: 'startup' }) performs a full consistency
 * scan before the server accepts MCP requests, making rules added while the server
 * was offline immediately visible.
 *
 * Test matrix:
 *   1. Stale meta + offline rule addition -> status 'reconciled', agents.meta.json updated
 *   2. meta_reconciled_on_startup ledger event written with reconciled_files + duration_ms
 *   3. Subsequent reconcileRules call returns 'fresh' (no further drift)
 *   4. trigger='doctor' emits meta_reconciled (not meta_reconciled_on_startup)
 *   5. No trigger -> no summary event (only per-file drift events)
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { reconcileRules } from "../src/services/rule-sync.js";
import { readEventLedger } from "../src/services/event-ledger.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "fabric-startup-sync-"));
}

function setupProjectRoot(dir: string): void {
  mkdirSync(join(dir, ".fabric", "rules"), { recursive: true });
  mkdirSync(join(dir, ".fabric", "bootstrap"), { recursive: true });
}

function writeRuleFile(dir: string, name: string, content: string): void {
  writeFileSync(join(dir, ".fabric", "rules", name), content, "utf8");
}

/**
 * Write a stale agents.meta.json that does NOT include the given rule file.
 * Simulates the state after the server was offline and a new rule was added.
 */
function writeStaleAgentsMeta(dir: string, staleContent: object): void {
  const metaPath = join(dir, ".fabric", "agents.meta.json");
  writeFileSync(metaPath, JSON.stringify(staleContent, null, 2), "utf8");
}

function readAgentsMeta(dir: string): Record<string, unknown> {
  const metaPath = join(dir, ".fabric", "agents.meta.json");
  return JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("startup rule sync — reconcileRules({ trigger: 'startup' })", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });

  function makeTmp(): string {
    const dir = makeTempRoot();
    tempDirs.push(dir);
    setupProjectRoot(dir);
    return dir;
  }

  it("returns status 'reconciled' when an offline-added rule is not in agents.meta.json", async () => {
    const root = makeTmp();

    // Rule added while server was offline
    writeRuleFile(root, "foo.md", "# Foo rule\n\nThis rule was added offline.");

    // Stale meta that doesn't mention foo.md at all
    writeStaleAgentsMeta(root, {
      schema_version: 1,
      nodes: {},
    });

    const report = await reconcileRules(root, { trigger: "startup" });

    expect(report.status).toBe("reconciled");
    expect(report.events.length).toBeGreaterThan(0);

    // The offline-added rule appears in reconciled_files
    const reconciledPaths = report.reconciled_files ?? [];
    expect(reconciledPaths.some((p) => p.includes("foo.md"))).toBe(true);
  });

  it("rewrites agents.meta.json so foo.md is reflected after startup reconcile", async () => {
    const root = makeTmp();

    writeRuleFile(root, "foo.md", "# Foo rule\n\nOffline addition.");
    writeStaleAgentsMeta(root, { schema_version: 1, nodes: {} });

    await reconcileRules(root, { trigger: "startup" });

    const meta = readAgentsMeta(root);
    const nodes = meta.nodes as Record<string, unknown>;
    // At least one node should reference foo.md
    const hasFoo = Object.values(nodes).some((node) => {
      const n = node as Record<string, unknown>;
      return (
        (typeof n.content_ref === "string" && n.content_ref.includes("foo.md")) ||
        (typeof n.file === "string" && n.file.includes("foo.md"))
      );
    });
    expect(hasFoo).toBe(true);
  });

  it("appends a meta_reconciled_on_startup ledger event with reconciled_files and duration_ms", async () => {
    const root = makeTmp();

    writeRuleFile(root, "bar.md", "# Bar rule\n\nAnother offline rule.");
    writeStaleAgentsMeta(root, { schema_version: 1, nodes: {} });

    const beforeMs = Date.now();
    await reconcileRules(root, { trigger: "startup" });
    const afterMs = Date.now();

    const { events } = await readEventLedger(root);
    const startupEvents = events.filter((e) => e.event_type === "meta_reconciled_on_startup");

    expect(startupEvents.length).toBeGreaterThanOrEqual(1);

    const evt = startupEvents[startupEvents.length - 1];
    expect(evt.event_type).toBe("meta_reconciled_on_startup");

    // Type narrowing — the discriminated union ensures these fields exist
    if (evt.event_type === "meta_reconciled_on_startup") {
      expect(Array.isArray(evt.reconciled_files)).toBe(true);
      expect(evt.reconciled_files.some((p) => p.includes("bar.md"))).toBe(true);
      expect(typeof evt.duration_ms).toBe("number");
      expect(evt.duration_ms).toBeGreaterThanOrEqual(0);
      expect(evt.duration_ms).toBeLessThanOrEqual(afterMs - beforeMs + 500);
      expect(evt.source).toBe("reconcileRules");
    }
  });

  it("returns status 'fresh' on a subsequent reconcileRules call after the meta write", async () => {
    const root = makeTmp();

    writeRuleFile(root, "baz.md", "# Baz rule\n\nWill be reconciled.");
    writeStaleAgentsMeta(root, { schema_version: 1, nodes: {} });

    // First call — should reconcile
    const first = await reconcileRules(root, { trigger: "startup" });
    expect(first.status).toBe("reconciled");

    // Second call — meta is now up-to-date; hash unchanged -> fresh
    // We wait slightly beyond the 500ms debounce window to guarantee the
    // time-based guard is clear.  In practice the debounce check already
    // skips because hash-equal; we add the wait for determinism.
    await new Promise<void>((res) => setTimeout(res, 510));
    const second = await reconcileRules(root, { trigger: "startup" });
    expect(second.status).toBe("fresh");
  });

  it("trigger='doctor' emits meta_reconciled (not meta_reconciled_on_startup)", async () => {
    const root = makeTmp();

    writeRuleFile(root, "doc.md", "# Doctor rule\n\nFor doctor trigger.");
    writeStaleAgentsMeta(root, { schema_version: 1, nodes: {} });

    await reconcileRules(root, { trigger: "doctor" });

    const { events } = await readEventLedger(root);

    const startupEvents = events.filter((e) => e.event_type === "meta_reconciled_on_startup");
    const doctorEvents = events.filter((e) => e.event_type === "meta_reconciled");

    expect(startupEvents.length).toBe(0);
    expect(doctorEvents.length).toBeGreaterThanOrEqual(1);

    const evt = doctorEvents[doctorEvents.length - 1];
    if (evt.event_type === "meta_reconciled") {
      expect(evt.trigger).toBe("doctor");
      expect(evt.source).toBe("reconcileRules");
      expect(Array.isArray(evt.reconciled_files)).toBe(true);
    }
  });

  it("no trigger -> no meta_reconciled_on_startup summary event written", async () => {
    const root = makeTmp();

    writeRuleFile(root, "notrig.md", "# No trigger rule.");
    writeStaleAgentsMeta(root, { schema_version: 1, nodes: {} });

    await reconcileRules(root); // no opts

    const { events } = await readEventLedger(root);
    const startupEvents = events.filter((e) => e.event_type === "meta_reconciled_on_startup");
    const reconcileEvents = events.filter((e) => e.event_type === "meta_reconciled");

    expect(startupEvents.length).toBe(0);
    expect(reconcileEvents.length).toBe(0);
  });

  it("returns 'fresh' immediately when meta is already consistent (no events emitted)", async () => {
    const root = makeTmp();
    // No rule files, no meta nodes -> nothing to reconcile
    writeStaleAgentsMeta(root, { schema_version: 1, nodes: {} });

    const report = await reconcileRules(root, { trigger: "startup" });
    expect(report.status).toBe("fresh");
    expect(report.events).toHaveLength(0);

    // No startup event when nothing was reconciled
    const { events } = await readEventLedger(root);
    const startupEvents = events.filter((e) => e.event_type === "meta_reconciled_on_startup");
    expect(startupEvents.length).toBe(0);
  });
});
