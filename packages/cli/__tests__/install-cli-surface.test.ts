import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanupFixtureRoot,
  createWerewolfFixtureRoot,
  setProcessTty,
} from "./helpers/init-test-utils.ts";
import { installCommand, resolveMcpRootPolicy } from "../src/commands/install-v2.js";

// Reader-consumed fields enumerated in init.ts writeDefaultFabricConfig.
// Source-of-truth: packages/shared/src/schemas/fabric-config.ts +
// packages/cli/templates/hooks/fabric-hint.cjs reader helpers. If a new
// reader is added in the future, add the field here too.
const EXPECTED_FABRIC_CONFIG_FIELDS = [
  // grill-6fixes (D1): `fabric_language` is no longer scaffolded into the
  // project config — language is a single machine-wide tone in
  // ~/.fabric/fabric-global.json.
  // ux-w1-9: nudge_mode master switch is scaffolded into the shipped config.
  "nudge_mode",
  "archive_hint_hours",
  "archive_hint_cooldown_hours",
  "review_hint_pending_count",
  "review_hint_pending_age_days",
  "maintenance_hint_days",
  "maintenance_hint_cooldown_days",
  "archive_edit_threshold",
  "underseed_node_threshold",
] as const;

const tempRoots: string[] = [];
const restoreTtyMocks: Array<() => void> = [];
// Capture the ambient FAB_LANG so the per-test `process.env.FAB_LANG = "en"`
// overrides below never leak into OTHER test files' locale resolution (the
// translator reads this env at import time). Restored in afterEach.
let originalFabLang: string | undefined;

beforeEach(() => {
  originalFabLang = process.env.FAB_LANG;
});

afterEach(() => {
  while (restoreTtyMocks.length > 0) {
    restoreTtyMocks.pop()?.();
  }

  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }

  if (originalFabLang === undefined) {
    delete process.env.FAB_LANG;
  } else {
    process.env.FAB_LANG = originalFabLang;
  }

  vi.restoreAllMocks();
  vi.resetModules();
});

