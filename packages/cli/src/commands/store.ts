import type { MountedStore } from "@fenglimg/fabric-shared";
import { defineCommand } from "citty";
import { join } from "node:path";

import { getProjectTranslator } from "../i18n.js";

import { regenerateBindingsSnapshot } from "../store/bindings-io.js";
import { backfillKnowledgeDir } from "../store/scope-backfill.js";
import { loadProjectConfig } from "../store/project-config-io.js";
import {
  promoteProjectToTeam,
  rescopeStore,
  type RescopeReport,
} from "../store/store-rescope.js";
import {
  assertStoreMountable,
  storeAdd,
  storeBind,
  storeCreate,
  storeExplain,
  storeGitRemote,
  storeList,
  storeProjectCreate,
  storeProjectList,
  storeRemove,
  storeSetWriteRoute,
  storeSwitchWrite,
  resolveStoreDir,
} from "../store/store-ops.js";
import {
  STORE_LAYOUT,
  loadGlobalConfig,
  resolveGlobalRoot,
} from "@fenglimg/fabric-shared";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — `fabric store` command group (S57/E4/S7).
// Presentation-only shell over store-ops (which holds the testable logic).
// ---------------------------------------------------------------------------

const listCommand = defineCommand({
  meta: { name: "list", description: "List mounted knowledge stores" },
  run() {
    const t = getProjectTranslator();
    const stores = storeList();
    if (stores.length === 0) {
      console.log(t("cli.store.none-mounted"));
      return;
    }
    const localOnly = t("cli.shared.local-only");
    for (const store of stores) {
      // F14 (W2-T4): the local-only label reflects the store repo's TRUE git
      // remote, not the config metadata. A store whose config records a remote
      // but whose repo has no `origin` (created before the F-SYNC-REMOTE fix, or
      // a personal store) is honestly shown as local-only.
      const realRemote = storeGitRemote(store.alias);
      console.log(
        `${store.alias}\t${store.mount_name ?? store.store_uuid}\t${store.store_uuid}\t${realRemote ?? localOnly}`,
      );
    }
  },
});

const addCommand = defineCommand({
  meta: { name: "add", description: "Mount a knowledge store into the global registry" },
  args: {
    uuid: { type: "string", required: true, description: "Intrinsic store UUID" },
    alias: { type: "string", required: true, description: "Local alias for this store" },
    "mount-name": { type: "string", description: "Stable local directory under ~/.fabric/stores/" },
    remote: { type: "string", description: "Git remote locator (omit for local-only)" },
  },
  async run({ args }) {
    // ADJ-NEWN-6: fail fast on a phantom mount (uuid with no on-disk tree)
    // instead of writing the registry entry and crashing later in `sync`.
    assertStoreMountable(args.uuid, undefined, args["mount-name"]);
    const store: MountedStore =
      args.remote === undefined
        ? {
            store_uuid: args.uuid,
            alias: args.alias,
            ...(args["mount-name"] === undefined ? {} : { mount_name: args["mount-name"] }),
          }
        : {
            store_uuid: args.uuid,
            alias: args.alias,
            ...(args["mount-name"] === undefined ? {} : { mount_name: args["mount-name"] }),
            remote: args.remote,
          };
    const next = storeAdd(store);
    const t = getProjectTranslator();
    console.log(
      t("cli.store.mounted", {
        alias: args.alias,
        count: String(next.stores.length),
      }),
    );
  },
});

const createCommand = defineCommand({
  meta: { name: "create", description: "Create a brand-new local knowledge store and mount it" },
  args: {
    alias: { type: "string", required: true, description: "Local alias for the new store" },
    "mount-name": { type: "string", description: "Stable local directory under ~/.fabric/stores/" },
    remote: { type: "string", description: "Git remote to associate (push target; optional)" },
  },
  async run({ args }) {
    const result = await storeCreate(args.alias, new Date().toISOString(), {
      ...(args["mount-name"] === undefined ? {} : { mountName: args["mount-name"] }),
      ...(args.remote === undefined ? {} : { remote: args.remote }),
    });
    const t = getProjectTranslator();
    console.log(
      t("cli.store.created", { alias: args.alias, uuid: result.store_uuid, dir: result.storeDir }) +
        (args.remote === undefined ? `\n${t("cli.store.created-local-hint")}` : ""),
    );
  },
});

const removeCommand = defineCommand({
  meta: { name: "remove", description: "Detach a store from the registry (does NOT delete it)" },
  args: {
    alias: { type: "positional", required: true, description: "Alias to detach" },
  },
  async run({ args }) {
    const { detached } = storeRemove(args.alias);
    const t = getProjectTranslator();
    console.log(
      detached === null
        ? t("cli.store.no-alias", { alias: args.alias })
        : t("cli.store.detached", { alias: args.alias }),
    );
  },
});

const explainCommand = defineCommand({
  meta: { name: "explain", description: "Explain how a store alias resolves" },
  args: {
    alias: { type: "positional", required: true, description: "Alias to explain" },
  },
  run({ args }) {
    const explanation = storeExplain(args.alias);
    console.log(
      explanation === null
        ? getProjectTranslator()("cli.store.no-alias", { alias: args.alias })
        : JSON.stringify(explanation, null, 2),
    );
  },
});

