/**
 * ISS-20260713-009: map Zod/Fabric/unknown errors to agent-actionable MCP results
 * instead of rethrowing raw Errors that clients surface as opaque dumps.
 */
import { ZodError } from "zod";

export type McpToolErrorResult = {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
  structuredContent: {
    code: string;
    message: string;
    action_hint: string;
    issues?: Array<{ path: string; message: string }>;
  };
};

export function toMcpToolError(
  err: unknown,
  opts: { tool: string; actionHint?: string } = { tool: "tool" },
): McpToolErrorResult {
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({
      path: i.path.join(".") || "(root)",
      message: i.message,
    }));
    const summary = issues
      .slice(0, 5)
      .map((i) => `${i.path}: ${i.message}`)
      .join("; ");
    const action_hint =
      opts.actionHint ??
      `Fix the invalid ${opts.tool} arguments (${summary}) and retry. See tool schema required fields.`;
    return {
      isError: true,
      content: [{ type: "text", text: `${opts.tool} input invalid: ${summary}\n→ ${action_hint}` }],
      structuredContent: {
        code: "invalid_input",
        message: summary,
        action_hint,
        issues,
      },
    };
  }

  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "unknown error";
  // Prefer FabricError-style actionHint when present
  const action_hint =
    err &&
    typeof err === "object" &&
    "actionHint" in err &&
    typeof (err as { actionHint?: unknown }).actionHint === "string"
      ? ((err as { actionHint: string }).actionHint)
      : (opts.actionHint ?? `Retry ${opts.tool} after addressing: ${message}`);

  return {
    isError: true,
    content: [{ type: "text", text: `${opts.tool} failed: ${message}\n→ ${action_hint}` }],
    structuredContent: {
      code: "tool_error",
      message,
      action_hint,
    },
  };
}
