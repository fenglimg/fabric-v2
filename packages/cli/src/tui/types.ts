import type { ReactNode } from "react";

/**
 * Step information for progress tracking
 */
export interface StepInfo {
  /** Step name/label */
  name: string;
  /** Current step number (1-based) */
  current: number;
  /** Total number of steps */
  total: number;
  /** Step status */
  status: "pending" | "running" | "success" | "error" | "skipped";
  /** Optional detail message */
  detail?: string;
}

/**
 * Summary information for result card
 */
export interface SummaryInfo {
  /** Title of the summary */
  title: string;
  /** Success count */
  successCount: number;
  /** Skipped count */
  skippedCount?: number;
  /** Error count */
  errorCount?: number;
  /** Additional details rows */
  details?: SummaryDetailRow[];
}

/**
 * Detail row for summary card
 */
export interface SummaryDetailRow {
  /** Label */
  label: string;
  /** Value */
  value: string;
  /** Status indicator */
  status?: "success" | "error" | "skipped" | "info";
}

/**
 * Error information for error box
 */
export interface ErrorInfo {
  /** Error title */
  title: string;
  /** Error message */
  message: string;
  /** Stack trace (optional) */
  stack?: string;
  /** Hint for fixing the error */
  hint?: string;
  /** Error code */
  code?: string;
}

/**
 * OutputRenderer - Abstract interface for TUI output
 *
 * This interface defines the contract for rendering various output types
 * in the CLI. Implementations can use different rendering strategies
 * (Ink components, plain text, etc.)
 */
export interface OutputRenderer {
  /**
   * Render a step progress indicator
   */
  renderStep(step: StepInfo): void;

  /**
   * Render a success message
   */
  renderSuccess(message: string): void;

  /**
   * Render an error with optional details
   */
  renderError(error: ErrorInfo | Error): void;

  /**
   * Render a warning message
   */
  renderWarning(message: string): void;

  /**
   * Render an info message
   */
  renderInfo(message: string): void;

  /**
   * Render a summary card with results
   */
  renderSummaryCard(summary: SummaryInfo): void;

  /**
   * Render a section header
   */
  renderSection(title: string): void;

  /**
   * Render a final completion message
   */
  renderComplete(): void;

  /**
   * Clean up any pending renders (for async Ink renders)
   */
  cleanup?(): Promise<void>;
}

/**
 * InkOutputRenderer - Ink-specific renderer that uses React components
 */
export interface InkOutputRenderer extends OutputRenderer {
  /**
   * Render a custom React node directly
   */
  renderCustom(node: ReactNode): void;

  /**
   * Get the underlying Ink instance for advanced use
   */
  getInkInstance(): unknown;
}

/**
 * OutputRendererConfig - Configuration for the renderer
 */
export interface OutputRendererConfig {
  /** Use colors */
  colors?: boolean;
  /** Verbose output */
  verbose?: boolean;
  /** Show timestamps */
  timestamps?: boolean;
  /** Custom prefix */
  prefix?: string;
}