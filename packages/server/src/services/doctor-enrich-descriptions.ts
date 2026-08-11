// `fabric doctor --enrich-descriptions` — description-grade frontmatter back-fill.
//
// This is not a doctor CHECK. It is a knowledge-tree MUTATION that the CLI
// audit command drives (packages/cli/src/commands/audit.ts) and that
// packages/server/src/index.ts re-exports as public API. It lived in doctor.ts
// only because that is where it was first written; nothing in the doctor
// report or fix pipelines calls it, and nothing else in doctor.ts calls the
// canonical-filename walker it needs. Moving both here leaves doctor.ts to
// doctoring — the repo already keeps one concern per `doctor-*.ts` file.

import { readFile } from "node:fs/promises";
import { posix } from "node:path";

import { atomicWriteText } from "@fenglimg/fabric-shared/node/atomic-write";

import { collectStoreCanonicalEntries } from "./cross-store-recall.js";
import { synthesizeMustReadIfStub, yamlQuoteIfNeeded } from "./doctor-frontmatter-helpers.js";
import { normalizePath } from "./doctor-path.js";
import type {
  EnrichDescriptionsCandidate,
  EnrichDescriptionsMode,
  EnrichDescriptionsReport,
} from "./doctor-types.js";
import { appendEventLedgerEvent } from "./event-ledger.js";

// The canonical knowledge subdirectories. Sole remaining consumer is the
// walker below — the doctor checks that once shared it are gone.
type CanonicalLayer = "team" | "personal";

// Filename pattern for canonical knowledge entries. Prefer `<id>--<slug>.md`
// but also accept `<id>.md` because store-era fixtures and migrated entries may
// use bare stable-id filenames while still carrying valid frontmatter.
const CANONICAL_KNOWLEDGE_FILENAME_PATTERN =
  /^(K[PT]-(?:MOD|DEC|GLD|PIT|PRO)-\d{4,})(?:--[a-z0-9][a-z0-9-]*)?\.md$/u;

const KNOWLEDGE_CANONICAL_TYPE_DIRS = [
  "decisions",
  "pitfalls",
  "guidelines",
  "models",
  "processes",
] as const;

// ---------------------------------------------------------------------------
// rc.4 TASK-002: read-side integrity lint inspections (#19-21).
// Enrichment now walks mounted store read-set entries via
// collectStoreCanonicalEntries, then parses the stable_id token from each
// canonical filename for compatibility with the old enrichment report shape.
// ---------------------------------------------------------------------------

type ParsedCanonicalFilename = {
  // Layer code parsed from the stable_id prefix.
  prefix: "KP" | "KT";
  // 3-letter knowledge type code.
  typeCode: "MOD" | "DEC" | "GLD" | "PIT" | "PRO";
  // Zero-padded counter parsed as a number (e.g. "0007" → 7).
  counter: number;
  // The full stable_id token (e.g. "KT-DEC-0007").
  stable_id: string;
};

// Pure parser. Returns null when the filename does not match the canonical
// `<id>--<slug>.md` shape. Files that don't match are silently skipped — the
// `stable_id_collision` and `filesystem_edit_fallback` checks already cover
// the orthogonal "unparseable canonical entry" surface.
function parseStableIdFromCanonicalFilename(filename: string): ParsedCanonicalFilename | null {
  const match = CANONICAL_KNOWLEDGE_FILENAME_PATTERN.exec(filename);
  if (match === null) {
    return null;
  }
  const stableId = match[1];
  // Re-parse the id token to extract structured fields. The outer pattern
  // already validated the shape, so this inner regex is a safe destructure.
  const inner = /^(K[PT])-(MOD|DEC|GLD|PIT|PRO)-(\d{4,})$/u.exec(stableId);
  if (inner === null) {
    return null;
  }
  return {
    prefix: inner[1] as "KP" | "KT",
    typeCode: inner[2] as ParsedCanonicalFilename["typeCode"],
    counter: Number.parseInt(inner[3], 10),
    stable_id: stableId,
  };
}

type CanonicalFilenameVisit = {
  layer: CanonicalLayer;
  type: typeof KNOWLEDGE_CANONICAL_TYPE_DIRS[number];
  filename: string;
  file: string;
  // Display path — project-relative POSIX for team layer; `~/.fabric/...`
  // form for personal layer (matches PERSONAL_CONTENT_REF_PREFIX in
  // knowledge-meta-builder.ts so messages render consistently with the rest of
  // the v2.0 surface).
  displayPath: string;
  parsed: ParsedCanonicalFilename;
};