const bindCommand = defineCommand({
  meta: { name: "bind", description: "Declare a required store on this project's config" },
  args: {
    id: { type: "positional", required: true, description: "Store alias/UUID to require" },
    remote: { type: "string", description: "Suggested remote for clone onboarding" },
    project: {
      type: "string",
      description: "Bind this repo to a project:<id> in the store (must already exist)",
    },
  },
  async run({ args }) {
    const entry =
      args.remote === undefined ? { id: args.id } : { id: args.id, suggested_remote: args.remote };
    const projectRoot = process.cwd();
    const next = await storeBind(
      projectRoot,
      entry,
      args.project === undefined ? {} : { project: args.project },
    );
    console.log(
      getProjectTranslator(projectRoot)("cli.store.bound", {
        id: args.id,
        count: String(next.required_stores?.length ?? 0),
      }),
    );
    // Regenerate the resolved-bindings snapshot so P4 hooks read a consistent
    // read-set/write-target without re-resolving (P3→P4 chain, done_when).
    regenerateBindingsSnapshot(projectRoot, { now: new Date().toISOString() });
  },
});

const switchWriteCommand = defineCommand({
  meta: { name: "switch-write", description: "Set the default write store for non-personal scopes" },
  args: {
    alias: { type: "positional", required: true, description: "Alias of the store to write to" },
  },
  async run({ args }) {
    const projectRoot = process.cwd();
    storeSwitchWrite(projectRoot, args.alias);
    regenerateBindingsSnapshot(projectRoot, { now: new Date().toISOString() });
    console.log(getProjectTranslator(projectRoot)("cli.store.switch-write", { alias: args.alias }));
  },
});

const routeWriteCommand = defineCommand({
  meta: { name: "route-write", description: "Route a semantic scope to a writable shared store" },
  args: {
    scope: { type: "positional", required: true, description: "Semantic scope, e.g. team or project:fabric-v2" },
    alias: { type: "positional", required: true, description: "Alias of the shared store to write to" },
  },
  run({ args }) {
    const projectRoot = process.cwd();
    storeSetWriteRoute(projectRoot, args.scope, args.alias);
    console.log(`write route: ${args.scope} -> ${args.alias}`);
  },
});

// W1/A2 — store-internal project registry. `store project list <alias>` /
// `store project create <alias> <id>` enumerate / register the projects a store
// serves (the `<id>` segments forming `project:<id>` coordinates).
const projectListCommand = defineCommand({
  meta: { name: "list", description: "List projects registered in a store" },
  args: {
    store: { type: "positional", required: true, description: "Store alias/UUID" },
  },
  async run({ args }) {
    const projects = await storeProjectList(args.store);
    if (projects.length === 0) {
      console.log(`store '${args.store}' has no registered projects.`);
      return;
    }
    for (const p of projects) {
      console.log(`${p.id}${p.name === undefined ? "" : `\t${p.name}`}`);
    }
  },
});

const projectCreateCommand = defineCommand({
  meta: { name: "create", description: "Register a new project in a store" },
  args: {
    store: { type: "positional", required: true, description: "Store alias/UUID" },
    id: { type: "positional", required: true, description: "Project id (single [a-z0-9_-] segment)" },
    name: { type: "string", description: "Optional human-facing label" },
  },
  async run({ args }) {
    const project = await storeProjectCreate(args.store, args.id, new Date().toISOString(), {
      ...(args.name === undefined ? {} : { name: args.name }),
    });
    console.log(`registered project '${project.id}' in store '${args.store}'.`);
  },
});

const projectCommand = defineCommand({
  meta: { name: "project", description: "Manage the projects a store serves" },
  subCommands: {
    list: projectListCommand,
    create: projectCreateCommand,
  },
});

// W3/A5 — clean-slate scope backfill. Adds semantic_scope + visibility_store to
// existing entries and repairs dirty layer. Store-only: targets an explicit
// mounted store via `--store <alias>`, or the project's active write store.
const backfillScopeCommand = defineCommand({
  meta: {
    name: "backfill-scope",
    description: "Backfill semantic_scope + visibility_store on existing knowledge (repairs dirty layer)",
  },
  args: {
    store: { type: "string", description: "Backfill a mounted store's knowledge" },
    "dry-run": { type: "boolean", description: "Preview changes without writing" },
  },
  run({ args }) {
    const dryRun = args["dry-run"] === true;
    let knowledgeDir: string;
    let visibilityStore: string;
    const selectedStore =
      typeof args.store === "string" && args.store.length > 0
        ? args.store
        : loadProjectConfig(process.cwd())?.active_write_store;
    if (typeof selectedStore !== "string" || selectedStore.length === 0) {
      console.error(
        "no store selected for scope backfill; pass --store <alias> or run `fabric store switch-write <alias>`",
      );
      process.exitCode = 1;
      return;
    }
    {
      const storeDir = resolveStoreDir(selectedStore);
      if (storeDir === null) {
        console.error(`no mounted store '${selectedStore}'`);
        process.exitCode = 1;
        return;
      }
      knowledgeDir = join(storeDir, STORE_LAYOUT.knowledgeDir);
      visibilityStore = selectedStore;
    }
    const report = backfillKnowledgeDir(knowledgeDir, { visibilityStore, dryRun });
    if (report.changes.length === 0) {
      console.log(`scope backfill: nothing to do (${report.unchanged} already consistent).`);
      return;
    }
    console.log(
      `${dryRun ? "[dry-run] " : ""}scope backfill: ${report.changes.length} entr${report.changes.length === 1 ? "y" : "ies"} updated, ${report.unchanged} unchanged.`,
    );
    for (const c of report.changes) {
      console.log(`  ${c.id ?? "(no id)"}  [${c.changed.join(", ")}]`);
    }
  },
});

