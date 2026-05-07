import { describe, expect, it } from 'vitest'
import {
  ConfigPathInvalidError,
  FabricError,
  GenericConfigError,
  GenericIOError,
  InitFrameworkUnknownError,
  IOFabricError,
  McpToolError,
  PathEscapeError,
  RuleValidationError,
} from '../src/errors/index'

describe('FabricError', () => {
  describe('construction validation', () => {
    it('throws when actionHint is empty string', () => {
      expect(
        () => new GenericConfigError('msg', { actionHint: '' }),
      ).toThrow('FabricError: actionHint is required and must be non-empty')
    })

    it('throws when actionHint is undefined (cast)', () => {
      expect(
        () => new GenericConfigError('msg', { actionHint: undefined as unknown as string }),
      ).toThrow('FabricError: actionHint is required and must be non-empty')
    })

    it('succeeds with valid actionHint and reads back fields', () => {
      const err = new GenericConfigError('config missing', {
        actionHint: 'Check your config file',
        fixable: true,
        details: { path: '/etc/fabric.json' },
      })
      expect(err.message).toBe('config missing')
      expect(err.actionHint).toBe('Check your config file')
      expect(err.fixable).toBe(true)
      expect(err.details).toEqual({ path: '/etc/fabric.json' })
      expect(err.code).toBe('config_error')
      expect(err.httpStatus).toBe(400)
    })
  })

  describe('httpStatus defaults per sub-tree', () => {
    it('ConfigError has httpStatus 400', () => {
      const err = new GenericConfigError('x', { actionHint: 'fix it' })
      expect(err.httpStatus).toBe(400)
    })

    it('RuleError has httpStatus 422', () => {
      const err = new RuleValidationError('x', { actionHint: 'fix rule' })
      expect(err.httpStatus).toBe(422)
    })

    it('IOFabricError has httpStatus 500', () => {
      const err = new GenericIOError('x', { actionHint: 'check io' })
      expect(err.httpStatus).toBe(500)
    })

    it('MCPError has httpStatus 500', () => {
      const err = new McpToolError('x', { actionHint: 'check mcp' })
      expect(err.httpStatus).toBe(500)
    })

    it('InitError has httpStatus 500', () => {
      const err = new InitFrameworkUnknownError('x', { actionHint: 'check init' })
      expect(err.httpStatus).toBe(500)
    })
  })

  describe('PathEscapeError', () => {
    it('overrides httpStatus to 403', () => {
      const err = new PathEscapeError('path escaped', { actionHint: 'use relative path' })
      expect(err.httpStatus).toBe(403)
    })

    it('has code path_escape', () => {
      const err = new PathEscapeError('path escaped', { actionHint: 'use relative path' })
      expect(err.code).toBe('path_escape')
    })
  })

  describe('toJSON', () => {
    it('serializes required fields', () => {
      const err = new ConfigPathInvalidError('bad path', { actionHint: 'fix the path', fixable: true })
      const json = err.toJSON()
      expect(json.name).toBe('ConfigPathInvalidError')
      expect(json.code).toBe('config_path_invalid')
      expect(json.message).toBe('bad path')
      expect(json.actionHint).toBe('fix the path')
      expect(json.fixable).toBe(true)
    })

    it('omits details when undefined', () => {
      const err = new GenericConfigError('msg', { actionHint: 'hint' })
      const json = err.toJSON()
      expect('details' in json).toBe(false)
    })

    it('includes details when provided', () => {
      const err = new GenericConfigError('msg', { actionHint: 'hint', details: { foo: 'bar' } })
      const json = err.toJSON()
      expect(json.details).toEqual({ foo: 'bar' })
    })
  })

  describe('instanceof checks', () => {
    it('PathEscapeError instanceof IOFabricError instanceof FabricError instanceof Error', () => {
      const err = new PathEscapeError('escaped', { actionHint: 'fix path' })
      expect(err).toBeInstanceOf(PathEscapeError)
      expect(err).toBeInstanceOf(IOFabricError)
      expect(err).toBeInstanceOf(FabricError)
      expect(err).toBeInstanceOf(Error)
    })

    it('ConfigPathInvalidError instanceof FabricError instanceof Error', () => {
      const err = new ConfigPathInvalidError('bad config', { actionHint: 'fix it' })
      expect(err).toBeInstanceOf(FabricError)
      expect(err).toBeInstanceOf(Error)
    })
  })

  describe('fixable field', () => {
    it('defaults to false when omitted', () => {
      const err = new GenericConfigError('msg', { actionHint: 'hint' })
      expect(err.fixable).toBe(false)
    })

    it('respects true when passed', () => {
      const err = new GenericConfigError('msg', { actionHint: 'hint', fixable: true })
      expect(err.fixable).toBe(true)
    })

    it('respects false when explicitly passed', () => {
      const err = new GenericConfigError('msg', { actionHint: 'hint', fixable: false })
      expect(err.fixable).toBe(false)
    })
  })

  describe('name field', () => {
    it('reflects concrete constructor name', () => {
      const err = new RuleValidationError('invalid rule', { actionHint: 'fix rule' })
      expect(err.name).toBe('RuleValidationError')
    })
  })
})
