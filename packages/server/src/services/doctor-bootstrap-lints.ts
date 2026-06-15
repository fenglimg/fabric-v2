import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  BOOTSTRAP_MARKER_BEGIN,
  BOOTSTRAP_MARKER_END,
  BOOTSTRAP_REGEX,
  matchBootstrapCanonicalLocale,
  resolveBootstrapCanonical,
  type Translator,
} from "@fenglimg/fabric-shared";

import type { DoctorCheck, DoctorIssueKind, DoctorStatus } from "./doctor.js";

export type BootstrapAnchorInspection = {
  hasAgentsMd: boolean;
  hasClaudeMd: boolean;
};

export type L1BootstrapSnapshotDriftInspection = {
  status: "ok" | "missing" | "drift";
  canonical: string;
  onDisk: string | null;
};

export type L2ManagedBlockDriftInspection = {
  status: "ok" | "drift" | "no-managed-block";
  drifted: Array<{ path: string; expected: string; actual: string }>;
};

function okCheck(name: string, message: string): DoctorCheck {
  return { name, status: "ok", message };
}

function issueCheck(
  name: string,
  status: DoctorStatus,
  kind: DoctorIssueKind,
  code: string,
  message: string,
  actionHint?: string,
): DoctorCheck {
  return {
    name,
    status,
    kind,
    code,
    fixable: kind === "fixable_error",
    message,
    actionHint,
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function inspectBootstrapAnchor(projectRoot: string): Promise<BootstrapAnchorInspection> {
  const [hasAgentsMd, hasClaudeMd] = await Promise.all([
    fileExists(join(projectRoot, "AGENTS.md")),
    fileExists(join(projectRoot, "CLAUDE.md")),
  ]);
  return { hasAgentsMd, hasClaudeMd };
}

export async function inspectL1BootstrapSnapshotDrift(
  target: string,
): Promise<L1BootstrapSnapshotDriftInspection> {
  const abs = join(target, ".fabric", "AGENTS.md");
  // Content-layer i18n: `canonical` reflects the machine's current language
  // flow (what `fabric install` / `--fix` would write here).
  const canonical = resolveBootstrapCanonical();
  let onDisk: string;
  try {
    onDisk = await readFile(abs, "utf8");
  } catch {
    return { status: "missing", canonical, onDisk: null };
  }
  // G-PARITY C2: tolerate a snapshot byte-equal to ANY locale's canonical body.
  // A machine-language switch (e.g. zh-CN → en) leaves an otherwise-canonical
  // snapshot written in the previous locale; that is a verbatim Fabric output,
  // not a hand-edit, so it must NOT be reported as drift. Only a body matching
  // no locale at all is genuine drift (hand-edit / corruption / stale schema).
  if (matchBootstrapCanonicalLocale(onDisk) !== null) {
    return { status: "ok", canonical, onDisk };
  }
  return { status: "drift", canonical, onDisk };
}

export function createL1BootstrapSnapshotDriftCheck(
  t: Translator,
  inspection: L1BootstrapSnapshotDriftInspection,
): DoctorCheck {
  if (inspection.status === "drift") {
    return issueCheck(
      t("doctor.check.bootstrap_snapshot_drift.name"),
      "error",
      "fixable_error",
      "bootstrap_snapshot_drift",
      t("doctor.check.bootstrap_snapshot_drift.message.drift"),
      t("doctor.check.bootstrap_snapshot_drift.remediation.drift"),
    );
  }
  return okCheck(
    t("doctor.check.bootstrap_snapshot_drift.name"),
    inspection.status === "ok"
      ? t("doctor.check.bootstrap_snapshot_drift.ok.ok")
      : t("doctor.check.bootstrap_snapshot_drift.ok.missing_delegated"),
  );
}

export async function inspectL2ManagedBlockDrift(
  target: string,
): Promise<L2ManagedBlockDriftInspection> {
  const snapshotPath = join(target, ".fabric", "AGENTS.md");
  let snapshot: string;
  try {
    snapshot = await readFile(snapshotPath, "utf8");
  } catch {
    return { status: "ok", drifted: [] };
  }
  const projectRulesPath = join(target, ".fabric", "project-rules.md");
  let expectedBody = snapshot;
  try {
    const projectRules = await readFile(projectRulesPath, "utf8");
    expectedBody = `${snapshot}\n---\n${projectRules}`;
  } catch {
    // Best-effort: project-rules.md is optional.
  }

  const drifted: Array<{ path: string; expected: string; actual: string }> = [];
  let anyManagedBlockFound = false;

  const blockTargets = [
    join(target, "AGENTS.md"),
    join(target, ".cursor", "rules", "fabric-bootstrap.mdc"),
  ];
  for (const abs of blockTargets) {
    let content: string;
    try {
      content = await readFile(abs, "utf8");
    } catch {
      continue;
    }
    const match = content.match(BOOTSTRAP_REGEX);
    if (match === null) {
      continue;
    }
    anyManagedBlockFound = true;
    const region = match[0];
    const beginIdx = region.indexOf(BOOTSTRAP_MARKER_BEGIN);
    const bodyStart = beginIdx + BOOTSTRAP_MARKER_BEGIN.length;
    const endIdx = region.indexOf(BOOTSTRAP_MARKER_END, bodyStart);
    if (bodyStart < 0 || endIdx < 0) {
      continue;
    }
    let body = region.slice(bodyStart, endIdx);
    if (body.startsWith("\n")) body = body.slice(1);
    if (body.endsWith("\n")) body = body.slice(0, -1);
    if (body !== expectedBody) {
      drifted.push({ path: abs, expected: expectedBody, actual: body });
    }
  }

  const claudeMdPath = join(target, "CLAUDE.md");
  try {
    const claudeContent = await readFile(claudeMdPath, "utf8");
    anyManagedBlockFound = true;
    const lines = claudeContent.split(/\r?\n/u);
    const hasAtImport = lines.some((line) => line.trim() === "@.fabric/AGENTS.md");
    if (!hasAtImport) {
      drifted.push({
        path: claudeMdPath,
        expected: "@.fabric/AGENTS.md",
        actual: "(line missing)",
      });
    }
  } catch {
    // Best-effort: missing CLAUDE.md is fine for this inspection.
  }

  if (!anyManagedBlockFound) {
    return { status: "no-managed-block", drifted: [] };
  }
  if (drifted.length === 0) {
    return { status: "ok", drifted: [] };
  }
  return { status: "drift", drifted };
}

export function createL2ManagedBlockDriftCheck(
  t: Translator,
  inspection: L2ManagedBlockDriftInspection,
): DoctorCheck {
  if (inspection.status === "drift") {
    const list = inspection.drifted.map((d) => d.path).join(", ");
    const count = inspection.drifted.length;
    return issueCheck(
      t("doctor.check.managed_block_drift.name"),
      "error",
      "fixable_error",
      "managed_block_drift",
      t(`doctor.check.managed_block_drift.message.${count === 1 ? "singular" : "plural"}`, {
        count: String(count),
        list,
      }),
      t("doctor.check.managed_block_drift.remediation"),
    );
  }
  return okCheck(
    t("doctor.check.managed_block_drift.name"),
    inspection.status === "ok"
      ? t("doctor.check.managed_block_drift.ok.ok")
      : t("doctor.check.managed_block_drift.ok.no_managed_block"),
  );
}

export function createBootstrapAnchorCheck(t: Translator, inspection: BootstrapAnchorInspection): DoctorCheck {
  if (!inspection.hasAgentsMd && !inspection.hasClaudeMd) {
    return issueCheck(
      t("doctor.check.bootstrap_anchor.name"),
      "error",
      "fixable_error",
      "bootstrap_anchor_missing",
      t("doctor.check.bootstrap_anchor.message.missing"),
      t("doctor.check.bootstrap_anchor.remediation.missing"),
    );
  }
  const present = [
    inspection.hasAgentsMd ? "AGENTS.md" : null,
    inspection.hasClaudeMd ? "CLAUDE.md" : null,
  ]
    .filter((entry): entry is string => entry !== null)
    .join(", ");
  return okCheck(
    t("doctor.check.bootstrap_anchor.name"),
    t("doctor.check.bootstrap_anchor.ok", { present }),
  );
}
