import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unsealedProjectScopeWarning } from "./write-scope-warning.js";

// unsealedProjectScopeWarning folds the detectUnboundProject precondition into a
// write-path GateWarning: a bound write store with no project coordinate lands
// team-layer entries flat instead of under projects/<id>/. Advisory, never
// throws — mirrors the doctor check it reuses.

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function projectWithConfig(config: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "fab-write-scope-"));
  dirs.push(root);
  mkdirSync(join(root, ".fabric"), { recursive: true });
  writeFileSync(join(root, ".fabric", "fabric-config.json"), JSON.stringify(config), "utf8");
  return root;
}

describe("unsealedProjectScopeWarning", () => {
  it("warns when a write store is bound but the project coordinate is missing", () => {
    const root = projectWithConfig({
      required_stores: [{ id: "team" }],
      active_write_store: "wespy-team-cocos-knowledge-base",
    });
    const warn = unsealedProjectScopeWarning(root);
    expect(warn).not.toBeNull();
    expect(warn?.code).toBe("project_scope_unsealed");
    expect(warn?.file).toBe("<response>");
    // action_hint names the bound store and points at the seal command.
    expect(warn?.action_hint).toContain("wespy-team-cocos-knowledge-base");
    expect(warn?.action_hint).toContain("fabric doctor --fix");
    // enumerates the missing coordinate fields so the operator sees what's absent.
    expect(warn?.action_hint).toContain("project_id");
    expect(warn?.action_hint).toContain("active_project");
  });

  it("warns on a partial coordinate (project_id present, active_project missing)", () => {
    const root = projectWithConfig({
      required_stores: [{ id: "team" }],
      active_write_store: "team",
      project_id: "11111111-1111-4111-8111-111111111111",
    });
    const warn = unsealedProjectScopeWarning(root);
    expect(warn).not.toBeNull();
    expect(warn?.action_hint).toContain("active_project");
    expect(warn?.action_hint).not.toContain("project_id,");
  });

  it("returns null once the project coordinate is sealed", () => {
    const root = projectWithConfig({
      required_stores: [{ id: "team" }],
      active_write_store: "team",
      project_id: "11111111-1111-4111-8111-111111111111",
      active_project: "werewolf-minigame",
    });
    expect(unsealedProjectScopeWarning(root)).toBeNull();
  });

  it("returns null when no write store is bound (nothing to warn about yet)", () => {
    const root = projectWithConfig({ required_stores: [] });
    expect(unsealedProjectScopeWarning(root)).toBeNull();
  });

  it("returns null (never throws) when the project config is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "fab-write-scope-empty-"));
    dirs.push(root);
    expect(unsealedProjectScopeWarning(root)).toBeNull();
  });
});
