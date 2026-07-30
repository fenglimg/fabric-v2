import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ISS-042: the per-dev activity ledgers and caches are described throughout the
// codebase as "gitignored" (events.jsonl, metrics.jsonl, cite-rollup.jsonl,
// .cache/, advisory `.lock` files, `.corrupted.*` forensic sidecars), but
// nothing ever wrote a .gitignore, so they would be committed by default. The
// scaffold now drops a `.fabric/.gitignore`. Idempotent: written only when
// absent, never overwriting user edits (mirrors writeDefaultFabricConfig).
const FABRIC_GITIGNORE_CONTENT = [
  "# Fabric per-dev activity ledgers & caches — auto-generated, not shared.",
  "# Managed by `fabric install`; edit freely (re-install never overwrites this).",
  "events.jsonl",
  "metrics.jsonl",
  "cite-rollup.jsonl",
  "injections.jsonl",
  ".cache/",
  "*.lock",
  "*.corrupted.*",
  "",
].join("\n");

export function writeDefaultGitignore(fabricDir: string): void {
  const target = join(fabricDir, ".gitignore");
  if (existsSync(target)) return;
  mkdirSync(fabricDir, { recursive: true });
  writeFileSync(target, FABRIC_GITIGNORE_CONTENT, "utf8");
}

/**
 * Scaffold a default `.fabric/fabric-config.json` containing every
 * reader-consumed config field with its documented default value.
 *
 * Source-of-truth for the field list:
 *   - packages/shared/src/schemas/fabric-config.ts (Zod schema with defaults)
 *   - packages/cli/templates/hooks/fabric-hint.cjs (the readers themselves)
 *
 * Idempotent: writes ONLY when the file does not exist. NEVER merges missing
 * fields into an existing file. NEVER overwrites user edits.
 */
export function writeDefaultFabricConfig(fabricDir: string, _targetRoot: string): void {
  const target = join(fabricDir, "fabric-config.json");
  if (existsSync(target)) return;

  // config-single-home W5: the repo config carries IDENTITY only, and identity is
  // written by the store-binding stage (project_id / required_stores /
  // write_routes / active_*). Scaffolding policy knobs here would plant keys that
  // have no effect and that doctor then reports as relocated leftovers.
  //
  // The file is still created (empty) because its EXISTENCE is the upward marker
  // ProjectRootResolver searches for — see resolver/project-context-resolver.ts.
  // The shipped policy defaults live in the global config instead; see
  // GLOBAL_POLICY_DEFAULTS below.
  mkdirSync(fabricDir, { recursive: true });
  writeFileSync(target, `${JSON.stringify({}, null, 2)}\n`, "utf8");
}

/**
 * The policy defaults a fresh install seeds into
 * `~/.fabric/fabric-global.json` → `defaults` (config-single-home W5).
 *
 * Only keys whose SHIPPED default deliberately differs from the library default
 * belong here — anything matching the built-in would just be noise in the file
 * (the repo config used to carry nine such no-op keys).
 */
export const GLOBAL_POLICY_DEFAULTS: Readonly<Record<string, unknown>> = {
  // ux-w1-9 / ISS-20260713-058: the human-visible volume dial. New installs get
  // `minimal` — one trust-anchor status line per session — because the earlier
  // AI-only `silent` default gave no post-install disclosure and users concluded
  // "Fabric does nothing". The library default stays `normal` for old installs
  // that never had the key (G2 boundary). AI sink is unaffected either way.
  nudge_mode: "minimal",
  // ISS-20260713-056/070: events.jsonl retention (days). The server's
  // rotateEventLedgerIfNeeded honors 7|30|90; doctor G7/G10 warn when the ledger
  // grows/stales. 30 is the balanced window (the library leaves it unset).
  fabric_event_retention_days: 30,
};
