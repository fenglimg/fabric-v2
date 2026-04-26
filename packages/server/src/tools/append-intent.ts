import { aiLedgerEntrySchema, type AiLedgerEntry } from "@fenglimg/fabric-shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveProjectRoot } from "../meta-reader.js";
import { appendIntent } from "../services/append-intent.js";

type AppendIntentInput = {
  entry: Omit<AiLedgerEntry, "id" | "source" | "ts">;
  correlation_id?: string;
  session_id?: string;
};

const inputSchema = {
  entry: aiLedgerEntrySchema.omit({
    id: true,
    source: true,
    ts: true,
  }),
  correlation_id: z
    .string()
    .optional()
    .describe("Optional caller-provided correlation id for Event Ledger records"),
  session_id: z
    .string()
    .optional()
    .describe("Optional caller-provided session id for Event Ledger records"),
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
      description:
        "Deprecated compatibility surface. Do not call in new workflows; Fabric writes typed Event Ledger records to .fabric/events.jsonl automatically from MCP, doctor, and sync-meta activity.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: false },
    },
    async ({ entry, correlation_id, session_id }: AppendIntentInput) => {
      const projectRoot = resolveProjectRoot();
      const result = await appendIntent(projectRoot, { entry, correlation_id, session_id });

      const structuredContent: z.infer<typeof outputSchema> = {
        success: result.success,
        timestamp: result.timestamp,
        entry: { ...result.entry },
        compliance: result.compliance,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent,
      };
    },
  );
}
