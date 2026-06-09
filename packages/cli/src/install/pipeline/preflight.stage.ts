import { execFileSync } from "node:child_process";
import { existsSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { t } from "../../i18n.js";
import type { Stage, InstallContext, StageResult } from "./types.js";
import { stageRan, stageFailedFromError } from "./pipeline.js";

// ---------------------------------------------------------------------------
// Preflight Stage
// ---------------------------------------------------------------------------

/**
 * Preflight stage: validates environment, permissions, and prerequisites.
 *
 * Checks:
 * 1. Target directory exists and is accessible
 * 2. Node.js version compatibility
 * 3. Git is available (for store operations)
 * 4. Write permissions to target and global root
 *
 * This stage always runs (never skipped) and only writes short-lived probe
 * files used to verify permissions before later stages mutate the project.
 * Failures here abort the entire pipeline.
 */
export class PreflightStage implements Stage {
  readonly name = "preflight" as const;

  async execute(context: InstallContext): Promise<StageResult> {
    const target = this.normalizeTarget(context.args.target ?? process.cwd());

    try {
      // Check target directory exists
      this.assertExistingDirectory(target);

      // Store normalized target in state
      context.target = target;
      context.state.globalRoot = this.resolveGlobalRoot();

      // Check global root is writable (or can be created)
      this.assertGlobalRootWritable(context.state.globalRoot);

      // Check target is writable
      this.assertWritable(target);

      // Optional: check git availability (only needed for remote store operations)
      if (context.args.url) {
        this.assertGitAvailable();
      }

      return stageRan("preflight", [], [target]);
    } catch (error) {
      return stageFailedFromError("preflight", error);
    }
  }

  private normalizeTarget(targetInput: string): string {
    return isAbsolute(targetInput) ? targetInput : resolve(process.cwd(), targetInput);
  }

  private assertExistingDirectory(target: string): void {
    if (!existsSync(target) || !statSync(target).isDirectory()) {
      throw new Error(t("cli.shared.target-invalid", { target }));
    }
  }

  private resolveGlobalRoot(): string {
    // Default global root: ~/.fabric
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    if (!home) {
      throw new Error("Cannot determine home directory for global root");
    }
    return resolve(home, ".fabric");
  }

  private assertGlobalRootWritable(globalRoot: string): void {
    // If exists, check it's a directory and writable
    if (existsSync(globalRoot)) {
      if (!statSync(globalRoot).isDirectory()) {
        throw new Error(`Global Fabric root is not a directory: ${globalRoot}`);
      }
      this.assertWritable(globalRoot, "Global Fabric root");
      return;
    }

    const parent = dirname(globalRoot);
    if (!existsSync(parent) || !statSync(parent).isDirectory()) {
      throw new Error(`Global Fabric root parent is not a directory: ${parent}`);
    }
    this.assertWritable(parent, "Global Fabric root parent");
  }

  private assertWritable(path: string, label = "Target"): void {
    const probePath = join(path, `.fabric-preflight-${process.pid}-${Date.now()}.tmp`);
    try {
      writeFileSync(probePath, "", { flag: "wx" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${label} is not writable: ${path} (${message})`);
    } finally {
      rmSync(probePath, { force: true });
    }
  }

  private assertGitAvailable(): void {
    try {
      execFileSync("git", ["--version"], { stdio: ["ignore", "ignore", "ignore"] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`git is required for --url installs but was not available: ${message}`);
    }
  }
}
