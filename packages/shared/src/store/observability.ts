import { redactSecrets } from "./secret-scan.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P6 — Observability: structured failure trace + redacted debug
// bundle (S40). Every failure path (install / sync / hook / MCP) emits a
// uniform structured trace so a failure is diagnosable without re-running. The
// debug bundle gathers config + diagnostics + (opt-in) recent events for a bug
// report — and ALWAYS runs every included string through secret redaction so a
// shared bundle can never leak a credential.
// ---------------------------------------------------------------------------

export type FailureStage = "install" | "sync" | "hook" | "mcp";

export interface FailureTrace {
  stage: FailureStage;
  // Stable machine code (e.g. "rebase_conflict", "no_global_config"); falls back
  // to the error's name when no explicit code is supplied.
  code: string;
  // Human message, with any secret-shaped substring redacted.
  message: string;
  // Free-form structured context (paths, store ids, …). String values are
  // redacted; non-string values pass through.
  context: Record<string, unknown>;
}

function redactValue(value: unknown): unknown {
  return typeof value === "string" ? redactSecrets(value) : value;
}

// Build a structured trace from a failure. `error` may be an Error or any
// thrown value; `code` overrides the derived code when the caller knows it.
export function buildFailureTrace(
  stage: FailureStage,
  error: unknown,
  context: Record<string, unknown> = {},
  code?: string,
): FailureTrace {
  const rawMessage =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
  const derivedCode =
    code ?? (error instanceof Error && error.name ? error.name : "error");
  const redactedContext: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    redactedContext[key] = redactValue(value);
  }
  return {
    stage,
    code: derivedCode,
    message: redactSecrets(rawMessage),
    context: redactedContext,
  };
}

export interface DebugBundleInput {
  // Effective config snapshot (global + project). Serialized + redacted.
  config: Record<string, unknown>;
  // Diagnostics (e.g. doctor store diagnostics). Redacted.
  diagnostics: unknown[];
  // Recent event-ledger lines. Included ONLY when includeEvents is true
  // (default false — events may carry user prose / paths).
  events?: string[];
  includeEvents?: boolean;
}

export interface DebugBundle {
  version: 1;
  config: Record<string, unknown>;
  diagnostics: unknown[];
  events: string[];
  // True when the bundle ran every string field through secret redaction.
  redacted: true;
}

// Build a redacted debug bundle. EVERY string anywhere in the bundle is passed
// through `redactSecrets`, so a credential in config/diagnostics/events can
// never reach the emitted artifact (negative-tested). Events are excluded by
// default (opt-in via includeEvents).
export function buildDebugBundle(input: DebugBundleInput): DebugBundle {
  const redactDeep = (value: unknown): unknown => {
    if (typeof value === "string") {
      return redactSecrets(value);
    }
    if (Array.isArray(value)) {
      return value.map(redactDeep);
    }
    if (value !== null && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = redactDeep(v);
      }
      return out;
    }
    return value;
  };

  return {
    version: 1,
    config: redactDeep(input.config) as Record<string, unknown>,
    diagnostics: (redactDeep(input.diagnostics) as unknown[]) ?? [],
    events: input.includeEvents === true ? (input.events ?? []).map(redactSecrets) : [],
    redacted: true,
  };
}
