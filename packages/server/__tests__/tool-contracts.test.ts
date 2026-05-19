/**
 * Golden snapshot tests for MCP tool contracts.
 *
 * These snapshots pin the exact schema shape + annotations for each tool.
 * If a snapshot fails it means a contract changed. If the change is intentional:
 *
 *   pnpm test -u
 *
 * Run that command in packages/server (or from the repo root) to accept new baselines.
 */

import { describe, expect, it } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";

import * as apiContracts from "@fenglimg/fabric-shared/schemas/api-contracts";
import {
  FabExtractKnowledgeInputSchema,
  FabExtractKnowledgeOutputSchema,
  FabReviewInputSchema,
  FabReviewOutputSchema,
  fabExtractKnowledgeAnnotations,
  fabReviewAnnotations,
  planContextAnnotations,
  planContextInputSchema,
  planContextOutputSchema,
  knowledgeSectionsAnnotations,
  knowledgeSectionsInputSchema,
  knowledgeSectionsOutputSchema,
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
  "plan-context": {
    inputSchema: zodToJsonSchema(planContextInputSchema),
    outputSchema: zodToJsonSchema(planContextOutputSchema),
    annotations: planContextAnnotations,
  },
  "knowledge-sections": {
    inputSchema: zodToJsonSchema(knowledgeSectionsInputSchema),
    outputSchema: zodToJsonSchema(knowledgeSectionsOutputSchema),
    annotations: knowledgeSectionsAnnotations,
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
  // These exports were orphaned after the two-step plan_context →
  // get_knowledge_sections API rewrite. Assert they are gone so a future
  // regression cannot silently re-introduce a dead tool surface.
  it("does not export removed getKnowledge* schemas (rc.23 F4)", () => {
    const exports = apiContracts as Record<string, unknown>;
    expect(exports.getKnowledgeInputSchema).toBeUndefined();
    expect(exports.getKnowledgeOutputSchema).toBeUndefined();
    expect(exports.getKnowledgeAnnotations).toBeUndefined();
  });
});
