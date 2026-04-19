import { appendFile } from "node:fs/promises";

import { aiLedgerEntrySchema, type AiLedgerEntry } from "@fabric/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

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

function createTextResponse(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload),
      },
    ],
  };
}

export function registerAppendIntent(server: McpServer): void {
  server.tool(
    "fab_append_intent",
    "MANDATORY: Call after a completed task to append an intent ledger entry for Fabric.",
    inputSchema,
    async ({ entry }: AppendIntentInput) => {
      const projectRoot = resolveProjectRoot();
      const result = await appendIntent(projectRoot, { entry });

      return createTextResponse(result);
    },
  );
}
