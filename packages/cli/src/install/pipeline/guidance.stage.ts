import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { confirm, isCancel, select, text } from "@clack/prompts";

import { t } from "../../i18n.js";
import { paint } from "../../colors.js";
import { loadProjectConfig } from "../../store/project-config-io.js";
import {
  enableSemanticSearch,
  isSemanticSearchEnabled,
  renderSemanticSearchInstructions,
  DEFAULT_EMBED_MODEL_PIN,
} from "../semantic-search.js";
import { detectClientSupports } from "../../config/resolver.js";
import {
  storeCreate,
  storeBind,
  storeSwitchWrite,
  storeList,
} from "../../store/store-ops.js";
import { regenerateBindingsSnapshot } from "../../store/bindings-io.js";
import { mountStoreFromRemote } from "../run-global-install.js";
import { resolveGlobalRoot } from "../../store/global-config-io.js";
import type { Stage, InstallContext, StageResult, DetectedClientSupport } from "./types.js";
import { stageRan, stageFailedFromError } from "./pipeline.js";
import { assessFirstHitSync } from "../../store/first-hit.js";

// ---------------------------------------------------------------------------
// Guidance Stage
// ---------------------------------------------------------------------------

/**
 * Guidance stage: outputs next-step guidance and prompts.
 *
 * Responsibilities:
 * 1. Print "next steps" message
 * 2. Print surfaces.md reference
 * 3. Handle semantic search prompt (if --enable-embed or interactive)
 * 4. Print restart banner for MCP clients
 * 5. Print fabric_language hint
 * 6. Print capability summary table
 *
 * This stage always runs and provides user-facing output.
 */
export class GuidanceStage implements Stage {
  readonly name = "guidance" as const;

  async execute(context: InstallContext): Promise<StageResult> {
    try {
      const translate = ((context as { translate?: typeof t }).translate ?? t);
      // Skip guidance output if planOnly mode
      if (context.options.planOnly) {
        return stageRan("guidance", [], []);
      }

      // Handle semantic search
      if (context.args["enable-embed"]) {
        this.enableSemanticSearchAndReport(context.target, context.args["embed-model"]);
      } else if (context.wizardEnabled) {
        await this.promptSemanticSearch(context.target, context.args.verbose === true);
      }

      // flat-design (G6): collapse the diverging footer — semantic-status line +
      // 下一步 + restart banner + capability line — into ONE golden-action anchor.
      // The genuinely-next action after a successful install is restarting the
      // client so its MCP server loads; that is the anchor. The --reapply hint,
      // full onboarding list, surfaces.md pointer, restart detail and per-client
      // capability table all move under --verbose, where the detail was asked for.
      const finalSupports = detectClientSupports(context.target);
      // flat-design (G6): the golden "下一步 →" footer must be the LAST thing the
      // user sees — AFTER the summary card + completion line. So the guidance stage
      // no longer prints it inline (it runs mid-pipeline, before the summary);
      // instead it STASHES the footer lines, and the pipeline prints them at the
      // very end. The verbose per-client capability TABLE is reference detail (not
      // the call-to-action) and stays printed in-stage.
      const footer: string[] = [""];
      if (context.args.verbose === true) {
        footer.push(translate("cli.install.next-steps"));
        footer.push("");
        footer.push(paint.muted(translate("cli.install.guidance.more")));
        footer.push("");
        footer.push(translate("cli.install.restart-banner"));
        this.printCapabilitySummary(finalSupports, context);
      } else {
        footer.push(
          translate("cli.install.next-step.anchor", {
            action: translate("cli.install.next-step.restart"),
          }),
        );
        // Still surface the "no supported client detected" edge case — it means the
        // install cannot actually reach an AI client.
        if (finalSupports.filter((s) => s.detected).length === 0) {
          footer.push(translate("cli.install.capabilities.none"));
        }
      }
      // First-hit readiness CTA (empty/unbound is not install success).
      try {
        const hit = assessFirstHitSync(context.target);
        if (!hit.ok) {
          footer.push("");
          footer.push(paint.warn(`first-hit: ${hit.message}`));
          for (const r of hit.remediations.slice(0, 3)) {
            footer.push(paint.muted(`  → ${r}`));
          }
        }
      } catch {
        // never block install on readiness probe
      }
      context.state.guidanceFooter = footer;

      // rc.11 (this fix): unconditional resolved-bindings snapshot refresh as the
      // pipeline's finalize step. The store stage only refreshes on real bind /
      // create paths (via ensureStoreProjectBinding) — every other path (--yes
      // non-interactive, settled team+no-unbound, promptTeamSlot SKIP, a manually
      // removed snapshot) previously left `~/.fabric/state/bindings/*_resolved.json`
      // stale, so a user hand-edit of fabric-config.json (required_stores /
      // write_routes) never took effect and `rm` of the snapshot file was not
      // healed by re-running install. regenerateBindingsSnapshot has an internal
      // guard (no project_id / no resolveInput → null return), so it is a safe
      // no-op on an unbound project. Placing it here — the last stage — means the
      // config is stable and any bind path above has already run.
      regenerateBindingsSnapshot(context.target, {
        now: new Date().toISOString(),
        ...(context.state.globalRoot === undefined
          ? {}
          : { globalRoot: context.state.globalRoot }),
      });

      return stageRan("guidance", [], []);
    } catch (error) {
      return stageFailedFromError("guidance", error);
    }
  }

