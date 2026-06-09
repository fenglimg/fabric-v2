import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testsRoot = fileURLToPath(new URL(".", import.meta.url));

function findSnapshotFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return findSnapshotFiles(path);
    }
    return entry.isFile() && entry.name.endsWith(".snap") ? [path] : [];
  });
}

function ownerForSnapshot(snapshotPath: string): string {
  const snapshotsDir = dirname(snapshotPath);
  const ownerDir = dirname(snapshotsDir);
  return join(ownerDir, snapshotPath.slice(snapshotsDir.length + 1, -".snap".length));
}

describe("snapshot hygiene", () => {
  it("keeps snapshot files paired with their owning test file", () => {
    const orphanSnapshots = findSnapshotFiles(testsRoot).filter(
      (snapshotPath) => !existsSync(ownerForSnapshot(snapshotPath)),
    );

    expect(orphanSnapshots).toEqual([]);
  });
});
