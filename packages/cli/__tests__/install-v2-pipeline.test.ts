import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTranslator, globalConfigSchema, readBindingsSnapshot } from "@fenglimg/fabric-shared";
import { select, text } from "@clack/prompts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { t } from "../src/i18n.js";
import { GuidanceStage } from "../src/install/pipeline/guidance.stage.js";
import { EnvStage } from "../src/install/pipeline/env.stage.js";
import { StoreStage } from "../src/install/pipeline/store.stage.js";
import { InstallPipeline, stageRan } from "../src/install/pipeline/pipeline.js";
import type { InstallContext, Stage } from "../src/install/pipeline/types.js";
import { shouldUseInstallRenderer } from "../src/commands/install-v2.js";
import { loadGlobalConfig, saveGlobalConfig } from "../src/store/global-config-io.js";
import { loadProjectConfig, saveProjectConfig } from "../src/store/project-config-io.js";
import { storeCreate, storeProjectCreate, storeProjectList } from "../src/store/store-ops.js";
import { suggestStoreProjectId } from "../src/install/store-project-onboarding.js";

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

async function tempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fabric-install-v2-"));
  tempRoots.push(root);
  return root;
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
  };
}

describe("install-v2 pipeline UX", () => {
  it("does not enable Ink renderer when wizard prompts may run", () => {
    expect(shouldUseInstallRenderer({}, true)).toBe(false);
    expect(shouldUseInstallRenderer({ yes: true }, true)).toBe(true);
    expect(shouldUseInstallRenderer({ "dry-run": true }, true)).toBe(true);
    expect(shouldUseInstallRenderer({ yes: true }, false)).toBe(false);
  });

  it("renders numbered stage anchors in plain interactive output", async () => {
    const target = await tempProject();
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value?: unknown) => {
      lines.push(value === undefined ? "" : String(value));
    });
    const fakePreflight: Stage = {
      name: "preflight",
      async execute() {
        return stageRan("preflight");
      },
    };
    const fakeStore: Stage = {
      name: "store",
      async execute() {
        return stageRan("store");
      },
    };

    const result = await new InstallPipeline()
      .addStage(fakePreflight)
      .addStage(fakeStore)
      .execute(baseContext(target));

    expect(result.success).toBe(true);
    expect(lines).toContain("Fabric install 将按 2 个阶段执行");
    expect(lines).toContain("[1/2] 全局与项目预检");
    expect(lines).toContain("[2/2] 知识库拓扑");
    expect(lines.some((line) => line.includes("绑定当前项目的 read/write store"))).toBe(true);
  });

  it("prints semantic-search guidance before final next steps", async () => {
    const target = await tempProject();
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value?: unknown) => {
      lines.push(value === undefined ? "" : String(value));
    });

    const stage = new GuidanceStage();
    const result = await stage.execute(baseContext(target, {
      args: { "enable-embed": true, "embed-model": "test-embed-model" },
    }));

    expect(result.disposition).toBe("ran");
    const semanticIndex = lines.findIndex((line) => line.includes("语义搜索已启用"));
    const nextStepsIndex = lines.findIndex((line) => line.includes("Next steps"));
    expect(semanticIndex).toBeGreaterThanOrEqual(0);
    expect(nextStepsIndex).toBeGreaterThanOrEqual(0);
    expect(semanticIndex).toBeLessThan(nextStepsIndex);
  });

  it("env stage reads the language from the global config (grill-6fixes D1)", async () => {
    const home = await mkdtemp(join(tmpdir(), "fabric-install-v2-home-"));
    tempRoots.push(home);
    vi.stubEnv("FABRIC_HOME", home);
    const globalRoot = join(home, ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({ uid: "u-test", language: "zh-CN" }),
      globalRoot,
    );

    const target = await tempProject();
    const context = baseContext(target);
    const stage = new EnvStage();
    const result = await stage.execute(context);

    expect(result.disposition).toBe("ran");
    expect(context.state.fabricLanguage).toBe("zh-CN");
  });

  it("guidance stage renders through the project translator", async () => {
    const target = await tempProject();
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value?: unknown) => {
      lines.push(value === undefined ? "" : String(value));
    });

    const stage = new GuidanceStage();
    const result = await stage.execute(baseContext(target, {
      state: { fabricLanguage: "zh-CN" },
      translate: createTranslator("zh-CN"),
    }));

    expect(result.disposition).toBe("ran");
    expect(lines.some((line) => line.includes("下一步"))).toBe(true);
    // grill-6fixes (D1): the "Fabric 语言偏好：{value}" hint line was removed.
  });

  it("binds a selected mounted store during the install wizard", async () => {
    const home = await mkdtemp(join(tmpdir(), "fabric-install-v2-home-"));
    tempRoots.push(home);
    vi.stubEnv("FABRIC_HOME", home);

    const globalRoot = join(home, ".fabric");
    const teamUuid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    // grill-6fixes (D1b): seed a language so the install language selector
    // (StoreStage.ensureLanguageSelected) early-returns instead of consuming
    // the store-onboarding select mock below.
    saveGlobalConfig(globalConfigSchema.parse({ uid: "u-test", language: "en" }), globalRoot);
    storeCreate("team", "2026-06-08T00:00:00.000Z", {
      uuid: teamUuid,
      git: false,
      globalRoot,
    });

    const target = await tempProject();
    saveProjectConfig({ project_id: "project-test" }, target);
    // grill-6fixes (D6): the team store has no projects yet, so the project
    // ambiguity guard takes the SILENT path — no project prompt; the id is
    // derived from the repo (git name → temp-dir basename here).
    const expectedProject = suggestStoreProjectId(target);
    vi.mocked(select).mockResolvedValueOnce("team");
    vi.spyOn(console, "log").mockImplementation(() => {});

    const stage = new StoreStage();
    const result = await stage.execute(baseContext(target, {
      interactive: true,
      wizardEnabled: true,
    }));

    expect(result.disposition).toBe("ran");
    expect(result.installed).toEqual(["bound:team"]);
    // C5: prompts route through t() now — assert via the same translator the
    // StoreStage uses, so the check is locale-agnostic.
    expect(select).toHaveBeenCalledWith(expect.objectContaining({
      message: t("cli.install.store.bind-mounted.prompt"),
    }));
    // grill-6fixes (D6): silent path — no project text prompt was shown.
    expect(text).not.toHaveBeenCalled();

    const projectConfig = loadProjectConfig(target);
    expect(projectConfig?.required_stores).toEqual([{ id: "team" }]);
    expect(projectConfig?.active_project).toBe(expectedProject);
    expect(projectConfig?.active_write_store).toBe("team");
    expect(projectConfig?.default_write_store).toBe("team");
    expect(projectConfig?.write_routes).toEqual([{ scope: `project:${expectedProject}`, store: "team" }]);
    expect(storeProjectList("team", globalRoot).map((project) => project.id)).toEqual([expectedProject]);

    const snapshot = readBindingsSnapshot(globalRoot, "project-test");
    expect(snapshot?.write_target).toEqual({ store_uuid: teamUuid, alias: "team" });
  });

  it("mints a project_id before generating the bindings snapshot", async () => {
    const home = await mkdtemp(join(tmpdir(), "fabric-install-v2-home-"));
    tempRoots.push(home);
    vi.stubEnv("FABRIC_HOME", home);

    const globalRoot = join(home, ".fabric");
    const teamUuid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    // grill-6fixes (D1b): seed a language so the install language selector
    // (StoreStage.ensureLanguageSelected) early-returns instead of consuming
    // the store-onboarding select mock below.
    saveGlobalConfig(globalConfigSchema.parse({ uid: "u-test", language: "en" }), globalRoot);
    storeCreate("team", "2026-06-08T00:00:00.000Z", {
      uuid: teamUuid,
      git: false,
      globalRoot,
    });

    const target = await tempProject();
    saveProjectConfig({}, target);
    // grill-6fixes (D6): empty store → silent project resolution (git-derived).
    const expectedProject = suggestStoreProjectId(target);
    vi.mocked(select).mockResolvedValueOnce("team");
    vi.spyOn(console, "log").mockImplementation(() => {});

    const stage = new StoreStage();
    const result = await stage.execute(baseContext(target, {
      interactive: true,
      wizardEnabled: true,
    }));

    expect(result.disposition).toBe("ran");
    const projectConfig = loadProjectConfig(target);
    expect(projectConfig?.project_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    );
    expect(projectConfig?.active_project).toBe(expectedProject);
    const snapshot = readBindingsSnapshot(globalRoot, projectConfig?.project_id ?? "");
    expect(snapshot).toEqual(expect.objectContaining({
      project_id: projectConfig?.project_id,
      write_target: { store_uuid: teamUuid, alias: "team" },
    }));
  });

  it("prompts join/new only when the store already has a non-matching project (D6 guard)", async () => {
    const home = await mkdtemp(join(tmpdir(), "fabric-install-v2-home-"));
    tempRoots.push(home);
    vi.stubEnv("FABRIC_HOME", home);

    const globalRoot = join(home, ".fabric");
    const teamUuid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    saveGlobalConfig(globalConfigSchema.parse({ uid: "u-test", language: "en" }), globalRoot);
    storeCreate("team", "2026-06-08T00:00:00.000Z", { uuid: teamUuid, git: false, globalRoot });
    // Seed an existing project whose id will NOT match the temp repo's git name,
    // so the ambiguity guard must prompt instead of silently forking.
    await storeProjectCreate("team", "existing-app", "2026-06-08T00:00:00.000Z", {
      name: "Existing App",
      globalRoot,
    });

    const target = await tempProject();
    saveProjectConfig({}, target);
    // First select = store choice; second select = project pick (join existing).
    vi.mocked(select).mockResolvedValueOnce("team").mockResolvedValueOnce("existing-app");
    vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await new StoreStage().execute(baseContext(target, {
      interactive: true,
      wizardEnabled: true,
    }));

    expect(result.disposition).toBe("ran");
    expect(select).toHaveBeenCalledWith(expect.objectContaining({
      message: t("cli.install.store.project-pick.prompt", { store: "team" }),
    }));
    const projectConfig = loadProjectConfig(target);
    expect(projectConfig?.active_project).toBe("existing-app");
    // No parallel project was forked — the store still serves exactly one.
    expect(storeProjectList("team", globalRoot).map((project) => project.id)).toEqual(["existing-app"]);
  });

  it("repairs an existing global config that has no personal store mounted", async () => {
    const home = await mkdtemp(join(tmpdir(), "fabric-install-v2-home-"));
    tempRoots.push(home);
    vi.stubEnv("FABRIC_HOME", home);

    const globalRoot = join(home, ".fabric");
    saveGlobalConfig(globalConfigSchema.parse({ uid: "u-test", stores: [] }), globalRoot);

    const target = await tempProject();
    saveProjectConfig({ fabric_language: "en" }, target);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const stage = new StoreStage();
    const result = await stage.execute(baseContext(target));

    expect(result.disposition).toBe("ran");
    const repaired = loadGlobalConfig(globalRoot);
    expect(repaired?.stores.some((store) => store.alias === "personal" && store.personal === true)).toBe(true);
    expect(existsSync(join(globalRoot, "stores", "personal", "personal", "store.json"))).toBe(true);
  });

  it("marks a legacy alias=personal store as personal instead of creating a duplicate", async () => {
    const home = await mkdtemp(join(tmpdir(), "fabric-install-v2-home-"));
    tempRoots.push(home);
    vi.stubEnv("FABRIC_HOME", home);

    const globalRoot = join(home, ".fabric");
    const personalUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-test",
        stores: [{ store_uuid: personalUuid, alias: "personal", mount_name: "personal" }],
      }),
      globalRoot,
    );
    storeCreate("team", "2026-06-08T00:00:00.000Z", {
      uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      git: false,
      globalRoot,
    });

    const target = await tempProject();
    saveProjectConfig({ fabric_language: "en" }, target);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const stage = new StoreStage();
    const result = await stage.execute(baseContext(target));

    expect(result.disposition).toBe("ran");
    const repaired = loadGlobalConfig(globalRoot);
    expect(repaired?.stores.filter((store) => store.personal === true).map((store) => store.alias)).toEqual(["personal"]);
    expect(repaired?.stores.map((store) => store.alias).sort()).toEqual(["personal", "team"]);
  });

  it("prefers alias=personal and demotes accidental duplicate personal markers", async () => {
    const home = await mkdtemp(join(tmpdir(), "fabric-install-v2-home-"));
    tempRoots.push(home);
    vi.stubEnv("FABRIC_HOME", home);

    const globalRoot = join(home, ".fabric");
    const personalUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-test",
        stores: [
          { store_uuid: personalUuid, alias: "personal", mount_name: "personal" },
          {
            store_uuid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            alias: "personal-dup",
            mount_name: "personal-dup",
            personal: true,
          },
        ],
      }),
      globalRoot,
    );
    storeCreate("team", "2026-06-08T00:00:00.000Z", {
      uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      git: false,
      globalRoot,
    });

    const target = await tempProject();
    saveProjectConfig({ fabric_language: "en" }, target);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const stage = new StoreStage();
    const result = await stage.execute(baseContext(target));

    expect(result.disposition).toBe("ran");
    const repaired = loadGlobalConfig(globalRoot);
    expect(repaired?.stores.filter((store) => store.personal === true).map((store) => store.alias)).toEqual(["personal"]);
    expect(repaired?.stores.map((store) => store.alias).sort()).toEqual(["personal", "personal-dup", "team"]);
  });
});
