// v2.1 ④ conflict-detection (P4): doctor-conflict integration test.
//
// Exercises the real disk → agents.meta → loadConflictEntries → lint pipeline:
// seed two near-duplicate opposite-conclusion decisions + one unrelated, build
// meta, then assert the conflict lint surfaces the pair (cheap pass) and the
// injected judge escalates it (deep pass).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { writeKnowledgeMeta } from "./knowledge-meta-builder.js";
import { loadConflictEntries, runDoctorConflictLint } from "./doctor-conflict.js";
import type { ConflictJudge } from "./conflict-lint.js";

const tempRoots: string[] = [];
// Isolate the personal layer (~/.fabric) so the host's real KP-* entries never
// leak into the fixture corpus.
const fakeHome = mkdtempSync(join(tmpdir(), "conflict-lint-home-"));
const prevFabricHome = process.env.FABRIC_HOME;
process.env.FABRIC_HOME = fakeHome;

afterEach(() => {
  while (tempRoots.length > 0) {
    const d = tempRoots.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
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

async function seedProject(name: string): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), `conflict-lint-${name}-`));
  tempRoots.push(root);
  wf(root, "package.json", JSON.stringify({ name, dependencies: { vite: "^7.0.0" } }));
  wf(root, "AGENTS.md", "# AGENTS\nFabric v2.0 bootstrap anchor.\n");
  for (const sub of ["decisions", "pitfalls", "guidelines", "models", "processes", "pending"]) {
    mkdirSync(join(root, ".fabric", "knowledge", sub), { recursive: true });
  }
  return root;
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
    wf(root, ".fabric/knowledge/decisions/KT-DEC-0001--auth-jwt.md", decision("KT-DEC-0001", "auth-jwt", JWT_BODY));
    wf(root, ".fabric/knowledge/decisions/KT-DEC-0002--auth-session.md", decision("KT-DEC-0002", "auth-session", SESSION_BODY));
    wf(root, ".fabric/knowledge/decisions/KT-DEC-0003--build-tooling.md", decision("KT-DEC-0003", "build-tooling", UNRELATED_BODY));
    await writeKnowledgeMeta(root, { source: "doctor_fix" });

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
    wf(root, ".fabric/knowledge/decisions/KT-DEC-0001--auth-jwt.md", decision("KT-DEC-0001", "auth-jwt", JWT_BODY));
    wf(root, ".fabric/knowledge/decisions/KT-DEC-0002--auth-session.md", decision("KT-DEC-0002", "auth-session", SESSION_BODY));
    await writeKnowledgeMeta(root, { source: "doctor_fix" });

    const judge: ConflictJudge = vi.fn(async () => ({ isConflict: true, rationale: "JWT vs session — contradiction" }));
    const report = await runDoctorConflictLint(root, { deep: true, judge });
    expect(report.deep).toBe(true);
    expect(report.conflict_count).toBe(1);
    expect(report.pairs[0].verdict).toBe("conflict");
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it("deep flag without a judge stays cheap (no escalation)", async () => {
    const root = await seedProject("deep-nojudge");
    wf(root, ".fabric/knowledge/decisions/KT-DEC-0001--auth-jwt.md", decision("KT-DEC-0001", "auth-jwt", JWT_BODY));
    wf(root, ".fabric/knowledge/decisions/KT-DEC-0002--auth-session.md", decision("KT-DEC-0002", "auth-session", SESSION_BODY));
    await writeKnowledgeMeta(root, { source: "doctor_fix" });

    const report = await runDoctorConflictLint(root, { deep: true });
    expect(report.deep).toBe(false);
    expect(report.pairs[0].verdict).toBe("unknown");
  });

  it("config threshold (very high) suppresses candidates", async () => {
    const root = await seedProject("threshold");
    wf(root, ".fabric/knowledge/decisions/KT-DEC-0001--auth-jwt.md", decision("KT-DEC-0001", "auth-jwt", JWT_BODY));
    wf(root, ".fabric/knowledge/decisions/KT-DEC-0002--auth-session.md", decision("KT-DEC-0002", "auth-session", SESSION_BODY));
    wf(root, ".fabric/fabric-config.json", JSON.stringify({ conflict_lint_similarity_threshold: 0.99 }));
    await writeKnowledgeMeta(root, { source: "doctor_fix" });

    const report = await runDoctorConflictLint(root);
    expect(report.threshold).toBe(0.99);
    expect(report.candidate_count).toBe(0);
  });

  it("loadConflictEntries skips pending drafts", async () => {
    const root = await seedProject("pending");
    wf(root, ".fabric/knowledge/decisions/KT-DEC-0001--auth-jwt.md", decision("KT-DEC-0001", "auth-jwt", JWT_BODY));
    wf(root, ".fabric/knowledge/pending/decisions/KT-DEC-0099--draft.md", decision("KT-DEC-0099", "draft", SESSION_BODY));
    await writeKnowledgeMeta(root, { source: "doctor_fix" });

    const entries = await loadConflictEntries(root);
    const ids = entries.map((e) => e.stable_id);
    expect(ids).toContain("KT-DEC-0001");
    expect(ids).not.toContain("KT-DEC-0099");
  });
});
