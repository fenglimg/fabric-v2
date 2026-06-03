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

  // v2.2 MC1-recall-pack (W2-T4): packaging increments + include_related.
  async function seedRelatedProject(): Promise<string> {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    await mkdir(join(projectRoot, ".fabric", "knowledge", "guidelines"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);
    // auth declares a top-level `related` graph edge to the ui guideline.
    await writeFile(
      join(projectRoot, ".fabric", "knowledge", "decisions", "auth.md"),
      ["---", "stable_id: decisions/auth", "summary: Auth decision", "type: decision", "maturity: verified", "layer: team", "related: [guidelines/ui]", "---", "# Auth body", ""].join("\n"),
    );
    await writeFile(
      join(projectRoot, ".fabric", "knowledge", "guidelines", "ui.md"),
      ["---", "stable_id: guidelines/ui", "summary: UI guideline", "type: guideline", "maturity: verified", "layer: team", "---", "# UI body", ""].join("\n"),
    );
    const { writeKnowledgeMeta } = await import("./knowledge-meta-builder.js");
    await writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });
    return projectRoot;
  }

  it("always returns a cite directive in the packaging", async () => {
    const projectRoot = await seedTwoEntryProject();
    const result = await recall(projectRoot, { paths: ["src/index.ts"] });
    expect(result.directive).toMatch(/cite the KB id/i);
  });

  it("include_related expands a scoped recall to fetch the related neighbour", async () => {
    const projectRoot = await seedRelatedProject();

    // Scope to auth only, but ask for its related graph neighbours.
    const result = await recall(projectRoot, {
      paths: ["src/index.ts"],
      ids: ["decisions/auth"],
      include_related: true,
    });

    // auth + its related guidelines/ui both fetched.
    expect(result.selected_stable_ids.sort()).toEqual(["decisions/auth", "guidelines/ui"]);
  });

  it("hints via next_steps that related entries exist when not included", async () => {
    const projectRoot = await seedRelatedProject();

    const result = await recall(projectRoot, {
      paths: ["src/index.ts"],
      ids: ["decisions/auth"],
    });

    // Only auth fetched, but the packaging nudges include_related.
    expect(result.selected_stable_ids).toEqual(["decisions/auth"]);
    expect(result.next_steps ?? []).toEqual(
      expect.arrayContaining([expect.stringMatching(/include_related:true/)]),
    );
  });

  // lifecycle-refactor W3-T4 (§2 store 轴 / store-qualified 观测 / D7): recall rules
  // carry store provenance derived from the (cross-store-stamped) `<alias>:<id>`
  // prefix. Project-local entries (bare id) omit the field.
  it("omits store provenance for project-local rules (bare ids)", async () => {
    const projectRoot = await seedTwoEntryProject();
    const result = await recall(projectRoot, { paths: ["src/index.ts"] });
    // All rules are project-local → no `store` field synthesized.
    expect(result.rules.length).toBeGreaterThan(0);
    for (const rule of result.rules) {
      expect(rule).not.toHaveProperty("store");
    }
  });

  it("attaches store provenance derived from a `<alias>:<id>` cross-store qualifier", async () => {
    // Unit on the pure derivation: cross-store-recall stamps `<alias>:<id>`, and
    // attachStoreProvenance surfaces that alias as a structured field; a bare id
    // yields no field.
    const { attachStoreProvenance } = await import("./recall.js");
    expect(attachStoreProvenance({ stable_id: "team:KT-DEC-0001", body: "x" })).toEqual({
      stable_id: "team:KT-DEC-0001",
      body: "x",
      store: { alias: "team" },
    });
    expect(attachStoreProvenance({ stable_id: "KT-DEC-0001", body: "x" })).toEqual({
      stable_id: "KT-DEC-0001",
      body: "x",
    });
  });

  it("surfaces a truncation summary + next_steps hint when the budget omits candidates", async () => {
    const projectRoot = await seedTwoEntryProject();
    // top_k=1 over two candidates → one omitted by the retrieval budget.
    await writeFile(join(projectRoot, "fabric.config.json"), `${JSON.stringify({ plan_context_top_k: 1 })}\n`);

    const result = await recall(projectRoot, { paths: ["src/index.ts"] });

    expect(result.truncation).toEqual({ omitted_candidate_count: 1, returned_candidate_count: 1 });
    expect(result.next_steps ?? []).toEqual(
      expect.arrayContaining([expect.stringMatching(/omitted by the retrieval budget/)]),
    );
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
