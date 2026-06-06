import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ArgsDef, CommandDef } from "citty";
import { defineCommand, renderUsage, runCommand, runMain } from "citty";

import { allCommands } from "./commands/index.js";
import { renderDoctorFilteredHelp } from "./commands/doctor.js";
import { renderTopLevelError } from "./lib/error-render.js";
import { customShowUsageGrouped } from "./lib/grouped-help.js";
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

// EPIC-009 + EPIC-011: Custom showUsage that:
// 1. Renders grouped help for root command (EPIC-011)
// 2. Filters doctor command's hidden flags (EPIC-009)
async function customShowUsage<T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
  parent?: CommandDef<T>,
): Promise<void> {
  const cmdMeta = await (typeof cmd.meta === "function" ? cmd.meta() : cmd.meta);

  // EPIC-009: doctor subcommand gets filtered help
  if (cmdMeta?.name === "doctor" && parent !== undefined) {
    renderDoctorFilteredHelp();
    return;
  }

  // EPIC-011: root command gets grouped help
  if (cmdMeta?.name === "fabric" && parent === undefined) {
    await customShowUsageGrouped(cmd, parent, __CLI_VERSION__);
    return;
  }

  // Default: use citty's standard renderUsage for other subcommands
  console.log(await renderUsage(cmd, parent) + "\n");
}

export async function run(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  // Delegate --help / --version to citty's runMain verbatim — it owns the
  // subcommand-usage resolution + version print + clean exit. Gating matches
  // citty's own builtin-flag detection (the root command declares no args that
  // could shadow -h/-v).
  // EPIC-009: inject customShowUsage to filter doctor's hidden flags.
  const wantsHelp = rawArgs.some((arg) => arg === "--help" || arg === "-h");
  const wantsVersion = rawArgs.length === 1 && (rawArgs[0] === "--version" || rawArgs[0] === "-v");
  if (wantsHelp || wantsVersion) {
    await runMain(main, { rawArgs, showUsage: customShowUsage });
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
    // citty tags these with a `CLIError` name and codes like `EARG` (missing
    // required positional) / `EUSAGE` — NOT the `E_`-prefixed shape the original
    // check assumed, so a missing positional leaked citty's raw stack trace to
    // the user instead of a friendly usage block.
    const code = err !== null && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
    const isCittyUsageError =
      (err instanceof Error && err.name === "CLIError") ||
      (typeof code === "string" && (code.startsWith("E_") || code.startsWith("EARG") || code === "EUSAGE"));
    if (isCittyUsageError) {
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
