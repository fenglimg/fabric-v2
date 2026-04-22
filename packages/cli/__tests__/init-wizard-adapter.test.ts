import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.FAB_LANG;
});

describe("init wizard adapter clack flow", () => {
  it("emits intro, grouped planning steps, and outro on success", async () => {
    process.env.FAB_LANG = "en";
    const introMock = vi.fn();
    const noteMock = vi.fn();
    const outroMock = vi.fn();
    const cancelMock = vi.fn();
    const logStepMock = vi.fn();
    const confirmMock = vi.fn().mockResolvedValue(true);
    const groupMock = vi.fn().mockResolvedValue({
      bootstrap: true,
      mcp: true,
      hooks: false,
      mcpInstallMode: "local",
    });

    vi.doMock("@clack/prompts", () => ({
      intro: introMock,
      note: noteMock,
      outro: outroMock,
      cancel: cancelMock,
      confirm: confirmMock,
      group: groupMock,
      select: vi.fn(),
      log: { step: logStepMock },
      isCancel: vi.fn().mockReturnValue(false),
    }));

    const { createDefaultInitWizardAdapter } = await import("../src/commands/init.ts");
    const adapter = createDefaultInitWizardAdapter();

    const result = await adapter.run({
      target: "/tmp/fabric-target",
      options: { reapply: true },
      supports: [],
      mcpInstallMode: "global",
      lockedStages: [],
    });

    expect(result).toEqual({
      bootstrap: true,
      mcp: true,
      hooks: false,
      mcpInstallMode: "local",
    });
    expect(introMock).toHaveBeenCalledWith("Fabric init");
    expect(noteMock).toHaveBeenCalledWith(expect.stringContaining("Mode: REAPPLY"), "Install overview");
    expect(logStepMock).toHaveBeenNthCalledWith(1, "Confirm target");
    expect(logStepMock).toHaveBeenNthCalledWith(2, "Shape init plan");
    expect(logStepMock).toHaveBeenNthCalledWith(3, "Review final plan");
    expect(groupMock).toHaveBeenCalledTimes(1);
    expect(outroMock).toHaveBeenCalledWith("Init plan accepted. Running Fabric init...");
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it("emits a unified cancel flow when grouped planning is cancelled", async () => {
    process.env.FAB_LANG = "en";
    const introMock = vi.fn();
    const noteMock = vi.fn();
    const outroMock = vi.fn();
    const cancelMock = vi.fn();
    const logStepMock = vi.fn();
    const confirmMock = vi.fn().mockResolvedValue(true);
    const groupMock = vi.fn(async (_prompts: unknown, opts?: { onCancel?: (args: { results: object }) => void }) => {
      opts?.onCancel?.({ results: {} });
      return undefined;
    });

    vi.doMock("@clack/prompts", () => ({
      intro: introMock,
      note: noteMock,
      outro: outroMock,
      cancel: cancelMock,
      confirm: confirmMock,
      group: groupMock,
      select: vi.fn(),
      log: { step: logStepMock },
      isCancel: vi.fn().mockReturnValue(false),
    }));

    const { createDefaultInitWizardAdapter } = await import("../src/commands/init.ts");
    const adapter = createDefaultInitWizardAdapter();

    const result = await adapter.run({
      target: "/tmp/fabric-target",
      options: {},
      supports: [],
      mcpInstallMode: "global",
      lockedStages: [],
    });

    expect(result).toBeNull();
    expect(introMock).toHaveBeenCalledWith("Fabric init");
    expect(logStepMock).toHaveBeenNthCalledWith(1, "Confirm target");
    expect(logStepMock).toHaveBeenNthCalledWith(2, "Shape init plan");
    expect(cancelMock).toHaveBeenCalledWith("Fabric init cancelled before execution.");
    expect(outroMock).not.toHaveBeenCalled();
  });
});
