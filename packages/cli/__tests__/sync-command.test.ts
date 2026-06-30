import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getProjectTranslator } from "../src/i18n.js";
import { syncCommand, buildSyncReport } from "../src/commands/sync.js";
import type { RunSyncResult } from "../src/sync/run-sync.js";
import type { SyncStoreState } from "../src/sync/state-machine.js";

const originalExitCode = process.exitCode;

afterEach(() => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

describe("sync command flags", () => {
  it("rejects --continue and --abort together before resuming a session", () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((value?: unknown) => {
      errors.push(value === undefined ? "" : String(value));
    });

    expect(() => {
      syncCommand.run?.({ args: { continue: true, abort: true } } as never);
    }).not.toThrow();

    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toContain("--continue and --abort cannot be used together");
  });
});

// flat-design (spec §0.4): `fabric sync` upgraded from bare `alias\tstate` lines
// to flat primitives — a B-横线 command title + `● <alias>  <glyph> <state>` rows
// + an aggregate summary. These tests pin the NO_COLOR degradation (no raw ANSI;
// ASCII `----` rule; `*` group dot) and the aggregate-not-re-list behaviour.
describe("sync command — flat-design rendering (buildSyncReport)", () => {
  let prevNoColor: string | undefined;

  beforeEach(() => {
    prevNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
  });

  afterEach(() => {
    if (prevNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prevNoColor;
  });

  function result(states: Array<[string, SyncStoreState]>, over: Partial<RunSyncResult> = {}): RunSyncResult {
    const stores = states.map(([alias, state]) => ({ alias, store_uuid: `uuid-${alias}`, state }));
    return {
      session: { stores },
      settled: true,
      deferred: [],
      snapshotWritten: false,
      ...over,
    } as RunSyncResult;
  }

  it("renders a flat block under NO_COLOR — no ANSI, ASCII rule, `*` group dot", () => {
    const out = buildSyncReport(result([["team", "synced"], ["personal", "synced"]]), getProjectTranslator());
    // eslint-disable-next-line no-control-regex
    expect(out).not.toMatch(/\x1b\[/); // NO_COLOR strips raw ANSI
    expect(out).toMatch(/-{8,}/); // headerRule degrades to ASCII underline
    expect(out).toContain("*"); // groupDot `●` → `*`
    expect(out).toContain("team");
    expect(out).toContain("personal");
    // all-synced terminal notice (aggregate, not a per-store re-read).
    expect(out).toContain("all stores synced");
  });

  it("a conflict surfaces the paused notice over the deferred/all-synced ones", () => {
    const out = buildSyncReport(
      result([["team", "synced"], ["shared", "conflict"]], { settled: false }),
      getProjectTranslator(),
    );
    expect(out).toContain("conflict");
    expect(out).toContain("fabric sync --continue"); // paused notice wins
    expect(out).not.toContain("all stores synced");
  });

  it("offline stores yield the deferred notice when settled", () => {
    const out = buildSyncReport(
      result([["team", "synced"], ["personal", "offline"]], {
        deferred: [{ alias: "personal", store_uuid: "uuid-personal", state: "offline" }],
      }),
      getProjectTranslator(),
    );
    expect(out).toContain("offline");
    expect(out).toContain("push deferred");
    expect(out).not.toContain("all stores synced");
  });

  it("an empty session reports nothing-to-sync, no summary grid", () => {
    const out = buildSyncReport(result([]), getProjectTranslator());
    expect(out).toContain("no remote-backed stores to sync");
    // No summary section for an empty sync.
    expect(out).not.toContain("Sync summary");
  });
});
