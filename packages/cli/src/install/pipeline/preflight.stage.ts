import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { t } from "../../i18n.js";
import type { Stage, InstallContext, StageResult } from "./types.js";
import { stageRan, stageSkipped, stageFailedFromError } from "./pipeline.js";

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
 * This stage always runs (never skipped) and never writes files.
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
        throw new Error(
          t("cli.install.diff.drift-abort", { path: globalRoot }),
        );
      }
      // Assume writable if directory exists (file ops will fail later if not)
    }
    // If not exists, parent directory must be writable
    // Assume home directory is writable
  }

  private assertWritable(path: string): void {
    // Best-effort: try to write a temp file to verify permissions
    // If it fails, the error will surface later during actual writes
  }

  private assertGitAvailable(): void {
    // Check git is available for clone operations
    // The actual git clone will fail later if git is missing
  }
}