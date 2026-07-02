import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import {
  STORE_KNOWLEDGE_TYPE_DIRS,
  STORE_LAYOUT,
  STORE_PROJECT_ID_PATTERN,
  isPersonalScope,
  parseKnowledgeId,
  scopeRoot,
} from "@fenglimg/fabric-shared";

// ---------------------------------------------------------------------------
// v2.1 global-refactor (W3/A5) — clean-slate scope backfill.
//
// Existing knowledge entries (project co-location + each store) pre-date the
// v2.1 scope schema: they carry `layer: team|personal` but no `semantic_scope`
// / `visibility_store`. This tool backfills the two scope fields and repairs a
// DIRTY layer (a `layer:` value that disagrees with the entry's id prefix —
// KT- ⇒ team, KP- ⇒ personal; the id prefix is the authoritative layer signal
// per KT-DEC-0004). Pure markdown frontmatter surgery; a `--dry-run` mode emits
// the diff without writing.
//
// Scope derivation is deliberately CONSERVATIVE — backfill never invents a
// `project:<id>` coordinate (project scoping is an explicit forward-looking
// write-path decision, A1/A2, not a retroactive guess). It maps:
//   id prefix KP-  → semantic_scope: personal, visibility_store: personal
//   id prefix KT-  → semantic_scope: team,     visibility_store: <store alias>
// R5#3: a personal-scope entry is NEVER given a shared visibility_store.
// ---------------------------------------------------------------------------

export interface BackfillChange {
  file: string;
  id: string | null;
  // The frontmatter keys this entry changed (added or repaired).
  changed: Array<"layer" | "semantic_scope" | "visibility_store">;
}

export interface BackfillReport {
  dryRun: boolean;
  // Entries that were already fully scope-tagged + layer-consistent (no change).
  unchanged: number;
  changes: BackfillChange[];
  // Files skipped because they have no parseable frontmatter / id.
  skipped: string[];
}

export interface BackfillOptions {
  // Store alias recorded as visibility_store for TEAM-scope entries. Personal
  // entries always get "personal" regardless (R5#3).
  visibilityStore: string;
  dryRun?: boolean;
  // v2.1 W2/TASK-005 phase-2 gate. In phase-2, path is the SOLE source of truth
  // for scope, so backfill STOPS authoring `semantic_scope` frontmatter (the
  // reader derives it from the projects/<id>/ path segment, C-104). Left off
  // (phase-1 default) the field is still fallback-written so the reversibility
  // path — drop this flag, restore frontmatter — stays intact.
  phase2?: boolean;
}

// Exported for reuse by the W4/A7 re-scope/promote tool (store-rescope.ts) — the
// same flat-scalar frontmatter surgery both tools perform.
export const FRONTMATTER_RE = /^(?:﻿)?---\r?\n([\s\S]*?)\r?\n---/u;

export function readKey(block: string, key: string): string | undefined {
  const m = new RegExp(`^${key}:\\s*"?([^"\\n]+?)"?\\s*$`, "mu").exec(block);
  return m?.[1];
}

// Insert or replace a `key: value` line in the frontmatter block, anchored after
// `anchorKey` when the key is absent (keeps related scope fields grouped).
export function setKey(block: string, key: string, value: string, anchorKey: string): string {
  const lines = block.split(/\r?\n/u);
  const idx = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  if (idx !== -1) {
    lines[idx] = `${key}: ${value}`;
    return lines.join("\n");
  }
  const anchorIdx = lines.findIndex((l) => new RegExp(`^${anchorKey}:`).test(l));
  const at = anchorIdx === -1 ? lines.length - 1 : anchorIdx + 1;
  lines.splice(at, 0, `${key}: ${value}`);
  return lines.join("\n");
}

