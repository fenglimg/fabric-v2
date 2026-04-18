import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineCommand, runMain } from "citty";

import { allCommands } from "./commands/index.js";

export const main = defineCommand({
  meta: {
    name: "fab",
    version: "0.0.0",
    description: "Fabric CLI",
  },
  subCommands: allCommands,
});

export async function run(): Promise<void> {
  await runMain(main);
}

const entrypoint = process.argv[1];
const currentFilePath = fileURLToPath(import.meta.url);
const isMainModule = entrypoint !== undefined && resolve(entrypoint) === currentFilePath;

if (isMainModule) {
  void run();
}
