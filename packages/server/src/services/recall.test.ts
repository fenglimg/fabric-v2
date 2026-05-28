import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recall } from "./recall.js";
import { readEventLedger } from "./event-ledger.js";
import { contextCache } from "../cache.js";

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-recall-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
  contextCache.invalidate("file_watch");
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

async function createTempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fabric-recall-proj-"));
  tempDirs.push(root);
  return root;
}

async function seedTwoEntryProject(): Promise<string> {
  const projectRoot = await createTempProject();
  await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
  await mkdir(join(projectRoot, ".fabric", "knowledge", "guidelines"), { recursive: true });
  await writeFile(
    join(projectRoot, ".fabric", "human-lock.json"),
    `${JSON.stringify({ locked: [] }, null, 2)}\n`,
  );
  await writeFile(
    join(projectRoot, ".fabric", "knowledge", "decisions", "auth.md"),
    [
      "---",
      "stable_id: decisions/auth",
      "knowledge_type: decision",
      "maturity: verified",
      "knowledge_layer: team",
      "description:",
      "  summary: Auth decision",
      "  intent_clues: [auth]",
      "  tech_stack: [TypeScript]",
      "  impact: []",
      "  must_read_if: editing auth",
      "---",
      "# Auth body",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(projectRoot, ".fabric", "knowledge", "guidelines", "ui.md"),
    [
      "---",
      "stable_id: guidelines/ui",
      "knowledge_type: guideline",
      "maturity: verified",
      "knowledge_layer: team",
      "description:",
      "  summary: UI guideline",
      "  intent_clues: [ui]",
      "  tech_stack: []",
      "  impact: []",
      "  must_read_if: editing UI",
      "---",
      "# UI body",
      "",
    ].join("\n"),
  );
  const { writeKnowledgeMeta } = await import("./knowledge-meta-builder.js");
  await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });
  return projectRoot;
}

describe("recall (one-call combined service — NEW-3)", () => {
  it("returns plan envelope + full bodies for every surfaced entry when `ids` omitted", async () => {
    const projectRoot = await seedTwoEntryProject();

    const result = await recall(projectRoot, {
      paths: ["src/index.ts"],
      intent: "auth refactor",
      correlation_id: "corr-recall-1",
      session_id: "session-recall-1",
    });

    // Plan envelope preserved
    expect(result.revision_hash).toEqual(expect.any(String));
    expect(result.selection_token).toEqual(expect.any(String));
    expect(result.entries).toHaveLength(1);
    expect(result.candidates.map((item) => item.stable_id).sort()).toEqual([
      "decisions/auth",
      "guidelines/ui",
    ]);

    // Bodies fetched for ALL surfaced ids
    expect(result.selected_stable_ids.sort()).toEqual(["decisions/auth", "guidelines/ui"]);
    expect(result.rules.map((rule) => rule.stable_id).sort()).toEqual([
      "decisions/auth",
      "guidelines/ui",
    ]);
    const authRule = result.rules.find((rule) => rule.stable_id === "decisions/auth");
    expect(authRule?.body).toContain("# Auth body");

    // Ledger emitted both plan + sections + consumed events
    const planned = await readEventLedger(projectRoot, { event_type: "knowledge_context_planned" });
    expect(planned.events).toHaveLength(1);
    const fetched = await readEventLedger(projectRoot, { event_type: "knowledge_sections_fetched" });
    expect(fetched.events).toHaveLength(1);
    const consumed = await readEventLedger(projectRoot, { event_type: "knowledge_consumed" });
    expect(consumed.events.map((e) => (e as { stable_id?: string }).stable_id).sort()).toEqual([
      "decisions/auth",
      "guidelines/ui",
    ]);
  });

  it("scopes fetched bodies when `ids` provided + intersects against surfaced candidates", async () => {
    const projectRoot = await seedTwoEntryProject();

    const result = await recall(projectRoot, {
      paths: ["src/index.ts"],
      ids: ["decisions/auth", "non-existent-id"],
    });

    // Only the intersection of `ids` and surfaced candidates loads.
    expect(result.selected_stable_ids).toEqual(["decisions/auth"]);
    expect(result.rules.map((rule) => rule.stable_id)).toEqual(["decisions/auth"]);
    // But the shared description_index still shows the full candidate set —
    // callers can re-fetch the skipped ones via fab_get_knowledge_sections
    // against the same selection_token.
    expect(result.candidates.map((item) => item.stable_id).sort()).toEqual([
      "decisions/auth",
      "guidelines/ui",
    ]);
  });

  it("returns empty rules + diagnostics array when no candidates surface (no spurious fetch call)", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric"), { recursive: true });
    await writeFile(
      join(projectRoot, ".fabric", "human-lock.json"),
      `${JSON.stringify({ locked: [] }, null, 2)}\n`,
    );
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({ revision: "rev-empty", nodes: {} }, null, 2)}\n`,
    );

    const result = await recall(projectRoot, { paths: ["src/index.ts"] });

    expect(result.rules).toEqual([]);
    expect(result.selected_stable_ids).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.selection_token).toEqual(expect.any(String));

    // No knowledge_sections_fetched / knowledge_consumed should fire on the
    // empty-fetch fast-path.
    const fetched = await readEventLedger(projectRoot, { event_type: "knowledge_sections_fetched" });
    expect(fetched.events).toEqual([]);
    const consumed = await readEventLedger(projectRoot, { event_type: "knowledge_consumed" });
    expect(consumed.events).toEqual([]);
  });
});
