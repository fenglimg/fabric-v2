import { FabricError } from './fabric-error.js'

export abstract class ConfigError extends FabricError {
  readonly httpStatus = 400
}

export class ConfigPathInvalidError extends ConfigError {
  readonly code = 'config_path_invalid'
}

export class GenericConfigError extends ConfigError {
  readonly code = 'config_error'
}