// Generator over canonical knowledge filenames in the project's resolved
// store read-set. Yields only entries whose filename parses to a stable_id
// token — other files (legacy-named, README, etc.) are silently skipped.
async function* iterateCanonicalFilenames(projectRoot: string): AsyncGenerator<CanonicalFilenameVisit> {
  for (const entry of await collectStoreCanonicalEntries(projectRoot)) {
    if (!(KNOWLEDGE_CANONICAL_TYPE_DIRS as readonly string[]).includes(entry.type)) {
      continue;
    }
    const filename = posix.basename(normalizePath(entry.file));
    const parsed = parseStableIdFromCanonicalFilename(filename);
    if (parsed === null) {
      continue;
    }
    const displayPath = `store:${entry.qualifiedId}`;
    yield {
      layer: entry.layer,
      type: entry.type as typeof KNOWLEDGE_CANONICAL_TYPE_DIRS[number],
      filename,
      file: entry.file,
      displayPath,
      parsed,
    };
  }
}
// v2.0.0-rc.23 TASK-007 (a-C2): `fabric doctor --enrich-descriptions`
// ---------------------------------------------------------------------------
//
// TASK-006 (a-C1) added four optional description-grade frontmatter fields
// (`intent_clues`, `tech_stack`, `impact`, `must_read_if`) to the
// extract-knowledge schema + writer. Entries archived BEFORE rc.23 — and
// rc.23 entries that the Skill chose to omit them on — won't carry the
// fields, leaving the planContext description budget thinner than it could
// be. `enrichDescriptions` walks the canonical knowledge tree (both team and
// personal roots) and either back-fills deterministic stub values
// (`--auto`) or surfaces a missing-field summary for the operator to feed
// back into the archive Skill / manual editor.
//
// Scope:
//   * mounted store `knowledge/{decisions,pitfalls,guidelines,models,processes}/*.md`
//     entries in the project's resolved read-set
//   * `pending/` and archive history are deliberately skipped — pending entries
//     are still in flight (the Skill owns their schema) and archived entries
//     are immutable history.
//
// Atomicity: the on-disk rewrite goes through `atomicWriteText` so a crash
// mid-write never leaves a half-state. Idempotent: a file already carrying
// all four fields produces no diff and no event.

// v2.0.0-rc.29 TASK-007 (BUG-M1): expand the mode label so the report
// honestly distinguishes the three observable behaviors of
// `fabric doctor --enrich-descriptions`:
//   - readonly: no `--auto`, no `--dry-run` → scan + report, write nothing.
//   - preview : `--auto --dry-run` → simulate writes, show diff, write nothing.
//   - auto    : `--auto` (no `--dry-run`) → actually mutate frontmatter on disk.
// Previously this was `auto | interactive`; the audit (rc.28 round 1) flagged
// `mode: "interactive", dryRun: false` as misleading when 0 files were written.
// "interactive" is retained as a deprecated alias mapping to "readonly" so
// existing API consumers keep parsing — the label printed by the renderer is
// the canonical one chosen by the new logic below.
// EnrichDescriptions* types re-exported from doctor-types.ts.

const ENRICH_DESC_FIELDS = ["intent_clues", "tech_stack", "impact", "must_read_if"] as const;
type EnrichDescField = (typeof ENRICH_DESC_FIELDS)[number];

// Per-field line detectors. Matches the same shape extract-knowledge.ts emits:
// flow-form arrays (`intent_clues: [...]` / `intent_clues: []`) and a single
// quoted/unquoted scalar for must_read_if. Anchored on the field name + colon
// so a substring (e.g. inside a body code block) cannot trick the regex.
const ENRICH_DESC_FIELD_PATTERNS: Record<EnrichDescField, RegExp> = {
  intent_clues: /^intent_clues\s*:/mu,
  tech_stack: /^tech_stack\s*:/mu,
  impact: /^impact\s*:/mu,
  must_read_if: /^must_read_if\s*:/mu,
};

