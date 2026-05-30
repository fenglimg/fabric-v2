import { getKnowledge } from "@fenglimg/fabric-server";
import { type FabricHttpApp, sendUnknownError, sendValidationError } from "./_error.js";

export function registerKnowledgeContextApi(app: FabricHttpApp, projectRoot: string): void {
  app.get("/api/rules/context", async (req, res) => {
    const path = typeof req.query.path === "string" ? req.query.path.trim() : "";

    if (path.length === 0) {
      sendValidationError(res, "Missing required query parameter: path", {
        fieldErrors: {
          path: ["Expected a non-empty path query parameter."],
        },
      });
      return;
    }

    try {
      const result = await getKnowledge(projectRoot, { path });
      res.json(result.rules);
    } catch (error) {
      sendUnknownError(res, error);
    }
  });
}
