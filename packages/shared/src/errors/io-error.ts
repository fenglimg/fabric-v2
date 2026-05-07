import { FabricError } from './fabric-error.js'

export abstract class IOFabricError extends FabricError {
  readonly httpStatus: number = 500
}

export class PathEscapeError extends IOFabricError {
  readonly code = 'path_escape'
  readonly httpStatus = 403
}

export class GenericIOError extends IOFabricError {
  readonly code = 'io_error'
}
