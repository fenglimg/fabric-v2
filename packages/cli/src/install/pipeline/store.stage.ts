import { randomUUID } from "node:crypto";

import { initStore, storeRelativePathForMount, type GlobalConfig } from "@fenglimg/fabric-shared";
import { isCancel, select, text } from "@clack/prompts";
import { join } from "node:path";

import { loadGlobalConfig, resolveGlobalRoot, saveGlobalConfig } from "../../store/global-config-io.js";
import { mountStoreFromRemote, runGlobalInstall } from "../run-global-install.js";
import {
  storeBind,
  storeCreate,
  storeList,
  storeSetWriteRoute,
  storeSwitchWrite,
  unboundAvailableStores,
} from "../../store/store-ops.js";
import { regenerateBindingsSnapshot } from "../../store/bindings-io.js";
import { loadProjectConfig } from "../../store/project-config-io.js";
import { paint } from "../../colors.js";
import type { Stage, InstallContext, StageResult } from "./types.js";
import { stageRan, stageSkipped, stageFailedFromError } from "./pipeline.js";
import { ensureStoreProjectBinding } from "../store-project-onboarding.js";

// ---------------------------------------------------------------------------
// Store Stage
// ---------------------------------------------------------------------------

/**
 * Store stage: manages knowledge stores.
 *
 * Responsibilities:
 * 1. Ensure global config exists (mint ~/.fabric if needed)
 * 2. If --url given: mount remote store and bind to project
 * 3. Prompt for store onboarding in interactive mode
 * 4. Warn about unbound stores
 *
 * This stage handles both global install (--global flag) and project-level
 * store setup.
 */
export class StoreStage implements Stage {
  readonly name = "store" as const;

  async execute(context: InstallContext): Promise<StageResult> {
    try {
      const globalRoot = resolveGlobalRoot();
      context.state.globalRoot = globalRoot;

      if (context.options.planOnly === true) {
        return stageSkipped("store", "dry-run: store setup planned without global/project writes");
      }

      // Ensure global config exists
      const globalConfig = loadGlobalConfig(globalRoot);
      if (globalConfig === null) {
        await runGlobalInstall({}, globalRoot);
        context.state.globalConfigCreated = true;
      } else {
        await this.ensurePersonalStore(globalConfig, globalRoot);
      }

      // Handle --url flag: mount and bind remote store
      if (context.args.url) {
        await this.bindRemoteStoreToProject(context.target, context.args.url, globalRoot);
        return stageRan("store", [context.args.url], []);
      }

      const installed: string[] = [];

      // Check for unbound stores. Interactive installs can bind one immediately;
      // non-interactive installs only print the nudge and keep going.
      const unboundStores = unboundAvailableStores(context.target);
      if (unboundStores.length > 0) {
        if (context.wizardEnabled) {
          const bound = await this.promptBindMountedStore(context, unboundStores, globalRoot);
          if (bound !== null) {
            installed.push(`bound:${bound}`);
            return stageRan("store", installed, []);
          }
        } else {
          this.warnUnboundStores(unboundStores);
        }
      }

      if (context.wizardEnabled) {
        const onboarded = await this.promptStoreOnboarding(context.target, globalRoot);
        if (onboarded !== null) {
          installed.push(onboarded);
        }
      }

      return stageRan("store", installed, []);
    } catch (error) {
      return stageFailedFromError("store", error);
    }
  }

  private async bindRemoteStoreToProject(
    projectRoot: string,
    url: string,
    globalRoot: string,
  ): Promise<string> {
    const already = storeList(globalRoot).find((store) => store.remote === url);
    const mounted = already ?? mountStoreFromRemote(url, globalRoot);

    await storeBind(projectRoot, { id: mounted.alias, suggested_remote: url }, { globalRoot });
    storeSwitchWrite(projectRoot, mounted.alias, { globalRoot });
    const activeProject = loadProjectConfig(projectRoot)?.active_project;
    if (typeof activeProject === "string" && activeProject.length > 0) {
      storeSetWriteRoute(projectRoot, `project:${activeProject}`, mounted.alias, { globalRoot });
    }
    regenerateBindingsSnapshot(projectRoot, {
      now: new Date().toISOString(),
      globalRoot,
    });

    console.log("");
    console.log(
      paint.success(
        `bound store '${mounted.alias}' to this project and set it as the write target.`,
      ),
    );
    return mounted.alias;
  }

  private async bindMountedStoreToProject(
    projectRoot: string,
    alias: string,
    globalRoot: string,
    requestedProjectId: string,
  ): Promise<string> {
    await ensureStoreProjectBinding(projectRoot, alias, {
      globalRoot,
      requestedProjectId,
    });
    console.log("");
    console.log(
      paint.success(`bound store '${alias}' to this project and set it as the write target.`),
    );
    return alias;
  }

