import { describe, expect, it } from 'vitest'
import { MCPError } from '../src/errors/index'
import { enforcePayloadLimit } from '../src/node/mcp-payload-guard'

const DEFAULT_WARN = 16384  // 16KB
const DEFAULT_HARD = 65536  // 64KB

function makePayload(bytes: number): string {
  // 'x' is 1 byte in utf-8
  return 'x'.repeat(bytes)
}

describe('enforcePayloadLimit', () => {
  describe('below warn threshold', () => {
    it('returns bytes with no warning for empty payload', () => {
      const result = enforcePayloadLimit('')
      expect(result.bytes).toBe(0)
      expect(result.warning).toBeUndefined()
    })

    it('returns bytes with no warning for payload just under warn threshold', () => {
      const payload = makePayload(DEFAULT_WARN - 1)
      const result = enforcePayloadLimit(payload)
      expect(result.bytes).toBe(DEFAULT_WARN - 1)
      expect(result.warning).toBeUndefined()
    })

    it('returns bytes with no warning at exactly the warn threshold', () => {
      const payload = makePayload(DEFAULT_WARN)
      const result = enforcePayloadLimit(payload)
      expect(result.bytes).toBe(DEFAULT_WARN)
      expect(result.warning).toBeUndefined()
    })
  })

  describe('between warn and hard thresholds', () => {
    it('returns warning with code mcp_payload_warn for payload just above warn threshold', () => {
      const payload = makePayload(DEFAULT_WARN + 1)
      const result = enforcePayloadLimit(payload)
      expect(result.bytes).toBe(DEFAULT_WARN + 1)
      expect(result.warning).toBeDefined()
      expect(result.warning?.code).toBe('mcp_payload_warn')
      expect(result.warning?.bytes).toBe(DEFAULT_WARN + 1)
      expect(result.warning?.threshold).toBe(DEFAULT_WARN)
    })

    it('returns warning for payload just below hard limit', () => {
      const payload = makePayload(DEFAULT_HARD - 1)
      const result = enforcePayloadLimit(payload)
      expect(result.bytes).toBe(DEFAULT_HARD - 1)
      expect(result.warning).toBeDefined()
      expect(result.warning?.code).toBe('mcp_payload_warn')
    })

    it('warning message references actual bytes and threshold', () => {
      const bytes = DEFAULT_WARN + 100
      const payload = makePayload(bytes)
      const result = enforcePayloadLimit(payload)
      expect(result.warning?.message).toContain(String(bytes))
      expect(result.warning?.message).toContain(String(DEFAULT_WARN))
    })
  })

  describe('above hard threshold', () => {
    it('throws MCPError when payload exceeds hard limit', () => {
      const payload = makePayload(DEFAULT_HARD + 1)
      expect(() => enforcePayloadLimit(payload)).toThrow()
    })

    it('thrown error is instanceof MCPError', () => {
      const payload = makePayload(DEFAULT_HARD + 1)
      expect(() => enforcePayloadLimit(payload)).toThrowError(MCPError)
    })

    it('thrown error has code MCP_PAYLOAD_TOO_LARGE', () => {
      const payload = makePayload(DEFAULT_HARD + 1)
      try {
        enforcePayloadLimit(payload)
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(MCPError)
        if (err instanceof MCPError) {
          expect((err as MCPError & { code: string }).code).toBe('MCP_PAYLOAD_TOO_LARGE')
        }
      }
    })

    it('thrown error has httpStatus 413', () => {
      const payload = makePayload(DEFAULT_HARD + 1)
      try {
        enforcePayloadLimit(payload)
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(MCPError)
        if (err instanceof MCPError) {
          expect((err as MCPError & { httpStatus: number }).httpStatus).toBe(413)
        }
      }
    })

    it('actionHint mentions fabric.config.json mcpPayloadLimits.hardBytes', () => {
      const payload = makePayload(DEFAULT_HARD + 1)
      try {
        enforcePayloadLimit(payload)
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(MCPError)
        if (err instanceof MCPError) {
          expect((err as MCPError).actionHint).toContain('mcpPayloadLimits.hardBytes')
          expect((err as MCPError).actionHint).toContain('fabric.config.json')
        }
      }
    })
  })

  describe('custom thresholds', () => {
    it('respects custom warnBytes override', () => {
      const customWarn = 100
      const payload = makePayload(customWarn + 1)
      const result = enforcePayloadLimit(payload, { warnBytes: customWarn, hardBytes: DEFAULT_HARD })
      expect(result.warning).toBeDefined()
      expect(result.warning?.threshold).toBe(customWarn)
    })

    it('no warning below custom warnBytes', () => {
      const customWarn = 500
      const payload = makePayload(customWarn - 1)
      const result = enforcePayloadLimit(payload, { warnBytes: customWarn, hardBytes: DEFAULT_HARD })
      expect(result.warning).toBeUndefined()
    })

    it('respects custom hardBytes override — throws above it', () => {
      const customHard = 200
      const payload = makePayload(customHard + 1)
      expect(() => enforcePayloadLimit(payload, { warnBytes: 100, hardBytes: customHard })).toThrowError(MCPError)
    })

    it('does not throw below custom hardBytes', () => {
      const customHard = 200
      const payload = makePayload(customHard - 1)
      expect(() =>
        enforcePayloadLimit(payload, { warnBytes: 100, hardBytes: customHard }),
      ).not.toThrow()
    })

    it('custom warn and hard both applied correctly — warn zone', () => {
      const customWarn = 50
      const customHard = 200
      const payload = makePayload(100)
      const result = enforcePayloadLimit(payload, { warnBytes: customWarn, hardBytes: customHard })
      expect(result.bytes).toBe(100)
      expect(result.warning).toBeDefined()
      expect(result.warning?.code).toBe('mcp_payload_warn')
    })
  })
})
