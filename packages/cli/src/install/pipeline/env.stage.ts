import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { atomicWriteJson } from "@fenglimg/fabric-shared/node/atomic-write";
import { log } from "@clack/prompts";

import { resolveGlobalLocale } from "@fenglimg/fabric-shared";

import { t } from "../../i18n.js";
import { buildForensicReport } from "../../scanner/forensic.js";
import { detectClientSupports } from "../../config/resolver.js";
import type { Stage, InstallContext, StageResult, ScaffoldResult, DiffFileState, InitWriteAction } from "./types.js";
import { stageRan, stageSkipped, stageFailedFromError } from "./pipeline.js";

// ---------------------------------------------------------------------------
// Env Stage
// ---------------------------------------------------------------------------

/**
 * Environment stage: sets up the project environment.
 *
 * Responsibilities:
 * 1. Detect client supports (Claude Code, Codex)
 * 2. Create .fabric directory structure
 * 3. Write fabric-config.json with detected language
 * 4. Write .gitignore for Fabric artifacts
 * 5. Create events.jsonl ledger
 * 6. Write forensic.json snapshot
 * 7. Detect and store fabric_language preference
 *
 * This stage is never skipped in a normal install flow.
 */
export class EnvStage implements Stage {
  readonly name = "env" as const;

  async execute(context: InstallContext): Promise<StageResult> {
    const target = context.target;

    try {
      // Detect client supports
      const clientSupports = detectClientSupports(target);
      context.state.clientSupports = clientSupports;

      // Build scaffold plan
      const scaffold = await this.buildScaffoldPlan(target, context.options);
      context.state.scaffold = scaffold;

      if (context.options.planOnly === true) {
        const fabricLanguage = this.readFabricLanguagePreference(target);
        context.state.fabricLanguage = fabricLanguage;
        return stageSkipped("env", "dry-run: scaffold planned without writing files");
      }

      // Execute scaffold (create directories and files)
      const created = await this.executeScaffold(scaffold, target);

      // Detect and store language preference
      const fabricLanguage = this.readFabricLanguagePreference(target);
      context.state.fabricLanguage = fabricLanguage;

      const installed = [
        scaffold.fabricDir,
        scaffold.eventsPath,
        scaffold.forensicPath,
      ].filter((p) => existsSync(p));

      return stageRan("env", installed, [], created);
    } catch (error) {
      return stageFailedFromError("env", error);
    }
  }

  private async buildScaffoldPlan(
    target: string,
    _options: InstallContext["options"],
  ): Promise<ScaffoldResult> {
    const fabricDir = join(target, ".fabric");
    const agentsMdPath = join(target, "AGENTS.md");
    const eventsPath = join(fabricDir, "events.jsonl");
    const forensicPath = join(fabricDir, "forensic.json");

    // Classify existing paths
    const eventsState = this.classifyPath(eventsPath, "presence");
    const forensicState = this.classifyPath(forensicPath, "always-rewrite");

    const agentsMdAction: "created" | "preserved" = existsSync(agentsMdPath)
      ? "preserved"
      : "created";

    // Build forensic report
    const showScanProgress = process.stderr.isTTY === true;
    if (showScanProgress) {
      process.stderr.write(`${t("cli.install.scanning")}\n`);
    }
    const forensicReport = await buildForensicReport(target);
    if (showScanProgress) {
      process.stderr.write(`${t("cli.install.scan-complete")}\n`);
    }

    return {
      fabricDir,
      agentsMdPath,
      agentsMdAction,
      eventsPath,
      eventsAction: this.diffStateToWriteAction(eventsState),
      eventsState,
      forensicPath,
      forensicAction: this.diffStateToWriteAction(forensicState),
      forensicState,
      forensicReport,
    };
  }

  private async executeScaffold(
    scaffold: ScaffoldResult,
    target: string,
  ): Promise<ScaffoldResult> {
    // Create .fabric directory
    mkdirSync(scaffold.fabricDir, { recursive: true });

    // Write default fabric-config.json
    this.writeDefaultFabricConfig(scaffold.fabricDir, target);

    // Write .gitignore
    this.writeDefaultGitignore(scaffold.fabricDir);

    // Create events.jsonl if missing
    if (scaffold.eventsState === "missing") {
      mkdirSync(dirname(scaffold.eventsPath), { recursive: true });
      writeFileSync(scaffold.eventsPath, "", "utf8");
    }

    // Always rewrite forensic.json (it's a snapshot)
    await atomicWriteJson(scaffold.forensicPath, scaffold.forensicReport);

    return scaffold;
  }

  private classifyPath(
    path: string,
    _strategy: "presence" | "always-rewrite",
  ): DiffFileState {
    if (!existsSync(path)) {
      return "missing";
    }

    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(path);
    } catch {
      return "user-modified";
    }

    if (!stat.isFile()) {
      return "user-modified";
    }

    return "present-canonical";
  }

  private diffStateToWriteAction(_state: DiffFileState): InitWriteAction {
    return "created";
  }

  private writeDefaultFabricConfig(fabricDir: string, _targetRoot: string): void {
    const target = join(fabricDir, "fabric-config.json");
    if (existsSync(target)) return;

    const FABRIC_CONFIG_DEFAULTS = {
      archive_hint_hours: 24,
      archive_hint_cooldown_hours: 12,
      review_hint_pending_count: 10,
      review_hint_pending_age_days: 7,
      maintenance_hint_days: 14,
      maintenance_hint_cooldown_days: 7,
      archive_edit_threshold: 20,
      underseed_node_threshold: 10,
      import_window_first_run_months: 60,
      import_window_rerun_months: 2,
      import_max_pending_per_run: 10,
      import_max_commits_scan: 500,
      import_skip_canonical_threshold: 50,
      archive_max_candidates_per_batch: 8,
      archive_max_recent_paths: 20,
      archive_digest_max_sessions: 10,
      review_topic_result_cap: 8,
      review_stale_pending_days: 14,
    };

    mkdirSync(fabricDir, { recursive: true });
    writeFileSync(target, JSON.stringify(FABRIC_CONFIG_DEFAULTS, null, 2) + "\n", "utf8");
  }

  private writeDefaultGitignore(fabricDir: string): void {
    const target = join(fabricDir, ".gitignore");
    if (existsSync(target)) return;

    const FABRIC_GITIGNORE_CONTENT = [
      "# Fabric per-dev activity ledgers & caches — auto-generated, not shared.",
      "# Managed by `fabric install`; edit freely (re-install never overwrites this).",
      "events.jsonl",
      "metrics.jsonl",
      "cite-rollup.jsonl",
      "injections.jsonl",
      ".cache/",
      "*.lock",
      "*.corrupted.*",
      "",
    ].join("\n");

    mkdirSync(fabricDir, { recursive: true });
    writeFileSync(target, FABRIC_GITIGNORE_CONTENT, "utf8");
  }

  private readFabricLanguagePreference(_projectRoot: string): string {
    // grill-6fixes (D1): language is the single machine-wide tone in
    // `~/.fabric/fabric-global.json`, not a per-project field.
    return resolveGlobalLocale();
  }
}
