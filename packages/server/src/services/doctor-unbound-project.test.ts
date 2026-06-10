import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createUnboundProjectCheck, detectUnboundProject } from "./doctor-unbound-project.js";

// detectUnboundProject is the read-only half of the project-scope binding
// backfill lint: "store bound as write target but no project_id /
// active_project". (The write half lives on the CLI side.)

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function projectWithConfig(config: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "fab-unbound-"));
  dirs.push(root);
  mkdirSync(join(root, ".fabric"), { recursive: true });
  writeFileSync(join(root, ".fabric", "fabric-config.json"), JSON.stringify(config), "utf8");
  return root;
}

const t = ((key: string) => key) as never;

describe("detectUnboundProject", () => {
  it("flags a store bound as write target with no project_id / active_project", () => {
    const root = projectWithConfig({
      required_stores: [{ id: "team" }],
      active_write_store: "team",
    });
    const violation = detectUnboundProject(root);
    expect(violation).not.toBeNull();
    expect(violation?.alias).toBe("team");
    expect(violation?.missing).toEqual(["project_id", "active_project"]);
  });

  it("flags a partial coordinate (project_id present, active_project missing)", () => {
    const root = projectWithConfig({
      required_stores: [{ id: "team" }],
      active_write_store: "team",
      project_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(detectUnboundProject(root)?.missing).toEqual(["active_project"]);
  });

  it("returns null when the project coordinate is complete", () => {
    const root = projectWithConfig({
      required_stores: [{ id: "team" }],
      active_write_store: "team",
      project_id: "11111111-1111-4111-8111-111111111111",
      active_project: "myproject",
    });
    expect(detectUnboundProject(root)).toBeNull();
  });

  it("returns null when there is no active write store (nothing bound yet)", () => {
    const root = projectWithConfig({ required_stores: [] });
    expect(detectUnboundProject(root)).toBeNull();
  });

  it("returns null (never throws) when the project config is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "fab-unbound-empty-"));
    dirs.push(root);
    expect(detectUnboundProject(root)).toBeNull();
  });
});

describe("createUnboundProjectCheck", () => {
  it("renders ok status when there is no violation", () => {
    const check = createUnboundProjectCheck(t, null);
    expect(check.status).toBe("ok");
    expect(check.code).toBeUndefined();
  });

  it("renders an advisory warning (never an error) with the unbound_project code", () => {
    const check = createUnboundProjectCheck(t, { alias: "team", missing: ["active_project"] });
    expect(check.status).toBe("warn");
    expect(check.kind).toBe("warning");
    expect(check.code).toBe("unbound_project");
    expect(check.fixable).toBe(false);
  });
});
