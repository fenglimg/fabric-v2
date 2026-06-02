import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STORE_LAYOUT,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePath,
} from "@fenglimg/fabric-shared";

import { extractKnowledge } from "./extract-knowledge.js";
import { reviewKnowledge } from "./review.js";
import { planContext } from "./plan-context.js";
import { contextCache } from "../cache.js";

// v2.1 global-refactor (NEW-APPROVE-PROMOTE): proves the FULL automated
// extract → approve → recall round-trip stays INSIDE the active write store.
// W1-T1 proved canonical-store → recall; W1-T2 proved extract → store-pending;
// this closes the missing approve → store-canonical link so the whole loop is
// store-resident, not partially leaking back into the project .fabric.

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

const TEAM_STORE_UUID = "33333333-3333-4333-8333-333333333333";

beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-approve-promote-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
  contextCache.invalidate("file_watch");
});

afterEach(async () => {
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

async function createProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-approve-promote-proj-"));
  tempDirs.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
  await writeFile(
    join(projectRoot, ".fabric", "agents.meta.json"),
    `${JSON.stringify({ revision: "rev-empty", nodes: {} }, null, 2)}\n`,
  );
  return projectRoot;
}

function mountTeamStore(): void {
  saveGlobalConfig({
    uid: "test-uid",
    stores: [
      {
        store_uuid: TEAM_STORE_UUID,
        alias: "team",
        remote: "git@example.com:team-store.git",
        writable: true,
      },
    ],
  });
}

function storeCanonicalDir(type: string): string {
  return join(
    resolveGlobalRoot(),
    storeRelativePath(TEAM_STORE_UUID),
    STORE_LAYOUT.knowledgeDir,
    type,
  );
}

const extractInput = {
  source_sessions: ["sess-roundtrip"],
  recent_paths: [] as string[],
  user_messages_summary:
    "Decided to route promoted knowledge into the active write store for the full round-trip.",
  type: "decisions" as const,
  slug: "round-trip-decision",
  layer: "team" as const,
  proposed_reason: "diagnostic-then-fix" as const,
  session_context:
    "Session goal: validate the full extract→approve→recall round-trip into the active write store.",
};

describe("approve→store-canonical promote (NEW-APPROVE-PROMOTE)", () => {
  it("closes the full extract→approve→recall round-trip inside the store", async () => {
    const projectRoot = await createProject();
    mountTeamStore();
    await writeFile(
      join(projectRoot, ".fabric", "fabric-config.json"),
      `${JSON.stringify(
        { required_stores: [{ id: "team" }], active_write_store: "team" },
        null,
        2,
      )}\n`,
    );

    // 1. extract → pending lands in the store (W1-T2).
    const extracted = await extractKnowledge(projectRoot, extractInput);
    expect(extracted.pending_path).not.toBe("");

    // 2. list surfaces the store-routed pending entry with an absolute path.
    const listed = await reviewKnowledge(projectRoot, { action: "list" });
    expect(listed.action).toBe("list");
    if (listed.action !== "list") throw new Error("unreachable");
    const pendingItem = listed.items.find((i) => i.pending_path.endsWith(".md"));
    expect(pendingItem).toBeDefined();
    expect(pendingItem!.pending_path.startsWith("/")).toBe(true);

    // 3. approve → canonical promoted INTO the store (not the project .fabric).
    const approved = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [pendingItem!.pending_path],
    });
    expect(approved.action).toBe("approve");
    if (approved.action !== "approve") throw new Error("unreachable");
    expect(approved.approved).toHaveLength(1);
    const stableId = approved.approved[0]!.stable_id;
    expect(stableId).toMatch(/^KT-DEC-\d+$/u);

    // Canonical file is in the STORE's decisions dir...
    const canonicalDir = storeCanonicalDir("decisions");
    expect(existsSync(canonicalDir)).toBe(true);
    expect(readdirSync(canonicalDir).some((f) => f.endsWith(".md"))).toBe(true);
    // ...and NOT in the project's dual-root canonical dir.
    expect(
      readdirSync(join(projectRoot, ".fabric", "knowledge", "decisions")).filter((f) =>
        f.endsWith(".md"),
      ),
    ).toHaveLength(0);

    // 4. recall surfaces the promoted canonical entry, store-qualified.
    contextCache.invalidate("file_watch");
    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });
    const ids = result.candidates.map((c) => c.stable_id);
    expect(ids).toContain(`team:${stableId}`);
  });

  it("falls back to project .fabric canonical when no active write store is set", async () => {
    const projectRoot = await createProject();
    mountTeamStore();
    // required_stores present (read-set) but NO active_write_store → write-target
    // resolves null → dual-root promote preserved byte-for-byte.
    await writeFile(
      join(projectRoot, ".fabric", "fabric-config.json"),
      `${JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2)}\n`,
    );

    const extracted = await extractKnowledge(projectRoot, extractInput);
    expect(extracted.pending_path).not.toBe("");

    const listed = await reviewKnowledge(projectRoot, { action: "list" });
    if (listed.action !== "list") throw new Error("unreachable");
    const pendingItem = listed.items.find((i) => i.pending_path.endsWith(".md"));
    expect(pendingItem).toBeDefined();
    // Dual-root team pending → workspace-relative path, not absolute.
    expect(pendingItem!.pending_path.startsWith("/")).toBe(false);

    const approved = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [pendingItem!.pending_path],
    });
    if (approved.action !== "approve") throw new Error("unreachable");
    expect(approved.approved).toHaveLength(1);

    // Canonical landed in the PROJECT .fabric, store canonical stays empty.
    expect(
      readdirSync(join(projectRoot, ".fabric", "knowledge", "decisions")).some((f) =>
        f.endsWith(".md"),
      ),
    ).toBe(true);
    expect(existsSync(storeCanonicalDir("decisions"))).toBe(false);
  });

  it("falls back to project .fabric when no global config exists", async () => {
    const projectRoot = await createProject();
    // No global config at all → pure dual-root behavior.
    const extracted = await extractKnowledge(projectRoot, extractInput);
    expect(extracted.pending_path).not.toBe("");

    const listed = await reviewKnowledge(projectRoot, { action: "list" });
    if (listed.action !== "list") throw new Error("unreachable");
    const pendingItem = listed.items.find((i) => i.pending_path.endsWith(".md"));
    expect(pendingItem).toBeDefined();

    const approved = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [pendingItem!.pending_path],
    });
    if (approved.action !== "approve") throw new Error("unreachable");
    expect(approved.approved).toHaveLength(1);

    expect(
      readdirSync(join(projectRoot, ".fabric", "knowledge", "decisions")).some((f) =>
        f.endsWith(".md"),
      ),
    ).toBe(true);
  });
});
