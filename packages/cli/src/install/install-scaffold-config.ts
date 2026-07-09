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
    // ux-w1-9: nudge_mode is the master switch for the human-visible nudge
    // experience (silent | minimal | normal | verbose). Scaffolded up-front so
    // the one volume dial is discoverable in the shipped config.
    // G1 (GRL-STOPHOOK-AIONLY-20260709): 新装用户默认 silent —— AI-only 可见,
    // human sink 静音。老用户 config 不动(scaffold idempotent,不覆写现有)。
    // 想恢复可见改此字段为 'normal' / 'verbose',或设 env FABRIC_NUDGE_MODE。
    // 观测入口:fabric doctor 看 backlog 行 + .fabric/metrics.jsonl 4 周对比。
    nudge_mode: "silent",
    archive_hint_hours: 24,
    archive_hint_cooldown_hours: 12,
    review_hint_pending_count: 10,
    review_hint_pending_age_days: 7,
    maintenance_hint_days: 14,
    maintenance_hint_cooldown_days: 7,
    archive_edit_threshold: 20,
    underseed_node_threshold: 10,
    // ux-w2-3: import_*/archive_max_*/review_topic_result_cap skill thresholds
    // are no longer scaffolded — they were hardcoded (✂ census Table 1). The
    // fabric-import/archive/review skills read a built-in default when the key
    // is absent, so the shipped config stays lean (panel knobs only).
    review_stale_pending_days: 14,
  };

  mkdirSync(fabricDir, { recursive: true });
  writeFileSync(target, JSON.stringify(FABRIC_CONFIG_DEFAULTS, null, 2) + "\n", "utf8");
}
