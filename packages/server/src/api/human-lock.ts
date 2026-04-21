import { humanLockApproveRequestSchema, humanLockFileParamsSchema } from "@fenglimg/fabric-shared";

import { readAgentsMeta } from "../meta-reader.js";
import { approveHumanLock } from "../services/approve-human-lock.js";
import { readHumanLock, readHumanLockEntry } from "../services/read-human-lock.js";
import { type FabricHttpApp, sendError, sendUnknownError, sendValidationError } from "./_error.js";

export function registerHumanLockApi(app: FabricHttpApp, projectRoot: string): void {
  app.get("/api/human-lock", async (_req, res) => {
    try {
      await readAgentsMeta(projectRoot);
      res.json(await readHumanLock(projectRoot));
    } catch (error) {
      sendUnknownError(res, error);
    }
  });

  app.get(/^\/api\/human-lock\/(.+)$/, async (req, res) => {
    const rawFile = typeof req.params[0] === "string" ? decodeURIComponent(req.params[0]) : "";
    const validation = humanLockFileParamsSchema.safeParse({
      file: rawFile,
    });

    if (!validation.success) {
      sendValidationError(res, "Invalid human-lock file path", validation.error.flatten());
      return;
    }

    try {
      await readAgentsMeta(projectRoot);
      const entry = await readHumanLockEntry(projectRoot, validation.data.file);

      if (entry === null) {
        sendError(
          res,
          404,
          "HUMAN_LOCK_ENTRY_NOT_FOUND",
          `Cannot find human lock entry: ${validation.data.file}`,
        );
        return;
      }

      res.json(entry);
    } catch (error) {
      sendUnknownError(res, error);
    }
  });

  app.post("/api/human-lock/approve", async (req, res) => {
    const validation = humanLockApproveRequestSchema.safeParse(req.body);

    if (!validation.success) {
      sendValidationError(res, "Invalid human-lock approval payload", validation.error.flatten());
      return;
    }

    try {
      await readAgentsMeta(projectRoot);
      res.json(await approveHumanLock(projectRoot, validation.data));
    } catch (error) {
      sendUnknownError(res, error);
    }
  });
}
