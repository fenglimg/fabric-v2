import type { MountedStore } from "@fenglimg/fabric-shared";
import { defineCommand } from "citty";

import { getProjectTranslator } from "../i18n.js";
import { regenerateBindingsSnapshot } from "../store/bindings-io.js";
import {
  assertStoreMountable,
  storeAdd,
  storeBind,
  storeCreate,
  storeExplain,
  storeGitRemote,
  storeList,
  storeRemove,
  storeSwitchWrite,
} from "../store/store-ops.js";

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
    // F-MULTISTORE-UNWIRED: mounting registers metadata only — recall does not
    // yet read mounted stores. Warn so a mount isn't mistaken for live sharing.
    console.log(t("cli.store.experimental-unwired"));
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
    // F-MULTISTORE-UNWIRED: a created store isn't yet read by recall or pushed
    // by sync. Warn so it isn't mistaken for live team sharing.
    console.log(t("cli.store.experimental-unwired"));
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
  },
  run({ args }) {
    const entry =
      args.remote === undefined ? { id: args.id } : { id: args.id, suggested_remote: args.remote };
    const projectRoot = process.cwd();
    const next = storeBind(projectRoot, entry);
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
  },
});
