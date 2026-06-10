// v2.1 ④ conflict-detection (P4): doctor-conflict integration test.
//
// v2.2 W5 R6 (读侧 cutover): exercises the real disk → READ-SET STORE →
// loadConflictEntries → lint pipeline. Seeds two near-duplicate
// opposite-conclusion decisions + one unrelated into a mounted team store, then
// asserts the conflict lint surfaces the pair (cheap pass) and the injected
// judge escalates it (deep pass). The co-location agents.meta source is retired;
// loadConflictEntries now walks the project's read-set stores.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import {
  STORE_LAYOUT,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";

import { loadConflictEntries, runDoctorConflictLint } from "./doctor-conflict.js";
import type { ConflictJudge } from "./conflict-lint.js";

const tempRoots: string[] = [];
// Isolate the global root (~/.fabric, where mounted stores live) so the host's
// real stores never leak into the fixture corpus.
const fakeHome = mkdtempSync(join(tmpdir(), "conflict-lint-home-"));
const prevFabricHome = process.env.FABRIC_HOME;
process.env.FABRIC_HOME = fakeHome;

const STORE = "33333333-3333-4333-8333-333333333333";

function storeKnowledgeDir(): string {
  return join(resolveGlobalRoot(), storeRelativePathForMount({ store_uuid: STORE }), STORE_LAYOUT.knowledgeDir);
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const d = tempRoots.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
  // Reset the store knowledge between tests so entries never accumulate across
  // cases (the global root / fakeHome is shared at module scope).
  rmSync(join(resolveGlobalRoot(), storeRelativePathForMount({ store_uuid: STORE })), { recursive: true, force: true });
});

afterAll(() => {
  if (prevFabricHome === undefined) delete process.env.FABRIC_HOME;
  else process.env.FABRIC_HOME = prevFabricHome;
  rmSync(fakeHome, { recursive: true, force: true });
});

function wf(root: string, rel: string, content: string): void {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, content, "utf8");
}

function decision(id: string, slug: string, body: string): string {
  return [
    "---",
    `id: ${id}`,
    "type: decision",
    "maturity: proven",
    "layer: team",
    "semantic_scope: team",
    `visibility_store: "team"`,
    "created_at: 2026-05-10T00:00:00.000Z",
    "---",
    "",
    `# ${slug}`,
    "",
    "## Decision",
    body,
    "",
  ].join("\n");
}

// Seed a project that requires the team store, mount the store in the global
// registry, and return the project root. Knowledge entries are written into the
// store via writeStoreEntry (NOT the project's co-location .fabric/knowledge).
async function seedProject(name: string): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), `conflict-lint-${name}-`));
  tempRoots.push(root);
  wf(root, "package.json", JSON.stringify({ name, dependencies: { vite: "^7.0.0" } }));
  wf(root, "AGENTS.md", "# AGENTS\nFabric v2.0 bootstrap anchor.\n");
  wf(root, ".fabric/fabric-config.json", JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2));
  saveGlobalConfig({
    uid: "test-uid",
    stores: [{ store_uuid: STORE, alias: "team", remote: "git@e:conflict.git" }],
  });
  return root;
}

// Write a knowledge entry markdown into the mounted team store. `rel` is the
// path under the store's knowledge dir (e.g. "decisions/KT-DEC-0001--auth.md"
// or "pending/decisions/KT-DEC-0099--draft.md").
function writeStoreEntry(rel: string, content: string): void {
  const p = join(storeKnowledgeDir(), rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, content, "utf8");
}

const JWT_BODY =
  "Auth token strategy: use stateless JWT bearer tokens for all API authentication. Sessions are not stored server side.";
const SESSION_BODY =
  "Auth token strategy: use server-side stateful sessions for all API authentication. JWT bearer tokens are not used.";
const UNRELATED_BODY =
  "Build tooling: adopt tsup for bundling the CLI package, with esbuild under the hood for fast incremental builds.";