// Backfill one markdown entry. Returns the rewritten content + the change record,
// or null when the file has no parseable frontmatter (caller records a skip).
export function backfillEntryContent(
  content: string,
  visibilityStore: string,
  phase2 = false,
): { content: string; change: BackfillChange } | null {
  const match = FRONTMATTER_RE.exec(content);
  if (match === null) {
    return null;
  }
  const block = match[1] ?? "";
  const id = readKey(block, "id") ?? null;
  const parsed = id === null ? null : parseKnowledgeId(id);
  // id prefix is the authoritative layer (KT-DEC-0004); fall back to the declared
  // layer when the id is non-canonical (e.g. a 9xxx dogfood id still parses).
  const declaredLayer = readKey(block, "layer");
  const layer: "team" | "personal" =
    parsed?.layer ?? (declaredLayer === "personal" ? "personal" : "team");

  const semanticScope = layer === "personal" ? "personal" : "team";
  // R5#3: personal scope must never carry a shared store as its home.
  const visibility = isPersonalScope(semanticScope) ? "personal" : visibilityStore;

  const changed: BackfillChange["changed"] = [];
  let newBlock = block;

  if (declaredLayer !== layer) {
    newBlock = setKey(newBlock, "layer", layer, "maturity");
    changed.push("layer");
  }
  // Phase-2 stops authoring semantic_scope — the projects/<id>/ path segment is
  // now the source of truth (C-104), so re-emitting the frontmatter coordinate
  // would only re-introduce the drift the reroot removes. Phase-1 still
  // fallback-writes it (reversibility: drop `phase2`, restore the field). DA-03:
  // visibility_store is authored in BOTH phases — it is store provenance, not a
  // path-derived scope, so path can never carry it.
  if (!phase2 && readKey(block, "semantic_scope") !== semanticScope) {
    newBlock = setKey(newBlock, "semantic_scope", semanticScope, "layer");
    changed.push("semantic_scope");
  }
  if (readKey(block, "visibility_store") !== visibility) {
    newBlock = setKey(newBlock, "visibility_store", `"${visibility}"`, "semantic_scope");
    changed.push("visibility_store");
  }

  if (changed.length === 0) {
    return { content, change: { file: "", id, changed } };
  }
  const before = content.slice(0, match.index);
  const after = content.slice(match.index + match[0].length);
  return {
    content: `${before}---\n${newBlock}\n---${after}`,
    change: { file: "", id, changed },
  };
}

// Backfill every canonical knowledge entry under `knowledgeDir` (the dir holding
// the 5 type subdirs). Pending entries are excluded — they are re-written on
// approve. `dryRun` computes the report without touching disk.
export function backfillKnowledgeDir(
  knowledgeDir: string,
  options: BackfillOptions,
): BackfillReport {
  const report: BackfillReport = { dryRun: options.dryRun === true, unchanged: 0, changes: [], skipped: [] };
  for (const type of STORE_KNOWLEDGE_TYPE_DIRS) {
    const dir = join(knowledgeDir, type);
    if (!existsSync(dir)) {
      continue;
    }
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".md")).sort()) {
      const file = join(dir, name);
      const result = backfillEntryContent(
        readFileSync(file, "utf8"),
        options.visibilityStore,
        options.phase2 === true,
      );
      if (result === null) {
        report.skipped.push(file);
        continue;
      }
      if (result.change.changed.length === 0) {
        report.unchanged += 1;
        continue;
      }
      result.change.file = file;
      report.changes.push(result.change);
      if (options.dryRun !== true) {
        writeFileSync(file, result.content, "utf8");
      }
    }
  }
  return report;
}

// ---------------------------------------------------------------------------
// v2.1 W2/TASK-005 phase-2 — project-entry MIGRATION into the projects/ subtree.
//
// Pre-reroot, a project-specific entry lived FLAT at knowledge/<type>/*.md and
// declared its home via authored `semantic_scope: project:<id>` frontmatter.
// TASK-003 made knowledge/projects/<id>/<type>/ the SOLE structural home (path =
// source of truth, C-104). This migration relocates each existing flat entry
// whose authored scope is `project:<id>` into that subtree via `git mv` — NOT
// rm+create — so `git log --follow` / `git blame` recover the original commit
// (C-007 blame preservation). An untracked/non-git entry falls back to fs rename
// and records `gitMv:false` so the report surfaces which entries lost provenance.
//
// The scan walks ONLY the flat root type dirs (never projects/), so an entry
// already under projects/<id>/ is invisible to the walk ⇒ a second run reports
// zero moves (idempotent on both dry-run and real paths, TS-08). `dryRun`
// computes the planned moves WITHOUT touching disk; a real run performs exactly
// the same set (planned === actual, TS-06).
// ---------------------------------------------------------------------------

