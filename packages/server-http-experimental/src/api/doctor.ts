import { runDoctorReport } from "@fenglimg/fabric-server";
import { type FabricHttpApp, sendUnknownError } from "./_error.js";

export function registerDoctorApi(app: FabricHttpApp, projectRoot: string): void {
  app.get("/api/doctor", async (_req, res) => {
    try {
      res.json(await runDoctorReport(projectRoot));
    } catch (error) {
      sendUnknownError(res, error);
    }
  });
}
