import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deriveUid } from "../src/store/uid.js";

// W4-13 (ISS-045): the default uid stays a stable sha256(email) (S27 cross-machine
// namespacing + backward compat), but an optional salt makes it non-
// re-identifiable for the share-a-personal-store anti-pattern.

const dirs: string[] = [];
const originalCwd = process.cwd();

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "fab-uid-"));
  dirs.push(dir);
  execFileSync("git", ["init", dir], { stdio: ["ignore", "ignore", "pipe"] });
  execFileSync("git", ["-C", dir, "config", "user.email", "dev@example.com"], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(originalCwd);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("deriveUid salt (ISS-045)", () => {
  it("default (no salt) is deterministic — backward compatible", () => {
    expect(deriveUid()).toBe(deriveUid());
    expect(deriveUid()).toMatch(/^u-[0-9a-f]{12}$/);
  });

  it("a salted uid differs from the unsalted one (not a bare email hash)", () => {
    expect(deriveUid({ salt: "machine-salt-1" })).not.toBe(deriveUid());
  });

  it("is stable for the same salt + email", () => {
    expect(deriveUid({ salt: "s" })).toBe(deriveUid({ salt: "s" }));
  });

  it("different salts yield different uids for the same email", () => {
    expect(deriveUid({ salt: "s1" })).not.toBe(deriveUid({ salt: "s2" }));
  });

  it("an empty salt falls back to the unsalted derivation", () => {
    expect(deriveUid({ salt: "" })).toBe(deriveUid());
  });
});
