import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, posix, resolve } from "node:path";

import { forensicReportSchema, type AuditMode, type ForensicReport } from "@fenglimg/fabric-shared";
import { detectFramework, type FrameworkInfo } from "@fenglimg/fabric-shared/node";

import { readAgentsMeta } from "../meta-reader.js";
import {
  DEFAULT_AUDIT_WINDOW_MS,
  findPrecedingGetRulesEvent,
  normalizeAuditPath,
  readAuditLog,
  type GetRulesAuditEntry,
} from "./audit-log.js";
import { readHumanLock } from "./read-human-lock.js";
import { readLedger } from "./read-ledger.js";

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

export type DoctorAuditViolation = {
  editTs: number;
  entryId: string;
  intent: string;
  lastGetRulesTs: number | null;
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

type EntryPoint = DoctorSummary["entryPoints"][number];

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
      nodeCount: number;
      driftCount: number;
      missingFiles: string[];
      unexpectedError?: undefined;
    }
  | {
      present: false;
      revision: null;
      nodeCount: 0;
      driftCount: 0;
      missingFiles: string[];
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

  const [savedForensic, metaSnapshot, humanLockSnapshot, ledgerSnapshot, auditReport] = await Promise.all([
    readSavedForensic(projectRoot),
    inspectMetaRevision(projectRoot),
    inspectHumanLock(projectRoot),
    inspectLedger(projectRoot),
    runDoctorAuditReport(projectRoot),
  ]);

  const checks: DoctorCheck[] = [
    createForensicCheck(savedForensic, framework, entryPoints),
    createFrameworkCheck(savedForensic, framework, entryPoints),
    createMetaRevisionCheck(metaSnapshot),
    createProtectedPathsCheck(humanLockSnapshot),
    createLedgerCheck(ledgerSnapshot),
  ];

  if (!auditReport.skipped) {
    checks.push(createAuditCheck(auditReport));
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
  const getRulesEntries = auditEntries.filter(
    (entry): entry is GetRulesAuditEntry => entry.event === "get_rules",
  );
  const { checkedPathCount, violations } = collectAuditViolations(
    projectRoot,
    ledgerEntries,
    getRulesEntries,
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

    return {
      name: "Meta revision",
      status: "error",
      message: `agents.meta.json revision ${snapshot.revision} is stale: ${parts.join(" · ")}.`,
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
      message: `${report.violationCount} edit path${report.violationCount === 1 ? "" : "s"} lack a preceding fab_get_rules call within ${formatDuration(report.windowMs)}.`,
    };
  }

  return {
    name: "Rules fetch audit",
    status: "ok",
    message: `All ${report.checkedPathCount} audited edit path${report.checkedPathCount === 1 ? "" : "s"} have a preceding fab_get_rules call within ${formatDuration(report.windowMs)}.`,
  };
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
    const meta = readAgentsMeta(projectRoot);
    const entries = Object.entries(meta.nodes).sort(([left], [right]) => left.localeCompare(right));
    const missingFiles: string[] = [];
    let driftCount = 0;

    const revisionSource = entries
      .map(([, node]) => {
        const absolutePath = join(projectRoot, node.file);

        if (!existsSync(absolutePath)) {
          missingFiles.push(node.file);
          driftCount += 1;
          return "missing";
        }

        const actualHash = sha256(readFileSync(absolutePath, "utf8"));
        if (actualHash !== node.hash) {
          driftCount += 1;
        }

        return actualHash;
      })
      .join("");

    const revision = sha256(revisionSource);

    return {
      present: true,
      revision: meta.revision,
      nodeCount: entries.length,
      driftCount: revision === meta.revision ? driftCount : Math.max(driftCount, 1),
      missingFiles,
    };
  } catch (error) {
    return {
      present: false,
      revision: null,
      nodeCount: 0,
      driftCount: 0,
      missingFiles: [],
      unexpectedError: error instanceof Error ? error.message : String(error),
    };
  }
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
  const entries = await readLedger(projectRoot);
  const lastEntry = entries.reduce<number | null>(
    (latest, entry) => (latest === null || entry.ts > latest ? entry.ts : latest),
    null,
  );

  return {
    count: entries.length,
    lastEntryTs: lastEntry,
    lastEntryAgeMs: lastEntry === null ? null : Math.max(Date.now() - lastEntry, 0),
  };
}

function collectAuditViolations(
  projectRoot: string,
  ledgerEntries: Array<{
    id: string;
    ts: number;
    intent: string;
    affected_paths: string[];
  }>,
  getRulesEntries: GetRulesAuditEntry[],
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
      const matched = findPrecedingGetRulesEvent(getRulesEntries, normalizedPath, entry.ts, windowMs);

      checkedPathCount += 1;
      if (matched !== null) {
        continue;
      }

      violations.push({
        editTs: entry.ts,
        entryId: entry.id,
        intent: entry.intent,
        lastGetRulesTs: findLatestGetRulesTs(getRulesEntries, normalizedPath, entry.ts),
        path: normalizedPath,
      });
    }
  }

  return {
    checkedPathCount,
    violations,
  };
}

function findLatestGetRulesTs(
  entries: GetRulesAuditEntry[],
  path: string,
  ts: number,
): number | null {
  let latest: number | null = null;

  for (const entry of entries) {
    if (entry.path !== path || entry.ts > ts) {
      continue;
    }

    latest = latest === null || entry.ts > latest ? entry.ts : latest;
  }

  return latest;
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

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
