/**
 * v2.0.0-rc.34 TASK-05: reverse-unarchive primitive.
 *
 * Moves a knowledge entry back from `.fabric/.archive/<type>/<filename>` to its
 * canonical layer location (`.fabric/knowledge/<layer>/<type>/<filename>`),
 * emitting one `knowledge_unarchived` ledger event per successful restore.
 *
 * Layer derivation: stable_id prefix encodes layer (KT-* = team, KP-* = personal).
 * Filename pattern: `<stable_id>--<slug>.md` (canonical). If the archived file does
 * not match this pattern, the caller MUST supply `targetLayer` explicitly via
 * options — we refuse to guess.
 *
 * Dry-run: when `options.dryRun=true`, the function inspects feasibility and
 * returns the would-be restored path WITHOUT moving the file or emitting the
 * event. Used for preview surfaces and the `reverse_unarchive_dry_run` config.
 *
 * Scope cut (deferred to rc.35): auto-detection of "ghost-cited" archived
 * entries (archived entry receiving `knowledge_consumed` events after its
 * archive timestamp) lives in a separate doctor lint pass, not this primitive.
 * This file ships the mutation + observability primitive; the trigger logic
 * is a downstream concern.
 *
 * Audit-trail invariant (mirrors applyStaleArchive in doctor.ts): if the
 * ledger append fails AFTER the rename, roll the file back to its archive
 * location so disk state matches the (absent) event.
 */

import { existsSync } from "node:fs";
import { mkdir, rename, readFile, writeFile, unlink } from "node:fs/promises";
import { basename, dirname, join, posix } from "node:path";

import { appendEventLedgerEvent } from "./event-ledger.js";

export type UnarchiveOptions = {
  /**
   * When true, no file move or ledger event occurs; the result reports the
   * `restoredTo` path that WOULD have been produced. Used by `--dry-run` and
   * `reverse_unarchive_dry_run` config.
   */
  dryRun?: boolean;
  /**
   * Override the layer derivation. Required when the archived filename does
   * not match the canonical `<stable_id>--<slug>.md` pattern (no KT-* / KP-*
   * prefix to read).
   */
  targetLayer?: "team" | "personal";
  /**
   * Free-form trigger label written to the event's `reason` field. Examples:
   *   - "manual:fab_review_unarchive"
   *   - "ghost_cited_7d" (future auto-detect from doctor)
   *   - "test:fixture-restore"
   * Default: "unspecified".
   */
  reason?: string;
};

export type UnarchiveResult = {
  ok: boolean;
  stableId: string | null;
  archivePath: string;
  restoredTo: string | null;
  applied: boolean;
  dryRun: boolean;
  error?: string;
};

const KT_PREFIX = /^KT-/;
const KP_PREFIX = /^KP-/;
const STABLE_ID_PATTERN = /^(K[TP]-[A-Z]+-\d+)--/;

function deriveLayer(filename: string, override?: "team" | "personal"): "team" | "personal" | null {
  if (override) return override;
  if (KT_PREFIX.test(filename)) return "team";
  if (KP_PREFIX.test(filename)) return "personal";
  return null;
}

function extractStableId(filename: string): string | null {
  const match = STABLE_ID_PATTERN.exec(filename);
  return match ? match[1] : null;
}

function deriveType(archivePathPosix: string): string | null {
  // Caller MUST have normalized backslashes upstream (see normalizeToPosix).
  // Expected shape: ".fabric/.archive/<type>/<filename>" — extract <type>.
  const parts = archivePathPosix.split("/");
  const archiveIdx = parts.indexOf(".archive");
  if (archiveIdx === -1 || archiveIdx + 1 >= parts.length - 1) return null;
  return parts[archiveIdx + 1] ?? null;
}

// rc.34 review-fix (Gemini P0): single normalization point. Windows callers
// pass backslashes; Node's POSIX `basename` treats `\` as a filename char,
// so we MUST convert at entry before any of basename / split-on-`/` / etc.
// run. Keeping this isolated to one helper means every downstream helper
// can assume forward-slash input without per-site guards.
function normalizeToPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Unarchive a single entry. Project-root-relative `archivePathRel` (POSIX
 * separators). Returns `UnarchiveResult` regardless of success/failure;
 * callers inspect `ok` + `error` to handle.
 */
