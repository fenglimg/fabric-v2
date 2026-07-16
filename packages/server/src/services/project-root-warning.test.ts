import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PROJECT_ROOT_UNRESOLVED_CODE,
  projectRootUnresolvedMessage,
  projectRootWarning,
} from "./project-root-warning.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

function newTmpDir(): string {
  const raw = mkdtempSync(join(tmpdir(), "project-root-warning-"));
  tempRoots.push(raw);
  return realpathSync(raw);
}

describe("projectRootWarning (KT-PIT-0046 fail-loud)", () => {
  it("returns null when the root carries .fabric/fabric-config.json", () => {
    const root = newTmpDir();
    mkdirSync(join(root, ".fabric"), { recursive: true });
    writeFileSync(join(root, ".fabric", "fabric-config.json"), "{}\n");
    expect(projectRootWarning(root)).toBeNull();
  });

  it("returns the loud structured warning when the config is absent (rootless-spawn repro)", () => {
    const root = newTmpDir();
    const warning = projectRootWarning(root);
    expect(warning).not.toBeNull();
    expect(warning?.code).toBe(PROJECT_ROOT_UNRESOLVED_CODE);
    // The exact phrase the outage postmortem asked to make loud.
    expect(warning?.message).toContain("project root unresolved — serving personal store only");
    expect(warning?.message).toContain(root);
    // action_hint must name every recovery lever: env pin, launch dir, roots.
    expect(warning?.action_hint).toContain("FABRIC_PROJECT_ROOT");
    expect(warning?.action_hint).toContain("roots");
    // Structural fit with structuredWarningSchema (code/file/action_hint present).
    expect(warning?.file).toBe("<server>");
  });

  it("a bare .fabric/ dir without fabric-config.json still warns", () => {
    const root = newTmpDir();
    mkdirSync(join(root, ".fabric"), { recursive: true });
    expect(projectRootWarning(root)).not.toBeNull();
  });

  it("message helper embeds the resolved root verbatim", () => {
    expect(projectRootUnresolvedMessage("/")).toContain('"/"');
  });
});
