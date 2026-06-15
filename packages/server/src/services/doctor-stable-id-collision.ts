import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  buildStoreResolveInput,
  createStoreResolver,
  type MountedStoreDir,
  type Translator,
  readKnowledgeAcrossStores,
  resolveGlobalRoot,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";

import type { DoctorCheck } from "./doctor.js";

// ---------------------------------------------------------------------------
// v2.2 Goal B (G-INTEGRITY) — doctor stable_id / layer integrity lints over the
// read-set stores. The post-decolo successors of the rc.4 read-side integrity
// checks (#19-20), rebuilt store-aware (the co-location `.fabric/knowledge`
// walkers are retired).
//
//   stable_id_collision  — the SAME store-qualified id (`<alias>:<local-id>`)
//                          declared by ≥2 files inside ONE store. Cross-store
//                          same-numbered local ids are EXPECTED (S61 — reads
//                          never merge identity), so the collision key is the
//                          STORE-QUALIFIED id, not the bare local id. Warning.
//   layer_mismatch       — a canonical entry whose stable_id layer prefix (KT- →
//                          team, KP- → personal) disagrees with the layer of the
//                          store it physically lives in. Manual error (the fix is
//                          rename + move, review-flow territory).
//
// Reads ONLY stores (the canonical post-decolo knowledge home). Pure read;
// never throws — a multi-store hiccup degrades to "no findings", never crashes
// doctor. `readKnowledgeAcrossStores` already excludes pending drafts (it walks
// the five canonical type dirs only), so the curated corpus is what is checked.
// ---------------------------------------------------------------------------

export type StableIdCollision = {
  // Store-qualified id (`<alias>:<local-id>`) declared by more than one file.
  stable_id: string;
  // Distinct per-store display paths of the colliding files.
  files: string[];
};

export interface StableIdCollisionInspection {
  collisions: StableIdCollision[];
}

type CanonicalLayer = "team" | "personal";

export type LayerMismatchEntry = {
  // Per-store display path of the misaligned file.
  path: string;
  // Layer of the store the file physically lives in.
  located_in: CanonicalLayer;
  // Layer the file's stable_id prefix declares it should live in.
  expected_layer: CanonicalLayer;
  // Local stable_id (e.g. "KP-DEC-0001").
  stable_id: string;
};

export interface LayerMismatchInspection {
  mismatches: LayerMismatchEntry[];
}

export interface StableIdIntegrityInspection {
  collision: StableIdCollisionInspection;
  layerMismatch: LayerMismatchInspection;
}

// Frontmatter `id:` line read (not full YAML) — mirrors the line-regex scanners
// in cross-store-recall / doctor-scope-lint.
const ID_LINE = /^id:\s*"?([^"\n]+?)"?\s*$/mu;

interface ResolvedStores {
  dirs: MountedStoreDir[];
  personalUuids: Set<string>;
}

// Resolve the project's read-set stores to on-disk dirs + the personal-uuid set
// (for layer derivation). null when there is no global config / no mounted store
// in the read-set (never throws).
function resolveIntegrityStores(projectRoot: string): ResolvedStores | null {
  const input = buildStoreResolveInput(projectRoot);
  if (input === null) {
    return null;
  }
  const readSet = createStoreResolver().resolveReadSet(input);
  if (readSet.stores.length === 0) {
    return null;
  }
  const personalUuids = new Set(
    input.mountedStores.filter((s) => s.personal).map((s) => s.store_uuid),
  );
  const globalRoot = resolveGlobalRoot();
  const dirs: MountedStoreDir[] = readSet.stores.map((entry) => {
    const mounted = input.mountedStores.find((s) => s.store_uuid === entry.store_uuid);
    return {
      store_uuid: entry.store_uuid,
      alias: entry.alias,
      dir: join(globalRoot, storeRelativePathForMount(mounted ?? { store_uuid: entry.store_uuid })),
    };
  });
  return { dirs, personalUuids };
}

