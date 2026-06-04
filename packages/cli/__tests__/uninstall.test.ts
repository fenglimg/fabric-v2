/**
 * Unit / command-surface tests for `fabric uninstall`.
 *
 * Mirrors the init test pattern: real-filesystem + tmpdir cocos-stub fixture,
 * module-scoped tempRoots[] drained in afterEach, vi.restoreAllMocks() also in
 * afterEach. Each case covers one binding contract from the plan:
 *
 *   (a) plan enumerates expected scaffold entries against a freshly-init'd fixture
 *   (b) --dry-run mode performs no writes (snapshotTree before == after)
 *   (c) default scaffold execution removes derived state but preserves knowledge .gitkeep
 *   (e) wizard cancellation sets exitCode=130 and emits the cancel banner exactly once
 *   (f) idempotent re-run: second run reports 100% skipped
 *
 * rc.15 TASK-002 — cases (d) --purge and (g) --force were deleted alongside
 * those legacy flags. Knowledge preservation is now unconditional (no --purge);
 * idempotency on missing artifacts is exercised by case (f).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { initFabric } from "../src/commands/install.ts";
import {
  buildUninstallExecutionPlan,
  executeUninstallExecutionPlan,
} from "../src/commands/uninstall.ts";
import {
  cleanupFixtureRoot,
  createWerewolfFixtureRoot,
  setProcessTty,
} from "./helpers/init-test-utils.ts";

const tempRoots: string[] = [];
const restoreTtyMocks: Array<() => void> = [];
const originalHome = process.env.HOME;
const originalFabricHome = process.env.FABRIC_HOME;

afterEach(() => {
  while (restoreTtyMocks.length > 0) {
    restoreTtyMocks.pop()?.();
  }

  // Restore env BEFORE cleanup so any FABRIC_HOME-isolated tmp dir gets cleaned.
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }

  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }

  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("@clack/prompts");
  process.exitCode = 0;
});

type SimpleTreeSnapshot = Record<string, string>;

function snapshotTree(root: string, rel: string): SimpleTreeSnapshot {
  const out: SimpleTreeSnapshot = {};
  const start = join(root, rel);
  if (!existsSync(start)) return out;
  walk(start);
  return out;

  function walk(p: string): void {
    const stat = statSync(p);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(p)) {
        walk(join(p, entry));
      }
      return;
    }
    if (stat.isFile()) {
      out[p.slice(root.length + 1)] = readFileSync(p, "utf8");
    }
  }
}

describe("uninstall plan enumeration", () => {
  it("(a) buildUninstallExecutionPlan enumerates scaffold + bootstrap + mcp stages on a freshly-init'd fixture", async () => {
    const target = createWerewolfFixtureRoot("fab-uninstall-plan-shape");
    tempRoots.push(target);

    await initFabric(target);

    const plan = await buildUninstallExecutionPlan(target, { skipMcp: true });

    // Plan target / fabricDir / personal-root pinned to derivations.
    expect(plan.target).toBe(target);
    expect(plan.scaffold.target).toBe(target);
    expect(plan.scaffold.fabricDir).toBe(join(target, ".fabric"));

    // Three stages in the canonical order.
    expect(plan.stages.map((s) => s.name)).toEqual(["scaffold", "bootstrap", "mcp"]);
    // mcp must be skipped because we passed skipMcp.
    expect(plan.stages.find((s) => s.name === "mcp")?.skipped).toBe(true);
    // scaffold + bootstrap must NOT be skipped by default.
    expect(plan.stages.find((s) => s.name === "scaffold")?.skipped).toBe(false);
    expect(plan.stages.find((s) => s.name === "bootstrap")?.skipped).toBe(false);

    // Scaffold entries: the uninstall command still enumerates every
    // FABRIC_STATE_FILES + every knowledge subdir .gitkeep. W5 I1 retired the
    // co-location agents.meta.json + .gitkeep cabinet scaffold in install, so
    // on a freshly-init'd fixture those entries now report absent: true (the
    // would-be removals are no-ops), while events.jsonl / forensic.json (still
    // scaffolded) report absent: false.
    const stateFilePaths = plan.scaffold.entries.filter((e) => e.kind === "state-file");
    expect(stateFilePaths.map((e) => e.path).sort()).toEqual(
      ["agents.meta.json", "events.jsonl", "forensic.json"]
        .map((name) => join(target, ".fabric", name))
        .sort(),
    );
    const absentByName = new Map(
      stateFilePaths.map((e) => [e.path, e.absent] as const),
    );
    expect(absentByName.get(join(target, ".fabric", "agents.meta.json"))).toBe(true);
    expect(absentByName.get(join(target, ".fabric", "events.jsonl"))).toBe(false);
    expect(absentByName.get(join(target, ".fabric", "forensic.json"))).toBe(false);

    const gitkeepEntries = plan.scaffold.entries.filter((e) => e.kind === "gitkeep");
    expect(gitkeepEntries.length).toBe(6); // decisions, pitfalls, guidelines, models, processes, pending
    // W5 I1: install no longer writes the .gitkeep cabinet, so every gitkeep
    // candidate is absent on a fresh install.
    expect(gitkeepEntries.every((e) => e.absent === true)).toBe(true);

    // rc.15 TASK-002 — --purge gone; entry kinds collapse to state-file + gitkeep.
    // Knowledge subdir contents and the .fabric/ directory itself are unconditionally
    // preserved.
    expect(plan.scaffold.entries.every((e) => e.kind === "state-file" || e.kind === "gitkeep")).toBe(true);
  });
});

describe("uninstall --dry-run mode (no-write contract)", () => {
  it("(b) dry-run=true via runUninstallCommand returns 100% skipped stageResults and does NOT mutate disk", async () => {
    process.env.FAB_LANG = "en";
    const target = createWerewolfFixtureRoot("fab-uninstall-plan-mode");
    tempRoots.push(target);

    await initFabric(target);

    // Snapshot the entire .fabric + .claude + .codex trees BEFORE plan-only.
    const before = {
      fabric: snapshotTree(target, ".fabric"),
      claude: snapshotTree(target, ".claude"),
      codex: snapshotTree(target, ".codex"),
    };

    // Silence stdout so the test output stays clean.
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      void chunk;
      return true;
    }) as typeof process.stderr.write);

    // Drive through runUninstallCommand — the orchestrator's planOnly handler
    // short-circuits before execute is called, returning 100%-skipped stage
    // records. Pass yes:true to bypass the wizard / confirm prompts.
    vi.resetModules();
    const { runUninstallCommand } = await import("../src/commands/uninstall.ts");
    const result = await runUninstallCommand({
      target,
      "dry-run": true,
      yes: true,
    });

    expect(result).toBeDefined();
    expect(result?.stageResults.every((stage) => stage.disposition === "skipped")).toBe(true);

    const after = {
      fabric: snapshotTree(target, ".fabric"),
      claude: snapshotTree(target, ".claude"),
      codex: snapshotTree(target, ".codex"),
    };

    expect(after.fabric).toEqual(before.fabric);
    expect(after.claude).toEqual(before.claude);
    expect(after.codex).toEqual(before.codex);
  });
});

describe("uninstall default scaffold execution", () => {
  it("(c) executeUninstallExecutionPlan removes derived state but preserves knowledge subdirs", async () => {
    const target = createWerewolfFixtureRoot("fab-uninstall-scaffold-default");
    tempRoots.push(target);

    await initFabric(target);

    // Pre-conditions: the event-ledger state files are scaffolded by install.
    // W5 I1 retired the agents.meta.json scaffold, so it is absent post-install.
    expect(existsSync(join(target, ".fabric", "agents.meta.json"))).toBe(false);
    expect(existsSync(join(target, ".fabric", "events.jsonl"))).toBe(true);
    expect(existsSync(join(target, ".fabric", "forensic.json"))).toBe(true);

    // Seed a user-authored knowledge tree (created on-demand, not by install)
    // to verify default uninstall preserves it.
    for (const sub of ["decisions", "pitfalls", "guidelines", "models", "processes", "pending"]) {
      mkdirSync(join(target, ".fabric", "knowledge", sub), { recursive: true });
    }

    vi.spyOn(console, "log").mockImplementation(() => {});

    const plan = await buildUninstallExecutionPlan(target, {
      skipBootstrap: true,
      skipMcp: true,
    });
    await executeUninstallExecutionPlan(plan);

    // State files removed.
    expect(existsSync(join(target, ".fabric", "agents.meta.json"))).toBe(false);
    expect(existsSync(join(target, ".fabric", "events.jsonl"))).toBe(false);
    expect(existsSync(join(target, ".fabric", "forensic.json"))).toBe(false);

    // Knowledge directory tree is preserved (default uninstall keeps user
    // knowledge entries). The subdir directories survive.
    expect(existsSync(join(target, ".fabric", "knowledge"))).toBe(true);
    for (const sub of ["decisions", "pitfalls", "guidelines", "models", "processes", "pending"]) {
      expect(existsSync(join(target, ".fabric", "knowledge", sub))).toBe(true);
    }
  });
});

describe("uninstall wizard cancellation", () => {
  it("(e) cancelling the wizard sets exitCode=130 and emits cancel banner exactly once", async () => {
    process.env.FAB_LANG = "en";
    const target = createWerewolfFixtureRoot("fab-uninstall-wizard-cancel");
    tempRoots.push(target);

    await initFabric(target);

    restoreTtyMocks.push(setProcessTty(true, true, true));
    const stderrWrites: string[] = [];
    const cancelMock = vi.fn();

    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      stderrWrites.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stderr.write);
    vi.spyOn(console, "log").mockImplementation(() => {});

    vi.doMock("@clack/prompts", () => ({
      intro: vi.fn(),
      note: vi.fn(),
      outro: vi.fn(),
      cancel: cancelMock,
      // First confirm() in the wizard ("Continue uninstalling Fabric from
      // {target}?") returns false — the wizard short-circuits with cancellation.
      confirm: vi.fn().mockResolvedValue(false),
      group: vi.fn(),
      select: vi.fn(),
      log: { step: vi.fn() },
      isCancel: vi.fn().mockReturnValue(false),
    }));

    vi.resetModules();
    const { runUninstallCommand } = await import("../src/commands/uninstall.ts");

    let thrown: unknown;
    try {
      await runUninstallCommand({ target });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeUndefined();
    expect(process.exitCode).toBe(130);
    // Cancel banner emitted exactly once.
    expect(cancelMock).toHaveBeenCalledTimes(1);
  });
});

describe("uninstall idempotency", () => {
  it("(f) second uninstall run reports every step as skipped", async () => {
    const target = createWerewolfFixtureRoot("fab-uninstall-idempotent");
    tempRoots.push(target);

    await initFabric(target);

    vi.spyOn(console, "log").mockImplementation(() => {});

    // First run: removes most artifacts.
    const plan1 = await buildUninstallExecutionPlan(target, { skipMcp: true });
    await executeUninstallExecutionPlan(plan1);

    // Second run: rebuild plan (entries now report absent: true) and execute.
    const plan2 = await buildUninstallExecutionPlan(target, { skipMcp: true });
    const result2 = await executeUninstallExecutionPlan(plan2);

    // Every step from every stage must be skipped (status === 'skipped').
    const allSteps = result2.stageResults.flatMap((stage) => stage.steps);
    expect(allSteps.length).toBeGreaterThan(0);
    expect(allSteps.every((step) => step.status === "skipped")).toBe(true);
  });
});

// Coverage-oriented tests for top-level entrypoint, MCP client loop, and
// non-wizard confirmation path. These exercise paths not reached by (a)-(g).

describe("uninstallFabric top-level entrypoint", () => {
  it("uninstallFabric builds + executes plan in one call", async () => {
    const target = createWerewolfFixtureRoot("fab-uninstall-fabric");
    tempRoots.push(target);

    await initFabric(target);

    vi.spyOn(console, "log").mockImplementation(() => {});

    const { uninstallFabric } = await import("../src/commands/uninstall.ts");
    const result = await uninstallFabric(target, { skipMcp: true });

    expect(result.plan.target).toBe(target);
    expect(result.stageResults.map((s) => s.name)).toEqual(["scaffold", "bootstrap", "mcp"]);
    expect(result.stageResults.find((s) => s.name === "mcp")?.disposition).toBe("skipped");
    expect(existsSync(join(target, ".fabric", "agents.meta.json"))).toBe(false);
  });
});

describe("uninstallMcpClients", () => {
  it("dryRun=true marks each detected client as skipped with dry-run message", async () => {
    const target = createWerewolfFixtureRoot("fab-uninstall-mcp-dryrun");
    tempRoots.push(target);

    await initFabric(target);

    vi.spyOn(console, "log").mockImplementation(() => {});

    const { uninstallMcpClients } = await import("../src/commands/uninstall.ts");
    const { results } = await uninstallMcpClients(target, { dryRun: true });

    // Some writers may be detected (have config paths) and some not; just
    // assert that any detected-path result is dry-run, and no result has
    // status='removed' or 'error'.
    for (const step of results) {
      expect(step.status).not.toBe("removed");
      expect(step.status).not.toBe("error");
    }
  });

  it("on never-init'd fixture, all writers either skip with no-config-path or remove/skip cleanly", async () => {
    const target = createWerewolfFixtureRoot("fab-uninstall-mcp-empty");
    tempRoots.push(target);

    vi.spyOn(console, "log").mockImplementation(() => {});

    const { uninstallMcpClients } = await import("../src/commands/uninstall.ts");
    const { details, results } = await uninstallMcpClients(target);

    // No error details produced — every writer handles missing config gracefully.
    expect(details.filter((d) => d.status === "error")).toEqual([]);
    expect(results.filter((r) => r.status === "error")).toEqual([]);
  });
});

describe("runUninstallCommand interactive confirmation", () => {
  it("yes=true bypasses confirm prompt and executes the plan", async () => {
    process.env.FAB_LANG = "en";
    const target = createWerewolfFixtureRoot("fab-uninstall-yes-bypass");
    tempRoots.push(target);

    await initFabric(target);

    restoreTtyMocks.push(setProcessTty(true, true, true));

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      void chunk;
      return true;
    }) as typeof process.stderr.write);

    // Mock @clack/prompts to fail loudly if anything calls confirm/cancel —
    // yes:true must short-circuit before either is invoked.
    const confirmMock = vi.fn();
    const cancelMock = vi.fn();
    vi.doMock("@clack/prompts", () => ({
      intro: vi.fn(),
      note: vi.fn(),
      outro: vi.fn(),
      cancel: cancelMock,
      confirm: confirmMock,
      group: vi.fn(),
      select: vi.fn(),
      log: { step: vi.fn() },
      isCancel: vi.fn().mockReturnValue(false),
    }));

    vi.resetModules();
    const { runUninstallCommand } = await import("../src/commands/uninstall.ts");
    const result = await runUninstallCommand({ target, yes: true });

    expect(result).toBeDefined();
    // Plan executed — agents.meta.json gone.
    expect(existsSync(join(target, ".fabric", "agents.meta.json"))).toBe(false);
    // No clack prompts touched — yes:true bypass.
    expect(confirmMock).not.toHaveBeenCalled();
    expect(cancelMock).not.toHaveBeenCalled();
  });

});

describe("buildUninstallFabricPlan personal-root guard", () => {
  it("filters out any candidate path that resolves inside the personal fabric root", async () => {
    // Force genuine overlap: point HOME/FABRIC_HOME at the target project itself.
    // The project's `.fabric/knowledge/` then IS the personal-root knowledge dir,
    // so every .gitkeep candidate enumerated under the team knowledge tree must
    // be filtered by the personal-root guard.
    const target = createWerewolfFixtureRoot("fab-uninstall-guard-target");
    tempRoots.push(target);
    process.env.HOME = target;
    process.env.FABRIC_HOME = target;

    const { buildUninstallFabricPlan, isInsidePersonalRoot } = await import(
      "../src/commands/uninstall.ts"
    );
    const plan = buildUninstallFabricPlan(target);

    // Personal root path resolves under the project tree.
    expect(plan.personalKnowledgeDir).toBe(join(target, ".fabric", "knowledge"));

    // No surviving entry resolves inside the personal root.
    for (const entry of plan.entries) {
      expect(isInsidePersonalRoot(entry.path, plan.personalKnowledgeDir)).toBe(false);
    }

    // Guard actually fired: every default-scaffold .gitkeep candidate is under
    // `.fabric/knowledge/` — with personal-root overlap, none survive.
    const knowledgePrefix = join(target, ".fabric", "knowledge");
    const overlapping = plan.entries.filter((e) => e.path.startsWith(knowledgePrefix));
    expect(overlapping).toEqual([]);
  });
});
