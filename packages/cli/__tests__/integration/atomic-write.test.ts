/**
 * Integration tests: atomic write primitives
 * Covers: I5 (no .tmp residue on rename failure)
 */

import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { atomicWriteText, atomicWriteJson } from "@fenglimg/fabric-shared/node/atomic-write";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "itg-atomic-"));
  tempDirs.push(dir);
  return dir;
}

// I5 — no .tmp leftover when rename fails (parent missing → write cannot succeed)
describe("I5: atomic-write — no .tmp residue on failure", () => {
  it("atomicWriteText cleans up .tmp when parent directory is missing", async () => {
    const dir = makeTempDir();
    const missingParent = join(dir, "nonexistent-dir", "file.txt");

    await expect(atomicWriteText(missingParent, "hello")).rejects.toThrow();

    // No files at all should remain in dir
    const entries = readdirSync(dir);
    expect(entries).toHaveLength(0);
  });

  it("atomicWriteJson cleans up .tmp when parent directory is missing", async () => {
    const dir = makeTempDir();
    const missingParent = join(dir, "nonexistent-dir", "data.json");

    await expect(atomicWriteJson(missingParent, { key: "value" })).rejects.toThrow();

    const entries = readdirSync(dir);
    expect(entries).toHaveLength(0);
  });

  it("atomicWriteText succeeds and leaves no .tmp on valid path", async () => {
    const dir = makeTempDir();
    const targetPath = join(dir, "output.txt");

    await atomicWriteText(targetPath, "content\n");

    const files = readdirSync(dir);
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
    expect(files).toContain("output.txt");
  });

  it("atomicWriteJson succeeds and leaves no .tmp on valid path", async () => {
    const dir = makeTempDir();
    const targetPath = join(dir, "data.json");

    await atomicWriteJson(targetPath, { a: 1, b: "two" });

    const files = readdirSync(dir);
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
    expect(files).toContain("data.json");
  });
});
