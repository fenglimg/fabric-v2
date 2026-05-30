import { ledgerQuerySchema } from "@fenglimg/fabric-shared";

import { readAgentsMeta } from "@fenglimg/fabric-server";
import { readLedger } from "@fenglimg/fabric-server";
import { type FabricHttpApp, sendUnknownError, sendValidationError } from "./_error.js";

export function registerLedgerApi(app: FabricHttpApp, projectRoot: string): void {
  app.get("/api/ledger", async (req, res) => {
    const validation = ledgerQuerySchema.safeParse({
      source: req.query.source,
      since: req.query.since,
    });

    if (!validation.success) {
      sendValidationError(res, "Invalid ledger query parameters", validation.error.flatten());
      return;
    }

    try {
      await readAgentsMeta(projectRoot);
      res.json(await readLedger(projectRoot, validation.data));
    } catch (error) {
      sendUnknownError(res, error);
    }
  });
}
