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

import {
  buildInitExecutionPlan,
  executeInitExecutionPlan,
  type InitExecutionResult,
} from "../../src/commands/install.ts";

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
        delete (stream as NodeJS.WriteStream & { isTTY?: boolean }).isTTY;
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
 * Drive `fabric install` end-to-end via the public execution-plan API but skip
 * the MCP stage — local MCP install would try to write outside the fixture
 * (npm install, global config) which is out of scope for fixture-based
 * install tests. Bootstrap (skill + hook + per-client configs + pointer) and
 * hooks stages run normally.
 */
export async function runInit(
  target: string,
  opts: { planOnly?: boolean } = {},
): Promise<InitExecutionResult> {
  const plan = await buildInitExecutionPlan({
    target,
    options: {
      skipMcp: true,
      planOnly: opts.planOnly,
    },
    interactive: false,
  });
  return executeInitExecutionPlan(plan);
}

export type FsSnapshot = Record<string, string>;

/**
 * Recursively snapshot every file under `rel` (relative to `root`) into a
 * map of relative-path → utf8-content. Used by install/uninstall integration
 * tests to assert byte-identical idempotency across re-runs.
 *
 * rc.14 TASK-002 — hoisted from per-file copies. Tests now consume this
 * single implementation; cursor parity assertions (`.cursor` snapshots) are
 * symmetric with `.claude` and `.codex` for the first time.
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