  private enableSemanticSearchAndReport(projectRoot: string, model?: string): void {
    const enabled = enableSemanticSearch(projectRoot, model === undefined ? {} : { model });
    console.log("");
    if (enabled.alreadyEnabled) {
      console.log(
        paint.muted(t("cli.install.semantic.already-enabled", { model: enabled.model, path: enabled.configPath })),
      );
      return;
    }
    // Non-interactive (--enable-embed) path: print header + full manual steps.
    for (const line of renderSemanticSearchInstructions(enabled.model)) {
      console.log(line);
    }
  }

  private async promptSemanticSearch(projectRoot: string, verbose: boolean): Promise<void> {
    // grill C-17: detect already-enabled BEFORE prompting. The old flow asked a
    // Yes/No unconditionally, then — after "yes" — discovered it was already on
    // and reported "nothing changed" (the anticlimax). Now: already on → silent,
    // no confirm. The disabled-case confirm below is byte-identical (C-07 red-line:
    // do not change clack logic when disabled).
    const current = isSemanticSearchEnabled(projectRoot);
    if (current.enabled) {
      // flat-design: an already-on status line is non-actionable footer noise;
      // surface it only under --verbose.
      if (verbose) {
        console.log("");
        console.log(
          paint.muted(
            t("cli.install.semantic.already-enabled", {
              model: current.model ?? DEFAULT_EMBED_MODEL_PIN,
              path: join(projectRoot, ".fabric", "fabric-config.json"),
            }),
          ),
        );
      }
      return;
    }
    const enable = await confirm({
      message: t("cli.install.semantic.prompt"),
      initialValue: false,
    });
    if (isCancel(enable) || !enable) {
      return;
    }
    const enabled = enableSemanticSearch(projectRoot);
    console.log("");
    if (enabled.alreadyEnabled) {
      console.log(
        paint.muted(t("cli.install.semantic.already-enabled", { model: enabled.model, path: enabled.configPath })),
      );
      return;
    }
    console.log(t("cli.install.semantic.enabled", { model: enabled.model }));
    // C1: offer to run the one host-side step (`npm i -g fastembed`) for the
    // user instead of dumping a wall of manual commands. Consent-gated — never
    // auto-run without a yes; a decline or failure falls back to the printed
    // manual steps. The model weights still download lazily on first recall.
    await this.offerInstallFastembed();
  }

  private async offerInstallFastembed(): Promise<void> {
    const proceed = await confirm({
      message: t("cli.install.semantic.offer-install"),
      initialValue: true,
    });
    if (isCancel(proceed) || !proceed) {
      this.printSemanticManualSteps();
      return;
    }
    console.log(t("cli.install.semantic.installing"));
    try {
      execFileSync("npm", ["i", "-g", "fastembed"], { stdio: ["ignore", "inherit", "inherit"] });
      console.log(paint.success(t("cli.install.semantic.installed")));
    } catch (error) {
      console.log(
        paint.warn(
          t("cli.install.semantic.install-failed", {
            reason: error instanceof Error ? error.message : String(error),
          }),
        ),
      );
      this.printSemanticManualSteps();
    }
  }

  private printSemanticManualSteps(): void {
    for (const line of t("cli.install.semantic.manual-steps").split("\n")) {
      console.log(line);
    }
  }

