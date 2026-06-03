import { defineCommand } from "citty";

import { getProjectTranslator } from "../i18n.js";
import { warnUnknownFlags } from "../lib/unknown-flags.js";
import { whoami } from "../store/info-ops.js";

// v2.1.0-rc.1 P3 (F5): `fabric whoami` — machine uid + mounted stores.
export default defineCommand({
  meta: { name: "whoami", description: "Show this machine's Fabric uid and mounted stores" },
  args: {
    // F27: `--json` machine-readable output (was silently ignored — the command
    // declared no args, so citty swallowed the flag and still printed text).
    json: { type: "boolean", description: "Emit machine-readable JSON instead of text" },
  },
  run({ args }: { args: { json?: boolean } }) {
    warnUnknownFlags(["json"]);
    const info = whoami();
    if (args.json === true) {
      console.log(JSON.stringify(info, null, 2));
      return;
    }
    const t = getProjectTranslator();
    if (info === null) {
      console.log(t("cli.cmd.no-global-config"));
      return;
    }
    console.log(t("cli.whoami.uid", { uid: info.uid }));
    if (info.stores.length === 0) {
      console.log(t("cli.whoami.stores-none"));
      return;
    }
    console.log(t("cli.whoami.stores-label"));
    const localOnly = t("cli.shared.local-only");
    for (const store of info.stores) {
      console.log(`  ${store.alias}\t${store.store_uuid}${store.local_only ? `\t${localOnly}` : ""}`);
    }
  },
});
