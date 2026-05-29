import type { MountedStore } from "@fenglimg/fabric-shared";
import { defineCommand } from "citty";

import { storeAdd, storeExplain, storeList, storeRemove } from "../store/store-ops.js";

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
    const store: MountedStore =
      args.remote === undefined
        ? { store_uuid: args.uuid, alias: args.alias }
        : { store_uuid: args.uuid, alias: args.alias, remote: args.remote };
    const next = storeAdd(store);
    console.log(`mounted '${args.alias}' (${next.stores.length} store(s) total)`);
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

export default defineCommand({
  meta: { name: "store", description: "Manage mounted Fabric knowledge stores" },
  subCommands: {
    list: listCommand,
    add: addCommand,
    remove: removeCommand,
    explain: explainCommand,
  },
});