describe("init CLI surface", () => {
  it("exposes dynamic MCP root defaults and validates pinned combinations", () => {
    expect(installCommand.args?.["mcp-root-mode"]).toBeDefined();
    expect(installCommand.args?.["mcp-project-root"]).toBeDefined();
    expect(resolveMcpRootPolicy({})).toEqual({ mode: "dynamic" });
    expect(resolveMcpRootPolicy({ "mcp-root-mode": "pinned", "mcp-project-root": "/tmp/project/.." })).toEqual({
      mode: "pinned",
      projectRoot: "/tmp",
      provenance: "operator",
    });
    expect(() => resolveMcpRootPolicy({ "mcp-root-mode": "unknown" })).toThrow(/Invalid/);
    expect(() => resolveMcpRootPolicy({ "mcp-root-mode": "pinned" })).toThrow(/required/);
    expect(() => resolveMcpRootPolicy({ "mcp-project-root": "relative" })).toThrow(/requires/);
    expect(() => resolveMcpRootPolicy({ "mcp-root-mode": "pinned", "mcp-project-root": "relative" })).toThrow(/absolute/);
  });

  it("does not write scaffold files when --dry-run is used", async () => {
    process.env.FAB_LANG = "en";
    const target = createWerewolfFixtureRoot("fab-init-plan-acceptance");
    tempRoots.push(target);

    const { installCommand } = await import("../src/commands/install.ts");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      void chunk;
      return true;
    }) as typeof process.stderr.write);

    await installCommand.run?.({
      args: {
        target,
        "dry-run": true,
        yes: true,
      },
    } as never);

    // rc.15: --dry-run does not write any scaffold artifacts.
    expect(existsSync(`${target}/.fabric/agents.meta.json`)).toBe(false);
    expect(existsSync(`${target}/.fabric/forensic.json`)).toBe(false);
    expect(existsSync(`${target}/.fabric/knowledge`)).toBe(false);
  });

  // rc.15 (formerly rc.14 TASK-002): default `fabric install` on an existing
  // canonical workspace is a no-op success — no throws, the canonical
  // confirmation banner is emitted.
  it("default install on existing canonical workspace is a no-op success", async () => {
    process.env.FAB_LANG = "en";
    const target = createWerewolfFixtureRoot("fab-init-canonical-noop");
    tempRoots.push(target);

    const { runInit } = await import("./helpers/init-test-utils.ts");
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      stdoutLines.push(String(message ?? ""));
    });
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      stderrLines.push(String(chunk).replace(/\n$/, ""));
      return true;
    }) as typeof process.stderr.write);

    // First install via runInit helper (skips mcp stage to keep test fast).
    await runInit(target);

    stdoutLines.length = 0;
    stderrLines.length = 0;

    // Second install — must succeed via canonical-no-op short-circuit.
    let secondRunError: unknown = null;
    try {
      await runInit(target);
    } catch (e) {
      secondRunError = e;
    }
    expect(secondRunError).toBeNull();

    // Canonical confirmation banner is visible in stdout.
    const allOutput = [...stdoutLines, ...stderrLines].join("\n");
    expect(allOutput).toMatch(/Workspace already canonical/);
  });

  it("renders dry-run preview when --dry-run is used in a TTY context", async () => {
    process.env.FAB_LANG = "en";
    const target = createWerewolfFixtureRoot("fab-init-cli-surface");
    tempRoots.push(target);

    const { installCommand } = await import("../src/commands/install.ts");
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      stdout.push(String(message ?? ""));
    });
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      stderr.push(String(chunk).replace(/\n$/, ""));
      return true;
    }) as typeof process.stderr.write);
    restoreTtyMocks.push(setProcessTty(true));

    await installCommand.run?.({
      args: {
        target,
        "dry-run": true,
      },
    } as never);

    expect(stdout.some((line) => line.includes("Fabric install dry run"))).toBe(true);
    // Wizard is suppressed under --dry-run (planOnly disables the wizard).
    expect(stdout.some((line) => line.includes("Install bootstrap templates?"))).toBe(false);
    // Silence linter about unused stderr capture — the bucket is here in case
    // future dry-run noise lands on stderr and needs to be asserted.
    void stderr;
  });
});

