import { paint } from "../colors.js";
import { t } from "../i18n.js";
import type {
  InitOptions,
  InitStageDisposition,
  InitStageName,
  InitStageRecord,
} from "../commands/install.js";
import {
  completedStageLabel,
  failedStageLabel,
  nextLabel,
  skippedStageLabel,
} from "./install-labels.js";

export function formatInitStageHeader(message: string): string {
  return `${nextLabel()} ${paint.muted(message)}`;
}

export function formatInitStageResult(
  stage: InitStageName,
  status: "completed" | "skipped",
  installedCount: number,
  skippedCount: number,
  note?: string,
): string {
  const label = status === "completed" ? completedStageLabel() : skippedStageLabel();
  const counts = `installed=${installedCount} skipped=${skippedCount}`;
  const suffix = note ? ` ${paint.muted(`(${note})`)}` : "";
  return `${label} ${stage}: ${counts}${suffix}`;
}

export function formatInitStageFailure(stage: InitStageName, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${failedStageLabel()} ${stage}: ${message}`;
}

export function printInitStageSummary(stageResults: InitStageRecord[]): void {
  console.log(formatInitStageSummaryLine("ran", collectInitStageNames(stageResults, "ran")));
  console.log(formatInitStageSummaryLine("skipped", collectInitStageNames(stageResults, "skipped")));
  console.log(formatInitStageSummaryLine("failed", collectInitStageNames(stageResults, "failed")));
}

export function shouldPrintHooksNextStep(options: InitOptions, stageResults: InitStageRecord[]): boolean {
  return Boolean(options.skipHooks) || stageResults.some((stage) => stage.name === "hooks" && stage.disposition === "failed");
}

function formatInitStageSummaryLine(
  disposition: InitStageDisposition,
  stages: string[],
): string {
  const label = disposition === "ran"
    ? paint.success(t("cli.install.stages.summary.ran"))
    : disposition === "skipped"
      ? paint.muted(t("cli.install.stages.summary.skipped"))
      : paint.error(t("cli.install.stages.summary.failed"));
  return `${label}: ${stages.length > 0 ? stages.join(", ") : t("cli.shared.none")}`;
}

function collectInitStageNames(stageResults: InitStageRecord[], disposition: InitStageDisposition): string[] {
  return stageResults
    .filter((stage) => stage.disposition === disposition)
    .map((stage) => stage.name);
}
