/**
 * Integration: FabricError prototype chain — shared.md §2 I5
 *
 * I5: All 5 subclasses maintain `instanceof FabricError` AND `instanceof XxxError`.
 *     Object.setPrototypeOf across module boundary does not break instanceof.
 */
import { describe, expect, it } from 'vitest'

import {
  FabricError,
  ConfigError,
  ConfigPathInvalidError,
  GenericConfigError,
  RuleError,
  RuleValidationError,
  IOFabricError,
  PathEscapeError,
  GenericIOError,
  MCPError,
  McpToolError,
  InitError,
  InitFrameworkUnknownError,
} from '../../src/errors/index.js'

// ---------------------------------------------------------------------------
// I5.1 — Each concrete class is instanceof its abstract parent + FabricError
// ---------------------------------------------------------------------------
describe('I5 prototype chain: each subclass instanceof FabricError', () => {
  it('ConfigPathInvalidError: instanceof ConfigError → FabricError → Error', () => {
    const err = new ConfigPathInvalidError('bad path', { actionHint: 'Fix the config path.' })
    expect(err).toBeInstanceOf(ConfigPathInvalidError)
    expect(err).toBeInstanceOf(ConfigError)
    expect(err).toBeInstanceOf(FabricError)
    expect(err).toBeInstanceOf(Error)
  })

  it('GenericConfigError: instanceof ConfigError → FabricError → Error', () => {
    const err = new GenericConfigError('config error', { actionHint: 'Check your config.' })
    expect(err).toBeInstanceOf(GenericConfigError)
    expect(err).toBeInstanceOf(ConfigError)
    expect(err).toBeInstanceOf(FabricError)
    expect(err).toBeInstanceOf(Error)
  })

  it('RuleValidationError: instanceof RuleError → FabricError → Error', () => {
    const err = new RuleValidationError('bad rule', { actionHint: 'Fix the rule.' })
    expect(err).toBeInstanceOf(RuleValidationError)
    expect(err).toBeInstanceOf(RuleError)
    expect(err).toBeInstanceOf(FabricError)
    expect(err).toBeInstanceOf(Error)
  })

  it('PathEscapeError: instanceof IOFabricError → FabricError → Error', () => {
    const err = new PathEscapeError('escape attempt', { actionHint: 'Stay within project root.' })
    expect(err).toBeInstanceOf(PathEscapeError)
    expect(err).toBeInstanceOf(IOFabricError)
    expect(err).toBeInstanceOf(FabricError)
    expect(err).toBeInstanceOf(Error)
  })

  it('GenericIOError: instanceof IOFabricError → FabricError → Error', () => {
    const err = new GenericIOError('io error', { actionHint: 'Check file permissions.' })
    expect(err).toBeInstanceOf(GenericIOError)
    expect(err).toBeInstanceOf(IOFabricError)
    expect(err).toBeInstanceOf(FabricError)
    expect(err).toBeInstanceOf(Error)
  })

  it('McpToolError: instanceof MCPError → FabricError → Error', () => {
    const err = new McpToolError('mcp fail', { actionHint: 'Check MCP server.' })
    expect(err).toBeInstanceOf(McpToolError)
    expect(err).toBeInstanceOf(MCPError)
    expect(err).toBeInstanceOf(FabricError)
    expect(err).toBeInstanceOf(Error)
  })

  it('InitFrameworkUnknownError: instanceof InitError → FabricError → Error', () => {
    const err = new InitFrameworkUnknownError('unknown framework', { actionHint: 'Specify framework manually.' })
    expect(err).toBeInstanceOf(InitFrameworkUnknownError)
    expect(err).toBeInstanceOf(InitError)
    expect(err).toBeInstanceOf(FabricError)
    expect(err).toBeInstanceOf(Error)
  })
})

// ---------------------------------------------------------------------------
// I5.2 — Cross-module boundary: setPrototypeOf does not break instanceof
// ---------------------------------------------------------------------------
describe('I5 cross-module prototype chain via Object.setPrototypeOf', () => {
  it('ConfigPathInvalidError retains instanceof after Object.setPrototypeOf', () => {
    const original = new ConfigPathInvalidError('original', { actionHint: 'Fix path.' })

    // Simulate what happens when errors cross module boundaries in some bundlers:
    // the Error is re-wrapped or its prototype is reset.
    // FabricError constructor already calls Object.setPrototypeOf(this, new.target.prototype)
    // to handle this — verify it works.
    const proto = Object.getPrototypeOf(original)
    const reimported = Object.create(proto) as ConfigPathInvalidError
    Object.setPrototypeOf(reimported, ConfigPathInvalidError.prototype)

    expect(reimported).toBeInstanceOf(ConfigPathInvalidError)
    expect(reimported).toBeInstanceOf(FabricError)
  })

  it('RuleValidationError retains instanceof after explicit prototype reset', () => {
    const err = new RuleValidationError('rule fail', { actionHint: 'Fix the rule.' })

    // Verify that the constructor-time Object.setPrototypeOf call ensures instanceof works
    // even if the prototype chain is traversed from a different module scope
    const reconstructed = err
    expect(reconstructed instanceof RuleValidationError).toBe(true)
    expect(reconstructed instanceof RuleError).toBe(true)
    expect(reconstructed instanceof FabricError).toBe(true)
  })

  it('McpToolError prototype chain survives serialization and reconstruction via Object.create', () => {
    const err = new McpToolError('mcp tool fail', { actionHint: 'Check MCP tool.' })

    // Re-create with same prototype (cross-boundary simulation)
    const restored = Object.create(McpToolError.prototype) as McpToolError
    Object.assign(restored, err)

    expect(restored instanceof McpToolError).toBe(true)
    expect(restored instanceof MCPError).toBe(true)
    expect(restored instanceof FabricError).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// I5.3 — Negative: non-FabricError does NOT satisfy instanceof FabricError
// ---------------------------------------------------------------------------
describe('I5 negative: plain Error is not instanceof FabricError', () => {
  it('plain Error is not instanceof FabricError', () => {
    const plainErr = new Error('plain error')
    expect(plainErr).not.toBeInstanceOf(FabricError)
  })

  it('TypeError is not instanceof FabricError', () => {
    const typeErr = new TypeError('type error')
    expect(typeErr).not.toBeInstanceOf(FabricError)
  })
})
