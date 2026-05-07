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
