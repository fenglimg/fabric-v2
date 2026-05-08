/**
 * Integration: FabricError actionHint guard — shared.md §2 I9
 *
 * I9: FabricError constructor throws when actionHint is missing or empty string.
 *     No FabricError instance may escape without a non-empty actionHint.
 */
import { describe, expect, it } from 'vitest'

import {
  ConfigPathInvalidError,
  GenericConfigError,
  GenericIOError,
  InitFrameworkUnknownError,
  McpToolError,
  PathEscapeError,
  RuleValidationError,
} from '../../src/errors/index.js'

const ALL_CONCRETE_CLASSES = [
  ConfigPathInvalidError,
  GenericConfigError,
  RuleValidationError,
  PathEscapeError,
  GenericIOError,
  McpToolError,
  InitFrameworkUnknownError,
] as const

type ConcreteErrorConstructor = (new (
  msg: string,
  opts: { actionHint: string; fixable?: boolean; details?: unknown },
) => unknown)

// ---------------------------------------------------------------------------
// I9.1 — Empty string actionHint throws
// ---------------------------------------------------------------------------
describe('I9 actionHint guard: empty string throws', () => {
  for (const Cls of ALL_CONCRETE_CLASSES) {
    it(`${Cls.name}: throws on actionHint = ''`, () => {
      expect(() => new (Cls as ConcreteErrorConstructor)('msg', { actionHint: '' })).toThrow(
        'FabricError: actionHint is required and must be non-empty',
      )
    })
  }
})

// ---------------------------------------------------------------------------
// I9.2 — undefined actionHint throws
// ---------------------------------------------------------------------------
describe('I9 actionHint guard: undefined throws', () => {
  for (const Cls of ALL_CONCRETE_CLASSES) {
    it(`${Cls.name}: throws on actionHint = undefined`, () => {
      expect(
        () =>
          new (Cls as ConcreteErrorConstructor)('msg', {
            actionHint: undefined as unknown as string,
          }),
      ).toThrow('FabricError: actionHint is required and must be non-empty')
    })
  }
})

// ---------------------------------------------------------------------------
// I9.3 — Valid actionHint does NOT throw
// ---------------------------------------------------------------------------
describe('I9 actionHint guard: valid string succeeds', () => {
  it('ConfigPathInvalidError accepts non-empty actionHint', () => {
    expect(() => new ConfigPathInvalidError('msg', { actionHint: 'Fix it.' })).not.toThrow()
  })

  it('McpToolError accepts non-empty actionHint with details', () => {
    expect(
      () => new McpToolError('msg', { actionHint: 'Reduce payload.', details: { bytes: 100 } }),
    ).not.toThrow()
  })

  it('ActionHint is stored verbatim (no trimming, preserves spaces)', () => {
    const hint = '  Check /etc/config.json for syntax errors.  '
    const err = new GenericConfigError('msg', { actionHint: hint })
    expect(err.actionHint).toBe(hint)
  })
})

// ---------------------------------------------------------------------------
// I9.4 — actionHint whitespace-only: implementation validation
// ---------------------------------------------------------------------------
describe('I9 actionHint guard: whitespace-only behavior', () => {
  it('whitespace-only string does NOT throw (implementation: only checks length === 0)', () => {
    // The FabricError check is: !opts.actionHint || opts.actionHint.length === 0
    // A string of spaces has length > 0, so it passes the guard.
    // This is a documentation of current implementation behavior — not a specification change.
    const err = new GenericConfigError('msg', { actionHint: '   ' })
    expect(err.actionHint).toBe('   ')
    // Note: If spec required trim(), this would fail. Document as actual behavior.
  })
})
