import type { Translator } from "@fenglimg/fabric-shared";

import type { DoctorCheck } from "./doctor.js";

export type StableIdCollision = {
  stable_id: string;
  files: string[];
};

export type StableIdCollisionInspection = {
  collisions: StableIdCollision[];
};

export type StableIdDuplicateGroup = {
  stable_id: string;
  paths: string[];
};

export type StableIdDuplicateInspection = {
  duplicates: StableIdDuplicateGroup[];
};

type CanonicalLayer = "team" | "personal";

export type LayerMismatchEntry = {
  path: string;
  located_in: CanonicalLayer;
  expected_layer: CanonicalLayer;
  stable_id: string;
};

export type LayerMismatchInspection = {
  mismatches: LayerMismatchEntry[];
};

export function createStableIdCollisionCheck(
  t: Translator,
  inspection: StableIdCollisionInspection,
): DoctorCheck {
  if (inspection.collisions.length > 0) {
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
  return {
    name: t("doctor.check.stable_id_collision.name"),
    status: "ok",
    message: t("doctor.check.stable_id_collision.ok"),
  };
}

export function createStableIdDuplicateCheck(
  t: Translator,
  inspection: StableIdDuplicateInspection,
): DoctorCheck {
  if (inspection.duplicates.length === 0) {
    return {
      name: t("doctor.check.stable_id_duplicate.name"),
      status: "ok",
      message: t("doctor.check.stable_id_duplicate.ok"),
    };
  }
  const first = inspection.duplicates[0];
  const detail = `${first.stable_id} appears in ${first.paths.length} files: ${first.paths.join(", ")}`;
  const count = inspection.duplicates.length;
  return {
    name: t("doctor.check.stable_id_duplicate.name"),
    status: "error",
    kind: "manual_error",
    code: "knowledge_stable_id_duplicate",
    fixable: false,
    message: t(`doctor.check.stable_id_duplicate.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      detail,
    }),
    actionHint: t("doctor.check.stable_id_duplicate.remediation"),
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
