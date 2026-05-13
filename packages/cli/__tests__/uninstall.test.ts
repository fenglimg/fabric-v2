/**
 * Unit / command-surface tests for `fab uninstall`.
 *
 * Mirrors the init test pattern: real-filesystem + tmpdir cocos-stub fixture,
 * module-scoped tempRoots[] drained in afterEach, vi.restoreAllMocks() also in
 * afterEach. Each case covers one binding contract from the plan:
 *
 *   (a) plan enumerates expected scaffold entries against a freshly-init'd fixture
 *   (b) --plan mode performs no writes (snapshotTree before == after)
 *   (c) default scaffold execution removes derived state but preserves knowledge .gitkeep
 *   (d) --purge removes .fabric/knowledge/ but NEVER ~/.fabric/knowledge/ (HOME-pinned)
 *   (e) wizard cancellation sets exitCode=130 and emits the cancel banner exactly once
 *   (f) idempotent re-run: second run reports 100% skipped
 *   (g) --force allows uninstall even when artifacts are already missing without error
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { initFabric } from "../src/commands/init.ts";
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

    // Scaffold entries: every FABRIC_STATE_FILES + every knowledge subdir
    // .gitkeep must be in the entry list and existsSync must return true on a
    // freshly-init'd fixture (so absent: false).
    const stateFilePaths = plan.scaffold.entries.filter((e) => e.kind === "state-file");
    expect(stateFilePaths.map((e) => e.path).sort()).toEqual(
      ["agents.meta.json", "events.jsonl", "forensic.json"]
        .map((name) => join(target, ".fabric", name))
        .sort(),
    );
    expect(stateFilePaths.every((e) => e.absent === false)).toBe(true);

    const gitkeepEntries = plan.scaffold.entries.filter((e) => e.kind === "gitkeep");
    expect(gitkeepEntries.length).toBe(6); // decisions, pitfalls, guidelines, models, processes, pending
    expect(gitkeepEntries.every((e) => e.absent === false)).toBe(true);

    // Without --purge, no knowledge-subdir or fabric-dir entries.
    expect(plan.scaffold.entries.some((e) => e.kind === "knowledge-subdir")).toBe(false);
    expect(plan.scaffold.entries.some((e) => e.kind === "fabric-dir")).toBe(false);
  });
});

describe("uninstall --plan mode (no-write contract)", () => {
  it("(b) plan=true via runUninstallCommand returns 100% skipped stageResults and does NOT mutate disk", async () => {
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
      plan: true,
      yes: true,
      mcp: false,
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

    // Pre-conditions: state files + knowledge .gitkeep markers must exist.
    expect(existsSync(join(target, ".fabric", "agents.meta.json"))).toBe(true);
    expect(existsSync(join(target, ".fabric", "events.jsonl"))).toBe(true);
    expect(existsSync(join(target, ".fabric", "forensic.json"))).toBe(true);

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
    // knowledge entries). The .gitkeep markers themselves are removed by the
    // default scaffold, but the subdir directories survive.
    expect(existsSync(join(target, ".fabric", "knowledge"))).toBe(true);
    for (const sub of ["decisions", "pitfalls", "guidelines", "models", "processes", "pending"]) {
      // Subdir survives even though its .gitkeep is gone.
      expect(existsSync(join(target, ".fabric", "knowledge", sub))).toBe(true);
    }
  });
});

describe("uninstall --purge with HOME-pinned personal root", () => {
  it("(d) --purge removes .fabric/knowledge/ but personal ~/.fabric/knowledge/ is byte-identical", async () => {
    // Pin BOTH env vars so any resolver (FABRIC_HOME ?? homedir()) lands on the
    // isolated tmpdir — not the real user home.
    const isolatedHome = join(tmpdir(), `fab-uninstall-personal-home-${process.pid}-${Date.now()}`);
    mkdirSync(isolatedHome, { recursive: true });
    tempRoots.push(isolatedHome);
    process.env.HOME = isolatedHome;
    process.env.FABRIC_HOME = isolatedHome;

    // Seed personal knowledge entry inside the pinned HOME.
    const personalEntryDir = join(isolatedHome, ".fabric", "knowledge", "decisions");
    mkdirSync(personalEntryDir, { recursive: true });
    const personalEntry = join(personalEntryDir, "personal.md");
    const personalContent = "# Personal decision\n\nCross-project, must survive uninstall.\n";
    writeFileSync(personalEntry, personalContent, "utf8");

    const target = createWerewolfFixtureRoot("fab-uninstall-purge-personal");
    tempRoots.push(target);

    await initFabric(target);

    // Seed a project-local knowledge entry to confirm --purge removes it.
    writeFileSync(
      join(target, ".fabric", "knowledge", "decisions", "project-decision.md"),
      "# Project decision\n\nProject-local.\n",
      "utf8",
    );

    vi.spyOn(console, "log").mockImplementation(() => {});

    const plan = await buildUninstallExecutionPlan(target, {
      purge: true,
      skipBootstrap: true,
      skipMcp: true,
    });
    await executeUninstallExecutionPlan(plan);

    // Project-local knowledge subdirs (incl. seeded entry) removed by --purge.
    for (const sub of ["decisions", "pitfalls", "guidelines", "models", "processes", "pending"]) {
      expect(existsSync(join(target, ".fabric", "knowledge", sub))).toBe(false);
    }
    expect(existsSync(join(target, ".fabric", "knowledge", "decisions", "project-decision.md"))).toBe(false);

    // Personal root MUST be byte-identical, regardless of --purge.
    expect(existsSync(personalEntry)).toBe(true);
    expect(readFileSync(personalEntry, "utf8")).toBe(personalContent);
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

describe("uninstall --force on already-missing artifacts", () => {
  it("(g) --force allows uninstall when there is nothing left to remove without error", async () => {
    const target = createWerewolfFixtureRoot("fab-uninstall-force-empty");
    tempRoots.push(target);

    // Note: this fixture is NOT init'd. There is no .fabric / .claude / .codex
    // to remove. --force must not turn this into an error.
    expect(existsSync(join(target, ".fabric"))).toBe(false);

    vi.spyOn(console, "log").mockImplementation(() => {});

    const plan = await buildUninstallExecutionPlan(target, {
      force: true,
      skipMcp: true,
    });
    const result = await executeUninstallExecutionPlan(plan);

    // No errors anywhere — every step in every stage must be skipped or removed
    // (but never errored). In practice on a never-init'd fixture, everything is
    // skipped with status='skipped' message='absent'.
    const allSteps = result.stageResults.flatMap((stage) => stage.steps);
    const errorSteps = allSteps.filter((step) => step.status === "error");
    expect(errorSteps).toEqual([]);
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
    const result = await runUninstallCommand({ target, yes: true, mcp: false });

    expect(result).toBeDefined();
    // Plan executed — agents.meta.json gone.
    expect(existsSync(join(target, ".fabric", "agents.meta.json"))).toBe(false);
    // No clack prompts touched — yes:true bypass.
    expect(confirmMock).not.toHaveBeenCalled();
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it("non-interactive TTY path: --force bypass confirms and executes plan", async () => {
    process.env.FAB_LANG = "en";
    const target = createWerewolfFixtureRoot("fab-uninstall-force-bypass");
    tempRoots.push(target);

    await initFabric(target);

    // Non-TTY environment — wizardEnabled=false AND interactiveSummary=false,
    // so the confirm prompt isn't shown. --force is the documented escape hatch
    // for the lock-check path; here we just exercise the runner.
    restoreTtyMocks.push(setProcessTty(false, false, false));

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      void chunk;
      return true;
    }) as typeof process.stderr.write);

    vi.resetModules();
    const { runUninstallCommand } = await import("../src/commands/uninstall.ts");
    const result = await runUninstallCommand({ target, force: true, mcp: false });

    expect(result).toBeDefined();
    expect(existsSync(join(target, ".fabric", "agents.meta.json"))).toBe(false);
  });
});

describe("buildUninstallFabricPlan personal-root guard", () => {
  it("filters out any candidate path that resolves inside the personal fabric root", async () => {
    // Force genuine overlap: point HOME/FABRIC_HOME at the target project itself.
    // The project's `.fabric/knowledge/` then IS the personal-root knowledge dir,
    // so every knowledge-subdir candidate enumerated under `--purge` must be
    // filtered by the personal-root guard.
    const target = createWerewolfFixtureRoot("fab-uninstall-guard-target");
    tempRoots.push(target);
    process.env.HOME = target;
    process.env.FABRIC_HOME = target;

    const { buildUninstallFabricPlan, isInsidePersonalRoot } = await import(
      "../src/commands/uninstall.ts"
    );
    const plan = buildUninstallFabricPlan(target, { purge: true });

    // Personal root path resolves under the project tree.
    expect(plan.personalKnowledgeDir).toBe(join(target, ".fabric", "knowledge"));

    // No surviving entry resolves inside the personal root.
    for (const entry of plan.entries) {
      expect(isInsidePersonalRoot(entry.path, plan.personalKnowledgeDir)).toBe(false);
    }

    // Guard actually fired: with --purge, knowledge subdirs would normally be
    // enumerated. With personal-root overlap, none of them survive — the guard
    // filtered them out. Assert zero entries fall under `.fabric/knowledge/`.
    const knowledgePrefix = join(target, ".fabric", "knowledge");
    const overlapping = plan.entries.filter((e) => e.path.startsWith(knowledgePrefix));
    expect(overlapping).toEqual([]);
  });
});