// W4/A7 — re-scope + promote. Resolve a mounted store's dir + visibility (the
// `personal` flag drives the R5#3 refusal inside rescopeStore).
function resolveStoreDirAndVisibility(
  aliasOrUuid: string,
): { dir: string; visibility: "shared" | "personal" } | null {
  const dir = resolveStoreDir(aliasOrUuid);
  if (dir === null) {
    return null;
  }
  const store = loadGlobalConfig(resolveGlobalRoot())?.stores.find(
    (s) => s.alias === aliasOrUuid || s.store_uuid === aliasOrUuid,
  );
  return { dir, visibility: store?.personal === true ? "personal" : "shared" };
}

function printRescopeReport(report: RescopeReport): void {
  const prefix = report.dryRun ? "[dry-run] " : "";
  if (report.changes.length === 0 && report.refusals.length === 0) {
    console.log(`re-scope: nothing to do (${report.unchanged} already at '${report.toScope}').`);
  } else if (report.changes.length > 0) {
    console.log(
      `${prefix}re-scope → ${report.toScope}: ${report.changes.length} entr${report.changes.length === 1 ? "y" : "ies"} updated, ${report.unchanged} unchanged.`,
    );
    for (const c of report.changes) {
      console.log(`  ${c.id ?? "(no id)"}  ${c.fromScope ?? "(none)"} → ${c.toScope}`);
    }
  }
  if (report.refusals.length > 0) {
    console.error(`${report.refusals.length} entr${report.refusals.length === 1 ? "y" : "ies"} refused:`);
    for (const r of report.refusals) {
      console.error(`  ${r.id ?? "(no id)"}: ${r.reason}`);
    }
    process.exitCode = 1;
  }
}

const rescopeCommand = defineCommand({
  meta: {
    name: "re-scope",
    description: "Rewrite knowledge entries' semantic_scope coordinate in a store",
  },
  args: {
    store: { type: "positional", required: true, description: "Target store alias or uuid" },
    to: { type: "string", required: true, description: "New semantic_scope (e.g. team, project:alpha)" },
    id: { type: "string", description: "Only the entry with this stable_id" },
    from: { type: "string", description: "Only entries currently at this semantic_scope" },
    "dry-run": { type: "boolean", description: "Preview changes without writing" },
  },
  async run({ args }) {
    const resolved = resolveStoreDirAndVisibility(args.store);
    if (resolved === null) {
      console.error(`no mounted store '${args.store}'`);
      process.exitCode = 1;
      return;
    }
    printRescopeReport(
      await rescopeStore(resolved.dir, args.to, {
        id: args.id,
        fromScope: args.from,
        storeVisibility: resolved.visibility,
        dryRun: args["dry-run"] === true,
      }),
    );
  },
});

const promoteCommand = defineCommand({
  meta: {
    name: "promote",
    description: "Promote project-scoped entries to team scope (project absorption)",
  },
  args: {
    store: { type: "positional", required: true, description: "Target store alias or uuid" },
    project: { type: "string", description: "Only this project's entries (default: all project:*)" },
    "dry-run": { type: "boolean", description: "Preview changes without writing" },
  },
  async run({ args }) {
    const resolved = resolveStoreDirAndVisibility(args.store);
    if (resolved === null) {
      console.error(`no mounted store '${args.store}'`);
      process.exitCode = 1;
      return;
    }
    printRescopeReport(
      await promoteProjectToTeam(resolved.dir, {
        projectId: args.project,
        storeVisibility: resolved.visibility,
        dryRun: args["dry-run"] === true,
      }),
    );
  },
});

export default defineCommand({
  meta: { name: "store", description: "Manage mounted Fabric knowledge stores" },
  subCommands: {
    list: listCommand,
    create: createCommand,
    add: addCommand,
    remove: removeCommand,
    explain: explainCommand,
    bind: bindCommand,
    "switch-write": switchWriteCommand,
    "route-write": routeWriteCommand,
    "backfill-scope": backfillScopeCommand,
    "re-scope": rescopeCommand,
    promote: promoteCommand,
    project: projectCommand,
  },
});
