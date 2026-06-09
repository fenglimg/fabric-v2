import { describe, expect, it } from "vitest";

import { archiveScanAnnotations } from "../../src/schemas/api-contracts.js";
import {
  MCP_STORE_AWARE_CONTRACTS,
  MCP_STORE_AWARE_TOOLS,
  storeAwareEntrySchema,
  writtenToStoreSchema,
} from "../../src/schemas/mcp-store-contracts.js";

// v2.1.0-rc.1 P2 — 6-tool store-aware schema contract test (done_when:
// "6 工具 schema 带 provenance/store-qualified"). Asserts all six tools are
// covered and that the provenance / written_to_store shapes validate.

const TEAM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("P2 — 6 MCP tools carry a store edge", () => {
  it("covers exactly the six locked tools, each with a store-aware contract", () => {
    expect(MCP_STORE_AWARE_TOOLS).toHaveLength(6);
    for (const tool of MCP_STORE_AWARE_TOOLS) {
      const contract = MCP_STORE_AWARE_CONTRACTS[tool];
      expect(contract.tool).toBe(tool);
      // fab_archive_scan is read-only ledger scan; every other tool either
      // surfaces provenance entries or echoes a written store (fab_review does both).
      if (tool !== "fab_archive_scan") {
        expect(contract.surfacesEntries || contract.echoesWrittenStore).toBe(true);
      }
    }
  });

  it("READ tools surface a store-qualified provenance entry", () => {
    const readTools = MCP_STORE_AWARE_TOOLS.filter(
      (t) => MCP_STORE_AWARE_CONTRACTS[t].surfacesEntries,
    );
    expect(readTools).toContain("fab_recall");
    expect(readTools).toContain("fab_get_knowledge_sections");

    expect(() =>
      storeAwareEntrySchema.parse({
        stable_id: "KT-DEC-0001",
        global_ref: `${TEAM}:KT-DEC-0001`,
        provenance: {
          store_uuid: TEAM,
          alias: "team",
          local_id: "KT-DEC-0001",
          global_ref: `${TEAM}:KT-DEC-0001`,
        },
      }),
    ).not.toThrow();
  });

  it("WRITE tools echo written_to_store", () => {
    const writeTools = MCP_STORE_AWARE_TOOLS.filter(
      (t) => MCP_STORE_AWARE_CONTRACTS[t].echoesWrittenStore,
    );
    expect(writeTools).not.toContain("fab_archive_scan");
    expect(writeTools).toContain("fab_extract_knowledge");

    expect(() => writtenToStoreSchema.parse({ store_uuid: TEAM, alias: "team" })).not.toThrow();
    // bare/invalid store uuid rejected
    expect(() => writtenToStoreSchema.parse({ store_uuid: "team", alias: "team" })).toThrow();
  });

  it("keeps fab_archive_scan aligned with its read-only MCP annotation", () => {
    expect(archiveScanAnnotations.readOnlyHint).toBe(true);
    expect(MCP_STORE_AWARE_CONTRACTS.fab_archive_scan.echoesWrittenStore).toBe(false);
  });
});
