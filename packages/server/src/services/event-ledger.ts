import { randomUUID } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  statSync,
} from "node:fs";
import { appendFile, mkdir, readdir, readFile, truncate, unlink, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

import {
  eventLedgerEventSchema,
  redactPii,
  redactSecrets,
  type EventLedgerEvent,
  type EventLedgerEventInput,
} from "@fenglimg/fabric-shared";
import {
  atomicWriteText,
  createLedgerWriteQueue,
  withFileLock,
} from "@fenglimg/fabric-shared/node/atomic-write";

import { ensureParentDirectory, getEventLedgerPath, sha256 } from "./_shared.js";

const ledgerQueue = createLedgerWriteQueue();

// ISS-20260713-016: process-local typed cache so doctor/audit multipass
// reuses one full parse per (path,mtime,size) instead of re-reading the file.
const eventLedgerReadCache = new Map<
  string,
  { mtimeMs: number; size: number; events: StoredEventLedgerEvent[]; warnings: LedgerWarning[] }
>();



// F9 (ISS-20260531-002): the LedgerWriteQueue above only serializes writers
// WITHIN one process. A second process (e.g. `fabric doctor --fix` truncating)
// racing the MCP server's appends can tear the ledger or drop lines. So every
// mutation of the main ledger file is additionally guarded by a cross-process
// `withFileLock` on `<ledger>.lock`. NOTE: the lock must NOT be held across a
// nested mutation (append → size-triggered rotate) or the same-process re-acquire
// would self-deadlock — append releases its lock before rotation runs.
function eventLedgerLockPath(eventPath: string): string {
  return `${eventPath}.lock`;
}

// Cross-process (withFileLock) + in-process (ledgerQueue.runExclusive) exclusive
// mutation of the main ledger. Use for any rewrite/truncate of the file.
function exclusiveLedgerWrite<T>(eventPath: string, fn: () => Promise<T>): Promise<T> {
  return withFileLock(eventLedgerLockPath(eventPath), () =>
    ledgerQueue.runExclusive(eventPath, fn),
  );
}

// ISS-005 test-only seam (mirrors __knowledgeMetaCacheStats): counts how many
// ledger lines were actually JSON.parse + Zod-validated. The event_type
// pushdown filter must keep this bounded to candidate lines, not the whole
// ledger, on targeted queries like loadIdRedirectMap.
export const __eventLedgerParseStats = { lineParses: 0 };
export function __resetEventLedgerParseStats(): void {
  __eventLedgerParseStats.lineParses = 0;
}

// v2.0.0-rc.22 Scope A T3: sliding-window-by-age retention constants and
// soft-warn threshold. `EVENT_LEDGER_DEFAULT_RETENTION_DAYS` is applied when
// neither `opts.retentionDays` nor `fabric_event_retention_days` (in
// `.fabric/fabric-config.json`) is set. `EVENT_LEDGER_SIZE_WARN_BYTES` (50MB)
// is the one-shot stderr soft-warn threshold checked after every successful
// append — emits exactly once per Node process to avoid spamming long-lived
// MCP servers.
// v2.0.0-rc.29 TASK-006 (BUG-Q1): dropped `export` — both constants are
// internal to this module; no cross-package consumer ever imported them.
const EVENT_LEDGER_DEFAULT_RETENTION_DAYS = 30;
const EVENT_LEDGER_SIZE_WARN_BYTES = 50 * 1024 * 1024;
const EVENT_LEDGER_ARCHIVE_DIR = ".fabric/events.archive";

// Module-level one-shot guard for the 50MB soft-warn. Exported test helper
// resets the flag — tests use the helper instead of poking the let-binding
// directly so the warn-emit/guard semantics stay co-located with this file.
let warnedOversize = false;
export function __resetOversizeWarnForTests(): void {
  warnedOversize = false;
}

export type StoredEventLedgerEvent = EventLedgerEvent;

export type ReadEventLedgerOptions = {
  event_type?: EventLedgerEvent["event_type"];
  since?: number;
  correlation_id?: string;
  session_id?: string;
};

export type LedgerWarning =
  | { kind: "partial_write_at_tail"; byte_offset: number; byte_length: number; snippet_first_120: string }
  // v2.0.0-rc.27 TASK-010 (audit §2.24): forward-compat warning categories. Lines that
  // are valid JSON but fail Zod validation because of `schema_version !== 1` or
  // an unknown `event_type` token used to be silently dropped — operators had
  // no way to spot stale rc.0/rc.1 ledger rows or events emitted by a newer
  // server against an older CLI. These warnings get surfaced through
  // `fabric doctor` so the operator can decide whether to archive + re-create the
  // ledger or upgrade the CLI to a server-compatible version.
  | {
      kind: "schema_version_unsupported";
      line_index: number;
      schema_version: unknown;
      snippet_first_120: string;
    }
  | {
      kind: "event_type_unknown";
      line_index: number;
      event_type: unknown;
      snippet_first_120: string;
    };

// v2.0.0-rc.27 TASK-010 (audit §2.24): derive the known event_type set lazily
// from the discriminated-union options so the warning classifier stays in
// sync with the schema without a manual mirror. Each option is a ZodObject
// whose `event_type` field is a ZodLiteral — the literal value is the wire
// token.
let knownEventTypesCache: Set<string> | null = null;
function getKnownEventTypes(): Set<string> {
  if (knownEventTypesCache !== null) return knownEventTypesCache;
  const set = new Set<string>();
  for (const opt of eventLedgerEventSchema.options) {
    const shape = (opt as { shape: { event_type: { value: string } } }).shape;
    if (shape && typeof shape.event_type?.value === "string") {
      set.add(shape.event_type.value);
    }
  }
  knownEventTypesCache = set;
  return set;
}

function classifyRejection(line: string, index: number): LedgerWarning | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  // schema_version classification fires when the line carries a numeric
  // version that does not equal 1. Lines missing the field entirely are
  // treated as legacy/malformed and stay silently dropped.
  if (
    "schema_version" in parsed &&
    parsed.schema_version !== 1 &&
    (typeof parsed.schema_version === "number" || parsed.schema_version === null)
  ) {
    return {
      kind: "schema_version_unsupported",
      line_index: index,
      schema_version: parsed.schema_version,
      snippet_first_120: line.slice(0, 120),
    };
  }
  // event_type classification fires when schema_version IS valid (or
  // absent — the dominant rc.0-era shape was schema_version-less) but the
  // declared event_type is not in the known discriminator set.
  const known = getKnownEventTypes();
  if (typeof parsed.event_type === "string" && !known.has(parsed.event_type)) {
    return {
      kind: "event_type_unknown",
      line_index: index,
      event_type: parsed.event_type,
      snippet_first_120: line.slice(0, 120),
    };
  }
  return null;
}

