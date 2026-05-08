/**
 * Integration: mcp-payload-guard boundary cases — shared.md §2 I4, §3 T3
 *
 * I4: >16KB triggers warning (no throw), >64KB throws MCPError.
 *     Boundary: size === threshold is on the SAFE side (>  not >=).
 *
 * T3: Explicit boundary tests for 16384 / 16385 / 65535 / 65536 bytes.
 *     UTF-8 multi-byte: Buffer.byteLength != string.length for non-ASCII.
 */
import { describe, expect, it } from 'vitest'

import { enforcePayloadLimit } from '../../src/node/mcp-payload-guard.js'
import { MCPError } from '../../src/errors/index.js'

const WARN = 16384  // 16 * 1024
const HARD = 65536  // 64 * 1024

// ---------------------------------------------------------------------------
// T3 — Exact byte-boundary tests
// ---------------------------------------------------------------------------
describe('T3 I4 exact boundary: 16384 bytes', () => {
  it('16384 bytes: no warning (== WARN, boundary is safe side: > not >=)', () => {
    const payload = 'x'.repeat(WARN)
    const result = enforcePayloadLimit(payload)
    expect(result.bytes).toBe(WARN)
    expect(result.warning).toBeUndefined()
  })

  it('16385 bytes: warning emitted (just above warn threshold)', () => {
    const payload = 'x'.repeat(WARN + 1)
    const result = enforcePayloadLimit(payload)
    expect(result.bytes).toBe(WARN + 1)
    expect(result.warning).toBeDefined()
    expect(result.warning?.code).toBe('mcp_payload_warn')
    expect(result.warning?.threshold).toBe(WARN)
  })
})

describe('T3 I4 exact boundary: 65535 bytes', () => {
  it('65535 bytes: warning emitted (just below hard threshold)', () => {
    const payload = 'x'.repeat(HARD - 1)
    const result = enforcePayloadLimit(payload)
    expect(result.bytes).toBe(HARD - 1)
    expect(result.warning).toBeDefined()
    expect(result.warning?.code).toBe('mcp_payload_warn')
  })

  it('65536 bytes: no throw (== HARD, boundary is safe side: > not >=)', () => {
    const payload = 'x'.repeat(HARD)
    const result = enforcePayloadLimit(payload)
    expect(result.bytes).toBe(HARD)
    expect(result.warning).toBeDefined()
    // No throw at exact boundary
  })

  it('65537 bytes: throws MCPError (just above hard threshold)', () => {
    const payload = 'x'.repeat(HARD + 1)
    expect(() => enforcePayloadLimit(payload)).toThrow()
    try {
      enforcePayloadLimit(payload)
    } catch (err) {
      expect(err).toBeInstanceOf(MCPError)
      expect((err as MCPError & { code: string }).code).toBe('MCP_PAYLOAD_TOO_LARGE')
    }
  })
})

