import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanupFixtureRoot,
  createWerewolfFixtureRoot,
  readFixtureFile,
  setProcessTty,
  writeFixtureFile,
} from "./helpers/init-test-utils.ts";

// Reader-consumed fields enumerated in init.ts writeDefaultFabricConfig.
// Source-of-truth: packages/shared/src/schemas/fabric-config.ts +
// packages/cli/templates/hooks/fabric-hint.cjs reader helpers. If a new
// reader is added in the future, add the field here too.
const EXPECTED_FABRIC_CONFIG_FIELDS = [
  "knowledge_language",
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

afterEach(() => {
  while (restoreTtyMocks.length > 0) {
    restoreTtyMocks.pop()?.();
  }

  while (tempRoots.length > 0) {
    cleanupFixtureRoot(tempRoots.pop() as string);
  }

  vi.restoreAllMocks();
  vi.resetModules();
});

describe("init CLI surface", () => {
  it("treats --reapply as a canonical forceful rerun", async () => {
    const target = createWerewolfFixtureRoot("fab-init-reapply");
    tempRoots.push(target);

    const { buildInitExecutionPlan } = await import("../src/commands/init.ts");
    const plan = await buildInitExecutionPlan({
      target,
      options: { force: true, reapply: true },
      mcpInstallMode: "global",
      interactive: false,
    });

    expect(plan.options.force).toBe(true);
    expect(plan.options.reapply).toBe(true);
  });

  it("does not write scaffold files when --plan is used", async () => {
    process.env.FAB_LANG = "en";
    const target = createWerewolfFixtureRoot("fab-init-plan-acceptance");
    tempRoots.push(target);

    const { initCommand } = await import("../src/commands/init.ts");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      void chunk;
      return true;
    }) as typeof process.stderr.write);

    await initCommand.run?.({
      args: {
        target,
        plan: true,
        yes: true,
      },
    } as never);

    // v2.0: --plan does not write any scaffold artifacts.
    expect(existsSync(`${target}/.fabric/agents.meta.json`)).toBe(false);
    expect(existsSync(`${target}/.fabric/forensic.json`)).toBe(false);
    expect(existsSync(`${target}/.fabric/knowledge`)).toBe(false);
  });

  it("reapplies managed scaffold files over an existing init when --reapply is used", async () => {
    process.env.FAB_LANG = "en";
    const target = createWerewolfFixtureRoot("fab-init-reapply-acceptance");
    tempRoots.push(target);

    const { initCommand } = await import("../src/commands/init.ts");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      void chunk;
      return true;
    }) as typeof process.stderr.write);

    await initCommand.run?.({
      args: {
        target,
        yes: true,
        bootstrap: false,
        mcp: false,
        hooks: false,
      },
    } as never);

    // v2.0: re-running init with --reapply re-creates the v2.0 layout (knowledge
    // subdirs, agents.meta.json, events.jsonl) but does NOT touch any pre-existing
    // legacy bootstrap/README.md.
    writeFixtureFile(target, ".fabric/bootstrap/README.md", "# reapply me\n");

    await initCommand.run?.({
      args: {
        target,
        reapply: true,
        yes: true,
        bootstrap: false,
        mcp: false,
        hooks: false,
      },
    } as never);

    // Legacy bootstrap file is preserved verbatim.
    expect(readFixtureFile(target, ".fabric/bootstrap/README.md")).toBe("# reapply me\n");
    // v2.0 layout exists alongside it.
    expect(existsSync(`${target}/.fabric/agents.meta.json`)).toBe(true);
    expect(readFileSync(`${target}/.fabric/agents.meta.json`, "utf8")).toContain("counters");
  });

  it("prints compatibility notices for legacy flags and skips wizard when --plan is used", async () => {
    process.env.FAB_LANG = "en";
    const target = createWerewolfFixtureRoot("fab-init-cli-surface");
    tempRoots.push(target);

    const { initCommand } = await import("../src/commands/init.ts");
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

    await initCommand.run?.({
      args: {
        target,
        plan: true,
        interactive: false,
        bootstrap: false,
      },
    } as never);

    expect(stderr.some((line) => line.includes("Using standard --plan mode"))).toBe(true);
    expect(stderr.some((line) => line.includes("Compatibility: --interactive=false"))).toBe(true);
    expect(stderr.some((line) => line.includes("legacy --no-* flags"))).toBe(true);
    expect(stdout.some((line) => line.includes("Fabric init dry run"))).toBe(true);
    expect(stdout.some((line) => line.includes("Install bootstrap templates?"))).toBe(false);
  });
});