describe("init CLI surface — fabric-config.json scaffold (TASK-003)", () => {
  it("test_init_creates_fabric_config_json_with_all_known_fields", async () => {
    const target = createWerewolfFixtureRoot("fab-init-config-fresh");
    tempRoots.push(target);

    const { initFabric } = await import("../src/commands/install.ts");
    await initFabric(target);

    const configPath = join(target, ".fabric", "fabric-config.json");
    expect(existsSync(configPath)).toBe(true);
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    for (const field of EXPECTED_FABRIC_CONFIG_FIELDS) {
      expect(parsed, `missing field ${field}`).toHaveProperty(field);
    }
    // Verify the documented defaults explicitly so a silent default-shift
    // is caught by the test. grill-6fixes (D1): the project config no longer
    // carries `fabric_language` — language is global now.
    expect(parsed).not.toHaveProperty("fabric_language");
    expect(parsed.archive_hint_hours).toBe(24);
    expect(parsed.archive_hint_cooldown_hours).toBe(12);
    expect(parsed.review_hint_pending_count).toBe(10);
    expect(parsed.review_hint_pending_age_days).toBe(7);
    expect(parsed.maintenance_hint_days).toBe(14);
    expect(parsed.maintenance_hint_cooldown_days).toBe(7);
    expect(parsed.archive_edit_threshold).toBe(20);
    expect(parsed.underseed_node_threshold).toBe(10);
  });

  it("test_init_does_not_overwrite_existing_fabric_config_json", async () => {
    const target = createWerewolfFixtureRoot("fab-init-config-preserved");
    tempRoots.push(target);

    const { initFabric } = await import("../src/commands/install.ts");
    await initFabric(target);

    // User edits the file: changes one field, removes another, adds a custom field.
    const configPath = join(target, ".fabric", "fabric-config.json");
    const userEdited = {
      review_hint_pending_count: 25,
      custom_user_field: "user-was-here",
      // Note: deliberately omitting most fields to verify NO merge occurs.
    };
    writeFileSync(configPath, JSON.stringify(userEdited, null, 2) + "\n", "utf8");
    const beforeMtime = statSync(configPath).mtimeMs;
    const beforeContent = readFileSync(configPath, "utf8");

    await initFabric(target);

    const afterContent = readFileSync(configPath, "utf8");
    expect(afterContent).toBe(beforeContent);
    const afterParsed = JSON.parse(afterContent) as Record<string, unknown>;
    expect(afterParsed.review_hint_pending_count).toBe(25);
    expect(afterParsed.custom_user_field).toBe("user-was-here");
    // Verify NO merge — schema fields the user removed are NOT re-added.
    expect(afterParsed).not.toHaveProperty("archive_hint_hours");
    expect(afterParsed).not.toHaveProperty("fabric_language");
    // Mtime unchanged (no write happened).
    expect(statSync(configPath).mtimeMs).toBe(beforeMtime);
  });

  it("test_reinstall_preserves_existing_fabric_config_json", async () => {
    const target = createWerewolfFixtureRoot("fab-init-config-reapply");
    tempRoots.push(target);

    const { initFabric } = await import("../src/commands/install.ts");
    await initFabric(target);

    const configPath = join(target, ".fabric", "fabric-config.json");
    const customised = { review_hint_pending_count: 99, fabric_language: "en" };
    writeFileSync(configPath, JSON.stringify(customised, null, 2) + "\n", "utf8");
    const beforeContent = readFileSync(configPath, "utf8");

    await initFabric(target);

    const afterContent = readFileSync(configPath, "utf8");
    expect(afterContent).toBe(beforeContent);
  });

  it("test_init_does_not_write_import_requested_sentinel", async () => {
    const target = createWerewolfFixtureRoot("fab-init-no-sentinel");
    tempRoots.push(target);

    const { initFabric } = await import("../src/commands/install.ts");
    await initFabric(target);

    const sentinelPath = join(target, ".fabric", ".import-requested");
    expect(existsSync(sentinelPath)).toBe(false);
  });

  it("test_init_does_not_show_sentinel_clack_confirm_prompt", async () => {
    process.env.FAB_LANG = "en";
    const target = createWerewolfFixtureRoot("fab-init-no-sentinel-prompt");
    tempRoots.push(target);

    const confirmCalls: Array<{ message: string }> = [];

    vi.doMock("@clack/prompts", () => ({
      intro: vi.fn(),
      note: vi.fn(),
      outro: vi.fn(),
      cancel: vi.fn(),
      confirm: vi.fn(async (opts: { message: string; initialValue?: boolean }) => {
        confirmCalls.push({ message: opts.message });
        return opts.initialValue ?? false;
      }),
      group: vi.fn(),
      select: vi.fn(),
      log: { step: vi.fn(), success: vi.fn(), info: vi.fn() },
      isCancel: vi.fn().mockReturnValue(false),
    }));

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      void chunk;
      return true;
    }) as typeof process.stderr.write);

    vi.resetModules();
    const { runInitCommand } = await import("../src/commands/install.ts");
    await runInitCommand({ target, yes: true });

    // The retired sentinel prompt MUST NOT appear among any confirm() calls.
    const sentinelPromptShown = confirmCalls.some((c) =>
      c.message.includes("下次开 AI 时让我从 git log 抽更多知识吗"),
    );
    expect(sentinelPromptShown).toBe(false);

    vi.doUnmock("@clack/prompts");
  });
});