export interface MigrationMove {
  id: string | null;
  project: string;
  fromPath: string; // absolute
  toPath: string; // absolute
  // false when the move fell back to fs rename (untracked / non-git) — git blame
  // provenance was NOT preserved for this entry.
  gitMv: boolean;
}

export interface MigrationSkip {
  file: string; // absolute
  reason: "no-frontmatter" | "non-project-scope";
}

export interface MigrationReport {
  dryRun: boolean;
  // Per-entry change records (same shape the CLI surface renders): one per move.
  changes: MigrationMove[];
  // Alias of `changes` for the {dryRun, changes[], moves[], skipped[]} contract —
  // moves is the canonical name, changes mirrors it for report symmetry.
  moves: MigrationMove[];
  skipped: MigrationSkip[];
}

// The authored project coordinate lives in `semantic_scope: project:<id>` (the
// phase-1 frontmatter the reroot replaces with path structure). Returns the bare
// <id> when the entry declares a well-formed project scope, else undefined.
function readProjectId(block: string): string | undefined {
  const scope = readKey(block, "semantic_scope");
  if (scope === undefined || scopeRoot(scope) !== "project") {
    return undefined;
  }
  const id = scope.slice("project:".length);
  return STORE_PROJECT_ID_PATTERN.test(id) ? id : undefined;
}

// Move one entry from `fromPath` to `toPath`, preferring `git mv` (preserves
// blame) with an fs-rename fallback for untracked / non-git entries. Returns
// whether git mv succeeded. Creates the destination parent as needed. The caller
// guarantees this is never invoked in dryRun.
function moveEntry(storeDir: string, fromPath: string, toPath: string): boolean {
  mkdirSync(dirname(toPath), { recursive: true });
  const relFrom = relative(storeDir, fromPath);
  const relTo = relative(storeDir, toPath);
  try {
    // -k skips (rather than errors) if the target already exists; we never call
    // moveEntry for a same-path no-op, so a collision is a genuine caller bug we
    // want surfaced via the fallback rather than a hard throw mid-migration.
    execFileSync("git", ["mv", relFrom, relTo], {
      cwd: storeDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    // Untracked file or non-git store: fs rename preserves the bytes but loses
    // git rename detection. gitMv:false flags the provenance gap for the report.
    renameSync(fromPath, toPath);
    return false;
  }
}

// Migrate every flat project-scoped entry under `storeDir` into
// knowledge/projects/<id>/<type>/. `storeDir` is the store's git repo root; the
// knowledge tree lives at <storeDir>/knowledge. dryRun computes the planned
// moves without touching disk.
export function migrateProjectEntries(
  storeDir: string,
  options: { dryRun?: boolean } = {},
): MigrationReport {
  const dryRun = options.dryRun === true;
  const moves: MigrationMove[] = [];
  const skipped: MigrationSkip[] = [];
  const knowledgeDir = join(storeDir, STORE_LAYOUT.knowledgeDir);

  for (const type of STORE_KNOWLEDGE_TYPE_DIRS) {
    const dir = join(knowledgeDir, type);
    if (!existsSync(dir)) {
      continue;
    }
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".md")).sort()) {
      const fromPath = join(dir, name);
      const match = FRONTMATTER_RE.exec(readFileSync(fromPath, "utf8"));
      if (match === null) {
        skipped.push({ file: fromPath, reason: "no-frontmatter" });
        continue;
      }
      const block = match[1] ?? "";
      const project = readProjectId(block);
      if (project === undefined) {
        skipped.push({ file: fromPath, reason: "non-project-scope" });
        continue;
      }
      const toPath = join(knowledgeDir, "projects", project, type, name);
      const move: MigrationMove = {
        id: readKey(block, "id") ?? null,
        project,
        fromPath,
        toPath,
        gitMv: dryRun ? true : moveEntry(storeDir, fromPath, toPath),
      };
      moves.push(move);
    }
  }

  return { dryRun, changes: moves, moves, skipped };
}