const EMPTY_INTEGRITY: StableIdIntegrityInspection = {
  collision: { collisions: [] },
  layerMismatch: { mismatches: [] },
};

// Walk every canonical store entry once, computing both the stable_id collision
// groups and the layer-prefix mismatches in a single pass.
export async function inspectStoreStableIdIntegrity(
  projectRoot: string,
): Promise<StableIdIntegrityInspection> {
  const resolved = resolveIntegrityStores(projectRoot);
  if (resolved === null) {
    return EMPTY_INTEGRITY;
  }

  const qualifiedToFiles = new Map<string, string[]>();
  const mismatches: LayerMismatchEntry[] = [];

  for (const ref of await readKnowledgeAcrossStores(resolved.dirs)) {
    let source: string;
    try {
      source = await readFile(ref.file, "utf8");
    } catch {
      continue; // file vanished between walk and read — skip, never crash.
    }
    const id = ID_LINE.exec(source)?.[1];
    if (id === undefined) {
      continue; // no declared id → out of scope (other lints cover unparseable entries).
    }
    const qualifiedId = `${ref.alias}:${id}`;
    const display = `${ref.alias}:${ref.type}/${basename(ref.file)}`;

    const files = qualifiedToFiles.get(qualifiedId) ?? [];
    files.push(display);
    qualifiedToFiles.set(qualifiedId, files);

    const prefix = id.slice(0, 2);
    if (prefix === "KT" || prefix === "KP") {
      const expected_layer: CanonicalLayer = prefix === "KT" ? "team" : "personal";
      const located_in: CanonicalLayer = resolved.personalUuids.has(ref.store_uuid)
        ? "personal"
        : "team";
      if (expected_layer !== located_in) {
        mismatches.push({ path: display, located_in, expected_layer, stable_id: id });
      }
    }
  }

  const collisions: StableIdCollision[] = [];
  for (const [stable_id, files] of qualifiedToFiles) {
    if (files.length > 1) {
      collisions.push({ stable_id, files: files.slice().sort() });
    }
  }
  collisions.sort((a, b) => a.stable_id.localeCompare(b.stable_id));
  mismatches.sort((a, b) => a.path.localeCompare(b.path));

  return { collision: { collisions }, layerMismatch: { mismatches } };
}

export function createStableIdCollisionCheck(
  t: Translator,
  inspection: StableIdCollisionInspection,
): DoctorCheck {
  if (inspection.collisions.length === 0) {
    return {
      name: t("doctor.check.stable_id_collision.name"),
      status: "ok",
      message: t("doctor.check.stable_id_collision.ok"),
    };
  }
  const first = inspection.collisions[0];
  const count = inspection.collisions.length;
  return {
    name: t("doctor.check.stable_id_collision.name"),
    status: "warn",
    kind: "warning",
    code: "stable_id_collision",
    fixable: false,
    message: t(`doctor.check.stable_id_collision.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      stableId: first.stable_id,
      fileCount: String(first.files.length),
      files: first.files.join(", "),
    }),
    actionHint: t("doctor.check.stable_id_collision.remediation"),
  };
}

export function createLayerMismatchCheck(
  t: Translator,
  inspection: LayerMismatchInspection,
): DoctorCheck {
  if (inspection.mismatches.length === 0) {
    return {
      name: t("doctor.check.layer_mismatch.name"),
      status: "ok",
      message: t("doctor.check.layer_mismatch.ok"),
    };
  }
  const first = inspection.mismatches[0];
  const detail = `${first.stable_id} at ${first.path} (located in ${first.located_in}, expected ${first.expected_layer})`;
  const count = inspection.mismatches.length;
  return {
    name: t("doctor.check.layer_mismatch.name"),
    status: "error",
    kind: "manual_error",
    code: "knowledge_layer_mismatch",
    fixable: false,
    message: t(`doctor.check.layer_mismatch.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      detail,
    }),
    actionHint: t("doctor.check.layer_mismatch.remediation"),
  };
}
