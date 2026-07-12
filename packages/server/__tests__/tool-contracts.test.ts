/**
 * Golden snapshot tests for MCP tool contracts.
 *
 * These snapshots pin the exact schema shape + annotations for each LIVE tool.
 * If a snapshot fails it means a contract changed. If the change is intentional:
 *
 *   pnpm test -u
 *
 * Run that command in packages/server (or from the repo root) to accept new baselines.
 *
 * ISS-20260711-249: pin live tools only (fab_recall / fab_archive_scan / propose /
 * review / pending). Retired plan-context / knowledge-sections are asserted GONE,
 * not golden-pinned as current contracts.
 */

import { describe, expect, it } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";

import * as apiContracts from "@fenglimg/fabric-shared/schemas/api-contracts";
import {
  FabExtractKnowledgeInputSchema,
  FabExtractKnowledgeOutputSchema,
  FabPendingInputSchema,
  FabPendingOutputSchema,
  FabReviewInputSchema,
  FabReviewOutputSchema,
  archiveScanAnnotations,
  archiveScanInputSchema,
  archiveScanOutputSchema,
  fabExtractKnowledgeAnnotations,
  fabPendingAnnotations,
  fabReviewAnnotations,
  recallAnnotations,
  recallInputSchema,
  recallOutputSchema,
} from "@fenglimg/fabric-shared/schemas/api-contracts";

type ToolContract = {
  inputSchema: object;
  outputSchema: object;
  annotations: {
    readOnlyHint: boolean;
    idempotentHint: boolean;
    destructiveHint: boolean;
    openWorldHint: boolean;
    title: string;
  };
};

const contracts: Record<string, ToolContract> = {
  // Live retrieval + archive scan (ISS-20260711-249)
  "fab-recall": {
    inputSchema: zodToJsonSchema(recallInputSchema),
    outputSchema: zodToJsonSchema(recallOutputSchema),
    annotations: recallAnnotations,
  },
  "fab-archive-scan": {
    inputSchema: zodToJsonSchema(archiveScanInputSchema),
    outputSchema: zodToJsonSchema(archiveScanOutputSchema),
    annotations: archiveScanAnnotations,
  },
  "fab-extract-knowledge": {
    inputSchema: zodToJsonSchema(FabExtractKnowledgeInputSchema),
    outputSchema: zodToJsonSchema(FabExtractKnowledgeOutputSchema),
    annotations: fabExtractKnowledgeAnnotations,
  },
  "fab-review": {
    inputSchema: zodToJsonSchema(FabReviewInputSchema),
    outputSchema: zodToJsonSchema(FabReviewOutputSchema),
    annotations: fabReviewAnnotations,
  },
  "fab-pending": {
    inputSchema: zodToJsonSchema(FabPendingInputSchema),
    outputSchema: zodToJsonSchema(FabPendingOutputSchema),
    annotations: fabPendingAnnotations,
  },
};

describe("tool contracts", () => {
  for (const [toolName, contract] of Object.entries(contracts)) {
    it(`${toolName} contract matches snapshot`, () => {
      try {
        expect(contract).toMatchSnapshot();
      } catch (e) {
        console.error(
          `[contract drift] Tool contract for "${toolName}" changed. If intentional, run: pnpm test -u`,
        );
        throw e;
      }
    });
  }

  // rc.23 TASK-002 F4: getKnowledge* / fab_get_rules surface removed.
  it("does not export removed getKnowledge* schemas (rc.23 F4)", () => {
    const exports = apiContracts as Record<string, unknown>;
    expect(exports.getKnowledgeInputSchema).toBeUndefined();
    expect(exports.getKnowledgeOutputSchema).toBeUndefined();
    expect(exports.getKnowledgeAnnotations).toBeUndefined();
  });

  // ISS-20260711-249: retired two-step tools must not be treated as live goldens.
  // Schemas may still exist for historic ledger/compat, but the contract suite
  // must not pin them as current MCP surface.
  it("does not pin retired plan-context / knowledge-sections as live tools", () => {
    expect(Object.keys(contracts)).not.toContain("plan-context");
    expect(Object.keys(contracts)).not.toContain("knowledge-sections");
    expect(Object.keys(contracts).sort()).toEqual([
      "fab-archive-scan",
      "fab-extract-knowledge",
      "fab-pending",
      "fab-recall",
      "fab-review",
    ]);
  });
});
