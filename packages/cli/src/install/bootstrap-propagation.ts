import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { atomicWriteText } from "@fenglimg/fabric-shared/node/atomic-write";
import {
  BOOTSTRAP_MARKER_BEGIN,
  BOOTSTRAP_MARKER_END,
  BOOTSTRAP_REGEX,
} from "@fenglimg/fabric-shared/templates/bootstrap-canonical";

import type { InstallStepResult } from "./step-result.js";
import {
  fabricAgentsSnapshotPath,
  projectRulesPath,
  readProjectRulesIfPresent,
} from "./write-bootstrap-snapshot.js";

// ===========================================================================
// rc.19 TASK-003 — three-end bootstrap propagation
// ===========================================================================
//
// The legacy single-writer `addFabricKnowledgeBaseSection` has been split into
// per-client thin-shell writers, each tailored to how that client
// actually consumes the bootstrap:
//
//   - Claude Code: real `@`-import directives in CLAUDE.md (no managed block).
//   - Codex CLI:   byte-copy managed block in root AGENTS.md.
//
// Both writers consume the L1 bootstrap snapshot at `.fabric/AGENTS.md`
// (written by `writeFabricAgentsSnapshot` from write-bootstrap-snapshot.ts in
// TASK-002) plus the optional `.fabric/project-rules.md` (user-authored, only-
// if-exists). The shared helper {@link buildManagedBlockBody} concatenates
// these two sources so the Codex managed block contains the expected content.
//
// Clean-slate (no migration shim): `fabric:bootstrap` is the only managed
// marker across CLAUDE.md / AGENTS.md (no legacy `fabric:knowledge-base`
// migration — 0 users).
//
// Idempotency contract: each writer must produce a byte-identical destination
// state on second invocation against an unchanged input (snapshot + optional
// project-rules). The integration test matrix in TASK-008 asserts this across
// both targets.

/**
 * Build the byte content embedded inside the Codex managed block.
 *
 * Concatenates:
 *   1. `.fabric/AGENTS.md` (BOOTSTRAP_CANONICAL snapshot written by TASK-002)
 *   2. `\n---\n` separator + `.fabric/project-rules.md` content WHEN that
 *      user-authored companion file exists (only-if-exists per locked
 *      decision NEW-4; never scaffolded by install).
 *
 * Pure read — no filesystem mutation. Caller is responsible for ensuring the
 * snapshot exists (the bootstrap-stage install order guarantees this since
 * `writeFabricAgentsSnapshot` runs immediately before the three propagation
 * writers).
 *
 * Throws if `.fabric/AGENTS.md` is missing: the propagation writers depend on
 * the snapshot being present, and missing snapshot indicates an install-order
 * regression that should fail loudly rather than emit an empty managed block.
 */
export function buildManagedBlockBody(targetRoot: string): string {
  const snapshotPath = fabricAgentsSnapshotPath(targetRoot);
  const snapshot = readFileSync(snapshotPath, "utf8");
  const projectRules = readProjectRulesIfPresent(targetRoot);
  if (projectRules === null) {
    return snapshot;
  }
  return `${snapshot}\n---\n${projectRules}`;
}

/**
 * Wrap a managed-block body in the BOOTSTRAP marker pair. Used by the Codex
 * writer to ensure consistent marker formatting around the managed block.
 */
function wrapInBootstrapMarkers(body: string): string {
  return `${BOOTSTRAP_MARKER_BEGIN}\n${body}\n${BOOTSTRAP_MARKER_END}`;
}

const CLAUDE_BOOTSTRAP_HEADER = "# Project Knowledge";
const CLAUDE_AGENTS_IMPORT_LINE = "@.fabric/AGENTS.md";
const CLAUDE_PROJECT_RULES_IMPORT_LINE = "@.fabric/project-rules.md";

/**
 * Write `CLAUDE.md` as a thin-shell with real Claude `@`-import directives
 * pointing at the canonical L1 snapshot (and the optional project-rules
 * companion). No managed block — Claude Code resolves `@<path>` lines at
 * runtime so we want the actual references in plain markdown.
 *
 * Idempotency: each `@`-import line is line-level idempotent. We grep the
 * file for an exact-line match before appending; if present, we leave it
 * alone. The project-rules `@`-line is only written when the companion file
 * exists; if it does not, we also strip any stale `@.fabric/project-rules.md`
 * line from CLAUDE.md so the import set stays consistent with on-disk
 * reality.
 *
 * Bootstrap header: when CLAUDE.md does not pre-exist, we seed it with a
 * single `# Project Knowledge` header before the imports so the file is
 * self-explanatory; when CLAUDE.md does exist we leave user content alone
 * and just append the missing import lines at the end (separated by a
 * blank line for readability).
 */
