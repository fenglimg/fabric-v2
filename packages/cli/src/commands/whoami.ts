import { defineCommand } from "citty";

import { whoami } from "../store/info-ops.js";

// v2.1.0-rc.1 P3 (F5): `fabric whoami` — machine uid + mounted stores.
export default defineCommand({
  meta: { name: "whoami", description: "Show this machine's Fabric uid and mounted stores" },
  run() {
    const info = whoami();
    if (info === null) {
      console.log("no global Fabric config — run `fabric install --global <url>` first");
      return;
    }
    console.log(`uid: ${info.uid}`);
    if (info.stores.length === 0) {
      console.log("stores: (none mounted)");
      return;
    }
    console.log("stores:");
    for (const store of info.stores) {
      console.log(`  ${store.alias}\t${store.store_uuid}${store.local_only ? "\t(local-only)" : ""}`);
    }
  },
});
