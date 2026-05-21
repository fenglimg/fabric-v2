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
