import { execFileSync } from "node:child_process";
import { existsSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import type { ForensicReport } from "@fenglimg/fabric-shared";

import { t } from "../../i18n.js";
import { buildForensicReport } from "../../scanner/forensic.js";
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

      if (context.options.planOnly === true) {
        this.assertGlobalRootPlannable(context.state.globalRoot);
      } else {
        // Check global root is writable (or can be created)
        this.assertGlobalRootWritable(context.state.globalRoot);

        // Check target is writable
        this.assertWritable(target);
      }

      // Optional: check git availability (only needed for remote store operations)
      if (context.args.url) {
        this.assertGitAvailable();
      }

      // flat-design: run the project forensic scan HERE (stage 1) and render its
      // one-line summary, so the scan note sits directly under the command title —
      // before the stage list — instead of mid-column from the env stage. The
      // report is stashed for the env stage to reuse (no second 30k-file walk).
      // Skipped on dry-run (env is skipped too, so nothing consumes the report).
      if (context.options.planOnly !== true) {
        await this.scanAndReport(context, target);
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
      throw new Error(t("cli.install.preflight.error.no-home"));
    }
    return resolve(home, ".fabric");
  }

  private assertGlobalRootWritable(globalRoot: string): void {
    // If exists, check it's a directory and writable
    if (existsSync(globalRoot)) {
      if (!statSync(globalRoot).isDirectory()) {
        throw new Error(t("cli.install.preflight.error.not-dir", { path: globalRoot }));
      }
      this.assertWritable(globalRoot, t("cli.install.preflight.label.global-root"));
      return;
    }

    const parent = dirname(globalRoot);
    if (!existsSync(parent) || !statSync(parent).isDirectory()) {
      throw new Error(t("cli.install.preflight.error.parent-not-dir", { path: parent }));
    }
    this.assertWritable(parent, t("cli.install.preflight.label.global-root-parent"));
  }

  private assertGlobalRootPlannable(globalRoot: string): void {
    if (existsSync(globalRoot)) {
      if (!statSync(globalRoot).isDirectory()) {
        throw new Error(t("cli.install.preflight.error.not-dir", { path: globalRoot }));
      }
      return;
    }

    const parent = dirname(globalRoot);
    if (!existsSync(parent) || !statSync(parent).isDirectory()) {
      throw new Error(t("cli.install.preflight.error.parent-not-dir", { path: parent }));
    }
  }

  private assertWritable(path: string, label = t("cli.install.preflight.label.target")): void {
    const probePath = join(path, `.fabric-preflight-${process.pid}-${Date.now()}.tmp`);
    try {
      writeFileSync(probePath, "", { flag: "wx" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(t("cli.install.preflight.error.not-writable", { label, path, reason: message }));
    } finally {
      rmSync(probePath, { force: true });
    }
  }

  private assertGitAvailable(): void {
    try {
      execFileSync("git", ["--version"], { stdio: ["ignore", "ignore", "ignore"] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(t("cli.install.preflight.error.git-required", { reason: message }));
    }
  }

  /**
   * flat-design: build the project forensic scan (stage 1), stash it on
   * context.state for the env stage to reuse, and render the one-line scan summary
   * under the command title. The scan RESULT (framework + scale) is reported inside
   * the framed output via {@link renderScanSummary} — we no longer emit a separate
   * transient "scanning…" note to stderr: it sat ABOVE the "Fabric 安装" frame as an
   * orphan line and read as noise, while the framed summary already communicates the
   * scan happened.
   */
  private async scanAndReport(context: InstallContext, target: string): Promise<void> {
    const report = await buildForensicReport(target);
    context.state.forensicReport = report;
    if (process.stdout.isTTY === true) {
      this.renderScanSummary(context, report);
    }
  }

  /**
   * flat-design: ONE human line (framework + scale), routed through the renderer
   * so it stays in the buffered/ordered stream. The framework VERSION is suppressed
   * when it resolved to "unknown" (it read as a wart — "cocos-creator unknown 项目").
   */
  private renderScanSummary(context: InstallContext, report: ForensicReport): void {
    const kind = report.framework?.kind;
    const files = String(report.topology?.total_files ?? 0);
    const entries = String(report.entry_points?.length ?? 0);
    const known = Boolean(kind) && kind !== "unknown" && kind !== "none";
    let line: string;
    if (known) {
      const v = report.framework.version;
      const version = v && v !== "unknown" ? ` ${v}` : "";
      line = t("cli.install.scan.summary.framework", { framework: `${kind}${version}`, files, entries });
    } else {
      line = t("cli.install.scan.summary.plain", { files, entries });
    }
    if (context.renderer) {
      context.renderer.renderInfo(line);
    } else {
      console.log(`  ${line}`);
    }
  }
}
