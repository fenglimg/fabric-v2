import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadGlobalConfig, resolveGlobalRoot } from "../../src/store/global-config-io.ts";
import { InstallPipeline } from "../../src/install/pipeline/pipeline.ts";
import type { InstallContext, PipelineResult, ScaffoldResult } from "../../src/install/pipeline/types.ts";
import { PreflightStage } from "../../src/install/pipeline/preflight.stage.ts";
import { EnvStage } from "../../src/install/pipeline/env.stage.ts";
import { StoreStage } from "../../src/install/pipeline/store.stage.ts";
import { HooksStage } from "../../src/install/pipeline/hooks.stage.ts";
import { McpStage } from "../../src/install/pipeline/mcp.stage.ts";
import { ValidateStage } from "../../src/install/pipeline/validate.stage.ts";
import { GuidanceStage } from "../../src/install/pipeline/guidance.stage.ts";

const WEREWOLF_FIXTURE = fileURLToPath(new URL("../fixtures/cocos-stub", import.meta.url));

export function createWerewolfFixtureRoot(prefix: string): string {
  const root = join(tmpdir(), `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  cpSync(WEREWOLF_FIXTURE, root, { recursive: true });
  if (existsSync(join(root, "AGENTS.md"))) {
    rmSync(join(root, "AGENTS.md"));
  }
  rmSync(join(root, ".fabric"), { recursive: true, force: true });
  rmSync(join(root, ".claude"), { recursive: true, force: true });
  return root;
}

export function cleanupFixtureRoot(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

export function writeFixtureFile(root: string, relativePath: string, content: string): string {
  const targetPath = join(root, ...relativePath.split("/"));
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content, "utf8");
  return targetPath;
}

export function readFixtureFile(root: string, relativePath: string): string {
  return readFileSync(join(root, ...relativePath.split("/")), "utf8");
}

export function createEmptyFixtureRoot(prefix: string): string {
  const root = join(tmpdir(), `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "package.json"), '{\n  "name": "fixture"\n}\n', "utf8");
  return root;
}

export function setProcessTty(
  stdoutValue: boolean,
  stderrValue: boolean = stdoutValue,
  stdinValue: boolean = stdoutValue,
): () => void {
  const descriptors = [
    [process.stdin, Object.getOwnPropertyDescriptor(process.stdin, "isTTY"), stdinValue] as const,
    [process.stdout, Object.getOwnPropertyDescriptor(process.stdout, "isTTY"), stdoutValue] as const,
    [process.stderr, Object.getOwnPropertyDescriptor(process.stderr, "isTTY"), stderrValue] as const,
  ];

  for (const [stream, , value] of descriptors) {
    Object.defineProperty(stream, "isTTY", {
      configurable: true,
      value,
      writable: true,
    });
  }

  return () => {
    for (const [stream, descriptor] of descriptors) {
      if (descriptor === undefined) {
        delete (stream as unknown as { isTTY?: boolean }).isTTY;
        continue;
      }

      Object.defineProperty(stream, "isTTY", descriptor);
    }
  };
}

// rc.14 TASK-002 — hoisted from install-skills-and-hooks.test.ts and
// uninstall-skills-and-hooks.test.ts (previously duplicated). Single source
// of truth so any change to runInit semantics propagates to both install
// integration tests and the new install-diff-mode test suite.

/**
 * Drive `fabric install` end-to-end through the SAME stage pipeline the real
 * `fabric install` command runs (src/commands/install-v2.ts), but skip the MCP
 * stage — a local MCP install would write outside the fixture (npm install,
 * global config), which is out of scope for fixture-based install tests.
 * Bootstrap (skill + hook + per-client configs + pointer) and hooks run normally.
 *
 * T-2: this used to drive the RETIRED v1 installer (`src/commands/install.ts`),
 * which kept 1,953 lines of production-unreachable code alive purely because the
 * test fixtures imported it. The stage list and context below mirror
 * install-v2's `createInstallContext` + pipeline assembly; that function is not
 * exported and hardcodes `skipMcp: false`, so the context is rebuilt here rather
 * than imported. If install-v2 gains or reorders a stage, mirror it here.
 *
 * Contract note: the pipeline CATCHES stage errors and reports them as
 * `{ success: false, error }`, whereas the v1 `executeInitExecutionPlan` threw.
 * Tests assert the throwing contract (e.g. the drift-abort guard in
 * integration/init-guard.test.ts), so failures are rethrown here to keep it.
 */
export async function runInit(
  target: string,
  opts: { planOnly?: boolean } = {},
): Promise<PipelineResult> {
  const planOnly = opts.planOnly === true;

  const context: InstallContext = {
    target,
    args: { target, yes: true, "dry-run": planOnly },
    options: {
      planOnly,
      skipBootstrap: false,
      skipMcp: true,
      skipHooks: false,
    },
    mcpInstallMode: "global",
    claudeMcpScope: "project",
    mcpRootPolicy: { mode: "dynamic" },
    // Fixtures are always non-TTY: no wizard, no interactive prompts.
    interactive: false,
    wizardEnabled: false,
    stageResults: [],
    rollbackStack: [],
    state: { firstInstall: loadGlobalConfig(resolveGlobalRoot()) === null },
  };

  const result = await new InstallPipeline()
    .addStage(new PreflightStage())
    .addStage(new EnvStage())
    .addStage(new StoreStage())
    .addStage(new HooksStage())
    .addStage(new McpStage())
    .addStage(new ValidateStage())
    .addStage(new GuidanceStage())
    .execute(context);

  if (!result.success) {
    throw result.error ?? new Error("install pipeline failed without an error");
  }
  return result;
}

