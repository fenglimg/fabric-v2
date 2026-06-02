import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { projectStatus } from "../src/store/info-ops.js";
import { saveProjectConfig } from "../src/store/project-config-io.js";

// F9 regression: `fabric status` must not report "(not a Fabric project)" for a
// project that IS initialized but whose project_id is simply unset (project_id
// assignment is part of the deferred global-refactor). projectStatus exposes
// is_fabric_project so the command can distinguish "no project" from
// "project, unset id".

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpProject(): string {
  const root = mkdtempSync(join(tmpdir(), "fabric-status-"));
  dirs.push(root);
  return root;
}

describe("F9: projectStatus.is_fabric_project", () => {
  it("is true when a project config exists even with project_id unset", () => {
    const root = tmpProject();
    // An installed project has fabric-config.json but no project_id (current
    // install never writes one).
    saveProjectConfig({ required_stores: [{ id: "personal" }] } as never, root);

    const status = projectStatus(root, join(tmpProject(), ".fabric"));
    expect(status.is_fabric_project).toBe(true);
    expect(status.project_id).toBeNull();
    expect(status.required).toContain("personal");
  });

  it("is false when there is no project config at all", () => {
    const root = tmpProject();
    mkdirSync(join(root, ".fabric"), { recursive: true });
    const status = projectStatus(root, join(tmpProject(), ".fabric"));
    expect(status.is_fabric_project).toBe(false);
    expect(status.project_id).toBeNull();
  });
});
