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
import { loadGlobalConfig, saveGlobalConfig } from "../src/store/global-config-io.js";
import { loadProjectConfig, saveProjectConfig } from "../src/store/project-config-io.js";
import { personalStoreCandidates, storeCreate } from "../src/store/store-ops.js";

const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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
    mcpRootPolicy: { mode: "dynamic" },
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

  // ── Bug-B: settled wizard re-install does NOT prompt (collapse reachable) ────
  it("settled wizard config (team bound, no unbound candidate) does NOT prompt, still renders personal slot, changed=false", async () => {
    const home = await tempDir("fabric-dualslot-home-");
    vi.stubEnv("FABRIC_HOME", home);
    const globalRoot = join(home, ".fabric");
    saveGlobalConfig(globalConfigSchema.parse({ uid: "u-test", language: "en" }), globalRoot);
    // One team store, and it is the only non-personal store → bound + no unbound.
    await storeCreate("team", "2026-06-08T00:00:00.000Z", {
      uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      git: false,
      globalRoot,
    });

    const target = await tempDir("fabric-dualslot-proj-");
    saveProjectConfig(
      { project_id: "p-done", required_stores: [{ id: "team" }], active_write_store: "team" },
      target,
    );

    const { renderer, info } = recordingRenderer();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const selectMock = vi.mocked(select);

    const result = await new StoreStage().execute(
      baseContext(target, { renderer, interactive: true, wizardEnabled: true }),
    );

    // No prompt fired on the settled wizard path.
    expect(selectMock).not.toHaveBeenCalled();
    // Personal slot status still rendered.
    expect(info.some((line) => /personal store/i.test(line))).toBe(true);
    // changed=false so a settled interactive re-install can reach the collapse.
    expect(result.disposition).toBe("ran");
    expect(result.changed).toBe(false);
  });

  // ── Bug-B: actionable wizard re-install flushes render buffer before prompt ──
  it("actionable wizard config (an unbound team candidate) flushes the render buffer before the prompt", async () => {
    const home = await tempDir("fabric-dualslot-home-");
    vi.stubEnv("FABRIC_HOME", home);
    const globalRoot = join(home, ".fabric");
    saveGlobalConfig(globalConfigSchema.parse({ uid: "u-test", language: "en" }), globalRoot);
    // Two team stores; only "team-a" is bound → "team-b" is an unbound candidate.
    await storeCreate("team-a", "2026-06-08T00:00:00.000Z", {
      uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      git: false,
      globalRoot,
    });
    await storeCreate("team-b", "2026-06-08T00:00:00.000Z", {
      uuid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      git: false,
      globalRoot,
    });

    const target = await tempDir("fabric-dualslot-proj-");
    saveProjectConfig(
      { project_id: "p-actionable", required_stores: [{ id: "team-a" }], active_write_store: "team-a" },
      target,
    );

    const { renderer } = recordingRenderer();
    vi.spyOn(console, "log").mockImplementation(() => {});
    // The team-slot prompt resolves to SKIP (no side effects beyond the prompt).
    vi.mocked(select).mockResolvedValue("skip");

    const flushRenderBuffer = vi.fn();

    await new StoreStage().execute(
      baseContext(target, {
        renderer,
        interactive: true,
        wizardEnabled: true,
        flushRenderBuffer,
      }),
    );

    // flushRenderBuffer was invoked (before the prompt) on the actionable path.
    expect(flushRenderBuffer).toHaveBeenCalledTimes(1);
    // And the prompt did fire (actionable → a real decision).
    expect(vi.mocked(select)).toHaveBeenCalled();
  });

  // ── 语义 A (multi-personal): three-state personal slot + no force-demote ─────
  it("ensurePersonalStore does NOT demote additional personal stores on install", async () => {
    const home = await tempDir("fabric-mp-home-");
    vi.stubEnv("FABRIC_HOME", home);
    const globalRoot = join(home, ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-test",
        language: "en",
        stores: [
          { store_uuid: P1, alias: "personal", mount_name: "personal", personal: true },
          { store_uuid: P2, alias: "personal-work", mount_name: "personal-work", personal: true },
        ],
      }),
      globalRoot,
    );
    const target = await tempDir("fabric-mp-proj-");
    saveProjectConfig({ project_id: "p-mp" }, target);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await new StoreStage().execute(baseContext(target, { wizardEnabled: false }));

    // Both personal stores remain personal:true — the old force-demote is gone.
    const stores = loadGlobalConfig(globalRoot)?.stores ?? [];
    expect(stores.filter((s) => s.personal === true).map((s) => s.alias).sort()).toEqual([
      "personal",
      "personal-work",
    ]);
  });

  it("personal slot stays silent (no select) for a single personal store", async () => {
    const home = await tempDir("fabric-mp1-home-");
    vi.stubEnv("FABRIC_HOME", home);
    const globalRoot = join(home, ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-test",
        language: "en",
        stores: [{ store_uuid: P1, alias: "personal", mount_name: "personal", personal: true }],
      }),
      globalRoot,
    );
    const target = await tempDir("fabric-mp1-proj-");
    saveProjectConfig({ project_id: "p-mp1" }, target);
    const { renderer, info } = recordingRenderer();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await new StoreStage().execute(
      baseContext(target, { renderer, wizardEnabled: false }),
    );

    expect(vi.mocked(select)).not.toHaveBeenCalled();
    expect(info.some((line) => /personal store/i.test(line))).toBe(true);
  });

  it("≥2 personal in the wizard: picking switch:<alias> sets the machine active personal", async () => {
    const home = await tempDir("fabric-mp2-home-");
    vi.stubEnv("FABRIC_HOME", home);
    const globalRoot = join(home, ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-test",
        language: "en",
        stores: [
          { store_uuid: P1, alias: "personal", mount_name: "personal", personal: true },
          { store_uuid: P2, alias: "personal-work", mount_name: "personal-work", personal: true },
        ],
      }),
      globalRoot,
    );
    const target = await tempDir("fabric-mp2-proj-");
    saveProjectConfig({ project_id: "p-mp2" }, target);
    vi.spyOn(console, "log").mockImplementation(() => {});
    // First select = personal slot (pick personal-work); second = team slot (skip).
    vi.mocked(select)
      .mockResolvedValueOnce("switch:personal-work" as never)
      .mockResolvedValueOnce("skip" as never);

    await new StoreStage().execute(baseContext(target, { wizardEnabled: true, interactive: true }));

    expect(loadGlobalConfig(globalRoot)?.active_personal_store).toBe("personal-work");
  });

  it("storeCreate({ personal: true }) mints a personal-flagged store (the add-path)", async () => {
    const home = await tempDir("fabric-mp3-home-");
    vi.stubEnv("FABRIC_HOME", home);
    const globalRoot = join(home, ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-test",
        language: "en",
        stores: [{ store_uuid: P1, alias: "personal", mount_name: "personal", personal: true }],
      }),
      globalRoot,
    );
    await storeCreate("personal-oss", "2026-06-25T00:00:00.000Z", {
      uuid: P2,
      git: false,
      personal: true,
      globalRoot,
    });
    expect(personalStoreCandidates(globalRoot).map((c) => c.alias).sort()).toEqual([
      "personal",
      "personal-oss",
    ]);
  });
});
