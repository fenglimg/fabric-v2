import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineCommand, runCommand, runMain } from "citty";

import { allCommands } from "./commands/index.js";
import { renderTopLevelError } from "./lib/error-render.js";
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
  const rawArgs = process.argv.slice(2);

  // Delegate --help / --version to citty's runMain verbatim — it owns the
  // subcommand-usage resolution + version print + clean exit. Gating matches
  // citty's own builtin-flag detection (the root command declares no args that
  // could shadow -h/-v).
  const wantsHelp = rawArgs.some((arg) => arg === "--help" || arg === "-h");
  const wantsVersion = rawArgs.length === 1 && (rawArgs[0] === "--version" || rawArgs[0] === "-v");
  if (wantsHelp || wantsVersion) {
    await runMain(main, { rawArgs });
    return;
  }

  try {
    await runCommand(main, { rawArgs });
  } catch (err) {
    // ISS-030: surface a FabricError's actionHint (citty's default handler
    // prints only the message). renderTopLevelError handles the FabricError
    // shape; anything else falls through to citty's own usage/error rendering.
    if (renderTopLevelError(err) === "fabric-error") {
      process.exit(1);
    }
    // Unknown-command / arg-parse failures are citty CLIErrors raised during
    // resolution (before any command body runs), so re-dispatching through
    // runMain to reuse its usage rendering + exit semantics is side-effect-free.
    const code = err !== null && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
    if (typeof code === "string" && code.startsWith("E_")) {
      await runMain(main, { rawArgs });
      return;
    }
    console.error(err, "\n");
    process.exit(1);
  }
}

const entrypoint = process.argv[1];
const currentFilePath = fileURLToPath(import.meta.url);
const isMainModule = entrypoint !== undefined && realpathSync(resolve(entrypoint)) === currentFilePath;

if (isMainModule) {
  void run();
}
