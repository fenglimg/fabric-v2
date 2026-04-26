import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, posix, resolve } from "node:path";

import {
  forensicReportSchema,
  ruleTestIndexSchema,
  type AgentsMeta,
  type AuditMode,
  type ForensicReport,
  type RuleTestIndex,
  type RuleTestLink,
  type RuleTestOrphanAnnotation,
} from "@fenglimg/fabric-shared";
import { detectFramework, type FrameworkInfo } from "@fenglimg/fabric-shared/node";

import { contextCache } from "../cache.js";
import { readAgentsMeta } from "../meta-reader.js";
import {
  DEFAULT_AUDIT_WINDOW_MS,
  findPrecedingGetRulesEvent,
  normalizeAuditPath,
  readAuditLog,
  type GetRulesAuditEntry,
  type RuleSelectionAuditEntry,
} from "./audit-log.js";
import { atomicWriteText } from "./_shared.js";
import { appendEventLedgerEvent } from "./event-ledger.js";
import { normalizeRulesPath } from "./get-rules.js";
import { readHumanLock } from "./read-human-lock.js";
import { migrateLegacyLedger, readLedger, resolveLedgerPaths } from "./read-ledger.js";
import { parseRuleSections } from "./rule-sections.js";
export { LEGACY_LEDGER_PATH, LEDGER_PATH, getLedgerPath } from "./_shared.js";

export type DoctorStatus = "ok" | "warn" | "error";

export type DoctorCheck = {
  name: string;
  status: DoctorStatus;
  message: string;
};

export type DoctorSummary = {
  target: string;
  framework: {
    kind: string;
    version: string;
    subkind: string;
  };
  entryPoints: Array<{
    path: string;
    reason: string;
  }>;
  driftCount: number;
  protectedPathCount: number;
  protectedPathsIntact: boolean;
  lastLedgerEntryTs: number | null;
  lastLedgerEntryAgeMs: number | null;
  metaRevision: string | null;
  ledgerPath: string;
  legacyLedgerPath: string;
  legacyLedgerDetected: boolean;
  businessLogicAnchors: BusinessLogicAnchorSummary | null;
  metaDriftDetails: MetaDriftDetail[];
  audit:
    | {
        enabled: boolean;
        mode: AuditMode;
        checkedPathCount: number;
        violationCount: number;
        windowMs: number;
      }
    | null;
};

export type DoctorReport = {
  status: DoctorStatus;
  checks: DoctorCheck[];
  summary: DoctorSummary;
  audit: DoctorAuditReport | null;
};

export type DoctorFixReport = {
  changed: boolean;
  migratedLedger: boolean;
  syncedBaseline: boolean;
  message: string;
  report: DoctorReport;
};

export type DoctorAuditViolation = {
  editTs: number;
  entryId: string;
  intent: string;
  lastRuleAccessTs: number | null;
  path: string;
};

export type DoctorAuditReport = {
  mode: AuditMode;
  skipped: boolean;
  windowMs: number;
  checkedPathCount: number;
  violationCount: number;
  violations: DoctorAuditViolation[];
};

export type BusinessLogicAnchorSummary = {
  chunkCount: number;
  anchorCount: number;
  missingCount: number;
  staleCount: number;
  duplicateCount: number;
};

export type BusinessLogicAnchorIssue = {
  kind: "missing" | "stale" | "duplicate";
  anchor?: string;
  chunk_id?: string;
  rule_path?: string;
  locations?: string[];
};

export type BusinessLogicAnchorSnapshot = BusinessLogicAnchorSummary & {
  issues: BusinessLogicAnchorIssue[];
};

export type MetaDriftDetail = {
  file: string;
  stable_id: string;
  expected_hash: string;
  actual_hash: string | null;
};

type EntryPoint = DoctorSummary["entryPoints"][number];
type RuleAccessAuditEntry = GetRulesAuditEntry | RuleSelectionAuditEntry;

type SavedForensic =
  | {
      present: true;
      report: ForensicReport;
    }
  | {
      present: false;
      reason: string;
    };

type MetaDriftResult =
  | {
      present: true;
      revision: string;
      liveRevision: string;
      nodeCount: number;
      driftCount: number;
      missingFiles: string[];
      staleFiles: string[];
      driftedStableIds: string[];
      details: MetaDriftDetail[];
      derivedIdentityFiles: string[];
      unexpectedError?: undefined;
    }
  | {
      present: false;
      revision: null;
      liveRevision: null;
      nodeCount: 0;
      driftCount: 0;
      missingFiles: string[];
      staleFiles: string[];
      driftedStableIds: string[];
      details: MetaDriftDetail[];
      derivedIdentityFiles: string[];
      unexpectedError?: string;
    };

type HumanLockSnapshot =
  | {
      present: true;
      driftCount: number;
      protectedPathCount: number;
    }
  | {
      present: false;
      driftCount: 0;
      protectedPathCount: 0;
      reason: string;
    };

type LedgerSnapshot = {
  count: number;
  lastEntryTs: number | null;
  lastEntryAgeMs: number | null;
  primaryPath: string;
  legacyPath: string;
  usingLegacy: boolean;
};

type RuleTestContractIssueKind =
  | "stale_rule"
  | "stale_test"
  | "orphan"
  | "missing_test_file"
  | "missing_coverage";

type RuleTestContractIssue = {
  kind: RuleTestContractIssueKind;
  rule_stable_id: string;
  rule_file?: string;
  test_file?: string;
  annotation_line?: number;
  expected_hash?: string;
  actual_hash?: string | null;
};

type RuleTestContractsSnapshot =
  | {
      present: false;
      reason: string;
    }
  | {
      present: true;
      revision: string | undefined;
      ruleCount: number;
      linkCount: number;
      coveredCount: number;
      staleRuleCount: number;
      staleTestCount: number;
      orphanCount: number;
      missingTestFileCount: number;
      missingCoverageCount: number;
      issues: RuleTestContractIssue[];
    };

