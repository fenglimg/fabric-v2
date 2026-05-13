import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanupFixtureRoot, createWerewolfFixtureRoot, setProcessTty } from "./helpers/init-test-utils.ts";

const tempRoots: string[] = [];
const originalFabLang = process.env.FAB_LANG;
const originalNoColor = process.env.NO_COLOR;
const originalAuthToken = process.env.FABRIC_AUTH_TOKEN;
const originalHome = process.env.HOME;
const restoreTtyMocks: Array<() => void> = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }

  while (restoreTtyMocks.length > 0) {
    restoreTtyMocks.pop()?.();
  }

  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("@fenglimg/fabric-server");

  restoreEnv("FAB_LANG", originalFabLang);
  restoreEnv("NO_COLOR", originalNoColor);
  restoreEnv("FABRIC_AUTH_TOKEN", originalAuthToken);
  restoreEnv("HOME", originalHome);
});

describe("cli i18n", () => {
  it("renders zh-CN command descriptions and output snapshots", async () => {
    const snapshot = await collectSnapshots("zh-CN");

    expect(snapshot).toMatchSnapshot();
  });

  it("renders en command descriptions and output snapshots", async () => {
    const snapshot = await collectSnapshots("en");

    expect(snapshot).toMatchSnapshot();
  });
});

async function collectSnapshots(locale: "en" | "zh-CN") {
  process.env.FAB_LANG = locale;
  process.env.NO_COLOR = "1";
  delete process.env.FABRIC_AUTH_TOKEN;

  const isolatedHome = mkdtempSync(join(tmpdir(), "fab-i18n-home-"));
  tempRoots.push(isolatedHome);
  process.env.HOME = isolatedHome;
  restoreTtyMocks.push(setProcessTty(false));

  const initTarget = trackFixture(`fab-i18n-init-${locale}`);
  vi.resetModules();
  const { initCommand } = await import("../src/commands/init.ts");
  const initOutput = await captureOutput(async () => {
    await initCommand.run?.({ args: { target: initTarget } } as never);
  });

  const scanTarget = trackFixture(`fab-i18n-scan-${locale}`);
  vi.resetModules();
  const { scanCommand } = await import("../src/commands/scan.ts");
  const scanOutput = await captureOutput(async () => {
    await scanCommand.run?.({ args: { target: scanTarget } } as never);
  });

  const serveTarget = trackFixture(`fab-i18n-serve-${locale}`);
  vi.resetModules();
  vi.doMock("@fenglimg/fabric-server", () => ({
    acquireLock: vi.fn(),
    releaseLock: vi.fn(),
    checkLockOrThrow: vi.fn(),
    startHttpServer: vi.fn().mockResolvedValue(undefined),
  }));
  const { serveCommand } = await import("../src/commands/serve.ts");
  const serveOutput = await captureOutput(async () => {
    await serveCommand.run?.({ args: { target: serveTarget, host: "0.0.0.0", port: "7373" } } as never);
  });

  // MINIMAL uninstall snapshot — description + usage help-text first line only.
  // Per plan clarification #8, uninstall stdout iterates across rc.9/10/etc.;
  // capturing full stdout would create needless snapshot churn during the
  // iteration period. Init/scan/serve continue to capture their full snapshot.
  vi.resetModules();
  const uninstallMod = await import("../src/commands/uninstall.ts");
  const uninstallCmd = uninstallMod.default;
  const usageFirstLine = `fab uninstall - ${uninstallCmd.meta?.description ?? ""}`;
  const uninstallEntry = {
    description: uninstallCmd.meta?.description ?? "",
    usage: usageFirstLine,
  };

  return sanitizeSnapshot({
    locale,
    init: {
      description: initCommand.meta.description,
      ...initOutput,
    },
    scan: {
      description: scanCommand.meta.description,
      ...scanOutput,
    },
    serve: {
      description: serveCommand.meta.description,
      ...serveOutput,
    },
    uninstall: uninstallEntry,
  });
}

function trackFixture(prefix: string): string {
  const root = createWerewolfFixtureRoot(prefix);
  tempRoots.push(root);
  return root;
}

async function captureOutput(run: () => Promise<void>) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const errors: string[] = [];

  const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    stdout.push(args.map(String).join(" "));
  });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args.map(String).join(" "));
  });
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
    stderr.push(String(chunk).replace(/\n$/, ""));
    return true;
  }) as typeof process.stderr.write);

  try {
    await run();
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    stderrSpy.mockRestore();
  }

  return { stdout, stderr, errors };
}

function sanitizeSnapshot(value: unknown): unknown {
  const replacements = tempRoots.map((root, index) => [root, `<fixture-${index + 1}>`] as const);

  if (typeof value === "string") {
    return replacements.reduce((current, [from, to]) => current.replaceAll(from, to), value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeSnapshot(entry));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, sanitizeSnapshot(child)]),
    );
  }

  return value;
}

function restoreEnv(name: "FAB_LANG" | "NO_COLOR" | "FABRIC_AUTH_TOKEN", value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
