import { FabricError } from './fabric-error.js'

export abstract class RuleError extends FabricError {
  readonly httpStatus: number = 422
}

export class RuleValidationError extends RuleError {
  readonly code = 'rule_validation_error'
}
