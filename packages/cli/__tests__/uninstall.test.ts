/**
 * Unit / command-surface tests for `fabric uninstall`.
 *
 * Mirrors the init test pattern: real-filesystem + tmpdir cocos-stub fixture,
 * module-scoped tempRoots[] drained in afterEach, vi.restoreAllMocks() also in
 * afterEach. Each case covers one binding contract from the plan:
 *
 *   (a) plan enumerates expected scaffold entries against a freshly-init'd fixture
 *   (b) --dry-run mode performs no writes (snapshotTree before == after)
 *   (c) default scaffold execution removes derived state but leaves user-created legacy knowledge untouched
 *   (e) wizard cancellation sets exitCode=130 and emits the cancel banner exactly once
 *   (f) idempotent re-run: second run reports 100% skipped
 *
 * rc.15 TASK-002 — cases (d) --purge and (g) --force were deleted alongside
 * those legacy flags. Knowledge preservation is now unconditional (no --purge);
 * idempotency on missing artifacts is exercised by case (f).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { initFabric } from "../src/commands/install.ts";
import {
  installFabricArchiveSkill,
  installFabricReviewSkill,
} from "../src/install/skills-and-hooks.ts";
import {
  uninstallFabricArchiveSkill,
  uninstallFabricReviewSkill,
} from "../src/install/uninstall-skills-and-hooks.ts";
import {
  buildUninstallExecutionPlan,
  executeUninstallExecutionPlan,
  uninstallFabric,
} from "../src/commands/uninstall.ts";
import { unbindStoreProject } from "../src/install/uninstall-store.ts";
import { ensureStoreProjectBinding } from "../src/install/store-project-onboarding.ts";
import { runGlobalInstall } from "../src/install/run-global-install.ts";
import { storeCreate, storeProjectList } from "../src/store/store-ops.ts";
import { loadGlobalConfig } from "../src/store/global-config-io.ts";
import { loadProjectConfig } from "../src/store/project-config-io.ts";
import type { OutputRenderer } from "../src/tui/types.ts";
import {
  cleanupFixtureRoot,
  createEmptyFixtureRoot,
  createWerewolfFixtureRoot,
  setProcessTty,
} from "./helpers/init-test-utils.ts";

const UNBIND_NOW = "2026-06-25T00:00:00.000Z";

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

    // Five stages in the canonical order — the reverse of the install pipeline.
    expect(plan.stages.map((s) => s.name)).toEqual([
      "bootstrap",
      "mcp",
      "store",
      "scaffold",
      "validate",
    ]);
    // mcp must be skipped because we passed skipMcp.
    expect(plan.stages.find((s) => s.name === "mcp")?.skipped).toBe(true);
    // bootstrap + scaffold + validate run by default.
    expect(plan.stages.find((s) => s.name === "bootstrap")?.skipped).toBe(false);
    expect(plan.stages.find((s) => s.name === "scaffold")?.skipped).toBe(false);
    expect(plan.stages.find((s) => s.name === "validate")?.skipped).toBe(false);
    // store-unbind is OPT-IN: skipped unless skipStore===false is passed.
    expect(plan.stages.find((s) => s.name === "store")?.skipped).toBe(true);

    // Scaffold entries: project-local Fabric state only. Knowledge lives in
    // global stores now, so uninstall no longer enumerates any .fabric/knowledge
    // marker cabinet.
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

    expect(plan.scaffold.entries.every((e) => e.kind === "state-file")).toBe(true);
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
      // grill-6fixes (③): the wizard is now a single multiselect + a single
      // final confirm. The user picks stages, then declines the final
      // "Execute now?" confirm → the wizard short-circuits with cancellation.
      multiselect: vi.fn().mockResolvedValue(["scaffold", "bootstrap", "mcp"]),
      confirm: vi.fn().mockResolvedValue(false),
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

describe("uninstall skill ref/ directory removal", () => {
  // Round-trip oracle for the install↔uninstall symmetry on ref-bearing
  // skills (FabricSkillInstallSpec.includeRefFiles). install ships SKILL.md +
  // ref/*.md; uninstall must remove BOTH so the parent skill dir prunes —
  // before the fix the non-empty ref/ left the whole skill dir orphaned.
  // Driven through the install/uninstall HELPERS directly (initFabric only
  // runs the scaffold stage; skills install in the bootstrap pipeline).
  it.each([
    {
      slug: "fabric-archive",
      install: installFabricArchiveSkill,
      uninstall: uninstallFabricArchiveSkill,
    },
    {
      slug: "fabric-review",
      install: installFabricReviewSkill,
      uninstall: uninstallFabricReviewSkill,
    },
  ])("install → uninstall leaves no residual dir for $slug", async ({ slug, install, uninstall }) => {
    const target = createWerewolfFixtureRoot(`fab-uninstall-skill-ref-${slug}`);
    tempRoots.push(target);

    await install(target);

    // Pre-condition: both clients get SKILL.md + a populated ref/ dir.
    for (const client of [".claude", ".codex"]) {
      const refDir = join(target, client, "skills", slug, "ref");
      expect(existsSync(join(target, client, "skills", slug, "SKILL.md"))).toBe(true);
      expect(existsSync(refDir)).toBe(true);
      expect(readdirSync(refDir).some((f) => f.endsWith(".md"))).toBe(true);
    }

    await uninstall(target);

    // The whole skill directory (SKILL.md + ref/ + ref/*.md) is gone.
    for (const client of [".claude", ".codex"]) {
      expect(existsSync(join(target, client, "skills", slug))).toBe(false);
    }
  });

  it("preserves a user-authored non-.md file in ref/ (and keeps the dir)", async () => {
    const target = createWerewolfFixtureRoot("fab-uninstall-skill-ref-userfile");
    tempRoots.push(target);

    await installFabricArchiveSkill(target);

    // A user drops a non-.md companion into the installed ref/ dir. uninstall
    // only ever wrote *.md there, so it must not clobber this file — which in
    // turn keeps ref/ (and the skill dir) intact.
    const refDir = join(target, ".claude", "skills", "fabric-archive", "ref");
    const userFile = join(refDir, "NOTES.txt");
    writeFileSync(userFile, "user-authored", "utf8");

    await uninstallFabricArchiveSkill(target);

    expect(existsSync(userFile)).toBe(true);
    expect(readFileSync(userFile, "utf8")).toBe("user-authored");
    // Install-written .md ref files are gone even though the dir survives.
    expect(readdirSync(refDir).some((f) => f.endsWith(".md"))).toBe(false);
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
    expect(result.stageResults.map((s) => s.name)).toEqual([
      "bootstrap",
      "mcp",
      "store",
      "scaffold",
      "validate",
    ]);
    expect(result.stageResults.find((s) => s.name === "mcp")?.disposition).toBe("skipped");
    // store-unbind is opt-in → skipped by default.
    expect(result.stageResults.find((s) => s.name === "store")?.disposition).toBe("skipped");
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

describe("buildUninstallFabricPlan global-store guard", () => {
  it("keeps global store paths out of the project uninstall scaffold plan", async () => {
    // Force overlap: point FABRIC_HOME at the target project itself. Even in
    // that shape, scaffold entries must not target the global stores root.
    const target = createWerewolfFixtureRoot("fab-uninstall-guard-target");
    tempRoots.push(target);
    process.env.HOME = target;
    process.env.FABRIC_HOME = target;

    const { buildUninstallFabricPlan, isInsideGlobalStoresRoot } = await import(
      "../src/commands/uninstall.ts"
    );
    const plan = buildUninstallFabricPlan(target);

    expect(plan.globalStoresDir).toBe(join(target, ".fabric", "stores"));

    for (const entry of plan.entries) {
      expect(isInsideGlobalStoresRoot(entry.path, plan.globalStoresDir)).toBe(false);
    }

    const storesPrefix = join(target, ".fabric", "stores");
    const overlapping = plan.entries.filter((e) => e.path.startsWith(storesPrefix));
    expect(overlapping).toEqual([]);
  });
});

// W4 store-unbind: the project-side inverse of install's store binding. The
// round-trip oracle (bind → unbind) is the only honest check that the global
// store + its team-shared projects.json stay byte-identical.
describe("uninstall store-unbind stage", () => {
  async function seedBoundProject(prefix: string, projectId: string) {
    const projectRoot = createEmptyFixtureRoot(`${prefix}-p`);
    const globalDir = createEmptyFixtureRoot(`${prefix}-g`);
    tempRoots.push(projectRoot, globalDir);
    const globalRoot = join(globalDir, ".fabric");

    await runGlobalInstall(
      { uid: "u-unbind", personalStoreUuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", now: UNBIND_NOW },
      globalRoot,
    );
    await storeCreate("team", UNBIND_NOW, { globalRoot, git: false });
    await ensureStoreProjectBinding(projectRoot, "team", {
      globalRoot,
      requestedProjectId: projectId,
      now: UNBIND_NOW,
    });
    return { projectRoot, globalRoot };
  }

  it("default uninstall leaves the team binding untouched (store stage opt-in)", async () => {
    const { projectRoot } = await seedBoundProject("fab-unbind-default", "proj-x");
    vi.spyOn(console, "log").mockImplementation(() => {});

    const plan = await buildUninstallExecutionPlan(projectRoot, { skipMcp: true });
    await executeUninstallExecutionPlan(plan);

    const cfg = loadProjectConfig(projectRoot);
    expect(cfg?.required_stores?.map((r) => r.id)).toEqual(["team"]);
    expect(cfg?.active_write_store).toBe("team");
    expect(cfg?.active_project).toBe("proj-x");
  });

  it("explicit unbind clears the project-side binding but never the global store", async () => {
    const { projectRoot, globalRoot } = await seedBoundProject("fab-unbind-explicit", "proj-y");

    // Snapshot the GLOBAL side BEFORE unbind — must be byte-identical after.
    const globalBefore = JSON.stringify(loadGlobalConfig(globalRoot));
    const projectsBefore = JSON.stringify(await storeProjectList("team", globalRoot));

    const before = loadProjectConfig(projectRoot);
    expect(before?.required_stores?.map((r) => r.id)).toEqual(["team"]);
    expect(before?.active_write_store).toBe("team");
    const projectId = before?.project_id;
    expect(typeof projectId).toBe("string");

    const result = unbindStoreProject(projectRoot, { globalRoot, now: UNBIND_NOW });
    expect(result.status).toBe("unbound");
    expect(result.unboundAliases).toEqual(["team"]);

    // Project-side binding cleared, project_id + file preserved.
    const after = loadProjectConfig(projectRoot);
    expect(after?.required_stores ?? []).toEqual([]);
    expect(after?.active_write_store).toBeUndefined();
    expect(after?.default_write_store).toBeUndefined();
    expect(after?.write_routes ?? []).toEqual([]);
    expect(after?.active_project).toBeUndefined();
    expect(after?.project_id).toBe(projectId);
    expect(existsSync(join(projectRoot, ".fabric", "fabric-config.json"))).toBe(true);

    // Global store + its projects.json are byte-identical — never touched.
    expect(JSON.stringify(loadGlobalConfig(globalRoot))).toBe(globalBefore);
    expect(JSON.stringify(await storeProjectList("team", globalRoot))).toBe(projectsBefore);
  });

  it("unbind on a project with no config is a no-op skip", () => {
    const projectRoot = createEmptyFixtureRoot("fab-unbind-noop-p");
    const globalDir = createEmptyFixtureRoot("fab-unbind-noop-g");
    tempRoots.push(projectRoot, globalDir);
    const result = unbindStoreProject(projectRoot, { globalRoot: join(globalDir, ".fabric"), now: UNBIND_NOW });
    expect(result.status).toBe("skipped");
    expect(result.unboundAliases).toEqual([]);
  });

  it("explicit unbind via the plan runs the store stage", async () => {
    const { projectRoot, globalRoot } = await seedBoundProject("fab-unbind-plan", "proj-z");
    vi.spyOn(console, "log").mockImplementation(() => {});

    const plan = await buildUninstallExecutionPlan(projectRoot, {
      skipBootstrap: true,
      skipMcp: true,
      skipScaffold: true,
      skipStore: false,
    });
    const result = await executeUninstallExecutionPlan(plan);

    expect(result.stageResults.find((s) => s.name === "store")?.disposition).toBe("ran");
    // Binding gone; global store untouched (still mounted + projects intact).
    expect(loadProjectConfig(projectRoot)?.required_stores ?? []).toEqual([]);
    expect(loadGlobalConfig(globalRoot)?.stores.some((s) => s.alias === "team")).toBe(true);
    expect((await storeProjectList("team", globalRoot)).some((p) => p.id === "proj-z")).toBe(true);
  });
});

describe("uninstall validate stage", () => {
  it("reports cleared after a full bootstrap teardown", async () => {
    const target = createWerewolfFixtureRoot("fab-uninstall-validate");
    tempRoots.push(target);
    await initFabric(target);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await uninstallFabric(target, { skipMcp: true });
    const validate = result.stageResults.find((s) => s.name === "validate");
    expect(validate?.disposition).toBe("ran");
    expect(validate?.steps.some((s) => s.message === "cleared")).toBe(true);
  });
});

describe("uninstall renderer wiring", () => {
  it("drives the OutputRenderer without throwing and emits section + summary + complete", async () => {
    const target = createWerewolfFixtureRoot("fab-uninstall-renderer");
    tempRoots.push(target);
    await initFabric(target);

    const calls: string[] = [];
    const renderer: OutputRenderer = {
      renderStep: () => calls.push("step"),
      renderSuccess: () => calls.push("success"),
      renderError: () => calls.push("error"),
      renderWarning: () => calls.push("warning"),
      renderInfo: () => calls.push("info"),
      renderSummaryCard: () => calls.push("summary"),
      renderSection: () => calls.push("section"),
      renderComplete: () => calls.push("complete"),
      cleanup: async () => {},
    };

    const plan = await buildUninstallExecutionPlan(target, { skipMcp: true });
    await executeUninstallExecutionPlan(plan, renderer);

    expect(calls).toContain("section");
    expect(calls).toContain("summary");
    expect(calls).toContain("complete");
  });
});
