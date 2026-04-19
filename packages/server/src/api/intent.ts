import { annotateIntentRequestSchema } from "@fenglimg/fabric-shared";

import { readAgentsMeta } from "../meta-reader.js";
import { annotateIntent } from "../services/annotate-intent.js";
import { type FabricHttpApp, sendUnknownError, sendValidationError } from "./_error.js";

export function registerIntentApi(app: FabricHttpApp, projectRoot: string): void {
  app.post("/api/intent/annotate", async (req, res) => {
    const validation = annotateIntentRequestSchema.safeParse(req.body);

    if (!validation.success) {
      sendValidationError(res, "Invalid intent annotation payload", validation.error.flatten());
      return;
    }

    try {
      readAgentsMeta(projectRoot);
      const result = await annotateIntent(projectRoot, validation.data);
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      sendUnknownError(res, error);
    }
  });
}
