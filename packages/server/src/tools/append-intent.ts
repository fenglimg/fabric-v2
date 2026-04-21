import { aiLedgerEntrySchema, type AiLedgerEntry } from "@fenglimg/fabric-shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveProjectRoot } from "../meta-reader.js";
import { appendIntent } from "../services/append-intent.js";

type AppendIntentInput = {
  entry: Omit<AiLedgerEntry, "id" | "source" | "ts">;
};

const inputSchema = {
  entry: aiLedgerEntrySchema.omit({
    id: true,
    source: true,
    ts: true,
  }),
};

const outputSchema = z.object({
  success: z.boolean(),
  timestamp: z.number(),
  entry: z.record(z.unknown()),
  compliance: z
    .object({
      compliant: z.boolean(),
      matched_get_rules_ts: z.string().nullable(),
      window_ms: z.number(),
    })
    .optional(),
});

export function registerAppendIntent(server: McpServer): void {
  server.registerTool(
    "fab_append_intent",
    {
      description: "Call after a completed task to append an intent ledger entry for Fabric.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: false },
    },
    async ({ entry }: AppendIntentInput) => {
      const projectRoot = resolveProjectRoot();
      const result = await appendIntent(projectRoot, { entry });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result as z.infer<typeof outputSchema>,
      };
    },
  );
}
