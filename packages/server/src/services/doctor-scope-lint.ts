import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildStoreResolveInput,
  createStoreResolver,
  isPersonalScope,
  type MountedStoreDir,
  readKnowledgeAcrossStores,
  readStoreProjects,
  resolveGlobalRoot,
  scopeRoot,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";

// ---------------------------------------------------------------------------
// v2.2 W4 (G-GUARD / A6) — doctor scope lint over the read-set stores.
//
// Three structural checks on the scope metadata that the W1 write-side stamps
// (semantic_scope + visibility_store, schemas/scope.ts):
//
//   missing_scope_fields          — a canonical entry lacking semantic_scope or
//                                    visibility_store (fixable: `store backfill-scope`).
//   personal_leak_in_shared_store — a personal-scope entry (or KP- id) physically
//                                    living in a SHARED store (R5#3 privacy red line).
//   dangling_project_ref          — semantic_scope `project:<id>` whose <id> is not
//                                    registered in the holding store's projects.json
//                                    (a typo that silently routes recall to nothing).
//
// Reads ONLY stores (the canonical post-decolo knowledge home) — the project
// co-location agents.meta is irrelevant here. Pure read; returns violations the
// doctor check layer shapes into a report (never throws — a multi-store hiccup
// degrades to "no violations observable", never crashes doctor).
// ---------------------------------------------------------------------------

export type ScopeLintCode =
  | "missing_scope_fields"
  | "personal_leak_in_shared_store"
  | "dangling_project_ref";

export interface ScopeLintViolation {
  code: ScopeLintCode;
  store_alias: string;
  store_uuid: string;
  file: string; // absolute path inside the store
  stable_id: string | null;
  detail: string;
}

// Line-regex frontmatter field read (not full YAML) — matches the write-side
// emit shape and the other frontmatter scanners in this repo (cross-store-recall
// SEMANTIC_SCOPE_LINE, scope-backfill).
function fieldLine(key: string): RegExp {
  return new RegExp(`^${key}:\\s*"?([^"\\n]+?)"?\\s*$`, "mu");
}
const ID_LINE = fieldLine("id");
const SEMANTIC_SCOPE_LINE = fieldLine("semantic_scope");
const VISIBILITY_STORE_LINE = fieldLine("visibility_store");

function readField(src: string, re: RegExp): string | undefined {
  return re.exec(src)?.[1];
}

interface StoreCtx {
  uuid: string;
  alias: string;
  dir: string;
  visibility: "shared" | "personal";
  projectIds: Set<string>;
}

// Resolve the project's read-set stores with provenance + visibility + the set
// of project ids each store registers. [] when there is no global config / no
// mounted store (never throws).
function resolveLintStores(projectRoot: string): StoreCtx[] {
  const input = buildStoreResolveInput(projectRoot);
  if (input === null) {
    return [];
  }
  const readSet = createStoreResolver().resolveReadSet(input);
  if (readSet.stores.length === 0) {
    return [];
  }
  const personalUuids = new Set(
    input.mountedStores.filter((s) => s.personal).map((s) => s.store_uuid),
  );
  const globalRoot = resolveGlobalRoot();
  return readSet.stores.map((entry) => {
    const mounted = input.mountedStores.find((s) => s.store_uuid === entry.store_uuid);
    const dir = join(
      globalRoot,
      storeRelativePathForMount(mounted ?? { store_uuid: entry.store_uuid }),
    );
    return {
      uuid: entry.store_uuid,
      alias: entry.alias,
      dir,
      visibility: personalUuids.has(entry.store_uuid) ? "personal" : "shared",
      projectIds: new Set(readStoreProjects(dir).map((p) => p.id)),
    };
  });
}

// Run the three scope lints over every canonical entry in the read-set stores.
export function lintStoreScopes(projectRoot: string): ScopeLintViolation[] {
  const stores = resolveLintStores(projectRoot);
  if (stores.length === 0) {
    return [];
  }
  const byUuid = new Map(stores.map((s) => [s.uuid, s]));
  const dirs: MountedStoreDir[] = stores.map((s) => ({
    store_uuid: s.uuid,
    alias: s.alias,
    dir: s.dir,
  }));

  const violations: ScopeLintViolation[] = [];
  for (const ref of readKnowledgeAcrossStores(dirs)) {
    const store = byUuid.get(ref.store_uuid);
    if (store === undefined) {
      continue;
    }
    let source: string;
    try {
      source = readFileSync(ref.file, "utf8");
    } catch {
      continue; // file vanished between walk and read — skip, never crash.
    }
    const id = readField(source, ID_LINE) ?? null;
    const semanticScope = readField(source, SEMANTIC_SCOPE_LINE);
    const visibilityStore = readField(source, VISIBILITY_STORE_LINE);
    const base = {
      store_alias: store.alias,
      store_uuid: store.uuid,
      file: ref.file,
      stable_id: id,
    };

    // 1) Missing scope fields.
    const missing: string[] = [];
    if (semanticScope === undefined) {
      missing.push("semantic_scope");
    }
    if (visibilityStore === undefined) {
      missing.push("visibility_store");
    }
    if (missing.length > 0) {
      violations.push({
        ...base,
        code: "missing_scope_fields",
        detail: `missing ${missing.join(" + ")} frontmatter`,
      });
    }

    // 2) Personal-scope entry physically in a SHARED store (R5#3).
    const isPersonalEntry =
      (semanticScope !== undefined && isPersonalScope(semanticScope)) ||
      (id !== null && id.startsWith("KP-"));
    if (isPersonalEntry && store.visibility === "shared") {
      violations.push({
        ...base,
        code: "personal_leak_in_shared_store",
        detail: `personal-scope entry '${semanticScope ?? id}' in shared store '${store.alias}' (R5#3 privacy boundary)`,
      });
    }

    // 3) Dangling project reference: project:<id> not registered in this store.
    if (semanticScope !== undefined && scopeRoot(semanticScope) === "project") {
      const projectId = semanticScope.split(":")[1] ?? "";
      if (projectId.length === 0 || !store.projectIds.has(projectId)) {
        violations.push({
          ...base,
          code: "dangling_project_ref",
          detail: `semantic_scope 'project:${projectId}' references a project not registered in store '${store.alias}' (projects.json)`,
        });
      }
    }
  }
  return violations;
}