export type ReadEventLedgerResult = {
  events: StoredEventLedgerEvent[];
  warnings: LedgerWarning[];
};

// v2.0.0-rc.37 Wave B (NEW-14): per-field truncate cap. POSIX guarantees
// atomic writes only up to PIPE_BUF (4096 bytes on Linux/macOS). When a single
// JSONL line exceeds that, concurrent writers can interleave bytes — splitting
// an event mid-string and corrupting the ledger. We cap each STRING field at
// 4 KB and emit a sentinel marker so consumers can detect the truncation when
// the original payload was long-form (e.g. a paste of a giant stack trace into
// `intent`).
const EVENT_FIELD_TRUNCATE_BYTES = 4 * 1024;
const TRUNCATION_SENTINEL = "…[truncated: rc.37 NEW-14 4KB cap]";

function truncateOneString(value: string): string {
  if (Buffer.byteLength(value, "utf8") <= EVENT_FIELD_TRUNCATE_BYTES) return value;
  // UTF-8 safe truncation: slice progressively from the byte cap until the
  // result + sentinel encodes back to ≤ cap.
  let candidate = value;
  while (
    Buffer.byteLength(candidate, "utf8") + TRUNCATION_SENTINEL.length >
    EVENT_FIELD_TRUNCATE_BYTES
  ) {
    candidate = candidate.slice(0, Math.max(0, candidate.length - 32));
  }
  return candidate + TRUNCATION_SENTINEL;
}

function truncateLongStrings(value: unknown): unknown {
  if (typeof value === "string") return truncateOneString(value);
  if (Array.isArray(value)) return value.map((v) => truncateLongStrings(v));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = truncateLongStrings(v);
    }
    return out;
  }
  return value;
}

// ISS-043: free-text event fields that may carry caller-pasted secrets (an
// edit intent, a review reason, a per-selection rationale). These are redacted
// before the row is appended, mirroring the knowledge write path's secret
// scrubbing (store/observability redactSecrets). We redact by FIELD NAME (not
// every string) so structured fields — ids, paths, hashes — are never mangled
// by a false-positive secret match.
const REDACTED_EVENT_FIELDS = new Set([
  "intent",
  "kb_line_raw",
  "message",
  "prompt",
  "rationale",
  "reason",
  "summary",
  "user_messages_summary",
]);

