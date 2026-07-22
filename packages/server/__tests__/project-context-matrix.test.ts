import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
  ProjectContextAmbiguousError,
  ProjectContextUnresolvedError,
  createProjectContextResolver,
} from "@fenglimg/fabric-shared";

import { PROJECT_CONTEXT_MATRIX } from "../../shared/test/fixtures/project-context-matrix.js";
import {
  createGitWorktreeFixture,
  fixtureRoot,
  type GitWorktreeFixture,
} from "../../shared/test/helpers/git-worktree-fixture.js";
import { ProjectContextProvider } from "../src/project-context-provider.js";

const fixtures: GitWorktreeFixture[] = [];

afterEach(() => {
  delete process.env.FABRIC_PROJECT_ROOT;
  delete process.env.CLAUDE_PROJECT_DIR;
  for (const fixture of fixtures.splice(0).reverse()) fixture.cleanup();
});

describe("project context cross-client/worktree matrix", () => {
  it("creates committed main/linked/unrelated repositories and cleans deterministically", () => {
    const fixture = createGitWorktreeFixture();
    expect(execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: fixture.main, encoding: "utf8" })).toBeTruthy();
    expect(execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: fixture.linked, encoding: "utf8" })).toBeTruthy();
    expect(execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: fixture.unrelated, encoding: "utf8" })).toBeTruthy();
    expect(existsSync(`${fixture.linked}/.fabric`)).toBe(false);
    expect(existsSync(fixture.base)).toBe(true);
    fixture.cleanup();
    fixture.cleanup();
    expect(existsSync(fixture.base)).toBe(false);
  });

  for (const testCase of PROJECT_CONTEXT_MATRIX) {
    it(testCase.name, () => {
      const fixture = createGitWorktreeFixture();
      fixtures.push(fixture);
      fixture.configureLinkedBinding(testCase.workspaceBinding);
      const roots = testCase.roots.map((root) => fixtureRoot(fixture, root));

      if (testCase.error === "unresolved") {
        expect(() => createProjectContextResolver({ roots })).toThrow(ProjectContextUnresolvedError);
        return;
      }

      const provider = new ProjectContextProvider();
      provider.setRoots(roots);
      if (testCase.rootMode === "pinned") {
        process.env.FABRIC_PROJECT_ROOT = fixtureRoot(fixture, testCase.explicitRoot!);
      }

      if (testCase.error === "ambiguous") {
        expect(() => provider.snapshotForCall()).toThrow(ProjectContextAmbiguousError);
        return;
      }

      const context = provider.snapshotForCall();
      expect(context).toEqual({
        workspaceRoot: realpathSync(fixtureRoot(fixture, testCase.expected!.workspaceRoot)),
        identityRoot: realpathSync(fixtureRoot(fixture, testCase.expected!.identityRoot)),
        projectId: testCase.expected!.projectId,
        bindingId: testCase.expected!.bindingId,
        source: testCase.expected!.source,
      });
      expect(Object.isFrozen(context)).toBe(true);
    });
  }
});
