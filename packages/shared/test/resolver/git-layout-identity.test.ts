import { realpathSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { ProjectContextUnresolvedError } from "../../src/resolver/contracts.js";
import { resolveMainWorktree } from "../../src/resolver/git-worktree-identity.js";
import { createProjectContextResolver } from "../../src/resolver/project-context-resolver.js";
import {
  createGitLayoutFixture,
  GIT_LAYOUT_KINDS,
  LAYOUT_PROJECT_ID,
  type GitLayoutKind,
} from "../helpers/git-layout-fixture.js";

/**
 * Identity resolution must hold across every Git layout, not just the one the
 * original fixture happened to build.
 *
 * Contract under test (local-first):
 *   1. a checkout that carries its own `.fabric/fabric-config.json` IS its own
 *      identity root — no main-repository lookup happens at all;
 *   2. only a checkout WITHOUT that file inherits, and only from a real main
 *      checkout;
 *   3. when there is nothing to inherit from, resolution fails loudly instead of
 *      inventing an identity root.
 */

const fixture = createGitLayoutFixture();
afterAll(() => fixture.cleanup());

const BARE_HOSTED: readonly GitLayoutKind[] = ["bare-named", "bare-dotbare", "bare-as-dotgit"];

describe("identity resolution across git layouts — committed config (the normal case)", () => {
  // Driven off GIT_LAYOUT_KINDS, not a hand-listed subset: adding a layout to
  // the fixture must add coverage here, or the census silently stops being one.
  it.each(GIT_LAYOUT_KINDS)(
    "%s: each checkout is its own identity root",
    (kind) => {
      const layout = fixture.layout(kind);
      for (const worktree of layout.worktrees) {
        const context = createProjectContextResolver({ roots: [worktree] });
        expect(context.workspaceRoot).toBe(worktree);
        expect(context.identityRoot).toBe(worktree);
        expect(context.projectId).toBe(LAYOUT_PROJECT_ID);
      }
    },
  );

  it("bare-named: sibling worktrees share one project identity", () => {
    const layout = fixture.layout("bare-named");
    expect(layout.worktrees.length).toBeGreaterThan(1);
    const contexts = layout.worktrees.map((worktree) =>
      createProjectContextResolver({ roots: [worktree] }),
    );
    const [first, ...rest] = contexts;
    for (const context of rest) {
      expect(context.projectId).toBe(first!.projectId);
      expect(context.bindingId).toBe(first!.bindingId);
      // Distinct checkouts, one shared identity — the whole point.
      expect(context.workspaceRoot).not.toBe(first!.workspaceRoot);
    }
  });

  it("submodule: identity root is the submodule, never the superproject", () => {
    const layout = fixture.layout("submodule");
    const sub = layout.worktrees[0]!;
    const context = createProjectContextResolver({ roots: [sub] });
    // A submodule's git dir is `<super>/.git/modules/sub`, so the old
    // `basename(commonDir) === ".git"` test was false and identity fell through
    // to workspaceRoot by accident. Here it is the answer by rule, not by luck.
    expect(context.identityRoot).toBe(sub);
    expect(context.identitySource).toBe("local");
    expect(context.identityRoot).not.toBe(realpathSync.native(join(layout.container, "super")));
  });

  it("bare-as-dotgit: identity root is never the non-checkout container", () => {
    const layout = fixture.layout("bare-as-dotgit");
    const worktree = layout.worktrees[0]!;
    const context = createProjectContextResolver({ roots: [worktree] });
    expect(context.identityRoot).not.toBe(layout.container);
    expect(context.identityRoot).toBe(worktree);
  });
});

describe("resolveMainWorktree reports Git's own answer", () => {
  // Asserted directly rather than only through the resolver: on the integration
  // path `hasProjectConfig` happens to reject a bare repository too, so deleting
  // the `bare` guard leaves every end-to-end case green. This function's stated
  // contract — "a bare repository has no checkout to inherit from" — needs its
  // own assertion, or the guard is unprotected.
  it("normal-linked: names the main checkout, seen from the linked worktree", () => {
    const layout = fixture.layout("normal-linked");
    expect(resolveMainWorktree(layout.worktrees[0]!)).toBe(layout.mainCheckout);
  });

  // Regression guard: inside a submodule, `git worktree list --porcelain` names
  // the submodule's GIT DIR (`<super>/.git/modules/sub`) rather than its working
  // tree. That path exists, so an unvalidated answer would be a non-checkout
  // directory presented as the main worktree — the same failure shape as the
  // deleted `basename(commonDir)` heuristic, just sourced from Git.
  it("submodule: returns null rather than Git's git-dir answer", () => {
    const layout = fixture.layout("submodule");
    const sub = layout.worktrees[0]!;
    const main = resolveMainWorktree(sub);
    expect(main).toBeNull();
    expect(main).not.toBe(join(realpathSync.native(join(layout.container, "super")), ".git", "modules", "sub"));
  });

  it.each(BARE_HOSTED)("%s: returns null — a bare repository has no checkout", (kind) => {
    const layout = fixture.layout(kind);
    expect(resolveMainWorktree(layout.worktrees[0]!)).toBeNull();
  });
});

describe("identity resolution across git layouts — cold path (no local config)", () => {
  it("normal-linked: inherits from the real main checkout", () => {
    const layout = fixture.layout("normal-linked");
    const worktree = layout.worktrees[0]!;
    layout.dropLocalConfig(worktree);

    const context = createProjectContextResolver({ roots: [worktree] });
    expect(context.workspaceRoot).toBe(worktree);
    expect(context.identityRoot).toBe(layout.mainCheckout);
    expect(context.projectId).toBe(LAYOUT_PROJECT_ID);
  });

  it("submodule: fails loudly — a submodule never inherits from its superproject", () => {
    const layout = fixture.layout("submodule");
    const sub = layout.worktrees[0]!;
    layout.dropLocalConfig(sub);
    expect(() => createProjectContextResolver({ roots: [sub] })).toThrow(
      ProjectContextUnresolvedError,
    );
  });

  it.each(BARE_HOSTED)("%s: fails loudly — there is no main checkout to inherit from", (kind) => {
    const layout = fixture.layout(kind);
    // Bare-hosted layouts have no main checkout by construction.
    expect(layout.mainCheckout).toBeNull();
    const worktree = layout.worktrees[0]!;
    layout.dropLocalConfig(worktree);

    expect(() => createProjectContextResolver({ roots: [worktree] })).toThrow(
      ProjectContextUnresolvedError,
    );
  });
});
