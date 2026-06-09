import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanupFixtureRoot, createWerewolfFixtureRoot, setProcessTty } from "./helpers/init-test-utils.ts";

const tempRoots: string[] = [];
const originalFabLang = process.env.FAB_LANG;
const originalNoColor = process.env.NO_COLOR;
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

  const isolatedHome = mkdtempSync(join(tmpdir(), "fab-i18n-home-"));
  tempRoots.push(isolatedHome);
  process.env.HOME = isolatedHome;
  restoreTtyMocks.push(setProcessTty(false));

  const installTarget = trackFixture(`fab-i18n-install-${locale}`);
  vi.resetModules();
  const { installCommand } = await import("../src/commands/install.ts");
  const installOutput = await captureOutput(async () => {
    await installCommand.run?.({ args: { target: installTarget } } as never);
  });

  // rc.23 TASK-012 (F8a): legacy baseline scan paths were removed clean-slate;
  // KB on fresh install is empty by design.
  // rc.15 TASK-004 (C9): capture `fabric config` placeholder output as the replacement
  // i18n snapshot — locks the rc.16 placeholder string in en + zh-CN.
  // Pass an explicit UNINITIALIZED target so this snapshot is hermetic.
  // Previously `args: {}` defaulted config's workspaceRoot to process.cwd();
  // when the suite runs from a dogfooded Fabric repo root (which has a tracked
  // .fabric/fabric-config.json), config's uninit gate is bypassed and it emits
  // the "requires an interactive terminal" message instead of the expected
  // "workspace not initialized" — cwd-dependent snapshot drift. A bare temp dir
  // has no .fabric/, so the uninit gate fires deterministically regardless of
  // where vitest is launched.
  const configUninitTarget = mkdtempSync(join(tmpdir(), "fab-i18n-config-"));
  tempRoots.push(configUninitTarget);
  vi.resetModules();
  const { configCmd } = await import("../src/commands/config.ts");
  const configOutput = await captureOutput(async () => {
    await configCmd.run?.({ args: { target: configUninitTarget } } as never);
  });

  // v2.0.0-rc.37 Wave A2: `fabric serve` snapshot removed alongside the
  // command's quarantine (per [[fabric-serve-quarantine-not-delete]]). The
  // serve i18n strings remain in locales for backward-compat consumers but
  // are no longer reachable via the main CLI surface — see
  // packages/server-http-experimental/README.md for the restoration recipe.

  // MINIMAL uninstall snapshot — description + usage help-text first line only.
  // Per plan clarification #8, uninstall stdout iterates across rc.9/10/etc.;
  // capturing full stdout would create needless snapshot churn during the
  // iteration period. Init/scan/serve continue to capture their full snapshot.
  vi.resetModules();
  const uninstallMod = await import("../src/commands/uninstall.ts");
  const uninstallCmd = uninstallMod.default;
  const usageFirstLine = `fabric uninstall - ${uninstallCmd.meta?.description ?? ""}`;
  const uninstallEntry = {
    description: uninstallCmd.meta?.description ?? "",
    usage: usageFirstLine,
  };

  return sanitizeSnapshot({
    locale,
    install: {
      description: installCommand.meta.description,
      ...installOutput,
    },
    config: {
      description: configCmd.meta?.description,
      ...configOutput,
    },
    // serve snapshot removed in v2.0.0-rc.37 Wave A2 (quarantine).
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
    const withoutTempRoots = replacements.reduce((current, [from, to]) => current.replaceAll(from, to), value);
    return withoutTempRoots.replace(/\buid u-(?:anon|[0-9a-f]{12})\b/g, "uid <uid>");
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

function restoreEnv(name: "FAB_LANG" | "NO_COLOR" | "HOME", value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
