import { MCPError } from '../errors/index.js'

class McpPayloadTooLargeError extends MCPError {
  readonly code = 'MCP_PAYLOAD_TOO_LARGE'
  readonly httpStatus = 413
}

export interface PayloadGuardOptions {
  warnBytes?: number  // default 16384 (16KB)
  hardBytes?: number  // default 65536 (64KB)
}

export interface PayloadGuardResult {
  bytes: number
  warning?: { code: 'mcp_payload_warn'; message: string; bytes: number; threshold: number }
}

// v2.0.0-rc.29 TASK-008 (BUG-F2): publish the default thresholds so doctor
// (and any other operator-facing surface) can render the active values
// without re-deriving them. The defaults are intentionally narrow:
//   warn  = 16 KiB (legible payload, room for >1 MCP round-trip per minute)
//   hard  = 64 KiB (single MCP tool result safely fits stdio + websocket)
// Override via fabric.config.json `mcpPayloadLimits.{warnBytes,hardBytes}`.
export const PAYLOAD_LIMIT_DEFAULT_WARN_BYTES = 16384
export const PAYLOAD_LIMIT_DEFAULT_HARD_BYTES = 65536
const DEFAULT_WARN = PAYLOAD_LIMIT_DEFAULT_WARN_BYTES
const DEFAULT_HARD = PAYLOAD_LIMIT_DEFAULT_HARD_BYTES

export function enforcePayloadLimit(
  serializedPayload: string,
  opts?: PayloadGuardOptions,
): PayloadGuardResult {
  const warnAt = opts?.warnBytes ?? DEFAULT_WARN
  const hardAt = opts?.hardBytes ?? DEFAULT_HARD
  const bytes = Buffer.byteLength(serializedPayload, 'utf8')
  if (bytes > hardAt) {
    throw new McpPayloadTooLargeError(
      `MCP payload ${bytes} bytes exceeds hard limit ${hardAt}`,
      {
        actionHint: `Reduce response size or increase fabric.config.json mcpPayloadLimits.hardBytes`,
        details: { bytes, threshold: hardAt },
      },
    )
  }
  if (bytes > warnAt) {
    return {
      bytes,
      warning: {
        code: 'mcp_payload_warn',
        message: `Payload ${bytes}B exceeds warning threshold ${warnAt}B`,
        bytes,
        threshold: warnAt,
      },
    }
  }
  return { bytes }
}

export interface PayloadBudgetTrimResult<T> {
  /** The retained head of `items` (the ranked tail was dropped to fit). */
  items: T[]
  /** How many trailing items were dropped to fit the hard budget. */
  dropped: number
  /** Serialized byte size of the envelope built from the retained items. */
  bytes: number
  /**
   * True when even `minKeep` items still overflow the hard budget — the caller
   * must surface this (a single oversized entry) rather than assume it fit.
   */
  overBudget: boolean
}

/**
 * v2.2 MC4-payload-budget (W1-T4): the byte-budget tail of the unified
 * truncation chain (CJK → BM25 → top_k → payload). Rather than hard-throwing
 * when a response overflows the hard limit, callers trim the LEAST-relevant
 * items off the tail of an already-ranked list until the serialized envelope
 * fits — turning a 413 crash into graceful degradation.
 *
 * `serialize` builds the FULL response envelope from a candidate slice (so the
 * byte count includes warnings / metadata, not just the list). Trimming drops
 * from the END, which is correct ONLY when the list is pre-ranked best-first
 * (plan_context sorts by BM25 before calling this). `minKeep` (default 1)
 * guarantees a non-empty result even under a pathological oversized head; in
 * that case `overBudget` is returned true so the caller can warn instead of
 * silently shipping an over-limit payload.
 */
export function trimToPayloadBudget<T>(
  items: T[],
  serialize: (items: T[]) => string,
  opts?: PayloadGuardOptions & { minKeep?: number },
): PayloadBudgetTrimResult<T> {
  const hardAt = opts?.hardBytes ?? DEFAULT_HARD
  const minKeep = Math.max(0, opts?.minKeep ?? 1)
  let kept = items
  let bytes = Buffer.byteLength(serialize(kept), 'utf8')
  let dropped = 0
  while (bytes > hardAt && kept.length > minKeep) {
    kept = kept.slice(0, -1)
    dropped += 1
    bytes = Buffer.byteLength(serialize(kept), 'utf8')
  }
  return { items: kept, dropped, bytes, overBudget: bytes > hardAt }
}
