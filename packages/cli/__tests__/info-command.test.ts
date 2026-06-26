import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import infoCommand, { gatherRecallStatus } from "../src/commands/info.js";

const originalExitCode = process.exitCode;

afterEach(() => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

// W3-F (NS-01 §1/I1): `info scope` was a positional-detected pseudo-subcommand;
// it is now a real citty subCommand so `fabric info scope --help` works and the
// coordinate is a citty-validated required positional (the old hand-rolled
// "missing scope" branch is gone — citty enforces it).
describe("info command — scope as a real subcommand (W3-F)", () => {
  it("registers a real `scope` subcommand", () => {
    const sub = infoCommand.subCommands as Record<string, unknown> | undefined;
    expect(sub).toBeDefined();
    expect(sub?.scope).toBeDefined();
  });

  it("the scope subcommand requires a `coord` positional", () => {
    const scope = (infoCommand.subCommands as Record<string, { args: Record<string, { type: string; required?: boolean }> }>)
      .scope;
    expect(scope.args.coord.type).toBe("positional");
    expect(scope.args.coord.required).toBe(true);
  });

  it("parent `info` no longer detects a positional `subcommand` arg", () => {
    // Scope routing is citty's job now; the parent only does status / whoami.
    const args = infoCommand.args as Record<string, unknown> | undefined;
    expect(args?.subcommand).toBeUndefined();
    expect(args?.scope).toBeUndefined();
  });

  it("parent `info` run resolves a mode without throwing", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(() => infoCommand.run?.({ args: {} } as never)).not.toThrow();
  });
});

// P1 recall-engine-refactor (follow-up): `fabric info recall` status surface.
describe("info recall — recall-engine status (gatherRecallStatus)", () => {
  const roots: string[] = [];
  let prevHome: string | undefined;

  function project(config: Record<string, unknown>): string {
    const root = mkdtempSync(join(tmpdir(), "fabric-recall-status-"));
    roots.push(root);
    mkdirSync(join(root, ".fabric"), { recursive: true });
    writeFileSync(join(root, ".fabric", "fabric-config.json"), JSON.stringify(config));
    return root;
  }

  beforeEach(() => {
    prevHome = process.env.FABRIC_HOME;
    // Isolated empty home → the model is never "cached", so vector_ready is
    // deterministic regardless of the dev machine's real ~/.fabric.
    const home = mkdtempSync(join(tmpdir(), "fabric-recall-home-"));
    roots.push(home);
    process.env.FABRIC_HOME = home;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.FABRIC_HOME;
    else process.env.FABRIC_HOME = prevHome;
    for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
  });

  it("registers a real `recall` subcommand", () => {
    const sub = infoCommand.subCommands as Record<string, unknown> | undefined;
    expect(sub?.recall).toBeDefined();
  });

  it("forced fusion=additive resolves to additive", () => {
    const s = gatherRecallStatus(project({ required_stores: [{ id: "team" }], fusion: "additive" }));
    expect(s.fusion_configured).toBe("additive");
    expect(s.fusion_effective).toBe("additive");
  });

  it("forced fusion=rrf resolves to rrf", () => {
    const s = gatherRecallStatus(project({ required_stores: [{ id: "team" }], fusion: "rrf" }));
    expect(s.fusion_configured).toBe("rrf");
    expect(s.fusion_effective).toBe("rrf");
  });

  it("default (auto) with embeddings off → additive safe fallback", () => {
    const s = gatherRecallStatus(project({ required_stores: [{ id: "team" }], embed_enabled: false }));
    expect(s.fusion_configured).toBe("auto");
    expect(s.embed_enabled).toBe(false);
    expect(s.vector_ready).toBe(false);
    expect(s.fusion_effective).toBe("additive");
    expect(s.fusion_reason).toContain("auto");
  });

  it("model cache dir is the stable FABRIC_HOME-rooted path; uncached in a fresh home", () => {
    const s = gatherRecallStatus(project({ required_stores: [{ id: "team" }] }));
    expect(s.model_cache_dir.endsWith(join(".fabric", "cache", "embed"))).toBe(true);
    expect(s.model_cached).toBe(false);
    // With no model on disk the vector channel can't be ready → auto stays additive.
    expect(s.vector_ready).toBe(false);
    expect(s.fusion_effective).toBe("additive");
  });
});