  private async bindCreatedStoreToProject(
    projectRoot: string,
    alias: string,
    options: { remote?: string; globalRoot: string },
  ): Promise<string> {
    await storeCreate(alias, new Date().toISOString(), {
      ...(options.remote === undefined ? {} : { remote: options.remote }),
      globalRoot: options.globalRoot,
    });
    await storeBind(
      projectRoot,
      options.remote === undefined ? { id: alias } : { id: alias, suggested_remote: options.remote },
      { globalRoot: options.globalRoot },
    );
    storeSwitchWrite(projectRoot, alias, { globalRoot: options.globalRoot });
    const activeProject = loadProjectConfig(projectRoot)?.active_project;
    if (typeof activeProject === "string" && activeProject.length > 0) {
      storeSetWriteRoute(projectRoot, `project:${activeProject}`, alias, { globalRoot: options.globalRoot });
    }
    regenerateBindingsSnapshot(projectRoot, {
      now: new Date().toISOString(),
      globalRoot: options.globalRoot,
    });
    console.log("");
    console.log(
      paint.success(`created store '${alias}', bound it to this project, and set it as the write target.`),
    );
    return alias;
  }

  private async promptBindMountedStore(
    context: InstallContext,
    unboundStores: Array<{ alias: string; remote?: string }>,
    globalRoot: string,
  ): Promise<string | null> {
    const choice = await select({
      message: "Bind an already-mounted knowledge store to this project?",
      initialValue: "skip",
      options: [
        ...unboundStores.map((store) => ({
          value: store.alias,
          label: store.alias,
          hint: store.remote ?? "local store",
        })),
        { value: "skip", label: "skip", hint: "leave mounted stores unbound for now" },
      ],
    });
    if (isCancel(choice) || choice === "skip" || typeof choice !== "string") {
      this.warnUnboundStores(unboundStores);
      return null;
    }
    const project = await text({
      message: `Project coordinate in store '${choice}':`,
      initialValue: loadProjectConfig(context.target)?.active_project ?? "project",
    });
    if (isCancel(project) || typeof project !== "string" || project.length === 0) {
      this.warnUnboundStores(unboundStores);
      return null;
    }
    return this.bindMountedStoreToProject(context.target, choice, globalRoot, project);
  }

  /**
   * Interactive "set up a team store" step.
   *
   * Idempotent: skipped when this project already has an active write store.
   */
  private async promptStoreOnboarding(projectRoot: string, globalRoot: string): Promise<string | null> {
    const config = loadProjectConfig(projectRoot);
    if (typeof config?.active_write_store === "string" && config.active_write_store.length > 0) {
      return null;
    }

    const choice = await select({
      message: "Set up a team / shared knowledge store for this project?",
      initialValue: "skip",
      options: [
        { value: "skip", label: "skip", hint: "personal store only (default)" },
        { value: "join", label: "join existing", hint: "clone + bind a shared store from a git remote" },
        { value: "create", label: "create new", hint: "start a fresh local store (optionally remote-backed)" },
      ],
    });
    if (isCancel(choice) || choice === "skip") {
      return null;
    }

    if (choice === "join") {
      const url = await text({
        message: "Shared store git remote (url):",
        placeholder: "git@github.com:org/knowledge.git",
      });
      if (isCancel(url) || typeof url !== "string" || url.length === 0) {
        return null;
      }
      return `bound:${await this.bindRemoteStoreToProject(projectRoot, url, globalRoot)}`;
    }

    const alias = await text({ message: "Local alias for the new store:", initialValue: "team" });
    if (isCancel(alias) || typeof alias !== "string" || alias.length === 0) {
      return null;
    }
    const remote = await text({
      message: "Git remote to back it (optional - leave blank to skip):",
      placeholder: "git@github.com:org/knowledge.git",
    });
    const remoteStr = !isCancel(remote) && typeof remote === "string" && remote.length > 0 ? remote : undefined;
    return `created:${await this.bindCreatedStoreToProject(
      projectRoot,
      alias,
      remoteStr === undefined ? { globalRoot } : { remote: remoteStr, globalRoot },
    )}`;
  }

  private warnUnboundStores(unboundStores: Array<{ alias: string }>): void {
    console.log("");
    console.log(
      `Note: The following stores are mounted but not bound to this project: ${unboundStores.map((s) => `'${s.alias}'`).join(", ")}`,
    );
    console.log(
      `  Run 'fabric store bind ${unboundStores[0].alias}' to bind one.`,
    );
  }

  private async ensurePersonalStore(config: GlobalConfig, globalRoot: string): Promise<void> {
    const personalAlias = config.stores.find((store) => store.alias === "personal");
    if (personalAlias === undefined) {
      const uuid = randomUUID();
      const mounted = { store_uuid: uuid, alias: "personal", mount_name: "personal", personal: true };
      await initStore(
        join(globalRoot, storeRelativePathForMount(mounted)),
        { store_uuid: uuid, created_at: new Date().toISOString(), canonical_alias: "personal" },
      );
      saveGlobalConfig({ ...config, stores: [mounted, ...config.stores] }, globalRoot);
      return;
    }

    const nextStores = config.stores.map((store) => ({
      ...store,
      ...(store.alias === "personal" ? { personal: true } : { personal: false }),
    }));
    if (JSON.stringify(nextStores) !== JSON.stringify(config.stores)) {
      saveGlobalConfig({ ...config, stores: nextStores }, globalRoot);
    }
  }
}
