import { historyStateQuerySchema } from "@fenglimg/fabric-shared";

import { rehydrateAgentsMetaAt } from "@fenglimg/fabric-server";
import { type FabricHttpApp, sendUnknownError, sendValidationError } from "./_error.js";
import { sanitizeHttpKnowledgePayload } from "./response-sanitizer.js";

export function registerHistoryApi(app: FabricHttpApp, projectRoot: string): void {
  app.get("/api/history/state", async (req, res) => {
    const validation = historyStateQuerySchema.safeParse({
      ledger_id: req.query.ledger_id,
      ts: req.query.at ?? req.query.ts,
    });

    if (!validation.success) {
      sendValidationError(res, "Invalid history replay query parameters", validation.error.flatten());
      return;
    }

    try {
      const result = "ledger_id" in validation.data && validation.data.ledger_id !== undefined
        ? await rehydrateAgentsMetaAt(projectRoot, { ledgerEntryId: validation.data.ledger_id })
        : await rehydrateAgentsMetaAt(projectRoot, { timestamp: validation.data.ts as number });

      res.json(sanitizeHttpKnowledgePayload(result));
    } catch (error) {
      sendUnknownError(res, error);
    }
  });

  app.get("/api/replay", async (req, res) => {
    const validation = historyStateQuerySchema.safeParse({
      ledger_id: req.query.ledger_id,
      ts: req.query.at ?? req.query.ts,
    });

    if (!validation.success) {
      sendValidationError(res, "Invalid history replay query parameters", validation.error.flatten());
      return;
    }

    try {
      const result = "ledger_id" in validation.data && validation.data.ledger_id !== undefined
        ? await rehydrateAgentsMetaAt(projectRoot, { ledgerEntryId: validation.data.ledger_id })
        : await rehydrateAgentsMetaAt(projectRoot, { timestamp: validation.data.ts as number });

      res.json(sanitizeHttpKnowledgePayload(result));
    } catch (error) {
      sendUnknownError(res, error);
    }
  });
}
