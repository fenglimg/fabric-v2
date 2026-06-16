import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  STORE_LAYOUT,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";
import { recallOutputSchema } from "@fenglimg/fabric-shared/schemas/api-contracts";

import { recall, attachPathStore } from "./recall.js";
import { readEventLedger } from "./event-ledger.js";
import { contextCache } from "../cache.js";

// W1 (KT-DEC-0026 / KT-GLD-0005): recall returns DESCRIPTIONS + READ PATHS only —
// no bodies, no selection_token, no two-step fetch. The agent Reads a
// `paths[].path` to load the body on demand. Candidates come SOLELY from the
// mounted stores in the read-set (store-qualified `<alias>:<stable_id>`); the
// fixtures seed knowledge .md files directly into a team store under an isolated
// ~/.fabric.

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
    storeRelativePathForMount({ store_uuid: TEAM_STORE }),
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

describe("recall (lean one-call — KT-DEC-0026: descriptions + read paths, no bodies)", () => {
  it("returns the full candidate description index + one read path per candidate, NO body", async () => {
    const projectRoot = await seedTwoEntryProject();

    const result = await recall(projectRoot, {
      paths: ["src/index.ts"],
      intent: "auth refactor",
      correlation_id: "corr-recall-1",
      session_id: "session-recall-1",
    });

    // Discovery index intact.
    expect(result.revision_hash).toEqual(expect.any(String));
    expect(result.entries).toHaveLength(1);
    expect(result.candidates.map((item) => item.stable_id).sort()).toEqual([
      "team:KT-DEC-0001",
      "team:KT-GLD-0001",
    ]);

    // One read path per surfaced candidate — pointing at the on-disk store file.
    expect(result.paths.map((p) => p.stable_id).sort()).toEqual([
      "team:KT-DEC-0001",
      "team:KT-GLD-0001",
    ]);
    const authPath = result.paths.find((p) => p.stable_id === "team:KT-DEC-0001");
    expect(authPath?.path).toMatch(/KT-DEC-0001\.md$/);
    expect(authPath?.store).toEqual({ alias: "team" });

    // No bodies / no two-step fields leak into the wire shape.
    expect(result).not.toHaveProperty("rules");
    expect(result).not.toHaveProperty("body_tier");
    expect(result).not.toHaveProperty("selection_token");
    expect(result).not.toHaveProperty("selected_stable_ids");

    // Planning telemetry still fires; recall no longer emits the retired
    // sections-fetched / consumed events (no body fetch happens).
    const planned = await readEventLedger(projectRoot, { event_type: "knowledge_context_planned" });
    expect(planned.events).toHaveLength(1);
    const fetched = await readEventLedger(projectRoot, { event_type: "knowledge_sections_fetched" });
    expect(fetched.events).toEqual([]);
    const consumed = await readEventLedger(projectRoot, { event_type: "knowledge_consumed" });
    expect(consumed.events).toEqual([]);
  });

  it("scopes the read-path index when `ids` provided, intersecting surfaced candidates; descriptions stay full", async () => {
    const projectRoot = await seedTwoEntryProject();

    const result = await recall(projectRoot, {
      paths: ["src/index.ts"],
      ids: ["team:KT-DEC-0001", "non-existent-id"],
    });

    // Only the intersection of `ids` and surfaced candidates gets a read path.
    expect(result.paths.map((p) => p.stable_id)).toEqual(["team:KT-DEC-0001"]);
    // The candidate description index still shows the full set for discovery.
    expect(result.candidates.map((item) => item.stable_id).sort()).toEqual([
      "team:KT-DEC-0001",
      "team:KT-GLD-0001",
    ]);
  });

  it("always returns a cite directive in the packaging", async () => {
    const projectRoot = await seedTwoEntryProject();
    const result = await recall(projectRoot, { paths: ["src/index.ts"] });
    expect(result.directive).toMatch(/cite the KB id/i);
  });

  // W1-3 (KT-DEC-0031): include_related surfaces the related neighbour's read
  // path (not its body). The `related` edge references the store-qualified id.
  async function seedRelatedProject(edgeId = "team:KT-GLD-0001"): Promise<string> {
    const projectRoot = await createTempProject();
    await writeStoreEntry("decisions", "KT-DEC-0001", [
      "---",
      "id: KT-DEC-0001",
      "type: decision",
      "layer: team",
      "maturity: verified",
      "created_at: 2026-06-04T00:00:00.000Z",
      `related: [${edgeId}]`,
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

  it("include_related expands a scoped recall to surface the related neighbour's read path", async () => {
    const projectRoot = await seedRelatedProject();

    const result = await recall(projectRoot, {
      paths: ["src/index.ts"],
      ids: ["team:KT-DEC-0001"],
      include_related: true,
    });

    expect(result.paths.map((p) => p.stable_id).sort()).toEqual([
      "team:KT-DEC-0001",
      "team:KT-GLD-0001",
    ]);
  });

  it("include_related expands bare local related ids against store-qualified candidates", async () => {
    const projectRoot = await seedRelatedProject("KT-GLD-0001");

    const result = await recall(projectRoot, {
      paths: ["src/index.ts"],
      ids: ["team:KT-DEC-0001"],
      include_related: true,
    });

    expect(result.paths.map((p) => p.stable_id).sort()).toEqual([
      "team:KT-DEC-0001",
      "team:KT-GLD-0001",
    ]);
  });

  it("hints via next_steps that related entries exist when their path was not surfaced", async () => {
    const projectRoot = await seedRelatedProject();

    const result = await recall(projectRoot, {
      paths: ["src/index.ts"],
      ids: ["team:KT-DEC-0001"],
    });

    // Only auth got a read path, but the packaging nudges include_related.
    expect(result.paths.map((p) => p.stable_id)).toEqual(["team:KT-DEC-0001"]);
    expect(result.next_steps ?? []).toEqual(
      expect.arrayContaining([expect.stringMatching(/include_related:true/)]),
    );
  });

  it("attaches store provenance for store-backed read paths", async () => {
    const projectRoot = await seedTwoEntryProject();
    const result = await recall(projectRoot, { paths: ["src/index.ts"] });
    expect(result.paths.length).toBeGreaterThan(0);
    for (const p of result.paths) {
      expect(p.store).toEqual({ alias: "team" });
    }
  });

  it("attachPathStore derives the alias from a `<alias>:<id>` qualifier; a bare id yields no store field", async () => {
    expect(attachPathStore({ stable_id: "team:KT-DEC-0001", path: "/x/KT-DEC-0001.md" })).toEqual({
      stable_id: "team:KT-DEC-0001",
      path: "/x/KT-DEC-0001.md",
      store: { alias: "team" },
    });
    expect(attachPathStore({ stable_id: "KT-DEC-0001", path: "/x/KT-DEC-0001.md" })).toEqual({
      stable_id: "KT-DEC-0001",
      path: "/x/KT-DEC-0001.md",
    });
  });

  it("surfaces omitted_candidate_count + a next_steps hint when the budget omits candidates", async () => {
    const projectRoot = await seedTwoEntryProject();
    // top_k=1 over two candidates → one omitted by the retrieval budget.
    await writeFile(
      join(projectRoot, ".fabric", "fabric-config.json"),
      `${JSON.stringify({ required_stores: [{ id: "team" }], plan_context_top_k: 1 }, null, 2)}\n`,
    );

    const result = await recall(projectRoot, { paths: ["src/index.ts"] });

    expect(result.omitted_candidate_count).toBe(1);
    // Only the surviving candidate gets a read path.
    expect(result.paths).toHaveLength(1);
    expect(result.next_steps ?? []).toEqual(
      expect.arrayContaining([expect.stringMatching(/omitted by the retrieval budget/)]),
    );
  });

  it("returns empty paths when no candidates surface (no spurious fetch)", async () => {
    const projectRoot = await createTempProject();

    const result = await recall(projectRoot, { paths: ["src/index.ts"] });

    expect(result.candidates).toEqual([]);
    expect(result.paths).toEqual([]);
    expect(result.directive).toMatch(/cite the KB id/i);

    const fetched = await readEventLedger(projectRoot, { event_type: "knowledge_sections_fetched" });
    expect(fetched.events).toEqual([]);
  });

  // always-active dedupe marker: the SessionStart hook injects broad
  // model/guideline BODIES in full ("ALWAYS-ACTIVE RULES") while broad
  // decision/pitfall/process get a REFERENCE id+hook only. recall re-surfaces
  // those same broad model/guideline entries; mark them `always_active:true` so
  // the agent knows the body is already in context and need not re-Read it. The
  // predicate is a pure function of (relevance_scope, knowledge_type) — no client
  // state needed. NOT dropped/demoted: SessionStart injection degrades to an
  // index line on budget overflow, so the body is not guaranteed present.
  it("marks broad model/guideline candidates always_active:true; decisions are not", async () => {
    const projectRoot = await createTempProject();
    await writeStoreEntry("models", "KT-MOD-0001", [
      "---",
      "id: KT-MOD-0001",
      "type: model",
      "layer: team",
      "maturity: draft",
      "created_at: 2026-06-04T00:00:00.000Z",
      "relevance_scope: broad",
      "summary: scope model",
      "---",
      "# body",
      "",
    ]);
    await writeStoreEntry("guidelines", "KT-GLD-0001", [
      "---",
      "id: KT-GLD-0001",
      "type: guideline",
      "layer: team",
      "maturity: draft",
      "created_at: 2026-06-04T00:00:00.000Z",
      "relevance_scope: broad",
      "summary: a guideline",
      "---",
      "# body",
      "",
    ]);
    await writeStoreEntry("decisions", "KT-DEC-0001", [
      "---",
      "id: KT-DEC-0001",
      "type: decision",
      "layer: team",
      "maturity: draft",
      "created_at: 2026-06-04T00:00:00.000Z",
      "relevance_scope: broad",
      "summary: a decision",
      "---",
      "# body",
      "",
    ]);
    mountStores();

    const result = await recall(projectRoot, { paths: ["src/x.ts"], intent: "scope model guideline" });
    const byId = new Map(result.candidates.map((c) => [c.stable_id, c]));

    expect(byId.get("team:KT-MOD-0001")?.always_active).toBe(true);
    expect(byId.get("team:KT-GLD-0001")?.always_active).toBe(true);
    // REFERENCE-tier (decision) is NOT full-injected at SessionStart → no marker.
    expect(byId.get("team:KT-DEC-0001")?.always_active ?? false).toBe(false);

    // wire-strip lock (KT-PIT-0005): always_active must be DECLARED in
    // recallOutputSchema, else zod .strip() silently drops it at the MCP boundary
    // — the field would work in this unit test (direct call) yet vanish over the
    // wire. Round-trip through the output schema and assert it survives.
    const parsed = recallOutputSchema.parse(result);
    const parsedById = new Map(parsed.candidates.map((c) => [c.stable_id, c]));
    expect(parsedById.get("team:KT-MOD-0001")?.always_active).toBe(true);
  });
});
