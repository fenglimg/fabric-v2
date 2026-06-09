export abstract class FabricError extends Error {
  abstract readonly code: string
  readonly actionHint: string
  readonly fixable: boolean
  readonly details?: unknown
  abstract readonly httpStatus: number

  constructor(message: string, opts: { actionHint: string; fixable?: boolean; details?: unknown }) {
    super(message)
    if (!opts.actionHint || opts.actionHint.length === 0) {
      throw new Error('FabricError: actionHint is required and must be non-empty')
    }
    this.name = this.constructor.name
    this.actionHint = opts.actionHint
    this.fixable = opts.fixable ?? false
    this.details = opts.details
    Object.setPrototypeOf(this, new.target.prototype)
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      actionHint: this.actionHint,
      fixable: this.fixable,
      ...(this.details !== undefined ? { details: this.details } : {}),
    }
  }
}

export type FabricErrorShape = {
  message: string
  actionHint: string
}

export function hasActionHint(err: unknown): err is FabricErrorShape {
  if (err === null || typeof err !== 'object') return false
  const candidate = err as { message?: unknown; actionHint?: unknown }
  return (
    typeof candidate.message === 'string' &&
    candidate.message.length > 0 &&
    typeof candidate.actionHint === 'string' &&
    candidate.actionHint.length > 0
  )
}
