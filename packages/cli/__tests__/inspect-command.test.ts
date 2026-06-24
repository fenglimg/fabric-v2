import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { runInspect } from "../src/commands/inspect.js";

// Block 5 (Option X) / W3-F: `fabric inspect` shares ONE renderer with the
// SessionStart hook (buildSessionStartSinks), so its output is BYTE-IDENTICAL to
// what the hook injects. This is the producer-consumer round-trip oracle — pinned
// as a test so any future renderer drift between the two surfaces fails here.

const require = createRequire(import.meta.url);
const hook = require(
  fileURLToPath(new URL("../templates/hooks/knowledge-hint-broad.cjs", import.meta.url)),
) as {
  buildSessionStartSinks: (
    cwd: string,
    payload: unknown,
    env: unknown,
  ) => { human: string | null; ai: string | null; hasRenderedContent: boolean };
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// A minimal project cwd with a fabric-config so language/config reads resolve
// (they degrade to defaults regardless; the dir just needs to exist).
function tmpProject(): string {
  const root = mkdtempSync(join(tmpdir(), "fabric-context-"));
  dirs.push(root);
  mkdirSync(join(root, ".fabric"), { recursive: true });
  writeFileSync(
    join(root, ".fabric", "fabric-config.json"),
    JSON.stringify({ project_id: "ctx-test", fabric_language: "en" }),
    "utf8",
  );
  return root;
}

// Canned plan-context-hint payload that yields BOTH a human census and an AI
// spine (always-active guideline body + a broad decision REFERENCE entry).
function cannedPayload() {
  return {
    version: 2,
    revision_hash: "sha256:deadbeefcafe",
    target_paths: ["**"],
    entries: [
      {
        id: "KT-DEC-0001",
        type: "decision",
        maturity: "proven",
        summary: "Boundary B: data + lifecycle",
        relevance_scope: "broad",
        must_read_if: "designing a scope boundary",
      },
    ],
    broad_count: 1,
    narrow_count: 0,
    broad_only_count: 1,
    always_bodies: [
      { id: "KT-GLD-0001", type: "guideline", layer: "team", summary: "code style", body: "# Code style\nbody text" },
    ],
    census: {
      by_type: { guidelines: 1, decisions: 1 },
      by_layer: { team: 2, personal: 0, project: 0 },
      dropped_other_project: 0,
      total: 2,
    },
  };
}

describe("fabric inspect — shared renderer, byte-identical to hook injection", () => {
  it("--render ai output is byte-identical to the hook's AI sink (round-trip oracle)", async () => {
    const cwd = tmpProject();
    const payload = cannedPayload();
    const sinks = hook.buildSessionStartSinks(cwd, payload, {});
    expect(sinks.ai).toBeTruthy();

    const out = await runInspect({ render: "ai", target: cwd, payload });
    expect(out).toBe(sinks.ai);
  });

  it("--render human output is byte-identical to the hook's human sink", async () => {
    const cwd = tmpProject();
    const payload = cannedPayload();
    const sinks = hook.buildSessionStartSinks(cwd, payload, {});
    expect(sinks.human).toBeTruthy();

    const out = await runInspect({ render: "human", target: cwd, payload });
    expect(out).toBe(sinks.human);
  });

  it("default (no --render) shows both sinks", async () => {
    const cwd = tmpProject();
    const payload = cannedPayload();
    const out = await runInspect({ target: cwd, payload });
    expect(out).toContain("ALWAYS-ACTIVE RULES"); // AI sink
    expect(out).toContain("▸ [fabric]"); // human sink: scope-primary HUD header (H2)
  });

  it("--explain appends per-entry provenance (id + type)", async () => {
    const cwd = tmpProject();
    const payload = cannedPayload();
    const out = await runInspect({ render: "ai", explain: true, target: cwd, payload });
    expect(out).toContain("KT-DEC-0001");
    expect(out).toContain("decision");
    // explain mode adds a detail section the plain render does not.
    const plain = await runInspect({ render: "ai", target: cwd, payload });
    expect(out.length).toBeGreaterThan(plain.length);
  });

  it("empty payload → empty render (no crash)", async () => {
    const cwd = tmpProject();
    const emptyPayload = {
      version: 2,
      revision_hash: "sha256:0",
      target_paths: ["**"],
      entries: [],
      broad_count: 0,
      narrow_count: 0,
      broad_only_count: 0,
      always_bodies: [],
      census: { by_type: {}, by_layer: { team: 0, personal: 0, project: 0 }, dropped_other_project: 0, total: 0 },
    };
    const out = await runInspect({ render: "ai", target: cwd, payload: emptyPayload });
    expect(out).toBe("");
  });
});
