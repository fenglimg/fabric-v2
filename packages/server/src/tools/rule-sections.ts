import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  ruleSectionsAnnotations,
  ruleSectionsInputSchema,
  ruleSectionsOutputSchema,
} from "@fenglimg/fabric-shared/schemas/api-contracts";
import { resolveProjectRoot } from "../meta-reader.js";
import { type InFlightTracker } from "../services/in-flight-tracker.js";
import {
  getRuleSections,
  type GetRuleSectionsInput,
} from "../services/rule-sections.js";
import { ensureRulesFresh } from "../services/rule-sync.js";

export function registerRuleSections(server: McpServer, tracker?: InFlightTracker): void {
  server.registerTool(
    "fab_get_rule_sections",
    {
      description:
        "Fetch structured Fabric rule sections after fab_plan_context. Required L0/L2 rules are merged with AI-selected L1 rules server-side.",
      inputSchema: ruleSectionsInputSchema,
      outputSchema: ruleSectionsOutputSchema,
      annotations: ruleSectionsAnnotations,
    },
    async (input: GetRuleSectionsInput) => {
      const requestId = randomUUID();
      tracker?.enter(requestId);
      try {
        const projectRoot = resolveProjectRoot();
        const syncReport = await ensureRulesFresh(projectRoot);
        const result = await getRuleSections(projectRoot, input);

        const response = {
          ...result,
          warnings: [...(result.warnings ?? []), ...syncReport.warnings],
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(response) }],
          structuredContent: response,
        };
      } finally {
        tracker?.exit(requestId);
      }
    },
  );
}
