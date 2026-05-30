import { describe, expect, it } from 'vitest'
import { MCPError } from '../src/errors/index'
import { enforcePayloadLimit, trimToPayloadBudget } from '../src/node/mcp-payload-guard'

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

describe('trimToPayloadBudget (W1-T4 payload-budget truncation tail)', () => {
  // Envelope: a fixed ~base plus one line per kept item. Each item serializes
  // to a known chunk so byte math is predictable.
  const itemChunk = (n: number) => 'y'.repeat(n)

  it('keeps all items when the envelope already fits', () => {
    const items = [itemChunk(10), itemChunk(10), itemChunk(10)]
    const res = trimToPayloadBudget(items, (kept) => JSON.stringify(kept), { hardBytes: 10_000 })
    expect(res.dropped).toBe(0)
    expect(res.items).toHaveLength(3)
    expect(res.overBudget).toBe(false)
  })

  it('drops items off the tail until the envelope fits the hard budget', () => {
    const items = Array.from({ length: 10 }, () => itemChunk(100))
    // Each item ~100 bytes + JSON quoting/commas. Cap small enough to force drops.
    const res = trimToPayloadBudget(items, (kept) => JSON.stringify(kept), { hardBytes: 350 })
    expect(res.dropped).toBeGreaterThan(0)
    expect(res.items.length).toBe(10 - res.dropped)
    expect(res.bytes).toBeLessThanOrEqual(350)
    expect(res.overBudget).toBe(false)
    // trimming is tail-first: the retained items are the head slice.
    expect(res.items).toEqual(items.slice(0, res.items.length))
  })

  it('respects minKeep and reports overBudget when even the head overflows', () => {
    const items = [itemChunk(1000), itemChunk(1000)]
    const res = trimToPayloadBudget(items, (kept) => JSON.stringify(kept), { hardBytes: 50, minKeep: 1 })
    expect(res.items).toHaveLength(1) // never trims below minKeep
    expect(res.overBudget).toBe(true)
  })

  it('counts the FULL envelope (not just the list) when deciding to trim', () => {
    const items = [itemChunk(10), itemChunk(10)]
    const fatEnvelope = (kept: string[]) => JSON.stringify({ padding: 'z'.repeat(500), candidates: kept })
    const res = trimToPayloadBudget(items, fatEnvelope, { hardBytes: 520 })
    // The 500-byte padding pushes the envelope over even though the list is tiny,
    // so at least one item is dropped.
    expect(res.dropped).toBeGreaterThan(0)
  })
})

describe('trimToPayloadBudget — warning-on-trim accounting (W1-REVIEW gemini HIGH regression)', () => {
  // Reproduces the plan_context composition: the serialize envelope is BARE for
  // the full list but carries a ~250B trim-warning once any item is dropped.
  // The bug was measuring bare, fitting hardBytes, THEN appending the warning —
  // which re-breached the limit. The fix measures WITH the warning while
  // trimming, so the FINAL payload (warning included) is what stays bounded.
  it('keeps the final warning-bearing payload within hardBytes', () => {
    const items = Array.from({ length: 20 }, () => 'y'.repeat(100))
    const WARNING_SUFFIX = `,"warnings":["${'w'.repeat(240)}"]`
    const serialize = (kept: string[]) =>
      kept.length === items.length ? JSON.stringify(kept) : JSON.stringify(kept) + WARNING_SUFFIX
    const hardBytes = 700

    const res = trimToPayloadBudget(items, serialize, { hardBytes })

    // The actual envelope the caller ships (with the warning) must fit — the
    // pre-fix code would leave this just over hardBytes.
    expect(res.dropped).toBeGreaterThan(0)
    expect(Buffer.byteLength(serialize(res.items), 'utf8')).toBeLessThanOrEqual(hardBytes)
  })
})
