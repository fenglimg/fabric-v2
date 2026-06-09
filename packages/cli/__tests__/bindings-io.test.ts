import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  globalConfigSchema,
  readBindingsSnapshot,
  STORE_LAYOUT,
  storeRelativePath,
} from "@fenglimg/fabric-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { saveGlobalConfig } from "../src/store/global-config-io.js";
import { saveProjectConfig } from "../src/store/project-config-io.js";
import { regenerateBindingsSnapshot } from "../src/store/bindings-io.js";
import { scopeExplain } from "../src/store/scope-explain.js";

// v2.1.0-rc.1 P3 — bindings snapshot regeneration consistency (P3→P4 chain).
// done_when: `bindings/<id>_resolved.json` is generated AND consistent with the
// resolver's resolution (same `buildResolveInput` → StoreResolver path).

const PERSONAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-05-30T00:00:00.000Z";

const dirs: string[] = [];
let globalRoot: string;
let projectRoot: string;

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "fabric-bindings-home-"));
  dirs.push(home);
  globalRoot = join(home, ".fabric");
  saveGlobalConfig(
    globalConfigSchema.parse({
      uid: "u-test",
      stores: [
        { store_uuid: PERSONAL, alias: "personal", personal: true, writable: true },
        { store_uuid: TEAM, alias: "team", remote: "git@h:team.git", writable: true },
      ],
    }),
    globalRoot,
  );
  projectRoot = mkdtempSync(join(tmpdir(), "fabric-bindings-proj-"));
  dirs.push(projectRoot);
  saveProjectConfig(
    {
      project_id: PROJECT_ID,
      required_stores: [{ id: "team" }],
      active_write_store: "team",
    },
    projectRoot,
  );
});

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("regenerateBindingsSnapshot (P3→P4 chain)", () => {
  it("writes a snapshot consistent with the resolver's resolution", () => {
    const teamStore = join(globalRoot, storeRelativePath(TEAM));
    mkdirSync(join(teamStore, STORE_LAYOUT.knowledgeDir, "decisions"), { recursive: true });
    mkdirSync(join(teamStore, STORE_LAYOUT.knowledgeDir, "pending", "guidelines"), { recursive: true });
    writeFileSync(join(teamStore, STORE_LAYOUT.knowledgeDir, "decisions", "KT-DEC-0001.md"), "# A\n", "utf8");
    writeFileSync(join(teamStore, STORE_LAYOUT.knowledgeDir, "pending", "guidelines", "draft.md"), "# Draft\n", "utf8");

    const written = regenerateBindingsSnapshot(projectRoot, { globalRoot, now: NOW });
    expect(written).not.toBeNull();

    // Persisted at ~/.fabric/state/bindings/<project_id>_resolved.json.
    const snapshot = readBindingsSnapshot(globalRoot, PROJECT_ID);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.project_id).toBe(PROJECT_ID);
    expect(snapshot?.generated_at).toBe(NOW);

    // Consistency-by-construction: snapshot == what scope-explain resolves live.
    const live = scopeExplain(projectRoot, "team", globalRoot);
    expect(snapshot?.read_set).toEqual(live?.readSet);
    expect(snapshot?.write_target).toEqual(live?.writeTarget);
    // Read-set is required_stores ∪ implicit personal (team + personal).
    expect(snapshot?.read_set.stores.map((s) => s.alias).sort()).toEqual(["personal", "team"]);
    // Non-personal (team) scope writes land in the active write store.
    expect(snapshot?.write_target?.alias).toBe("team");
    expect(snapshot?.hook_stats?.canonical.count).toBe(1);
    expect(snapshot?.hook_stats?.pending.count).toBe(1);
    expect(snapshot?.hook_stats?.pending.oldest_mtime_ms).toEqual(expect.any(Number));
  });

  it("returns null (no snapshot) when there is no global config", () => {
    const empty = join(mkdtempSync(join(tmpdir(), "fabric-bindings-empty-")), ".fabric");
    dirs.push(empty);
    expect(regenerateBindingsSnapshot(projectRoot, { globalRoot: empty, now: NOW })).toBeNull();
  });

  it("returns null when the project has no project_id to key the snapshot", () => {
    const bare = mkdtempSync(join(tmpdir(), "fabric-bindings-noid-"));
    dirs.push(bare);
    saveProjectConfig({ required_stores: [{ id: "team" }] }, bare);
    expect(regenerateBindingsSnapshot(bare, { globalRoot, now: NOW })).toBeNull();
  });
});
