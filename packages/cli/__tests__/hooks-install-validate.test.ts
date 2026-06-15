/**
 * Unit tests for the rc.5 TASK-010 cross-client hook path validation step
 * added to `installHooks` in packages/cli/src/install/hooks-orchestrator.ts
 * (rc.15 relocation; formerly packages/cli/src/commands/hooks.ts).
 *
 * The full installHooks flow needs a fixture project root (covered by the
 * werewolf-fixture integration test). These focused tests exercise the
 * validateHookPaths post-step using hand-built fake project trees so the
 * two-client behaviour can be exercised independently of the install copy
 * phase.
 *
 * The validation step is internal to installHooks (not separately exported),
 * so we drive it through `installHooks` and assert on the InstallHooksResult
 * shape — specifically on the `hook-validate-{claude,codex}` entries
 * appearing in the right buckets.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { installHooks } from "../src/install/hooks-orchestrator.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

function mkRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `${name}-`));
  tempRoots.push(root);
  return root;
}

describe("installHooks — rc.5 TASK-010 cross-client hook path validation", () => {
  it("emits hook-validate-claude/codex skipped entries when install + merge succeeded", async () => {
    const target = mkRoot("hooks-install-validate-happy");
    // Pre-create the directories — installHooks must succeed end-to-end so
    // both configs land on disk; the validate step is then a sanity
    // check that the corresponding fabric-hint.cjs file is actually present.
    for (const sub of [".claude", ".codex"]) {
      mkdirSync(join(target, sub), { recursive: true });
    }

    const result = await installHooks(target);

    // No errors — happy-path install + validate.
    expect(result.errors).toEqual([]);

    // Each validate step is a `skipped` entry with the hook script path. We
    // look for the hook-validate-{client}[-broad] step keys via their paths.
    const skippedJoined = result.skipped.join("\n");
    expect(skippedJoined).toContain(join(target, ".claude", "hooks", "fabric-hint.cjs"));
    expect(skippedJoined).toContain(join(target, ".codex", "hooks", "fabric-hint.cjs"));
    // rc.6 TASK-019 (E1): SessionStart broad-injection hook validates per client.
    expect(skippedJoined).toContain(join(target, ".claude", "hooks", "knowledge-hint-broad.cjs"));
    expect(skippedJoined).toContain(join(target, ".codex", "hooks", "knowledge-hint-broad.cjs"));
    // rc.6 TASK-020 (E2 + E4): PreToolUse narrow-injection hook validates per client.
    expect(skippedJoined).toContain(join(target, ".claude", "hooks", "knowledge-hint-narrow.cjs"));
    expect(skippedJoined).toContain(join(target, ".codex", "hooks", "knowledge-hint-narrow.cjs"));
  });

  it("happy-path skipped count is exactly 2 fabric-hint + 2 broad-hint + 2 narrow-hint validate entries (one per client)", async () => {
    const target = mkRoot("hooks-install-validate-count");
    const result = await installHooks(target);

    // Count entries where the path ends with `<client>/hooks/fabric-hint.cjs`.
    const stopValidate = result.skipped.filter((p) =>
      p.endsWith(join("hooks", "fabric-hint.cjs")),
    );
    // rc.6 TASK-019: SessionStart sibling — same one-row-per-client shape.
    const broadValidate = result.skipped.filter((p) =>
      p.endsWith(join("hooks", "knowledge-hint-broad.cjs")),
    );
    // rc.6 TASK-020: PreToolUse sibling — same one-row-per-client shape.
    const narrowValidate = result.skipped.filter((p) =>
      p.endsWith(join("hooks", "knowledge-hint-narrow.cjs")),
    );
    // Note: each client also produces a copy `skipped` if the file existed.
    // On a fresh target the copy produces `written` not `skipped`, so the
    // skipped entries ending in the hook filenames come exclusively from the
    // validate step.
    expect(stopValidate.length).toBe(2);
    expect(broadValidate.length).toBe(2);
    expect(narrowValidate.length).toBe(2);
  });
});
