import { FabricError } from './fabric-error'

export abstract class InitError extends FabricError {
  readonly httpStatus = 500
}

export class InitFrameworkUnknownError extends InitError {
  readonly code = 'init_framework_unknown'
}
