/**
 * Tests for `cleanupDeprecatedSkills(projectRoot)` — the rc.35 TASK-03
 * helper that removes legacy skill subtrees (e.g. fabric-init) left over
 * from rc.30-and-earlier installs. The helper is wired into `fab install`'s
 * skill-install phase BEFORE the modern install* calls.
 *
 * Two contract cases per TASK-03 spec:
 *   (a) "fresh" — no deprecated dir present → all rows are skipped/absent
 *   (b) "has-deprecated" — fabric-init dir present → rows are written /
 *       removed-deprecated AND the directory is gone after the call
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupDeprecatedSkills,
  DEPRECATED_SKILL_DIRS,
} from "../src/install/skills-and-hooks.ts";
import {
  cleanupFixtureRoot,
  createWerewolfFixtureRoot,
} from "./helpers/init-test-utils.ts";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }
});

describe("cleanupDeprecatedSkills", () => {
  it("(fresh) returns all-skipped rows when no deprecated skill dirs exist", async () => {
    const root = createWerewolfFixtureRoot("fab-deprecated-fresh");
    tempRoots.push(root);

    const results = await cleanupDeprecatedSkills(root);

    expect(results).toHaveLength(DEPRECATED_SKILL_DIRS.length);
    for (const r of results) {
      expect(r.step).toBe("skill-deprecated-cleanup");
      expect(r.status).toBe("skipped");
      expect(r.message).toBe("absent");
    }
  });

  it("(has-deprecated) removes pre-existing fabric-init dirs and reports written/removed-deprecated", async () => {
    const root = createWerewolfFixtureRoot("fab-deprecated-present");
    tempRoots.push(root);

    // Seed legacy installs in both client trees.
    for (const rel of DEPRECATED_SKILL_DIRS) {
      const dir = join(root, rel);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), "# legacy stub\n", "utf8");
      writeFileSync(join(dir, "ref.md"), "stale supporting file\n", "utf8");
    }
    for (const rel of DEPRECATED_SKILL_DIRS) {
      expect(existsSync(join(root, rel))).toBe(true);
    }

    const results = await cleanupDeprecatedSkills(root);

    expect(results).toHaveLength(DEPRECATED_SKILL_DIRS.length);
    for (const r of results) {
      expect(r.step).toBe("skill-deprecated-cleanup");
      expect(r.status).toBe("written");
      expect(r.message).toBe("removed-deprecated");
    }
    // The whole subtree (including supporting files) must be gone.
    for (const rel of DEPRECATED_SKILL_DIRS) {
      expect(existsSync(join(root, rel))).toBe(false);
    }
  });

  it("(idempotency) second call on a cleaned root is all-skipped", async () => {
    const root = createWerewolfFixtureRoot("fab-deprecated-idempotent");
    tempRoots.push(root);
    mkdirSync(join(root, DEPRECATED_SKILL_DIRS[0]), { recursive: true });
    writeFileSync(join(root, DEPRECATED_SKILL_DIRS[0], "SKILL.md"), "x", "utf8");

    const first = await cleanupDeprecatedSkills(root);
    expect(first.some((r) => r.status === "written")).toBe(true);

    const second = await cleanupDeprecatedSkills(root);
    for (const r of second) {
      expect(r.status).toBe("skipped");
    }
  });
});
