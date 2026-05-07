import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join, posix, resolve } from "node:path";

import {
  agentsMetaSchema,
  forensicReportSchema,
  ruleTestIndexSchema,
  type AgentsMeta,
  type ForensicReport,
  type RuleTestIndex,
} from "@fenglimg/fabric-shared";
import { detectFramework } from "@fenglimg/fabric-shared/node";

import { contextCache } from "../cache.js";
import { parseRuleSections } from "./rule-sections.js";
import { atomicWriteJson, atomicWriteText } from "@fenglimg/fabric-shared/node/atomic-write";
import { ensureParentDirectory, getEventLedgerPath, sha256 } from "./_shared.js";
import { buildRuleMeta, isSameRuleTestIndex, writeRuleMeta } from "./rule-meta-builder.js";
import { appendEventLedgerEvent, readEventLedger, truncateLedgerToLastNewline } from "./event-ledger.js";

export type DoctorStatus = "ok" | "warn" | "error";
export type DoctorIssueKind = "fixable_error" | "manual_error" | "warning";

export type DoctorCheck = {
  name: string;
  status: DoctorStatus;
  message: string;
  kind?: DoctorIssueKind;
  code?: string;
  fixable?: boolean;
};

export type DoctorIssue = {
  code: string;
  name: string;
  message: string;
  path?: string;
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
  metaRevision: string | null;
  computedMetaRevision: string | null;
  ruleCount: number;
  eventLedgerPath: string;
  fixableErrorCount: number;
  manualErrorCount: number;
  warningCount: number;
  targetFiles: Record<string, boolean>;
};

export type DoctorReport = {
  status: DoctorStatus;
  checks: DoctorCheck[];
  fixable_errors: DoctorIssue[];
  manual_errors: DoctorIssue[];
  warnings: DoctorIssue[];
  summary: DoctorSummary;
};

export type DoctorFixReport = {
  changed: boolean;
  fixed: DoctorIssue[];
  remaining_manual_errors: DoctorIssue[];
  warnings: DoctorIssue[];
  message: string;
  report: DoctorReport;
};

type EntryPoint = DoctorSummary["entryPoints"][number];

type MetaInspection =
  | {
      present: true;
      valid: true;
      meta: AgentsMeta;
      revision: string;
      computedRevision: string | null;
      ruleCount: number;
      missingContentRefs: string[];
      invalidContentRefs: string[];
      stale: boolean;
      changed: boolean;
      readError?: undefined;
    }
  | {
      present: false;
      valid: false;
      meta: null;
      revision: null;
      computedRevision: string | null;
      ruleCount: number;
      missingContentRefs: string[];
      invalidContentRefs: string[];
      stale: boolean;
      changed: boolean;
      readError?: string;
    }
  | {
      present: true;
      valid: false;
      meta: null;
      revision: null;
      computedRevision: string | null;
      ruleCount: number;
      missingContentRefs: string[];
      invalidContentRefs: string[];
      stale: boolean;
      changed: boolean;
      readError: string;
    };

type EventLedgerInspection = {
  exists: boolean;
  writable: boolean;
  parseable: boolean;
  hasPartialWrite: boolean;
  partialWriteByteOffset: number;
  partialWriteByteLength: number;
  path: string;
  error?: string;
};

type RuleSectionsInspection = {
  checkedCount: number;
  invalidFiles: Array<{ file: string; reason: string }>;
};

type RuleTestIndexInspection =
  | {
      present: true;
      valid: true;
      stale: boolean;
      linkCount: number;
      orphanCount: number;
      error?: undefined;
    }
  | {
      present: false;
      valid: false;
      stale: true;
      linkCount: 0;
      orphanCount: 0;
      error: string;
    }
  | {
      present: true;
      valid: false;
      stale: true;
      linkCount: 0;
      orphanCount: 0;
      error: string;
    };

type InitContextInspection = {
  exists: boolean;
  validJson: boolean;
  error?: string;
};

