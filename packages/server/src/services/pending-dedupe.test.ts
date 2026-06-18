/**
 * crack 4: unit tests for the deterministic cross-session (type, slug) pending
 * merge. Twins are produced the real way — two extractKnowledge calls with the
 * SAME (type, slug) but DIFFERENT source_sessions, which the frozen idempotency
 * key + slug auto-disambiguator land as `<slug>.md` + `<slug>-2.md`.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STORE_LAYOUT,
  STORE_PENDING_DIR,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";

import { extractKnowledge } from "./extract-knowledge.js";
import { mergePendingTwins } from "./pending-dedupe.js";

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

const TEAM_STORE_UUID = "22222222-2222-4222-8222-222222222222";
const PERSONAL_STORE_UUID = "55555555-5555-4555-8555-555555555555";

beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-dedupe-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
});

afterEach(async () => {
  if (originalFabricHome === undefined) delete process.env.FABRIC_HOME;
  else process.env.FABRIC_HOME = originalFabricHome;
  await Promise.all(tempDirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

function mountTeamStore(): void {
  saveGlobalConfig({
    uid: "test-uid",
    stores: [
      { store_uuid: PERSONAL_STORE_UUID, alias: "personal", personal: true, writable: true },
      { store_uuid: TEAM_STORE_UUID, alias: "team", remote: "git@example.com:team-store.git", writable: true },
    ],
  });
}

async function createBoundProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-dedupe-proj-"));
  tempDirs.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  mountTeamStore();
  await writeFile(
    join(projectRoot, ".fabric", "fabric-config.json"),
    `${JSON.stringify({ required_stores: [{ id: "team" }], active_write_store: "team" }, null, 2)}\n`,
  );
  return projectRoot;
}

function teamPendingDir(type: string): string {
  return join(
    resolveGlobalRoot(),
    storeRelativePathForMount({ store_uuid: TEAM_STORE_UUID }),
    STORE_LAYOUT.knowledgeDir,
    STORE_PENDING_DIR,
    type,
  );
}

function archiveInput(session: string, slug: string) {
  return {
    source_sessions: [session],
    recent_paths: [] as string[],
    user_messages_summary: `Decision: always route the archive nudge through the per-session anchor (${session}).`,
    type: "decisions" as const,
    slug,
    layer: "team" as const,
    proposed_reason: "diagnostic-then-fix" as const,
    session_context: `Session ${session}: locked the two-lane archive strategy decision.`,
  };
}

describe("mergePendingTwins (crack 4)", () => {
  it("collapses cross-session (type, slug) twins into one survivor with unioned source_sessions", async () => {
    const projectRoot = await createBoundProject();
    // Two sessions archive the SAME decision → two pending files (frozen key).
    await extractKnowledge(projectRoot, archiveInput("sess-A", "two-lane-archive"));
    await extractKnowledge(projectRoot, archiveInput("sess-B", "two-lane-archive"));

    const dir = teamPendingDir("decisions");
    expect(readdirSync(dir).filter((f) => f.endsWith(".md"))).toHaveLength(2);

    const report = await mergePendingTwins(projectRoot);

    // Exactly one merge, collapsing to a single file.
    expect(report.merged).toHaveLength(1);
    const remaining = readdirSync(dir).filter((f) => f.endsWith(".md"));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toBe("two-lane-archive.md");

    // Survivor frontmatter carries BOTH sessions; the twin's evidence is folded in.
    const survivor = readFileSync(join(dir, remaining[0]), "utf8");
    expect(survivor).toMatch(/^source_sessions: \[.*"sess-A".*"sess-B".*\]$/mu);
    expect(survivor).toMatch(/## Evidence \(merged from session sess-B\)/u);
    expect(report.merged[0].source_sessions).toEqual(["sess-A", "sess-B"]);
    expect(report.merged[0].removed).toHaveLength(1);
  });

  it("leaves distinct slugs from different sessions untouched (no false merge)", async () => {
    const projectRoot = await createBoundProject();
    await extractKnowledge(projectRoot, archiveInput("sess-A", "anchor-per-session"));
    await extractKnowledge(projectRoot, archiveInput("sess-B", "backlog-safety-net"));

    const report = await mergePendingTwins(projectRoot);
    expect(report.merged).toHaveLength(0);
    expect(readdirSync(teamPendingDir("decisions")).filter((f) => f.endsWith(".md"))).toHaveLength(2);
  });

  it("is idempotent — a second run is a no-op", async () => {
    const projectRoot = await createBoundProject();
    await extractKnowledge(projectRoot, archiveInput("sess-A", "two-lane-archive"));
    await extractKnowledge(projectRoot, archiveInput("sess-B", "two-lane-archive"));

    expect((await mergePendingTwins(projectRoot)).merged).toHaveLength(1);
    expect((await mergePendingTwins(projectRoot)).merged).toHaveLength(0);
    expect(readdirSync(teamPendingDir("decisions")).filter((f) => f.endsWith(".md"))).toHaveLength(1);
  });

  it("does NOT merge a standalone '<base>-N.md' whose base sibling is absent (legit trailing number)", async () => {
    const projectRoot = await createBoundProject();
    // Manually seed two independent slugs that happen to end in a number, from
    // two sessions, with NO shared base file present — must stay separate.
    const dir = teamPendingDir("decisions");
    mkdirSync(dir, { recursive: true });
    const fm = (session: string) =>
      [
        "---",
        "type: decisions",
        "maturity: draft",
        "layer: team",
        `source_sessions: ["${session}"]`,
        "x-fabric-idempotency-key: key-" + session,
        "---",
        "## Summary",
        "Independent decision.",
      ].join("\n") + "\n";
    writeFileSync(join(dir, "owasp-top-10.md"), fm("sess-A"));
    writeFileSync(join(dir, "phase-2.md"), fm("sess-B"));

    const report = await mergePendingTwins(projectRoot);
    expect(report.merged).toHaveLength(0);
    expect(readdirSync(dir).filter((f) => f.endsWith(".md")).sort()).toEqual([
      "owasp-top-10.md",
      "phase-2.md",
    ]);
  });

  it("only merges genuine cross-session twins — same-session re-disambiguation is left alone", async () => {
    const projectRoot = await createBoundProject();
    const dir = teamPendingDir("decisions");
    mkdirSync(dir, { recursive: true });
    // Same primary session on both base + disambiguated file → NOT a cross-
    // session duplicate; the author deliberately split distinct knowledge.
    const fm = [
      "---",
      "type: decisions",
      "maturity: draft",
      "layer: team",
      'source_sessions: ["sess-A"]',
      "x-fabric-idempotency-key: k",
      "---",
      "## Summary",
      "Body.",
    ].join("\n") + "\n";
    writeFileSync(join(dir, "split-slug.md"), fm);
    writeFileSync(join(dir, "split-slug-2.md"), fm);

    const report = await mergePendingTwins(projectRoot);
    expect(report.merged).toHaveLength(0);
    expect(readdirSync(dir).filter((f) => f.endsWith(".md"))).toHaveLength(2);
  });
});