/**
 * Scaffold-only install: creates `.fabric/` (config, .gitignore, events ledger,
 * forensic snapshot) and nothing else — no skills, hooks, store or MCP wiring.
 *
 * T-2: this is the exact v2 replacement for the retired `initFabric()`, which was
 * `buildInitFabricPlan + executeInitFabricPlan` (scaffold only). Scaffolding is
 * owned by the env stage, and preflight is included because the env stage reuses
 * the forensic report preflight builds — running env alone would silently make it
 * re-walk the whole project.
 *
 * Returns the `ScaffoldResult` (same fields the old `InitScaffoldResult` exposed:
 * fabricDir / agentsMdPath+Action / eventsPath+Action / forensicPath+Action /
 * forensicReport).
 */
export async function runScaffoldOnly(target: string): Promise<ScaffoldResult> {
  const context: InstallContext = {
    target,
    args: { target, yes: true },
    options: {
      planOnly: false,
      skipBootstrap: true,
      skipMcp: true,
      skipHooks: true,
    },
    mcpInstallMode: "global",
    claudeMcpScope: "project",
    mcpRootPolicy: { mode: "dynamic" },
    interactive: false,
    wizardEnabled: false,
    stageResults: [],
    rollbackStack: [],
    state: { firstInstall: loadGlobalConfig(resolveGlobalRoot()) === null },
  };

  const result = await new InstallPipeline()
    .addStage(new PreflightStage())
    .addStage(new EnvStage())
    .execute(context);

  if (!result.success) {
    throw result.error ?? new Error("scaffold pipeline failed without an error");
  }
  const scaffold = result.context.state.scaffold;
  if (scaffold === undefined) {
    throw new Error("env stage completed without producing a scaffold result");
  }
  return scaffold;
}

// ---------------------------------------------------------------------------
// Installed-fixture template (T-2b)
// ---------------------------------------------------------------------------

/**
 * A real `runInit` costs ~1.0s, and 90% of that is the hooks stage writing the
 * ~175-file skill/hook/bootstrap payload (measured per-stage: preflight 40ms,
 * env 12ms, store 41ms, **hooks 910ms**, mcp/validate/guidance <5ms). The
 * install-heavy integration files ran one such install PER TEST, which is why a
 * single file was the whole suite's wall-clock long pole.
 *
 * Copying an already-installed tree costs ~33ms — 30x cheaper — and the result is
 * indistinguishable from a fresh install: a census of every installed file found
 * exactly ONE that embeds the absolute target path (`.fabric/forensic.json`, a
 * scan snapshot that install always rewrites anyway), and `cpSync` preserves the
 * owner-execute bits the hook scripts carry.
 *
 * So: install ONCE per worker process into a template root, then hand each test a
 * fresh byte-identical copy. Use this wherever a test's premise is "GIVEN an
 * installed workspace" — including re-install/idempotency tests, whose second
 * install is a genuine install over a genuine installed tree.
 *
 * Do NOT use it when the test seeds files BEFORE install (user settings to merge,
 * a pre-existing AGENTS.md, `.claude` occupied by a regular file): those assert
 * what the installer DOES on first contact, so they need a real cold install.
 */
let installedTemplate: Promise<string> | null = null;

async function resolveInstalledTemplate(): Promise<string> {
  installedTemplate ??= (async () => {
    const root = createWerewolfFixtureRoot("fab-installed-template");
    await runInit(root);
    // The template outlives every individual test file in this worker, so it is
    // reaped at process exit rather than in any one file's afterAll.
    process.on("exit", () => {
      rmSync(root, { recursive: true, force: true });
    });
    return root;
  })();
  return installedTemplate;
}

export async function createInstalledFixtureRoot(prefix: string): Promise<string> {
  const template = await resolveInstalledTemplate();
  const root = join(tmpdir(), `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  cpSync(template, root, { recursive: true });
  return root;
}

export type FsSnapshot = Record<string, string>;

/**
 * Recursively snapshot every file under `rel` (relative to `root`) into a
 * map of relative-path → utf8-content. Used by install/uninstall integration
 * tests to assert byte-identical idempotency across re-runs.
 *
 * rc.14 TASK-002 — hoisted from per-file copies. Tests now consume this
 * single implementation; parity assertions are symmetric across `.claude`
 * and `.codex`.
 */
export function snapshotTree(root: string, rel: string): FsSnapshot {
  const out: FsSnapshot = {};
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

/**
 * rc.14 TASK-002 — byte-mutate a managed file to simulate user drift. Used
 * by install-diff-mode tests to assert the drift-abort path.
 */
export function seedDriftedFile(
  root: string,
  relativePath: string,
  modifier: (original: string) => string,
): void {
  const target = join(root, ...relativePath.split("/"));
  const original = readFileSync(target, "utf8");
  writeFileSync(target, modifier(original), "utf8");
}

/**
 * rc.14 TASK-002 — delete a managed file to simulate the "missing-piece"
 * scenario diff-mode auto-applies. Used by install-diff-mode tests.
 */
export function seedMissingFile(root: string, relativePath: string): void {
  const target = join(root, ...relativePath.split("/"));
  rmSync(target, { force: true });
}

// Re-export for convenience (callers can resolve absolute paths from
// snapshot keys for assertion messages).
export { resolve };
