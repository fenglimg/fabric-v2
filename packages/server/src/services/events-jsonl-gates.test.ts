// v2.0.0-rc.37 Wave B (B5): inspections + structural invariant tests for the
// 5 events.jsonl / metrics.jsonl hard gates (G7-G11).
import { mkdtemp, rm, writeFile, mkdir, appendFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  inspectEventsJsonlGates,
  EVENTS_JSONL_GATE_THRESHOLDS,
} from "./events-jsonl-gates.js";
import { METRIC_COUNTER_NAMES } from "./metrics.js";
import { eventLedgerEventSchema } from "@fenglimg/fabric-shared";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

async function createTempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fabric-events-gates-"));
  tempDirs.push(root);
  await mkdir(join(root, ".fabric"), { recursive: true });
  return root;
}

describe("events-jsonl-gates inspection (Wave B B5)", () => {
  it("G7 ledgerSizeWarn fires when events.jsonl exceeds threshold", async () => {
    const projectRoot = await createTempProject();
    const path = join(projectRoot, ".fabric", "events.jsonl");
    // Write > 10MB of padding
    const big = "x".repeat(EVENTS_JSONL_GATE_THRESHOLDS.EVENTS_JSONL_SIZE_WARN_BYTES + 1);
    await writeFile(path, big);
    const report = await inspectEventsJsonlGates(projectRoot);
    expect(report.ledgerSizeBytes).toBeGreaterThan(
      EVENTS_JSONL_GATE_THRESHOLDS.EVENTS_JSONL_SIZE_WARN_BYTES,
    );
    expect(report.ledgerSizeWarn).toBe(true);
  });

  it("G8 metricLeakCount fires when METRIC_COUNTER_NAMES leak into events.jsonl", async () => {
    const projectRoot = await createTempProject();
    const path = join(projectRoot, ".fabric", "events.jsonl");
    const leakedRow = {
      kind: "fabric-event",
      id: "event:leak-1",
      ts: Date.now(),
      schema_version: 1,
      event_type: METRIC_COUNTER_NAMES.knowledge_consumed,
      stable_id: "KT-DEC-0001",
      consumed_at: new Date().toISOString(),
      client_hash: "",
    };
    await writeFile(path, `${JSON.stringify(leakedRow)}\n`);
    const report = await inspectEventsJsonlGates(projectRoot);
    expect(report.metricLeakCount).toBe(1);
    expect(report.metricLeakSamples).toContain(METRIC_COUNTER_NAMES.knowledge_consumed);
  });

  it("G9 metricsStaleWarn fires when metrics.jsonl mtime is stale", async () => {
    const projectRoot = await createTempProject();
    const path = join(projectRoot, ".fabric", "metrics.jsonl");
    await writeFile(path, "{}\n");
    // Back-date mtime past the staleness threshold
    const stale = new Date(Date.now() - 20 * 60 * 1000);
    await utimes(path, stale, stale);
    const report = await inspectEventsJsonlGates(projectRoot);
    expect(report.metricsStaleWarn).toBe(true);
  });

  it("G10 rotationOverdueWarn fires when events.jsonl mtime > 90d old", async () => {
    const projectRoot = await createTempProject();
    const path = join(projectRoot, ".fabric", "events.jsonl");
    await writeFile(path, "");
    const oldDate = new Date(Date.now() - 91 * 86_400_000);
    await utimes(path, oldDate, oldDate);
    const report = await inspectEventsJsonlGates(projectRoot);
    expect(report.rotationOverdueWarn).toBe(true);
  });

  it("clean state — no gates fire when files are absent or healthy", async () => {
    const projectRoot = await createTempProject();
    const report = await inspectEventsJsonlGates(projectRoot);
    expect(report.ledgerSizeBytes).toBe(0);
    expect(report.ledgerSizeWarn).toBe(false);
    expect(report.metricLeakCount).toBe(0);
    expect(report.metricsStaleWarn).toBe(false);
    expect(report.rotationOverdueWarn).toBe(false);
  });

  it("scales — multiple metric event_types leaked are all captured", async () => {
    const projectRoot = await createTempProject();
    const path = join(projectRoot, ".fabric", "events.jsonl");
    const rows = [
      {
        kind: "fabric-event",
        id: "event:1",
        ts: Date.now(),
        schema_version: 1,
        event_type: METRIC_COUNTER_NAMES.knowledge_consumed,
        stable_id: "KT-DEC-0001",
        consumed_at: new Date().toISOString(),
        client_hash: "",
      },
      {
        kind: "fabric-event",
        id: "event:2",
        ts: Date.now(),
        schema_version: 1,
        event_type: METRIC_COUNTER_NAMES.knowledge_sections_fetched,
        selection_token: "tok",
        target_paths: [],
        requested_sections: [],
        final_stable_ids: [],
        ai_selected_stable_ids: [],
        diagnostics: [],
      },
    ];
    for (const row of rows) {
      await appendFile(path, `${JSON.stringify(row)}\n`);
    }
    const report = await inspectEventsJsonlGates(projectRoot);
    expect(report.metricLeakCount).toBe(2);
    expect(report.metricLeakSamples).toContain(METRIC_COUNTER_NAMES.knowledge_consumed);
    expect(report.metricLeakSamples).toContain(METRIC_COUNTER_NAMES.knowledge_sections_fetched);
  });
});

describe("G11 structural invariant — METRIC_COUNTER_NAMES vs eventLedgerEventSchema", () => {
  it("(currently informational) METRIC_COUNTER_NAMES overlaps eventLedgerEventSchema discriminator literals because rc.37 Wave B ran a dual-write migration. Post-GA cutover (rc.38+) MUST move the overlap to ZERO — this test fails-loud at that point.", () => {
    const counterNames = new Set<string>(Object.values(METRIC_COUNTER_NAMES));
    const ledgerEventTypes = new Set<string>();
    for (const opt of eventLedgerEventSchema.options) {
      const shape = (opt as { shape: { event_type: { value: string } } }).shape;
      if (shape && typeof shape.event_type?.value === "string") {
        ledgerEventTypes.add(shape.event_type.value);
      }
    }
    const overlap = [...counterNames].filter((name) => ledgerEventTypes.has(name));
    // v2.0.0-rc.37 dual-write: every METRIC_COUNTER_NAMES entry is ALSO an
    // event_type literal because the audit consumer hasn't migrated yet. This
    // assertion records that current state; post-GA the assertion below
    // should be flipped to `expect(overlap).toEqual([])`. Until then, just
    // document the count so a stray addition that overlaps unexpectedly
    // still surfaces.
    expect(overlap.length).toBe(counterNames.size);
  });
});
