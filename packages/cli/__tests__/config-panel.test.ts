import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// rc.16 TASK-007 (F1-tests): coverage for the `fab config` clack TUI panel.
// Tests mock @clack/prompts and exercise configCmd.run() end-to-end against
// fixture workspaces with isolated `.fabric/fabric-config.json` state.
//
// Scenarios covered (per TASK-007.json convergence criteria):
//   1. Uninit error gate — stderr + exitCode 1 when .fabric/ absent
//   2. Atomic write — no .tmp leftover after successful edit
//   3. Enum field roundtrip — fabric_language picker writes new value
//   4. Int field roundtrip — archive_hint_hours text-input writes new value
//   5. Validation rejection — getPanelFields() validators reject bad input
//   6. Exit path — selecting __exit__ from menu writes nothing
//   7. installMcpClients export preserved (TASK-006 contract guard)

const cancelMock = vi.fn();
const introMock = vi.fn();
const outroMock = vi.fn();
const isCancelMock = vi.fn((value: unknown) => value === Symbol.for("clack:cancel"));
const selectMock = vi.fn();
const textMock = vi.fn();
const logSuccessMock = vi.fn();
const logErrorMock = vi.fn();
const logWarnMock = vi.fn();

vi.mock("@clack/prompts", () => ({
  cancel: (...args: unknown[]) => cancelMock(...args),
  intro: (...args: unknown[]) => introMock(...args),
  outro: (...args: unknown[]) => outroMock(...args),
  isCancel: (value: unknown) => isCancelMock(value),
  select: (opts: unknown) => selectMock(opts),
  text: (opts: unknown) => textMock(opts),
  log: {
    success: (...args: unknown[]) => logSuccessMock(...args),
    error: (...args: unknown[]) => logErrorMock(...args),
    warn: (...args: unknown[]) => logWarnMock(...args),
  },
}));

const tempRoots: string[] = [];

function makeWorkspace(initialized: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "fab-config-panel-"));
  tempRoots.push(dir);
  if (initialized) {
    mkdirSync(join(dir, ".fabric"), { recursive: true });
    writeFileSync(
      join(dir, ".fabric", "fabric-config.json"),
      JSON.stringify({ fabric_language: "zh-CN", archive_hint_hours: 24 }, null, 2),
      "utf8",
    );
  }
  return dir;
}

