import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isAlive,
  readServeLockState,
  serveLockPath,
  type ServeLockState,
} from "../src/node/serve-lock";

const tempRoots: string[] = [];

function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

describe("serve-lock shared helpers", () => {
  it("serveLockPath resolves the legacy lock under .fabric", () => {
    const root = makeTempRoot("serve-lock-path-");

    expect(serveLockPath(root)).toBe(join(root, ".fabric", ".serve.lock"));
  });

  it("readServeLockState returns null for missing or malformed locks", () => {
    const root = makeTempRoot("serve-lock-read-");

    expect(readServeLockState(root)).toBeNull();

    mkdirSync(join(root, ".fabric"), { recursive: true });
    writeFileSync(serveLockPath(root), "{not-json", "utf8");

    expect(readServeLockState(root)).toBeNull();
  });

  it("readServeLockState parses a valid legacy lock", () => {
    const root = makeTempRoot("serve-lock-valid-");
    const state: ServeLockState = { pid: 123, acquiredAt: 456, host: "test-host" };
    mkdirSync(join(root, ".fabric"), { recursive: true });
    writeFileSync(serveLockPath(root), JSON.stringify(state), "utf8");

    expect(readServeLockState(root)).toEqual(state);
  });

  it("isAlive maps ESRCH to false and EPERM to true", () => {
    const kill = vi.spyOn(process, "kill");
    kill.mockImplementationOnce(() => {
      throw Object.assign(new Error("missing"), { code: "ESRCH" });
    });
    expect(isAlive(1001)).toBe(false);

    kill.mockImplementationOnce(() => {
      throw Object.assign(new Error("permission"), { code: "EPERM" });
    });
    expect(isAlive(1002)).toBe(true);
  });
});
