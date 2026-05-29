import { defineCommand } from "citty";

import { projectStatus } from "../store/info-ops.js";

// v2.1.0-rc.1 P3 (S30/F5): `fabric status` — project's resolved store picture.
export default defineCommand({
  meta: { name: "status", description: "Show this project's Fabric store status" },
  run() {
    const status = projectStatus(process.cwd());
    console.log(`uid:            ${status.uid ?? "(no global config)"}`);
    console.log(`project_id:     ${status.project_id ?? "(not a Fabric project)"}`);
    console.log(`mounted stores: ${status.mounted.length > 0 ? status.mounted.join(", ") : "(none)"}`);
    console.log(`required:       ${status.required.length > 0 ? status.required.join(", ") : "(none)"}`);
    console.log(`active write:   ${status.active_write_store ?? "(none — personal scope only)"}`);
  },
});
