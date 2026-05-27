import { historyStateQuerySchema } from "@fenglimg/fabric-shared";

import { rehydrateAgentsMetaAt } from "../services/rehydrate-state.js";
import { type FabricHttpApp, sendUnknownError, sendValidationError } from "./_error.js";

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

      res.json(result);
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

      res.json(result);
    } catch (error) {
      sendUnknownError(res, error);
    }
  });
}