const DEEP_REDACTED_EVENT_FIELDS = new Set([
  "ai_selection_reasons",
  "cite_commitments",
  "diagnostics",
  "message",
]);

function redactSecretsDeep(value: unknown): unknown {
  if (typeof value === "string") return redactPii(redactSecrets(value)); // ISS-20260713-017 explicit dual scrub
  if (Array.isArray(value)) return value.map((entry) => redactSecretsDeep(entry));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactSecretsDeep(nested);
    }
    return out;
  }
  return value;
}

function redactSecretsInEvent(event: EventLedgerEventInput): EventLedgerEventInput {
  const out: Record<string, unknown> = { ...(event as Record<string, unknown>) };
  for (const key of Object.keys(out)) {
    if (REDACTED_EVENT_FIELDS.has(key) && typeof out[key] === "string") {
      // ISS-20260713-017: call both helpers so PII remains even if SECRET_RULES splits later
      out[key] = redactPii(redactSecrets(out[key] as string));
    } else if (DEEP_REDACTED_EVENT_FIELDS.has(key)) {
      out[key] = redactSecretsDeep(out[key]);
    }
  }
  return out as EventLedgerEventInput;
}

export async function appendEventLedgerEvent(
  projectRoot: string,
  event: EventLedgerEventInput,
): Promise<StoredEventLedgerEvent> {
  const eventPath = getEventLedgerPath(projectRoot);
  // ISS-043: scrub secrets from free-text fields BEFORE truncation + validation.
  const redacted = redactSecretsInEvent(event);
  // v2.0.0-rc.37 NEW-14: apply per-field truncate BEFORE Zod validation —
  // the truncated value still satisfies every existing schema (strings stay
  // strings). Run on the input shape because Zod removes excess properties
  // on parse; running post-parse would skip any optional fields that
  // happened to also be too long.
  const truncated = truncateLongStrings(redacted) as EventLedgerEventInput;
  const nextEvent = eventLedgerEventSchema.parse({
    ...truncated,
    kind: "fabric-event",
    id: event.id ?? `event:${randomUUID()}`,
    ts: event.ts ?? Date.now(),
    schema_version: 1,
  });

  await ensureParentDirectory(eventPath);
  // Cross-process + in-process serialized append. Lock is released here, BEFORE
  // the size-triggered rotation below, so the nested rotate() can re-acquire it
  // without self-deadlocking.
  await withFileLock(eventLedgerLockPath(eventPath), () =>
    ledgerQueue.append(eventPath, JSON.stringify(nextEvent)),
  );
  eventLedgerReadCache.delete(eventPath);

  // v2.0.0-rc.22 Scope A T3: post-append size check. Emits a one-shot stderr
  // warning when the ledger crosses 50MB so operators of long-lived MCP
  // servers know to run `fabric doctor --fix` (which will invoke
  // rotateEventLedgerIfNeeded in T4) before the file grows unbounded.
  // Best-effort: stat failures are swallowed (filesystem race, etc.) — the
  // warning is hint-grade, not load-bearing.
  try {
    const size = statSync(eventPath).size;
    if (size > EVENT_LEDGER_SIZE_WARN_BYTES) {
      if (!warnedOversize) {
        warnedOversize = true;
        process.stderr.write(
          'fabric: events.jsonl > 50MB, auto-rotating (also run "fabric doctor --fix" to inspect)\n',
        );
      }
      // ISS-025: size-triggered rotation so short-lived MCP spawns (which never
      // hit the 6h rotation tick) still bound the ledger. Archives down to half
      // the trigger for hysteresis — avoids re-rotating on every subsequent
      // append. Best-effort + awaited; rotation failures never fail the append.
      await rotateEventLedgerIfNeeded(projectRoot, {
        maxBytes: Math.floor(EVENT_LEDGER_SIZE_WARN_BYTES / 2),
      });
    }
  } catch {
    // ignore — size check / rotation is best-effort and must not fail the append
  }

  return nextEvent;
}

