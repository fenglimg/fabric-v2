import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTranslator, globalConfigSchema, readBindingsSnapshot } from "@fenglimg/fabric-shared";
import { select, text } from "@clack/prompts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GuidanceStage } from "../src/install/pipeline/guidance.stage.js";
import { EnvStage } from "../src/install/pipeline/env.stage.js";
import { StoreStage } from "../src/install/pipeline/store.stage.js";
import type { InstallContext } from "../src/install/pipeline/types.js";
import { shouldUseInstallRenderer } from "../src/commands/install-v2.js";
import { loadGlobalConfig, saveGlobalConfig } from "../src/store/global-config-io.js";
import { loadProjectConfig, saveProjectConfig } from "../src/store/project-config-io.js";
import { storeCreate, storeProjectList } from "../src/store/store-ops.js";

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

  it("env stage reads an existing fabric_language from fabric-config.json", async () => {
    const target = await tempProject();
    await mkdir(join(target, ".fabric"), { recursive: true });
    await writeFile(
      join(target, ".fabric", "fabric-config.json"),
      JSON.stringify({ fabric_language: "zh-CN" }, null, 2),
      "utf8",
    );

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
    expect(lines.some((line) => line.includes("Fabric 语言偏好：zh-CN"))).toBe(true);
  });

  it("binds a selected mounted store during the install wizard", async () => {
    const home = await mkdtemp(join(tmpdir(), "fabric-install-v2-home-"));
    tempRoots.push(home);
    vi.stubEnv("FABRIC_HOME", home);

    const globalRoot = join(home, ".fabric");
    const teamUuid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    saveGlobalConfig(globalConfigSchema.parse({ uid: "u-test" }), globalRoot);
    storeCreate("team", "2026-06-08T00:00:00.000Z", {
      uuid: teamUuid,
      git: false,
      globalRoot,
    });

    const target = await tempProject();
    saveProjectConfig({ project_id: "project-test" }, target);
    vi.mocked(select).mockResolvedValueOnce("team");
    vi.mocked(text).mockResolvedValueOnce("Fabric V2");
    vi.spyOn(console, "log").mockImplementation(() => {});

    const stage = new StoreStage();
    const result = await stage.execute(baseContext(target, {
      interactive: true,
      wizardEnabled: true,
    }));

    expect(result.disposition).toBe("ran");
    expect(result.installed).toEqual(["bound:team"]);
    expect(select).toHaveBeenCalledWith(expect.objectContaining({
      message: "Bind an already-mounted knowledge store to this project?",
    }));
    expect(text).toHaveBeenCalledWith(expect.objectContaining({
      message: "Project coordinate in store 'team':",
    }));

    const projectConfig = loadProjectConfig(target);
    expect(projectConfig?.required_stores).toEqual([{ id: "team" }]);
    expect(projectConfig?.active_project).toBe("fabric-v2");
    expect(projectConfig?.active_write_store).toBe("team");
    expect(projectConfig?.default_write_store).toBe("team");
    expect(storeProjectList("team", globalRoot).map((project) => project.id)).toEqual(["fabric-v2"]);

    const snapshot = readBindingsSnapshot(globalRoot, "project-test");
    expect(snapshot?.write_target).toEqual({ store_uuid: teamUuid, alias: "team" });
  });

  it("mints a project_id before generating the bindings snapshot", async () => {
    const home = await mkdtemp(join(tmpdir(), "fabric-install-v2-home-"));
    tempRoots.push(home);
    vi.stubEnv("FABRIC_HOME", home);

    const globalRoot = join(home, ".fabric");
    const teamUuid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    saveGlobalConfig(globalConfigSchema.parse({ uid: "u-test" }), globalRoot);
    storeCreate("team", "2026-06-08T00:00:00.000Z", {
      uuid: teamUuid,
      git: false,
      globalRoot,
    });

    const target = await tempProject();
    saveProjectConfig({ fabric_language: "en" }, target);
    vi.mocked(select).mockResolvedValueOnce("team");
    vi.mocked(text).mockResolvedValueOnce("fabric-v2");
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
    expect(projectConfig?.active_project).toBe("fabric-v2");
    const snapshot = readBindingsSnapshot(globalRoot, projectConfig?.project_id ?? "");
    expect(snapshot).toEqual(expect.objectContaining({
      project_id: projectConfig?.project_id,
      write_target: { store_uuid: teamUuid, alias: "team" },
    }));
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
    expect(existsSync(join(globalRoot, "stores", "personal", "store.json"))).toBe(true);
  });
});
