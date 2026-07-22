import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectContextProvider } from "./project-context-provider.js";

const roots: string[] = [];

function project(prefix: string, projectId: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  mkdirSync(join(root, ".fabric"), { recursive: true });
  writeFileSync(
    join(root, ".fabric", "fabric-config.json"),
    `${JSON.stringify({ project_id: projectId })}\n`,
  );
  return realpathSync(root);
}

afterEach(() => {
  delete process.env.FABRIC_PROJECT_ROOT;
  delete process.env.CLAUDE_PROJECT_DIR;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("ProjectContextProvider", () => {
  it("freezes each operation snapshot", () => {
    const first = project("fabric-provider-frozen-", "first");
    const provider = new ProjectContextProvider();
    provider.setRoots([first]);
    expect(Object.isFrozen(provider.snapshotForCall())).toBe(true);
  });

  it("applies a deferred roots refresh only to later operations", async () => {
    const first = project("fabric-provider-a-", "first");
    const second = project("fabric-provider-b-", "second");
    const provider = new ProjectContextProvider();
    provider.setRoots([first]);

    let release!: (paths: readonly string[]) => void;
    const pendingRoots = new Promise<readonly string[]>((resolve) => { release = resolve; });
    const refresh = provider.refreshRoots(async () => pendingRoots);

    const inFlight = provider.snapshotForCall();
    release([second]);
    await refresh;
    const later = provider.snapshotForCall();

    expect(inFlight.workspaceRoot).toBe(first);
    expect(inFlight.projectId).toBe("first");
    expect(later.workspaceRoot).toBe(second);
    expect(later.projectId).toBe("second");
  });

  it("fails with the stable typed error when client roots are ambiguous", () => {
    const first = project("fabric-provider-ambiguous-a-", "first");
    const second = project("fabric-provider-ambiguous-b-", "second");
    const provider = new ProjectContextProvider();
    provider.setRoots([first, second]);
    expect(() => provider.snapshotForCall()).toThrowError(
      expect.objectContaining({ code: "FABRIC_PROJECT_CONTEXT_AMBIGUOUS" }),
    );
  });
});