export async function readEventLedger(
  projectRoot: string,
  options: ReadEventLedgerOptions = {},
): Promise<ReadEventLedgerResult> {
  const eventPath = getEventLedgerPath(projectRoot);
  const warnings: LedgerWarning[] = [];
  let events: StoredEventLedgerEvent[] = [];
  const eventTypeFilter = options.event_type;

  // ISS-20260713-016: serve unfiltered full reads from mtime cache; filtered
  // callers still benefit when they reuse the cached events array in-memory.
  try {
    const st = statSync(eventPath);
    const cached = eventLedgerReadCache.get(eventPath);
    if (
      cached &&
      cached.mtimeMs === st.mtimeMs &&
      cached.size === st.size &&
      options.event_type === undefined &&
      options.since === undefined &&
      options.correlation_id === undefined &&
      options.session_id === undefined
    ) {
      return { events: cached.events.slice(), warnings: cached.warnings.slice() };
    }
  } catch {
    /* miss → fall through */
  }

  try {
    await visitCompleteLedgerLines(eventPath, (line, lineIndex) => {
      // ISS-005 pushdown: when the caller asks for one event_type (e.g.
      // loadIdRedirectMap's rare `knowledge_id_redirect`), skip the expensive
      // JSON.parse + Zod for lines that cannot match. A line whose raw text does
      // not contain the event_type token cannot carry that event_type (the value
      // appears verbatim in the JSON), so pruning it is loss-free. Substring
      // false-positives still get parsed and dropped by the post-parse filter
      // below — the result is byte-identical to a full scan. Warning
      // classification for unrelated lines is intentionally skipped here; the
      // doctor full-ledger scan passes no event_type and keeps full coverage.
      if (eventTypeFilter !== undefined && !line.includes(eventTypeFilter)) {
        return;
      }
      __eventLedgerParseStats.lineParses += 1;
      const parsed = parseEventLedgerLine(line, lineIndex);
      if (parsed !== null) {
        events.push(parsed);
        return;
      }
      const rejection = classifyRejection(line, lineIndex);
      if (rejection !== null) warnings.push(rejection);
    }, warnings);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { events: [], warnings: [] };
    }
    throw error;
  }

  // Populate process cache ONLY for a FULL unfiltered parse (ISS-20260713-016).
  // A filtered read (event_type/since/correlation_id/session_id) skips
  // non-matching lines via the pushdown above, so its `events` array is PARTIAL.
  // The cache lookup above serves ONLY unfiltered callers — so caching a
  // filtered read's partial (often empty) list under {mtime,size} would poison
  // the next unfiltered reader with a truncated result. Mirror the lookup guard:
  // store only when every narrowing option is absent.
  const isUnfilteredRead =
    options.event_type === undefined &&
    options.since === undefined &&
    options.correlation_id === undefined &&
    options.session_id === undefined;
  if (isUnfilteredRead) {
    try {
      const st = statSync(eventPath);
      eventLedgerReadCache.set(eventPath, {
        mtimeMs: st.mtimeMs,
        size: st.size,
        events: events.slice(),
        warnings: warnings.slice(),
      });
      // bound cache entries
      if (eventLedgerReadCache.size > 8) {
        const first = eventLedgerReadCache.keys().next().value;
        if (first !== undefined) eventLedgerReadCache.delete(first);
      }
    } catch {
      /* ignore cache store failures */
    }
  }

  const filtered = events
    .filter((entry) => options.event_type === undefined || entry.event_type === options.event_type)
    .filter((entry) => options.since === undefined || entry.ts >= options.since)
    .filter((entry) => options.correlation_id === undefined || entry.correlation_id === options.correlation_id)
    .filter((entry) => options.session_id === undefined || entry.session_id === options.session_id);

  return { events: filtered, warnings };
}

/** Test seam: clear process-local ledger cache. */
export function __resetEventLedgerReadCache(): void {
  eventLedgerReadCache.clear();
}


