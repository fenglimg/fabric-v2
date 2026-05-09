import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join, posix, resolve } from "node:path";

import {
  agentsMetaSchema,
  AgentsMetaCountersSchema,
  forensicReportSchema,
  parseKnowledgeId,
  ruleTestIndexSchema,
  type AgentsMeta,
  type AgentsMetaCounters,
  type ForensicReport,
  type RuleTestIndex,
} from "@fenglimg/fabric-shared";
import { detectFramework } from "@fenglimg/fabric-shared/node";

import { contextCache } from "../cache.js";
import { parseRuleSections } from "./rule-sections.js";
import { atomicWriteJson } from "@fenglimg/fabric-shared/node/atomic-write";
import { ensureParentDirectory, getEventLedgerPath, sha256 } from "./_shared.js";
import { buildRuleMeta, isSameRuleTestIndex, writeRuleMeta } from "./rule-meta-builder.js";
import { appendEventLedgerEvent, readEventLedger, truncateLedgerToLastNewline } from "./event-ledger.js";
import { reconcileRules } from "./rule-sync.js";

export type DoctorStatus = "ok" | "warn" | "error";
export type DoctorIssueKind = "fixable_error" | "manual_error" | "warning" | "info";

export type DoctorCheck = {
  name: string;
  status: DoctorStatus;
  message: string;
  kind?: DoctorIssueKind;
  code?: string;
  fixable?: boolean;
  actionHint?: string;
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
  infoCount: number;
  targetFiles: Record<string, boolean>;
};