export async function unarchiveKnowledge(
  projectRoot: string,
  archivePathRel: string,
  options: UnarchiveOptions = {},
): Promise<UnarchiveResult> {
  const dryRun = options.dryRun === true;
  // rc.34 review-fix (Gemini P0): normalize once at entry — every downstream
  // helper assumes POSIX separators. Windows callers can pass backslashes;
  // result.archivePath is reported in POSIX form (callers can re-localize
  // for display if needed, but the contract is "relative POSIX path").
  const archivePathPosix = normalizeToPosix(archivePathRel);
  // F37 (ISS-20260531-045): path-traversal guard. `archivePathRel` is caller
  // input; without this, ".fabric/.archive/../../secret/KT-DEC-0001.md" would
  // make archivePathAbs escape the project (read) and let deriveType return ".."
  // (write climb). Require a clean, relative, archive-rooted path with no ".."
  // segment before touching the filesystem.
  const archiveSegments = archivePathPosix.split("/");
  const traversalUnsafe =
    archivePathPosix.startsWith("/") ||
    archiveSegments.includes("..") ||
    !archivePathPosix.startsWith(".fabric/.archive/");
  if (traversalUnsafe) {
    return {
      ok: false,
      stableId: null,
      archivePath: archivePathPosix,
      restoredTo: null,
      applied: false,
      dryRun,
      error: `refusing unsafe archive path '${archivePathPosix}' (must be a relative path under '.fabric/.archive/' with no '..' segment)`,
    };
  }
  const archivePathAbs = join(projectRoot, archivePathPosix);
  const filename = basename(archivePathPosix);
  const stableId = extractStableId(filename);
  const layer = deriveLayer(filename, options.targetLayer);
  const type = deriveType(archivePathPosix);

  if (layer === null) {
    return {
      ok: false,
      stableId,
      archivePath: archivePathPosix,
      restoredTo: null,
      applied: false,
      dryRun,
      error: `cannot derive layer from filename '${filename}' (no KT-/KP- prefix); pass options.targetLayer explicitly`,
    };
  }
  if (type === null) {
    return {
      ok: false,
      stableId,
      archivePath: archivePathPosix,
      restoredTo: null,
      applied: false,
      dryRun,
      error: `cannot derive type from archive path '${archivePathPosix}'; expected '.fabric/.archive/<type>/<filename>'`,
    };
  }

  const restoredToRel = posix.join(".fabric/knowledge", layer, type, filename);
  const restoredToAbs = join(projectRoot, restoredToRel);

  if (dryRun) {
    return {
      ok: true,
      stableId,
      archivePath: archivePathPosix,
      restoredTo: restoredToRel,
      applied: false,
      dryRun: true,
    };
  }

  if (!existsSync(archivePathAbs)) {
    return {
      ok: false,
      stableId,
      archivePath: archivePathPosix,
      restoredTo: restoredToRel,
      applied: false,
      dryRun,
      error: `archive source does not exist: ${archivePathPosix}`,
    };
  }
  if (existsSync(restoredToAbs)) {
    return {
      ok: false,
      stableId,
      archivePath: archivePathPosix,
      restoredTo: restoredToRel,
      applied: false,
      dryRun,
      error: `restore target already exists: ${restoredToRel} (would clobber active entry)`,
    };
  }

  try {
    await mkdir(dirname(restoredToAbs), { recursive: true });
    try {
      await rename(archivePathAbs, restoredToAbs);
    } catch (renameError) {
      // EXDEV fallback: cross-filesystem rename. Mirror applyStaleArchive
      // pattern in doctor.ts.
      if (
        renameError instanceof Error &&
        "code" in renameError &&
        (renameError as NodeJS.ErrnoException).code === "EXDEV"
      ) {
        const data = await readFile(archivePathAbs);
        await writeFile(restoredToAbs, data);
        await unlink(archivePathAbs);
      } else {
        throw renameError;
      }
    }
  } catch (error) {
    return {
      ok: false,
      stableId,
      archivePath: archivePathPosix,
      restoredTo: restoredToRel,
      applied: false,
      dryRun,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // Audit-trail invariant: if the ledger append fails AFTER the rename, roll
  // back so disk matches the (absent) event. Best-effort rollback.
  try {
    await appendEventLedgerEvent(projectRoot, {
      event_type: "knowledge_unarchived",
      stable_id: stableId ?? undefined,
      timestamp: new Date().toISOString(),
      reason: options.reason ?? "unspecified",
      archive_path: archivePathPosix,
      restored_to: restoredToRel,
    });
  } catch (ledgerError) {
    try {
      await rename(restoredToAbs, archivePathAbs);
    } catch (rollbackError) {
      return {
        ok: false,
        stableId,
        archivePath: archivePathPosix,
        restoredTo: restoredToRel,
        applied: false,
        dryRun,
        error: `ledger append failed (${ledgerError instanceof Error ? ledgerError.message : String(ledgerError)}); rollback also failed (${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}); file may be stranded at ${restoredToRel}`,
      };
    }
    return {
      ok: false,
      stableId,
      archivePath: archivePathPosix,
      restoredTo: restoredToRel,
      applied: false,
      dryRun,
      error: `ledger append failed (${ledgerError instanceof Error ? ledgerError.message : String(ledgerError)}); restore rolled back`,
    };
  }

  return {
    ok: true,
    stableId,
    archivePath: archivePathPosix,
    restoredTo: restoredToRel,
    applied: true,
    dryRun,
  };
}
