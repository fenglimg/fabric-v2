import type { Stage, InstallContext, StageResult } from "./types.js";
import { stageRan, stageSkipped, stageFailedFromError } from "./pipeline.js";
import { validateHookPaths } from "../hooks-orchestrator.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { t } from "../../i18n.js";
import { paint } from "../../colors.js";

// ---------------------------------------------------------------------------
// Validate Stage
// ---------------------------------------------------------------------------

/**
 * Validate stage: verifies installation completeness.
 *
 * Responsibilities:
 * 1. Validate hook paths exist
 * 2. Validate .fabric directory structure
 * 3. Validate fabric-config.json exists
 * 4. Validate events.jsonl exists
 *
 * This stage is never skipped and provides a final verification
 * before the guidance stage.
 */
export class ValidateStage implements Stage {
  readonly name = "validate" as const;

  async execute(context: InstallContext): Promise<StageResult> {
    if (context.options.planOnly === true) {
      return stageSkipped("validate", "dry-run: validation skipped because no files were written");
    }

    try {
      const target = context.target;
      const errors: string[] = [];
      // TASK-004/Bug-A: validate VERIFIES, it never installs. Present artifacts go
      // into skipped[] (honest per-phase display = 0 installed), and the stage is
      // changed=false so it never blocks the end-pass collapse.
      const installed: string[] = [];
      const skipped: string[] = [];

      // Validate hook paths
      const hookValidationResults = validateHookPaths(target);
      for (const result of hookValidationResults) {
        if (result.status === "error") {
          errors.push(`${result.step}: ${result.message}`);
        } else {
          skipped.push(result.path);
        }
      }

      // Validate .fabric directory
      const fabricDir = join(target, ".fabric");
      if (!existsSync(fabricDir)) {
        errors.push(".fabric directory missing");
      } else {
        skipped.push(fabricDir);
      }

      // Validate fabric-config.json
      const configPath = join(fabricDir, "fabric-config.json");
      if (!existsSync(configPath)) {
        errors.push("fabric-config.json missing");
      } else {
        skipped.push(configPath);
      }

      // Validate events.jsonl
      const eventsPath = join(fabricDir, "events.jsonl");
      if (!existsSync(eventsPath)) {
        errors.push("events.jsonl missing");
      } else {
        skipped.push(eventsPath);
      }

      // Print validation result as a localized checklist (grill C-15: a whole
      // "安装校验" phase used to collapse to one bare English line).
      if (errors.length === 0) {
        console.log(paint.success(t("cli.install.validate.passed")));
      } else {
        console.log(paint.error(t("cli.install.validate.failed", { count: String(errors.length) })));
        for (const error of errors) {
          console.log(paint.error(t("cli.install.validate.failed-item", { error })));
        }
      }

      if (errors.length > 0) {
        return stageFailedFromError("validate", new Error(errors.join("; ")));
      }

      return stageRan("validate", installed, skipped, undefined, false);
    } catch (error) {
      return stageFailedFromError("validate", error);
    }
  }
}
