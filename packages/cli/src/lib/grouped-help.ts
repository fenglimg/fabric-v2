import type { CommandDef, ArgsDef } from "citty";
import { t } from "../i18n.js";

/**
 * EPIC-011: Grouped help display for fabric CLI.
 *
 * Commands are organized into logical groups:
 * - Setup: install, config
 * - Daily: sync, info
 * - Diagnostic: doctor
 * - Advanced: store, whoami, status, scope-explain (deprecated commands)
 */

interface CommandInfo {
  name: string;
  description: string;
  deprecated?: boolean;
  deprecatedNote?: string;
}

interface CommandGroup {
  name: string;
  commands: CommandInfo[];
}

/**
 * Get all subcommands with their metadata, organized into groups.
 */
function getGroupedCommands(): CommandGroup[] {
  const groups: CommandGroup[] = [
    {
      name: "Setup",
      commands: [
        { name: "install", description: t("cli.help.group.setup.install") },
        { name: "uninstall", description: t("cli.uninstall.description").split("\n")[0] ?? "Uninstall Fabric" },
        { name: "config", description: t("cli.help.group.setup.config") },
      ],
    },
    {
      name: "Daily",
      commands: [
        { name: "sync", description: t("cli.help.group.daily.sync") },
        { name: "info", description: t("cli.help.group.daily.info") },
      ],
    },
    {
      name: "Diagnostic",
      commands: [
        { name: "doctor", description: t("cli.help.group.diagnostic.doctor") },
      ],
    },
    {
      name: "Advanced",
      commands: [
        { name: "store", description: t("cli.help.group.advanced.store") },
        {
          name: "whoami",
          description: t("cli.help.group.advanced.whoami"),
          deprecated: true,
          deprecatedNote: t("cli.help.group.advanced.whoami.deprecated"),
        },
        {
          name: "status",
          description: t("cli.help.group.advanced.status"),
          deprecated: true,
          deprecatedNote: t("cli.help.group.advanced.status.deprecated"),
        },
        {
          name: "scope-explain",
          description: t("cli.help.group.advanced.scope-explain"),
          deprecated: true,
          deprecatedNote: t("cli.help.group.advanced.scope-explain.deprecated"),
        },
      ],
    },
  ];

  return groups;
}

/**
 * Render the grouped help output.
 */
export function renderGroupedHelp(
  cmd: CommandDef<ArgsDef>,
  version: string,
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
      let line = `  ${name}${command.description}`;
      if (command.deprecated) {
        line += ` (${command.deprecatedNote})`;
      }
      lines.push(line);
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
