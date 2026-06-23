import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STORE_LAYOUT,
  STORE_PENDING_DIR,
  isPersonalLeakIntoSharedStore,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";

import { extractKnowledge } from "./extract-knowledge.js";

// v2.1 global-refactor (W1/A1): fab_propose frontmatter must carry
// `semantic_scope` (resolution axis) + `visibility_store` (physical store), and
// personal scope must never land in a shared store (R5#3).

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

const TEAM = "22222222-2222-4222-8222-222222222222";
const PERSONAL = "33333333-3333-4333-8333-333333333333";

beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-a1-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
});

afterEach(async () => {
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  await Promise.all(tempDirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

async function createProject(config: object): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-a1-proj-"));
  tempDirs.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  await writeFile(
    join(projectRoot, ".fabric", "fabric-config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
  return projectRoot;
}

function mountStores(): void {
  saveGlobalConfig({
    uid: "test-uid",
    stores: [
      { store_uuid: PERSONAL, alias: "personal", personal: true, writable: true },
      { store_uuid: TEAM, alias: "team", remote: "git@e:t.git", writable: true },
    ],
  });
}

function readPendingFrontmatter(storeUuid: string, type: string): string {
  const dir = join(
    resolveGlobalRoot(),
    storeRelativePathForMount({ store_uuid: storeUuid, personal: storeUuid === PERSONAL }),
    STORE_LAYOUT.knowledgeDir,
    STORE_PENDING_DIR,
    type,
  );
  const file = readdirSync(dir).find((f) => f.endsWith(".md"));
  if (file === undefined) {
    throw new Error(`no pending entry in ${dir}`);
  }
  return readFileSync(join(dir, file), "utf8");
}

const teamInput = {
  source_sessions: ["s1"],
  recent_paths: [] as string[],
  user_messages_summary: "A team-scoped decision worth recording for the whole project group.",
  type: "decisions" as const,
  slug: "team-decision",
  layer: "team" as const,
  proposed_reason: "diagnostic-then-fix" as const,
  session_context: "Session goal: validate W1/A1 scope frontmatter on the team write path.",
};

describe("W1/A1 — semantic_scope + visibility_store frontmatter", () => {
  it("team scope (no active_project) → semantic_scope: team, visibility_store: <write store>", async () => {
    mountStores();
    const projectRoot = await createProject({
      required_stores: [{ id: "team" }],
      active_write_store: "team",
    });
    await extractKnowledge(projectRoot, teamInput);
    const fm = readPendingFrontmatter(TEAM, "decisions");
    expect(fm).toMatch(/^semantic_scope: team$/mu);
    expect(fm).toMatch(/^visibility_store: "team"$/mu);
  });

  it("team scope WITH active_project → semantic_scope: project:<id>", async () => {
    mountStores();
    const projectRoot = await createProject({
      required_stores: [{ id: "team" }],
      active_write_store: "team",
      active_project: "fabric-v2",
    });
    await extractKnowledge(projectRoot, teamInput);
    const fm = readPendingFrontmatter(TEAM, "decisions");
    expect(fm).toMatch(/^semantic_scope: project:fabric-v2$/mu);
    expect(fm).toMatch(/^visibility_store: "team"$/mu);
  });

  it("personal scope lands in the PERSONAL store (never the shared team store)", async () => {
    mountStores();
    const projectRoot = await createProject({
      required_stores: [{ id: "team" }],
      active_write_store: "team",
    });
    await extractKnowledge(projectRoot, { ...teamInput, audience: "personal", slug: "personal-pref" });
    const fm = readPendingFrontmatter(PERSONAL, "decisions");
    expect(fm).toMatch(/^semantic_scope: personal$/mu);
    expect(fm).toMatch(/^visibility_store: "personal"$/mu);
  });
});

describe("W1/A1 — personal-leak lint (isPersonalScope guard)", () => {
  it("flags personal scope into a shared store, allows everything else", () => {
    expect(isPersonalLeakIntoSharedStore("personal", "shared")).toBe(true);
    expect(isPersonalLeakIntoSharedStore("personal", "personal")).toBe(false);
    expect(isPersonalLeakIntoSharedStore("team", "shared")).toBe(false);
    expect(isPersonalLeakIntoSharedStore("team", "personal")).toBe(false);
  });
});