export type DoctorReport = {
  status: DoctorStatus;
  checks: DoctorCheck[];
  fixable_errors: DoctorIssue[];
  manual_errors: DoctorIssue[];
  warnings: DoctorIssue[];
  infos: DoctorIssue[];
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

type McpConfigInWrongFileInspection = {
  hasWrongEntry: boolean;
  settingsPath: string;
};

type MetaManuallyDivergedInspection = {
  extraMetaEntries: string[];
  hashMismatchEntries: string[];
  readable: boolean;
  error?: string;
};

type RulesDirUnindexedInspection = {
  unindexedFiles: string[];
};

type KnowledgeDirMissingInspection = {
  missingSubdirs: string[];
};

type StableIdCollision = {
  stable_id: string;
  files: string[];
};

type StableIdCollisionInspection = {
  collisions: StableIdCollision[];
};

type CounterDesyncEntry = {
  layer: "KP" | "KT";
  type: "MOD" | "DEC" | "GLD" | "PIT" | "PRO";
  observed: number;
  current: number;
};

type CounterDesyncInspection = {
  desyncs: CounterDesyncEntry[];
  // Snapshot of the corrected counters (post-fix view) used by --fix to rewrite agents.meta.json.
  correctedCounters: AgentsMetaCounters | null;
};

type LegacyV1ArtifactsInspection = {
  detected: string[];
};

type BootstrapAnchorInspection = {
  hasAgentsMd: boolean;
  hasClaudeMd: boolean;
};

type ClaudeSkillLegacyPathInspection = {
  hasLegacy: boolean;
  legacyPath: string;
  newPath: string;
};

type ClaudeHookLegacyPathInspection = {
  hasLegacyFile: boolean;
  hasLegacySettingsCommand: boolean;
  legacyHookPath: string;
  newHookPath: string;
  settingsPath: string;
};

type CodexSkillLegacyPathInspection = {
  hasLegacy: boolean;
  legacyPath: string;
  newPath: string;
};

type LegacyClientPathInspection = {
  presentKeys: string[];
};

const LEGACY_CLIENT_PATH_KEYS = ["windsurf", "rooCode", "geminiCLI"] as const;

type PreexistingRootFilesInspection = {
  detected: string[];
};

const KNOWLEDGE_SUBDIRS = ["decisions", "pitfalls", "guidelines", "models", "processes", "pending"] as const;

// v2.0 layout: legacy v1.x artifacts that should NOT exist in a clean v2.0 repo.
// Surfaced as a warn-only visibility check (legacy_v1_artifacts_present).
const LEGACY_V1_ARTIFACT_PATHS = [
  ".fabric/rules",
  ".fabric/INITIAL_TAXONOMY.md",
  ".fabric/bootstrap",
  ".fabric-v1-archive",
] as const;

// Knowledge counter type-codes. Mirrors KNOWLEDGE_TYPE_CODES values in shared/api-contracts.
const COUNTER_TYPE_CODES = ["MOD", "DEC", "GLD", "PIT", "PRO"] as const;

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
// v2.0: bootstrap is anchored at the repo root (AGENTS.md / CLAUDE.md), and
// the v1 INITIAL_TAXONOMY.md / .fabric/bootstrap/ artifacts are no longer
// authoritative. The summary.targetFiles map is intentionally additive — we
// keep it focused on top-level Fabric state files.
//
// Note: `.fabric/init-context.json` is intentionally NOT listed here. v2.0
// init-context is owned by the AI-side `fabric-init` skill flow (Claude Code
// / Codex CLI), not by `fabric init` CLI. The skill writes it during a
// 3-phase initialization interview; if the skill never ran the file is
// legitimately absent and doctor must not flag it as a state issue.
const TARGET_FILE_PATHS = [
  ".fabric/forensic.json",
  ".fabric/agents.meta.json",
  ".fabric/rule-test.index.json",
  ".fabric/events.jsonl",
  ".fabric/knowledge",
] as const;

export async function runDoctorReport(target: string): Promise<DoctorReport> {
  const projectRoot = normalizeTarget(target);
  const framework = detectFramework(projectRoot);
  const entryPoints = collectEntryPoints(projectRoot);
  const [
    forensic,
    meta,
    eventLedger,
    ruleSections,
    ruleTestIndex,
  ] = await Promise.all([
    inspectForensic(projectRoot),
    inspectMeta(projectRoot),
    inspectEventLedger(projectRoot),
    inspectRuleSections(projectRoot),
    inspectRuleTestIndex(projectRoot),
  ]);
  const mcpConfigInWrongFile = inspectMcpConfigInWrongFile(projectRoot);
  const metaManuallyDiverged = await inspectMetaManuallyDiverged(projectRoot);
  const knowledgeDirUnindexed = inspectKnowledgeDirUnindexed(projectRoot, meta);
  const knowledgeDirMissing = inspectKnowledgeDirMissing(projectRoot);
  const stableIdCollision = await inspectStableIdCollisions(projectRoot);
  const counterDesync = inspectCounterDesync(meta);
  const claudeSkillLegacyPath = inspectClaudeSkillLegacyPath(projectRoot);
  const claudeHookLegacyPath = inspectClaudeHookLegacyPath(projectRoot);
  const codexSkillLegacyPath = inspectCodexSkillLegacyPath(projectRoot);
  const preexistingRootFiles = inspectPreexistingRootFiles(projectRoot);
  const legacyClientPaths = inspectLegacyClientPaths(projectRoot);
  const legacyV1Artifacts = inspectLegacyV1Artifacts(projectRoot);
  const bootstrapAnchor = inspectBootstrapAnchor(projectRoot);
  const checks: DoctorCheck[] = [
    createBootstrapAnchorCheck(bootstrapAnchor),
    createKnowledgeDirMissingCheck(knowledgeDirMissing),
    createForensicCheck(forensic, framework.kind, entryPoints.length),
    // v2.0: removed `createInitContextCheck` — `.fabric/init-context.json`
    // is owned by the AI-side `fabric-init` skill, not by `fabric init` CLI.
    // The file's absence is a legitimate post-init state when the skill has
    // not yet run, so flagging it as a doctor manual_error misrepresents
    // ownership.
    createMetaCheck(meta),
    createRuleContentRefCheck(meta),
    createRuleSectionsCheck(ruleSections),
    createRuleTestIndexCheck(ruleTestIndex),
    createEventLedgerCheck(eventLedger),
    createEventLedgerPartialWriteCheck(eventLedger),
    createMcpConfigInWrongFileCheck(mcpConfigInWrongFile),
    createMetaManuallyDivergedCheck(metaManuallyDiverged),
    createKnowledgeDirUnindexedCheck(knowledgeDirUnindexed),
    createStableIdCollisionCheck(stableIdCollision),
    createCounterDesyncCheck(counterDesync),
    createClaudeSkillLegacyPathCheck(claudeSkillLegacyPath),
    createClaudeHookLegacyPathCheck(claudeHookLegacyPath),
    createCodexSkillLegacyPathCheck(codexSkillLegacyPath),
    createPreexistingRootFilesCheck(preexistingRootFiles),
    createLegacyClientPathCheck(legacyClientPaths),
    createLegacyV1ArtifactsCheck(legacyV1Artifacts),
  ];
  const fixableErrors = collectIssues(checks, "fixable_error");
  const manualErrors = collectIssues(checks, "manual_error");
  const warnings = collectIssues(checks, "warning");
  const infos = collectIssues(checks, "info");

  return {
    status: reduceStatus(checks.map((check) => check.status)),
    checks,
    fixable_errors: fixableErrors,
    manual_errors: manualErrors,
    warnings,
    infos,
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
      infoCount: infos.length,
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

  if (before.fixable_errors.some((issue) => issue.code === "knowledge_dir_missing")) {
    await ensureKnowledgeSubdirs(projectRoot);
    fixed.push(findIssue(before.fixable_errors, "knowledge_dir_missing"));
  }

  if (before.fixable_errors.some((issue) => issue.code === "event_ledger_missing")) {
    await ensureEventLedger(projectRoot);
    fixed.push(findIssue(before.fixable_errors, "event_ledger_missing"));
  }

  // counter_desync MUST run before reconcileRules: the counters envelope is
  // preserved verbatim across a reconcile rebuild (rule-meta-builder copies
  // `previousMeta.counters` through), so bumping first means the correction
  // survives even when reconcile rewrites the nodes graph.
  if (before.fixable_errors.some((issue) => issue.code === "counter_desync")) {
    await fixCounterDesync(projectRoot);
    fixed.push(findIssue(before.fixable_errors, "counter_desync"));
    contextCache.invalidate("meta_write", projectRoot);
  }

  if (
    before.fixable_errors.some((issue) =>
      [
        "agents_meta_missing",
        "agents_meta_stale",
        "rule_test_index_missing",
        "rule_test_index_stale",
        "content_ref_missing",
        "knowledge_dir_unindexed",
      ].includes(issue.code),
    )
  ) {
    // D22: doctor's role is now consistency repairer, not baseline promoter.
    // reconcileRules rewrites agents.meta.json from disk ground-truth and emits
    // a 'meta_reconciled' ledger event (trigger='doctor').
    // content_ref_missing: reconcile drops stale refs that no longer have a backing file.
    // knowledge_dir_unindexed: reconcile incorporates any .md files not yet in the index.
    await reconcileRules(projectRoot, { trigger: "doctor" });
    for (const issue of before.fixable_errors.filter((candidate) =>
      [
        "agents_meta_missing",
        "agents_meta_stale",
        "rule_test_index_missing",
        "rule_test_index_stale",
        "content_ref_missing",
        "knowledge_dir_unindexed",
      ].includes(candidate.code),
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

  if (before.fixable_errors.some((issue) => issue.code === "claude_skill_legacy_path")) {
    await fixClaudeSkillLegacyPath(projectRoot);
    fixed.push(findIssue(before.fixable_errors, "claude_skill_legacy_path"));
  }

  if (before.fixable_errors.some((issue) => issue.code === "claude_hook_legacy_path")) {
    await fixClaudeHookLegacyPath(projectRoot);
    fixed.push(findIssue(before.fixable_errors, "claude_hook_legacy_path"));
  }

  if (before.fixable_errors.some((issue) => issue.code === "codex_skill_legacy_path")) {
    await fixCodexSkillLegacyPath(projectRoot);
    fixed.push(findIssue(before.fixable_errors, "codex_skill_legacy_path"));
  }

  if (before.warnings.some((issue) => issue.code === "legacy_client_path_present")) {
    await fixLegacyClientPaths(projectRoot);
    fixed.push(findIssue(before.warnings, "legacy_client_path_present"));
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

// v2.0: `inspectInitContext` removed. `.fabric/init-context.json` is owned
// by the AI-side `fabric-init` skill, not by `fabric init` CLI. The hooks
// under packages/cli/templates/{claude,codex}-hooks/ still consume the file
// as a "init done" signal at runtime, but that is a hook concern, not a
// doctor state concern.

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

    // v2.0: legacy `.fabric/bootstrap/README.md` is no longer a recognized
    // content_ref; the legacy_v1_artifacts_present check surfaces it instead
    // of being special-cased here. Valid v2.0 content_refs live under
    // .fabric/knowledge/ (team) or ~/.fabric/knowledge/ (personal); legacy
    // .fabric/rules/ entries remain valid during the migration window.
    const isPersonalKnowledge = contentRef.startsWith("~/.fabric/knowledge/");
    const isTeamKnowledge = contentRef.startsWith(".fabric/knowledge/");
    const isLegacyRule = contentRef.startsWith(".fabric/rules/");

    if (!isPersonalKnowledge && !isTeamKnowledge && !isLegacyRule) {
      invalid.push(contentRef);
      continue;
    }

    // Personal-root entries are not directly validated against the project
    // tree — their existence is verified by the personal-root scan in
    // rule-meta-builder.ts. We only check team-root and legacy entries here.
    if (isPersonalKnowledge) {
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

function inspectBootstrapAnchor(projectRoot: string): BootstrapAnchorInspection {
  return {
    hasAgentsMd: existsSync(join(projectRoot, "AGENTS.md")),
    hasClaudeMd: existsSync(join(projectRoot, "CLAUDE.md")),
  };
}

function createBootstrapAnchorCheck(inspection: BootstrapAnchorInspection): DoctorCheck {
  // v2.0: bootstrap is anchored at the repo root via AGENTS.md or CLAUDE.md.
  // Either one (or both) is sufficient; missing both is a fixable_error in
  // the sense that `fabric init` is the canonical remediation (we do not
  // auto-write the anchor file from doctor --fix).
  if (!inspection.hasAgentsMd && !inspection.hasClaudeMd) {
    return issueCheck(
      "Bootstrap anchor",
      "error",
      "fixable_error",
      "bootstrap_anchor_missing",
      "Neither AGENTS.md nor CLAUDE.md exists at the repo root. Fabric requires a bootstrap anchor file at the project root.",
      "Run `fabric init` to generate the AGENTS.md / CLAUDE.md bootstrap anchor at the repo root.",
    );
  }
  const present = [
    inspection.hasAgentsMd ? "AGENTS.md" : null,
    inspection.hasClaudeMd ? "CLAUDE.md" : null,
  ]
    .filter((entry): entry is string => entry !== null)
    .join(", ");
  return okCheck("Bootstrap anchor", `Bootstrap anchor present at repo root: ${present}.`);
}

function inspectKnowledgeDirMissing(projectRoot: string): KnowledgeDirMissingInspection {
  const knowledgeRoot = join(projectRoot, ".fabric", "knowledge");
  const missingSubdirs: string[] = [];
  for (const sub of KNOWLEDGE_SUBDIRS) {
    const path = join(knowledgeRoot, sub);
    if (!existsSync(path)) {
      missingSubdirs.push(`.fabric/knowledge/${sub}`);
    }
  }
  return { missingSubdirs };
}

function createKnowledgeDirMissingCheck(inspection: KnowledgeDirMissingInspection): DoctorCheck {
  if (inspection.missingSubdirs.length > 0) {
    const list = inspection.missingSubdirs.join(", ");
    return issueCheck(
      "Knowledge layout",
      "error",
      "fixable_error",
      "knowledge_dir_missing",
      `${inspection.missingSubdirs.length} required knowledge subdir${inspection.missingSubdirs.length === 1 ? " is" : "s are"} missing: ${list}.`,
      "Run `fab doctor --fix` to create the missing .fabric/knowledge/* subdirectories.",
    );
  }
  return okCheck(
    "Knowledge layout",
    `All ${KNOWLEDGE_SUBDIRS.length} required .fabric/knowledge/* subdirectories exist.`,
  );
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
      "Run `fab init` to regenerate .fabric/forensic.json.",
    );
  }
  if (!forensic.valid) {
    return issueCheck("Scan evidence", "error", "manual_error", "forensic_invalid", forensic.error ?? ".fabric/forensic.json is invalid.", "Run `fab init` to regenerate .fabric/forensic.json.");
  }
  return okCheck("Scan evidence", `.fabric/forensic.json is valid for ${forensic.report?.framework.kind ?? "unknown"}.`);
}

// v2.0: `createInitContextCheck` removed alongside `inspectInitContext` —
// see comment at the call site in `runDoctorReport`.

function createMetaCheck(meta: MetaInspection): DoctorCheck {
  if (!meta.present) {
    return issueCheck("Agents metadata", "error", "fixable_error", "agents_meta_missing", ".fabric/agents.meta.json is missing.", "Run `fab doctor --fix` to rebuild agents.meta.json from .fabric/rules/.");
  }
  if (!meta.valid) {
    return issueCheck("Agents metadata", "error", "manual_error", "agents_meta_invalid", meta.readError ?? ".fabric/agents.meta.json is invalid.", "Delete .fabric/agents.meta.json and run `fab doctor --fix` to regenerate it.");
  }
  if (meta.stale) {
    return issueCheck(
      "Agents metadata",
      "error",
      "fixable_error",
      "agents_meta_stale",
      `.fabric/agents.meta.json revision ${meta.revision} does not match .fabric/rules derived revision ${meta.computedRevision ?? "<unknown>"}.`,
      "Run `fab doctor --fix` to reconcile agents.meta.json with the current rule files.",
    );
  }
  return okCheck("Agents metadata", `.fabric/agents.meta.json revision ${meta.revision} is aligned with .fabric/rules.`);
}

function createRuleContentRefCheck(meta: MetaInspection): DoctorCheck {
  if (!meta.valid) {
    return issueCheck("Rule content refs", "error", "manual_error", "content_refs_unavailable", "Cannot inspect content_ref entries until agents.meta.json is valid.", "Fix agents.meta.json first: run `fab doctor --fix`.");
  }

  if (meta.invalidContentRefs.length > 0) {
    return issueCheck(
      "Rule content refs",
      "error",
      "manual_error",
      "content_ref_outside_rules",
      `${meta.invalidContentRefs.length} content_ref entr${meta.invalidContentRefs.length === 1 ? "y is" : "ies are"} outside .fabric/rules.`,
      "Edit agents.meta.json to ensure all content_ref values point inside .fabric/rules/.",
    );
  }

  if (meta.missingContentRefs.length > 0) {
    // content_ref_missing is fixable: reconcileRules rebuilds agents.meta.json from
    // the physical .fabric/rules/**/*.md files, dropping any stale refs automatically.
    return issueCheck(
      "Rule content refs",
      "error",
      "fixable_error",
      "content_ref_missing",
      `${meta.missingContentRefs.length} content_ref target${meta.missingContentRefs.length === 1 ? "" : "s"} are missing. Run \`fab doctor --fix\` to reconcile.`,
      "Run `fab doctor --fix` to reconcile agents.meta.json with the files present in .fabric/rules/.",
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
      "Edit the rule file(s) to fix the section structure, then re-run `fab doctor`.",
    );
  }
  return okCheck("Rule sections", `${snapshot.checkedCount} .fabric/rules file${snapshot.checkedCount === 1 ? "" : "s"} parsed.`);
}

function createRuleTestIndexCheck(index: RuleTestIndexInspection): DoctorCheck {
  if (!index.present) {
    return issueCheck("Rule-test index", "error", "fixable_error", "rule_test_index_missing", index.error, "Run `fab doctor --fix` to rebuild .fabric/rule-test.index.json.");
  }
  if (!index.valid) {
    return issueCheck("Rule-test index", "error", "manual_error", "rule_test_index_invalid", index.error, "Delete .fabric/rule-test.index.json and run `fab doctor --fix` to regenerate it.");
  }
  if (index.stale) {
    return issueCheck("Rule-test index", "error", "fixable_error", "rule_test_index_stale", ".fabric/rule-test.index.json is stale.", "Run `fab doctor --fix` to rebuild the rule-test index.");
  }
  return okCheck("Rule-test index", `${index.linkCount} link${index.linkCount === 1 ? "" : "s"} and ${index.orphanCount} orphan annotation${index.orphanCount === 1 ? "" : "s"} indexed.`);
}

function createEventLedgerCheck(ledger: EventLedgerInspection): DoctorCheck {
  if (!ledger.exists) {
    return issueCheck("Event ledger", "error", "fixable_error", "event_ledger_missing", ".fabric/events.jsonl is missing.", "Run `fab doctor --fix` to create .fabric/events.jsonl.");
  }
  if (!ledger.writable) {
    return issueCheck("Event ledger", "error", "manual_error", "event_ledger_not_writable", ledger.error ?? ".fabric/events.jsonl is not writable.", "Check file permissions on .fabric/events.jsonl and ensure no other process holds a write lock.");
  }
  if (!ledger.parseable) {
    return issueCheck("Event ledger", "error", "manual_error", "event_ledger_invalid", ledger.error ?? ".fabric/events.jsonl is invalid.", "Delete .fabric/events.jsonl and run `fab doctor --fix` to recreate it.");
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
      "Run `fab doctor --fix` to remove mcpServers.fabric from .claude/settings.json, then run `fab init` to write .mcp.json.",
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
      "Run `fab doctor --fix` to truncate the partial write and restore events.jsonl to a valid state.",
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

async function inspectMetaManuallyDiverged(projectRoot: string): Promise<MetaManuallyDivergedInspection> {
  const metaPath = join(projectRoot, ".fabric", "agents.meta.json");

  if (!existsSync(metaPath)) {
    return { extraMetaEntries: [], hashMismatchEntries: [], readable: false };
  }

  let meta: AgentsMeta;
  try {
    const raw = await readFile(metaPath, "utf8");
    meta = agentsMetaSchema.parse(JSON.parse(raw));
  } catch (error) {
    return {
      extraMetaEntries: [],
      hashMismatchEntries: [],
      readable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const extraMetaEntries: string[] = [];
  const hashMismatchEntries: string[] = [];

  for (const node of Object.values(meta.nodes)) {
    const contentRef = node.content_ref ?? node.file;
    const absPath = join(projectRoot, contentRef);

    if (!existsSync(absPath)) {
      extraMetaEntries.push(contentRef);
      continue;
    }

    try {
      const content = readFileSync(absPath, "utf8");
      const diskHash = sha256(content);
      if (node.hash !== "" && node.hash !== diskHash) {
        hashMismatchEntries.push(contentRef);
      }
    } catch {
      extraMetaEntries.push(contentRef);
    }
  }

  return { extraMetaEntries, hashMismatchEntries, readable: true };
}

function inspectKnowledgeDirUnindexed(projectRoot: string, meta: MetaInspection): RulesDirUnindexedInspection {
  // v2.0 layout: iterate .fabric/knowledge/{type}/ and (for now, during the
  // v1→v2 transition) also legacy .fabric/rules/ so doctor stays useful while
  // rule-meta-builder learns the new layout in TASK-003/TASK-004.
  const physicalMdFiles = new Set<string>();
  collectMdFilesUnder(physicalMdFiles, projectRoot, join(projectRoot, ".fabric", "knowledge"), ".fabric/knowledge");
  collectMdFilesUnder(physicalMdFiles, projectRoot, join(projectRoot, ".fabric", "rules"), ".fabric/rules");

  if (physicalMdFiles.size === 0) {
    return { unindexedFiles: [] };
  }

  // Collect all content_refs/file paths tracked in meta.
  const indexedRefs = new Set<string>();
  if (meta.valid && meta.meta !== null) {
    for (const node of Object.values(meta.meta.nodes)) {
      const ref = normalizePath(node.content_ref ?? node.file);
      indexedRefs.add(ref);
    }
  }

  const unindexedFiles = [...physicalMdFiles].filter((f) => !indexedRefs.has(f)).sort();
  return { unindexedFiles };
}

function collectMdFilesUnder(
  out: Set<string>,
  projectRoot: string,
  rootDir: string,
  relPrefix: string,
): void {
  if (!existsSync(rootDir)) {
    return;
  }
  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) {
      continue;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const rel = posix.join(relPrefix, abs.slice(rootDir.length + 1).replace(/\\/gu, "/"));
        out.add(rel);
      }
    }
  }
}

function createKnowledgeDirUnindexedCheck(inspection: RulesDirUnindexedInspection): DoctorCheck {
  if (inspection.unindexedFiles.length > 0) {
    return issueCheck(
      "Knowledge dir unindexed",
      "error",
      "fixable_error",
      "knowledge_dir_unindexed",
      `${inspection.unindexedFiles.length} .md file${inspection.unindexedFiles.length === 1 ? "" : "s"} in .fabric/knowledge/ not indexed in agents.meta.json. Run \`fab doctor --fix\` to index the missing knowledge files.`,
      "Run `fab doctor --fix` to index the missing knowledge files.",
    );
  }
  return okCheck("Knowledge dir unindexed", "All .fabric/knowledge/ .md files are indexed in agents.meta.json.");
}

async function inspectStableIdCollisions(projectRoot: string): Promise<StableIdCollisionInspection> {
  // v2.0: stable_ids are declared in two flavours:
  //   - rule files in .fabric/rules/ via `<!-- fab:rule-id X -->`
  //     (legacy format; still supported during v1→v2 transition)
  //   - knowledge files in .fabric/knowledge/{type}/ via frontmatter `id: K[PT]-XXX-NNNN`
  // We scan both; the file path component is recorded relative to the project
  // root using POSIX separators so messages are stable across OSes.
  type Found = { stableId: string; relPath: string };
  const found: Found[] = [];

  // Legacy `.fabric/rules/` files (HTML-comment id marker).
  const rulesDir = join(projectRoot, ".fabric", "rules");
  const ruleFiles: string[] = [];
  if (existsSync(rulesDir)) {
    const stack: string[] = [rulesDir];
    while (stack.length > 0) {
      const dir = stack.pop();
      if (dir === undefined) {
        continue;
      }
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(abs);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          ruleFiles.push(abs);
        }
      }
    }
  }

  const DECLARED_ID_PATTERN =
    /^(?:\uFEFF)?(?:---\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$))?<!--\s*fab:rule-id\s+([A-Za-z0-9][A-Za-z0-9/_-]*)\s*-->\s*(?:\r?\n|$)/u;
  for (const absPath of ruleFiles) {
    let source: string;
    try {
      source = await readFile(absPath, "utf8");
    } catch {
      continue;
    }
    const match = DECLARED_ID_PATTERN.exec(source);
    if (match === null) {
      continue;
    }
    const relPath = posix.join(".fabric/rules", absPath.slice(rulesDir.length + 1).replace(/\\/gu, "/"));
    found.push({ stableId: match[1], relPath });
  }

  // v2.0 knowledge files (frontmatter `id: ...`).
  const knowledgeDir = join(projectRoot, ".fabric", "knowledge");
  if (existsSync(knowledgeDir)) {
    const stack: string[] = [knowledgeDir];
    while (stack.length > 0) {
      const dir = stack.pop();
      if (dir === undefined) {
        continue;
      }
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(abs);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          let source: string;
          try {
            source = await readFile(abs, "utf8");
          } catch {
            continue;
          }
          const id = extractKnowledgeFrontmatterId(source);
          if (id === null) {
            continue;
          }
          const relPath = posix.join(".fabric/knowledge", abs.slice(knowledgeDir.length + 1).replace(/\\/gu, "/"));
          found.push({ stableId: id, relPath });
        }
      }
    }
  }

  const stableIdToFiles = new Map<string, string[]>();
  for (const { stableId, relPath } of found) {
    const existing = stableIdToFiles.get(stableId) ?? [];
    existing.push(relPath);
    stableIdToFiles.set(stableId, existing);
  }

  const collisions: StableIdCollision[] = [];
  for (const [stable_id, files] of stableIdToFiles) {
    if (files.length > 1) {
      collisions.push({ stable_id, files: files.sort() });
    }
  }

  return { collisions: collisions.sort((a, b) => a.stable_id.localeCompare(b.stable_id)) };
}

// Match a YAML frontmatter `id:` field whose value matches the v2.0 stable_id
// shape K[PT]-{TYPE}-{COUNTER}. Returns null when no match (e.g. no frontmatter,
// no `id` key, or non-knowledge id format).
function extractKnowledgeFrontmatterId(source: string): string | null {
  const FM_PATTERN = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---/u;
  const fm = FM_PATTERN.exec(source);
  if (fm === null) {
    return null;
  }
  const block = fm[1];
  const ID_LINE = /^id:\s*("?)(K[PT]-(?:MOD|DEC|GLD|PIT|PRO)-\d{4,})\1\s*$/mu;
  const idMatch = ID_LINE.exec(block);
  return idMatch === null ? null : idMatch[2];
}

function inspectCounterDesync(meta: MetaInspection): CounterDesyncInspection {
  // counter_desync: a node has stable_id KP-DEC-0007 but agents.meta.json's
  // counters.KP.DEC says 5 (i.e. less than the observed counter). The fix is
  // to bump counters[layer][type] to max(observed, current) for every (layer,
  // type) pair where a desync is detected. We only report when:
  //   - meta is valid AND
  //   - at least one observed counter exceeds its current value.
  if (!meta.valid || meta.meta === null) {
    return { desyncs: [], correctedCounters: null };
  }

  // Establish the current counters envelope (use schema defaults when omitted).
  const current = AgentsMetaCountersSchema.parse(meta.meta.counters ?? undefined);
  const observed: Record<"KP" | "KT", Record<"MOD" | "DEC" | "GLD" | "PIT" | "PRO", number>> = {
    KP: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 },
    KT: { MOD: 0, DEC: 0, GLD: 0, PIT: 0, PRO: 0 },
  };

  for (const node of Object.values(meta.meta.nodes)) {
    const id = node.stable_id;
    if (id === undefined) {
      continue;
    }
    const parsed = parseKnowledgeId(id);
    if (parsed === null) {
      continue;
    }
    const layer = parsed.layer === "personal" ? "KP" : "KT";
    const typeCode = ([
      ["model", "MOD"],
      ["decision", "DEC"],
      ["guideline", "GLD"],
      ["pitfall", "PIT"],
      ["process", "PRO"],
    ] as const).find(([t]) => t === parsed.type)?.[1];
    if (typeCode === undefined) {
      continue;
    }
    if (parsed.counter > observed[layer][typeCode]) {
      observed[layer][typeCode] = parsed.counter;
    }
  }

  const desyncs: CounterDesyncEntry[] = [];
  const corrected: AgentsMetaCounters = {
    KP: { ...current.KP },
    KT: { ...current.KT },
  };
  for (const layer of ["KP", "KT"] as const) {
    for (const code of COUNTER_TYPE_CODES) {
      const obs = observed[layer][code];
      const cur = current[layer][code];
      if (obs > cur) {
        desyncs.push({ layer, type: code, observed: obs, current: cur });
        corrected[layer][code] = obs;
      }
    }
  }

  return {
    desyncs,
    correctedCounters: desyncs.length === 0 ? null : corrected,
  };
}

function createCounterDesyncCheck(inspection: CounterDesyncInspection): DoctorCheck {
  if (inspection.desyncs.length > 0) {
    const first = inspection.desyncs[0];
    const detail = `counters.${first.layer}.${first.type} = ${first.current} but observed K${first.layer === "KP" ? "P" : "T"}-${first.type}-${String(first.observed).padStart(4, "0")}`;
    return issueCheck(
      "Knowledge counter desync",
      "error",
      "fixable_error",
      "counter_desync",
      `${inspection.desyncs.length} knowledge counter${inspection.desyncs.length === 1 ? "" : "s"} desynced from observed stable_ids. ${detail}. Run \`fab doctor --fix\` to bump counters.`,
      "Run `fab doctor --fix` to bump agents.meta.json counters to the maximum observed counter value.",
    );
  }
  return okCheck("Knowledge counter desync", "agents.meta.json counters envelope is consistent with observed stable_ids.");
}

function inspectLegacyV1Artifacts(projectRoot: string): LegacyV1ArtifactsInspection {
  const detected = LEGACY_V1_ARTIFACT_PATHS.filter((rel) => existsSync(join(projectRoot, rel)));
  return { detected: [...detected] };
}

function createLegacyV1ArtifactsCheck(inspection: LegacyV1ArtifactsInspection): DoctorCheck {
  if (inspection.detected.length > 0) {
    return issueCheck(
      "Legacy v1 artifacts",
      "warn",
      "warning",
      "legacy_v1_artifacts_present",
      `Detected ${inspection.detected.length} legacy v1.x artifact${inspection.detected.length === 1 ? "" : "s"}: ${inspection.detected.join(", ")}. These are not used by Fabric v2.0 and can be removed manually.`,
      "Review and manually delete the listed paths if you have already migrated to v2.0; see docs/migration-2.0.md for details.",
    );
  }
  return okCheck("Legacy v1 artifacts", "No legacy v1.x artifacts detected (.fabric/rules/, INITIAL_TAXONOMY.md, .fabric/bootstrap/, .fabric-v1-archive/).");
}

function createStableIdCollisionCheck(inspection: StableIdCollisionInspection): DoctorCheck {
  if (inspection.collisions.length > 0) {
    const first = inspection.collisions[0];
    const detail = inspection.collisions.length === 1
      ? `stable_id "${first.stable_id}" is declared in ${first.files.length} files: ${first.files.join(", ")}.`
      : `${inspection.collisions.length} stable_id collision${inspection.collisions.length === 1 ? "" : "s"} detected. First: "${first.stable_id}" in ${first.files.join(", ")}.`;
    return issueCheck(
      "Stable ID collision",
      "warn",
      "warning",
      "stable_id_collision",
      `${detail} Edit one of the rule files to use a unique stable_id.`,
      "Edit one of the colliding rule files to declare a different `<!-- fab:rule-id X -->` value.",
    );
  }
  return okCheck("Stable ID collision", "No declared stable_id collisions found in .fabric/rules/.");
}

function createMetaManuallyDivergedCheck(inspection: MetaManuallyDivergedInspection): DoctorCheck {
  if (!inspection.readable) {
    // meta unreadable is already surfaced by createMetaCheck; skip here
    return okCheck("Meta manual divergence", "agents.meta.json not readable; skipping divergence check.");
  }

  if (inspection.extraMetaEntries.length > 0) {
    return issueCheck(
      "Meta manual divergence",
      "warn",
      "warning",
      "meta_manually_diverged",
      `agents.meta.json has ${inspection.extraMetaEntries.length} entr${inspection.extraMetaEntries.length === 1 ? "y" : "ies"} with no backing file on disk. Run --fix to reconcile.`,
      "Run `fab doctor --fix` to reconcile agents.meta.json with the rule files currently on disk.",
    );
  }

  if (inspection.hashMismatchEntries.length > 0) {
    return issueCheck(
      "Meta manual divergence",
      "warn",
      "warning",
      "meta_manually_diverged",
      `agents.meta.json has ${inspection.hashMismatchEntries.length} entr${inspection.hashMismatchEntries.length === 1 ? "y" : "ies"} whose hash does not match the file on disk. Run --fix to reconcile.`,
      "Run `fab doctor --fix` to reconcile agents.meta.json with the current rule file contents.",
    );
  }

  return okCheck("Meta manual divergence", "agents.meta.json is consistent with rule files on disk.");
}

function inspectPreexistingRootFiles(projectRoot: string): PreexistingRootFilesInspection {
  const candidates = ["CLAUDE.md", "AGENTS.md"];
  const detected = candidates.filter((name) => existsSync(join(projectRoot, name)));
  return { detected };
}

function createPreexistingRootFilesCheck(inspection: PreexistingRootFilesInspection): DoctorCheck {
  if (inspection.detected.length === 0) {
    return okCheck("Preexisting root markdown", "No CLAUDE.md or AGENTS.md detected at project root.");
  }
  return {
    name: "Preexisting root markdown",
    status: "ok",
    kind: "info",
    code: "preexisting_root_claude_md",
    fixable: false,
    message: `${inspection.detected.join(", ")} detected at project root. These root files are not auto-loaded by Fabric MCP.`,
    actionHint: "Move rule content to `.fabric/rules/` if you want it available in MCP responses.",
  };
}

function inspectClaudeSkillLegacyPath(projectRoot: string): ClaudeSkillLegacyPathInspection {
  const legacyPath = join(projectRoot, ".claude", "skills", "agents-md-init", "SKILL.md");
  const newPath = join(projectRoot, ".claude", "skills", "fabric-init", "SKILL.md");
  const hasLegacy = existsSync(legacyPath) && !existsSync(newPath);
  return { hasLegacy, legacyPath, newPath };
}

function createClaudeSkillLegacyPathCheck(inspection: ClaudeSkillLegacyPathInspection): DoctorCheck {
  if (inspection.hasLegacy) {
    return issueCheck(
      "Claude skill path",
      "error",
      "fixable_error",
      "claude_skill_legacy_path",
      `.claude/skills/agents-md-init/SKILL.md exists at the legacy path. Run --fix to migrate it to .claude/skills/fabric-init/SKILL.md (user edits preserved).`,
      "Run `fab doctor --fix` to rename agents-md-init/ to fabric-init/, preserving any user edits to SKILL.md.",
    );
  }
  return okCheck("Claude skill path", ".claude/skills/fabric-init/SKILL.md is at the canonical path (or not present).");
}

async function fixClaudeSkillLegacyPath(projectRoot: string): Promise<void> {
  const legacyPath = join(projectRoot, ".claude", "skills", "agents-md-init", "SKILL.md");
  const newPath = join(projectRoot, ".claude", "skills", "fabric-init", "SKILL.md");

  if (!existsSync(legacyPath)) {
    return;
  }

  mkdirSync(join(newPath, ".."), { recursive: true });
  renameSync(legacyPath, newPath);

  // Remove the now-empty legacy directory if it is empty
  const legacyDir = join(legacyPath, "..");
  try {
    rmdirSync(legacyDir);
  } catch {
    // Directory not empty or already removed — ignore
  }

  await appendEventLedgerEvent(projectRoot, {
    event_type: "claude_skill_path_migrated",
    from: legacyPath,
    to: newPath,
  });
}

const LEGACY_HOOK_FILENAME = "agents-md-init-reminder.cjs";
const NEW_HOOK_FILENAME = "fabric-init-reminder.cjs";

function inspectClaudeHookLegacyPath(projectRoot: string): ClaudeHookLegacyPathInspection {
  const legacyHookPath = join(projectRoot, ".claude", "hooks", LEGACY_HOOK_FILENAME);
  const newHookPath = join(projectRoot, ".claude", "hooks", NEW_HOOK_FILENAME);
  const settingsPath = join(projectRoot, ".claude", "settings.json");

  const hasLegacyFile = existsSync(legacyHookPath);

  let hasLegacySettingsCommand = false;
  if (existsSync(settingsPath)) {
    try {
      const raw = readFileSync(settingsPath, "utf8");
      hasLegacySettingsCommand = raw.includes(LEGACY_HOOK_FILENAME);
    } catch {
      // Ignore unreadable settings file — nothing to migrate.
    }
  }

  return { hasLegacyFile, hasLegacySettingsCommand, legacyHookPath, newHookPath, settingsPath };
}

function createClaudeHookLegacyPathCheck(inspection: ClaudeHookLegacyPathInspection): DoctorCheck {
  if (inspection.hasLegacyFile || inspection.hasLegacySettingsCommand) {
    return issueCheck(
      "Claude hook path",
      "error",
      "fixable_error",
      "claude_hook_legacy_path",
      `.claude/hooks/${LEGACY_HOOK_FILENAME} (or its reference in .claude/settings.json) exists at the legacy path. Run --fix to migrate to ${NEW_HOOK_FILENAME}.`,
      `Run \`fab doctor --fix\` to rename ${LEGACY_HOOK_FILENAME} to ${NEW_HOOK_FILENAME} and update .claude/settings.json hook commands.`,
    );
  }
  return okCheck("Claude hook path", `.claude/hooks/${NEW_HOOK_FILENAME} is at the canonical path (or not present).`);
}

async function fixClaudeHookLegacyPath(projectRoot: string): Promise<void> {
  const { hasLegacyFile, hasLegacySettingsCommand, legacyHookPath, newHookPath, settingsPath } =
    inspectClaudeHookLegacyPath(projectRoot);

  if (hasLegacyFile) {
    if (existsSync(newHookPath)) {
      unlinkSync(legacyHookPath);
    } else {
      mkdirSync(join(newHookPath, ".."), { recursive: true });
      renameSync(legacyHookPath, newHookPath);
    }
  }

  if (hasLegacySettingsCommand) {
    try {
      const raw = readFileSync(settingsPath, "utf8");
      const updated = raw.split(LEGACY_HOOK_FILENAME).join(NEW_HOOK_FILENAME);
      if (updated !== raw) {
        const parsed = JSON.parse(updated) as unknown;
        await atomicWriteJson(settingsPath, parsed);
      }
    } catch {
      // If settings.json is malformed, leave it alone — user will see other doctor warnings.
    }
  }

  if (hasLegacyFile || hasLegacySettingsCommand) {
    await appendEventLedgerEvent(projectRoot, {
      event_type: "claude_hook_path_migrated",
      from: legacyHookPath,
      to: newHookPath,
    });
  }
}

function inspectCodexSkillLegacyPath(projectRoot: string): CodexSkillLegacyPathInspection {
  const legacyPath = join(projectRoot, ".agents", "skills", "fabric-init", "SKILL.md");
  const newPath = join(projectRoot, ".codex", "skills", "fabric-init", "SKILL.md");
  const hasLegacy = existsSync(legacyPath) && !existsSync(newPath);
  return { hasLegacy, legacyPath, newPath };
}

function createCodexSkillLegacyPathCheck(inspection: CodexSkillLegacyPathInspection): DoctorCheck {
  if (inspection.hasLegacy) {
    return issueCheck(
      "Codex skill path",
      "error",
      "fixable_error",
      "codex_skill_legacy_path",
      `.agents/skills/fabric-init/SKILL.md exists at the legacy path. Codex CLI reads repo skills from .codex/skills/, not .agents/skills/. Run --fix to migrate it to .codex/skills/fabric-init/SKILL.md (user edits preserved).`,
      "Run `fab doctor --fix` to move .agents/skills/fabric-init/ to .codex/skills/fabric-init/, preserving any user edits to SKILL.md.",
    );
  }
  return okCheck("Codex skill path", ".codex/skills/fabric-init/SKILL.md is at the canonical path (or not present).");
}

async function fixCodexSkillLegacyPath(projectRoot: string): Promise<void> {
  const { hasLegacy, legacyPath, newPath } = inspectCodexSkillLegacyPath(projectRoot);
  if (!hasLegacy) {
    return;
  }

  mkdirSync(join(newPath, ".."), { recursive: true });
  renameSync(legacyPath, newPath);

  const legacyDir = join(legacyPath, "..");
  try {
    rmdirSync(legacyDir);
  } catch {
    // Directory not empty or already removed — ignore
  }
  // Also try to remove the .agents/skills/ parent if now empty.
  try {
    rmdirSync(join(legacyDir, ".."));
  } catch {
    // ignore
  }
  // And .agents/ itself if empty.
  try {
    rmdirSync(join(legacyDir, "..", ".."));
  } catch {
    // ignore
  }

  await appendEventLedgerEvent(projectRoot, {
    event_type: "codex_skill_path_migrated",
    from: legacyPath,
    to: newPath,
  });
}

function inspectLegacyClientPaths(projectRoot: string): LegacyClientPathInspection {
  const configPath = join(projectRoot, "fabric.config.json");
  if (!existsSync(configPath)) {
    return { presentKeys: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { presentKeys: [] };
    }
    const config = parsed as Record<string, unknown>;
    const clientPaths = config.clientPaths;
    if (clientPaths === null || typeof clientPaths !== "object" || Array.isArray(clientPaths)) {
      return { presentKeys: [] };
    }
    const cp = clientPaths as Record<string, unknown>;
    const presentKeys = LEGACY_CLIENT_PATH_KEYS.filter((key) => key in cp);
    return { presentKeys };
  } catch {
    return { presentKeys: [] };
  }
}

function createLegacyClientPathCheck(inspection: LegacyClientPathInspection): DoctorCheck {
  if (inspection.presentKeys.length > 0) {
    return issueCheck(
      "Legacy client paths",
      "warn",
      "warning",
      "legacy_client_path_present",
      `fabric.config.json contains deprecated clientPaths keys: ${inspection.presentKeys.join(", ")}. These clients are removed in 1.8.0; run --fix to clean now or accept the upcoming removal.`,
      "Run `fab doctor --fix` to remove deprecated clientPaths keys (windsurf, rooCode, geminiCLI) from fabric.config.json.",
    );
  }
  return okCheck("Legacy client paths", "No deprecated clientPaths keys found in fabric.config.json.");
}

async function fixLegacyClientPaths(projectRoot: string): Promise<void> {
  const configPath = join(projectRoot, "fabric.config.json");
  if (!existsSync(configPath)) {
    return;
  }

  let config: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return;
    }
    config = parsed as Record<string, unknown>;
  } catch {
    return;
  }

  const clientPaths = config.clientPaths;
  if (clientPaths === null || typeof clientPaths !== "object" || Array.isArray(clientPaths)) {
    return;
  }

  const cp = clientPaths as Record<string, unknown>;
  const removed: string[] = [];

  for (const key of LEGACY_CLIENT_PATH_KEYS) {
    if (key in cp) {
      delete cp[key];
      removed.push(key);
    }
  }

  if (removed.length === 0) {
    return;
  }

  const updatedConfig = { ...config, clientPaths: cp };
  await atomicWriteJson(configPath, updatedConfig, { indent: 2 });
  await appendEventLedgerEvent(projectRoot, {
    event_type: "legacy_client_path_present",
    removed,
  });
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

async function ensureKnowledgeSubdirs(projectRoot: string): Promise<void> {
  // v2.0 layout: ensure all required .fabric/knowledge/{type}/ subdirectories
  // exist. Idempotent — `mkdir({recursive: true})` succeeds when the dir is
  // already present. Does NOT touch any user content.
  for (const sub of KNOWLEDGE_SUBDIRS) {
    await mkdir(join(projectRoot, ".fabric", "knowledge", sub), { recursive: true });
  }
}

async function fixCounterDesync(projectRoot: string): Promise<void> {
  // Read current agents.meta.json, recompute the corrected counters envelope
  // from observed stable_ids, and write the meta back atomically. Stops if
  // meta is missing or unparseable (other doctor checks will surface those).
  const metaPath = join(projectRoot, ".fabric", "agents.meta.json");
  if (!existsSync(metaPath)) {
    return;
  }
  let meta: AgentsMeta;
  try {
    meta = agentsMetaSchema.parse(JSON.parse(await readFile(metaPath, "utf8")));
  } catch {
    return;
  }

  // Re-derive corrected counters using the same algorithm as inspectCounterDesync.
  const synthetic: MetaInspection = {
    present: true,
    valid: true,
    meta,
    revision: meta.revision,
    computedRevision: null,
    ruleCount: 0,
    missingContentRefs: [],
    invalidContentRefs: [],
    stale: false,
    changed: false,
  };
  const desync = inspectCounterDesync(synthetic);
  if (desync.desyncs.length === 0 || desync.correctedCounters === null) {
    return;
  }

  const updated: AgentsMeta = { ...meta, counters: desync.correctedCounters };
  await atomicWriteJson(metaPath, updated, { indent: 2 });
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
