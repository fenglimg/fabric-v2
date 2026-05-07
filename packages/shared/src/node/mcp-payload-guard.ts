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

const DEFAULT_WARN = 16384
const DEFAULT_HARD = 65536

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
