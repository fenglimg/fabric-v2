import type { CommandDef, ArgsDef } from "citty";
import { allCommands } from "../commands/index.js";
import { t } from "../i18n.js";

/**
 * EPIC-011 / ux-w1-4 + ux-w1-7: grouped help for the fabric CLI.
 *
 * Help is DERIVED from `allCommands` (the single command registry) rather than a
 * hand-maintained whitelist. Before this, `context` and `metrics` were registered
 * but absent from the help groups — they floated invisibly. Deriving from the
 * registry means a newly-registered command can never silently float: it either
 * has a `COMMAND_META` entry (placed in a group) or falls through to the default
 * group, but it always surfaces.
 *
 * Commands marked `internal` are hook/skill-invoked RPCs (plan-context-hint,
 * onboard-coverage). They stay callable but are hidden from the human-facing
 * help.
 *
 * W3-F (NS-01 §2/§3.3): the visible 9 human-facing commands are organised on the
 * three knowledge-value axes — Knowledge (the store/sync heart), Project (single-
 * repo onboarding + inspection), Maintain (health + telemetry). `metrics` is no
 * longer a top-level command (it lives only as `audit metrics`), and the
 * `scope-explain` command is retired (merged into `info scope`).
 */

const GROUP_ORDER = ["Knowledge", "Project", "Maintain"] as const;
type Group = (typeof GROUP_ORDER)[number];
// Unmapped non-internal commands fall here so a newly-registered command can
// never silently float (the derivation test pins registry↔help in sync).
const DEFAULT_GROUP: Group = "Project";

interface CommandMeta {
  /** Display group. Omitted only when `internal` is true. */
  group?: Group;
  /** i18n key for the description. Omitted commands fall back to a derived label. */
  descriptionKey?: string;
  /** Hook/skill RPC — hidden from human help but still callable. */
  internal?: boolean;
}

// Classification of every command in `allCommands`. A command missing from this
// map still surfaces (DEFAULT_GROUP) so it never floats; the derivation test
// asserts the map and the registry stay in sync.
const COMMAND_META: Record<string, CommandMeta> = {
  // Knowledge — the store/sync heart of Fabric.
  store: { group: "Knowledge", descriptionKey: "cli.help.group.knowledge.store" },
  sync: { group: "Knowledge", descriptionKey: "cli.help.group.knowledge.sync" },
  // Project — single-repo onboarding, config, status, and injection inspection.
  install: { group: "Project", descriptionKey: "cli.help.group.project.install" },
  uninstall: { group: "Project" },
  config: { group: "Project", descriptionKey: "cli.help.group.project.config" },
  info: { group: "Project", descriptionKey: "cli.help.group.project.info" },
  inspect: { group: "Project", descriptionKey: "cli.help.group.project.inspect" },
  // Maintain — health + telemetry, kept cleanly separate (D1).
  doctor: { group: "Maintain", descriptionKey: "cli.help.group.maintain.doctor" },
  audit: { group: "Maintain", descriptionKey: "cli.help.group.maintain.audit" },
  // Internal RPCs — hidden from human help, invoked by hooks/skills.
  "plan-context-hint": { internal: true },
  "onboard-coverage": { internal: true },
};

interface CommandInfo {
  name: string;
  description: string;
}

interface CommandGroup {
  name: string;
  commands: CommandInfo[];
}

function describe(name: string, meta: CommandMeta | undefined): string {
  if (name === "uninstall") {
    return t("cli.uninstall.description").split("\n")[0] ?? "Uninstall Fabric";
  }
  if (meta?.descriptionKey) {
    return t(meta.descriptionKey);
  }
  return name;
}

/**
 * Build the visible (non-internal) command groups by iterating the registry.
 * Exported for the derivation test so the registry↔help contract is asserted.
 */
export function getGroupedCommands(): CommandGroup[] {
  const byGroup = new Map<Group, CommandInfo[]>();
  for (const group of GROUP_ORDER) {
    byGroup.set(group, []);
  }

  for (const name of Object.keys(allCommands)) {
    const meta = COMMAND_META[name];
    if (meta?.internal) {
      continue;
    }
    const group = meta?.group ?? DEFAULT_GROUP;
    byGroup.get(group)?.push({ name, description: describe(name, meta) });
  }

  return GROUP_ORDER.map((name) => ({ name, commands: byGroup.get(name) ?? [] })).filter(
    (g) => g.commands.length > 0,
  );
}

/**
 * Render the grouped help output.
 */
export function renderGroupedHelp(
  _cmd: CommandDef<ArgsDef>,
  _version: string,
): string {
  const groups = getGroupedCommands();

  const lines: string[] = [];

  // Header
  lines.push("fabric - Cross-client AI knowledge layer");
  lines.push("");
  lines.push(`First time? Run: fabric install`);
  lines.push("");

  // Command groups
  for (const group of groups) {
    lines.push(`${group.name}:`);
    for (const command of group.commands) {
      const name = command.name.padEnd(14);
      lines.push(`  ${name}${command.description}`);
    }
    lines.push("");
  }

  // Footer
  lines.push(`Run \`fabric <command> --help\` for details.`);

  return lines.join("\n");
}

/**
 * Custom showUsage that renders grouped help for the main command.
 * Exported as customShowUsageGrouped for use in index.ts.
 */
export async function customShowUsageGrouped<T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
  parent?: CommandDef<T>,
  version?: string,
): Promise<void> {
  // Check if this is the root command (no parent)
  const cmdMeta = await (typeof cmd.meta === "function" ? cmd.meta() : cmd.meta);

  if (cmdMeta?.name === "fabric" && parent === undefined) {
    // Root command: render grouped help
    const ver = version || cmdMeta?.version || "";
    console.log(renderGroupedHelp(cmd as CommandDef<ArgsDef>, ver));
  } else {
    // Subcommand: use default renderUsage (imported dynamically to avoid circular deps)
    const { renderUsage } = await import("citty");
    console.log(await renderUsage(cmd, parent) + "\n");
  }
}