// ---------------------------------------------------------------------------
// T3 — UTF-8 multi-byte character boundary tests
// ---------------------------------------------------------------------------
describe('T3 UTF-8 multi-byte: byteLength vs string.length', () => {
  it('2-byte UTF-8 characters (e.g. ñ, U+00F1): byteLength > string.length', () => {
    // ñ (U+00F1) encodes to 2 bytes in UTF-8
    const twoByteChar = '\u00f1'  // ñ
    const charByteLength = Buffer.byteLength(twoByteChar, 'utf8')
    expect(charByteLength).toBe(2)

    // Build a string where byteLength is exactly WARN + 1 but string.length < WARN + 1
    // WARN = 16384; each ñ is 2 bytes, so 8193 ñ chars = 16386 bytes
    const multiBytePayload = twoByteChar.repeat(8193)
    expect(Buffer.byteLength(multiBytePayload, 'utf8')).toBe(16386)
    expect(multiBytePayload.length).toBe(8193)  // string.length is half

    const result = enforcePayloadLimit(multiBytePayload)
    expect(result.bytes).toBe(16386)
    expect(result.warning).toBeDefined()  // >16384 bytes triggers warning
  })

  it('3-byte UTF-8 characters (e.g. Chinese): byteLength is 3x string.length', () => {
    // 中 (U+4E2D) encodes to 3 bytes in UTF-8
    const threeByteChar = '\u4e2d'  // 中
    const charByteLength = Buffer.byteLength(threeByteChar, 'utf8')
    expect(charByteLength).toBe(3)

    // 5462 * 3 = 16386 bytes > WARN
    const multiBytePayload = threeByteChar.repeat(5462)
    expect(Buffer.byteLength(multiBytePayload, 'utf8')).toBe(16386)
    expect(multiBytePayload.length).toBe(5462)  // string.length

    const result = enforcePayloadLimit(multiBytePayload)
    expect(result.bytes).toBe(16386)
    expect(result.warning).toBeDefined()
  })

  it('4-byte UTF-8 characters (emoji): byteLength is 4x string code unit count', () => {
    // 😀 (U+1F600) is a supplementary character: encodes to 4 bytes UTF-8
    const fourByteChar = '\u{1F600}'  // 😀
    const charByteLength = Buffer.byteLength(fourByteChar, 'utf8')
    expect(charByteLength).toBe(4)

    // To cross HARD = 65536: 65536 / 4 = 16384 chars → 65536 bytes (exact boundary, no throw)
    const exactHardPayload = fourByteChar.repeat(16384)
    expect(Buffer.byteLength(exactHardPayload, 'utf8')).toBe(65536)

    const result = enforcePayloadLimit(exactHardPayload)
    expect(result.bytes).toBe(65536)
    // At exactly HARD bytes, it's warning but no throw (boundary is >)
    expect(() => enforcePayloadLimit(exactHardPayload)).not.toThrow()

    // One more char: 65540 bytes > HARD → throw
    const overHardPayload = fourByteChar.repeat(16385)
    expect(Buffer.byteLength(overHardPayload, 'utf8')).toBe(65540)
    expect(() => enforcePayloadLimit(overHardPayload)).toThrow()
  })

  it('mixed ASCII and multi-byte: byteLength accounts for mixed encoding', () => {
    // Build a payload that has ASCII up to near WARN, then push over with multi-byte
    const ascii = 'a'.repeat(WARN - 1)  // 16383 bytes
    const mbChar = '\u00e9'  // é = 2 bytes
    const mixed = ascii + mbChar  // 16383 + 2 = 16385 bytes
    expect(Buffer.byteLength(mixed, 'utf8')).toBe(16385)
    expect(mixed.length).toBe(16384)  // string.length

    const result = enforcePayloadLimit(mixed)
    expect(result.bytes).toBe(16385)
    expect(result.warning).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// I4 — Warn at exactly warnAt=16384, throw at hardAt=65536 (default config)
// ---------------------------------------------------------------------------
describe('I4 default thresholds summary', () => {
  const cases = [
    { bytes: 0, expectWarning: false, expectThrow: false },
    { bytes: 1, expectWarning: false, expectThrow: false },
    { bytes: 16383, expectWarning: false, expectThrow: false },
    { bytes: 16384, expectWarning: false, expectThrow: false },
    { bytes: 16385, expectWarning: true, expectThrow: false },
    { bytes: 65535, expectWarning: true, expectThrow: false },
    { bytes: 65536, expectWarning: true, expectThrow: false },
    { bytes: 65537, expectWarning: false, expectThrow: true },
  ]

  for (const { bytes, expectWarning, expectThrow } of cases) {
    it(`${bytes} bytes → warning=${expectWarning}, throw=${expectThrow}`, () => {
      const payload = 'x'.repeat(bytes)
      if (expectThrow) {
        expect(() => enforcePayloadLimit(payload)).toThrow()
      } else {
        const result = enforcePayloadLimit(payload)
        expect(result.bytes).toBe(bytes)
        if (expectWarning) {
          expect(result.warning).toBeDefined()
          expect(result.warning?.code).toBe('mcp_payload_warn')
        } else {
          expect(result.warning).toBeUndefined()
        }
      }
    })
  }
})
