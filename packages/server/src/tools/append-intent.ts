import { appendFile } from "node:fs/promises";
import { join } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveProjectRoot } from "../meta-reader.js";

type AppendIntentInput = {
  entry: {
    commit_sha?: string;
    intent: string;
    affected_paths: string[];
  };
};

const inputSchema = {
  entry: z.object({
    commit_sha: z.string().optional(),
    intent: z.string(),
    affected_paths: z.array(z.string()),
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
      const ledgerPath = join(projectRoot, ".intent-ledger.jsonl");
      const ts = Date.now();

      await appendFile(ledgerPath, `${JSON.stringify({ ts, ...entry })}\n`, "utf8");

      return createTextResponse({
        success: true,
        timestamp: ts,
      });
    },
  );
}
