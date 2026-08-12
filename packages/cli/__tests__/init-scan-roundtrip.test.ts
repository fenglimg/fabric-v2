/**
 * Producer↔consumer round-trip for `init_scan_completed`.
 *
 * This event shipped with only its consumer. `signal-decide.cjs` gates the
 * underseed ("import") nudge on an `init_scan_completed` at least 24h old, but
 * nothing in the codebase ever emitted one — so that condition was permanently
 * false and the nudge could not fire in production, for anyone, ever.
 *
 * Every existing test on both sides passed the whole time. The consumer tests
 * (`fabric-hint.test.ts` — "decide (import signal)") hand-build the event with
 * `makeEvent("init_scan_completed", ...)`, which proves the gate reads a
 * well-formed event correctly and says nothing about whether one is ever
 * produced. The producer had no test because there was no producer. A gap in
 * the WIRING between two halves is invisible from either half alone; only a
 * test that runs the real emitter and feeds its output to the real consumer
 * can see it.
 *
 * So this file deliberately never constructs an event literal. It calls the
 * shipped emitter, reads the ledger back off disk with the shipped reader, and
 * hands those rows to the shipped hook. Any future change that breaks the chain
 * — emitter deleted, field renamed, schema variant dropped, gate rewritten —
 * fails here even though the per-half tests stay green.
 */

import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { emitInitScanCompletedOnce } from "@fenglimg/fabric-server";
import { globalConfigSchema } from "@fenglimg/fabric-shared";

import { saveGlobalConfig } from "../src/store/global-config-io.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const hook = require(
  fileURLToPath(new URL("../templates/hooks/fabric-hint.cjs", import.meta.url)),
) as {
  decide: (
    events: unknown[],
    now: Date,
    pending: unknown,
    underseed: { nodeCount: number; threshold: number },
  ) => { signal?: string } | null;
  readLedger: (cwd: string) => unknown[];
};

const HOUR_MS = 3_600_000;

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "fabric-init-scan-rt-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

/** Read the ledger through the HOOK's own reader — the real consumer path. */
function ledgerAsHookSeesIt(): unknown[] {
  return hook.readLedger(projectRoot);
}

describe("init_scan_completed — producer↔consumer round-trip", () => {
  it("the emitter writes a row the hook's own reader can parse", async () => {
    const wrote = await emitInitScanCompletedOnce(projectRoot, {
      durationMs: 1234,
      source: "init",
      writtenStableIds: [],
    });

    expect(wrote).toBe(true);
    const events = ledgerAsHookSeesIt() as Array<{ event_type?: string; ts?: number }>;
    const initEvents = events.filter((e) => e.event_type === "init_scan_completed");
    expect(initEvents).toHaveLength(1);
    // The gate reads `ts` to compute the post-init quiet window. A row the
    // reader accepts but with no usable timestamp would still leave the nudge
    // dead, so assert the field the CONSUMER needs, not just the row's presence.
    expect(typeof initEvents[0]?.ts).toBe("number");
  });

  it("the underseed nudge fires on the emitted event once the quiet window passes", async () => {
    await emitInitScanCompletedOnce(projectRoot, { durationMs: 5, source: "init" });

    // 48h after the emit — past the 24h post-init quiet window.
    const later = new Date(Date.now() + 48 * HOUR_MS);
    const decision = hook.decide(ledgerAsHookSeesIt(), later, undefined, {
      nodeCount: 2,
      threshold: 10,
    });

    // This is the assertion the original bug would have failed: before an
    // emitter existed, the ledger held no init_scan_completed and `decide`
    // returned null here no matter how sparse the corpus was.
    expect(decision?.signal).toBe("import");
  });

  it("stays quiet inside the post-init window, proving the gate reads the emitted ts", async () => {
    await emitInitScanCompletedOnce(projectRoot, { durationMs: 5, source: "init" });

    const soon = new Date(Date.now() + 1 * HOUR_MS);
    const decision = hook.decide(ledgerAsHookSeesIt(), soon, undefined, {
      nodeCount: 2,
      threshold: 10,
    });

    // Without this, a gate that ignored the timestamp entirely (or read a
    // constant) would pass the test above and look wired.
    expect(decision).toBeNull();
  });

  it("is once-ever: a second emit does not restart the quiet clock", async () => {
    const first = await emitInitScanCompletedOnce(projectRoot, { durationMs: 5, source: "init" });
    const second = await emitInitScanCompletedOnce(projectRoot, { durationMs: 5, source: "init" });

    expect([first, second]).toEqual([true, false]);
    const initEvents = (ledgerAsHookSeesIt() as Array<{ event_type?: string }>).filter(
      (e) => e.event_type === "init_scan_completed",
    );
    expect(initEvents).toHaveLength(1);

    // The consumer takes the LATEST match, so a per-install emit would push the
    // quiet window forward on every re-install — and `fabric install` is
    // idempotent, so people re-run it. That would reproduce the original bug
    // (nudge never fires) with a different cause, which is exactly the failure
    // this assertion exists to prevent.
    const later = new Date(Date.now() + 48 * HOUR_MS);
    const decision = hook.decide(ledgerAsHookSeesIt(), later, undefined, {
      nodeCount: 2,
      threshold: 10,
    });
    expect(decision?.signal).toBe("import");
  });
});

/**
 * The tests above prove the emitter works and the hook consumes what it writes.
 * They say nothing about whether anything CALLS the emitter — delete the call
 * from `runInitCommand` and every one of them still passes. That is the same
 * shape of gap as the original bug, one level up, so it needs its own check:
 * drive the real install command and assert the row appears.
 */
// The MCP stage shells out through `import.meta.resolve`, which Vitest's SSR
// transform does not provide — a real install fails at that stage in-process
// regardless of the code under test. Stub that ONE stage to a no-op so the
// pipeline can reach its success path. Everything this test asserts happens
// after the pipeline returns, so nothing about the emit is being mocked away.
vi.mock("../src/install/pipeline/mcp.stage.js", async () => {
  const { stageSkipped } = await import("../src/install/pipeline/pipeline.js");
  return {
    McpStage: class {
      readonly name = "mcp" as const;
      async execute() {
        return stageSkipped("mcp", "stubbed in test: import.meta.resolve unavailable under vitest");
      }
    },
  };
});

describe("init_scan_completed — `fabric install` is wired to the emitter", () => {
  const originalHome = process.env.HOME;
  const originalFabricHome = process.env.FABRIC_HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "fabric-init-scan-home-"));
    process.env.HOME = home;
    process.env.FABRIC_HOME = home;
    saveGlobalConfig(globalConfigSchema.parse({ uid: "u-init-scan-test" }));
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalFabricHome === undefined) delete process.env.FABRIC_HOME;
    else process.env.FABRIC_HOME = originalFabricHome;
    rmSync(home, { recursive: true, force: true });
  });

  function initEventCount(): number {
    return (hook.readLedger(projectRoot) as Array<{ event_type?: string }>).filter(
      (e) => e.event_type === "init_scan_completed",
    ).length;
  }

  it("a real install stamps the event; a dry run does not", async () => {
    const { runInitCommand } = await import("../src/commands/install-v2.js");

    // `--dry-run` scaffolds nothing, so stamping it would tell the hook this
    // workspace was initialized when no files were written. Assert the negative
    // FIRST — running it second against an already-stamped ledger would pass
    // trivially thanks to the once-ever guard and prove nothing.
    await runInitCommand({ target: projectRoot, yes: true, "dry-run": true });
    expect(initEventCount()).toBe(0);

    await runInitCommand({ target: projectRoot, yes: true });
    expect(initEventCount()).toBe(1);
  });
});
