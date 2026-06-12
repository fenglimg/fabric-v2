import { confirm, isCancel, select, text } from "@clack/prompts";

import { paint } from "../colors.js";
import { t } from "../i18n.js";
import { enableSemanticSearch, renderSemanticSearchInstructions } from "./semantic-search.js";
import { mountStoreFromRemote } from "./run-global-install.js";
import { resolveGlobalRoot } from "../store/global-config-io.js";
import {
  storeBind,
  storeCreate,
  storeList,
  storeSetWriteRoute,
  storeSwitchWrite,
} from "../store/store-ops.js";
import { regenerateBindingsSnapshot } from "../store/bindings-io.js";
import { loadProjectConfig } from "../store/project-config-io.js";

/**
 * Idempotently enable vector semantic search (flip embed config) and print the
 * host-side install instructions. Shared by the `--enable-embed` flag path and
 * the interactive wizard step so both behave identically.
 */
export function enableSemanticSearchAndReport(projectRoot: string, model?: string): void {
  const enabled = enableSemanticSearch(projectRoot, model === undefined ? {} : { model });
  console.log("");
  if (enabled.alreadyEnabled) {
    console.log(
      paint.muted(
        t("cli.install.semantic.already-enabled", { model: enabled.model, path: enabled.configPath }),
      ),
    );
    return;
  }
  for (const line of renderSemanticSearchInstructions(enabled.model)) {
    console.log(line);
  }
}

/**
 * W5 (install embed step) — interactive "enable semantic search?" prompt. Off by
 * default; cancelling / declining is a clean no-op. The non-interactive
 * equivalent is the `--enable-embed` flag.
 */
export async function promptSemanticSearch(projectRoot: string): Promise<void> {
  const enable = await confirm({
    message: "Enable vector semantic search? (downloads an embedding model on first use)",
    initialValue: false,
  });
  if (isCancel(enable) || !enable) {
    return;
  }
  enableSemanticSearchAndReport(projectRoot);
}

/**
 * W1 (install --url top-level) — mount a shared store from a git remote, bind it
 * to this project, and set it as the active write target in one step.
 *
 * This is the "join my team's knowledge store" flow. The primitives already
 * existed as separate `store` subcommands (`add` / `bind` / `switch-write`);
 * install just wires them together so the common onboarding path is a single
 * command instead of three the user must sequence by hand.
 *
 * Idempotent: a re-run with the same remote reuses the already-mounted clone
 * (matched by `remote` url) rather than cloning again. The global config is
 * guaranteed to exist by the caller (runInitCommand mints it before the per-repo
 * pipeline), so the resolved global root always points at a valid install.
 *
 * `globalRoot` is injectable (mirrors `storeAdd` / `storeBind` convention) so the
 * flow is testable against an isolated global root.
 */
export async function bindRemoteStoreToProject(
  projectRoot: string,
  url: string,
  globalRoot: string = resolveGlobalRoot(),
): Promise<void> {
  const already = storeList(globalRoot).find((store) => store.remote === url);
  const mounted = already ?? mountStoreFromRemote(url, globalRoot);
  await storeBind(projectRoot, { id: mounted.alias, suggested_remote: url }, { globalRoot });
  storeSwitchWrite(projectRoot, mounted.alias, { globalRoot });
  const activeProject = loadProjectConfig(projectRoot)?.active_project;
  if (typeof activeProject === "string" && activeProject.length > 0) {
    storeSetWriteRoute(projectRoot, `project:${activeProject}`, mounted.alias, { globalRoot });
  }
  // Refresh the resolved-bindings snapshot so P4 hooks read a consistent
  // read-set / write-target without re-resolving (mirrors `store bind`).
  regenerateBindingsSnapshot(projectRoot, { now: new Date().toISOString(), globalRoot });
  console.log("");
  console.log(
    paint.success(
      `bound store '${mounted.alias}' to this project and set it as the write target.`,
    ),
  );
}

/**
 * W2 (install store onboarding) — create a brand-new LOCAL store, bind it to this
 * project, and set it as the active write target in one step. The "start a new
 * team store" counterpart to {@link bindRemoteStoreToProject} ("join an existing
 * one"). `remote`, when given, is wired into the new store's git repo so it can
 * push/pull later (F-SYNC-REMOTE).
 *
 * Composes the existing `store create` / `bind` / `switch-write` primitives so
 * the interactive install wizard's store step is a single call. `globalRoot` is
 * injectable for tests (mirrors the sibling helpers).
 */
export async function bindCreatedStoreToProject(
  projectRoot: string,
  alias: string,
  options: { remote?: string; globalRoot?: string } = {},
): Promise<void> {
  const globalRoot = options.globalRoot ?? resolveGlobalRoot();
  await storeCreate(alias, new Date().toISOString(), {
    ...(options.remote === undefined ? {} : { remote: options.remote }),
    globalRoot,
  });
  await storeBind(
    projectRoot,
    options.remote === undefined ? { id: alias } : { id: alias, suggested_remote: options.remote },
    { globalRoot },
  );
  storeSwitchWrite(projectRoot, alias, { globalRoot });
  const activeProject = loadProjectConfig(projectRoot)?.active_project;
  if (typeof activeProject === "string" && activeProject.length > 0) {
    storeSetWriteRoute(projectRoot, `project:${activeProject}`, alias, { globalRoot });
  }
  regenerateBindingsSnapshot(projectRoot, { now: new Date().toISOString(), globalRoot });
  console.log("");
  console.log(
    paint.success(
      `created store '${alias}', bound it to this project, and set it as the write target.`,
    ),
  );
}

/**
 * W2 (install store onboarding) — interactive "set up a team store" step.
 *
 * Runs in the post-setup phase (project config already scaffolded, so bind
 * works). Offers three branches: skip (personal-only, the default), join an
 * existing shared store from a git remote, or create a fresh local store
 * (optionally remote-backed). Each non-skip branch composes the existing store
 * primitives via {@link bindRemoteStoreToProject} / {@link bindCreatedStoreToProject}.
 *
 * Idempotent: skipped entirely when this project already has an active write
 * store (a re-install must not re-prompt). Cancelling any prompt is a clean
 * no-op — store onboarding is optional, never a gate (KT-DEC-0007).
 */
export async function promptStoreOnboarding(projectRoot: string): Promise<void> {
  const config = loadProjectConfig(projectRoot);
  if (typeof config?.active_write_store === "string" && config.active_write_store.length > 0) {
    return;
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
    return;
  }

  if (choice === "join") {
    const url = await text({
      message: "Shared store git remote (url):",
      placeholder: "git@github.com:org/knowledge.git",
    });
    if (isCancel(url) || typeof url !== "string" || url.length === 0) {
      return;
    }
    await bindRemoteStoreToProject(projectRoot, url);
    return;
  }

  const alias = await text({ message: "Local alias for the new store:", initialValue: "team" });
  if (isCancel(alias) || typeof alias !== "string" || alias.length === 0) {
    return;
  }
  const remote = await text({
    message: "Git remote to back it (optional — leave blank to skip):",
    placeholder: "git@github.com:org/knowledge.git",
  });
  const remoteStr =
    !isCancel(remote) && typeof remote === "string" && remote.length > 0 ? remote : undefined;
  await bindCreatedStoreToProject(projectRoot, alias, remoteStr === undefined ? {} : { remote: remoteStr });
}
