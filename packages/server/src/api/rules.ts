import { readAgentsMeta } from "../meta-reader.js";
import { type FabricHttpApp, sendUnknownError } from "./_error.js";

export function registerRulesApi(app: FabricHttpApp, projectRoot: string): void {
  app.get("/api/rules", async (_req, res) => {
    try {
      res.json(await readAgentsMeta(projectRoot));
    } catch (error) {
      sendUnknownError(res, error);
    }
  });
}
