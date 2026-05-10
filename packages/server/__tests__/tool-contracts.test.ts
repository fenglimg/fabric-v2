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

import {
  FabExtractKnowledgeInputSchema,
  FabExtractKnowledgeOutputSchema,
  FabReviewInputSchema,
  FabReviewOutputSchema,
  fabExtractKnowledgeAnnotations,
  fabReviewAnnotations,
  getRulesAnnotations,
  getRulesInputSchema,
  getRulesOutputSchema,
  planContextAnnotations,
  planContextInputSchema,
  planContextOutputSchema,
  ruleSectionsAnnotations,
  ruleSectionsInputSchema,
  ruleSectionsOutputSchema,
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
  "get-rules": {
    inputSchema: zodToJsonSchema(getRulesInputSchema),
    outputSchema: zodToJsonSchema(getRulesOutputSchema),
    annotations: getRulesAnnotations,
  },
  "rule-sections": {
    inputSchema: zodToJsonSchema(ruleSectionsInputSchema),
    outputSchema: zodToJsonSchema(ruleSectionsOutputSchema),
    annotations: ruleSectionsAnnotations,
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
});
