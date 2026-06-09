import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InstallContext } from "../src/install/pipeline/types.js";

const mockState = vi.hoisted(() => ({
  gitUnavailable: false,
  writeFailurePrefixes: [] as string[],
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(() => {
    if (mockState.gitUnavailable) {
      throw new Error("spawn git ENOENT");
    }
    return Buffer.from("git version 2.0.0");
  }),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    writeFileSync: vi.fn((path: import("node:fs").PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: unknown) => {
      const pathText = String(path);
      if (mockState.writeFailurePrefixes.some((prefix) => pathText.startsWith(prefix))) {
        throw new Error("EACCES: permission denied");
      }
      return actual.writeFileSync(path, data, options as Parameters<typeof actual.writeFileSync>[2]);
    }),
  };
});

const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { PreflightStage } = await import("../src/install/pipeline/preflight.stage.js");

const dirs: string[] = [];
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function createContext(target: string, args: Record<string, unknown> = {}): InstallContext {
  return {
    target,
    args: { target, ...args },
    options: {},
    mcpInstallMode: "global",
    claudeMcpScope: "user",
    interactive: false,
    wizardEnabled: false,
    stageResults: [],
    rollbackStack: [],
    state: {},
  } as InstallContext;
}

beforeEach(() => {
  mockState.gitUnavailable = false;
  mockState.writeFailurePrefixes = [];
  process.env.HOME = tmp("fabric-preflight-home-");
  delete process.env.USERPROFILE;
});

afterEach(() => {
  process.env.HOME = originalHome;
  if (originalUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = originalUserProfile;
  }
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("install v2 PreflightStage", () => {
  it("fails before mutation when the target directory is not writable", async () => {
    const target = tmp("fabric-preflight-target-");
    mockState.writeFailurePrefixes = [target];

    const result = await new PreflightStage().execute(createContext(target));

    expect(result.disposition).toBe("failed");
    expect(result.errors[0]).toContain("Target is not writable");
  });

  it("fails when the global root already exists as a file", async () => {
    const target = tmp("fabric-preflight-target-");
    const globalRoot = join(process.env.HOME as string, ".fabric");
    fs.writeFileSync(globalRoot, "not a directory", "utf8");

    const result = await new PreflightStage().execute(createContext(target));

    expect(result.disposition).toBe("failed");
    expect(result.errors[0]).toContain("Global Fabric root is not a directory");
  });

  it("fails when no home directory can be resolved", async () => {
    const target = tmp("fabric-preflight-target-");
    delete process.env.HOME;
    delete process.env.USERPROFILE;

    const result = await new PreflightStage().execute(createContext(target));

    expect(result.disposition).toBe("failed");
    expect(result.errors[0]).toContain("Cannot determine home directory");
  });

  it("fails early for --url installs when git is unavailable", async () => {
    const target = tmp("fabric-preflight-target-");
    mockState.gitUnavailable = true;

    const result = await new PreflightStage().execute(createContext(target, { url: "https://example.com/team.git" }));

    expect(result.disposition).toBe("failed");
    expect(result.errors[0]).toContain("git is required for --url installs");
  });
});
