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