export async function writeClaudeBootstrapThinShell(
  targetRoot: string,
): Promise<InstallStepResult> {
  const step = "bootstrap-claude";
  const target = join(targetRoot, "CLAUDE.md");
  const projectRulesPresent = existsSync(projectRulesPath(targetRoot));

  let existing = "";
  let preExisted = false;
  if (existsSync(target)) {
    preExisted = true;
    try {
      existing = await readFile(target, "utf8");
    } catch (error: unknown) {
      return {
        step,
        path: target,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Phase 1: drop stale project-rules @-import when the companion file is
  // absent on disk. Keeps the import set consistent with reality.
  let next = existing;
  if (!projectRulesPresent) {
    next = removeImportLine(next, CLAUDE_PROJECT_RULES_IMPORT_LINE);
  }

  // Phase 2: seed header if file did not pre-exist (or was wiped to empty
  // by the import-strip above).
  if (!preExisted && next.length === 0) {
    next = `${CLAUDE_BOOTSTRAP_HEADER}\n`;
  }

  // Phase 3: append `@`-import lines as needed (line-level idempotent).
  next = ensureImportLine(next, CLAUDE_AGENTS_IMPORT_LINE);
  if (projectRulesPresent) {
    next = ensureImportLine(next, CLAUDE_PROJECT_RULES_IMPORT_LINE);
  }

  if (next === existing) {
    return { step, path: target, status: "skipped", message: "up-to-date" };
  }

  try {
    await mkdir(dirname(target), { recursive: true });
    await atomicWriteText(target, next);
    return { step, path: target, status: "written" };
  } catch (error: unknown) {
    return {
      step,
      path: target,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Append `line` to `content` as its own newline-terminated line IFF no exact
 * line-match already exists. Separates the new line from the previous file
 * content with a single blank line (when previous content does not already
 * end with one). Returns the new content.
 */
function ensureImportLine(content: string, line: string): string {
  if (hasExactLine(content, line)) return content;
  if (content.length === 0) return `${line}\n`;
  const endsWithBlank = content.endsWith("\n\n");
  const endsWithNewline = content.endsWith("\n");
  if (endsWithBlank) {
    return `${content}${line}\n`;
  }
  if (endsWithNewline) {
    return `${content}\n${line}\n`;
  }
  return `${content}\n\n${line}\n`;
}

/**
 * Strip every line whose trimmed-right content exactly equals `line` from
 * `content`. Returns the cleaned content. Idempotent on absence.
 */
function removeImportLine(content: string, line: string): string {
  const lines = content.split(/\r?\n/);
  const filtered = lines.filter((l) => l.replace(/\s+$/, "") !== line);
  // Reassemble using \n (we normalize to LF on write — CRLF preservation is
  // an explicit non-goal per the rc.19 byte-comparison contract).
  return filtered.join("\n");
}

/**
 * True when `content` contains a line whose trimmed-right content exactly
 * equals `line`. Trailing whitespace tolerated so user-edited copies do not
 * trigger spurious re-append on second install.
 */
function hasExactLine(content: string, line: string): boolean {
  const lines = content.split(/\r?\n/);
  return lines.some((l) => l.replace(/\s+$/, "") === line);
}

/**
 * Write the BOOTSTRAP managed block to root `AGENTS.md`, sourced from
 * `buildManagedBlockBody`. In-place replace when the BOOTSTRAP marker pair is
 * already present; append with a blank-line separator when absent. Pre-
 * existing user content outside the markers is preserved verbatim (managed-
 * section invariant).
 *
 * Creates AGENTS.md if missing (root anchor responsibility moved to bootstrap-
 * stage per rc.19 TASK-003 — scaffold-stage no longer writes it).
 */
export async function writeCodexBootstrapManagedBlock(
  targetRoot: string,
): Promise<InstallStepResult> {
  const step = "bootstrap-codex";
  const target = join(targetRoot, "AGENTS.md");

  let existing = "";
  if (existsSync(target)) {
    try {
      existing = await readFile(target, "utf8");
    } catch (error: unknown) {
      return {
        step,
        path: target,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const body = buildManagedBlockBody(targetRoot);
  const managedBlock = wrapInBootstrapMarkers(body);

  // In-place replace of the fabric:bootstrap section, else append.
  let next: string;
  const match = existing.match(BOOTSTRAP_REGEX);
  if (match !== null) {
    const before = existing.slice(0, match.index ?? 0);
    const after = existing.slice((match.index ?? 0) + match[0].length);
    const cleaned = `${before}${after.replace(/^\r?\n/, "")}`;
    const trailingNewline = cleaned.length === 0 || cleaned.endsWith("\n") ? "" : "\n";
    next = `${cleaned}${trailingNewline}${cleaned.length === 0 ? "" : "\n"}${managedBlock}\n`;
  } else {
    if (existing.length === 0) {
      next = `${managedBlock}\n`;
    } else {
      const trailingNewline = existing.endsWith("\n") ? "" : "\n";
      next = `${existing}${trailingNewline}\n${managedBlock}\n`;
    }
  }

  if (next === existing) {
    return { step, path: target, status: "skipped", message: "up-to-date" };
  }

  try {
    await mkdir(dirname(target), { recursive: true });
    await atomicWriteText(target, next);
    return { step, path: target, status: "written" };
  } catch (error: unknown) {
    return {
      step,
      path: target,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
