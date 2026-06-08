import type { ClaudeMcpScope } from "../../config/json.js";
import type { OutputRenderer, StepInfo } from "../../tui/types.js";
import type { Translator } from "@fenglimg/fabric-shared";

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
  /** Project-aware translator for user-facing install output */
  translate: Translator;
  /** TUI output renderer (EPIC-005/006/007/008) */
  renderer?: OutputRenderer;
}

/**
 * Shared state between stages.
 */
export interface InstallState {
  /** Global root path (~/.fabric) */
  globalRoot?: string;
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
