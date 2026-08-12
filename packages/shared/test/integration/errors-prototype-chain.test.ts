/**
 * FabricError prototype chain.
 *
 * `FabricError`'s constructor ends with `Object.setPrototypeOf(this, new.target
 * .prototype)`. That single line is what keeps `instanceof` working for every
 * subclass, so the coverage that matters is BREADTH — every concrete error
 * class, not a hand-picked few.
 *
 * The class list is therefore derived from the barrel exports rather than typed
 * out: a new subclass is covered the moment it is exported, and a deleted one
 * trips the pinned census below instead of silently shrinking the suite.
 */
import { describe, expect, it } from 'vitest'

import * as errors from '../../src/errors/index.js'
import { FabricError } from '../../src/errors/index.js'

type ErrorCtor = new (message: string, opts: { actionHint: string }) => Error

// Every exported class that descends from Error.
const exportedErrorClasses = Object.entries(errors as Record<string, unknown>).filter(
  (entry): entry is [string, ErrorCtor] =>
    typeof entry[1] === 'function' && entry[1].prototype instanceof Error,
)

// `abstract` is erased at runtime, so it cannot be read off the class. What IS
// observable: an abstract base always appears as some other exported class's
// prototype. Leaves — classes nobody extends — are the concrete ones.
const baseClassNames = new Set(
  exportedErrorClasses.map(([, cls]) => (Object.getPrototypeOf(cls) as { name?: string }).name),
)
const concreteErrorClasses = exportedErrorClasses.filter(([name]) => !baseClassNames.has(name))

/** Named links from `cls` up to Object.prototype, e.g. ConfigPathInvalidError → ConfigError → … */
function prototypeChainOf(cls: ErrorCtor): string[] {
  const chain: string[] = []
  for (let proto = cls.prototype; proto !== null; proto = Object.getPrototypeOf(proto)) {
    const name = (proto as { constructor?: { name?: string } }).constructor?.name
    if (name && name !== 'Object') chain.push(name)
  }
  return chain
}

describe('FabricError prototype chain', () => {
  it('the concrete-subclass set is pinned (add/remove fails this gate)', () => {
    expect(concreteErrorClasses.map(([name]) => name).sort()).toMatchInlineSnapshot(`
      [
        "ConfigPathInvalidError",
        "GenericConfigError",
        "GenericIOError",
        "InitFrameworkUnknownError",
        "McpToolError",
        "PathEscapeError",
        "PersonalScopeLeakError",
        "RuleValidationError",
        "StoreWriteTargetUnresolvedError",
      ]
    `)
  })

  it.each(concreteErrorClasses)(
    '%s is instanceof its own class, its base, FabricError and Error',
    (_name, ErrorClass) => {
      const err = new ErrorClass('boom', { actionHint: 'Do the thing.' })

      expect(err).toBeInstanceOf(ErrorClass)
      expect(err).toBeInstanceOf(FabricError)
      expect(err).toBeInstanceOf(Error)

      // Also assert the intermediate abstract base, which `instanceof
      // FabricError` alone would not catch if a subclass were re-parented.
      const base = Object.getPrototypeOf(ErrorClass) as ErrorCtor
      expect(err).toBeInstanceOf(base)
      expect(prototypeChainOf(ErrorClass)).toEqual([
        ErrorClass.name,
        base.name,
        'FabricError',
        'Error',
      ])
    },
  )

  it.each(concreteErrorClasses)(
    '%s survives a cross-module prototype reset (the setPrototypeOf contract)',
    (_name, ErrorClass) => {
      // Bundlers can re-wrap an Error across a module boundary, resetting its
      // prototype. Re-creating the instance from the class prototype must yield
      // an object that still satisfies every instanceof in the chain.
      const original = new ErrorClass('boom', { actionHint: 'Do the thing.' })
      const restored = Object.create(ErrorClass.prototype) as Error
      Object.assign(restored, original)

      expect(restored).toBeInstanceOf(ErrorClass)
      expect(restored).toBeInstanceOf(FabricError)
      expect(restored).toBeInstanceOf(Error)
    },
  )

  it.each([
    ['Error', new Error('plain')],
    ['TypeError', new TypeError('type')],
  ])('a built-in %s is NOT instanceof FabricError', (_name, err) => {
    expect(err).not.toBeInstanceOf(FabricError)
  })
})
