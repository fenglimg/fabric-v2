import type { ClaudeMcpScope } from "../../config/json.js";
import type { McpRootPolicy } from "../../config/writer.js";
import type { OutputRenderer, StepInfo } from "../../tui/types.js";

// ---------------------------------------------------------------------------
// Install Pipeline Types
// ---------------------------------------------------------------------------

/**
 * Initial arguments passed to the install command.
 */
export type InitArgs = {
  target?: string;
  debug?: boolean;
  yes?: boolean;
  "dry-run"?: boolean;
  global?: boolean;
  url?: string;
  "enable-embed"?: boolean;
  "embed-model"?: string;
  /**
   * TASK-004: surface the full per-phase detail / capability table even when the
   * re-install would otherwise collapse to a single health-check card. Owns all
   * --verbose logic (collapse opt-out + C-006 capability-table reveal).
   */
  verbose?: boolean;
  "mcp-root-mode"?: string;
  "mcp-project-root"?: string;
};

/**
 * Options controlling install behavior.
 */
export type InitOptions = {
  skipBootstrap?: boolean;
  skipMcp?: boolean;
  skipHooks?: boolean;
  planOnly?: boolean;
};

/**
 * Write action classification for scaffold paths.
 */
export type InitWriteAction = "created" | "overwritten";

/**
 * Diff-mode classification for existing paths.
 */
export type DiffFileState =
  | "missing"
  | "present-canonical"
  | "drifted"
  | "user-modified";

/**
 * AGENTS.md action classification.
 */
export type AgentsMdAction = "created" | "preserved";

/**
 * MCP installation mode.
 */
export type McpInstallMode = "global" | "local";

/**
 * Stage name enumeration.
 */
export type StageName =
  | "preflight"
  | "env"
  | "store"
  | "hooks"
  | "mcp"
  | "validate"
  | "guidance";

/**
 * Stage disposition after execution.
 */
export type StageDisposition = "ran" | "skipped" | "failed";

/**
 * Result of a single stage execution.
 */
export type StageResult = {
  name: StageName;
  disposition: StageDisposition;
  installed: string[];
  skipped: string[];
  errors: string[];
  /** Optional payload for stage-specific data */
  payload?: unknown;
  /**
   * true when the stage materially created/modified something this run; drives
   * TASK-004 end-pass collapse. Idempotent re-ensure of already-present artifacts
   * is changed=false.
   */
  changed?: boolean;
  /**
   * flat-design: an optional rich human detail folded INLINE into the stage's
   * `● <name> ✓ <detail>` line (e.g. mcp → the configured client names, hooks →
   * the skill/hook breakdown). When absent, the pipeline falls back to the generic
   * installed-count / "up to date" wording. Carries NO status glyph or "已完成"
   * prefix — the `●` line's own ✓ is the completion marker. Replaces the former
   * separate `console.log("已完成 …")` narration line that double-reported each
   * stage outside the flat column.
   */
  detail?: string;
};

/**
 * Context passed through all stages.
 */
export interface InstallContext {
  /** Target project root directory */
  target: string;
  /** Command-line arguments */
  args: InitArgs;
  /** Resolved options */
  options: InitOptions;
  /** MCP installation mode */
  mcpInstallMode: McpInstallMode;
  /** Claude MCP scope */
  claudeMcpScope: ClaudeMcpScope;
  /** Persistence policy for machine-global MCP client roots. */
  mcpRootPolicy: McpRootPolicy;
  /** Whether running interactively */
  interactive: boolean;
  /** Whether wizard is enabled */
  wizardEnabled: boolean;
  /** Accumulated stage results */
  stageResults: StageResult[];
  /** Rollback stack for cleanup on failure */
  rollbackStack: RollbackAction[];
  /** Shared state between stages */
  state: InstallState;
  /** TUI output renderer (EPIC-005/006/007/008) */
  renderer?: OutputRenderer;
  /**
   * TASK-004/Bug-B: when set (re-install buffering active), a stage about to issue
   * an interactive prompt calls this FIRST so buffered context (slot status, prior
   * phase visuals) is flushed live before the prompt; flushing also abandons the
   * end-pass collapse for this run.
   */
  flushRenderBuffer?: () => void;
}

/**
 * Shared state between stages.
 */
export interface InstallState {
  /** Global root path (~/.fabric) */
  globalRoot?: string;
  /**
   * TASK-004: true on a first-ever install (no global config existed at entry).
   * Set early in createInstallContext and re-affirmed by the store stage once it
   * loads the global config. Drives the onboarding intro tone and forbids the
   * end-pass health-check collapse (a first install never folds).
   */
  firstInstall?: boolean;
  /** Whether global config was created this session */
  globalConfigCreated?: boolean;
  /** Personal store UUID */
  personalStoreUuid?: string;
  /** Scaffold result from env stage */
  scaffold?: ScaffoldResult;
  /** Detected client supports */
  clientSupports?: DetectedClientSupport[];
  /** Fabric language preference */
  fabricLanguage?: string;
  /**
   * flat-design: the project forensic scan, built in the PREFLIGHT stage (stage 1)
   * so the one-line scan summary renders directly under the command title — before
   * the stage list — instead of mid-column from the env stage. The env stage reuses
   * this instead of re-walking the project (avoids a second 30k-file scan).
   */
  forensicReport?: ScaffoldResult["forensicReport"];
  /**
   * flat-design (G6): the guidance stage stashes its closing footer line(s) here
   * instead of printing them in-stage; the pipeline prints them AFTER the summary
   * card + completion line, so the single "下一步 →" anchor is the very last line.
   */
  guidanceFooter?: string[];
}

/**
 * Scaffold result from the env stage.
 */
export type ScaffoldResult = {
  fabricDir: string;
  agentsMdPath: string;
  agentsMdAction: AgentsMdAction;
  eventsPath: string;
  eventsAction: InitWriteAction;
  eventsState: DiffFileState;
  forensicPath: string;
  forensicAction: InitWriteAction;
  forensicState: DiffFileState;
  forensicReport: Awaited<ReturnType<typeof import("../../scanner/forensic.js").buildForensicReport>>;
};

import type { DetectedClientSupport as ResolverDetectedClientSupport } from "../../config/resolver.js";

/**
 * Re-export DetectedClientSupport from resolver to avoid type duplication.
 * The pipeline uses the same type as the rest of the CLI.
 */
export type DetectedClientSupport = ResolverDetectedClientSupport;

/**
 * Rollback action interface.
 */
export type RollbackAction = {
  stage: StageName;
  action: () => Promise<void>;
};

/**
 * Pipeline execution result.
 */
export type PipelineResult = {
  success: boolean;
  context: InstallContext;
  error?: Error;
};

// ---------------------------------------------------------------------------
// Stage Interface
// ---------------------------------------------------------------------------

/**
 * Stage interface for install pipeline.
 *
 * Each stage is an independent unit that:
 * 1. Receives the shared context
 * 2. Performs its specific work
 * 3. Returns a result with disposition
 * 4. Can optionally register rollback actions
 */
export interface Stage {
  /** Stage name (must match StageName type) */
  readonly name: StageName;

  /**
   * Execute the stage.
   * @param context - Shared install context
   * @returns Stage execution result
   */
  execute(context: InstallContext): Promise<StageResult>;

  /**
   * Rollback the stage (cleanup on failure).
   * @param context - Shared install context
   */
  rollback?(context: InstallContext): Promise<void>;
}
