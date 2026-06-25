import { randomUUID } from "node:crypto";

import {
  initStore,
  migrateRequiredStores,
  resolveGlobalLocale,
  storeRelativePathForMount,
  type FabricConfig,
  type GlobalConfig,
  type RequiredStoreEntry,
} from "@fenglimg/fabric-shared";
import { isCancel, select, text } from "@clack/prompts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { loadGlobalConfig, resolveGlobalRoot, saveGlobalConfig } from "../../store/global-config-io.js";
import { cloneGlobalPersonalFromRemote, mountStoreFromRemote, runGlobalInstall } from "../run-global-install.js";
import { refreshLocale, t } from "../../i18n.js";
import {
  storeCreate,
  storeList,
  storeProjectList,
  teamStoreCandidates,
  type TeamStoreCandidate,
} from "../../store/store-ops.js";
import { saveProjectConfig } from "../../store/project-config-io.js";
import { paint } from "../../colors.js";
import type { Stage, InstallContext, StageResult } from "./types.js";
import { stageRan, stageSkipped, stageFailedFromError } from "./pipeline.js";
import {
  ensureStoreProjectBinding,
  normalizeStoreProjectId,
  suggestStoreProjectId,
} from "../store-project-onboarding.js";

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

      // grill-6fixes (D1b) + language-first: pick the single global language
      // base tone as the VERY FIRST interactive prompt — before any personal /
      // team store onboarding — so the choice sets the tone for the rest of the
      // install. Only fires in the wizard and only when the global `language`
      // is still unset (first-ever install). On a first install the global
      // config does not exist yet, so the pick is captured in-memory here and
      // persisted by `persistLanguageSelection` below, once the config is
      // guaranteed to exist (freshly minted, cloned, or pre-existing).
      const pickedLanguage =
        context.wizardEnabled && globalConfig?.language === undefined
          ? await this.promptLanguage(globalRoot)
          : undefined;

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

      // Persist the language pick now that the global config exists, then
      // refresh the process locale so every subsequent stage / prompt renders
      // in the chosen tone within THIS same install run.
      this.persistLanguageSelection(globalRoot, pickedLanguage);

      // Handle --url flag: mount and bind remote store
      if (context.args.url) {
        await this.bindRemoteStoreToProject(
          context.target,
          context.args.url,
          globalRoot,
          context.interactive,
        );
        return stageRan("store", [context.args.url], []);
      }

      const installed: string[] = [];

      // W2 dual-slot (TASK-002 / R6): regularize any pre-dual-slot config that
      // over-bound the team slot (>1 non-personal store) DOWN to exactly one
      // before rendering — the runtime safety net behind the schema's max-1
      // refinement. Clean-slate no-op (the live config already holds one); a
      // legacy >1 config is reduced (keep active_write_store's store, else first)
      // and re-saved so the rest of the flow sees the regularized read-set.
      this.migrateTeamSlotIfNeeded(context.target);

      // W2 dual-slot (TASK-002 / R8/R9): personal slot status is ALWAYS surfaced
      // (the old implicit-and-hidden personal behavior is gone) — even on a
      // fully-configured project the phase MUST speak, not go mute. Single install
      // flow of skippable steps (KT-DEC-0017): language → personal slot → team slot.
      this.renderPersonalSlot(context, globalRoot);

      // W2 dual-slot (TASK-002): the team slot is a single-select over ALL
      // team-type candidates (currently-bound highlighted + mounted-but-unbound
      // + join-from-remote / create-local / skip). Non-interactive installs still
      // render the slot status (above) but only nudge instead of prompting.
      const candidates = teamStoreCandidates(context.target, globalRoot);
      if (!context.wizardEnabled) {
        this.renderTeamSlotStatus(context, candidates);
        const unbound = candidates.filter((c) => !c.bound);
        if (unbound.length > 0) {
          this.warnUnboundStores(unbound);
        }
        return stageRan("store", installed, []);
      }

      const outcome = await this.promptTeamSlot(context, candidates, globalRoot);
      if (outcome !== null) {
        installed.push(outcome);
      }
      return stageRan("store", installed, []);
    } catch (error) {
      return stageFailedFromError("store", error);
    }
  }

  /**
   * grill-6fixes (D1b): the install-time language selector, surfaced as the
   * first interactive prompt of the install (see execute()). Returns the picked
   * tone, or undefined on cancel (resolvers then keep falling back to env
   * detection until the user picks via `fabric config`). The default
   * pre-highlight follows the env-detected locale (Chinese shell → zh-CN).
   * Persistence is deferred to persistLanguageSelection so the pick can be
   * captured before the global config exists on a first-ever install.
   */
  private async promptLanguage(globalRoot: string): Promise<"zh-CN" | "en" | undefined> {
    const picked = await select<"zh-CN" | "en">({
      message: t("cli.install.language.prompt"),
      options: [
        { value: "zh-CN", label: t("cli.install.language.option.zh-CN") },
        { value: "en", label: t("cli.install.language.option.en") },
      ],
      initialValue: resolveGlobalLocale(globalRoot),
    });
    if (isCancel(picked)) return undefined;
    return picked;
  }

  /**
   * Persist the language pick onto the (now-guaranteed) global config and
   * refresh the process locale so the rest of THIS install run renders in the
   * chosen tone. No-op when nothing was picked (non-wizard / already set /
   * cancelled). refreshLocale() runs whenever a pick exists — even if the value
   * already matched — so the module-level translator, bound to the env locale
   * before the config carried `language`, picks up the persisted value.
   */
  private persistLanguageSelection(globalRoot: string, picked: "zh-CN" | "en" | undefined): void {
    if (picked === undefined) return;
    const config = loadGlobalConfig(globalRoot);
    if (config !== null && config.language !== picked) {
      saveGlobalConfig({ ...config, language: picked }, globalRoot);
    }
    refreshLocale();
  }

  /**
   * Shared bind tail (DRY): resolve which project this repo binds to inside
   * `alias` (git-suggested, silent in the common case), then run the ONE
   * function that mints `project_id`, registers the project in the store, sets
   * `active_project`, switches the write target, and writes the project
   * write-route — `ensureStoreProjectBinding`. All three onboarding paths
   * (join / create / bind-mounted) route through here so the project scope axis
   * is wired identically; previously only the bind-mounted path did, leaving a
   * fresh `install --url` / create flow with no `project_id` / `active_project`.
   *
   * Returns the resolved project id, or null when the user cancels the
   * disambiguation prompt (interactive ambiguity only).
   */
  private async bindStoreToProject(
    projectRoot: string,
    alias: string,
    globalRoot: string,
    options: { suggestedRemote?: string; interactive: boolean },
  ): Promise<string | null> {
    const project = await this.resolveProjectIdWithGuard(
      projectRoot,
      alias,
      globalRoot,
      options.interactive,
    );
    if (project === null) {
      return null;
    }
    await ensureStoreProjectBinding(projectRoot, alias, {
      globalRoot,
      requestedProjectId: project,
      ...(options.suggestedRemote === undefined ? {} : { suggestedRemote: options.suggestedRemote }),
    });
    return project;
  }

  private async bindRemoteStoreToProject(
    projectRoot: string,
    url: string,
    globalRoot: string,
    interactive: boolean,
  ): Promise<string> {
    const already = storeList(globalRoot).find((store) => store.remote === url);
    const mounted = already ?? mountStoreFromRemote(url, globalRoot);

    const bound = await this.bindStoreToProject(projectRoot, mounted.alias, globalRoot, {
      suggestedRemote: url,
      interactive,
    });
    if (bound === null) {
      // User cancelled the project disambiguation — leave the store mounted but
      // unbound; the unbound nudge surfaces it next run rather than forcing a
      // possibly-wrong project.
      this.warnUnboundStores([{ alias: mounted.alias }]);
      return mounted.alias;
    }

    console.log("");
    console.log(paint.success(t("cli.install.store.bound-success", { alias: mounted.alias })));
    return mounted.alias;
  }

  private async bindCreatedStoreToProject(
    projectRoot: string,
    alias: string,
    options: { remote?: string; globalRoot: string; interactive: boolean },
  ): Promise<string> {
    await storeCreate(alias, new Date().toISOString(), {
      ...(options.remote === undefined ? {} : { remote: options.remote }),
      globalRoot: options.globalRoot,
    });
    // A freshly-created store has no projects yet, so resolveProjectIdWithGuard
    // always returns the git-suggested id silently (never null here).
    await this.bindStoreToProject(projectRoot, alias, options.globalRoot, {
      ...(options.remote === undefined ? {} : { suggestedRemote: options.remote }),
      interactive: options.interactive,
    });
    console.log("");
    console.log(paint.success(t("cli.install.store.created-success", { alias })));
    return alias;
  }

  /**
   * W2 dual-slot (TASK-002 / R6): regularize a pre-dual-slot project config that
   * over-bound the team slot (>1 non-personal `required_stores`) down to exactly
   * one. The schema's max-1 `.superRefine` makes a >1 config FAIL the strict
   * `loadProjectConfig` parse, so this step reads the config file RAW (the
   * lenient JSON read below) to regularize it BEFORE any strict load runs:
   * `migrateRequiredStores` keeps the `active_write_store`'s store (else the
   * first declared team store) and drops the rest, then `saveProjectConfig`
   * re-validates the now-≤1 config. Pure no-op when the config already holds ≤1
   * team store (the clean-slate common case) or doesn't exist — it never
   * rewrites a healthy config and never throws on a legacy one.
   */
  private migrateTeamSlotIfNeeded(projectRoot: string): void {
    const raw = this.readProjectConfigRaw(projectRoot);
    if (raw === null) {
      return;
    }
    const migrated = migrateRequiredStores(raw);
    if (migrated.required_stores !== raw.required_stores) {
      saveProjectConfig(
        { ...(raw as FabricConfig), required_stores: migrated.required_stores },
        projectRoot,
      );
    }
  }

  /**
   * Lenient raw read of the project config JSON — no schema parse — so the
   * dual-slot migration can inspect a legacy >1-team config that the strict
   * schema (max-1 refine) would reject. Returns null when the file is absent or
   * unreadable; the caller treats that as "nothing to migrate".
   */
  private readProjectConfigRaw(
    projectRoot: string,
  ): { required_stores?: RequiredStoreEntry[]; active_write_store?: string } | null {
    const path = join(projectRoot, ".fabric", "fabric-config.json");
    if (!existsSync(path)) {
      return null;
    }
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return null;
    }
  }

  /**
   * W2 dual-slot (TASK-002 / R8): the PERSONAL slot status line — ALWAYS rendered
   * (the old implicit-and-hidden personal behavior is gone; the phase must speak
   * even on a fully-configured project). Personal is the machine-wide store
   * ("本机全局"), virtually always auto-managed, so this is a status row, not a
   * prompt. Routed through the TASK-001 unified renderer (renderInfo) when present,
   * falling back to console.log on the plain path.
   */
  private renderPersonalSlot(context: InstallContext, globalRoot: string): void {
    const personal = storeList(globalRoot).find((store) => store.personal === true);
    const line =
      personal === undefined
        ? t("cli.install.store.slot.personal.absent")
        : t("cli.install.store.slot.personal.status", { alias: personal.alias });
    this.emitInfo(context, line);
  }

  /**
   * W2 dual-slot (TASK-002): the TEAM slot status line (non-interactive + the
   * header above the interactive prompt). Names the slot by CATEGORY ("团队库 /
   * team-class") and shows the REAL bound alias — NEVER implying the store must be
   * aliased `team` (KT-MOD-0001 naming-axis trap). When nothing is bound the line
   * says so explicitly rather than going silent.
   */
  private renderTeamSlotStatus(context: InstallContext, candidates: TeamStoreCandidate[]): void {
    const bound = candidates.find((c) => c.bound);
    const line =
      bound === undefined
        ? t("cli.install.store.slot.team.empty")
        : t("cli.install.store.slot.team.status", { alias: bound.alias });
    this.emitInfo(context, line);
  }

  /**
   * Render an info line through the TASK-001 unified renderer when one is wired
   * (interactive installs), else fall back to a plain console.log (non-TTY / CI).
   * Single rendering path — no third bespoke render channel (grill C-13 / F4-1).
   */
  private emitInfo(context: InstallContext, message: string): void {
    if (context.renderer) {
      context.renderer.renderInfo(message);
    } else {
      console.log(message);
    }
  }

  /**
   * W2 dual-slot (TASK-002): the team slot's single-select. ONE prompt listing
   * EVERY team-type candidate — the currently-bound store (highlighted as the
   * default, picking it is a no-op), every mounted-but-unbound team store (a
   * switch), then join-from-remote / create-local / skip. The slot is named by
   * category, the rows show real aliases (KT-MOD-0001). Returns an install marker
   * (`bound:<alias>` / `created:<alias>`) or null on skip / cancel / no-op.
   */
  private async promptTeamSlot(
    context: InstallContext,
    candidates: TeamStoreCandidate[],
    globalRoot: string,
  ): Promise<string | null> {
    // Slot status header (also the only output on the non-interactive path).
    this.renderTeamSlotStatus(context, candidates);

    const JOIN = "__join__";
    const CREATE = "__create__";
    const SKIP = "skip";
    const boundCandidate = candidates.find((c) => c.bound);
    const choice = await select({
      message: t("cli.install.store.slot.team.prompt"),
      initialValue: boundCandidate !== undefined ? `bind:${boundCandidate.alias}` : SKIP,
      options: [
        ...candidates.map((store) => ({
          value: `bind:${store.alias}`,
          label: store.bound
            ? t("cli.install.store.slot.team.bound-label", { alias: store.alias })
            : t("cli.install.store.slot.team.switch-label", { alias: store.alias }),
          hint: store.remote ?? t("cli.install.store.local-store"),
        })),
        {
          value: JOIN,
          label: t("cli.install.store.onboard.join-label"),
          hint: t("cli.install.store.onboard.join-hint"),
        },
        {
          value: CREATE,
          label: t("cli.install.store.onboard.create-label"),
          hint: t("cli.install.store.onboard.create-hint"),
        },
        {
          value: SKIP,
          label: t("cli.install.store.skip-label"),
          hint: t("cli.install.store.onboard.skip-hint"),
        },
      ],
    });
    if (isCancel(choice) || choice === SKIP || typeof choice !== "string") {
      const unbound = candidates.filter((c) => !c.bound);
      if (unbound.length > 0) {
        this.warnUnboundStores(unbound);
      }
      return null;
    }

    if (choice.startsWith("bind:")) {
      const alias = choice.slice("bind:".length);
      // Picking the already-bound store is a no-op — the slot stays as-is.
      if (boundCandidate !== undefined && alias === boundCandidate.alias) {
        return null;
      }
      const bound = await this.bindStoreToProject(context.target, alias, globalRoot, {
        interactive: true,
      });
      if (bound === null) {
        this.warnUnboundStores(candidates.filter((c) => !c.bound));
        return null;
      }
      console.log("");
      console.log(paint.success(t("cli.install.store.bound-success", { alias })));
      return `bound:${alias}`;
    }

    if (choice === JOIN) {
      const url = await text({
        message: t("cli.install.store.onboard.join-url"),
        placeholder: "git@github.com:org/knowledge.git",
      });
      if (isCancel(url) || typeof url !== "string" || url.length === 0) {
        return null;
      }
      return `bound:${await this.bindRemoteStoreToProject(context.target, url, globalRoot, true)}`;
    }

    // CREATE — fresh local team-class store (optionally remote-backed). The
    // `initialValue: "team"` is only a DEFAULT alias suggestion the user can
    // overwrite; the team SLOT itself is category-named (KT-MOD-0001).
    const alias = await text({ message: t("cli.install.store.onboard.alias"), initialValue: "team" });
    if (isCancel(alias) || typeof alias !== "string" || alias.length === 0) {
      return null;
    }
    const remote = await text({
      message: t("cli.install.store.onboard.remote"),
      placeholder: "git@github.com:org/knowledge.git",
    });
    const remoteStr =
      !isCancel(remote) && typeof remote === "string" && remote.length > 0 ? remote : undefined;
    return `created:${await this.bindCreatedStoreToProject(
      context.target,
      alias,
      remoteStr === undefined
        ? { globalRoot, interactive: true }
        : { remote: remoteStr, globalRoot, interactive: true },
    )}`;
  }

  /**
   * grill-6fixes (D6): pick which project this repo binds to inside `alias`.
   * Default is the git-repo-derived id, applied SILENTLY in the common case
   * (the store has no projects yet, or the git id already matches an existing
   * one). The user is asked ONLY on genuine ambiguity — the store already
   * enumerates projects AND the git id matches none of them — the one case
   * where silently auto-creating would fork a parallel project away from the
   * team's existing one. Returns the resolved project id, or null on cancel.
   *
   * `interactive` gates the disambiguation prompt: non-interactive flows (e.g.
   * `install --url` in CI) never block — they fall back to the deterministic
   * git-suggested id instead of stalling on a clack prompt with no TTY.
   */
  private async resolveProjectIdWithGuard(
    projectRoot: string,
    alias: string,
    globalRoot: string,
    interactive: boolean,
  ): Promise<string | null> {
    const suggested = suggestStoreProjectId(projectRoot);
    const existing = await storeProjectList(alias, globalRoot);

    if (existing.length === 0 || existing.some((project) => project.id === suggested)) {
      return suggested;
    }

    if (!interactive) {
      return suggested;
    }

    const NEW_PROJECT = "__new_project__";
    const picked = await select<string>({
      message: t("cli.install.store.project-pick.prompt", { store: alias }),
      initialValue: NEW_PROJECT,
      options: [
        ...existing.map((project) => ({
          value: project.id,
          label: t("cli.install.store.project-pick.join", {
            name: project.name ?? project.id,
            id: project.id,
          }),
        })),
        { value: NEW_PROJECT, label: t("cli.install.store.project-pick.new", { id: suggested }) },
      ],
    });
    if (isCancel(picked)) return null;
    if (picked !== NEW_PROJECT) return picked;

    const entered = await text({
      message: t("cli.install.store.project-pick.new-name"),
      initialValue: suggested,
    });
    if (isCancel(entered) || typeof entered !== "string" || entered.length === 0) {
      return null;
    }
    return normalizeStoreProjectId(entered);
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
