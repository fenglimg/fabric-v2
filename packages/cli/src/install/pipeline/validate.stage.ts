import type { Stage, InstallContext, StageResult } from "./types.js";
import { stageRan, stageSkipped, stageFailedFromError } from "./pipeline.js";
import { validateHookPaths } from "../hooks-orchestrator.js";
import { writeInstallManifest } from "../write-install-manifest.js";
import { loadProjectConfig } from "../../store/project-config-io.js";
import { registerProject } from "../../store/project-registry-io.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

declare const __CLI_VERSION__: string | undefined;
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
 * 5. Record the install manifest (sha256 of every wholesale-written artifact)
 *    so `fabric doctor` can later detect drifted installed copies
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

      // Record what this install wrote, for doctor's install_copy_drift check.
      // KT-PIT-0030: this is a validation byproduct, NOT an install artifact —
      // it goes to skipped[] and leaves changed=false, so the end-pass collapse
      // heuristic (which keys off installed.length) still sees a clean re-run
      // as unchanged. A failed write returns null and is simply not reported:
      // a missing diagnostic record must never fail an otherwise-good install.
      const manifestRel = await writeInstallManifest(target);
      if (manifestRel !== null) {
        skipped.push(join(target, ...manifestRel.split("/")));
      }

      // Record WHERE Fabric now lives, so cross-project version overview has a
      // data source at all (nothing else on the machine maps a project to its
      // path). Twin of the deregistration in `fabric uninstall`.
      //
      // `target` is used verbatim — it is the root this install actually wrote
      // into. Re-deriving it via resolveProjectRoot would short-circuit on
      // CLAUDE_PROJECT_DIR and register the wrong repo when installing into
      // another checkout from inside an AI session.
      //
      // Deliberately absent from installed[]/skipped[]: those enumerate project
      // artifacts under `target`, and this file lives in ~/.fabric. Keeping it
      // out also leaves the collapse heuristic's inputs untouched (KT-PIT-0030).
      // A failed write is swallowed by registerProject — machine-level
      // bookkeeping must never fail an otherwise-good install.
      // project_id is OPTIONAL here on purpose: an install that binds no store
      // leaves fabric-config.json as `{}`. Gating registration on the id would
      // make exactly those projects invisible to the console — the failure this
      // registry exists to prevent.
      const projectId = loadProjectConfig(target)?.project_id;
      await registerProject({
        path: target,
        ...(typeof projectId === "string" && projectId.length > 0 ? { projectId } : {}),
        fabricVersion: typeof __CLI_VERSION__ === "string" ? __CLI_VERSION__ : "unknown",
      });

      // flat-design: the success path no longer prints a separate "安装校验通过 ✓(…)"
      // narration line — the `● 安装校验 ✓` stage line already reports it. Failures
      // still narrate the specific missing artifacts (actionable, not redundant).
      if (errors.length > 0) {
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
