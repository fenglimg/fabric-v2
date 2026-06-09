import { displayWidth, padEnd } from "../colors.js";
import { t } from "../i18n.js";
import type { DetectedClientSupport } from "../config/resolver.js";
import type {
  InitOptions,
  InitStageDisposition,
  InitStageName,
  InitStageRecord,
} from "../commands/install.js";

type InitCapabilityRow = {
  client: string;
  bootstrap: string;
  mcp: string;
  hook: string;
  skill: string;
  followUp: string;
};

export function printInitPlanSummary(
  target: string,
  options: InitOptions,
  mcpInstallMode: string,
  supports: DetectedClientSupport[],
): void {
  console.log(t("cli.install.plan.title"));
  console.log(formatInitModeBanner(options));
  console.log(t("cli.install.plan.target", { target }));
  console.log(
    t("cli.install.plan.actions", {
      bootstrap: yesNoLabel(!options.skipBootstrap),
      mcp: yesNoLabel(!options.skipMcp),
      hooks: yesNoLabel(!options.skipHooks),
      mcpInstall: mcpInstallMode,
    }),
  );

  const detected = supports.filter((support) => support.detected);
  console.log(
    t("cli.install.plan.detected", {
      clients: detected.length > 0 ? detected.map((support) => support.label).join(", ") : t("cli.shared.none"),
    }),
  );
  console.log(t("cli.install.plan.writes"));
  console.log(`  - ${target}/.fabric/events.jsonl`);
  console.log(`  - ${target}/.fabric/forensic.json`);
  console.log(`  - ${target}/.fabric/fabric-config.json`);
}

export function printInitCapabilitySummary(
  supports: DetectedClientSupport[],
  stageResults: InitStageRecord[],
  options: InitOptions,
): void {
  const detected = supports.filter((support) => support.detected);
  if (detected.length === 0) {
    console.log(t("cli.install.capabilities.none"));
    return;
  }

  console.log(t("cli.install.capabilities.title"));
  const rows = detected.map((support) => toCapabilityRow(support, stageResults, options));
  const headers: InitCapabilityRow = {
    client: t("cli.install.capabilities.header.client"),
    bootstrap: t("cli.install.capabilities.header.bootstrap"),
    mcp: t("cli.install.capabilities.header.mcp"),
    hook: t("cli.install.capabilities.header.hook"),
    skill: t("cli.install.capabilities.header.skill"),
    followUp: t("cli.install.capabilities.header.follow-up"),
  };

  const widths = {
    client: Math.max(displayWidth(headers.client), ...rows.map((row) => displayWidth(row.client))),
    bootstrap: Math.max(displayWidth(headers.bootstrap), ...rows.map((row) => displayWidth(row.bootstrap))),
    mcp: Math.max(displayWidth(headers.mcp), ...rows.map((row) => displayWidth(row.mcp))),
    hook: Math.max(displayWidth(headers.hook), ...rows.map((row) => displayWidth(row.hook))),
    skill: Math.max(displayWidth(headers.skill), ...rows.map((row) => displayWidth(row.skill))),
    followUp: Math.max(displayWidth(headers.followUp), ...rows.map((row) => displayWidth(row.followUp))),
  };

  console.log(formatCapabilityTableRow(headers, widths));
  console.log(formatCapabilityDivider(widths));
  for (const row of rows) {
    console.log(formatCapabilityTableRow(row, widths));
  }
  console.log("");
  console.log(t("cli.install.restart-banner"));
}

export function formatInitReasonMessage(supports: DetectedClientSupport[]): string {
  const detected = supports.filter((support) => support.detected);

  if (detected.some((support) => support.capabilities.skill)) {
    return t("cli.install.reason-message.installable-body");
  }

  return t("cli.install.reason-message.manual-body");
}

function formatInitModeBanner(options: InitOptions): string {
  if (options.planOnly) {
    return t("cli.install.plan.mode-banner.plan");
  }

  return t("cli.install.plan.mode-banner.default");
}

function toCapabilityRow(
  support: DetectedClientSupport,
  stageResults: InitStageRecord[],
  options: InitOptions,
): InitCapabilityRow {
  const stage = (name: InitStageName): InitStageDisposition | null =>
    stageResults.find((entry) => entry.name === name)?.disposition ?? null;
  const bootstrap = support.capabilities.bootstrap
    ? capabilityStatus(options.skipBootstrap ? "skipped" : stage("bootstrap"))
    : t("cli.install.capabilities.status.na");
  const mcp = support.capabilities.mcp
    ? capabilityStatus(options.skipMcp ? "skipped" : stage("mcp"))
    : t("cli.install.capabilities.status.na");
  const hook = capabilityInstallStatus(support, "hook");
  const skill = capabilityInstallStatus(support, "skill");

  return {
    client: support.label,
    bootstrap,
    mcp,
    hook,
    skill,
    followUp: hasInstalledCapability(support, "skill")
      ? t("cli.install.capabilities.follow-up.ready")
      : support.capabilities.skill
        ? t("cli.install.capabilities.follow-up.install")
        : t("cli.install.capabilities.follow-up.manual"),
  };
}

function capabilityInstallStatus(
  support: DetectedClientSupport,
  capability: "hook" | "skill",
): string {
  if (!support.capabilities[capability]) {
    return t("cli.install.capabilities.status.na");
  }

  return hasInstalledCapability(support, capability)
    ? t("cli.install.capabilities.status.installed")
    : t("cli.install.capabilities.status.supported");
}

function hasInstalledCapability(
  support: DetectedClientSupport,
  capability: "hook" | "skill",
): boolean {
  return support.installedCapabilities?.[capability] === true;
}

function capabilityStatus(disposition: InitStageDisposition | "ran" | "skipped" | null): string {
  switch (disposition) {
    case "ran":
      return t("cli.install.capabilities.status.ready");
    case "skipped":
      return t("cli.install.capabilities.status.skipped");
    case "failed":
      return t("cli.install.capabilities.status.failed");
    case null:
      return t("cli.install.capabilities.status.na");
    default:
      return t("cli.install.capabilities.status.ready");
  }
}

function formatCapabilityTableRow(
  row: InitCapabilityRow,
  widths: Record<keyof InitCapabilityRow, number>,
): string {
  return [
    padEnd(row.client, widths.client),
    padEnd(row.bootstrap, widths.bootstrap),
    padEnd(row.mcp, widths.mcp),
    padEnd(row.hook, widths.hook),
    padEnd(row.skill, widths.skill),
    padEnd(row.followUp, widths.followUp),
  ].join("  ");
}

function formatCapabilityDivider(widths: Record<keyof InitCapabilityRow, number>): string {
  return [
    "".padEnd(widths.client, "-"),
    "".padEnd(widths.bootstrap, "-"),
    "".padEnd(widths.mcp, "-"),
    "".padEnd(widths.hook, "-"),
    "".padEnd(widths.skill, "-"),
    "".padEnd(widths.followUp, "-"),
  ].join("  ");
}

export function yesNoLabel(value: boolean): string {
  return value ? t("cli.shared.yes") : t("cli.shared.no");
}
