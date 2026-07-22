import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("registerArchiveScan ProjectContext contract", () => {
  it("captures one immutable operation context for the complete scan", () => {
    const source = readFileSync(fileURLToPath(new URL("./archive-scan.ts", import.meta.url)), "utf8");
    expect(source.match(/snapshotForCall\(/gu)).toHaveLength(1);
    expect(source).toContain("const projectRoot = context.workspaceRoot");
    expect(source).not.toContain("resolveProjectRoot");
  });
});
