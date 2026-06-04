import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  STORE_KNOWLEDGE_TYPE_DIRS,
  isPersonalScope,
  parseKnowledgeId,
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
}

const FRONTMATTER_RE = /^(?:﻿)?---\r?\n([\s\S]*?)\r?\n---/u;

function readKey(block: string, key: string): string | undefined {
  const m = new RegExp(`^${key}:\\s*"?([^"\\n]+?)"?\\s*$`, "mu").exec(block);
  return m?.[1];
}

// Insert or replace a `key: value` line in the frontmatter block, anchored after
// `anchorKey` when the key is absent (keeps related scope fields grouped).
function setKey(block: string, key: string, value: string, anchorKey: string): string {
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
  if (readKey(block, "semantic_scope") !== semanticScope) {
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
      const result = backfillEntryContent(readFileSync(file, "utf8"), options.visibilityStore);
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
