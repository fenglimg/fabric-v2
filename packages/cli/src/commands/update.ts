import { defineCommand } from "citty";

import { paint } from "../colors.js";
import { resolveDevModeTarget } from "../dev-mode.js";
import { t } from "../i18n.js";
import { installMcpClients } from "./config.js";
import { installHooks } from "./hooks.js";

type UpdateArgs = {
  target?: string;
  mcp?: boolean;
  hooks?: boolean;
};

type UpdateStageName = "mcp" | "hooks";
type UpdateStageDisposition = "ran" | "skipped" | "failed";

type UpdateStageRecord = {
  name: UpdateStageName;
  disposition: UpdateStageDisposition;
};

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

function completedLabel(): string {
  return paint.success(t("cli.init.stages.completed"));
}

function skippedLabel(): string {
  return paint.muted(t("cli.init.stages.skipped"));
}

function failedLabel(): string {
  return paint.error(t("cli.init.stages.failed"));
}

function formatStageResult(
  stage: UpdateStageName,
  status: "completed" | "skipped",
  installedCount: number,
  skippedCount: number,
  note?: string,
): string {
  const label = status === "completed" ? completedLabel() : skippedLabel();
  const counts = `installed=${installedCount} skipped=${skippedCount}`;
  const suffix = note ? ` ${paint.muted(`(${note})`)}` : "";
  return `${label} ${stage}: ${counts}${suffix}`;
}

function formatStageFailure(stage: UpdateStageName, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${failedLabel()} ${stage}: ${message}`;
}

function printStageSummary(stageResults: UpdateStageRecord[]): void {
  const ran = stageResults.filter((s) => s.disposition === "ran").map((s) => s.name);
  const skipped = stageResults.filter((s) => s.disposition === "skipped").map((s) => s.name);
  const failed = stageResults.filter((s) => s.disposition === "failed").map((s) => s.name);

  console.log(`${paint.success(t("cli.init.stages.summary.ran"))}: ${ran.length > 0 ? ran.join(", ") : t("cli.shared.none")}`);
  console.log(`${paint.muted(t("cli.init.stages.summary.skipped"))}: ${skipped.length > 0 ? skipped.join(", ") : t("cli.shared.none")}`);
  console.log(`${paint.error(t("cli.init.stages.summary.failed"))}: ${failed.length > 0 ? failed.join(", ") : t("cli.shared.none")}`);
}

export const updateCommand = defineCommand({
  meta: {
    name: "update",
    description: t("cli.update.description"),
  },
  args: {
    target: {
      type: "string",
      description: t("cli.update.args.target.description"),
    },
    mcp: {
      type: "boolean",
      default: true,
      negativeDescription: t("cli.update.args.no-mcp.description"),
    },
    hooks: {
      type: "boolean",
      default: true,
      negativeDescription: t("cli.update.args.no-hooks.description"),
    },
  },
  async run({ args }: { args: UpdateArgs }) {
    const target = resolveDevModeTarget(args.target);
    const skipMcp = args.mcp === false;
    const skipHooks = args.hooks === false;

    const stageResults: UpdateStageRecord[] = [];

    if (skipMcp) {
      stageResults.push({ name: "mcp", disposition: "skipped" });
    } else {
      console.log(`${paint.ai(t("cli.shared.next"))} ${paint.muted(t("cli.init.stages.mcp"))}`);
      try {
        const result = await installMcpClients(target);
        if (result.details.length === 0) {
          console.log(formatStageResult("mcp", "skipped", 0, 0, t("cli.config.install.no-configs")));
          stageResults.push({ name: "mcp", disposition: "skipped" });
        } else {
          console.log(formatStageResult("mcp", "completed", result.installed.length, result.skipped.length));
          stageResults.push({ name: "mcp", disposition: "ran" });
        }
      } catch (error: unknown) {
        writeStderr(formatStageFailure("mcp", error));
        stageResults.push({ name: "mcp", disposition: "failed" });
      }
    }

    if (skipHooks) {
      stageResults.push({ name: "hooks", disposition: "skipped" });
    } else {
      console.log(`${paint.ai(t("cli.shared.next"))} ${paint.muted(t("cli.init.stages.hooks"))}`);
      try {
        const result = await installHooks(target);
        console.log(formatStageResult("hooks", "completed", result.installed.length, result.skipped.length));
        stageResults.push({ name: "hooks", disposition: "ran" });
      } catch (error: unknown) {
        writeStderr(formatStageFailure("hooks", error));
        stageResults.push({ name: "hooks", disposition: "failed" });
      }
    }

    printStageSummary(stageResults);
  },
});

export default updateCommand;
