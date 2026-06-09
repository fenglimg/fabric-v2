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
        installed.push(fabricDir);
      }

      // Validate fabric-config.json
      const configPath = join(fabricDir, "fabric-config.json");
      if (!existsSync(configPath)) {
        errors.push("fabric-config.json missing");
      } else {
        installed.push(configPath);
      }

      // Validate events.jsonl
      const eventsPath = join(fabricDir, "events.jsonl");
      if (!existsSync(eventsPath)) {
        errors.push("events.jsonl missing");
      } else {
        installed.push(eventsPath);
      }

      // Print validation result
      if (errors.length === 0) {
        console.log(paint.success("Validation passed"));
      } else {
        console.log(paint.error(`Validation failed: ${errors.length} error(s)`));
        for (const error of errors) {
          console.log(paint.error(`  - ${error}`));
        }
      }

      if (errors.length > 0) {
        return stageFailedFromError("validate", new Error(errors.join("; ")));
      }

      return stageRan("validate", installed, skipped);
    } catch (error) {
      return stageFailedFromError("validate", error);
    }
  }
}
