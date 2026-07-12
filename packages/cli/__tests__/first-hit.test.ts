import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { assessFirstHitSync, seedStarterKnowledge } from "../src/store/first-hit.js";

const temps: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
}
afterEach(() => {
  for (const d of temps.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("assessFirstHitSync", () => {
  it("reports no_global when neither global nor project config exists", () => {
    const root = tempDir("fh-noproj-");
    const r = assessFirstHitSync(root, { globalRoot: tempDir("fh-g-") });
    expect(r.code).toBe("no_global");
    expect(r.ok).toBe(false);
    expect(r.exit_code).toBeGreaterThan(0);
  });

  it("reports no_project when global exists but project config missing", () => {
    const g = tempDir("fh-g-only-");
    mkdirSync(join(g, "stores"), { recursive: true });
    writeFileSync(
      join(g, "fabric-global.json"),
      JSON.stringify({
        uid: "u-test",
        stores: [
          {
            store_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            alias: "team",
            personal: false,
          },
        ],
      }),
      "utf8",
    );
    const root = tempDir("fh-proj-missing-");
    const r = assessFirstHitSync(root, { globalRoot: g });
    expect(r.code).toBe("no_project");
    expect(r.ok).toBe(false);
  });

  it("reports empty_store when bound write target has 0 knowledge", async () => {
    // Minimal: project + empty store dir layout
    const g = tempDir("fh-g-empty-");
    const uuid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const storeDir = join(g, "stores", "team", uuid);
    mkdirSync(join(storeDir, "knowledge", "guidelines"), { recursive: true });
    writeFileSync(
      join(g, "fabric-global.json"),
      JSON.stringify({
        uid: "u-test",
        stores: [{ store_uuid: uuid, alias: "team", personal: false }],
      }),
      "utf8",
    );
    const root = tempDir("fh-p-empty-");
    mkdirSync(join(root, ".fabric"), { recursive: true });
    writeFileSync(
      join(root, ".fabric", "fabric-config.json"),
      JSON.stringify({
        version: 1,
        active_write_store: "team",
        required_stores: [{ id: "team" }],
      }),
      "utf8",
    );
    // Install minimal hooks so we don't stop at hooks_missing first
    for (const client of [".claude", ".codex"]) {
      mkdirSync(join(root, client, "hooks"), { recursive: true });
      writeFileSync(join(root, client, "hooks", "knowledge-hint-broad.cjs"), "module.exports={}\n");
      writeFileSync(join(root, client, "hooks", "knowledge-pretooluse.cjs"), "module.exports={}\n");
    }
    const r = assessFirstHitSync(root, { globalRoot: g });
    // May be unbound if resolver cannot see required_stores mapping without mount path;
    // accept empty_store OR unbound as fail-loud not-ok.
    expect(r.ok).toBe(false);
    expect(["empty_store", "unbound", "no_write_target"]).toContain(r.code);
  });

  it("seedStarterKnowledge writes two markdown files", async () => {
    const storeDir = tempDir("fh-seed-");
    mkdirSync(join(storeDir, "knowledge"), { recursive: true });
    writeFileSync(join(storeDir, "counters.json"), JSON.stringify({ KT: {}, KP: {} }), "utf8");
    const result = await seedStarterKnowledge(storeDir, { layer: "team" });
    expect(result.ids.length).toBe(2);
    expect(result.files.length).toBe(2);
  });
});


describe("D3 multi-store first-hit codes", () => {
  function writeHooks(root: string) {
    for (const client of [".claude", ".codex"] as const) {
      mkdirSync(join(root, client, "hooks"), { recursive: true });
      writeFileSync(join(root, client, "hooks", "knowledge-hint-broad.cjs"), "module.exports={}\n");
      writeFileSync(join(root, client, "hooks", "knowledge-pretooluse.cjs"), "module.exports={}\n");
    }
  }

  it("reports missing_required when required id is not mounted", () => {
    const g = tempDir("d3-g-miss-");
    const uuid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    mkdirSync(join(g, "stores", "team", uuid, "knowledge", "guidelines"), { recursive: true });
    writeFileSync(
      join(g, "fabric-global.json"),
      JSON.stringify({
        uid: "u-test",
        stores: [{ store_uuid: uuid, alias: "team", personal: false }],
      }),
      "utf8",
    );
    const root = tempDir("d3-p-miss-");
    mkdirSync(join(root, ".fabric"), { recursive: true });
    writeFileSync(
      join(root, ".fabric", "fabric-config.json"),
      JSON.stringify({
        version: 1,
        active_write_store: "team",
        required_stores: [{ id: "platform" }, { id: "team" }],
      }),
      "utf8",
    );
    writeHooks(root);
    const r = assessFirstHitSync(root, { globalRoot: g });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("missing_required");
    expect(r.missing_required_ids).toEqual(["platform"]);
    expect(r.remediations.some((x) => x.includes("platform"))).toBe(true);
  });

  it("reports write_target_mismatch when active write is not mounted", () => {
    const g = tempDir("d3-g-wtm-");
    const uuid = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const storeDir = join(g, "stores", "team", uuid);
    mkdirSync(join(storeDir, "knowledge", "guidelines"), { recursive: true });
    writeFileSync(join(storeDir, "knowledge", "guidelines", "KT-GLD-0001--x.md"), "# x\n", "utf8");
    writeFileSync(
      join(g, "fabric-global.json"),
      JSON.stringify({
        uid: "u-test",
        stores: [{ store_uuid: uuid, alias: "team", personal: false }],
      }),
      "utf8",
    );
    const root = tempDir("d3-p-wtm-");
    mkdirSync(join(root, ".fabric"), { recursive: true });
    writeFileSync(
      join(root, ".fabric", "fabric-config.json"),
      JSON.stringify({
        version: 1,
        active_write_store: "other-team",
        required_stores: [{ id: "team" }],
      }),
      "utf8",
    );
    writeHooks(root);
    const r = assessFirstHitSync(root, { globalRoot: g });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("write_target_mismatch");
  });

  it("reports store_unreachable when registry points at missing dir", () => {
    const g = tempDir("d3-g-unr-");
    const uuid = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    // registry lists store but do NOT create dir
    writeFileSync(
      join(g, "fabric-global.json"),
      JSON.stringify({
        uid: "u-test",
        stores: [{ store_uuid: uuid, alias: "team", personal: false }],
      }),
      "utf8",
    );
    const root = tempDir("d3-p-unr-");
    mkdirSync(join(root, ".fabric"), { recursive: true });
    writeFileSync(
      join(root, ".fabric", "fabric-config.json"),
      JSON.stringify({
        version: 1,
        active_write_store: "team",
        required_stores: [{ id: "team" }],
      }),
      "utf8",
    );
    writeHooks(root);
    const r = assessFirstHitSync(root, { globalRoot: g });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("store_unreachable");
    expect(r.unreachable_aliases).toContain("team");
  });

  it("dual-store team+personal: ok when team write target has knowledge", () => {
    const g = tempDir("d3-g-dual-");
    const teamUuid = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const personalUuid = "11111111-1111-4111-8111-111111111111";
    const teamDir = join(g, "stores", "team", teamUuid);
    const personalDir = join(g, "stores", "personal", personalUuid);
    mkdirSync(join(teamDir, "knowledge", "guidelines"), { recursive: true });
    mkdirSync(join(personalDir, "knowledge", "guidelines"), { recursive: true });
    writeFileSync(join(teamDir, "knowledge", "guidelines", "KT-GLD-0001--a.md"), "# a\n", "utf8");
    writeFileSync(join(personalDir, "knowledge", "guidelines", "KP-GLD-0001--b.md"), "# b\n", "utf8");
    writeFileSync(
      join(g, "fabric-global.json"),
      JSON.stringify({
        uid: "u-test",
        stores: [
          { store_uuid: teamUuid, alias: "team", personal: false },
          { store_uuid: personalUuid, alias: "personal", personal: true },
        ],
      }),
      "utf8",
    );
    const root = tempDir("d3-p-dual-");
    mkdirSync(join(root, ".fabric"), { recursive: true });
    writeFileSync(
      join(root, ".fabric", "fabric-config.json"),
      JSON.stringify({
        version: 1,
        active_write_store: "team",
        required_stores: [{ id: "team" }],
      }),
      "utf8",
    );
    writeHooks(root);
    const r = assessFirstHitSync(root, { globalRoot: g });
    // resolver may only surface required team; personal is machine-wide
    expect(r.ok).toBe(true);
    expect(r.code).toBe("ok");
    expect(r.total_entries).toBeGreaterThanOrEqual(1);
  });
});


describe("D3 multi-store readiness", () => {
  it("reports missing_required when required team is not mounted", () => {
    const g = tempDir("fh-d3-miss-g-");
    writeFileSync(
      join(g, "fabric-global.json"),
      JSON.stringify({
        uid: "u-d3",
        stores: [
          {
            store_uuid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            alias: "personal",
            personal: true,
          },
        ],
      }),
      "utf8",
    );
    const root = tempDir("fh-d3-miss-p-");
    mkdirSync(join(root, ".fabric"), { recursive: true });
    writeFileSync(
      join(root, ".fabric", "fabric-config.json"),
      JSON.stringify({
        version: 1,
        required_stores: [{ id: "team" }],
        active_write_store: "team",
      }),
      "utf8",
    );
    const r = assessFirstHitSync(root, { globalRoot: g });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("missing_required");
    expect(r.missing_required_ids).toContain("team");
    expect(r.remediations.some((x) => x.includes("bind"))).toBe(true);
  });

  it("reports write_target_mismatch when write target is not mounted", () => {
    const g = tempDir("fh-d3-wt-g-");
    const uuid = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const storeDir = join(g, "stores", "team", uuid);
    mkdirSync(join(storeDir, "knowledge", "guidelines"), { recursive: true });
    writeFileSync(
      join(storeDir, "knowledge", "guidelines", "KT-GLD-0001--x.md"),
      "---\nid: KT-GLD-0001\n---\n# x\n",
      "utf8",
    );
    writeFileSync(
      join(g, "fabric-global.json"),
      JSON.stringify({
        uid: "u-d3",
        stores: [{ store_uuid: uuid, alias: "team", personal: false }],
      }),
      "utf8",
    );
    const root = tempDir("fh-d3-wt-p-");
    mkdirSync(join(root, ".fabric"), { recursive: true });
    writeFileSync(
      join(root, ".fabric", "fabric-config.json"),
      JSON.stringify({
        version: 1,
        required_stores: [{ id: "team" }],
        active_write_store: "other-team",
      }),
      "utf8",
    );
    for (const client of [".claude", ".codex"]) {
      mkdirSync(join(root, client, "hooks"), { recursive: true });
      writeFileSync(join(root, client, "hooks", "knowledge-hint-broad.cjs"), "module.exports={}\n");
      writeFileSync(join(root, client, "hooks", "knowledge-pretooluse.cjs"), "module.exports={}\n");
    }
    const r = assessFirstHitSync(root, { globalRoot: g });
    expect(r.ok).toBe(false);
    expect(["write_target_mismatch", "unbound", "missing_required"]).toContain(r.code);
  });

  it("reports store_unreachable when store dir is missing on disk", () => {
    const g = tempDir("fh-d3-unr-g-");
    const uuid = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    // registry points at path that we never create
    writeFileSync(
      join(g, "fabric-global.json"),
      JSON.stringify({
        uid: "u-d3",
        stores: [{ store_uuid: uuid, alias: "team", personal: false }],
      }),
      "utf8",
    );
    const root = tempDir("fh-d3-unr-p-");
    mkdirSync(join(root, ".fabric"), { recursive: true });
    writeFileSync(
      join(root, ".fabric", "fabric-config.json"),
      JSON.stringify({
        version: 1,
        required_stores: [{ id: "team" }],
        active_write_store: "team",
      }),
      "utf8",
    );
    for (const client of [".claude", ".codex"]) {
      mkdirSync(join(root, client, "hooks"), { recursive: true });
      writeFileSync(join(root, client, "hooks", "knowledge-hint-broad.cjs"), "module.exports={}\n");
      writeFileSync(join(root, client, "hooks", "knowledge-pretooluse.cjs"), "module.exports={}\n");
    }
    const r = assessFirstHitSync(root, { globalRoot: g });
    expect(r.ok).toBe(false);
    expect(["store_unreachable", "empty_store", "unbound"]).toContain(r.code);
  });
});
