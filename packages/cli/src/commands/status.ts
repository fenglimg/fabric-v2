import { defineCommand } from "citty";

import { projectStatus } from "../store/info-ops.js";

// v2.1.0-rc.1 P3 (S30/F5): `fabric status` — project's resolved store picture.
export default defineCommand({
  meta: { name: "status", description: "Show this project's Fabric store status" },
  run() {
    const status = projectStatus(process.cwd());
    console.log(`uid:            ${status.uid ?? "(no global config)"}`);
    // F9: only call it "not a Fabric project" when there is genuinely no
    // project config. When the project IS initialized but project_id is unset
    // (deferred global-refactor), say "(unset)" instead of lying.
    const projectIdLabel = status.project_id ?? (status.is_fabric_project ? "(unset)" : "(not a Fabric project)");
    console.log(`project_id:     ${projectIdLabel}`);
    console.log(`mounted stores: ${status.mounted.length > 0 ? status.mounted.join(", ") : "(none)"}`);
    console.log(`required:       ${status.required.length > 0 ? status.required.join(", ") : "(none)"}`);
    console.log(`active write:   ${status.active_write_store ?? "(none — personal scope only)"}`);
  },
});
