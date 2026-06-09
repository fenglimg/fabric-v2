import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  STORE_KNOWLEDGE_TYPE_DIRS,
  STORE_LAYOUT,
  isPersonalScope,
  readStoreProjects,
  scopeCoordinateSchema,
  scopeRoot,
} from "@fenglimg/fabric-shared";

import { FRONTMATTER_RE, readKey, setKey } from "./scope-backfill.js";

// ---------------------------------------------------------------------------
// v2.2 W4 (G-GUARD / A7) — re-scope + promote.
//
// Re-scope rewrites a knowledge entry's `semantic_scope` coordinate in place
// (scope ⊥ store, S42 — changing the resolution axis does NOT move the file
// between stores). Promote is the canonical broadening: project:<id> → team
// ("project absorption" — a project-specific decision graduates to team-wide).
//
// Guard rails (the same invariants doctor's A6 scope lint flags):
//   - target must be a well-formed coordinate (scopeCoordinateSchema)
//   - R5#3: refuse re-scoping to `personal` inside a SHARED store
//   - refuse a `project:<id>` target whose id is not registered in the store
//     (never CREATE a dangling project ref)
//
// Pure markdown frontmatter surgery reusing scope-backfill's flat-scalar
// helpers; `--dry-run` computes the report without writing.
// ---------------------------------------------------------------------------

export interface RescopeChange {
  file: string;
  id: string | null;
  fromScope: string | undefined;
  toScope: string;
}

export interface RescopeRefusal {
  file: string;
  id: string | null;
  reason: string;
}

export interface RescopeReport {
  dryRun: boolean;
  toScope: string;
  changes: RescopeChange[];
  refusals: RescopeRefusal[];
  unchanged: number; // already at toScope
  skipped: string[]; // no parseable frontmatter
}

export interface RescopeOptions {
  // Entry selection (combined with AND). When none is set, every canonical entry
  // in the store matches (full-store re-scope).
  id?: string; // exact stable_id
  fromScope?: string; // exact current semantic_scope
  fromScopeRoot?: string; // current scope's leading segment (e.g. "project")
  dryRun?: boolean;
  // The holding store's visibility — R5#3 refuses personal scope in a shared store.
  storeVisibility: "shared" | "personal";
}

// Validate a target scope is well-formed + safe for this store. null when ok.
async function validateToScope(
  toScope: string,
  storeDir: string,
  storeVisibility: "shared" | "personal",
): Promise<string | null> {
  if (!scopeCoordinateSchema.safeParse(toScope).success) {
    return `invalid scope coordinate '${toScope}'`;
  }
  if (isPersonalScope(toScope) && storeVisibility === "shared") {
    return "refusing personal scope in a shared store (R5#3 privacy boundary)";
  }
  if (scopeRoot(toScope) === "project") {
    const projectId = toScope.split(":")[1] ?? "";
    if (projectId.length === 0 || !(await readStoreProjects(storeDir)).some((p) => p.id === projectId)) {
      return `project '${projectId}' is not registered in this store (run \`fabric store project add ${projectId}\` first)`;
    }
  }
  return null;
}

function matchesSelection(
  options: RescopeOptions,
  id: string | null,
  currentScope: string | undefined,
): boolean {
  if (options.id !== undefined && id !== options.id) {
    return false;
  }
  if (options.fromScope !== undefined && currentScope !== options.fromScope) {
    return false;
  }
  if (
    options.fromScopeRoot !== undefined &&
    (currentScope === undefined || scopeRoot(currentScope) !== options.fromScopeRoot)
  ) {
    return false;
  }
  return true;
}

// Re-scope every selected canonical entry in `storeDir` to `toScope`.
export async function rescopeStore(
  storeDir: string,
  toScope: string,
  options: RescopeOptions,
): Promise<RescopeReport> {
  const report: RescopeReport = {
    dryRun: options.dryRun === true,
    toScope,
    changes: [],
    refusals: [],
    unchanged: 0,
    skipped: [],
  };
  // Target validity is a store-level property (independent of which entries match).
  const toScopeError = await validateToScope(toScope, storeDir, options.storeVisibility);

  for (const type of STORE_KNOWLEDGE_TYPE_DIRS) {
    const dir = join(storeDir, STORE_LAYOUT.knowledgeDir, type);
    if (!existsSync(dir)) {
      continue;
    }
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".md")).sort()) {
      const file = join(dir, name);
      const content = readFileSync(file, "utf8");
      const match = FRONTMATTER_RE.exec(content);
      if (match === null) {
        report.skipped.push(file);
        continue;
      }
      const block = match[1] ?? "";
      const id = readKey(block, "id") ?? null;
      const currentScope = readKey(block, "semantic_scope");

      if (!matchesSelection(options, id, currentScope)) {
        continue;
      }
      if (currentScope === toScope) {
        report.unchanged += 1;
        continue;
      }
      if (toScopeError !== null) {
        report.refusals.push({ file, id, reason: toScopeError });
        continue;
      }

      const newBlock = setKey(block, "semantic_scope", toScope, "layer");
      const before = content.slice(0, match.index);
      const after = content.slice(match.index + match[0].length);
      report.changes.push({ file, id, fromScope: currentScope, toScope });
      if (options.dryRun !== true) {
        writeFileSync(file, `${before}---\n${newBlock}\n---${after}`, "utf8");
      }
    }
  }
  return report;
}

// Promote project-scoped entries to team-wide (project:<id> → team). When
// `projectId` is given only that project's entries graduate; otherwise every
// `project:*` entry in the store is absorbed into team scope.
export async function promoteProjectToTeam(
  storeDir: string,
  options: { projectId?: string; storeVisibility: "shared" | "personal"; dryRun?: boolean },
): Promise<RescopeReport> {
  const selection: RescopeOptions =
    options.projectId !== undefined
      ? { fromScope: `project:${options.projectId}`, storeVisibility: options.storeVisibility, dryRun: options.dryRun }
      : { fromScopeRoot: "project", storeVisibility: options.storeVisibility, dryRun: options.dryRun };
  return rescopeStore(storeDir, "team", selection);
}
