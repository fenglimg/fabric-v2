/**
 * Integration: FabricError.toJSON() shape — shared.md §2 I6
 *
 * I6: toJSON() contains name/code/message/actionHint/fixable;
 *     details appears only when defined; output can be routed by code.
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

// ---------------------------------------------------------------------------
// I6.1 — Required fields present in every toJSON() output
// ---------------------------------------------------------------------------
describe('I6 toJSON required fields', () => {
  it('ConfigPathInvalidError toJSON has all required fields', () => {
    const err = new ConfigPathInvalidError('bad config path', { actionHint: 'Fix the path.' })
    const json = err.toJSON()

    expect(typeof json.name).toBe('string')
    expect(typeof json.code).toBe('string')
    expect(typeof json.message).toBe('string')
    expect(typeof json.actionHint).toBe('string')
    expect(typeof json.fixable).toBe('boolean')

    expect(json.name).toBe('ConfigPathInvalidError')
    expect(json.code).toBe('config_path_invalid')
    expect(json.message).toBe('bad config path')
    expect(json.actionHint).toBe('Fix the path.')
    expect(json.fixable).toBe(false)
  })

  it('RuleValidationError toJSON has correct code and httpStatus accessible', () => {
    const err = new RuleValidationError('invalid rule', { actionHint: 'Fix the rule syntax.' })
    const json = err.toJSON()

    expect(json.code).toBe('rule_validation_error')
    expect(json.name).toBe('RuleValidationError')
    expect(json.actionHint).toBe('Fix the rule syntax.')
  })

  it('PathEscapeError toJSON code is PATH_OUTSIDE_PROJECT_ROOT', () => {
    const err = new PathEscapeError('path escaped', { actionHint: 'Stay within root.' })
    const json = err.toJSON()
    expect(json.code).toBe('PATH_OUTSIDE_PROJECT_ROOT')
    expect(json.name).toBe('PathEscapeError')
  })
})

// ---------------------------------------------------------------------------
// I6.2 — details field appears iff provided
// ---------------------------------------------------------------------------
describe('I6 toJSON details field', () => {
  it('details is absent when not provided (key not in object)', () => {
    const err = new GenericConfigError('msg', { actionHint: 'hint' })
    const json = err.toJSON()
    expect('details' in json).toBe(false)
  })

  it('details is absent when undefined explicitly', () => {
    const err = new GenericConfigError('msg', { actionHint: 'hint', details: undefined })
    const json = err.toJSON()
    expect('details' in json).toBe(false)
  })

  it('details is included when defined as object', () => {
    const err = new GenericConfigError('msg', { actionHint: 'hint', details: { path: '/etc/config.json', reason: 'parse failed' } })
    const json = err.toJSON()
    expect(json.details).toEqual({ path: '/etc/config.json', reason: 'parse failed' })
  })

  it('details is included when defined as string', () => {
    const err = new GenericIOError('io error', { actionHint: 'Fix io.', details: 'ENOENT' })
    const json = err.toJSON()
    expect(json.details).toBe('ENOENT')
  })

  it('details is included when defined as number', () => {
    const err = new McpToolError('mcp error', { actionHint: 'Fix mcp.', details: 42 })
    const json = err.toJSON()
    expect(json.details).toBe(42)
  })
})

// ---------------------------------------------------------------------------
// I6.3 — fixable field reflects constructor argument
// ---------------------------------------------------------------------------
describe('I6 toJSON fixable field', () => {
  it('fixable defaults to false', () => {
    const err = new GenericConfigError('msg', { actionHint: 'hint' })
    expect(err.toJSON().fixable).toBe(false)
  })

  it('fixable is true when set', () => {
    const err = new GenericConfigError('msg', { actionHint: 'hint', fixable: true })
    expect(err.toJSON().fixable).toBe(true)
  })

  it('InitFrameworkUnknownError toJSON fixable false by default', () => {
    const err = new InitFrameworkUnknownError('unknown', { actionHint: 'Specify framework.' })
    expect(err.toJSON().fixable).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// I6.4 — Consumer can route by code
// ---------------------------------------------------------------------------
describe('I6 consumer routing by code', () => {
  it('JSON-serialized error can be routed by code', () => {
    const errors = [
      new ConfigPathInvalidError('e1', { actionHint: 'hint 1' }),
      new RuleValidationError('e2', { actionHint: 'hint 2' }),
      new PathEscapeError('e3', { actionHint: 'hint 3' }),
      new McpToolError('e4', { actionHint: 'hint 4' }),
      new InitFrameworkUnknownError('e5', { actionHint: 'hint 5' }),
    ]

    const serialized = errors.map((e) => JSON.parse(JSON.stringify(e.toJSON())))

    // Each code is unique and present
    const codes = serialized.map((s: { code: string }) => s.code)
    expect(codes).toContain('config_path_invalid')
    expect(codes).toContain('rule_validation_error')
    expect(codes).toContain('PATH_OUTSIDE_PROJECT_ROOT')
    expect(codes).toContain('mcp_tool_error')
    expect(codes).toContain('init_framework_unknown')

    // Routing by code is deterministic
    const routed = serialized.find((s: { code: string }) => s.code === 'PATH_OUTSIDE_PROJECT_ROOT')
    expect(routed?.message).toBe('e3')
    expect(routed?.actionHint).toBe('hint 3')
  })

  it('All error toJSON outputs survive JSON round-trip (code routing)', () => {
    const allErrors = [
      new ConfigPathInvalidError('m', { actionHint: 'h' }),
      new GenericConfigError('m', { actionHint: 'h', details: { x: 1 } }),
      new RuleValidationError('m', { actionHint: 'h', fixable: true }),
      new PathEscapeError('m', { actionHint: 'h' }),
      new GenericIOError('m', { actionHint: 'h' }),
      new McpToolError('m', { actionHint: 'h' }),
      new InitFrameworkUnknownError('m', { actionHint: 'h' }),
    ]

    for (const err of allErrors) {
      const json = err.toJSON()
      const roundTripped = JSON.parse(JSON.stringify(json))

      expect(roundTripped.code).toBe(json.code)
      expect(roundTripped.name).toBe(json.name)
      expect(roundTripped.message).toBe(json.message)
      expect(roundTripped.actionHint).toBe(json.actionHint)
      expect(roundTripped.fixable).toBe(json.fixable)
    }
  })
})
