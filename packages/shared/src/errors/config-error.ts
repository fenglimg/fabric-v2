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

// v2.2 全砍 Stage 2 — the knowledge write path is store-only. When no
// write-target store resolves for a layer (no global config / no personal store
// mounted / team scope with no active_write_store), the write hard-fails with
// this actionable error instead of silently falling back to the retired
// dual-root co-location. The actionHint points at the exact onboarding commands.
export class StoreWriteTargetUnresolvedError extends ConfigError {
  readonly code = 'store_write_target_unresolved'
}
