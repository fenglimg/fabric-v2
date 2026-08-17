// ---------------------------------------------------------------------------
// Which panel keys an environment variable can actually override.
//
// The cascade comment in every config reader says "env > …", but env is NOT
// uniform: only four of the nineteen panel keys have a reader that consults
// `process.env` at all, and the hook-side policy reader
// (.claude/hooks/lib/config-cache.cjs#readPolicy) has no env layer whatsoever.
// A surface that renders a generic "env" row for every key would be showing a
// layer that, for fifteen of them, cannot win — the exact "the value you see is
// not the value in effect" failure KT-MOD-0004 is about.
//
// This table registers ONLY keys with a real reader. It is deliberately explicit
// rather than derived from a naming convention (`FABRIC_` + upper-cased key):
// three of the four happen to match that convention, so a future key that does
// not would silently mis-map with no error anywhere.
//
// An explicit table is a second list, and a second list can drift from the code
// it describes — that is precisely how `STORE_OVERRIDABLE_KNOBS` came to declare
// 15 overridable knobs while only 12 worked. The census test
// (packages/cli/__tests__/config-env-registry-census.test.ts) is the gate that
// makes this table cheaper than the convention rather than another liability: it
// greps the actual readers and fails in BOTH directions — a new env reader that
// is not registered, and a registration nothing reads.
// ---------------------------------------------------------------------------

/**
 * Panel config key → the environment variable that overrides it.
 *
 * Keys absent from this map have no env reader; their effective value is decided
 * entirely by the config files.
 */
export const PANEL_ENV_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
  // read at packages/server/src/config-loader.ts (readDefaultLayerFilter)
  default_layer_filter: "FABRIC_DEFAULT_LAYER_FILTER",
  // read at packages/server/src/config-loader.ts (readFusionStrategy)
  fusion: "FABRIC_FUSION",
  // read at .claude/hooks/lib/nudge-policy.cjs — hook-side, not server-side
  nudge_mode: "FABRIC_NUDGE_MODE",
  // read at .claude/hooks/lib/hint-config.cjs + knowledge-hint-broad.cjs
  underseed_node_threshold: "FABRIC_UNDERSEED_NODE_THRESHOLD",
});

/** The env var overriding `key`, or null when no reader consults one. */
export function envOverrideFor(key: string): string | null {
  return PANEL_ENV_OVERRIDES[key] ?? null;
}