async function visitCompleteLedgerLines(
  eventPath: string,
  visitor: (line: string, lineIndex: number) => void,
  warnings: LedgerWarning[],
  onPartialTail?: (line: string, byteOffset: number, byteLength: number) => void,
): Promise<void> {
  let remainder = "";
  let bytesBeforeRemainder = 0;
  let lineIndex = 0;

  for await (const chunk of createReadStream(eventPath, { encoding: "utf8" })) {
    remainder += typeof chunk === "string" ? chunk : chunk.toString("utf8");

    let newlineIndex = remainder.indexOf("\n");
    while (newlineIndex !== -1) {
      const consumed = remainder.slice(0, newlineIndex + 1);
      let line = remainder.slice(0, newlineIndex);
      remainder = remainder.slice(newlineIndex + 1);
      bytesBeforeRemainder += Buffer.byteLength(consumed, "utf8");

      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }

      const trimmed = line.trim();
      if (trimmed.length > 0) {
        visitor(trimmed, lineIndex);
        lineIndex += 1;
      }

      newlineIndex = remainder.indexOf("\n");
    }
  }

  if (remainder.trim().length > 0) {
    const byteLength = Buffer.byteLength(remainder, "utf8");
    onPartialTail?.(remainder, bytesBeforeRemainder, byteLength);
    warnings.push({
      kind: "partial_write_at_tail",
      byte_offset: bytesBeforeRemainder,
      byte_length: byteLength,
      snippet_first_120: remainder.slice(0, 120),
    });
  }
}

/**
 * Truncates the ledger file at the last newline, preserving any partial trailing
 * bytes to a `.corrupted.{timestamp}` sidecar file for forensics.
 *
 * Returns the number of bytes truncated and the path to the corrupted sidecar
 * (empty string when the file was already clean).
 */
export async function truncateLedgerToLastNewline(
  path: string,
): Promise<{ truncated_bytes: number; corrupted_path: string }> {
  // F9: doctor-side truncation must hold the SAME cross-process lock the server
  // takes for appends/rotations, otherwise it can truncate the file mid-append.
  return withFileLock(eventLedgerLockPath(path), async () => {
    const raw = await readFile(path);
    const content = raw.toString("utf8");

    if (content.endsWith("\n") || content.length === 0) {
      return { truncated_bytes: 0, corrupted_path: "" };
    }

    const lastNewlineIndex = content.lastIndexOf("\n");

    if (lastNewlineIndex === -1) {
      // Entire file is one partial line — preserve all of it and truncate to empty.
      const corruptedPath = `${path}.corrupted.${Date.now()}`;
      await writeFile(corruptedPath, raw);
      await truncate(path, 0);
      return { truncated_bytes: raw.length, corrupted_path: corruptedPath };
    }

    // Keep everything up to and including the last newline.
    const keepByteLength = Buffer.byteLength(content.slice(0, lastNewlineIndex + 1), "utf8");
    const corruptedBytes = raw.slice(keepByteLength);
    const corruptedPath = `${path}.corrupted.${Date.now()}`;

    await writeFile(corruptedPath, corruptedBytes);
    await truncate(path, keepByteLength);

    return { truncated_bytes: corruptedBytes.length, corrupted_path: corruptedPath };
  });
}

function parseEventLedgerLine(line: string, index: number): StoredEventLedgerEvent | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const result = eventLedgerEventSchema.safeParse(parsed);
    if (!result.success) {
      return null;
    }

    return {
      ...result.data,
      id: result.data.id || createDerivedId(index, line),
    };
  } catch {
    return null;
  }
}

