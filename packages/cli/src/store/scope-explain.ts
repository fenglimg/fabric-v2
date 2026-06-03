import {
  SCOPE_COORDINATE_PATTERN,
  buildStoreResolveInput,
  createStoreResolver,
  resolveGlobalRoot,
  type StoreReadSet,
  type StoreResolveInput,
  type WriteTarget,
} from "@fenglimg/fabric-shared";
import { GenericConfigError } from "@fenglimg/fabric-shared/errors";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — `fabric scope-explain` (F5 / S21/S53 surfaced in the CLI).
//
// Runs the StoreResolver to show the resolved read-set + write-target for a
// given scope. Pure read; no mutation. This is how a user inspects "which
// stores do I read, and where do my writes go for scope X".
//
// v2.1 global-refactor (W1-T2): the StoreResolveInput assembly moved to shared
// (`buildStoreResolveInput`) so the CLI and the MCP server share ONE source of
// truth. `buildResolveInput` stays as a thin alias for existing CLI importers.
// ---------------------------------------------------------------------------

export interface ScopeExplanation {
  scope: string;
  readSet: StoreReadSet;
  writeTarget: WriteTarget | null;
}

// Build the resolver input from the on-disk configs. Returns null when no global
// config exists (the caller guides to `install --global`).
export function buildResolveInput(
  projectRoot: string,
  globalRoot: string = resolveGlobalRoot(),
): StoreResolveInput | null {
  return buildStoreResolveInput(projectRoot, globalRoot);
}

export function scopeExplain(
  projectRoot: string,
  scope: string,
  globalRoot: string = resolveGlobalRoot(),
): ScopeExplanation | null {
  // v2.2 全砍 F21: validate the scope coordinate GRAMMAR before resolving.
  // Unknown-but-well-formed coordinates stay valid (S20 open-coordinate design —
  // org/team/federation need no engine change); only a malformed coordinate
  // (spaces, uppercase, illegal chars) is rejected with an actionable error
  // instead of silently resolving to a personal/null fallback.
  if (!SCOPE_COORDINATE_PATTERN.test(scope)) {
    throw new GenericConfigError(`invalid scope coordinate '${scope}'`, {
      actionHint:
        "use ':'-joined lowercase [a-z0-9_-] segments, e.g. `team`, `personal`, `project:fabric-v2`, `org:acme:team:platform`",
      details: { scope },
    });
  }
  const input = buildResolveInput(projectRoot, globalRoot);
  if (input === null) {
    return null;
  }
  const resolver = createStoreResolver();
  return {
    scope,
    readSet: resolver.resolveReadSet(input),
    writeTarget: resolver.resolveWriteTarget(input, scope).target,
  };
}
