import { paint } from "../colors.js";
import { t } from "../i18n.js";

export function createdLabel(): string {
  return paint.success(t("cli.shared.created"));
}

export function skippedLabel(): string {
  return paint.muted(t("cli.shared.skipped"));
}

export function nextLabel(): string {
  return paint.ai(t("cli.shared.next"));
}

export function reasonLabel(): string {
  return paint.human(t("cli.shared.reason"));
}

export function updatedLabel(): string {
  return paint.success(t("cli.shared.updated"));
}

export function overwrittenLabel(): string {
  return paint.warn(t("cli.install.label.overwritten"));
}

export function completedStageLabel(): string {
  return paint.success(t("cli.install.stages.completed"));
}

export function skippedStageLabel(): string {
  return paint.muted(t("cli.install.stages.skipped"));
}

export function failedStageLabel(): string {
  return paint.error(t("cli.install.stages.failed"));
}

export function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}