function createDerivedId(index: number, line: string): string {
  return `event:${index + 1}:${sha256(line).slice("sha256:".length)}`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

// v2.0.0-rc.22 Scope A T3: sliding-window-by-age rotation primitive.
//
// Partitions the main events.jsonl by `ts` against
// `cutoff = (opts.now ?? new Date()).getTime() - retentionDays * 86_400_000`,
// appending archived lines (NDJSON) to
// `.fabric/events.archive/events-rotated-YYYY-MM-DD.jsonl` (where date is the
// rotation-day in opts.now's local-ish ISO date) and atomically rewriting the
// main file with an `events_rotated` audit event as the first line followed by
// kept lines. Same-day re-runs APPEND to the existing archive file — they do
// not overwrite — which keeps multi-pass rotations forensically contiguous.
//
// All filesystem work runs inside `runExclusive(eventPath, ...)` so it
// serializes against `appendEventLedgerEvent` calls (and other rotation
// invocations) on the same path. Per the LedgerWriteQueue contract this is
// in-process, single-queue-instance scope — cross-process locking is a
// separate concern (out of scope for T3, deferred to T4 if needed).
//
// `retentionDays` resolution priority:
//   1. opts.retentionDays (explicit caller override — used by tests)
//   2. `.fabric/fabric-config.json#fabric_event_retention_days` (7/30/90)
//   3. EVENT_LEDGER_DEFAULT_RETENTION_DAYS (30)
//
// Returns `{ rotated: false }` when the ledger is empty, missing, or no
// readable line satisfies `ts < cutoff`. No audit event is emitted on no-op
// (the file is untouched).
export type RotateEventLedgerOptions = {
  now?: Date;
  retentionDays?: number;
  // ISS-025: byte budget for the RETAINED set. When set, after the age
  // partition the oldest kept lines are additionally archived until the
  // retained ledger fits within `maxBytes`. Bounds in-window growth on
  // high-frequency workspaces (age-only rotation kept everything younger than
  // the cutoff regardless of volume). Omitted → age-only behaviour (unchanged).
  maxBytes?: number;
};

export type RotateEventLedgerResult = {
  rotated: boolean;
  archivedCount: number;
  keptCount: number;
  archivePath?: string;
};

export async function rotateEventLedgerIfNeeded(
  projectRoot: string,
  opts: RotateEventLedgerOptions = {},
): Promise<RotateEventLedgerResult> {
  const eventPath = getEventLedgerPath(projectRoot);

  return exclusiveLedgerWrite(eventPath, async () => {
    const now = opts.now ?? new Date();
    const retentionDays = resolveRetentionDays(projectRoot, opts.retentionDays);
    const cutoffMs = now.getTime() - retentionDays * 86_400_000;

    try {
      statSync(eventPath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { rotated: false, archivedCount: 0, keptCount: 0 };
      }
      throw error;
    }

    // Tail tolerance: mirrors readEventLedger's partial-write handling.
    // A non-newline-terminated tail fragment is preserved as `keptTail` so
    // rotation does not silently drop a half-written line that the next
    // truncateLedgerToLastNewline pass would recover.
    let keptTail = "";
    const archived: string[] = [];
    const kept: string[] = [];

    await visitCompleteLedgerLines(
      eventPath,
      (trimmed) => {
        // Lines that fail to parse or lack a numeric ts get kept — the
        // rotation primitive must never throw away data it cannot classify.
        let ts: number | undefined;
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;
          const candidate = parsed["ts"];
          if (typeof candidate === "number" && Number.isFinite(candidate)) {
            ts = candidate;
          }
        } catch {
          // unparseable line — keep
        }

        if (ts !== undefined && ts < cutoffMs) {
          archived.push(trimmed);
        } else {
          kept.push(trimmed);
        }
      },
      [],
      (partialLine) => {
        keptTail = partialLine;
      },
    );

    // ISS-025: size-based rotation. Independent of age — archive the OLDEST
    // retained lines (front of the chronological kept[]) until the retained set
    // fits the byte budget, so a high-frequency workspace cannot grow the ledger
    // unbounded within the retention window. age-archived lines are already the
    // oldest, so archived[] stays chronologically ordered.
    if (opts.maxBytes !== undefined && opts.maxBytes >= 0) {
      let keptBytes = kept.reduce((sum, line) => sum + Buffer.byteLength(line, "utf8") + 1, 0);
      while (keptBytes > opts.maxBytes && kept.length > 0) {
        const oldest = kept.shift() as string;
        archived.push(oldest);
        keptBytes -= Buffer.byteLength(oldest, "utf8") + 1;
      }
    }

    if (archived.length === 0) {
      return {
        rotated: false,
        archivedCount: 0,
        keptCount: kept.length,
      };
    }

    // Build archive filename using the rotation date in UTC (YYYY-MM-DD).
    // UTC keeps the filename deterministic across machines with different
    // local timezones — operators inspecting archives on a CI box should see
    // the same filename as their workstation.
    const yyyymmdd = formatUtcDate(now);
    const archiveDirAbsolute = join(projectRoot, EVENT_LEDGER_ARCHIVE_DIR);
    const archiveFilename = `events-rotated-${yyyymmdd}.jsonl`;
    const archiveAbsolutePath = join(archiveDirAbsolute, archiveFilename);
    const archiveRelativePath = `${EVENT_LEDGER_ARCHIVE_DIR}/${archiveFilename}`;

    await mkdir(archiveDirAbsolute, { recursive: true });

    // Same-day appends accumulate into the same file. fs.appendFile creates
    // the file when absent, so the first rotation of the day and subsequent
    // rotations both go through this single code path.
    await appendFile(
      archiveAbsolutePath,
      archived.map((line) => `${line}\n`).join(""),
      "utf8",
    );

    // Build the audit event as the first line of the new main file. We
    // construct it directly (not via appendEventLedgerEvent) because we own
    // the write barrier inside runExclusive — re-entering the queue would
    // deadlock. The schema is still parsed to guarantee shape.
    const auditEvent = eventLedgerEventSchema.parse({
      kind: "fabric-event",
      id: `event:${randomUUID()}`,
      ts: now.getTime(),
      schema_version: 1,
      event_type: "events_rotated",
      cutoff_ts: new Date(cutoffMs).toISOString(),
      archived_count: archived.length,
      kept_count: kept.length,
      archive_path: archiveRelativePath,
    });

    const newMainLines: string[] = [JSON.stringify(auditEvent), ...kept];
    let newMainContent = newMainLines.join("\n") + "\n";
    if (keptTail.length > 0) {
      // Preserve a non-terminated tail fragment exactly — same byte position
      // semantics as before rotation so truncateLedgerToLastNewline can
      // still recover it.
      newMainContent += keptTail;
    }

    await atomicWriteText(eventPath, newMainContent);

    // ISS-20260711-128: final-delete expired cold archives (best-effort).
    try {
      await purgeExpiredEventArchives(projectRoot, { now, retentionDays });
    } catch {
      // never fail a successful rotation because archive GC failed
    }

    return {
      rotated: true,
      archivedCount: archived.length,
      keptCount: kept.length,
      archivePath: archiveRelativePath,
    };
  });
}

