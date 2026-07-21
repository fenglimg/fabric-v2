import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type { ProjectContextResolverInput } from "@fenglimg/fabric-shared";
import { createProjectContextResolver as createEsmContext } from "@fenglimg/fabric-shared";

const require = createRequire(import.meta.url);
const runtime = require(
  fileURLToPath(new URL("../templates/hooks/lib/project-context-runtime.cjs", import.meta.url)),
) as {
  createProjectContextResolver: (input?: ProjectContextResolverInput) => Readonly<{
    workspaceRoot: string;
    identityRoot: string;
    projectId: string;
    bindingId: string;
    source: string;
  }>;
};

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const tempDirs: string[] = [];

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
}

function createRepo(prefix: string, projectId = PROJECT_ID): string {
  const repo = makeTemp(prefix);
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "hook-runtime@fabric.local"]);
  git(repo, ["config", "user.name", "Hook Runtime Test"]);
  mkdirSync(join(repo, ".fabric"), { recursive: true });
  writeFileSync(
    join(repo, ".fabric", "fabric-config.json"),
    `${JSON.stringify({ project_id: projectId }, null, 2)}\n`,
  );
  writeFileSync(join(repo, "README.md"), "fixture\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "seed"]);
  return repo;
}

function expectContextParity(input: ProjectContextResolverInput): void {
  expect(runtime.createProjectContextResolver(input)).toEqual(createEsmContext(input));
}

function captureErrorCode(
  resolver: (input: ProjectContextResolverInput) => unknown,
  input: ProjectContextResolverInput,
): string | undefined {
  try {
    resolver(input);
    return undefined;
  } catch (error: unknown) {
    return error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : undefined;
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0).reverse()) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("shared ESM and generated hook CJS ProjectContext parity", () => {
  it("matches every context field for explicit and client-root cases", () => {
    const repo = createRepo("hook-runtime-golden-");
    expectContextParity({ explicitRoot: repo });
    expectContextParity({ roots: [repo] });
  });

  it("matches identity inheritance in a real linked worktree", () => {
    const repo = createRepo("hook-runtime-main-");
    const linkedParent = makeTemp("hook-runtime-linked-");
    const linked = join(linkedParent, "work");
    git(repo, ["worktree", "add", "-b", "linked", linked]);

    expectContextParity({ roots: [linked] });
    const context = runtime.createProjectContextResolver({ roots: [linked] });
    expect(context.workspaceRoot).not.toBe(context.identityRoot);
    expect(context.projectId).toBe(PROJECT_ID);
    expect(context.bindingId).toBe(PROJECT_ID);
    expect(context.source).toBe("client-root");
  });

  it("matches an explicit worktree binding override", () => {
    const repo = createRepo("hook-runtime-isolated-main-");
    const linkedParent = makeTemp("hook-runtime-isolated-linked-");
    const linked = join(linkedParent, "work");
    git(repo, ["worktree", "add", "-b", "isolated", linked]);
    writeFileSync(
      join(linked, ".fabric", "fabric-config.json"),
      `${JSON.stringify({ project_id: PROJECT_ID, workspace_binding_id: "isolated-hook" })}\n`,
    );

    expectContextParity({ roots: [linked] });
    expect(runtime.createProjectContextResolver({ roots: [linked] }).bindingId).toBe(
      "isolated-hook",
    );
  });

  it.each([
    ["unresolved", () => ({ cwd: makeTemp("hook-runtime-rootless-") })],
    [
      "ambiguous",
      () => ({
        roots: [
          createRepo("hook-runtime-first-", "first-project"),
          createRepo("hook-runtime-second-", "second-project"),
        ],
      }),
    ],
  ])("matches the typed %s error code", (_name, makeInput) => {
    const input = makeInput() as ProjectContextResolverInput;
    expect(captureErrorCode(runtime.createProjectContextResolver, input)).toBe(
      captureErrorCode(createEsmContext, input),
    );
  });
});
