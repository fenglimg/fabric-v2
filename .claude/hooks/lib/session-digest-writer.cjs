/**
 * v2.0.0-rc.7 T5: session-digest writer.
 *
 * Persist a per-session ~5KB digest under
 * `<projectRoot>/.fabric/.cache/session-digests/<session_id>.md` so the
 * fabric-archive Skill (Phase 0.0) can stitch together cross-session
 * context when it runs after Signal A fires.
 *
 * Contract (non-blocking, best-effort):
 *   - writeDigest({ projectRoot, session_id, user_messages, edit_paths, title })
 *   - returns { written: boolean, path: string | null } — never throws
 *   - silently no-ops on ENOENT, EPERM, malformed inputs
 *   - caps file at SIZE_CAP_BYTES (5120 = 5KB) by truncating user_messages
 *     bullets from the tail (oldest preserved)
 *   - atomic write: temp file + rename
 *
 * Digest shape (markdown):
 *
 *   # <title or fallback>
 *
 *   _Session: <session_id> · written: <iso>_
 *
 *   ## User messages (top 10)
 *
 *   - <msg 1, trimmed to MAX_MSG_CHARS>
 *   - <msg 2, ...>
 *
 *   ## Edits
 *
 *   - <path 1>
 *   - <path 2>
 */
"use strict";

const { existsSync, mkdirSync, renameSync, writeFileSync, unlinkSync } = require("node:fs");
const { dirname, join } = require("node:path");

const FABRIC_DIR = ".fabric";
const CACHE_REL = join(FABRIC_DIR, ".cache", "session-digests");
const SIZE_CAP_BYTES = 5120; // ~5KB
const MAX_USER_MESSAGES = 10;
const MAX_MSG_CHARS = 500;
const MAX_EDIT_PATHS = 60;

function sanitizeSessionId(id) {
  if (typeof id !== "string") return "";
  // Allow alphanumeric, dash, underscore. Strip everything else to avoid
  // path traversal / weird filename characters. Hard-cap 64 chars.
  const cleaned = id.replace(/[^A-Za-z0-9_\-]/g, "_").slice(0, 64);
  return cleaned;
}

function truncateString(s, max) {
  if (typeof s !== "string") return "";
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function renderDigest({ session_id, title, user_messages, edit_paths }) {
  const safeTitle =
    typeof title === "string" && title.trim().length > 0
      ? truncateString(title, 120)
      : "(untitled session)";
  const safeSessionId = sanitizeSessionId(session_id) || "(unknown)";
  const userMsgs = Array.isArray(user_messages) ? user_messages : [];
  const edits = Array.isArray(edit_paths) ? edit_paths : [];

  const messageBullets = userMsgs
    .slice(0, MAX_USER_MESSAGES)
    .map((m) => `- ${truncateString(String(m ?? ""), MAX_MSG_CHARS)}`)
    .filter((line) => line.length > 2);

  const editBullets = edits
    .slice(0, MAX_EDIT_PATHS)
    .map((p) => `- ${truncateString(String(p ?? ""), 200)}`)
    .filter((line) => line.length > 2);

  const messagesSection =
    messageBullets.length > 0
      ? messageBullets.join("\n")
      : "_(no user messages captured)_";
  const editsSection =
    editBullets.length > 0 ? editBullets.join("\n") : "_(no edits captured)_";

  return [
    `# ${safeTitle}`,
    "",
    `_Session: ${safeSessionId} · written: ${new Date().toISOString()}_`,
    "",
    "## User messages (top 10)",
    "",
    messagesSection,
    "",
    "## Edits",
    "",
    editsSection,
    "",
  ].join("\n");
}

/**
 * Soft-cap the rendered digest to SIZE_CAP_BYTES. If the rendered text exceeds
 * the cap we drop user message bullets from the tail (keeping the earliest /
 * oldest entries first since those usually frame the session goal) until the
 * size fits OR we run out of trimmable content.
 */
function capSize(text, original) {
  if (Buffer.byteLength(text, "utf8") <= SIZE_CAP_BYTES) return text;
  let userMessages = Array.isArray(original.user_messages)
    ? [...original.user_messages]
    : [];
  let attempt = text;
  while (
    Buffer.byteLength(attempt, "utf8") > SIZE_CAP_BYTES &&
    userMessages.length > 0
  ) {
    userMessages.pop();
    attempt = renderDigest({ ...original, user_messages: userMessages });
  }
  if (Buffer.byteLength(attempt, "utf8") <= SIZE_CAP_BYTES) return attempt;
  // Last resort: hard-truncate.
  const buf = Buffer.from(attempt, "utf8").slice(0, SIZE_CAP_BYTES);
  return buf.toString("utf8");
}

function writeDigest(opts) {
  if (opts === null || typeof opts !== "object") {
    return { written: false, path: null };
  }
  const projectRoot = typeof opts.projectRoot === "string" ? opts.projectRoot : "";
  const safeSessionId = sanitizeSessionId(opts.session_id);
  if (projectRoot.length === 0 || safeSessionId.length === 0) {
    return { written: false, path: null };
  }
  const cacheDir = join(projectRoot, CACHE_REL);
  const target = join(cacheDir, `${safeSessionId}.md`);
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;

  try {
    const rendered = renderDigest(opts);
    const capped = capSize(rendered, opts);
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }
    writeFileSync(tmp, capped, "utf8");
    renameSync(tmp, target);
    return { written: true, path: target };
  } catch {
    // Best-effort. Never let digest write failure propagate to the Stop hook.
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // ignore
    }
    return { written: false, path: null };
  }
}

module.exports = {
  writeDigest,
  // exposed for tests
  renderDigest,
  capSize,
  CONSTANTS: {
    CACHE_REL,
    SIZE_CAP_BYTES,
    MAX_USER_MESSAGES,
    MAX_MSG_CHARS,
    MAX_EDIT_PATHS,
  },
};
