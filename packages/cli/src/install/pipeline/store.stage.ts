import { randomUUID } from "node:crypto";

import { initStore, resolveGlobalLocale, storeRelativePathForMount, type GlobalConfig } from "@fenglimg/fabric-shared";
import { isCancel, select, text } from "@clack/prompts";
import { join } from "node:path";

import { loadGlobalConfig, resolveGlobalRoot, saveGlobalConfig } from "../../store/global-config-io.js";
import { cloneGlobalPersonalFromRemote, mountStoreFromRemote, runGlobalInstall } from "../run-global-install.js";
import { t } from "../../i18n.js";
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
        // C4: first-ever global install — offer to clone an existing personal
        // store from a remote instead of always minting a fresh empty one.
        // Default (and every non-interactive path) stays the fresh local mint.
        const cloned = context.wizardEnabled
          ? await this.promptPersonalStoreOnboarding(globalRoot)
          : false;
        if (!cloned) {
          await runGlobalInstall({}, globalRoot);
        }
        context.state.globalConfigCreated = true;
      } else {
        await this.ensurePersonalStore(globalConfig, globalRoot);
      }

      // grill-6fixes (D1b): pick the single global language base tone once,
      // game-style, on first install (when unset). Persists to the global
      // config and is never asked again; `fabric config` changes it later.
      await this.ensureLanguageSelected(globalRoot, context);

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

  /**
   * grill-6fixes (D1b): the install-time language selector. Fires only in the
   * interactive wizard, and only when the global `language` is still unset
   * (first-ever install). The default pre-highlight follows the env-detected
   * locale (Chinese shell → zh-CN). Cancelling leaves it unset so resolvers
   * keep falling back to env detection until the user picks via `fabric config`.
   */
  private async ensureLanguageSelected(globalRoot: string, context: InstallContext): Promise<void> {
    if (!context.wizardEnabled) return;
    const config = loadGlobalConfig(globalRoot);
    if (config === null || config.language !== undefined) return;

    const picked = await select<"zh-CN" | "en">({
      message: t("cli.install.language.prompt"),
      options: [
        { value: "zh-CN", label: t("cli.install.language.option.zh-CN") },
        { value: "en", label: t("cli.install.language.option.en") },
      ],
      initialValue: resolveGlobalLocale(globalRoot),
    });
    if (isCancel(picked)) return;

    saveGlobalConfig({ ...config, language: picked }, globalRoot);
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
    console.log(paint.success(t("cli.install.store.bound-success", { alias: mounted.alias })));
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
    console.log(paint.success(t("cli.install.store.bound-success", { alias })));
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
    console.log(paint.success(t("cli.install.store.created-success", { alias })));
    return alias;
  }

  private async promptBindMountedStore(
    context: InstallContext,
    unboundStores: Array<{ alias: string; remote?: string }>,
    globalRoot: string,
  ): Promise<string | null> {
    const choice = await select({
      message: t("cli.install.store.bind-mounted.prompt"),
      initialValue: "skip",
      options: [
        ...unboundStores.map((store) => ({
          value: store.alias,
          label: store.alias,
          hint: store.remote ?? t("cli.install.store.local-store"),
        })),
        {
          value: "skip",
          label: t("cli.install.store.skip-label"),
          hint: t("cli.install.store.bind-mounted.skip-hint"),
        },
      ],
    });
    if (isCancel(choice) || choice === "skip" || typeof choice !== "string") {
      this.warnUnboundStores(unboundStores);
      return null;
    }
    const project = await text({
      message: t("cli.install.store.project-coordinate", { store: choice }),
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
      message: t("cli.install.store.onboard.prompt"),
      initialValue: "skip",
      options: [
        {
          value: "skip",
          label: t("cli.install.store.skip-label"),
          hint: t("cli.install.store.onboard.skip-hint"),
        },
        {
          value: "join",
          label: t("cli.install.store.onboard.join-label"),
          hint: t("cli.install.store.onboard.join-hint"),
        },
        {
          value: "create",
          label: t("cli.install.store.onboard.create-label"),
          hint: t("cli.install.store.onboard.create-hint"),
        },
      ],
    });
    if (isCancel(choice) || choice === "skip") {
      return null;
    }

    if (choice === "join") {
      const url = await text({
        message: t("cli.install.store.onboard.join-url"),
        placeholder: "git@github.com:org/knowledge.git",
      });
      if (isCancel(url) || typeof url !== "string" || url.length === 0) {
        return null;
      }
      return `bound:${await this.bindRemoteStoreToProject(projectRoot, url, globalRoot)}`;
    }

    const alias = await text({ message: t("cli.install.store.onboard.alias"), initialValue: "team" });
    if (isCancel(alias) || typeof alias !== "string" || alias.length === 0) {
      return null;
    }
    const remote = await text({
      message: t("cli.install.store.onboard.remote"),
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
      t("cli.install.store.unbound-note", {
        aliases: unboundStores.map((s) => `'${s.alias}'`).join(", "),
      }),
    );
    console.log(t("cli.install.store.unbound-hint", { first: unboundStores[0].alias }));
  }

  /**
   * C4: first-touch personal-store onboarding. Offers "create local (default)"
   * vs "clone existing from a remote". Returns true only when it cloned a
   * personal store AND wrote the global config (so the caller skips the fresh
   * mint). Default / cancel / clone-failure all return false → caller mints
   * fresh via runGlobalInstall. Never adds a keystroke to the non-interactive
   * path (only invoked when wizardEnabled).
   */
  private async promptPersonalStoreOnboarding(globalRoot: string): Promise<boolean> {
    const choice = await select({
      message: t("cli.install.store.personal.prompt"),
      initialValue: "new",
      options: [
        {
          value: "new",
          label: t("cli.install.store.personal.new-label"),
          hint: t("cli.install.store.personal.new-hint"),
        },
        {
          value: "clone",
          label: t("cli.install.store.personal.clone-label"),
          hint: t("cli.install.store.personal.clone-hint"),
        },
      ],
    });
    if (isCancel(choice) || choice !== "clone") {
      return false;
    }

    const url = await text({
      message: t("cli.install.store.personal.clone-url"),
      placeholder: "git@github.com:you/fabric-personal.git",
    });
    if (isCancel(url) || typeof url !== "string" || url.length === 0) {
      return false;
    }

    try {
      const { store_uuid } = cloneGlobalPersonalFromRemote(url, globalRoot);
      console.log("");
      console.log(paint.success(t("cli.install.store.personal.cloned-success", { uuid: store_uuid })));
      return true;
    } catch (error) {
      console.log(
        paint.warn(
          t("cli.install.store.personal.clone-failed", {
            reason: error instanceof Error ? error.message : String(error),
          }),
        ),
      );
      return false;
    }
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
