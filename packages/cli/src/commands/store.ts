import type { MountedStore } from "@fenglimg/fabric-shared";
import { defineCommand } from "citty";

import { regenerateBindingsSnapshot } from "../store/bindings-io.js";
import {
  assertStoreMountable,
  storeAdd,
  storeBind,
  storeCreate,
  storeExplain,
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
    const stores = storeList();
    if (stores.length === 0) {
      console.log("(no stores mounted)");
      return;
    }
    for (const store of stores) {
      console.log(`${store.alias}\t${store.store_uuid}\t${store.remote ?? "(local-only)"}`);
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
    console.log(`mounted '${args.alias}' (${next.stores.length} store(s) total)`);
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
    console.log(
      `created store '${args.alias}' (${result.store_uuid}) at ${result.storeDir}` +
        (args.remote === undefined
          ? "\n(local-only — add a remote later with `git -C <storeDir> remote add origin <url>`)"
          : ""),
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
    console.log(
      detached === null
        ? `no store aliased '${args.alias}'`
        : `detached '${args.alias}' — on-disk store tree left intact (detach ≠ delete)`,
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
      explanation === null ? `no store aliased '${args.alias}'` : JSON.stringify(explanation, null, 2),
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
    const next = storeBind(process.cwd(), entry);
    console.log(`bound required store '${args.id}' (${next.required_stores?.length ?? 0} required)`);
    // Regenerate the resolved-bindings snapshot so P4 hooks read a consistent
    // read-set/write-target without re-resolving (P3→P4 chain, done_when).
    regenerateBindingsSnapshot(process.cwd(), { now: new Date().toISOString() });
  },
});

const switchWriteCommand = defineCommand({
  meta: { name: "switch-write", description: "Set the active write store for non-personal scopes" },
  args: {
    alias: { type: "positional", required: true, description: "Alias of the store to write to" },
  },
  run({ args }) {
    storeSwitchWrite(process.cwd(), args.alias);
    console.log(`active write store set to '${args.alias}' for this project`);
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
