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

  // grill-6fixes (D1): language is no longer a per-project field — it lives in
  // `~/.fabric/fabric-global.json` and is picked once by the install language
  // selector. The README/docs detection + fixation that used to run here was
  // removed.
  const FABRIC_CONFIG_DEFAULTS = {
    archive_hint_hours: 24,
    archive_hint_cooldown_hours: 12,
    review_hint_pending_count: 10,
    review_hint_pending_age_days: 7,
    maintenance_hint_days: 14,
    maintenance_hint_cooldown_days: 7,
    archive_edit_threshold: 20,
    underseed_node_threshold: 10,
    import_window_first_run_months: 60,
    import_window_rerun_months: 2,
    import_max_pending_per_run: 10,
    import_max_commits_scan: 500,
    import_skip_canonical_threshold: 50,
    archive_max_candidates_per_batch: 8,
    archive_max_recent_paths: 20,
    archive_digest_max_sessions: 10,
    review_topic_result_cap: 8,
    review_stale_pending_days: 14,
  };

  mkdirSync(fabricDir, { recursive: true });
  writeFileSync(target, JSON.stringify(FABRIC_CONFIG_DEFAULTS, null, 2) + "\n", "utf8");
}
