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

// v2.1 global-refactor (W1/A1) — R5#3 privacy red line at the write path. A
// personal-scope entry must NEVER physically land in a shared store. When the
// resolved write-target for a personal-scoped write is a shared store the write
// hard-fails with this error rather than leaking personal knowledge into a repo
// other people clone. The companion lint `isPersonalLeakIntoSharedStore`
// computes the boolean; this is the thrown refusal.
export class PersonalScopeLeakError extends ConfigError {
  readonly code = 'personal_scope_leak'
}