type McpConfigInWrongFileInspection = {
  hasWrongEntry: boolean;
  settingsPath: string;
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
const TARGET_FILE_PATHS = [
  ".fabric/bootstrap/README.md",
  ".fabric/INITIAL_TAXONOMY.md",
  ".fabric/forensic.json",
  ".fabric/init-context.json",
  ".fabric/agents.meta.json",
  ".fabric/rule-test.index.json",
  ".fabric/events.jsonl",
] as const;

export async function runDoctorReport(target: string): Promise<DoctorReport> {
  const projectRoot = normalizeTarget(target);
  const framework = detectFramework(projectRoot);
  const entryPoints = collectEntryPoints(projectRoot);
  const [
    forensic,
    initContext,
    meta,
    eventLedger,
    ruleSections,
    ruleTestIndex,
  ] = await Promise.all([
    inspectForensic(projectRoot),
    inspectInitContext(projectRoot),
    inspectMeta(projectRoot),
    inspectEventLedger(projectRoot),
    inspectRuleSections(projectRoot),
    inspectRuleTestIndex(projectRoot),
  ]);
  const mcpConfigInWrongFile = inspectMcpConfigInWrongFile(projectRoot);
  const taxonomyExists = existsSync(join(projectRoot, ".fabric", "INITIAL_TAXONOMY.md"));
  const bootstrapExists = existsSync(join(projectRoot, ".fabric", "bootstrap", "README.md"));
  const checks: DoctorCheck[] = [
    createBootstrapCheck(bootstrapExists),
    createTaxonomyCheck(taxonomyExists),
    createForensicCheck(forensic, framework.kind, entryPoints.length),
    createInitContextCheck(initContext),
    createMetaCheck(meta),
    createRuleContentRefCheck(meta),
    createRuleSectionsCheck(ruleSections),
    createRuleTestIndexCheck(ruleTestIndex),
    createEventLedgerCheck(eventLedger),
    createEventLedgerPartialWriteCheck(eventLedger),
    createMcpConfigInWrongFileCheck(mcpConfigInWrongFile),
  ];
  const fixableErrors = collectIssues(checks, "fixable_error");
  const manualErrors = collectIssues(checks, "manual_error");
  const warnings = collectIssues(checks, "warning");

  return {
    status: reduceStatus(checks.map((check) => check.status)),
    checks,
    fixable_errors: fixableErrors,
    manual_errors: manualErrors,
    warnings,
    summary: {
      target: projectRoot,
      framework: {
        kind: framework.kind,
        version: framework.version,
        subkind: framework.subkind,
      },
      entryPoints,
      metaRevision: meta.revision,
      computedMetaRevision: meta.computedRevision,
      ruleCount: meta.ruleCount,
      eventLedgerPath: eventLedger.path,
      fixableErrorCount: fixableErrors.length,
      manualErrorCount: manualErrors.length,
      warningCount: warnings.length,
      targetFiles: Object.fromEntries(
        TARGET_FILE_PATHS.map((path) => [path, existsSync(join(projectRoot, path))]),
      ),
    },
  };
}

export async function runDoctorFix(target: string): Promise<DoctorFixReport> {
  const projectRoot = normalizeTarget(target);
  const before = await runDoctorReport(projectRoot);
  const fixed: DoctorIssue[] = [];

  if (before.fixable_errors.some((issue) => issue.code === "bootstrap_missing")) {
    await writeDefaultBootstrap(projectRoot);
    fixed.push(findIssue(before.fixable_errors, "bootstrap_missing"));
  }

  if (before.fixable_errors.some((issue) => issue.code === "event_ledger_missing")) {
    await ensureEventLedger(projectRoot);
    fixed.push(findIssue(before.fixable_errors, "event_ledger_missing"));
  }

  if (
    before.fixable_errors.some((issue) =>
      ["agents_meta_missing", "agents_meta_stale", "rule_test_index_missing", "rule_test_index_stale"].includes(issue.code),
    )
  ) {
    await writeRuleMeta(projectRoot, { source: "doctor_fix" });
    for (const issue of before.fixable_errors.filter((candidate) =>
      ["agents_meta_missing", "agents_meta_stale", "rule_test_index_missing", "rule_test_index_stale"].includes(candidate.code),
    )) {
      fixed.push(issue);
    }
    contextCache.invalidate("meta_write", projectRoot);
  }

  if (before.fixable_errors.some((issue) => issue.code === "event_ledger_partial_write")) {
    const ledgerPath = getEventLedgerPath(projectRoot);
    const truncResult = await truncateLedgerToLastNewline(ledgerPath);
    await appendEventLedgerEvent(projectRoot, {
      event_type: "event_ledger_truncated",
      byte_offset: truncResult.truncated_bytes,
      byte_length: truncResult.truncated_bytes,
      corrupted_path: truncResult.corrupted_path,
    });
    fixed.push(findIssue(before.fixable_errors, "event_ledger_partial_write"));
  }

  if (before.fixable_errors.some((issue) => issue.code === "mcp_config_in_wrong_file")) {
    await fixMcpConfigInWrongFile(projectRoot);
    fixed.push(findIssue(before.fixable_errors, "mcp_config_in_wrong_file"));
  }

  const report = await runDoctorReport(projectRoot);

  return {
    changed: fixed.length > 0,
    fixed,
    remaining_manual_errors: report.manual_errors,
    warnings: report.warnings,
    message: createFixMessage(fixed, report),
    report,
  };
}

async function inspectForensic(projectRoot: string): Promise<{ present: boolean; valid: boolean; report: ForensicReport | null; error?: string }> {
  const path = join(projectRoot, ".fabric", "forensic.json");
  try {
    const parsed = forensicReportSchema.parse(JSON.parse(await readFile(path, "utf8")));
    return { present: true, valid: true, report: parsed };
  } catch (error) {
    if (isMissingFileError(error)) {
      return { present: false, valid: false, report: null, error: ".fabric/forensic.json is missing." };
    }
    return { present: true, valid: false, report: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function inspectInitContext(projectRoot: string): Promise<InitContextInspection> {
  const path = join(projectRoot, ".fabric", "init-context.json");
  try {
    JSON.parse(await readFile(path, "utf8")) as unknown;
    return { exists: true, validJson: true };
  } catch (error) {
    if (isMissingFileError(error)) {
      return { exists: false, validJson: false, error: ".fabric/init-context.json is missing." };
    }
    return { exists: true, validJson: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function inspectMcpConfigInWrongFile(projectRoot: string): McpConfigInWrongFileInspection {
  const settingsPath = join(projectRoot, ".claude", "settings.json");
  if (!existsSync(settingsPath)) {
    return { hasWrongEntry: false, settingsPath };
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { hasWrongEntry: false, settingsPath };
    }

    const settings = parsed as Record<string, unknown>;
    const mcpServers = settings.mcpServers;
    if (mcpServers === null || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
      return { hasWrongEntry: false, settingsPath };
    }

    const hasWrongEntry = "fabric" in (mcpServers as Record<string, unknown>);
    return { hasWrongEntry, settingsPath };
  } catch {
    return { hasWrongEntry: false, settingsPath };
  }
}

async function inspectMeta(projectRoot: string): Promise<MetaInspection> {
  const metaPath = join(projectRoot, ".fabric", "agents.meta.json");
  const built = await tryBuildRuleMeta(projectRoot);

  try {
    const raw = await readFile(metaPath, "utf8");
    const meta = agentsMetaSchema.parse(JSON.parse(raw));
    const contentRefIssues = inspectContentRefs(projectRoot, meta);
    const changed = built === null ? false : built.changed;

    return {
      present: true,
      valid: true,
      meta,
      revision: meta.revision,
      computedRevision: built?.meta.revision ?? null,
      ruleCount: Object.values(meta.nodes).filter((node) => (node.content_ref ?? node.file).startsWith(".fabric/rules/")).length,
      missingContentRefs: contentRefIssues.missing,
      invalidContentRefs: contentRefIssues.invalid,
      stale: changed || (built !== null && meta.revision !== built.meta.revision),
      changed,
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        present: false,
        valid: false,
        meta: null,
        revision: null,
        computedRevision: built?.meta.revision ?? null,
        ruleCount: 0,
        missingContentRefs: [],
        invalidContentRefs: [],
        stale: true,
        changed: built?.changed ?? true,
      };
    }
    return {
      present: true,
      valid: false,
      meta: null,
      revision: null,
      computedRevision: built?.meta.revision ?? null,
      ruleCount: 0,
      missingContentRefs: [],
      invalidContentRefs: [],
      stale: true,
      changed: built?.changed ?? true,
      readError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function tryBuildRuleMeta(projectRoot: string): Promise<Awaited<ReturnType<typeof buildRuleMeta>> | null> {
  try {
    return await buildRuleMeta(projectRoot);
  } catch {
    return null;
  }
}

function inspectContentRefs(projectRoot: string, meta: AgentsMeta): { missing: string[]; invalid: string[] } {
  const missing: string[] = [];
  const invalid: string[] = [];

  for (const node of Object.values(meta.nodes)) {
    const contentRef = normalizePath(node.content_ref ?? node.file);

    if (contentRef === ".fabric/bootstrap/README.md") {
      if (!existsSync(join(projectRoot, contentRef))) {
        missing.push(contentRef);
      }
      continue;
    }

    if (!contentRef.startsWith(".fabric/rules/")) {
      invalid.push(contentRef);
      continue;
    }

    if (!existsSync(join(projectRoot, contentRef))) {
      missing.push(contentRef);
    }
  }

  return { missing, invalid };
}

async function inspectEventLedger(projectRoot: string): Promise<EventLedgerInspection> {
  const path = getEventLedgerPath(projectRoot);
  const exists = existsSync(path);

  if (!exists) {
    return { exists: false, writable: false, parseable: false, hasPartialWrite: false, partialWriteByteOffset: 0, partialWriteByteLength: 0, path };
  }

  try {
    await access(path, constants.W_OK);
    const { warnings } = await readEventLedger(projectRoot);
    const raw = await readFile(path, "utf8");
    const invalidLine = raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .find((line) => !isValidJsonLine(line));

    const partialWarning = warnings.find((w) => w.kind === "partial_write_at_tail");

    return {
      exists: true,
      writable: true,
      parseable: invalidLine === undefined,
      hasPartialWrite: partialWarning !== undefined,
      partialWriteByteOffset: partialWarning?.byte_offset ?? 0,
      partialWriteByteLength: partialWarning?.byte_length ?? 0,
      path,
      error: invalidLine === undefined ? undefined : "events.jsonl contains an invalid JSON line.",
    };
  } catch (error) {
    return {
      exists: true,
      writable: false,
      parseable: false,
      hasPartialWrite: false,
      partialWriteByteOffset: 0,
      partialWriteByteLength: 0,
      path,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function inspectRuleSections(projectRoot: string): Promise<RuleSectionsInspection> {
  const invalidFiles: Array<{ file: string; reason: string }> = [];
  const files = findRuleFiles(projectRoot);

  for (const file of files) {
    try {
      parseRuleSections(await readFile(join(projectRoot, file), "utf8"));
    } catch (error) {
      invalidFiles.push({
        file,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    checkedCount: files.length,
    invalidFiles,
  };
}

async function inspectRuleTestIndex(projectRoot: string): Promise<RuleTestIndexInspection> {
  const path = join(projectRoot, ".fabric", "rule-test.index.json");
  const built = await tryBuildRuleMeta(projectRoot);

  try {
    const index = ruleTestIndexSchema.parse(JSON.parse(await readFile(path, "utf8")));
    return {
      present: true,
      valid: true,
      stale: built === null ? false : !isSameRuleTestIndex(index, built.ruleTestIndex),
      linkCount: index.links.length,
      orphanCount: index.orphan_annotations.length,
    };
  } catch (error) {
    return {
      present: !isMissingFileError(error),
      valid: false,
      stale: true,
      linkCount: 0,
      orphanCount: 0,
      error: isMissingFileError(error)
        ? ".fabric/rule-test.index.json is missing."
        : error instanceof Error
          ? error.message
          : String(error),
    };
  }
}

function createBootstrapCheck(exists: boolean): DoctorCheck {
  if (!exists) {
    return issueCheck("Bootstrap README", "error", "fixable_error", "bootstrap_missing", ".fabric/bootstrap/README.md is missing.");
  }
  return okCheck("Bootstrap README", ".fabric/bootstrap/README.md exists.");
}

function createTaxonomyCheck(exists: boolean): DoctorCheck {
  if (!exists) {
    return issueCheck("Initial taxonomy", "error", "manual_error", "taxonomy_missing", ".fabric/INITIAL_TAXONOMY.md is missing.");
  }
  return okCheck("Initial taxonomy", ".fabric/INITIAL_TAXONOMY.md exists.");
}

function createForensicCheck(
  forensic: Awaited<ReturnType<typeof inspectForensic>>,
  frameworkKind: string,
  entryPointCount: number,
): DoctorCheck {
  if (!forensic.present) {
    return issueCheck(
      "Scan evidence",
      "error",
      "manual_error",
      "forensic_missing",
      `${forensic.error ?? ".fabric/forensic.json is missing."} Live scan detects ${frameworkKind} with ${entryPointCount} entry point${entryPointCount === 1 ? "" : "s"}.`,
    );
  }
  if (!forensic.valid) {
    return issueCheck("Scan evidence", "error", "manual_error", "forensic_invalid", forensic.error ?? ".fabric/forensic.json is invalid.");
  }
  return okCheck("Scan evidence", `.fabric/forensic.json is valid for ${forensic.report?.framework.kind ?? "unknown"}.`);
}

function createInitContextCheck(initContext: InitContextInspection): DoctorCheck {
  if (!initContext.exists) {
    return issueCheck("Init context", "error", "manual_error", "init_context_missing", initContext.error ?? ".fabric/init-context.json is missing.");
  }
  if (!initContext.validJson) {
    return issueCheck("Init context", "error", "manual_error", "init_context_invalid", initContext.error ?? ".fabric/init-context.json is invalid.");
  }
  return okCheck("Init context", ".fabric/init-context.json is valid JSON.");
}

function createMetaCheck(meta: MetaInspection): DoctorCheck {
  if (!meta.present) {
    return issueCheck("Agents metadata", "error", "fixable_error", "agents_meta_missing", ".fabric/agents.meta.json is missing.");
  }
  if (!meta.valid) {
    return issueCheck("Agents metadata", "error", "manual_error", "agents_meta_invalid", meta.readError ?? ".fabric/agents.meta.json is invalid.");
  }
  if (meta.stale) {
    return issueCheck(
      "Agents metadata",
      "error",
      "fixable_error",
      "agents_meta_stale",
      `.fabric/agents.meta.json revision ${meta.revision} does not match .fabric/rules derived revision ${meta.computedRevision ?? "<unknown>"}.`,
    );
  }
  return okCheck("Agents metadata", `.fabric/agents.meta.json revision ${meta.revision} is aligned with .fabric/rules.`);
}

function createRuleContentRefCheck(meta: MetaInspection): DoctorCheck {
  if (!meta.valid) {
    return issueCheck("Rule content refs", "error", "manual_error", "content_refs_unavailable", "Cannot inspect content_ref entries until agents.meta.json is valid.");
  }

  if (meta.invalidContentRefs.length > 0) {
    return issueCheck(
      "Rule content refs",
      "error",
      "manual_error",
      "content_ref_outside_rules",
      `${meta.invalidContentRefs.length} content_ref entr${meta.invalidContentRefs.length === 1 ? "y is" : "ies are"} outside .fabric/rules.`,
    );
  }

  if (meta.missingContentRefs.length > 0) {
    return issueCheck(
      "Rule content refs",
      "error",
      "manual_error",
      "content_ref_missing",
      `${meta.missingContentRefs.length} content_ref target${meta.missingContentRefs.length === 1 ? "" : "s"} are missing.`,
    );
  }

  return okCheck("Rule content refs", "All content_ref entries resolve to .fabric/rules files or bootstrap README.");
}

function createRuleSectionsCheck(snapshot: RuleSectionsInspection): DoctorCheck {
  if (snapshot.invalidFiles.length > 0) {
    return issueCheck(
      "Rule sections",
      "error",
      "manual_error",
      "rule_sections_invalid",
      `${snapshot.invalidFiles.length} rule file${snapshot.invalidFiles.length === 1 ? "" : "s"} could not be parsed.`,
    );
  }
  return okCheck("Rule sections", `${snapshot.checkedCount} .fabric/rules file${snapshot.checkedCount === 1 ? "" : "s"} parsed.`);
}

function createRuleTestIndexCheck(index: RuleTestIndexInspection): DoctorCheck {
  if (!index.present) {
    return issueCheck("Rule-test index", "error", "fixable_error", "rule_test_index_missing", index.error);
  }
  if (!index.valid) {
    return issueCheck("Rule-test index", "error", "manual_error", "rule_test_index_invalid", index.error);
  }
  if (index.stale) {
    return issueCheck("Rule-test index", "error", "fixable_error", "rule_test_index_stale", ".fabric/rule-test.index.json is stale.");
  }
  return okCheck("Rule-test index", `${index.linkCount} link${index.linkCount === 1 ? "" : "s"} and ${index.orphanCount} orphan annotation${index.orphanCount === 1 ? "" : "s"} indexed.`);
}

function createEventLedgerCheck(ledger: EventLedgerInspection): DoctorCheck {
  if (!ledger.exists) {
    return issueCheck("Event ledger", "error", "fixable_error", "event_ledger_missing", ".fabric/events.jsonl is missing.");
  }
  if (!ledger.writable) {
    return issueCheck("Event ledger", "error", "manual_error", "event_ledger_not_writable", ledger.error ?? ".fabric/events.jsonl is not writable.");
  }
  if (!ledger.parseable) {
    return issueCheck("Event ledger", "error", "manual_error", "event_ledger_invalid", ledger.error ?? ".fabric/events.jsonl is invalid.");
  }
  return okCheck("Event ledger", ".fabric/events.jsonl exists, is writable, and is parseable.");
}

function createMcpConfigInWrongFileCheck(inspection: McpConfigInWrongFileInspection): DoctorCheck {
  if (inspection.hasWrongEntry) {
    return issueCheck(
      "Claude MCP config location",
      "error",
      "fixable_error",
      "mcp_config_in_wrong_file",
      `.claude/settings.json contains mcpServers.fabric — this file is for hooks/permissions only. Run --fix to remove it, then re-run fab init to write .mcp.json.`,
    );
  }

  return okCheck("Claude MCP config location", "mcpServers.fabric is not in .claude/settings.json.");
}

function createEventLedgerPartialWriteCheck(ledger: EventLedgerInspection): DoctorCheck {
  if (!ledger.exists || !ledger.writable) {
    return okCheck("Event ledger partial write", "No partial-write check needed (ledger missing or not writable).");
  }
  if (ledger.hasPartialWrite) {
    return issueCheck(
      "Event ledger partial write",
      "error",
      "fixable_error",
      "event_ledger_partial_write",
      `events.jsonl has a partial write at byte offset ${ledger.partialWriteByteOffset} (${ledger.partialWriteByteLength} corrupted bytes). Run --fix to truncate and preserve corrupted bytes.`,
    );
  }
  return okCheck("Event ledger partial write", "events.jsonl has no partial trailing write.");
}

function okCheck(name: string, message: string): DoctorCheck {
  return { name, status: "ok", message };
}

function issueCheck(
  name: string,
  status: DoctorStatus,
  kind: DoctorIssueKind,
  code: string,
  message: string,
): DoctorCheck {
  return {
    name,
    status,
    kind,
    code,
    fixable: kind === "fixable_error",
    message,
  };
}

function collectIssues(checks: DoctorCheck[], kind: DoctorIssueKind): DoctorIssue[] {
  return checks
    .filter((check) => check.kind === kind)
    .map((check) => ({
      code: check.code ?? check.name,
      name: check.name,
      message: check.message,
    }));
}

function findIssue(issues: DoctorIssue[], code: string): DoctorIssue {
  return issues.find((issue) => issue.code === code) ?? {
    code,
    name: code,
    message: code,
  };
}

async function fixMcpConfigInWrongFile(projectRoot: string): Promise<void> {
  const settingsPath = join(projectRoot, ".claude", "settings.json");
  if (!existsSync(settingsPath)) {
    return;
  }

  let settings: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return;
    }
    settings = parsed as Record<string, unknown>;
  } catch {
    return;
  }

  const mcpServers = settings.mcpServers;
  if (mcpServers === null || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
    return;
  }

  // Remove the fabric entry from mcpServers
  const { fabric: _removed, ...remainingServers } = mcpServers as Record<string, unknown>;
  const cleaned: Record<string, unknown> = { ...settings };

  if (Object.keys(remainingServers).length === 0) {
    delete cleaned.mcpServers;
  } else {
    cleaned.mcpServers = remainingServers;
  }

  await atomicWriteJson(settingsPath, cleaned, { indent: 2 });

  // Append a ledger event documenting the migration
  await appendEventLedgerEvent(projectRoot, {
    event_type: "mcp_config_migrated",
    source: "doctor_fix",
    removed_from: ".claude/settings.json",
  });
}

async function writeDefaultBootstrap(projectRoot: string): Promise<void> {
  const path = join(projectRoot, ".fabric", "bootstrap", "README.md");
  await ensureParentDirectory(path);
  await atomicWriteText(path, "# Fabric Bootstrap\n\nProject-specific Fabric bootstrap notes.\n");
}

async function ensureEventLedger(projectRoot: string): Promise<void> {
  const path = getEventLedgerPath(projectRoot);
  await ensureParentDirectory(path);
  await writeFile(path, "", { encoding: "utf8", flag: "a" });
}

function createFixMessage(fixed: DoctorIssue[], report: DoctorReport): string {
  const fixedText = fixed.length === 0
    ? "No deterministic doctor fixes were needed."
    : `Applied ${fixed.length} deterministic doctor fix${fixed.length === 1 ? "" : "es"}.`;
  const manualText = report.manual_errors.length === 0
    ? "No manual errors remain."
    : `${report.manual_errors.length} manual error${report.manual_errors.length === 1 ? "" : "s"} remain.`;

  return `${fixedText} ${manualText}`;
}

function findRuleFiles(projectRoot: string): string[] {
  const rulesRoot = join(projectRoot, ".fabric", "rules");
  if (!existsSync(rulesRoot) || !statSync(rulesRoot).isDirectory()) {
    return [];
  }

  const files: string[] = [];
  const stack = [rulesRoot];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = join(current, entry.name);
      const relativePath = normalizePath(absolutePath.slice(projectRoot.length + 1));

      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(relativePath);
      }
    }
  }

  return files.sort();
}

function isValidJsonLine(line: string): boolean {
  try {
    JSON.parse(line) as unknown;
    return true;
  } catch {
    return false;
  }
}

function normalizeTarget(targetInput: string): string {
  return isAbsolute(targetInput) ? targetInput : resolve(process.cwd(), targetInput);
}

function normalizePath(path: string): string {
  return posix.normalize(path.split("\\").join("/"));
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
      const relativePath = normalizePath(absolutePath.slice(root.length + 1));

      if (relativePath.length === 0) {
        continue;
      }

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          stack.push(absolutePath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const reason = getEntryPointReason(relativePath);
      if (reason !== null) {
        entries.push({ path: relativePath, reason });
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

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export { getEventLedgerPath };
