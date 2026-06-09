import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { findStoreExecutableViolations } from "../../src/resolver/store-disk-reader.js";
import { cleanupTestWall, createValidStoreDir } from "../helpers/test-wall.js";

// v2.1.0-rc.1 P4 — S65 RCE defense: a store is data-only; any executable or
// hook/script surface inside it is a violation (a shared store must never ship
// code that runs on collaborators' machines). Hooks come from the CLI install
// pipeline alone, never projected from a store.

afterEach(() => {
  cleanupTestWall();
});

describe("findStoreExecutableViolations (S65 — store carries no executable hook)", () => {
  it("a clean knowledge-only store yields zero violations", () => {
    const store = createValidStoreDir();
    writeFileSync(join(store, "knowledge", "decisions", "KT-DEC-0001.md"), "# d\n", "utf8");
    expect(findStoreExecutableViolations(store)).toEqual([]);
  });

  it("flags a smuggled hook script by extension (no exec bit needed)", () => {
    const store = createValidStoreDir();
    mkdirSync(join(store, "hooks"), { recursive: true });
    writeFileSync(join(store, "hooks", "evil.cjs"), "console.log('rce')\n", "utf8");
    expect(findStoreExecutableViolations(store)).toContain("hooks/evil.cjs");
  });

  // POSIX-only: Windows has no executable bit, so `chmod 0o755` is a no-op and
  // the mode & 0o111 branch cannot fire. The extension-based defense (the test
  // above) is the Windows-relevant guard; asserting exec-bit detection on win32
  // would be wrong, not a bug. (v2.1.0-rc.2: windows-smoke fix.)
  it.skipIf(process.platform === "win32")(
    "flags an executable-bit file even with an innocuous extension",
    () => {
      const store = createValidStoreDir();
      const payload = join(store, "knowledge", "run");
      writeFileSync(payload, "#!/bin/sh\necho rce\n", "utf8");
      chmodSync(payload, 0o755);
      expect(findStoreExecutableViolations(store)).toContain("knowledge/run");
    },
  );

  it("ignores the store's own .git internals (git's tree, never Fabric-executed)", () => {
    const store = createValidStoreDir();
    mkdirSync(join(store, ".git", "hooks"), { recursive: true });
    // A real .git/hooks/pre-commit.sample ships executable but is git's, not the
    // store's content — must NOT count as a store violation.
    const sample = join(store, ".git", "hooks", "pre-commit.sample");
    writeFileSync(sample, "#!/bin/sh\n", "utf8");
    chmodSync(sample, 0o755);
    expect(findStoreExecutableViolations(store)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "flags symlinks without following store-controlled targets",
    () => {
      const store = createValidStoreDir();
      const outside = createValidStoreDir();
      mkdirSync(join(outside, "external"), { recursive: true });
      writeFileSync(join(outside, "external", "evil.sh"), "#!/bin/sh\n", "utf8");

      symlinkSync(join(outside, "external"), join(store, "knowledge", "linked-external"), "dir");

      expect(findStoreExecutableViolations(store)).toEqual(["knowledge/linked-external"]);
    },
  );

  // W4-02→W4-06 (ISS-028): the walk is bounded so a pathologically large/deep
  // store cannot block the event loop. The bound is fail-closed — it records a
  // synthetic violation and stops, so an over-large tree is flagged (untrusted)
  // rather than partially scanned and trusted.
  it("fail-closes with a synthetic violation when the entry count exceeds the bound", () => {
    const store = createValidStoreDir();
    for (let i = 0; i < 8; i += 1) {
      writeFileSync(join(store, "knowledge", `note-${i}.md`), `# ${i}\n`, "utf8");
    }
    const result = findStoreExecutableViolations(store, { maxEntries: 3 });
    expect(result.some((v) => v.startsWith("<scan-bounded: entries"))).toBe(true);
  });

  it("fail-closes with a synthetic violation when the tree exceeds the depth bound", () => {
    const store = createValidStoreDir();
    let deep = join(store, "knowledge");
    for (let i = 0; i < 6; i += 1) {
      deep = join(deep, `lvl${i}`);
    }
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, "x.md"), "# x\n", "utf8");
    const result = findStoreExecutableViolations(store, { maxDepth: 2 });
    expect(result.some((v) => v.startsWith("<scan-bounded: depth"))).toBe(true);
  });

  it("does not flag a clean store that stays within the bounds", () => {
    const store = createValidStoreDir();
    writeFileSync(join(store, "knowledge", "a.md"), "# a\n", "utf8");
    writeFileSync(join(store, "knowledge", "b.md"), "# b\n", "utf8");
    expect(findStoreExecutableViolations(store, { maxEntries: 1000, maxDepth: 16 })).toEqual([]);
  });
});
