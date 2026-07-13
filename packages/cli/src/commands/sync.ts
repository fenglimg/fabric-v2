import { defineCommand } from "citty";

import { getProjectTranslator, t } from "../i18n.js";
import { paint } from "../colors.js";
import { grid, groupDot, headerRule } from "../tui/structure.js";
import type { SyncStoreState } from "../sync/state-machine.js";
import { runAbortSync, runContinueSync, runStartSync, type RunSyncResult } from "../sync/run-sync.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — `fabric sync [--continue|--abort]` (S9/S17/S37).
//
// Presentation-only shell over run-sync (which holds the testable I/O
// orchestration). `--continue`/`--abort` resume a paused (conflicted) session.
// ---------------------------------------------------------------------------

// flat-design (spec §0.4): the per-store status glyph carries the COLOUR (state
// semantics live here), so the leading `●` stays a neutral structural dot.
// ✓ synced (green) / ✗ conflict (red, actionable) / ○ offline·aborted (amber soft
// terminal) / · pending (muted). NO_COLOR degrades each to its bare glyph.
function syncGlyph(state: SyncStoreState): string {
  switch (state) {
    case "synced":
      return paint.success("✓");
    case "conflict":
      return paint.error("✗");
    case "offline":
    case "aborted":
      return paint.warn("○");
    case "pending":
    default:
      return paint.muted("·");
  }
}

// State order for the aggregate count cells (only non-zero states are shown so
// the summary never becomes a wall of `0`s).
const SYNC_STATE_ORDER: SyncStoreState[] = ["synced", "offline", "conflict", "aborted", "pending"];

type SyncTranslator = ReturnType<typeof getProjectTranslator>;

// flat-design (spec §0.4): a command-level B-横线 title over `● <alias>  <glyph>
// <state>` rows, then an aggregate summary (count grid + the single actionable
// notice). The summary AGGREGATES, it never re-lists each store (KT-GLD-0008);
// offline / aborted are terminal states, not "incomplete". Pure string builder
// (no side effects) so the NO_COLOR degradation can be pinned in a test.
export function buildSyncReport(result: RunSyncResult, t: SyncTranslator): string {
  const stores = result.session.stores;
  const lines: string[] = ["", headerRule(t("cli.sync.title"))];

  if (stores.length === 0) {
    lines.push(`  ${paint.muted(t("cli.sync.none"))}`);
    return lines.join("\n");
  }

  const rows = stores.map((store) => [
    groupDot(store.alias),
    `${syncGlyph(store.state)} ${paint.muted(t(`cli.sync.state.${store.state}`))}`,
  ]);
  lines.push(
    grid(rows, { gap: 3 })
      .split("\n")
      .map((line) => `  ${line}`.replace(/[ \t]+$/, ""))
      .join("\n"),
  );

  // Aggregate summary — count grid + one actionable notice (paused > deferred >
  // all-synced). Counts come straight off the per-store states above.
  const counts = new Map<SyncStoreState, number>();
  for (const store of stores) {
    counts.set(store.state, (counts.get(store.state) ?? 0) + 1);
  }
  const cells = SYNC_STATE_ORDER.filter((s) => (counts.get(s) ?? 0) > 0).map(
    (s) => `${syncGlyph(s)} ${counts.get(s)} ${t(`cli.sync.state.${s}`)}`,
  );

  lines.push("", headerRule(t("cli.sync.summary.title")), `  ${grid([cells], { gap: 4 })}`);

  const notice = !result.settled
    ? t("cli.sync.paused")
    : result.deferred.length > 0
      ? t("cli.sync.deferred", { count: String(result.deferred.length) })
      : (counts.get("synced") ?? 0) === stores.length
        ? t("cli.sync.all-synced")
        : null;
  if (notice !== null) {
    lines.push(`  ${paint.muted(notice)}`);
  }
  return lines.join("\n");
}

function report(result: RunSyncResult, projectRoot: string): void {
  console.log(buildSyncReport(result, getProjectTranslator(projectRoot)));
}

export const syncCommand = defineCommand({
  meta: { name: "sync", description: t("cli.sync.description") },
  args: {
    continue: { type: "boolean", description: t("cli.sync.args.continue.description") },
    abort: { type: "boolean", description: t("cli.sync.args.abort.description") },
    json: {
      type: "boolean",
      description: "Emit machine-readable JSON result (ISS-20260713-010)",
    },
  },
  run({ args }) {
    const projectRoot = process.cwd();
    if (args.continue === true && args.abort === true) {
      console.error(paint.error("fabric sync: --continue and --abort cannot be used together"));
      process.exitCode = 1;
      return;
    }

    const options = { projectRoot, now: new Date().toISOString() };
    let result;
    if (args.continue === true) {
      result = runContinueSync(options);
    } else if (args.abort === true) {
      result = runAbortSync(options);
    } else {
      result = runStartSync(options);
    }

    // ISS-20260713-010: non-zero exit when not settled (conflict/offline/paused).
    if (!result.settled) {
      process.exitCode = 2;
    }
    if (args.json === true) {
      console.log(
        JSON.stringify(
          {
            settled: result.settled,
            deferred: result.deferred,
            snapshot_written: result.snapshotWritten,
            session: result.session,
            exit_code: result.settled ? 0 : 2,
          },
          null,
          2,
        ),
      );
      return;
    }
    report(result, projectRoot);
  },
});

export default syncCommand;
