import { defineCommand } from "citty";

import { scopeExplain } from "../store/scope-explain.js";

// v2.1.0-rc.1 P3 (F5): `fabric scope-explain <scope>` — show the resolved
// read-set + write target for a scope in the current project.
export default defineCommand({
  meta: {
    name: "scope-explain",
    description: "Explain the resolved read-set and write target for a scope",
  },
  args: {
    scope: {
      type: "positional",
      required: true,
      description: "Scope coordinate (e.g. team, project:x, personal)",
    },
  },
  run({ args }) {
    const result = scopeExplain(process.cwd(), args.scope);
    if (result === null) {
      console.log("no global Fabric config — run `fabric install --global <url>` first");
      return;
    }
    console.log(JSON.stringify(result, null, 2));
  },
});
