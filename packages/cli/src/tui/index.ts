// Types
export type {
  StepInfo,
  SummaryInfo,
  SummaryDetailRow,
  ErrorInfo,
  OutputRenderer,
  OutputRendererConfig,
} from "./types.js";

// Renderer (W3-A: theme.ts-backed, non-Ink)
export { ConsoleOutputRenderer, createInstallRenderer, toErrorInfo } from "./ConsoleOutputRenderer.js";
