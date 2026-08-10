import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// The record `fabric install` leaves of exactly which bytes it wrote, so
// `fabric doctor` can tell an installed copy that has since drifted from one
// that is current. ONE shape, consumed by both ends:
//
//   * `fabric install` (CLI) writes it at the end of a successful run;
//   * `fabric doctor` (server) re-hashes the on-disk copies against it.
//
// Why this is not covered by the sibling `hooks_content_drift` check: that one
// compares `.claude/` against `.codex/`, so it only notices when the two copies
// disagree with EACH OTHER. Both going equally stale — the common case, since a
// re-install updates both or neither — reads as perfectly healthy there. Only a
// record of what was written can catch it.
//
// Scope: files install writes WHOLESALE (skills, their ref companions, skill
// libs, hook scripts, hook libs). Deliberately NOT the client hook configs:
// those are deep-MERGED into a user's own file, so their bytes are supposed to
// differ from anything we shipped. `hooks_wired` is the check for those.
//
// Limit worth stating plainly: a manifest can only vouch for files it lists,
// and install lists what it wrote. A file install SHOULD have shipped but
// never did is invisible here (that class is caught at the source, by the
// distribution-list round-trip tests in the CLI package). Drift detection and
// completeness are different questions.
// ---------------------------------------------------------------------------

/** Project-root-relative location of the manifest. */
export const INSTALL_MANIFEST_REL = ".fabric/install-manifest.json";

/** Bumped when the manifest shape changes incompatibly. */
export const INSTALL_MANIFEST_SCHEMA_VERSION = 1;

export type InstallManifest = {
  schema_version: number;
  /** CLI version that produced these bytes; lets doctor spot a stale install. */
  fabric_version: string;
  generated_at: string;
  /** Project-root-relative path → sha256 hex of the bytes install wrote. */
  files: Record<string, string>;
};

/** sha256 hex of a file's bytes. The one hashing definition both ends use. */
export function hashInstalledFile(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export type InstallCopyDriftKind =
  /** Listed in the manifest, still present, but the bytes no longer match. */
  | "modified"
  /** Listed in the manifest and no longer on disk at all. */
  | "missing"
  /** Listed in the manifest but unreadable (permissions, or it became a dir). */
  | "unreadable";

export type InstallCopyDrift = {
  path: string;
  kind: InstallCopyDriftKind;
};

/**
 * Compare a manifest against the bytes actually on disk.
 *
 * `actual` maps each manifest path to its current sha256, or `null` when the
 * file is gone, or `undefined` when it exists but could not be read. Keeping
 * the filesystem walk in the caller makes this pure and directly testable.
 *
 * Results are sorted by path so a doctor report is stable across runs.
 */
export function diffInstallManifest(
  manifest: InstallManifest,
  actual: Record<string, string | null | undefined>,
): InstallCopyDrift[] {
  const drifts: InstallCopyDrift[] = [];
  for (const [path, expected] of Object.entries(manifest.files)) {
    const current = actual[path];
    if (current === null) {
      drifts.push({ path, kind: "missing" });
    } else if (current === undefined) {
      drifts.push({ path, kind: "unreadable" });
    } else if (current !== expected) {
      drifts.push({ path, kind: "modified" });
    }
  }
  return drifts.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Parse manifest JSON, returning `null` for anything that is not a manifest of
 * a schema version this build understands. A `null` is not an error condition —
 * it means "no usable record", which is the same state as a pre-manifest
 * install, and doctor reports both as "run `fabric install`".
 */
export function parseInstallManifest(raw: string): InstallManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (record.schema_version !== INSTALL_MANIFEST_SCHEMA_VERSION) return null;
  if (typeof record.fabric_version !== "string") return null;
  if (typeof record.generated_at !== "string") return null;
  const files = record.files;
  if (typeof files !== "object" || files === null || Array.isArray(files)) return null;
  const entries: Record<string, string> = {};
  for (const [path, sha] of Object.entries(files as Record<string, unknown>)) {
    if (typeof sha !== "string") return null;
    entries[path] = sha;
  }
  return {
    schema_version: record.schema_version,
    fabric_version: record.fabric_version,
    generated_at: record.generated_at,
    files: entries,
  };
}
