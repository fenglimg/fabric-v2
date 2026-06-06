import { join } from "node:path";

import { loadGlobalConfig, resolveGlobalRoot } from "../../store/global-config-io.js";
import { runGlobalInstall } from "../run-global-install.js";
import { storeBind, storeSwitchWrite, unboundAvailableStores } from "../../store/store-ops.js";
import { regenerateBindingsSnapshot } from "../../store/bindings-io.js";
import { loadProjectConfig } from "../../store/project-config-io.js";
import { paint } from "../../colors.js";
import type { Stage, InstallContext, StageResult } from "./types.js";
import { stageRan, stageSkipped, stageFailedFromError } from "./pipeline.js";

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

      // Ensure global config exists
      const globalConfig = loadGlobalConfig(globalRoot);
      if (globalConfig === null) {
        await runGlobalInstall({}, globalRoot);
        context.state.globalConfigCreated = true;
      }

      // Handle --url flag: mount and bind remote store
      if (context.args.url) {
        this.bindRemoteStoreToProject(context.target, context.args.url, globalRoot);
        return stageRan("store", [context.args.url], []);
      }

      // Check for unbound stores and warn
      const unboundStores = unboundAvailableStores(context.target);
      if (unboundStores.length > 0) {
        this.warnUnboundStores(unboundStores);
      }

      return stageRan("store", [], []);
    } catch (error) {
      return stageFailedFromError("store", error);
    }
  }

  private bindRemoteStoreToProject(
    projectRoot: string,
    url: string,
    globalRoot: string,
  ): void {
    const { storeList, mountStoreFromRemote } = require("../run-global-install.js");

    const already = storeList(globalRoot).find((store: { remote: string }) => store.remote === url);
    const mounted = already ?? mountStoreFromRemote(url, globalRoot);

    storeBind(projectRoot, { id: mounted.alias, suggested_remote: url });
    storeSwitchWrite(projectRoot, mounted.alias);
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