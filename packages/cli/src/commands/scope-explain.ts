import { defineCommand } from "citty";

import { FabricError } from "@fenglimg/fabric-shared/errors";

import { getProjectTranslator } from "../i18n.js";
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
    const projectRoot = process.cwd();
    let result;
    try {
      result = scopeExplain(projectRoot, args.scope);
    } catch (error) {
      // F21: a malformed scope coordinate fails loudly + actionably instead of
      // silently resolving to a fallback target.
      if (error instanceof FabricError) {
        console.error(`${error.message}\n→ ${error.actionHint}`);
        process.exitCode = 1;
        return;
      }
      throw error;
    }
    if (result === null) {
      console.log(getProjectTranslator(projectRoot)("cli.cmd.no-global-config"));
      return;
    }
    console.log(JSON.stringify(result, null, 2));
  },
});
