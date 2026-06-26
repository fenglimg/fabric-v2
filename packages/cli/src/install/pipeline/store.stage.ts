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
  personalStoreCandidates,
  storeCreate,
  storeList,
  storeProjectList,
  storeSwitchPersonal,
  teamStoreCandidates,
  type PersonalStoreCandidate,
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

      // TASK-004: re-affirm the first-install signal from the in-stage config
      // load (the authoritative `globalConfig === null` first-run check). Set
      // early in createInstallContext too, but pinned here so the store stage is
      // self-sufficient and the '首次设置中' context labels below stay in sync.
      const firstInstall = globalConfig === null;
      context.state.firstInstall = firstInstall;

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
          ? await this.promptLanguage(globalRoot, firstInstall)
          : undefined;

      if (globalConfig === null) {
        // C4: first-ever global install — offer to clone an existing personal
        // store from a remote instead of always minting a fresh empty one.
        // Default (and every non-interactive path) stays the fresh local mint.
        const cloned = context.wizardEnabled
          ? await this.promptPersonalStoreOnboarding(globalRoot, firstInstall)
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
        // A bind happened — a real change.
        return stageRan("store", [context.args.url], [], undefined, true);
      }

      const installed: string[] = [];

      // W2 dual-slot (TASK-002 / R6): regularize any pre-dual-slot config that
      // over-bound the team slot (>1 non-personal store) DOWN to exactly one
      // before rendering — the runtime safety net behind the schema's max-1
      // refinement. Clean-slate no-op (the live config already holds one); a
      // legacy >1 config is reduced (keep active_write_store's store, else first)
      // and re-saved so the rest of the flow sees the regularized read-set.
      this.migrateTeamSlotIfNeeded(context.target);

      // W2 dual-slot (TASK-002): the team slot is a single-select over ALL
      // team-type candidates (currently-bound highlighted + mounted-but-unbound
      // + join-from-remote / create-local / skip). Non-interactive installs still
      // render the slot status but only nudge instead of prompting.
      const candidates = teamStoreCandidates(context.target, globalRoot);
      if (!context.wizardEnabled) {
        // W2 dual-slot (TASK-002 / R8/R9): personal slot status is ALWAYS surfaced
        // — even on a fully-configured project the phase MUST speak, not go mute.
        await this.renderPersonalSlot(context, globalRoot);
        this.renderTeamSlotStatus(context, candidates);
        const unbound = candidates.filter((c) => !c.bound);
        if (unbound.length > 0) {
          this.warnUnboundStores(unbound);
        }
        // Non-interactive nudge path makes no change — never blocks the collapse.
        return stageRan("store", installed, [], undefined, false);
      }

      // TASK-004/Bug-B: an "actionable" team slot is a real decision — an unbound
      // team-type candidate exists OR nothing is bound yet. Only then do we prompt.
      const actionable = candidates.some((c) => !c.bound) || !candidates.some((c) => c.bound);
      if (!actionable) {
        // Settled (team bound, no unbound candidates): NO prompt. Render the slot
        // status through the (possibly buffered) renderer and return changed=false,
        // so a settled interactive re-install can still reach the end-pass collapse.
        await this.renderPersonalSlot(context, globalRoot);
        this.renderTeamSlotStatus(context, candidates);
        return stageRan("store", installed, [], undefined, false);
      }

      // TASK-004/Bug-B: a prompt IS about to fire. Flush any buffered render
      // context (slot status + prior phase visuals) LIVE first, so it is visible
      // ahead of the clack select that writes to stdout directly. Flushing also
      // abandons this run's end-pass collapse (the user has seen live output).
      context.flushRenderBuffer?.();
      await this.renderPersonalSlot(context, globalRoot);

      const outcome = await this.promptTeamSlot(context, candidates, globalRoot);
      if (outcome !== null) {
        installed.push(outcome);
      }
      return stageRan("store", installed, [], undefined, outcome !== null);
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
  private async promptLanguage(
    globalRoot: string,
    firstInstall = false,
  ): Promise<"zh-CN" | "en" | undefined> {
    const picked = await select<"zh-CN" | "en">({
      message: this.withFirstRunContext(t("cli.install.language.prompt"), firstInstall),
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
   * 语义 A (multi-personal): the PERSONAL slot, three-state by candidate count
   * (the grilled B shape — progressive disclosure, never nags a single-identity
   * user). The slot status is ALWAYS surfaced (the phase must speak):
   *   0 personal → "not set up yet" line (the mint/clone onboarding runs in the
   *     first-install path of execute(), so this is just status here).
   *   1 personal → silent status line — zero friction, the common case.
   *   ≥2 personal → status line for the active (or "none active yet"), AND in the
   *     wizard a single-select to pick the active among them (+ create-new / skip).
   * Personal switching is machine-wide (active_personal_store), distinct from the
   * team slot's per-project bind (KT-MOD-0001 / KT-DEC-0020).
   */
  private async renderPersonalSlot(context: InstallContext, globalRoot: string): Promise<void> {
    const candidates = personalStoreCandidates(globalRoot);
    if (candidates.length === 0) {
      this.emitInfo(context, t("cli.install.store.slot.personal.absent"));
      return;
    }
    if (candidates.length === 1) {
      this.emitInfo(
        context,
        t("cli.install.store.slot.personal.status", { alias: candidates[0].alias }),
      );
      return;
    }
    // ≥2 personal: surface the active (or none-active) status, then — only in the
    // wizard — offer the single-select to switch / add.
    const active = candidates.find((c) => c.active);
    this.emitInfo(
      context,
      active === undefined
        ? t("cli.install.store.slot.personal.multi-none", { count: String(candidates.length) })
        : t("cli.install.store.slot.personal.status", { alias: active.alias }),
    );
    if (context.wizardEnabled) {
      await this.promptPersonalSlotSwitch(context, candidates, globalRoot);
    }
  }

  /**
   * 语义 A (multi-personal): the ≥2-personal single-select — mirrors promptTeamSlot
   * but switches the MACHINE-WIDE active personal (storeSwitchPersonal → global
   * config) rather than a per-project bind. Rows: every mounted personal (the
   * active one highlighted, picking it is a no-op), then create-a-new-local-personal
   * and skip. The `switch:` / `__new__` / `skip` routing values stay English
   * (KT-GLD-0002 — only labels/messages are translated). Cloning an ADDITIONAL
   * personal from a remote is deferred (the first-touch clone in
   * promptPersonalStoreOnboarding already covers the new-machine restore case).
   */
  private async promptPersonalSlotSwitch(
    context: InstallContext,
    candidates: PersonalStoreCandidate[],
    globalRoot: string,
  ): Promise<void> {
    const NEW = "__new__";
    const SKIP = "skip";
    const active = candidates.find((c) => c.active);
    const choice = await select({
      message: t("cli.install.store.slot.personal.multi-prompt"),
      initialValue: active !== undefined ? `switch:${active.alias}` : SKIP,
      options: [
        ...candidates.map((store) => ({
          value: `switch:${store.alias}`,
          label: store.active
            ? t("cli.install.store.slot.personal.multi-active-label", { alias: store.alias })
            : t("cli.install.store.slot.personal.multi-switch-label", { alias: store.alias }),
          hint: store.remote ?? t("cli.install.store.local-store"),
        })),
        {
          value: NEW,
          label: t("cli.install.store.slot.personal.multi-new-label"),
          hint: t("cli.install.store.slot.personal.multi-new-hint"),
        },
        {
          value: SKIP,
          label: t("cli.install.store.skip-label"),
          hint: t("cli.install.store.onboard.skip-hint"),
        },
      ],
    });
    if (isCancel(choice) || choice === SKIP || typeof choice !== "string") {
      return;
    }

    if (choice.startsWith("switch:")) {
      const alias = choice.slice("switch:".length);
      // Picking the already-active personal is a no-op.
      if (active !== undefined && alias === active.alias) {
        return;
      }
      storeSwitchPersonal(alias, { globalRoot });
      console.log("");
      console.log(paint.success(t("cli.install.store.slot.personal.switched", { alias })));
      return;
    }

    // __new__ — mint a fresh local personal store and switch to it.
    const alias = await text({ message: t("cli.install.store.slot.personal.new-alias") });
    if (isCancel(alias) || typeof alias !== "string" || alias.length === 0) {
      return;
    }
    await storeCreate(alias, new Date().toISOString(), { personal: true, globalRoot });
    storeSwitchPersonal(alias, { globalRoot });
    console.log("");
    console.log(paint.success(t("cli.install.store.slot.personal.switched", { alias })));
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
   * TASK-004: on a first-ever install, prefix an extra interactive prompt
   * (language / personal-store onboarding) with a '首次设置中' context label so the
   * user knows these one-time questions only appear during first setup. A re-run
   * leaves the prompt copy untouched.
   */
  private withFirstRunContext(message: string, firstInstall: boolean): string {
    return firstInstall ? `${t("cli.install.store.firstRunContext")}\n${message}` : message;
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
    // flat-design store menu (user redesign): the currently-bound team is NOT a
    // separate "保持当前" row that duplicates a "跳过" row — the two are MERGED. The
    // SKIP row carries the keep-current semantics, its copy adapting to state:
    //   bound   → "保持当前: <alias> · 不改动" (skip == leave this team store as-is)
    //   unbound → "跳过 · 仅用 personal store" (skip == personal-only default)
    // Only the OTHER mounted-but-unbound team stores list as switchable "切到已挂载"
    // rows. (KT-MOD-0001: rows show real aliases, the SLOT is named by category;
    // KT-GLD-0002: bind:/skip routing keys stay English, only labels translate.)
    const switchable = candidates.filter((c) => !c.bound);
    const skipOption =
      boundCandidate !== undefined
        ? {
            value: SKIP,
            label: t("cli.install.store.slot.team.keep-label", { alias: boundCandidate.alias }),
            hint: t("cli.install.store.slot.team.keep-hint"),
          }
        : {
            value: SKIP,
            label: t("cli.install.store.skip-label"),
            hint: t("cli.install.store.onboard.skip-hint"),
          };
    const choice = await select({
      message: t("cli.install.store.slot.team.prompt"),
      // Keep-current / personal-only is the safe default whether or not a team is
      // bound — never silently re-bind on a bare Enter.
      initialValue: SKIP,
      options: [
        ...switchable.map((store) => ({
          value: `bind:${store.alias}`,
          label: t("cli.install.store.slot.team.switch-label", { alias: store.alias }),
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
        skipOption,
      ],
    });
    if (isCancel(choice) || choice === SKIP || typeof choice !== "string") {
      // SKIP while a team is bound = a deliberate keep-current no-op → no unbound
      // nag. With nothing bound, surface any mounted-but-unbound team stores.
      if (boundCandidate === undefined) {
        const unbound = candidates.filter((c) => !c.bound);
        if (unbound.length > 0) {
          this.warnUnboundStores(unbound);
        }
      }
      return null;
    }

    if (choice.startsWith("bind:")) {
      // The bound store is never a switchable row, so this is always a real switch.
      const alias = choice.slice("bind:".length);
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
  private async promptPersonalStoreOnboarding(
    globalRoot: string,
    firstInstall = false,
  ): Promise<boolean> {
    const choice = await select({
      message: this.withFirstRunContext(t("cli.install.store.personal.prompt"), firstInstall),
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

  /**
   * 语义 A (multi-personal): ensure the machine has AT LEAST ONE personal store —
   * mint a fresh one only when none exists. Existence is keyed on the
   * `personal === true` FLAG, not the literal alias "personal", because a machine
   * may now mount several personal stores under arbitrary aliases. The old
   * force-demote (rewriting every non-"personal"-aliased store to personal:false)
   * is GONE: it would clobber additional personal stores on every install, which
   * directly contradicts the multi-personal model. A config that already carries
   * ≥1 personal store is left entirely untouched.
   */
  private async ensurePersonalStore(config: GlobalConfig, globalRoot: string): Promise<void> {
    // Flag is authoritative: ANY personal:true store means the machine is set —
    // leave the whole config untouched (multi-personal: ≥1 personal:true is fine,
    // and we never demote a flagged personal).
    if (config.stores.some((store) => store.personal === true)) {
      return;
    }
    // Legacy repair: a store aliased "personal" but missing the flag (a pre-flag
    // config or a hand-edit) is promoted IN PLACE rather than minting a duplicate
    // "personal" store. Only fires when NO flagged personal exists.
    const legacyPersonal = config.stores.find((store) => store.alias === "personal");
    if (legacyPersonal !== undefined) {
      const nextStores = config.stores.map((store) =>
        store.alias === "personal" ? { ...store, personal: true } : store,
      );
      saveGlobalConfig({ ...config, stores: nextStores }, globalRoot);
      return;
    }
    const uuid = randomUUID();
    const mounted = { store_uuid: uuid, alias: "personal", mount_name: "personal", personal: true };
    await initStore(
      join(globalRoot, storeRelativePathForMount(mounted)),
      { store_uuid: uuid, created_at: new Date().toISOString(), canonical_alias: "personal" },
    );
    saveGlobalConfig({ ...config, stores: [mounted, ...config.stores] }, globalRoot);
  }
}