function readConfig(dir: string): Record<string, unknown> {
  const raw = readFileSync(join(dir, ".fabric", "fabric-config.json"), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

beforeEach(() => {
  cancelMock.mockReset();
  introMock.mockReset();
  outroMock.mockReset();
  isCancelMock.mockClear();
  selectMock.mockReset();
  textMock.mockReset();
  logSuccessMock.mockReset();
  logErrorMock.mockReset();
  logWarnMock.mockReset();
  process.exitCode = 0;
  // Force interactive mode for every test — config.ts gates on TTY checks
  // and we are deliberately driving the menu loop via mocked prompts.
  // isTTY is undefined under vitest's stdin/out/err by default, so we use
  // Object.defineProperty (spyOn fails on undefined accessors).
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
});

afterEach(() => {
  Object.defineProperty(process.stdin, "isTTY", { value: undefined, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: undefined, configurable: true });
  Object.defineProperty(process.stderr, "isTTY", { value: undefined, configurable: true });
  vi.restoreAllMocks();
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

async function loadConfigCmd() {
  const mod = await import("../src/commands/config.js");
  return mod.configCmd;
}

describe("rc.16 TASK-007: fab config panel — uninit gate", () => {
  it("exits 1 with stderr error when .fabric/ is absent", async () => {
    const configCmd = await loadConfigCmd();
    const dir = makeWorkspace(false);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await configCmd.run!({ args: { target: dir }, rawArgs: [], cmd: configCmd, data: undefined });

    expect(process.exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(introMock).not.toHaveBeenCalled();
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("exits 1 when .fabric/ exists but fabric-config.json is missing", async () => {
    const configCmd = await loadConfigCmd();
    const dir = makeWorkspace(false);
    mkdirSync(join(dir, ".fabric"), { recursive: true });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await configCmd.run!({ args: { target: dir }, rawArgs: [], cmd: configCmd, data: undefined });

    expect(process.exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalledTimes(1);
  });
});

describe("rc.16 TASK-007: fab config panel — exit path", () => {
  it("EXIT_CHOICE from top menu writes nothing and calls outro-no-changes", async () => {
    const configCmd = await loadConfigCmd();
    const dir = makeWorkspace(true);
    const beforeJson = readConfig(dir);

    selectMock.mockResolvedValueOnce("__exit__");

    await configCmd.run!({ args: { target: dir }, rawArgs: [], cmd: configCmd, data: undefined });

    expect(introMock).toHaveBeenCalledTimes(1);
    expect(outroMock).toHaveBeenCalledTimes(1);
    expect(readConfig(dir)).toEqual(beforeJson);
    expect(logSuccessMock).not.toHaveBeenCalled();
  });
});

describe("rc.16 TASK-007: fab config panel — Group A enum field roundtrip", () => {
  it("editing fabric_language to 'en' writes the new value and leaves no .tmp residue", async () => {
    const configCmd = await loadConfigCmd();
    const dir = makeWorkspace(true);

    // Sequence: top menu picks fabric_language → field-prompt picks 'en' → top
    // menu picks __exit__.
    selectMock
      .mockResolvedValueOnce("fabric_language")
      .mockResolvedValueOnce("en")
      .mockResolvedValueOnce("__exit__");

    await configCmd.run!({ args: { target: dir }, rawArgs: [], cmd: configCmd, data: undefined });

    const after = readConfig(dir);
    expect(after.fabric_language).toBe("en");
    expect(after.archive_hint_hours).toBe(24);

    // Atomic write contract: no .tmp leftovers anywhere under .fabric/
    const fabricFiles = readdirSync(join(dir, ".fabric"));
    expect(fabricFiles.filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
    expect(logSuccessMock).toHaveBeenCalled();
  });
});

describe("rc.16 TASK-007: fab config panel — Group B int field roundtrip", () => {
  it("editing archive_hint_hours to '48' writes 48 (number, not string)", async () => {
    const configCmd = await loadConfigCmd();
    const dir = makeWorkspace(true);

    selectMock
      .mockResolvedValueOnce("archive_hint_hours")
      .mockResolvedValueOnce("__exit__");
    textMock.mockResolvedValueOnce("48");

    await configCmd.run!({ args: { target: dir }, rawArgs: [], cmd: configCmd, data: undefined });

    const after = readConfig(dir);
    expect(after.archive_hint_hours).toBe(48);
    expect(typeof after.archive_hint_hours).toBe("number");

    // No .tmp leftover
    const fabricFiles = readdirSync(join(dir, ".fabric"));
    expect(fabricFiles.filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
  });
});

describe("rc.16 TASK-007: panel field validators reject invalid input", () => {
  it("getPanelFields() validators reject 0 / negative / NaN / empty / float for positive-integer fields", async () => {
    const { getPanelFields } = await import("@fenglimg/fabric-shared");
    const intField = getPanelFields().find(
      (f) => f.key === "archive_hint_hours",
    );
    expect(intField).toBeDefined();
    expect(intField!.widget).toBe("text");

    const validator = intField!.validate.bind(intField!);
    expect(validator("0").ok).toBe(false);
    expect(validator("-1").ok).toBe(false);
    expect(validator("abc").ok).toBe(false);
    expect(validator("").ok).toBe(false);
    expect(validator("1.5").ok).toBe(false);

    // Sanity: a valid positive integer accepts.
    expect(validator("48").ok).toBe(true);
  });

  it("getPanelFields() validators accept enum members and reject non-members for enum fields", async () => {
    const { getPanelFields } = await import("@fenglimg/fabric-shared");
    const enumField = getPanelFields().find((f) => f.key === "fabric_language");
    expect(enumField).toBeDefined();
    expect(enumField!.widget).toBe("select");

    const validator = enumField!.validate.bind(enumField!);
    expect(validator("en").ok).toBe(true);
    expect(validator("zh-CN").ok).toBe(true);
    expect(validator("fr-FR").ok).toBe(false);
    expect(validator("").ok).toBe(false);
  });
});

describe("rc.16 TASK-007: installMcpClients export contract (TASK-006 guard)", () => {
  it("config.ts still exports installMcpClients as a function (install.ts re-import contract)", async () => {
    const mod = await import("../src/commands/config.js");
    expect(typeof mod.installMcpClients).toBe("function");
  });
});