describe("runDoctorConflictLint (v2.1 ④)", () => {
  it("cheap pass surfaces the near-duplicate opposite-conclusion pair as a candidate", async () => {
    const root = await seedProject("cheap");
    writeStoreEntry("decisions/KT-DEC-0001--auth-jwt.md", decision("KT-DEC-0001", "auth-jwt", JWT_BODY));
    writeStoreEntry("decisions/KT-DEC-0002--auth-session.md", decision("KT-DEC-0002", "auth-session", SESSION_BODY));
    writeStoreEntry("decisions/KT-DEC-0003--build-tooling.md", decision("KT-DEC-0003", "build-tooling", UNRELATED_BODY));

    const report = await runDoctorConflictLint(root);
    expect(report.status).toBe("ok");
    const pairKeys = report.pairs.map((p) => [p.a, p.b].join("+"));
    expect(pairKeys).toContain("KT-DEC-0001+KT-DEC-0002");
    // The unrelated entry is not paired with either auth decision.
    expect(pairKeys.some((k) => k.includes("KT-DEC-0003"))).toBe(false);
    // Cheap pass leaves verdicts unknown (no judge).
    expect(report.pairs.every((p) => p.verdict === "unknown")).toBe(true);
    expect(report.conflict_count).toBe(0);
    expect(report.deep).toBe(false);
  });

  it("deep pass with an injected judge escalates a real conflict", async () => {
    const root = await seedProject("deep");
    writeStoreEntry("decisions/KT-DEC-0001--auth-jwt.md", decision("KT-DEC-0001", "auth-jwt", JWT_BODY));
    writeStoreEntry("decisions/KT-DEC-0002--auth-session.md", decision("KT-DEC-0002", "auth-session", SESSION_BODY));

    const judge: ConflictJudge = vi.fn(async () => ({ isConflict: true, rationale: "JWT vs session — contradiction" }));
    const report = await runDoctorConflictLint(root, { deep: true, judge });
    expect(report.deep).toBe(true);
    expect(report.conflict_count).toBe(1);
    expect(report.pairs[0].verdict).toBe("conflict");
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it("deep flag without a judge stays cheap (no escalation)", async () => {
    const root = await seedProject("deep-nojudge");
    writeStoreEntry("decisions/KT-DEC-0001--auth-jwt.md", decision("KT-DEC-0001", "auth-jwt", JWT_BODY));
    writeStoreEntry("decisions/KT-DEC-0002--auth-session.md", decision("KT-DEC-0002", "auth-session", SESSION_BODY));

    const report = await runDoctorConflictLint(root, { deep: true });
    expect(report.deep).toBe(false);
    expect(report.pairs[0].verdict).toBe("unknown");
  });

  it("config threshold (very high) suppresses candidates", async () => {
    const root = await seedProject("threshold");
    writeStoreEntry("decisions/KT-DEC-0001--auth-jwt.md", decision("KT-DEC-0001", "auth-jwt", JWT_BODY));
    writeStoreEntry("decisions/KT-DEC-0002--auth-session.md", decision("KT-DEC-0002", "auth-session", SESSION_BODY));
    wf(root, ".fabric/fabric-config.json", JSON.stringify({ required_stores: [{ id: "team" }], conflict_lint_similarity_threshold: 0.99 }));

    const report = await runDoctorConflictLint(root);
    expect(report.threshold).toBe(0.99);
    expect(report.candidate_count).toBe(0);
  });

  it("loadConflictEntries skips pending drafts", async () => {
    const root = await seedProject("pending");
    writeStoreEntry("decisions/KT-DEC-0001--auth-jwt.md", decision("KT-DEC-0001", "auth-jwt", JWT_BODY));
    writeStoreEntry("pending/decisions/KT-DEC-0099--draft.md", decision("KT-DEC-0099", "draft", SESSION_BODY));

    const entries = await loadConflictEntries(root);
    const ids = entries.map((e) => e.stable_id);
    expect(ids).toContain("KT-DEC-0001");
    expect(ids).not.toContain("KT-DEC-0099");
  });
});
