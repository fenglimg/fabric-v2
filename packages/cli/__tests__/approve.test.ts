import { afterEach, describe, expect, it, vi } from "vitest";

const originalExitCode = process.exitCode;

const driftEntry = {
  file: "src/app.ts",
  start_line: 3,
  end_line: 5,
  hash: "sha256:expected000000000000000000000000000000000000000000000000000000000",
  current_hash: "sha256:current0000000000000000000000000000000000000000000000000000000000",
  drift: true,
};

const approvedEntry = {
  file: "src/ok.ts",
  start_line: 1,
  end_line: 2,
  hash: "sha256:same000000000000000000000000000000000000000000000000000000000000",
  current_hash: "sha256:same000000000000000000000000000000000000000000000000000000000000",
  drift: false,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("@fenglimg/fabric-server");
  vi.doUnmock("node:readline/promises");
  process.exitCode = originalExitCode;
});

describe("approve command", () => {
  it("approves every drift entry in --all mode", async () => {
    const approveHumanLock = vi.fn().mockResolvedValue({ updated: true, entry: driftEntry });
    vi.doMock("@fenglimg/fabric-server", () => ({
      readHumanLock: vi.fn().mockResolvedValue([driftEntry, approvedEntry]),
      approveHumanLock,
    }));
    const stdout = captureStdout();

    const { approveCommand } = await import("../src/commands/approve.ts");
    await approveCommand.run?.({ args: { target: "/tmp/project", all: true, interactive: false } } as never);

    stdout.restore();
    expect(approveHumanLock).toHaveBeenCalledTimes(1);
    expect(approveHumanLock).toHaveBeenCalledWith("/tmp/project", {
      file: "src/app.ts",
      start_line: 3,
      end_line: 5,
      new_hash: driftEntry.current_hash,
    });
    expect(stdout.lines.join("\n")).toMatch(/1\/1/);
    expect(stdout.lines.join("\n")).toMatch(/0/);
  });

  it("exits cleanly when no drift entries are found", async () => {
    const approveHumanLock = vi.fn();
    vi.doMock("@fenglimg/fabric-server", () => ({
      readHumanLock: vi.fn().mockResolvedValue([approvedEntry]),
      approveHumanLock,
    }));
    const stdout = captureStdout();

    const { approveCommand } = await import("../src/commands/approve.ts");
    await approveCommand.run?.({ args: { target: "/tmp/project", all: true, interactive: false } } as never);

    stdout.restore();
    expect(approveHumanLock).not.toHaveBeenCalled();
    expect(stdout.lines.join("\n")).toMatch(/No drift entries found|未发现漂移记录/);
    expect(process.exitCode).toBe(originalExitCode);
  });

  it("prompts per drift entry and only approves yes answers in interactive mode", async () => {
    const secondDrift = {
      ...driftEntry,
      file: "src/other.ts",
      start_line: 10,
      end_line: 12,
      current_hash: "sha256:other00000000000000000000000000000000000000000000000000000000000",
    };
    const approveHumanLock = vi.fn().mockResolvedValue({ updated: true, entry: driftEntry });
    const question = vi.fn().mockResolvedValueOnce("y").mockResolvedValueOnce("n");
    const close = vi.fn();

    vi.doMock("@fenglimg/fabric-server", () => ({
      readHumanLock: vi.fn().mockResolvedValue([driftEntry, secondDrift]),
      approveHumanLock,
    }));
    vi.doMock("node:readline/promises", () => ({
      createInterface: vi.fn(() => ({ question, close })),
    }));
    const stdout = captureStdout();

    const { approveCommand } = await import("../src/commands/approve.ts");
    await approveCommand.run?.({ args: { target: "/tmp/project", all: false, interactive: true } } as never);

    stdout.restore();
    expect(question).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
    expect(approveHumanLock).toHaveBeenCalledTimes(1);
    expect(approveHumanLock).toHaveBeenCalledWith("/tmp/project", expect.objectContaining({ file: "src/app.ts" }));
    expect(stdout.lines.join("\n")).toContain("src/app.ts:3-5");
    expect(stdout.lines.join("\n")).toContain("src/other.ts:10-12");
    expect(stdout.lines.join("\n")).toMatch(/1\/2/);
  });

  it("prints usage and sets a non-zero exit code when no mode flag is provided", async () => {
    vi.doMock("@fenglimg/fabric-server", () => ({
      readHumanLock: vi.fn(),
      approveHumanLock: vi.fn(),
    }));
    const stdout = captureStdout();

    const { approveCommand } = await import("../src/commands/approve.ts");
    await approveCommand.run?.({ args: { target: "/tmp/project", all: false, interactive: false } } as never);

    stdout.restore();
    expect(stdout.lines.join("\n")).toContain("USAGE");
    expect(stdout.lines.join("\n")).toContain("--all");
    expect(stdout.lines.join("\n")).toContain("--interactive");
    expect(process.exitCode).toBe(1);
  });
});

function captureStdout(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
    lines.push(String(chunk).replace(/\n$/, ""));
    return true;
  }) as typeof process.stdout.write);

  return {
    lines,
    restore: () => {
      spy.mockRestore();
    },
  };
}
