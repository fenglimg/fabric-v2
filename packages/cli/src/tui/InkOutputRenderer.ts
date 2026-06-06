import { render } from "ink";
import React, { type ReactNode } from "react";
import type { OutputRenderer, OutputRendererConfig, StepInfo, SummaryInfo, ErrorInfo } from "./types.js";
import { StepCounter } from "./StepCounter.js";
import { StatusMessage } from "./StatusMessage.js";
import { SummaryCard } from "./SummaryCard.js";
import { ErrorBox, toErrorInfo } from "./ErrorBox.js";
import { Spinner } from "./Spinner.js";
import { SectionHeader } from "./SectionHeader.js";

/**
 * InkOutputRenderer - Ink-based TUI output renderer
 *
 * Uses React components to render CLI output with rich formatting.
 * Each render operation uses a fresh Ink instance to ensure clean output.
 */
export class InkOutputRenderer implements OutputRenderer {
  private config: OutputRendererConfig;
  private currentStep: StepInfo | null = null;
  private inkInstances: ReturnType<typeof render>[] = [];

  constructor(config: OutputRendererConfig = {}) {
    this.config = {
      colors: true,
      verbose: false,
      timestamps: false,
      ...config,
    };
  }

  /**
   * Render a React component and wait for it to render
   */
  private renderComponent(node: ReactNode): void {
    const { unmount } = render(node);
    this.inkInstances.push({ unmount } as ReturnType<typeof render>);
  }

  /**
   * Render a step progress indicator
   */
  renderStep(step: StepInfo): void {
    this.currentStep = step;

    if (step.status === "running") {
      this.renderComponent(
        React.createElement(Spinner, { label: step.name })
      );
    } else {
      this.renderComponent(
        React.createElement(StepCounter, {
          current: step.current,
          total: step.total,
          label: step.name,
          status: step.status,
        })
      );
    }

    if (step.detail) {
      this.renderComponent(
        React.createElement(StatusMessage, {
          message: step.detail,
          type: step.status === "error" ? "error" : "info",
        })
      );
    }
  }

  /**
   * Render a success message
   */
  renderSuccess(message: string): void {
    this.renderComponent(
      React.createElement(StatusMessage, {
        message,
        type: "success",
      })
    );
  }

  /**
   * Render an error
   */
  renderError(error: ErrorInfo | Error): void {
    const errorInfo = error instanceof Error ? toErrorInfo(error) : error;
    this.renderComponent(
      React.createElement(ErrorBox, {
        error: errorInfo,
        showStack: this.config.verbose,
      })
    );
  }

  /**
   * Render a warning message
   */
  renderWarning(message: string): void {
    this.renderComponent(
      React.createElement(StatusMessage, {
        message,
        type: "warning",
      })
    );
  }

  /**
   * Render an info message
   */
  renderInfo(message: string): void {
    this.renderComponent(
      React.createElement(StatusMessage, {
        message,
        type: "info",
      })
    );
  }

  /**
   * Render a summary card
   */
  renderSummaryCard(summary: SummaryInfo): void {
    this.renderComponent(
      React.createElement(SummaryCard, { summary })
    );
  }

  /**
   * Render a section header
   */
  renderSection(title: string): void {
    this.renderComponent(
      React.createElement(SectionHeader, { title })
    );
  }

  /**
   * Render a final completion message
   */
  renderComplete(): void {
    this.renderComponent(
      React.createElement(StatusMessage, {
        message: "Done!",
        type: "success",
      })
    );
  }

  /**
   * Clean up any pending renders
   */
  async cleanup(): Promise<void> {
    // Ink automatically handles cleanup when the process exits
    // but we can unmount all instances if needed
    for (const instance of this.inkInstances) {
      try {
        instance.unmount();
      } catch {
        // Ignore cleanup errors
      }
    }
    this.inkInstances = [];
  }
}

/**
 * Create an Ink output renderer
 */
export function createInkRenderer(config?: OutputRendererConfig): InkOutputRenderer {
  return new InkOutputRenderer(config);
}