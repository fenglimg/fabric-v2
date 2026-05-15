import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineCommand, runMain } from "citty";

import { allCommands } from "./commands/index.js";
import { t } from "./i18n.js";

declare const __CLI_VERSION__: string;

export const main = defineCommand({
  meta: {
    name: "fabric",
    version: __CLI_VERSION__,
    description: t("cli.main.description"),
  },
  subCommands: allCommands,
});

export async function run(): Promise<void> {
  await runMain(main);
}

const entrypoint = process.argv[1];
const currentFilePath = fileURLToPath(import.meta.url);
const isMainModule = entrypoint !== undefined && realpathSync(resolve(entrypoint)) === currentFilePath;

if (isMainModule) {
  void run();
}