export async function enrichDescriptions(
  projectRoot: string,
  opts: { auto?: boolean; dryRun?: boolean } = {},
): Promise<EnrichDescriptionsReport> {
  const auto = opts.auto === true;
  const dryRun = opts.dryRun === true;
  // v2.0.0-rc.29 TASK-007 (BUG-M1): tri-mode label. `--auto && --dry-run` is
  // preview; bare `--auto` is the only true mutating mode; everything else is
  // readonly. The legacy "interactive" label is kept in the type union as a
  // deprecated alias so external schema consumers continue to parse.
  const mode: EnrichDescriptionsMode = auto ? (dryRun ? "preview" : "auto") : "readonly";

  const candidates: EnrichDescriptionsCandidate[] = [];
  let scanned = 0;
  let modified = 0;
  let skipped = 0;

  for await (const visit of iterateCanonicalFilenames(projectRoot)) {
    const absPath = visit.file;
    scanned += 1;

    let source: string;
    try {
      source = await readFile(absPath, "utf8");
    } catch {
      // Disappeared between readdir and read — skip silently (next doctor
      // run picks up the live state).
      continue;
    }

    const fmMatch = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---/u.exec(source);
    if (fmMatch === null) {
      // Body-only files: surface as a candidate with a parse-error marker so
      // the operator sees they exist, but skip the rewrite arm — we don't
      // synthesize a frontmatter block from nothing (the Skill owns initial
      // archive shape).
      candidates.push({
        path: visit.displayPath,
        missing: [...ENRICH_DESC_FIELDS],
        modified: false,
        added_fields: [],
        error: "frontmatter not parseable",
      });
      continue;
    }
    const block = fmMatch[1];

    const missing = ENRICH_DESC_FIELDS.filter(
      (field) => !ENRICH_DESC_FIELD_PATTERNS[field].test(block),
    );

    if (missing.length === 0) {
      skipped += 1;
      continue;
    }

    if (!auto || dryRun) {
      // Interactive or dryRun: report but don't rewrite. Operator drives the
      // resolution (rerun the archive Skill, or manually edit + commit).
      candidates.push({
        path: visit.displayPath,
        missing,
        modified: false,
        added_fields: [],
      });
      continue;
    }

    // Auto mode (with write): synthesize stubs. Empty arrays for the three
    // list-valued fields are the deliberate "I have nothing to add" signal —
    // they make the entry schema-valid for planContext's
    // description-budget builder without claiming knowledge we don't have.
    // For must_read_if we derive a one-line summary from the body's first
    // H1 (or the slug-derived filename token) so the field carries SOMETHING
    // operator-meaningful by default. The stub strings stay short so the
    // YAML scalar fits on one line without folding.
    const mustReadIf = synthesizeMustReadIfStub(source, visit.filename);
    const additions: Array<{ field: EnrichDescField; line: string }> = [];
    for (const field of missing) {
      if (field === "must_read_if") {
        additions.push({ field, line: `must_read_if: ${yamlQuoteIfNeeded(mustReadIf)}` });
      } else {
        additions.push({ field, line: `${field}: []` });
      }
    }
    const trailing = block.endsWith("\n") ? "" : "\n";
    const replacedBlock = `${block}${trailing}${additions.map((a) => a.line).join("\n")}`;
    const blockStart = source.indexOf(block);
    if (blockStart < 0) {
      // Defensive: should never happen since fmMatch came from source.
      candidates.push({
        path: visit.displayPath,
        missing,
        modified: false,
        added_fields: [],
        error: "frontmatter block not located after match",
      });
      continue;
    }
    const rewritten =
      source.slice(0, blockStart) + replacedBlock + source.slice(blockStart + block.length);

    await atomicWriteText(absPath, rewritten);
    modified += 1;
    candidates.push({
      path: visit.displayPath,
      missing,
      modified: true,
      added_fields: additions.map((a) => a.field),
    });

    // Best-effort audit trail. A ledger write failure must NOT propagate —
    // the file is already on disk and re-running the command would be a
    // no-op (idempotency), so dropping the event is preferable to rolling
    // back a successful write.
    await appendEventLedgerEvent(projectRoot, {
      event_type: "knowledge_enriched",
      path: visit.displayPath,
      added_fields: additions.map((a) => a.field),
      mode,
      timestamp: new Date().toISOString(),
    }).catch(() => {});
  }

  // Stable display order — alphabetical by path so callers (CLI render, test
  // assertions) don't depend on readdir() ordering quirks.
  candidates.sort((a, b) => a.path.localeCompare(b.path));

  return { mode, dryRun, scanned, modified, skipped, candidates };
}


