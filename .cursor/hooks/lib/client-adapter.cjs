/**
 * v2.0.0-rc.37 NEW-30: shared client-protocol adapter for hook scripts.
 *
 * The three host clients (Claude Code / Codex CLI / Cursor) differ in how a
 * hook surfaces context back to the model:
 *   - Claude Code reads a stdout JSON envelope
 *     ({ hookSpecificOutput: { hookEventName, additionalContext } }).
 *   - Codex CLI and Cursor read plain stderr text.
 * Each hook had its own copy of the detect-client + read-stdin + pick-channel
 * logic (fabric-hint.detectClient, cite-policy-evict.isClaudeCode + readStdinJson,
 * knowledge-hint-broad inline CLAUDE_PROJECT_DIR check). This module is the
 * single canonical implementation so the protocol choice lives in one place.
 *
 * Provides:
 *   - detectClient(dirnameHint?) → 'cc' | 'codex' | 'cursor' | undefined
 *       3-tier: FABRIC_HINT_CLIENT env override → CLAUDE_PROJECT_DIR (cc) →
 *       __dirname path heuristic (.claude / .codex / .cursor). dirnameHint
 *       defaults to this lib's own dir (which still lives under the client
 *       dir, e.g. .claude/hooks/lib), so the heuristic stays accurate.
 *   - isClaudeCode() → boolean   (CLAUDE_PROJECT_DIR present)
 *   - readStdinJson({ timeoutMs }) → Promise<object | null>
 *       Async stdin JSON reader; null on parse error / closed stdin / timeout.
 *   - emitContext(text, { client, eventName, streams, forceStderr }) → void
 *       Standardised output: Claude Code → stdout JSON envelope; Codex/Cursor
 *       → plain stderr. forceStderr pins stderr even on Claude Code (used for
 *       SessionStart one-shot reminders). Best-effort — never throws.
 *
 * Never-throw contract (KT-DEC-0007): every path degrades silently rather than
 * blocking the host's main flow.
 */

function isClaudeCode() {
  return (
    typeof process.env.CLAUDE_PROJECT_DIR === "string" &&
    process.env.CLAUDE_PROJECT_DIR.length > 0
  );
}

function detectClient(dirnameHint) {
  const envClient = process.env.FABRIC_HINT_CLIENT;
  if (typeof envClient === "string" && envClient.length > 0) {
    const normalised = envClient.trim().toLowerCase();
    if (normalised === "cc" || normalised === "codex" || normalised === "cursor") {
      return normalised;
    }
  }
  if (isClaudeCode()) return "cc";
  // Path heuristic against the caller's directory (defaults to this lib's dir,
  // which sits under the client root, e.g. .codex/hooks/lib).
  const dir = typeof dirnameHint === "string" && dirnameHint.length > 0 ? dirnameHint : __dirname;
  try {
    if (dir.includes(".claude/") || dir.includes(".claude\\")) return "cc";
    if (dir.includes(".codex/") || dir.includes(".codex\\")) return "codex";
    if (dir.includes(".cursor/") || dir.includes(".cursor\\")) return "cursor";
  } catch {
    // fall through
  }
  return undefined;
}

function readStdinJson(opts) {
  const { timeoutMs = 1000 } = opts || {};
  return new Promise((resolve) => {
    let buffer = "";
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(buffer));
      } catch {
        resolve(null);
      }
    });
    process.stdin.on("error", () => resolve(null));
    // Defensive timeout: if stdin never closes (host bug), give up.
    setTimeout(() => resolve(null), timeoutMs).unref();
  });
}

function emitContext(text, opts) {
  const { client, eventName = "UserPromptSubmit", streams = {}, forceStderr = false } = opts || {};
  const stdout = streams.stdout || process.stdout;
  const stderr = streams.stderr || process.stderr;
  const useStdoutEnvelope =
    !forceStderr && (client === "cc" || (client === undefined && isClaudeCode()));
  try {
    if (useStdoutEnvelope) {
      const envelope = {
        hookSpecificOutput: { hookEventName: eventName, additionalContext: text },
      };
      stdout.write(`${JSON.stringify(envelope)}\n`);
    } else {
      stderr.write(`${text}\n`);
    }
  } catch {
    // best-effort — never throw
  }
}

module.exports = {
  isClaudeCode,
  detectClient,
  readStdinJson,
  emitContext,
};
