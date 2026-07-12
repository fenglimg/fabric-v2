import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ArgsDef, CommandDef } from "citty";
import { defineCommand, renderUsage, runCommand, runMain } from "citty";

import { allCommands } from "./commands/index.js";
import { renderAuditFilteredHelp } from "./commands/audit.js";
import { renderDoctorFilteredHelp } from "./commands/doctor.js";
import { renderTopLevelError, renderUnexpectedError } from "./lib/error-render.js";
import { t } from "./i18n.js";
import { formatSignpostMessage, resolveSignpost } from "./lib/command-signposts.js";

declare const __CLI_VERSION__: string;

export const main = defineCommand({
  meta: {
    name: "fabric",
    version: __CLI_VERSION__,
    description: t("cli.main.description"),
  },
  subCommands: allCommands,
});

// EPIC-009: Custom showUsage that filters doctor's advanced flags. Every other
// command — root included — renders through citty's standard renderUsage, so the
// root `fabric --help`, the subcommand-group helps (`fabric store --help`), and
// the leaf helps all share ONE renderer (no grouped/citty divergence). Command
// copy is i18n'd via each command's `meta.description` + arg descriptions.
async function customShowUsage<T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
  parent?: CommandDef<T>,
): Promise<void> {
  const cmdMeta = await (typeof cmd.meta === "function" ? cmd.meta() : cmd.meta);

  // EPIC-009: doctor subcommand gets filtered help (hides advanced/internal flags).
  if (cmdMeta?.name === "doctor" && parent !== undefined) {
    renderDoctorFilteredHelp();
    return;
  }

  // `audit --help` gets an i18n'd, flat-painted SUBCOMMANDS listing (metrics stays
  // hidden) instead of citty's English meta.description dump. Per-subcommand help
  // (`audit cite --help`) still falls through to citty's renderUsage below.
  if (cmdMeta?.name === "audit" && parent !== undefined) {
    renderAuditFilteredHelp();
    return;
  }

  // `store --help` lists only `list` (the user-facing read-only op); the other
  // create/bind/migrate/… operations carry meta.hidden because they are a
  // skill/CI/recovery API, not a daily-use surface. Append a folding note so a
  // human who lands here isn't left wondering where store setup went — without
  // it the bare `list`-only listing looks like store can't do anything else.
  if (cmdMeta?.name === "store" && parent !== undefined) {
    console.log(await renderUsage(cmd, parent) + "\n" + t("cli.store.help.folded-note") + "\n");
    return;
  }

  console.log(await renderUsage(cmd, parent) + "\n");
}

export async function run(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  // Tombstone retired top-level names (no silent aliases).
  const signpost = resolveSignpost(rawArgs[0]);
  if (signpost !== null) {
    const msg = formatSignpostMessage(signpost, (retired, successor) =>
      t("cli.signpost.retired", { retired, successor }),
    );
    console.error(msg);
    process.exit(1);
  }

  // A bare `fabric` (no args) is a command-group with no default action, so it
  // must render the root help instead of citty's "No command specified." error
  // (+ non-zero exit). Render the root usage directly and return cleanly (exit 0):
  // this is byte-identical to `fabric --help` (whose customShowUsage root branch
  // also falls through to renderUsage(main, undefined)), but without runMain's
  // process.exit(0) — a bare invocation asking for help is success, not an error.
  if (rawArgs.length === 0) {
    console.log((await renderUsage(main)) + "\n");
    return;
  }

  // Delegate --help / --version to citty's runMain verbatim — it owns the
  // subcommand-usage resolution + version print + clean exit. Gating matches
  // citty's own builtin-flag detection (the root command declares no args that
  // could shadow -h/-v).
  // EPIC-009: customShowUsage still filters doctor's advanced flags.
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
      await runMain(main, { rawArgs, showUsage: customShowUsage });
      return;
    }
    // W3-I ③: a genuinely-unexpected failure. Render a single themed error line
    // for the user; keep the full stack behind --debug / FABRIC_DEBUG=1 instead
    // of dumping the raw error object (the old `console.error(err, "\n")`).
    const showStack = rawArgs.includes("--debug") || process.env.FABRIC_DEBUG === "1";
    renderUnexpectedError(err, showStack);
    process.exit(1);
  }
}

const entrypoint = process.argv[1];
const currentFilePath = fileURLToPath(import.meta.url);
const isMainModule = entrypoint !== undefined && realpathSync(resolve(entrypoint)) === currentFilePath;

if (isMainModule) {
  void run();
}
