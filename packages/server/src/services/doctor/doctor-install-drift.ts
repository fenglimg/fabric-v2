import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  INSTALL_MANIFEST_REL,
  diffInstallManifest,
  hashInstalledFile,
  parseInstallManifest,
  type InstallCopyDrift,
  type Translator,
} from "@fenglimg/fabric-shared";

import type { DoctorCheck } from "../doctor-types.js";
import { issueCheck, okCheck } from "./doctor-check-helpers.js";

// ---------------------------------------------------------------------------
// install_copy_drift — do the installed copies still match what install wrote?
//
// The sibling `hooks_content_drift` check compares `.claude/` against
// `.codex/`, so it only fires when the two copies disagree with EACH OTHER.
// Both drifting together — which is what actually happens, since a stale
// install is stale on both sides — reads as healthy there. Comparing against
// the manifest install left behind is the only way to see it.
//
// This is the class behind KT-PIT-0056: a user whose install predates a fix
// commit runs the old hooks forever and reports the fixed bug as unfixed. The
// `fabric_version` in the manifest names that state directly.
//
// DETECTION ONLY, deliberately (KT-PIT-0016: a lint must not out-promise the
// --fix that would serve it). Restoring a drifted copy means re-copying from
// `packages/cli/templates/`, and `packages/server` has no dependency on the
// CLI package — it cannot reach those bytes. So this never reports
// `fixable_error`; the remediation is `fabric install`, which owns the
// templates and is idempotent.
// ---------------------------------------------------------------------------

export type InstallDriftStatus =
  /** Every manifest entry matches the bytes on disk. */
  | "ok"
  /** No manifest — a pre-manifest install, or never installed here. */
  | "no-manifest"
  /** Manifest present but not readable as a manifest of a known schema. */
  | "manifest-unreadable"
  /** At least one installed copy no longer matches. */
  | "drifted";

export type InstallDriftInspection = {
  status: InstallDriftStatus;
  /** CLI version recorded in the manifest; `null` when there is none to read. */
  fabricVersion: string | null;
  /** How many files the manifest vouches for. */
  tracked: number;
  drifts: InstallCopyDrift[];
};

export async function inspectInstallCopyDrift(
  projectRoot: string,
): Promise<InstallDriftInspection> {
  const absManifest = join(projectRoot, ...INSTALL_MANIFEST_REL.split("/"));
  let raw: string;
  try {
    raw = await readFile(absManifest, "utf8");
  } catch {
    return { status: "no-manifest", fabricVersion: null, tracked: 0, drifts: [] };
  }

  const manifest = parseInstallManifest(raw);
  if (manifest === null) {
    return { status: "manifest-unreadable", fabricVersion: null, tracked: 0, drifts: [] };
  }

  // `null` = gone, `undefined` = present but unreadable. diffInstallManifest
  // distinguishes the two so the report can say which happened.
  const actual: Record<string, string | null | undefined> = {};
  for (const rel of Object.keys(manifest.files)) {
    const abs = join(projectRoot, ...rel.split("/"));
    try {
      actual[rel] = hashInstalledFile(await readFile(abs));
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      actual[rel] = code === "ENOENT" ? null : undefined;
    }
  }

  const drifts = diffInstallManifest(manifest, actual);
  return {
    status: drifts.length > 0 ? "drifted" : "ok",
    fabricVersion: manifest.fabric_version,
    tracked: Object.keys(manifest.files).length,
    drifts,
  };
}

export function createInstallCopyDriftCheck(
  t: Translator,
  inspection: InstallDriftInspection,
): DoctorCheck {
  const name = t("doctor.check.install_copy_drift.name");

  if (inspection.status === "no-manifest") {
    return okCheck(name, t("doctor.check.install_copy_drift.ok.no_manifest"));
  }
  if (inspection.status === "manifest-unreadable") {
    return issueCheck(
      name,
      "warn",
      "warning",
      "install_manifest_unreadable",
      t("doctor.check.install_copy_drift.message.unreadable", { path: INSTALL_MANIFEST_REL }),
      t("doctor.check.install_copy_drift.remediation"),
    );
  }
  if (inspection.status === "ok") {
    return okCheck(
      name,
      t("doctor.check.install_copy_drift.ok.aligned", {
        count: String(inspection.tracked),
        version: inspection.fabricVersion ?? "unknown",
      }),
    );
  }

  const first = inspection.drifts[0];
  return issueCheck(
    name,
    "warn",
    "warning",
    "install_copy_drift",
    t("doctor.check.install_copy_drift.message.drifted", {
      count: String(inspection.drifts.length),
      tracked: String(inspection.tracked),
      version: inspection.fabricVersion ?? "unknown",
      first_path: first.path,
      first_kind: first.kind,
    }),
    t("doctor.check.install_copy_drift.remediation"),
  );
}
