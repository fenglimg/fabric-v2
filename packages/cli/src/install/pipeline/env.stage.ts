import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { atomicWriteJson } from "@fenglimg/fabric-shared/node/atomic-write";
import { log } from "@clack/prompts";

import { resolveGlobalLocale } from "@fenglimg/fabric-shared";
import type { ForensicReport } from "@fenglimg/fabric-shared";

import { t } from "../../i18n.js";
import { buildForensicReport } from "../../scanner/forensic.js";
import { detectClientSupports } from "../../config/resolver.js";
import { migrateRootConfig } from "../migrate-root-config.js";
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

      // Build scaffold plan (reusing the forensic report the preflight stage
      // already built, when present — avoids a second project walk).
      const scaffold = await this.buildScaffoldPlan(target, context.options, context.state.forensicReport);
      context.state.scaffold = scaffold;

      if (context.options.planOnly === true) {
        const fabricLanguage = this.readFabricLanguagePreference(target);
        context.state.fabricLanguage = fabricLanguage;
        return stageSkipped("env", "dry-run: scaffold planned without writing files");
      }

      // Execute scaffold (create directories and files)
      const { scaffold: created, materialChange } = await this.executeScaffold(scaffold, target);

      // flat-design: the scan summary is now rendered by the PREFLIGHT stage (so it
      // sits under the command title, not mid-column here). The forensic report it
      // built is reused below via context.state.forensicReport — no second walk.

      // Detect and store language preference
      const fabricLanguage = this.readFabricLanguagePreference(target);
      context.state.fabricLanguage = fabricLanguage;

      const installed = [
        scaffold.fabricDir,
        scaffold.eventsPath,
        scaffold.forensicPath,
      ].filter((p) => existsSync(p));

      return stageRan("env", installed, [], created, materialChange);
    } catch (error) {
      return stageFailedFromError("env", error);
    }
  }

  /**
   * grill F2/C-03: render ≤4 high-information findings from the already-built
   * forensic report. Hard-capped at 4 lines so the payoff never re-creates an
   * information wall (R3).
   */
  private async buildScaffoldPlan(
    target: string,
    _options: InstallContext["options"],
    prebuiltReport?: ForensicReport,
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
    // flat-design: reuse the forensic report the preflight stage already built +
    // rendered (the scan summary now lives under the command title). Only fall back
    // to building here (silently) when there is no prebuilt report — e.g. a direct
    // unit-test call to the env stage that never ran preflight.
    const forensicReport = prebuiltReport ?? (await buildForensicReport(target));

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
  ): Promise<{ scaffold: ScaffoldResult; materialChange: boolean }> {
    // Create .fabric directory
    mkdirSync(scaffold.fabricDir, { recursive: true });

    // Write default fabric-config.json (returns true only on a NEW write).
    const configWrote = this.writeDefaultFabricConfig(scaffold.fabricDir, target);

    // A1 (KT-DEC-0003): fold any legacy project-root fabric.config.json into
    // .fabric/fabric-config.json so there is a single config source of truth.
    // No-op when no legacy root file exists (every new install).
    migrateRootConfig(target);

    // Write .gitignore (returns true only on a NEW write).
    const gitignoreWrote = this.writeDefaultGitignore(scaffold.fabricDir);

    // Create events.jsonl if missing
    const eventsWrote = scaffold.eventsState === "missing";
    if (eventsWrote) {
      mkdirSync(dirname(scaffold.eventsPath), { recursive: true });
      writeFileSync(scaffold.eventsPath, "", "utf8");
    }

    // Always rewrite forensic.json (it's a snapshot) — a snapshot rewrite is NOT
    // a material change (Bug-A: it would otherwise force changed=true every run).
    await atomicWriteJson(scaffold.forensicPath, scaffold.forensicReport);

    // TASK-004/Bug-A: a genuinely-new material write happened this run iff the
    // config / events / .gitignore was newly written OR AGENTS.md was created.
    // The always-rewritten forensic snapshot is deliberately excluded.
    const materialChange =
      configWrote || gitignoreWrote || eventsWrote || scaffold.agentsMdAction === "created";

    return { scaffold, materialChange };
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

  private writeDefaultFabricConfig(fabricDir: string, _targetRoot: string): boolean {
    const target = join(fabricDir, "fabric-config.json");
    if (existsSync(target)) return false;

    const FABRIC_CONFIG_DEFAULTS = {
      archive_hint_hours: 24,
      archive_hint_cooldown_hours: 12,
      review_hint_pending_count: 10,
      review_hint_pending_age_days: 7,
      maintenance_hint_days: 14,
      maintenance_hint_cooldown_days: 7,
      archive_edit_threshold: 20,
      underseed_node_threshold: 10,
      // ux-w2-3: import_*/archive_max_*/review_topic_result_cap skill thresholds
      // hardcoded (✂ census Table 1) — no longer scaffolded; skills fall to a
      // built-in default when the key is absent.
      review_stale_pending_days: 14,
    };

    mkdirSync(fabricDir, { recursive: true });
    writeFileSync(target, JSON.stringify(FABRIC_CONFIG_DEFAULTS, null, 2) + "\n", "utf8");
    return true;
  }

  private writeDefaultGitignore(fabricDir: string): boolean {
    const target = join(fabricDir, ".gitignore");
    if (existsSync(target)) return false;

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
    return true;
  }

  private readFabricLanguagePreference(_projectRoot: string): string {
    // grill-6fixes (D1): language is the single machine-wide tone in
    // `~/.fabric/fabric-global.json`, not a per-project field.
    return resolveGlobalLocale();
  }
}