  private printCapabilitySummary(
    supports: DetectedClientSupport[],
    context: InstallContext,
  ): void {
    const detected = supports.filter((s) => s.detected);
    if (detected.length === 0) {
      console.log(t("cli.install.capabilities.none"));
      return;
    }

    // C-006 (TASK-004): the dense 4×6 ASCII capability table buried the summary
    // card's closing impression. By default print a single one-line summary and
    // let the summary card lead; the full per-client table only renders under
    // --verbose, where the user explicitly asked for the detail.
    if (context.args.verbose !== true) {
      console.log(t("cli.install.capabilities.summaryLine", { count: String(detected.length) }));
      return;
    }

    console.log(t("cli.install.capabilities.title"));

    // Print table headers
    const headers = {
      client: t("cli.install.capabilities.header.client"),
      bootstrap: t("cli.install.capabilities.header.bootstrap"),
      mcp: t("cli.install.capabilities.header.mcp"),
      hook: t("cli.install.capabilities.header.hook"),
      skill: t("cli.install.capabilities.header.skill"),
      followUp: t("cli.install.capabilities.header.follow-up"),
    };

    // Calculate column widths
    const widths = {
      client: Math.max(6, ...detected.map((s) => s.label.length)),
      bootstrap: Math.max(8, 8),
      mcp: Math.max(3, 3),
      hook: Math.max(4, 4),
      skill: Math.max(5, 5),
      followUp: Math.max(9, 9),
    };

    // Print header row
    const headerRow = [
      headers.client.padEnd(widths.client),
      headers.bootstrap.padEnd(widths.bootstrap),
      headers.mcp.padEnd(widths.mcp),
      headers.hook.padEnd(widths.hook),
      headers.skill.padEnd(widths.skill),
      headers.followUp.padEnd(widths.followUp),
    ].join("  ");
    console.log(headerRow);

    // Print divider
    const divider = [
      "".padEnd(widths.client, "-"),
      "".padEnd(widths.bootstrap, "-"),
      "".padEnd(widths.mcp, "-"),
      "".padEnd(widths.hook, "-"),
      "".padEnd(widths.skill, "-"),
      "".padEnd(widths.followUp, "-"),
    ].join("  ");
    console.log(divider);

    // Print rows for each client
    for (const support of detected) {
      const bootstrap = support.capabilities.bootstrap
        ? this.capabilityStatus(context.options.skipBootstrap ? "skipped" : "ran")
        : t("cli.install.capabilities.status.na");
      const mcp = support.capabilities.mcp
        ? this.capabilityStatus(context.options.skipMcp ? "skipped" : "ran")
        : t("cli.install.capabilities.status.na");
      const hook = this.capabilityInstallStatus(support, "hook");
      const skill = this.capabilityInstallStatus(support, "skill");

      const followUp = this.hasInstalledCapability(support, "skill")
        ? t("cli.install.capabilities.follow-up.ready")
        : support.capabilities.skill
          ? t("cli.install.capabilities.follow-up.install")
          : t("cli.install.capabilities.follow-up.manual");

      const row = [
        support.label.padEnd(widths.client),
        bootstrap.padEnd(widths.bootstrap),
        mcp.padEnd(widths.mcp),
        hook.padEnd(widths.hook),
        skill.padEnd(widths.skill),
        followUp.padEnd(widths.followUp),
      ].join("  ");
      console.log(row);
    }
  }

  private capabilityStatus(disposition: "ran" | "skipped" | "failed" | null): string {
    switch (disposition) {
      case "ran":
        return t("cli.install.capabilities.status.ready");
      case "skipped":
        return t("cli.install.capabilities.status.skipped");
      case "failed":
        return t("cli.install.capabilities.status.failed");
      case null:
        return t("cli.install.capabilities.status.na");
      default:
        return t("cli.install.capabilities.status.ready");
    }
  }

  private capabilityInstallStatus(
    support: DetectedClientSupport,
    capability: "hook" | "skill",
  ): string {
    if (!support.capabilities[capability]) {
      return t("cli.install.capabilities.status.na");
    }
    return this.hasInstalledCapability(support, capability)
      ? t("cli.install.capabilities.status.installed")
      : t("cli.install.capabilities.status.supported");
  }

  private hasInstalledCapability(
    support: DetectedClientSupport,
    capability: "hook" | "skill",
  ): boolean {
    return support.installedCapabilities?.[capability] === true;
  }
}
