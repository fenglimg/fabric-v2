import { t } from "../i18n.js";
import type { AgentsMdAction, InitWriteAction } from "../commands/install.js";
import { createdLabel, overwrittenLabel, skippedLabel } from "./install-labels.js";

export function formatInitPathAction(path: string, action: InitWriteAction): string {
  return t("cli.install.created-path", { label: labelForInitWriteAction(action), path });
}

// AGENTS.md uses a `preserved` action variant that no other plan path needs.
// Render it through the same i18n shell with a localized preserved label.
export function formatAgentsMdAction(path: string, action: AgentsMdAction): string {
  if (action === "preserved") {
    return t("cli.install.skipped-existing-path", { label: skippedLabel(), path });
  }
  return t("cli.install.created-path", { label: createdLabel(), path });
}

function labelForInitWriteAction(action: InitWriteAction): string {
  return action === "overwritten" ? overwrittenLabel() : createdLabel();
}
