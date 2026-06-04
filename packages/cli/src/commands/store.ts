import type { MountedStore } from "@fenglimg/fabric-shared";
import { defineCommand } from "citty";

import { getProjectTranslator } from "../i18n.js";
import { join } from "node:path";

import { regenerateBindingsSnapshot } from "../store/bindings-io.js";
import { backfillKnowledgeDir } from "../store/scope-backfill.js";
import { loadProjectConfig } from "../store/project-config-io.js";
import { migrateProjectKnowledge } from "../store/store-migrate.js";
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
  storeSwitchWrite,
  resolveStoreDir,
} from "../store/store-ops.js";
import { STORE_LAYOUT } from "@fenglimg/fabric-shared";

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
      const realRemote = storeGitRemote(store.store_uuid);
      console.log(`${store.alias}\t${store.store_uuid}\t${realRemote ?? localOnly}`);
    }
  },
});

const addCommand = defineCommand({
  meta: { name: "add", description: "Mount a knowledge store into the global registry" },
  args: {
    uuid: { type: "string", required: true, description: "Intrinsic store UUID" },
    alias: { type: "string", required: true, description: "Local alias for this store" },
    remote: { type: "string", description: "Git remote locator (omit for local-only)" },
  },
  run({ args }) {
    // ADJ-NEWN-6: fail fast on a phantom mount (uuid with no on-disk tree)
    // instead of writing the registry entry and crashing later in `sync`.
    assertStoreMountable(args.uuid);
    const store: MountedStore =
      args.remote === undefined
        ? { store_uuid: args.uuid, alias: args.alias }
        : { store_uuid: args.uuid, alias: args.alias, remote: args.remote };
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
    remote: { type: "string", description: "Git remote to associate (push target; optional)" },
  },
  run({ args }) {
    const result = storeCreate(args.alias, new Date().toISOString(), {
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
  run({ args }) {
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
  run({ args }) {
    const entry =
      args.remote === undefined ? { id: args.id } : { id: args.id, suggested_remote: args.remote };
    const projectRoot = process.cwd();
    const next = storeBind(
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
  meta: { name: "switch-write", description: "Set the active write store for non-personal scopes" },
  args: {
    alias: { type: "positional", required: true, description: "Alias of the store to write to" },
  },
  run({ args }) {
    const projectRoot = process.cwd();
    storeSwitchWrite(projectRoot, args.alias);
    console.log(getProjectTranslator(projectRoot)("cli.store.switch-write", { alias: args.alias }));
  },
});

const migrateCommand = defineCommand({
  meta: {
    name: "migrate",
    description:
      "Move project-local (dual-root) knowledge into the resolved write-target stores",
  },
  args: {
    "dry-run": {
      type: "boolean",
      description: "Preview the move without writing anything",
    },
  },
  run({ args }) {
    const projectRoot = process.cwd();
    const t = getProjectTranslator(projectRoot);
    const dryRun = args["dry-run"] === true;
    const report = migrateProjectKnowledge(projectRoot, { dryRun });

    if (report.items.length === 0 && report.skips.length === 0) {
      console.log(t("cli.store.migrate.none"));
      return;
    }

    console.log(
      dryRun
        ? t("cli.store.migrate.dry-run-header")
        : t("cli.store.migrate.applied-header", { count: String(report.items.length) }),
    );
    for (const item of report.items) {
      const id = item.newId ?? item.oldId ?? "(draft)";
      console.log(`  ${item.layer}/${item.type}  ${id}  →  ${item.alias}`);
      if (item.newId !== null && item.oldId !== null) {
        console.log(
          t("cli.store.migrate.remap-note", { oldId: item.oldId, newId: item.newId }),
        );
      }
    }
    if (report.skips.length > 0) {
      console.log(t("cli.store.migrate.skips-header", { count: String(report.skips.length) }));
      for (const skip of report.skips) {
        console.log(`  ${skip.source}: ${skip.reason}`);
      }
    }
    if (report.committed) {
      console.log(t("cli.store.migrate.committed"));
    }
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
  run({ args }) {
    const projects = storeProjectList(args.store);
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
  run({ args }) {
    const project = storeProjectCreate(args.store, args.id, new Date().toISOString(), {
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
// existing entries and repairs dirty layer. Targets the project's co-location
// knowledge by default, or a mounted store via `--store <alias>`.
const backfillScopeCommand = defineCommand({
  meta: {
    name: "backfill-scope",
    description: "Backfill semantic_scope + visibility_store on existing knowledge (repairs dirty layer)",
  },
  args: {
    store: { type: "string", description: "Backfill a mounted store's knowledge instead of the project" },
    "dry-run": { type: "boolean", description: "Preview changes without writing" },
  },
  run({ args }) {
    const dryRun = args["dry-run"] === true;
    let knowledgeDir: string;
    let visibilityStore: string;
    if (typeof args.store === "string" && args.store.length > 0) {
      const storeDir = resolveStoreDir(args.store);
      if (storeDir === null) {
        console.error(`no mounted store '${args.store}'`);
        process.exitCode = 1;
        return;
      }
      knowledgeDir = join(storeDir, STORE_LAYOUT.knowledgeDir);
      visibilityStore = args.store;
    } else {
      const projectRoot = process.cwd();
      knowledgeDir = join(projectRoot, ".fabric", "knowledge");
      visibilityStore = loadProjectConfig(projectRoot)?.active_write_store ?? "team";
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
    migrate: migrateCommand,
    "backfill-scope": backfillScopeCommand,
    project: projectCommand,
  },
});
