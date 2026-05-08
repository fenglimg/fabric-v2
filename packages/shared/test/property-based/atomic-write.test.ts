import { test, fc } from "@fast-check/vitest";
import { afterEach, describe, expect } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { atomicWriteText } from "../../src/node/atomic-write";

// ---------------------------------------------------------------------------
// Property-based invariants for atomic-write (shared.md I2, I3).
//
// I2 — write does not leave a `.tmp` file alongside the target on success.
// I3 — atomicWriteText is idempotent: same (path, content) ⇒ same final bytes.
// ---------------------------------------------------------------------------

const createdDirs: string[] = [];

afterEach(async () => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

describe("atomic-write invariants (shared.md I2, I3)", () => {
  // shared.md I3 — idempotent: same content twice ⇒ final bytes equal content.
  test.prop([fc.string({ minLength: 0, maxLength: 1024 })])(
    "atomicWriteText is idempotent: two writes with same content yield same bytes",
    async (content) => {
      const dir = await makeTempDir("aw-prop-idem-");
      const target = join(dir, "out.txt");

      await atomicWriteText(target, content);
      const first = await readFile(target, "utf8");

      await atomicWriteText(target, content);
      const second = await readFile(target, "utf8");

      expect(first).toBe(content);
      expect(second).toBe(content);
      expect(second).toBe(first);
    },
  );

  // shared.md I2 — successful writes leave no `.tmp` file behind.
  test.prop([fc.string({ minLength: 0, maxLength: 1024 })])(
    "atomicWriteText leaves no `.tmp` residue in the target directory",
    async (content) => {
      const dir = await makeTempDir("aw-prop-tmp-");
      const target = join(dir, "out.txt");

      await atomicWriteText(target, content);

      const entries = await readdir(dir);
      const stray = entries.filter((e) => e.endsWith(".tmp"));
      expect(stray).toEqual([]);
      // Sanity: target file is exactly what was written
      expect(entries).toContain("out.txt");
      expect(await readFile(target, "utf8")).toBe(content);
    },
  );

  // shared.md I3 — overwriting with a different payload yields exactly the
  // new content, with no residue from the previous content (atomic replace).
  test.prop([
    fc.string({ minLength: 0, maxLength: 512 }),
    fc.string({ minLength: 0, maxLength: 512 }),
  ])(
    "atomicWriteText fully replaces previous content; no residual `.tmp`",
    async (first, second) => {
      const dir = await makeTempDir("aw-prop-replace-");
      const target = join(dir, "out.txt");

      await atomicWriteText(target, first);
      await atomicWriteText(target, second);

      expect(await readFile(target, "utf8")).toBe(second);
      const entries = await readdir(dir);
      expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([]);
    },
  );
});
