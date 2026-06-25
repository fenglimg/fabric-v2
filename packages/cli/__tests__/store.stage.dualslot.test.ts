import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createTranslator,
  globalConfigSchema,
  migrateRequiredStores,
  type RequiredStoreEntry,
} from "@fenglimg/fabric-shared";
import { select } from "@clack/prompts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StoreStage } from "../src/install/pipeline/store.stage.js";
import type { InstallContext, OutputRenderer } from "../src/install/pipeline/types.js";
import { saveGlobalConfig } from "../src/store/global-config-io.js";
import { loadProjectConfig, saveProjectConfig } from "../src/store/project-config-io.js";
import { storeCreate } from "../src/store/store-ops.js";

vi.mock("@clack/prompts", () => ({
  confirm: vi.fn(),
  isCancel: () => false,
  select: vi.fn(),
  text: vi.fn(),
}));

const tempRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function recordingRenderer(): { renderer: OutputRenderer; info: string[]; steps: string[] } {
  const info: string[] = [];
  const steps: string[] = [];
  const renderer: OutputRenderer = {
    renderStep: (step) => steps.push(step.name),
    renderSuccess: () => undefined,
    renderError: () => undefined,
    renderWarning: () => undefined,
    renderInfo: (message) => info.push(message),
    renderSummaryCard: () => undefined,
    renderSection: () => undefined,
    renderComplete: () => undefined,
  };
  return { renderer, info, steps };
}

function baseContext(target: string, overrides: Partial<InstallContext> = {}): InstallContext {
  return {
    target,
    args: {},
    options: { planOnly: false, skipBootstrap: false, skipHooks: false, skipMcp: false },
    mcpInstallMode: "global",
    claudeMcpScope: "project",
    interactive: false,
    wizardEnabled: false,
    stageResults: [],
    rollbackStack: [],
    state: {},
    translate: createTranslator("en"),
    ...overrides,
  } as InstallContext;
}

describe("store.stage dual-slot model (TASK-002)", () => {
  // ── Migration: required_stores with 2 non-personal stores reduces to 1 ──────
  it("migrateRequiredStores reduces a >1-team config to exactly one team store", () => {
    const required: RequiredStoreEntry[] = [
      { id: "team-a" },
      { id: "team-b" },
    ];
    const migrated = migrateRequiredStores({ required_stores: required });
    expect(migrated.required_stores).toHaveLength(1);
    // No active_write_store → keep the FIRST declared team store.
    expect(migrated.required_stores).toEqual([{ id: "team-a" }]);
  });

  it("migrateRequiredStores keeps the active_write_store's team store as primary", () => {
    const required: RequiredStoreEntry[] = [
      { id: "team-a" },
      { id: "team-b" },
      { id: "team-c" },
    ];
    const migrated = migrateRequiredStores({
      required_stores: required,
      active_write_store: "team-b",
    });
    expect(migrated.required_stores).toEqual([{ id: "team-b" }]);
  });

  it("migrateRequiredStores preserves the $personal sentinel and is a no-op at <=1 team", () => {
    const single: RequiredStoreEntry[] = [{ id: "$personal" }, { id: "team-a" }];
    const migrated = migrateRequiredStores({ required_stores: single });
    // Already one team store → returned unchanged (same array reference).
    expect(migrated.required_stores).toBe(single);
  });

  it("store stage migrates a legacy >1-team project config down to one team store", async () => {
    const home = await tempDir("fabric-dualslot-home-");
    vi.stubEnv("FABRIC_HOME", home);
    const globalRoot = join(home, ".fabric");
    saveGlobalConfig(globalConfigSchema.parse({ uid: "u-test", language: "en" }), globalRoot);

    const target = await tempDir("fabric-dualslot-proj-");
    // A pre-dual-slot config that over-bound the team slot. saveProjectConfig now
    // parses through the max-1 schema and would REJECT a >1-team array, so seed
    // the legacy state by writing the raw JSON directly — exactly the on-disk
    // shape the migration safety net must regularize on run.
    mkdirSync(join(target, ".fabric"), { recursive: true });
    writeFileSync(
      join(target, ".fabric", "fabric-config.json"),
      JSON.stringify(
        { project_id: "p-legacy", required_stores: [{ id: "team-a" }, { id: "team-b" }] },
        null,
        2,
      ),
      "utf8",
    );
    vi.spyOn(console, "log").mockImplementation(() => {});

    await new StoreStage().execute(baseContext(target));

    const config = loadProjectConfig(target);
    const teamEntries = (config?.required_stores ?? []).filter((r) => r.id !== "$personal");
    expect(teamEntries).toHaveLength(1);
  });

  // ── Already-configured project: personal slot status IS rendered ────────────
  it("renders the personal slot status for an already-configured project (no silent skip)", async () => {
    const home = await tempDir("fabric-dualslot-home-");
    vi.stubEnv("FABRIC_HOME", home);
    const globalRoot = join(home, ".fabric");
    const teamUuid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    saveGlobalConfig(globalConfigSchema.parse({ uid: "u-test", language: "en" }), globalRoot);
    await storeCreate("team", "2026-06-08T00:00:00.000Z", {
      uuid: teamUuid,
      git: false,
      globalRoot,
    });

    const target = await tempDir("fabric-dualslot-proj-");
    // Fully configured: a bound team store + an active write store. The OLD phase
    // silently returned here with no output; the dual-slot phase MUST still speak.
    saveProjectConfig(
      {
        project_id: "p-done",
        required_stores: [{ id: "team" }],
        active_write_store: "team",
      },
      target,
    );

    const { renderer, info, steps } = recordingRenderer();
    vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await new StoreStage().execute(
      baseContext(target, { renderer, interactive: false, wizardEnabled: false }),
    );

    expect(result.disposition).toBe("ran");
    // The personal slot status line was rendered through the unified renderer —
    // the phase did NOT return early with no output.
    const personalRendered = info.some((line) => /personal store/i.test(line));
    expect(personalRendered).toBe(true);
    // The team slot status was rendered too (bound team store visible, not hidden).
    const teamRendered = info.some((line) => /team store/i.test(line) && line.includes("team"));
    expect(teamRendered).toBe(true);
    // renderInfo / renderStep are the unified-renderer surface TASK-001 wired.
    expect(info.length + steps.length).toBeGreaterThan(0);
  });
});
