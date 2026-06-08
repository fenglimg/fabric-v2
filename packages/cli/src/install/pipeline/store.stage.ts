import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { isCancel, select, text } from "@clack/prompts";
import {
  addMountedStore,
  initStore,
  readStoreIdentity,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";

import { loadGlobalConfig, resolveGlobalRoot, saveGlobalConfig } from "../../store/global-config-io.js";
import { mountStoreFromRemote, runGlobalInstall } from "../run-global-install.js";
import {
  storeCreate,
  storeList,
  syncStoreAliasLinks,
  unboundAvailableStores,
} from "../../store/store-ops.js";
import { loadProjectConfig } from "../../store/project-config-io.js";
import { paint } from "../../colors.js";
import {
  ensureStoreProjectBinding,
  suggestStoreProjectId,
  normalizeStoreProjectId,
} from "../store-project-onboarding.js";
import type { Stage, InstallContext, StageResult } from "./types.js";
import { stageRan, stageFailedFromError } from "./pipeline.js";

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

      context.state.globalConfigCreated = await this.ensureGlobalFabric(globalRoot);

      // Handle --url flag: mount and bind remote store
      if (context.args.url) {
        this.bindRemoteStoreToProject(context.target, context.args.url, globalRoot);
        return stageRan("store", [context.args.url], []);
      }

      const installed: string[] = [];

      // Check for unbound stores. Interactive installs can bind one immediately;
      // non-interactive installs only print the nudge and keep going.
      const unboundStores = unboundAvailableStores(context.target, globalRoot);
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

  private bindRemoteStoreToProject(
    projectRoot: string,
    url: string,
    globalRoot: string,
  ): string {
    const already = storeList(globalRoot).find((store) => store.remote === url);
    const mounted = already ?? mountStoreFromRemote(url, globalRoot);

    const binding = ensureStoreProjectBinding(projectRoot, mounted.alias, {
      globalRoot,
      suggestedRemote: url,
    });

    console.log("");
    console.log(
      paint.success(
        `bound store '${mounted.alias}' to project '${binding.active_project}' and set it as the write target.`,
      ),
    );
    return mounted.alias;
  }

  private async ensureGlobalFabric(globalRoot: string): Promise<boolean> {
    const globalConfig = loadGlobalConfig(globalRoot);
    if (globalConfig === null) {
      await runGlobalInstall({}, globalRoot);
      return true;
    }

    const personal = globalConfig.stores.find((store) => store.personal === true);
    if (personal !== undefined) {
      const personalDir = join(globalRoot, storeRelativePathForMount(personal));
      const identityPath = join(personalDir, "store.json");
      if (!existsSync(identityPath)) {
        initStore(
          personalDir,
          {
            store_uuid: personal.store_uuid,
            created_at: new Date().toISOString(),
            canonical_alias: personal.alias,
          },
        );
        syncStoreAliasLinks(globalRoot);
        console.log(paint.success(`repaired global personal store '${personal.alias}'.`));
        return false;
      }
      if (readStoreIdentity(personalDir) === null) {
        throw new Error(
          `global personal store '${personal.alias}' has an invalid store.json at ${identityPath}; ` +
            "run `fabric doctor --fix` or move the corrupt store aside before reinstalling",
        );
      }
      return false;
    }

    const alias = globalConfig.stores.some((store) => store.alias === "personal")
      ? `personal-${randomUUID().slice(0, 8)}`
      : "personal";
    const store_uuid = randomUUID();
    const mounted = { store_uuid, alias, mount_name: alias, personal: true };
    initStore(
      join(globalRoot, storeRelativePathForMount(mounted)),
      {
        store_uuid,
        created_at: new Date().toISOString(),
        canonical_alias: alias,
      },
    );
    saveGlobalConfig(addMountedStore(globalConfig, mounted), globalRoot);
    syncStoreAliasLinks(globalRoot);
    console.log(paint.success(`repaired global Fabric by creating personal store '${alias}'.`));
    return false;
  }

  private bindMountedStoreToProject(
    projectRoot: string,
    alias: string,
    globalRoot: string,
    projectId?: string,
  ): string {
    const binding = ensureStoreProjectBinding(projectRoot, alias, {
      globalRoot,
      requestedProjectId: projectId,
    });

    console.log("");
    console.log(
      paint.success(
        `bound store '${alias}' to project '${binding.active_project}' and set it as the write target.`,
      ),
    );
    return alias;
  }

  private bindCreatedStoreToProject(
    projectRoot: string,
    alias: string,
    options: { remote?: string; globalRoot: string },
  ): string {
    storeCreate(alias, new Date().toISOString(), {
      ...(options.remote === undefined ? {} : { remote: options.remote }),
      globalRoot: options.globalRoot,
    });
    const binding = ensureStoreProjectBinding(
      projectRoot,
      alias,
      options.remote === undefined
        ? { globalRoot: options.globalRoot }
        : { suggestedRemote: options.remote, globalRoot: options.globalRoot },
    );
    console.log("");
    console.log(
      paint.success(
        `created store '${alias}', bound it to project '${binding.active_project}', and set it as the write target.`,
      ),
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
    const projectId = await this.promptStoreProjectId(context.target, choice);
    return this.bindMountedStoreToProject(context.target, choice, globalRoot, projectId);
  }

  private async promptStoreProjectId(projectRoot: string, storeAlias: string): Promise<string | undefined> {
    const current = loadProjectConfig(projectRoot)?.active_project;
    const suggested = normalizeStoreProjectId(current ?? suggestStoreProjectId(projectRoot));
    const value = await text({
      message: `Project coordinate in store '${storeAlias}':`,
      initialValue: suggested,
      placeholder: suggested,
    });
    if (isCancel(value) || typeof value !== "string" || value.trim().length === 0) {
      return suggested;
    }
    return value;
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
      return `bound:${this.bindRemoteStoreToProject(projectRoot, url, globalRoot)}`;
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
    return `created:${this.bindCreatedStoreToProject(
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
}