// v2.0.0-rc.39: generic predicate-driven drop. Archives every line whose
// parsed JSON satisfies `predicate` to `.fabric/events.archive/events-
// {label}-YYYY-MM-DD.jsonl` and atomically rewrites the main ledger without
// them. Mirrors rotateEventLedgerIfNeeded's archive/rewrite/tail-tolerance
// machinery but cuts on an arbitrary predicate instead of a time cutoff — used
// by the cite-audit rollup to drop rolled-up assistant_turn_observed rows while
// leaving every other event in place. Lines that fail to parse are always kept
// (never drop data we cannot classify). Reuses the `events_rotated` audit event
// (its archived_count/kept_count/archive_path fields describe the drop exactly).
export async function dropEventsFromLedger(
  projectRoot: string,
  opts: { predicate: (parsed: Record<string, unknown>) => boolean; label: string; now?: Date },
): Promise<RotateEventLedgerResult> {
  const eventPath = getEventLedgerPath(projectRoot);

  return exclusiveLedgerWrite(eventPath, async () => {
    const now = opts.now ?? new Date();

    let raw: string;
    try {
      raw = await readFile(eventPath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { rotated: false, archivedCount: 0, keptCount: 0 };
      }
      throw error;
    }
    if (raw.length === 0) {
      return { rotated: false, archivedCount: 0, keptCount: 0 };
    }

    const hasTrailingNewline = raw.endsWith("\n");
    const segments = raw.split(/\r?\n/);
    let keptTail = "";
    if (!hasTrailingNewline && segments.length > 0) {
      keptTail = segments.pop() ?? "";
    }

    const archived: string[] = [];
    const kept: string[] = [];
    for (const line of segments) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      let drop = false;
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        drop = opts.predicate(parsed);
      } catch {
        drop = false; // unparseable — keep
      }
      if (drop) archived.push(trimmed);
      else kept.push(trimmed);
    }

    if (archived.length === 0) {
      return { rotated: false, archivedCount: 0, keptCount: kept.length };
    }

    // v2.0.0-rc.39 (T6): dropEventsFromLedger backs the cite-audit rollup and
    // the one-time empty-shell fold — both produce LARGE one-shot dumps (tens of
    // MB on heavy dogfood). Write the archive gzip-compressed (.jsonl.gz) so the
    // cold-storage dump does not balloon the repo. Same-day same-label re-runs
    // append by decompress→concat→recompress (rare; the fold is idempotent so a
    // second run finds nothing to archive). Archives are cold storage — no live
    // reader globs events.archive/, so .gz is purely a disk-footprint win.
    // ISS-20260711-133: write immutable uniquely-named gzip members instead of
    // decompress→concat→recompress of the whole same-day archive (event-loop
    // blocking + peak memory grow with archive size).
    const yyyymmdd = formatUtcDate(now);
    const archiveDirAbsolute = join(projectRoot, EVENT_LEDGER_ARCHIVE_DIR);
    const archiveFilename = `events-${opts.label}-${yyyymmdd}-${now.getTime()}.jsonl.gz`;
    const archiveAbsolutePath = join(archiveDirAbsolute, archiveFilename);
    const archiveRelativePath = `${EVENT_LEDGER_ARCHIVE_DIR}/${archiveFilename}`;

    await mkdir(archiveDirAbsolute, { recursive: true });
    const newArchiveText = archived.map((line) => `${line}\n`).join("");
    await writeFile(archiveAbsolutePath, gzipSync(Buffer.from(newArchiveText, "utf8")));

    const auditEvent = eventLedgerEventSchema.parse({
      kind: "fabric-event",
      id: `event:${randomUUID()}`,
      ts: now.getTime(),
      schema_version: 1,
      event_type: "events_rotated",
      cutoff_ts: now.toISOString(),
      archived_count: archived.length,
      kept_count: kept.length,
      archive_path: archiveRelativePath,
    });

    const newMainLines: string[] = [JSON.stringify(auditEvent), ...kept];
    let newMainContent = newMainLines.join("\n") + "\n";
    if (keptTail.length > 0) newMainContent += keptTail;
    await atomicWriteText(eventPath, newMainContent);

    return {
      rotated: true,
      archivedCount: archived.length,
      keptCount: kept.length,
      archivePath: archiveRelativePath,
    };
  });
}