describe("init CLI surface — fabric-config.json scaffold (TASK-003)", () => {
  it("test_init_creates_fabric_config_json_with_all_known_fields", async () => {
    const target = createWerewolfFixtureRoot("fab-init-config-fresh");
    tempRoots.push(target);

    const { initFabric } = await import("../src/commands/init.ts");
    await initFabric(target);

    const configPath = join(target, ".fabric", "fabric-config.json");
    expect(existsSync(configPath)).toBe(true);
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    for (const field of EXPECTED_FABRIC_CONFIG_FIELDS) {
      expect(parsed, `missing field ${field}`).toHaveProperty(field);
    }
    // Verify the documented defaults explicitly so a silent default-shift
    // is caught by the test.
    expect(parsed.knowledge_language).toBe("match-existing");
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

    const { initFabric } = await import("../src/commands/init.ts");
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

    await initFabric(target, { force: true });

    const afterContent = readFileSync(configPath, "utf8");
    expect(afterContent).toBe(beforeContent);
    const afterParsed = JSON.parse(afterContent) as Record<string, unknown>;
    expect(afterParsed.review_hint_pending_count).toBe(25);
    expect(afterParsed.custom_user_field).toBe("user-was-here");
    // Verify NO merge — schema fields the user removed are NOT re-added.
    expect(afterParsed).not.toHaveProperty("archive_hint_hours");
    expect(afterParsed).not.toHaveProperty("knowledge_language");
    // Mtime unchanged (no write happened).
    expect(statSync(configPath).mtimeMs).toBe(beforeMtime);
  });

  it("test_reapply_preserves_existing_fabric_config_json", async () => {
    const target = createWerewolfFixtureRoot("fab-init-config-reapply");
    tempRoots.push(target);

    const { initFabric } = await import("../src/commands/init.ts");
    await initFabric(target);

    const configPath = join(target, ".fabric", "fabric-config.json");
    const customised = { review_hint_pending_count: 99, knowledge_language: "en" };
    writeFileSync(configPath, JSON.stringify(customised, null, 2) + "\n", "utf8");
    const beforeContent = readFileSync(configPath, "utf8");

    await initFabric(target, { reapply: true, force: true });

    const afterContent = readFileSync(configPath, "utf8");
    expect(afterContent).toBe(beforeContent);
  });

  it("test_init_does_not_write_import_requested_sentinel", async () => {
    const target = createWerewolfFixtureRoot("fab-init-no-sentinel");
    tempRoots.push(target);

    const { initFabric } = await import("../src/commands/init.ts");
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
      log: { step: vi.fn(), success: vi.fn() },
      isCancel: vi.fn().mockReturnValue(false),
    }));

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      void chunk;
      return true;
    }) as typeof process.stderr.write);

    vi.resetModules();
    const { runInitCommand } = await import("../src/commands/init.ts");
    await runInitCommand({ target, yes: true });

    // The retired sentinel prompt MUST NOT appear among any confirm() calls.
    const sentinelPromptShown = confirmCalls.some((c) =>
      c.message.includes("下次开 AI 时让我从 git log 抽更多知识吗"),
    );
    expect(sentinelPromptShown).toBe(false);

    vi.doUnmock("@clack/prompts");
  });
});
