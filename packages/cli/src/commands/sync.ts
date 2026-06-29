import { defineCommand } from "citty";

import { getProjectTranslator, t } from "../i18n.js";
import { paint } from "../colors.js";
import { runAbortSync, runContinueSync, runStartSync, type RunSyncResult } from "../sync/run-sync.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — `fabric sync [--continue|--abort]` (S9/S17/S37).
//
// Presentation-only shell over run-sync (which holds the testable I/O
// orchestration). `--continue`/`--abort` resume a paused (conflicted) session.
// ---------------------------------------------------------------------------

function report(result: RunSyncResult, projectRoot: string): void {
  const t = getProjectTranslator(projectRoot);
  for (const store of result.session.stores) {
    console.log(`${store.alias}\t${store.state}`);
  }
  if (result.deferred.length > 0) {
    console.log(t("cli.sync.deferred", { count: String(result.deferred.length) }));
  }
  if (!result.settled) {
    console.log(t("cli.sync.paused"));
  }
}

export const syncCommand = defineCommand({
  meta: { name: "sync", description: t("cli.sync.description") },
  args: {
    continue: { type: "boolean", description: "Resume after resolving a rebase conflict" },
    abort: { type: "boolean", description: "Abort the conflicted store's rebase" },
  },
  run({ args }) {
    const projectRoot = process.cwd();
    if (args.continue === true && args.abort === true) {
      console.error(paint.error("fabric sync: --continue and --abort cannot be used together"));
      process.exitCode = 1;
      return;
    }

    const options = { projectRoot, now: new Date().toISOString() };
    if (args.continue === true) {
      report(runContinueSync(options), projectRoot);
      return;
    }
    if (args.abort === true) {
      report(runAbortSync(options), projectRoot);
      return;
    }
    report(runStartSync(options), projectRoot);
  },
});

export default syncCommand;
