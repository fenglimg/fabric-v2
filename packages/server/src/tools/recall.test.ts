import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("registerRecall ProjectContext contract", () => {
  it("captures one snapshot and reuses its workspaceRoot for recall and ledger", () => {
    const source = readFileSync(fileURLToPath(new URL("./recall.ts", import.meta.url)), "utf8");
    expect(source.match(/snapshotForCall\(/gu)).toHaveLength(1);
    expect(source).toContain("const projectRoot = context.workspaceRoot");
    expect(source).toContain("appendEventLedgerEvent(context.workspaceRoot");
    expect(source).not.toContain("resolveProjectRoot");
  });
});
