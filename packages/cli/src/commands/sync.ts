import { defineCommand } from "citty";

import { runAbortSync, runContinueSync, runStartSync, type RunSyncResult } from "../sync/run-sync.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — `fabric sync [--continue|--abort]` (S9/S17/S37).
//
// Presentation-only shell over run-sync (which holds the testable I/O
// orchestration). `--continue`/`--abort` resume a paused (conflicted) session.
// ---------------------------------------------------------------------------

function report(result: RunSyncResult): void {
  for (const store of result.session.stores) {
    console.log(`${store.alias}\t${store.state}`);
  }
  if (result.deferred.length > 0) {
    console.log(
      `${result.deferred.length} store(s) offline — push deferred; re-run \`fabric sync\` when online`,
    );
  }
  if (!result.settled) {
    console.log(
      "sync paused on a conflict — resolve it, then run `fabric sync --continue` (or `--abort`)",
    );
  }
}

export default defineCommand({
  meta: { name: "sync", description: "Pull --rebase + push every mounted store; resume conflicts" },
  args: {
    continue: { type: "boolean", description: "Resume after resolving a rebase conflict" },
    abort: { type: "boolean", description: "Abort the conflicted store's rebase" },
  },
  run({ args }) {
    const options = { projectRoot: process.cwd(), now: new Date().toISOString() };
    if (args.continue === true) {
      report(runContinueSync(options));
      return;
    }
    if (args.abort === true) {
      report(runAbortSync(options));
      return;
    }
    report(runStartSync(options));
  },
});