const SCRIPT_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const IGNORED_DIRECTORIES = new Set([
  ".fabric",
  ".git",
  ".next",
  ".turbo",
  "Library",
  "Temp",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);
const LEDGER_WARN_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const LEDGER_ERROR_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export async function runDoctorReport(target: string): Promise<DoctorReport> {
  const projectRoot = normalizeTarget(target);
  const framework = detectFramework(projectRoot);
  const entryPoints = collectEntryPoints(projectRoot);

  const [
    savedForensic,
    metaSnapshot,
    humanLockSnapshot,
    ledgerSnapshot,
    auditReport,
    businessLogicAnchorSnapshot,
    ruleTestContractsSnapshot,
  ] = await Promise.all([
    readSavedForensic(projectRoot),
    inspectMetaRevision(projectRoot),
    inspectHumanLock(projectRoot),
    inspectLedger(projectRoot),
    runDoctorAuditReport(projectRoot),
    inspectBusinessLogicAnchors(projectRoot),
    inspectRuleTestContracts(projectRoot),
  ]);

  const checks: DoctorCheck[] = [
    createForensicCheck(savedForensic, framework, entryPoints),
    createFrameworkCheck(savedForensic, framework, entryPoints),
    createMetaRevisionCheck(metaSnapshot),
    createProtectedPathsCheck(humanLockSnapshot),
    createLedgerCheck(ledgerSnapshot),
    createRuleTestContractsCheck(ruleTestContractsSnapshot),
  ];

  if (!auditReport.skipped) {
    checks.push(createAuditCheck(auditReport));
  }

  if (businessLogicAnchorSnapshot !== null) {
    checks.push(createBusinessLogicAnchorCheck(businessLogicAnchorSnapshot));
  }

  return {
    status: reduceStatus(checks.map((check) => check.status)),
    checks,
    summary: {
      target: projectRoot,
      framework: {
        kind: framework.kind,
        version: framework.version,
        subkind: framework.subkind,
      },
      entryPoints,
      driftCount: humanLockSnapshot.driftCount,
      protectedPathCount: humanLockSnapshot.protectedPathCount,
      protectedPathsIntact:
        humanLockSnapshot.present && humanLockSnapshot.driftCount === 0,
      lastLedgerEntryTs: ledgerSnapshot.lastEntryTs,
      lastLedgerEntryAgeMs: ledgerSnapshot.lastEntryAgeMs,
      metaRevision: metaSnapshot.revision,
      ledgerPath: ledgerSnapshot.primaryPath,
      legacyLedgerPath: ledgerSnapshot.legacyPath,
      legacyLedgerDetected: ledgerSnapshot.usingLegacy,
      businessLogicAnchors: businessLogicAnchorSnapshot === null
        ? null
        : {
            chunkCount: businessLogicAnchorSnapshot.chunkCount,
            anchorCount: businessLogicAnchorSnapshot.anchorCount,
            missingCount: businessLogicAnchorSnapshot.missingCount,
            staleCount: businessLogicAnchorSnapshot.staleCount,
            duplicateCount: businessLogicAnchorSnapshot.duplicateCount,
          },
      metaDriftDetails: metaSnapshot.present ? metaSnapshot.details : [],
      audit: auditReport.skipped
        ? null
        : {
            enabled: true,
            mode: auditReport.mode,
            checkedPathCount: auditReport.checkedPathCount,
            violationCount: auditReport.violationCount,
            windowMs: auditReport.windowMs,
          },
    },
    audit: auditReport.skipped ? null : auditReport,
  };
}

export async function runDoctorFix(target: string): Promise<DoctorFixReport> {
  const projectRoot = normalizeTarget(target);
  const migration = await migrateLegacyLedger(projectRoot);
  const sync = await syncExistingMetaBaseline(projectRoot, "doctor_fix");
  const report = await runDoctorReport(projectRoot);
  const messages = [
    migration.migrated
      ? `Migrated legacy ledger from ${migration.from} to ${migration.to}.`
      : `No legacy ledger migration needed. Canonical ledger path: ${migration.to}.`,
    sync.synced
      ? `Accepted rule baseline ${sync.previousRevision} -> ${sync.revision}.`
      : "No rule baseline sync needed.",
  ];

  return {
    changed: migration.migrated || sync.synced,
    migratedLedger: migration.migrated,
    syncedBaseline: sync.synced,
    message: messages.join(" "),
    report,
  };
}

export async function runDoctorAuditReport(
  target: string,
  options: {
    force?: boolean;
    mode?: AuditMode;
    windowMs?: number;
  } = {},
): Promise<DoctorAuditReport> {
  const projectRoot = normalizeTarget(target);
  const mode = options.mode ?? readDoctorAuditMode(projectRoot);
  const windowMs = options.windowMs ?? DEFAULT_AUDIT_WINDOW_MS;

  if (mode === "off" && options.force !== true) {
    return {
      mode,
      skipped: true,
      windowMs,
      checkedPathCount: 0,
      violationCount: 0,
      violations: [],
    };
  }

  const [ledgerEntries, auditEntries] = await Promise.all([
    readLedger(projectRoot, { source: "ai" }),
    readAuditLog(projectRoot),
  ]);
  const ruleAccessEntries = auditEntries.filter(
    (entry): entry is RuleAccessAuditEntry => entry.event === "get_rules" || entry.event === "rule_selection",
  );
  const { checkedPathCount, violations } = collectAuditViolations(
    projectRoot,
    ledgerEntries,
    ruleAccessEntries,
    windowMs,
  );

  return {
    mode,
    skipped: false,
    windowMs,
    checkedPathCount,
    violationCount: violations.length,
    violations,
  };
}

function createForensicCheck(
  forensic: SavedForensic,
  framework: FrameworkInfo,
  entryPoints: EntryPoint[],
): DoctorCheck {
  if (!forensic.present) {
    return {
      name: "Forensic snapshot",
      status: "error",
      message: `${forensic.reason} Live scan detects ${formatFramework(framework)} with ${entryPoints.length} entry point${entryPoints.length === 1 ? "" : "s"}.`,
    };
  }

  return {
    name: "Forensic snapshot",
    status: "ok",
    message: `Loaded .fabric/forensic.json for ${formatFramework(forensic.report.framework)} with ${forensic.report.entry_points.length} recorded entry point${forensic.report.entry_points.length === 1 ? "" : "s"}.`,
  };
}

function createFrameworkCheck(
  forensic: SavedForensic,
  framework: FrameworkInfo,
  entryPoints: EntryPoint[],
): DoctorCheck {
  if (framework.kind === "unknown") {
    return {
      name: "Framework fingerprint",
      status: "warn",
      message: "Unable to identify the project framework from current files.",
    };
  }

  if (!forensic.present) {
    return {
      name: "Framework fingerprint",
      status: "warn",
      message: `Live detection sees ${formatFramework(framework)} and ${entryPoints.length} entry point${entryPoints.length === 1 ? "" : "s"}, but no forensic baseline exists yet.`,
    };
  }

  const matches =
    forensic.report.framework.kind === framework.kind &&
    forensic.report.framework.version === framework.version &&
    forensic.report.framework.subkind === framework.subkind;

  if (!matches) {
    return {
      name: "Framework fingerprint",
      status: "warn",
      message: `Forensic baseline says ${formatFramework(forensic.report.framework)}; live scan says ${formatFramework(framework)}.`,
    };
  }

  return {
    name: "Framework fingerprint",
    status: "ok",
    message: `Framework baseline matches live scan: ${formatFramework(framework)} · ${entryPoints.length} current entry point${entryPoints.length === 1 ? "" : "s"}.`,
  };
}

function createMetaRevisionCheck(snapshot: MetaDriftResult): DoctorCheck {
  if (!snapshot.present) {
    return {
      name: "Meta revision",
      status: "error",
      message: snapshot.unexpectedError ?? "agents.meta.json is missing.",
    };
  }

  if (snapshot.driftCount > 0 || snapshot.missingFiles.length > 0) {
    const parts = [
      `${snapshot.driftCount} tracked AGENTS file drift`,
      snapshot.missingFiles.length > 0 ? `${snapshot.missingFiles.length} missing tracked file` : null,
    ].filter((part) => part !== null);
    const examples = snapshot.details.slice(0, 3).map(formatMetaDriftDetail).join("; ");
    const suffix = snapshot.details.length > 3 ? `; +${snapshot.details.length - 3} more` : "";
    const detailText = examples.length > 0 ? ` Details: ${examples}${suffix}.` : "";

    return {
      name: "Meta revision",
      status: "error",
      message: `agents.meta.json revision ${snapshot.revision} is stale: ${parts.join(" · ")}.${detailText}`,
    };
  }

  if (snapshot.derivedIdentityFiles.length > 0) {
    const [firstFile] = snapshot.derivedIdentityFiles;
    const suffix = snapshot.derivedIdentityFiles.length > 1 ? ` (+${snapshot.derivedIdentityFiles.length - 1} more)` : "";

    return {
      name: "Meta revision",
      status: "warn",
      message:
        `agents.meta.json revision ${snapshot.revision} matches ${snapshot.nodeCount} tracked AGENTS files, ` +
        `but ${snapshot.derivedIdentityFiles.length} rule node${snapshot.derivedIdentityFiles.length === 1 ? "" : "s"} ` +
        `still use derived identities. Add \`<!-- fab:rule-id ... -->\` to the rule file header instead of editing meta directly ` +
        `(${firstFile}${suffix}).`,
    };
  }

  return {
    name: "Meta revision",
    status: "ok",
    message: `agents.meta.json revision ${snapshot.revision} matches ${snapshot.nodeCount} tracked AGENTS file${snapshot.nodeCount === 1 ? "" : "s"}.`,
  };
}

function createProtectedPathsCheck(snapshot: HumanLockSnapshot): DoctorCheck {
  if (!snapshot.present) {
    return {
      name: "Protected paths",
      status: "warn",
      message: snapshot.reason,
    };
  }

  if (snapshot.driftCount > 0) {
    return {
      name: "Protected paths",
      status: "warn",
      message: `${snapshot.driftCount} of ${snapshot.protectedPathCount} protected path${snapshot.protectedPathCount === 1 ? "" : "s"} drifted from approved hashes.`,
    };
  }

  return {
    name: "Protected paths",
    status: "ok",
    message: `${snapshot.protectedPathCount} protected path${snapshot.protectedPathCount === 1 ? "" : "s"} intact with zero hash drift.`,
  };
}

function createLedgerCheck(snapshot: LedgerSnapshot): DoctorCheck {
  if (snapshot.usingLegacy) {
    return {
      name: "Intent ledger",
      status: "warn",
      message: `Legacy ledger path detected at ${snapshot.legacyPath}. Fabric now reads ${snapshot.primaryPath} by default; run fab doctor --fix to migrate.`,
    };
  }

  if (snapshot.lastEntryTs === null || snapshot.lastEntryAgeMs === null) {
    return {
      name: "Intent ledger",
      status: "warn",
      message: "No ledger entries recorded yet.",
    };
  }

  if (snapshot.lastEntryAgeMs >= LEDGER_ERROR_AFTER_MS) {
    return {
      name: "Intent ledger",
      status: "error",
      message: `Last ledger entry is ${formatAge(snapshot.lastEntryAgeMs)} old (${new Date(snapshot.lastEntryTs).toISOString()}).`,
    };
  }

  if (snapshot.lastEntryAgeMs >= LEDGER_WARN_AFTER_MS) {
    return {
      name: "Intent ledger",
      status: "warn",
      message: `Last ledger entry is ${formatAge(snapshot.lastEntryAgeMs)} old (${new Date(snapshot.lastEntryTs).toISOString()}).`,
    };
  }

  return {
    name: "Intent ledger",
    status: "ok",
    message: `Last ledger entry is ${formatAge(snapshot.lastEntryAgeMs)} old (${snapshot.count} total entr${snapshot.count === 1 ? "y" : "ies"}).`,
  };
}

function createRuleTestContractsCheck(snapshot: RuleTestContractsSnapshot): DoctorCheck {
  if (!snapshot.present) {
    return {
      name: "Rule-test contracts",
      status: "warn",
      message: snapshot.reason,
    };
  }

  if (snapshot.issues.length === 0) {
    if (snapshot.ruleCount === 0) {
      return {
        name: "Rule-test contracts",
        status: "ok",
        message: "No rule nodes are tracked; static rule-test coverage has nothing to inspect.",
      };
    }

    return {
      name: "Rule-test contracts",
      status: "ok",
      message:
        `${snapshot.coveredCount} of ${snapshot.ruleCount} rule${snapshot.ruleCount === 1 ? "" : "s"} have static rule-test coverage ` +
        `across ${snapshot.linkCount} link${snapshot.linkCount === 1 ? "" : "s"}.`,
    };
  }

  const parts = [
    snapshot.staleRuleCount > 0 ? `${snapshot.staleRuleCount} stale_rule` : null,
    snapshot.staleTestCount > 0 ? `${snapshot.staleTestCount} stale_test` : null,
    snapshot.orphanCount > 0 ? `${snapshot.orphanCount} orphan` : null,
    snapshot.missingTestFileCount > 0 ? `${snapshot.missingTestFileCount} missing_test_file` : null,
    snapshot.missingCoverageCount > 0 ? `${snapshot.missingCoverageCount} missing_coverage` : null,
  ].filter((part) => part !== null);
  const examples = snapshot.issues.slice(0, 3).map(formatRuleTestContractIssue).join("; ");
  const suffix = snapshot.issues.length > 3 ? `; +${snapshot.issues.length - 3} more` : "";

  return {
    name: "Rule-test contracts",
    status: "warn",
    message:
      `Static rule-test coverage has ${parts.join(", ")} issue${snapshot.issues.length === 1 ? "" : "s"} ` +
      `(${snapshot.coveredCount}/${snapshot.ruleCount} covered): ${examples}${suffix}.`,
  };
}

function createAuditCheck(report: DoctorAuditReport): DoctorCheck {
  if (report.checkedPathCount === 0) {
    return {
      name: "Rules fetch audit",
      status: "warn",
      message: "No AI edit intents recorded yet for compliance audit.",
    };
  }

  if (report.violationCount > 0) {
    return {
      name: "Rules fetch audit",
      status: report.mode === "strict" ? "error" : "warn",
      message: `${report.violationCount} edit path${report.violationCount === 1 ? "" : "s"} lack a preceding rule_selection or get_rules event within ${formatDuration(report.windowMs)}.`,
    };
  }

  return {
    name: "Rules fetch audit",
    status: "ok",
    message: `All ${report.checkedPathCount} audited edit path${report.checkedPathCount === 1 ? "" : "s"} have a preceding rule_selection or get_rules event within ${formatDuration(report.windowMs)}.`,
  };
}

function createBusinessLogicAnchorCheck(snapshot: BusinessLogicAnchorSnapshot): DoctorCheck {
  if (snapshot.chunkCount === 0) {
    return {
      name: "Business logic anchors",
      status: "ok",
      message: "No BUSINESS_LOGIC_CHUNKS anchors declared.",
    };
  }

  if (snapshot.issues.length === 0) {
    return {
      name: "Business logic anchors",
      status: "ok",
      message:
        `${snapshot.chunkCount} business logic chunk${snapshot.chunkCount === 1 ? "" : "s"} ` +
        `resolved to ${snapshot.anchorCount} source anchor${snapshot.anchorCount === 1 ? "" : "s"}.`,
    };
  }

  const parts = [
    snapshot.missingCount > 0 ? `${snapshot.missingCount} missing` : null,
    snapshot.staleCount > 0 ? `${snapshot.staleCount} stale` : null,
    snapshot.duplicateCount > 0 ? `${snapshot.duplicateCount} duplicate` : null,
  ].filter((part) => part !== null);
  const examples = snapshot.issues.slice(0, 3).map(formatBusinessLogicAnchorIssue).join("; ");
  const suffix = snapshot.issues.length > 3 ? `; +${snapshot.issues.length - 3} more` : "";

  return {
    name: "Business logic anchors",
    status: "warn",
    message: `${parts.join(", ")} BUSINESS_LOGIC_CHUNKS anchor issue${snapshot.issues.length === 1 ? "" : "s"}: ${examples}${suffix}.`,
  };
}

function formatBusinessLogicAnchorIssue(issue: BusinessLogicAnchorIssue): string {
  if (issue.kind === "missing") {
    return `${issue.rule_path ?? "unknown rule"}:${issue.chunk_id ?? "unknown chunk"} missing Anchor`;
  }

  if (issue.kind === "stale") {
    return `${issue.anchor ?? "unknown anchor"} not found`;
  }

  return `${issue.anchor ?? "unknown anchor"} duplicated at ${(issue.locations ?? []).join(", ")}`;
}

function formatMetaDriftDetail(detail: MetaDriftDetail): string {
  const actualHash = detail.actual_hash ?? "<missing>";
  return `${detail.file} (${detail.stable_id}) expected ${detail.expected_hash} actual ${actualHash}`;
}

function formatRuleTestContractIssue(issue: RuleTestContractIssue): string {
  if (issue.kind === "missing_coverage") {
    return `${issue.rule_stable_id} missing_coverage`;
  }

  if (issue.kind === "orphan") {
    const location = issue.test_file === undefined ? "" : ` at ${issue.test_file}:${issue.annotation_line ?? "?"}`;
    return `${issue.rule_stable_id} orphan${location}`;
  }

  if (issue.kind === "missing_test_file") {
    return `${issue.rule_stable_id} missing_test_file ${issue.test_file ?? "<unknown>"}`;
  }

  const actualHash = issue.actual_hash ?? "<missing>";
  const target = issue.kind === "stale_rule" ? issue.rule_file : issue.test_file;
  return `${issue.rule_stable_id} ${issue.kind} ${target ?? "<unknown>"} expected ${issue.expected_hash ?? "<unknown>"} actual ${actualHash}`;
}

async function readSavedForensic(projectRoot: string): Promise<SavedForensic> {
  const forensicPath = join(projectRoot, ".fabric", "forensic.json");

  try {
    const raw = await readFile(forensicPath, "utf8");
    const parsed = forensicReportSchema.safeParse(JSON.parse(raw));

    if (!parsed.success) {
      return {
        present: false,
        reason: "forensic.json is invalid.",
      };
    }

    return {
      present: true,
      report: parsed.data,
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        present: false,
        reason: ".fabric/forensic.json is missing.",
      };
    }

    return {
      present: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function inspectMetaRevision(projectRoot: string): Promise<MetaDriftResult> {
  try {
    const meta = await readAgentsMeta(projectRoot);
    const entries = Object.entries(meta.nodes).sort(([left], [right]) => left.localeCompare(right));
    const missingFiles: string[] = [];
    const staleFiles: string[] = [];
    const driftedStableIds: string[] = [];
    const details: MetaDriftDetail[] = [];
    const derivedIdentityFiles: string[] = [];
    let driftCount = 0;

    const revisionSource = entries
      .map(([id, node]) => {
        const absolutePath = join(projectRoot, node.file);

        if (!existsSync(absolutePath)) {
          missingFiles.push(node.file);
          driftedStableIds.push(node.stable_id ?? id);
          details.push({
            file: node.file,
            stable_id: node.stable_id ?? id,
            expected_hash: node.hash,
            actual_hash: null,
          });
          driftCount += 1;
          return "missing";
        }

        const actualHash = sha256(readFileSync(absolutePath, "utf8"));
        if (actualHash !== node.hash) {
          staleFiles.push(node.file);
          driftedStableIds.push(node.stable_id ?? id);
          details.push({
            file: node.file,
            stable_id: node.stable_id ?? id,
            expected_hash: node.hash,
            actual_hash: actualHash,
          });
          driftCount += 1;
        }

        if (node.file !== ".fabric/bootstrap/README.md" && node.identity_source !== "declared") {
          derivedIdentityFiles.push(node.file);
        }

        return [id, actualHash, node.stable_id ?? "", node.identity_source ?? ""].join("|");
      })
      .join("\n");

    const revision = sha256(revisionSource);
    const revisionDrift = revision !== meta.revision;

    return {
      present: true,
      revision: meta.revision,
      liveRevision: revision,
      nodeCount: entries.length,
      driftCount: revisionDrift && driftCount === 0 ? 1 : driftCount,
      missingFiles,
      staleFiles,
      driftedStableIds: dedupeStrings(driftedStableIds),
      details,
      derivedIdentityFiles,
    };
  } catch (error) {
    return {
      present: false,
      revision: null,
      liveRevision: null,
      nodeCount: 0,
      driftCount: 0,
      missingFiles: [],
      staleFiles: [],
      driftedStableIds: [],
      details: [],
      derivedIdentityFiles: [],
      unexpectedError: error instanceof Error ? error.message : String(error),
    };
  }
}

type BaselineSyncSource = "doctor_fix" | "sync_meta";

type BaselineSyncResult = {
  synced: boolean;
  previousRevision: string | undefined;
  revision: string | undefined;
  syncedFiles: string[];
  acceptedStableIds: string[];
};

export async function syncExistingMetaBaseline(
  target: string,
  source: BaselineSyncSource = "sync_meta",
): Promise<BaselineSyncResult> {
  const projectRoot = normalizeTarget(target);
  const snapshot = await inspectMetaRevision(projectRoot);

  if (!snapshot.present) {
    return {
      synced: false,
      previousRevision: undefined,
      revision: undefined,
      syncedFiles: [],
      acceptedStableIds: [],
    };
  }

  const meta = await readAgentsMeta(projectRoot);

  if (snapshot.details.length === 0 || snapshot.missingFiles.length > 0) {
    return {
      synced: false,
      previousRevision: meta.revision,
      revision: snapshot.liveRevision,
      syncedFiles: [],
      acceptedStableIds: [],
    };
  }

  await appendRuleDriftDetectedEvent(projectRoot, snapshot);

  const nextMeta = acceptExistingMetaDrift(meta, snapshot.details);
  const nextRevision = computeMetaRevision(nextMeta.nodes);
  const metaPath = join(projectRoot, ".fabric", "agents.meta.json");

  await atomicWriteText(metaPath, `${JSON.stringify({ ...nextMeta, revision: nextRevision }, null, 2)}\n`);
  contextCache.invalidate("meta_write", projectRoot);

  await appendBaselineEvents(projectRoot, {
    source,
    previousRevision: meta.revision,
    revision: nextRevision,
    syncedFiles: snapshot.staleFiles,
    acceptedStableIds: snapshot.driftedStableIds,
  });

  return {
    synced: true,
    previousRevision: meta.revision,
    revision: nextRevision,
    syncedFiles: snapshot.staleFiles,
    acceptedStableIds: snapshot.driftedStableIds,
  };
}

export async function recordBaselineSynced(
  target: string,
  input: {
    previousRevision?: string;
    revision: string;
    syncedFiles: string[];
    acceptedStableIds: string[];
    driftDetails?: MetaDriftDetail[];
    source?: BaselineSyncSource;
  },
): Promise<void> {
  const projectRoot = normalizeTarget(target);
  const driftDetails = input.driftDetails ?? [];

  if (driftDetails.length > 0) {
    await appendRuleDriftDetectedEvent(projectRoot, {
      present: true,
      revision: input.previousRevision ?? input.revision,
      liveRevision: input.revision,
      nodeCount: input.acceptedStableIds.length,
      driftCount: driftDetails.length,
      missingFiles: driftDetails.filter((detail) => detail.actual_hash === null).map((detail) => detail.file),
      staleFiles: driftDetails.filter((detail) => detail.actual_hash !== null).map((detail) => detail.file),
      driftedStableIds: driftDetails.map((detail) => detail.stable_id),
      details: driftDetails,
      derivedIdentityFiles: [],
    });
  }

  await appendBaselineEvents(projectRoot, {
    source: input.source ?? "sync_meta",
    previousRevision: input.previousRevision,
    revision: input.revision,
    syncedFiles: input.syncedFiles,
    acceptedStableIds: input.acceptedStableIds,
  });
}

function acceptExistingMetaDrift(meta: AgentsMeta, details: MetaDriftDetail[]): AgentsMeta {
  const actualHashesByFile = new Map(
    details
      .filter((detail): detail is MetaDriftDetail & { actual_hash: string } => detail.actual_hash !== null)
      .map((detail) => [detail.file, detail.actual_hash]),
  );
  const nodes = Object.fromEntries(
    Object.entries(meta.nodes).map(([id, node]) => [
      id,
      {
        ...node,
        hash: actualHashesByFile.get(node.file) ?? node.hash,
      },
    ]),
  );

  return {
    ...meta,
    nodes,
  };
}

function computeMetaRevision(nodes: AgentsMeta["nodes"]): string {
  const revisionSource = Object.entries(nodes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, node]) => [id, node.hash, node.stable_id ?? "", node.identity_source ?? ""].join("|"))
    .join("\n");

  return sha256(revisionSource);
}

async function appendRuleDriftDetectedEvent(
  projectRoot: string,
  snapshot: Extract<MetaDriftResult, { present: true }>,
): Promise<void> {
  if (snapshot.driftedStableIds.length === 0 && snapshot.missingFiles.length === 0 && snapshot.staleFiles.length === 0) {
    return;
  }

  await appendEventLedgerEvent(projectRoot, {
    event_type: "rule_drift_detected",
    revision: snapshot.revision,
    drifted_stable_ids: snapshot.driftedStableIds,
    missing_files: snapshot.missingFiles,
    stale_files: snapshot.staleFiles,
    details: snapshot.details,
  });
}

async function appendBaselineEvents(
  projectRoot: string,
  input: {
    source: BaselineSyncSource;
    previousRevision?: string;
    revision: string;
    syncedFiles: string[];
    acceptedStableIds: string[];
  },
): Promise<void> {
  await appendEventLedgerEvent(projectRoot, {
    event_type: "rule_baseline_accepted",
    revision: input.revision,
    previous_revision: input.previousRevision,
    accepted_stable_ids: input.acceptedStableIds,
    source: input.source,
  });
  await appendEventLedgerEvent(projectRoot, {
    event_type: "baseline_synced",
    revision: input.revision,
    previous_revision: input.previousRevision,
    synced_files: input.syncedFiles,
    accepted_stable_ids: input.acceptedStableIds,
    source: input.source,
  });
}

async function inspectHumanLock(projectRoot: string): Promise<HumanLockSnapshot> {
  try {
    const entries = await readHumanLock(projectRoot);

    return {
      present: true,
      driftCount: entries.filter((entry) => entry.drift).length,
      protectedPathCount: entries.length,
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        present: false,
        driftCount: 0,
        protectedPathCount: 0,
        reason: ".fabric/human-lock.json is missing; no protected paths are being tracked.",
      };
    }

    return {
      present: false,
      driftCount: 0,
      protectedPathCount: 0,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function inspectLedger(projectRoot: string): Promise<LedgerSnapshot> {
  const paths = await resolveLedgerPaths(projectRoot);
  const entries = await readLedger(projectRoot);
  const lastEntry = entries.reduce<number | null>(
    (latest, entry) => (latest === null || entry.ts > latest ? entry.ts : latest),
    null,
  );

  return {
    count: entries.length,
    lastEntryTs: lastEntry,
    lastEntryAgeMs: lastEntry === null ? null : Math.max(Date.now() - lastEntry, 0),
    primaryPath: paths.primaryPath,
    legacyPath: paths.legacyPath,
    usingLegacy: paths.usingLegacy,
  };
}

async function inspectBusinessLogicAnchors(projectRoot: string): Promise<BusinessLogicAnchorSnapshot | null> {
  let meta;
  try {
    meta = await readAgentsMeta(projectRoot);
  } catch {
    return null;
  }

  const chunks = collectBusinessLogicChunks(projectRoot, meta);
  const sourceAnchors = collectSourceAnchors(projectRoot);
  const issues: BusinessLogicAnchorIssue[] = [];
  const chunkAnchorCount = chunks.filter((chunk) => chunk.anchor !== undefined).length;
  const referencedAnchors = new Set(
    chunks.flatMap((chunk) => (chunk.anchor === undefined ? [] : [chunk.anchor])),
  );

  for (const chunk of chunks) {
    if (chunk.anchor === undefined) {
      issues.push({
        kind: "missing",
        chunk_id: chunk.id,
        rule_path: chunk.rulePath,
      });
      continue;
    }

    const locations = sourceAnchors.get(chunk.anchor) ?? [];
    if (locations.length === 0) {
      issues.push({
        kind: "stale",
        anchor: chunk.anchor,
        chunk_id: chunk.id,
        rule_path: chunk.rulePath,
      });
    }
  }

  for (const [anchor, locations] of sourceAnchors) {
    if (!referencedAnchors.has(anchor) || locations.length <= 1) {
      continue;
    }

    issues.push({
      kind: "duplicate",
      anchor,
      locations,
    });
  }

  return {
    chunkCount: chunks.length,
    anchorCount: chunkAnchorCount,
    missingCount: issues.filter((issue) => issue.kind === "missing").length,
    staleCount: issues.filter((issue) => issue.kind === "stale").length,
    duplicateCount: issues.filter((issue) => issue.kind === "duplicate").length,
    issues,
  };
}

async function inspectRuleTestContracts(projectRoot: string): Promise<RuleTestContractsSnapshot> {
  let meta: AgentsMeta;
  try {
    meta = await readAgentsMeta(projectRoot);
  } catch (error) {
    return {
      present: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const indexPath = join(projectRoot, ".fabric", "rule-test.index.json");
  let index: RuleTestIndex;
  try {
    const raw = await readFile(indexPath, "utf8");
    index = ruleTestIndexSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        present: false,
        reason: ".fabric/rule-test.index.json is missing; run sync-meta to generate static rule-test coverage.",
      };
    }

    return {
      present: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const ruleNodesByStableId = collectRuleNodesByStableId(meta);
  const coveredStableIds = new Set<string>();
  const issues: RuleTestContractIssue[] = [];

  for (const link of index.links) {
    const ruleNode = ruleNodesByStableId.get(link.rule_stable_id);
    if (ruleNode === undefined) {
      issues.push(createOrphanIssue(link));
      continue;
    }

    coveredStableIds.add(link.rule_stable_id);

    if (ruleNode.hash !== link.rule_hash) {
      issues.push({
        kind: "stale_rule",
        rule_stable_id: link.rule_stable_id,
        rule_file: ruleNode.file,
        test_file: link.test_file,
        annotation_line: link.annotation_line,
        expected_hash: link.rule_hash,
        actual_hash: ruleNode.hash,
      });
    }

    const testPath = join(projectRoot, link.test_file);
    if (!existsSync(testPath)) {
      issues.push({
        kind: "missing_test_file",
        rule_stable_id: link.rule_stable_id,
        rule_file: ruleNode.file,
        test_file: link.test_file,
        annotation_line: link.annotation_line,
        expected_hash: link.test_hash,
        actual_hash: null,
      });
      continue;
    }

    const actualTestHash = sha256(readFileSync(testPath, "utf8"));
    if (actualTestHash !== link.test_hash) {
      issues.push({
        kind: "stale_test",
        rule_stable_id: link.rule_stable_id,
        rule_file: ruleNode.file,
        test_file: link.test_file,
        annotation_line: link.annotation_line,
        expected_hash: link.test_hash,
        actual_hash: actualTestHash,
      });
    }
  }

  for (const annotation of index.orphan_annotations) {
    issues.push(createOrphanIssue(annotation));
  }

  for (const stableId of Array.from(ruleNodesByStableId.keys()).sort()) {
    if (coveredStableIds.has(stableId)) {
      continue;
    }

    const ruleNode = ruleNodesByStableId.get(stableId);
    issues.push({
      kind: "missing_coverage",
      rule_stable_id: stableId,
      rule_file: ruleNode?.file,
    });
  }

  return {
    present: true,
    revision: index.revision,
    ruleCount: ruleNodesByStableId.size,
    linkCount: index.links.length,
    coveredCount: coveredStableIds.size,
    staleRuleCount: issues.filter((issue) => issue.kind === "stale_rule").length,
    staleTestCount: issues.filter((issue) => issue.kind === "stale_test").length,
    orphanCount: issues.filter((issue) => issue.kind === "orphan").length,
    missingTestFileCount: issues.filter((issue) => issue.kind === "missing_test_file").length,
    missingCoverageCount: issues.filter((issue) => issue.kind === "missing_coverage").length,
    issues,
  };
}

function collectRuleNodesByStableId(meta: AgentsMeta): Map<string, AgentsMeta["nodes"][string]> {
  const nodes = new Map<string, AgentsMeta["nodes"][string]>();

  for (const [nodeId, node] of Object.entries(meta.nodes)) {
    nodes.set(node.stable_id ?? nodeId, node);
  }

  return nodes;
}

function createOrphanIssue(
  annotation: Pick<RuleTestLink | RuleTestOrphanAnnotation, "rule_stable_id" | "test_file" | "annotation_line">,
): RuleTestContractIssue {
  return {
    kind: "orphan",
    rule_stable_id: annotation.rule_stable_id,
    test_file: annotation.test_file,
    annotation_line: annotation.annotation_line,
  };
}

function collectBusinessLogicChunks(
  projectRoot: string,
  meta: Awaited<ReturnType<typeof readAgentsMeta>>,
): Array<{ id: string | undefined; anchor: string | undefined; rulePath: string }> {
  const chunks = [];

  for (const node of Object.values(meta.nodes)) {
    const level = node.level ?? node.layer;
    if (level !== "L2") {
      continue;
    }

    const rulePath = normalizeRulesPath(node.content_ref ?? node.file);
    const absoluteRulePath = join(projectRoot, rulePath);
    if (!existsSync(absoluteRulePath)) {
      continue;
    }

    const sections = parseRuleSections(readFileSync(absoluteRulePath, "utf8"));
    const businessSection = sections.get("BUSINESS_LOGIC_CHUNKS");
    if (businessSection === undefined) {
      continue;
    }

    chunks.push(...parseBusinessLogicChunks(businessSection, rulePath));
  }

  return chunks;
}

function parseBusinessLogicChunks(
  section: string,
  rulePath: string,
): Array<{ id: string | undefined; anchor: string | undefined; rulePath: string }> {
  const chunks: Array<{ id: string | undefined; anchor: string | undefined; rulePath: string }> = [];
  const lines = section.split(/\r?\n/u);
  let current: string[] = [];

  const flush = (): void => {
    if (current.length === 0) {
      return;
    }

    const text = current.join("\n");
    const id = readBusinessChunkId(text);
    const anchor = readBusinessChunkAnchor(text);
    if (id === undefined && anchor === undefined) {
      current = [];
      return;
    }

    chunks.push({
      id,
      anchor,
      rulePath,
    });
    current = [];
  };

  for (const line of lines) {
    if (/^#{3,6}\s+ID\s*:/iu.test(line.trim())) {
      flush();
    }

    current.push(line);
  }

  flush();
  return chunks;
}

function readBusinessChunkId(chunk: string): string | undefined {
  return /^#{3,6}\s+ID\s*:\s*([A-Za-z0-9][A-Za-z0-9_.:-]*)\s*$/imu.exec(chunk)?.[1];
}

function readBusinessChunkAnchor(chunk: string): string | undefined {
  const match =
    /^\s*[-*]\s*(?:\*\*)?Anchor(?:\*\*)?\s*:\s*`?([A-Za-z0-9][A-Za-z0-9_.:-]*)`?\s*$/imu.exec(chunk) ??
    /^\s*Anchor\s*:\s*`?([A-Za-z0-9][A-Za-z0-9_.:-]*)`?\s*$/imu.exec(chunk);

  return match?.[1];
}

function collectSourceAnchors(projectRoot: string): Map<string, string[]> {
  const anchors = new Map<string, string[]>();

  for (const file of collectSourceFiles(projectRoot)) {
    const source = readFileSync(join(projectRoot, file), "utf8");
    const lines = source.split(/\r?\n/u);

    lines.forEach((line, index) => {
      const matches = line.matchAll(/@fabric-anchor\s+([A-Za-z0-9][A-Za-z0-9_.:-]*)/gu);
      for (const match of matches) {
        const anchor = match[1];
        anchors.set(anchor, [...(anchors.get(anchor) ?? []), `${file}:${index + 1}`]);
      }
    });
  }

  return anchors;
}

function collectSourceFiles(root: string): string[] {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return [];
  }

  const files: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = join(current, entry.name);
      const relativePath = posix.normalize(absolutePath.slice(root.length + 1).split("\\").join("/"));

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          stack.push(absolutePath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = relativePath.slice(relativePath.lastIndexOf("."));
      if (SCRIPT_EXTENSIONS.has(extension)) {
        files.push(relativePath);
      }
    }
  }

  return files.sort();
}

function collectAuditViolations(
  projectRoot: string,
  ledgerEntries: Array<{
    id: string;
    ts: number;
    intent: string;
    affected_paths: string[];
  }>,
  ruleAccessEntries: RuleAccessAuditEntry[],
  windowMs: number,
): {
  checkedPathCount: number;
  violations: DoctorAuditViolation[];
} {
  let checkedPathCount = 0;
  const violations: DoctorAuditViolation[] = [];

  for (const entry of ledgerEntries) {
    for (const affectedPath of entry.affected_paths) {
      const normalizedPath = normalizeAuditPath(projectRoot, affectedPath);
      const matched = findPrecedingRuleAccessEvent(ruleAccessEntries, normalizedPath, entry.ts, windowMs);

      checkedPathCount += 1;
      if (matched !== null) {
        continue;
      }

      violations.push({
        editTs: entry.ts,
        entryId: entry.id,
        intent: entry.intent,
        lastRuleAccessTs: findLatestRuleAccessTs(ruleAccessEntries, normalizedPath, entry.ts),
        path: normalizedPath,
      });
    }
  }

  return {
    checkedPathCount,
    violations,
  };
}

function findPrecedingRuleAccessEvent(
  entries: RuleAccessAuditEntry[],
  path: string,
  ts: number,
  windowMs: number,
): RuleAccessAuditEntry | null {
  const getRulesMatch = findPrecedingGetRulesEvent(entries.filter(isGetRulesAuditEntry), path, ts, windowMs);
  const ruleSelectionMatch = findPrecedingRuleSelectionEvent(entries.filter(isRuleSelectionAuditEntry), path, ts, windowMs);

  if (getRulesMatch === null) {
    return ruleSelectionMatch;
  }

  if (ruleSelectionMatch === null) {
    return getRulesMatch;
  }

  return getRulesMatch.ts >= ruleSelectionMatch.ts ? getRulesMatch : ruleSelectionMatch;
}

function findPrecedingRuleSelectionEvent(
  entries: RuleSelectionAuditEntry[],
  path: string,
  ts: number,
  windowMs: number,
): RuleSelectionAuditEntry | null {
  let matched: RuleSelectionAuditEntry | null = null;

  for (const entry of entries) {
    if (!entry.target_paths.includes(path) && entry.path !== path) {
      continue;
    }

    if (entry.ts > ts || ts - entry.ts > windowMs) {
      continue;
    }

    if (matched === null || entry.ts > matched.ts) {
      matched = entry;
    }
  }

  return matched;
}

function findLatestRuleAccessTs(
  entries: RuleAccessAuditEntry[],
  path: string,
  ts: number,
): number | null {
  let latest: number | null = null;

  for (const entry of entries) {
    const matchesPath =
      entry.event === "rule_selection"
        ? entry.path === path || entry.target_paths.includes(path)
        : entry.path === path;

    if (!matchesPath || entry.ts > ts) {
      continue;
    }

    latest = latest === null || entry.ts > latest ? entry.ts : latest;
  }

  return latest;
}

function isGetRulesAuditEntry(entry: RuleAccessAuditEntry): entry is GetRulesAuditEntry {
  return entry.event === "get_rules";
}

function isRuleSelectionAuditEntry(entry: RuleAccessAuditEntry): entry is RuleSelectionAuditEntry {
  return entry.event === "rule_selection";
}

function readDoctorAuditMode(projectRoot: string): AuditMode {
  const configPath = join(projectRoot, "fabric.config.json");

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "off";
    }

    const configuredMode =
      readAuditModeValue((parsed as Record<string, unknown>).auditMode) ??
      readAuditModeValue((parsed as Record<string, unknown>).audit_mode);

    return configuredMode ?? "off";
  } catch (error) {
    if (isMissingFileError(error)) {
      return "off";
    }

    return "off";
  }
}

function normalizeTarget(targetInput: string): string {
  return isAbsolute(targetInput) ? targetInput : resolve(process.cwd(), targetInput);
}

function collectEntryPoints(root: string): EntryPoint[] {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return [];
  }

  const entries: EntryPoint[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = join(current, entry.name);
      const relativePath = posix.normalize(absolutePath.slice(root.length + 1).split("\\").join("/"));

      if (relativePath.length === 0) {
        continue;
      }

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          continue;
        }

        stack.push(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const reason = getEntryPointReason(relativePath);
      if (reason !== null) {
        entries.push({
          path: relativePath,
          reason,
        });
      }
    }
  }

  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function getEntryPointReason(relativePath: string): string | null {
  const extension = relativePath.slice(relativePath.lastIndexOf("."));
  if (!SCRIPT_EXTENSIONS.has(extension)) {
    return null;
  }

  const directory = posix.dirname(relativePath);
  const fileName = posix.basename(relativePath);
  const fileBase = fileName.slice(0, Math.max(fileName.lastIndexOf("."), 0));

  if (directory === "assets/scripts" || directory === "scripts") {
    return "top-level script";
  }

  if (directory === "src" && /^(App|app|index|main)$/.test(fileBase)) {
    return "application entry";
  }

  if ((directory === "app" || directory.startsWith("app/")) && /^(layout|page|route)$/.test(fileBase)) {
    return "next app route";
  }

  if ((directory === "pages" || directory.startsWith("pages/")) && fileName !== "_app.d.ts") {
    return "next page route";
  }

  return null;
}

function reduceStatus(statuses: DoctorStatus[]): DoctorStatus {
  if (statuses.includes("error")) {
    return "error";
  }

  if (statuses.includes("warn")) {
    return "warn";
  }

  return "ok";
}

function formatFramework(framework: { kind: string; version: string; subkind: string }): string {
  const pieces = [framework.kind, framework.version !== "unknown" ? framework.version : null, framework.subkind]
    .filter((piece) => piece !== null && piece !== "unknown");

  return pieces.length > 0 ? pieces.join(" · ") : "unknown";
}

function formatAge(ageMs: number): string {
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  if (days < 14) {
    return `${days}d`;
  }

  return `${Math.floor(days / 7)}w`;
}

function formatDuration(durationMs: number): string {
  const minutes = Math.floor(durationMs / (60 * 1000));
  if (minutes < 1) {
    return `${Math.max(Math.floor(durationMs / 1000), 1)}s`;
  }

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }

  return `${Math.floor(hours / 24)}d`;
}

function readAuditModeValue(value: unknown): AuditMode | null {
  if (value === "strict" || value === "warn" || value === "off") {
    return value;
  }

  return null;
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
