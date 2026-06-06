import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  STORE_LAYOUT,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePath,
} from "@fenglimg/fabric-shared";

import { recall } from "./recall.js";
import { readEventLedger } from "./event-ledger.js";
import { contextCache } from "../cache.js";

// v2.2 W5 R2/R7 (agents.meta decolo): recall delegates to planContext, which no
// longer reads the project's co-location `.fabric/knowledge/` tree or
// `agents.meta.json`. Candidates come SOLELY from the mounted stores in the
// read-set, assembled live by buildCrossStoreRawItems, and every candidate id is
// store-qualified (`<alias>:<stable_id>`). The fixtures below seed knowledge
// .md files directly into a team store under an isolated ~/.fabric.

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

const TEAM_STORE = "11111111-1111-4111-8111-111111111111";

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

/** mkdtemp a project root declaring the team store as required. */
async function createTempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fabric-recall-proj-"));
  tempDirs.push(root);
  await mkdir(join(root, ".fabric"), { recursive: true });
  await writeFile(
    join(root, ".fabric", "fabric-config.json"),
    `${JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2)}\n`,
  );
  await writeFile(
    join(root, ".fabric", "human-lock.json"),
    `${JSON.stringify({ locked: [] }, null, 2)}\n`,
  );
  return root;
}

/** Register the team store in the global config. */
function mountStores(): void {
  saveGlobalConfig({
    uid: "test-uid",
    stores: [{ store_uuid: TEAM_STORE, alias: "team", remote: "git@e:team.git" }],
  });
}

/** Write a knowledge .md into the team store under the isolated ~/.fabric. */
async function writeStoreEntry(type: string, id: string, lines: string[]): Promise<void> {
  const dir = join(
    resolveGlobalRoot(),
    storeRelativePath(TEAM_STORE),
    STORE_LAYOUT.knowledgeDir,
    type,
  );
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.md`), lines.join("\n"));
}

async function seedTwoEntryProject(): Promise<string> {
  const projectRoot = await createTempProject();
  await writeStoreEntry("decisions", "KT-DEC-0001", [
    "---",
    "id: KT-DEC-0001",
    "type: decision",
    "layer: team",
    "maturity: verified",
    "created_at: 2026-06-04T00:00:00.000Z",
    "intent_clues: [auth]",
    "tech_stack: [TypeScript]",
    "summary: Auth decision",
    "---",
    "# Auth body",
    "",
  ]);
  await writeStoreEntry("guidelines", "KT-GLD-0001", [
    "---",
    "id: KT-GLD-0001",
    "type: guideline",
    "layer: team",
    "maturity: verified",
    "created_at: 2026-06-04T00:00:00.000Z",
    "intent_clues: [ui]",
    "summary: UI guideline",
    "---",
    "# UI body",
    "",
  ]);
  mountStores();
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
      "team:KT-DEC-0001",
      "team:KT-GLD-0001",
    ]);

    // Bodies fetched for ALL surfaced ids
    expect(result.selected_stable_ids.sort()).toEqual(["team:KT-DEC-0001", "team:KT-GLD-0001"]);
    expect(result.rules.map((rule) => rule.stable_id).sort()).toEqual([
      "team:KT-DEC-0001",
      "team:KT-GLD-0001",
    ]);
    const authRule = result.rules.find((rule) => rule.stable_id === "team:KT-DEC-0001");
    expect(authRule?.body).toContain("# Auth body");

    // Ledger emitted both plan + sections + consumed events
    const planned = await readEventLedger(projectRoot, { event_type: "knowledge_context_planned" });
    expect(planned.events).toHaveLength(1);
    const fetched = await readEventLedger(projectRoot, { event_type: "knowledge_sections_fetched" });
    expect(fetched.events).toHaveLength(1);
    const consumed = await readEventLedger(projectRoot, { event_type: "knowledge_consumed" });
    expect(consumed.events.map((e) => (e as { stable_id?: string }).stable_id).sort()).toEqual([
      "team:KT-DEC-0001",
      "team:KT-GLD-0001",
    ]);
  });

  it("scopes fetched bodies when `ids` provided + intersects against surfaced candidates", async () => {
    const projectRoot = await seedTwoEntryProject();

    const result = await recall(projectRoot, {
      paths: ["src/index.ts"],
      ids: ["team:KT-DEC-0001", "non-existent-id"],
    });

    // Only the intersection of `ids` and surfaced candidates loads.
    expect(result.selected_stable_ids).toEqual(["team:KT-DEC-0001"]);
    expect(result.rules.map((rule) => rule.stable_id)).toEqual(["team:KT-DEC-0001"]);
    // But the shared description_index still shows the full candidate set —
    // callers can re-fetch the skipped ones via fab_get_knowledge_sections
    // against the same selection_token.
    expect(result.candidates.map((item) => item.stable_id).sort()).toEqual([
      "team:KT-DEC-0001",
      "team:KT-GLD-0001",
    ]);
  });

  // v2.2 MC1-recall-pack (W2-T4): packaging increments + include_related.
  // The `related` graph edge references the store-qualified id of the neighbour
  // (cross-store candidates carry `<alias>:<id>`; recall matches related ids
  // against the surfaced candidate set, which is store-qualified).
  async function seedRelatedProject(): Promise<string> {
    const projectRoot = await createTempProject();
    // auth declares a top-level `related` graph edge to the ui guideline.
    await writeStoreEntry("decisions", "KT-DEC-0001", [
      "---",
      "id: KT-DEC-0001",
      "type: decision",
      "layer: team",
      "maturity: verified",
      "created_at: 2026-06-04T00:00:00.000Z",
      "related: [team:KT-GLD-0001]",
      "summary: Auth decision",
      "---",
      "# Auth body",
      "",
    ]);
    await writeStoreEntry("guidelines", "KT-GLD-0001", [
      "---",
      "id: KT-GLD-0001",
      "type: guideline",
      "layer: team",
      "maturity: verified",
      "created_at: 2026-06-04T00:00:00.000Z",
      "summary: UI guideline",
      "---",
      "# UI body",
      "",
    ]);
    mountStores();
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
      ids: ["team:KT-DEC-0001"],
      include_related: true,
    });

    // auth + its related ui guideline both fetched.
    expect(result.selected_stable_ids.sort()).toEqual(["team:KT-DEC-0001", "team:KT-GLD-0001"]);
  });

  it("hints via next_steps that related entries exist when not included", async () => {
    const projectRoot = await seedRelatedProject();

    const result = await recall(projectRoot, {
      paths: ["src/index.ts"],
      ids: ["team:KT-DEC-0001"],
    });

    // Only auth fetched, but the packaging nudges include_related.
    expect(result.selected_stable_ids).toEqual(["team:KT-DEC-0001"]);
    expect(result.next_steps ?? []).toEqual(
      expect.arrayContaining([expect.stringMatching(/include_related:true/)]),
    );
  });

  // lifecycle-refactor W3-T4 (§2 store 轴 / store-qualified 观测 / D7): recall rules
  // carry store provenance derived from the (cross-store-stamped) `<alias>:<id>`
  // prefix. v2.2 W5 R2 (agents.meta decolo): post-cutover ALL recall is
  // store-backed, so every surfaced rule carries its store alias. (The bare-id
  // omission branch is covered by the attachStoreProvenance unit below.)
  it("attaches store provenance for store-backed rules", async () => {
    const projectRoot = await seedTwoEntryProject();
    const result = await recall(projectRoot, { paths: ["src/index.ts"] });
    expect(result.rules.length).toBeGreaterThan(0);
    for (const rule of result.rules) {
      expect(rule.store).toEqual({ alias: "team" });
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