// ISS-20260711-128: age retention only moved lines into events.archive/; archives
// were never deleted and grew forever. After a successful main-ledger rotation,
// drop archive files whose YYYY-MM-DD filename date is older than
// archiveRetentionDays (default 3× active retention, floor 90). Best-effort —
// archive purge failures never fail the rotation that just succeeded.
const EVENT_LEDGER_ARCHIVE_RETENTION_FLOOR_DAYS = 90;

async function purgeExpiredEventArchives(
  projectRoot: string,
  opts: { now: Date; retentionDays: number },
): Promise<number> {
  const archiveDirAbsolute = join(projectRoot, EVENT_LEDGER_ARCHIVE_DIR);
  let names: string[];
  try {
    names = await readdir(archiveDirAbsolute);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return 0;
    throw error;
  }
  const archiveRetentionDays = Math.max(
    opts.retentionDays * 3,
    EVENT_LEDGER_ARCHIVE_RETENTION_FLOOR_DAYS,
  );
  const cutoffMs = opts.now.getTime() - archiveRetentionDays * 86_400_000;
  let deleted = 0;
  for (const name of names) {
    // events-rotated-YYYY-MM-DD.jsonl or events-<label>-YYYY-MM-DD.jsonl(.gz)
    const match = /(\d{4}-\d{2}-\d{2})(?:\.jsonl(?:\.gz)?)?$/u.exec(name);
    if (match === null) continue;
    const stamp = match[1]!;
    const fileMs = Date.parse(`${stamp}T00:00:00.000Z`);
    if (!Number.isFinite(fileMs) || fileMs >= cutoffMs) continue;
    try {
      await unlink(join(archiveDirAbsolute, name));
      deleted += 1;
    } catch {
      // best-effort
    }
  }
  return deleted;
}

function resolveRetentionDays(projectRoot: string, override?: number): number {
  if (typeof override === "number" && Number.isFinite(override) && override >= 0) {
    return override;
  }
  // Best-effort config read — schema-equivalent to fabricConfigSchema's
  // `fabric_event_retention_days` (7/30/90 literal union) but defensive at
  // the call site so a corrupt config never blocks rotation. Falls back to
  // EVENT_LEDGER_DEFAULT_RETENTION_DAYS on any failure.
  const configPath = join(projectRoot, ".fabric", "fabric-config.json");
  try {
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const v = (parsed as Record<string, unknown>).fabric_event_retention_days;
        if (v === 7 || v === 30 || v === 90) {
          return v;
        }
      }
    }
  } catch {
    // fall through to default
  }
  return EVENT_LEDGER_DEFAULT_RETENTION_DAYS;
}

function formatUtcDate(date: Date): string {
  const yyyy = date.getUTCFullYear().toString().padStart(4, "0");
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = date.getUTCDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Synchronously fsync the event ledger file to ensure OS page-cache buffers are
 * flushed to durable storage. Must be called AFTER in-flight drain but BEFORE
 * server.close() — Gemini G1 ordering requirement.
 *
 * Uses sync APIs intentionally: we are inside a signal handler and need
 * guaranteed completion before process.exit().
 */
export function flushAndSyncEventLedger(projectRoot: string): void {
  const ledgerPath = getEventLedgerPath(projectRoot);
  if (!existsSync(ledgerPath)) return;
  const fd = openSync(ledgerPath, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
