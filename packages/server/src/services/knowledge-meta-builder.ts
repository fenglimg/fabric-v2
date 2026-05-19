import { mkdir, readdir, readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  KNOWLEDGE_TEST_INDEX_SCHEMA_VERSION,
  agentsMetaSchema,
  defaultAgentsMetaCounters,
  deriveAgentsMetaLayer,
  deriveAgentsMetaStableId,
  deriveAgentsMetaTopologyType,
  isKnowledgeStableId,
  knowledgeTestIndexSchema,
  KnowledgeTypeSchema,
  MaturitySchema,
  LayerSchema,
  StableIdSchema,
  parseKnowledgeId,
  type AgentsIdentitySource,
  type AgentsLayer,
  type AgentsMeta,
  type AgentsTopologyType,
  type KnowledgeType,
  type Layer as KnowledgeLayer,
  type Maturity,
  type RuleDescription,
  type KnowledgeTestIndex,
} from "@fenglimg/fabric-shared";

import { appendEventLedgerEvent } from "./event-ledger.js";
import { atomicWriteText } from "@fenglimg/fabric-shared/node/atomic-write";
import { ensureParentDirectory, sha256 } from "./_shared.js";

type NodeMeta = AgentsMeta["nodes"][string];

type RuleIdentity = {
  stableId: string;
  identitySource: AgentsIdentitySource;
};

type MetaDriftDetail = {
  file: string;
  stable_id: string;
  expected_hash: string;
  actual_hash: string | null;
};

type FabricVerifyAnnotation = {
  stableId: string;
  testFile: string;
  testHash: string;
  line: number;
};

export type KnowledgeMetaBuildSource = "doctor_fix" | "sync_meta";

export type KnowledgeMetaBuildResult = {
  meta: AgentsMeta;
  knowledgeTestIndex: KnowledgeTestIndex;
  changed: boolean;
};

export type WriteKnowledgeMetaOptions = {
  source: KnowledgeMetaBuildSource;
};

/**
 * v2.0-rc.24 TASK-07: Load a Map<stable_id, knowledge_type> from the
 * project's `.fabric/agents.meta.json`. Consumed by the doctor cite-coverage
 * routing (TASK-08) to dispatch cites to the correct policy bucket
 * (decision/pitfall = strict contract / model = reference-only /
 * guideline+process = deferred to rc.25 LLM-judge). Cited ids absent from
 * this map fall into the `cite_id_unresolved` bucket.
 *
 * **Singular knowledge_type contract (rc.24 lock):** the returned map values
 * are the SINGULAR `KnowledgeType` enum (`"model" | "decision" | "guideline"
 * | "pitfall" | "process"`) — matching both the on-disk `agents.meta.json`
 * storage AND the canonical `KnowledgeTypeSchema` exported from
 * `@fenglimg/fabric-shared`. No normalization happens at this boundary; the
 * loader is a thin extract over engine-maintained meta. Downstream callers
 * (TASK-08 doctor) must match against the singular enum.
 *
 * Both team (KT-*) and personal (KP-*) entries are included — they live in
 * the same `meta.nodes` map.
 *
 * Graceful on failure: a missing meta file, malformed JSON, or schema
 * validation failure all yield an empty Map (no throw). The doctor will then
 * surface every cite as `cite_id_unresolved`, which is the safe degraded
 * mode.
 */
export async function loadKbIdTypeMap(projectRootInput: string): Promise<Map<string, KnowledgeType>> {
  const projectRoot = normalizeProjectRoot(projectRootInput);
  const metaPath = join(projectRoot, ".fabric", "agents.meta.json");
  const meta = await readExistingMeta(metaPath);
  const map = new Map<string, KnowledgeType>();

  if (meta === undefined) {
    return map;
  }

  for (const node of Object.values(meta.nodes)) {
    const stableId = node.stable_id;
    if (stableId === undefined || !isKnowledgeStableId(stableId)) {
      continue;
    }
    const knowledgeType = node.description?.knowledge_type;
    if (knowledgeType === undefined) {
      continue;
    }
    map.set(stableId, knowledgeType);
  }

  return map;
}

export async function buildKnowledgeMeta(projectRootInput: string): Promise<KnowledgeMetaBuildResult> {
  const projectRoot = normalizeProjectRoot(projectRootInput);
  assertExistingDirectory(projectRoot);

  const metaPath = join(projectRoot, ".fabric", "agents.meta.json");
  const knowledgeTestIndexPath = join(projectRoot, ".fabric", ".cache", "knowledge-test.index.json");
  const existingMeta = await readExistingMeta(metaPath);
  const existingKnowledgeTestIndex = await readExistingKnowledgeTestIndex(knowledgeTestIndexPath);
  const meta = await computeKnowledgeBasedAgentsMeta(projectRoot, existingMeta);
  const knowledgeTestIndex = await computeKnowledgeTestIndex(projectRoot, meta, existingKnowledgeTestIndex);

  return {
    meta,
    knowledgeTestIndex,
    changed:
      existingMeta === undefined ||
      stableStringify(existingMeta) !== stableStringify(meta) ||
      existingKnowledgeTestIndex === undefined ||
      !isSameKnowledgeTestIndex(existingKnowledgeTestIndex, knowledgeTestIndex),
  };
}

export async function writeKnowledgeMeta(
  projectRootInput: string,
  options: WriteKnowledgeMetaOptions,
): Promise<KnowledgeMetaBuildResult> {
  const projectRoot = normalizeProjectRoot(projectRootInput);
  const metaPath = join(projectRoot, ".fabric", "agents.meta.json");
  const knowledgeTestIndexPath = join(projectRoot, ".fabric", ".cache", "knowledge-test.index.json");
  const existingMeta = await readExistingMeta(metaPath);
  const result = await buildKnowledgeMeta(projectRoot);

  if (!result.changed) {
    return result;
  }

  await ensureParentDirectory(metaPath);
  await atomicWriteText(metaPath, `${JSON.stringify(result.meta, null, 2)}\n`);
  // v2/rc.2: cache lives under `.fabric/.cache/` (gitignored). Ensure the
  // subdirectory exists before atomicWriteText — first scan in a fresh repo
  // would otherwise ENOENT on the missing parent.
  await ensureParentDirectory(knowledgeTestIndexPath);
  await atomicWriteText(knowledgeTestIndexPath, `${JSON.stringify(result.knowledgeTestIndex, null, 2)}\n`);

  if (existingMeta === undefined || stableStringify(existingMeta) !== stableStringify(result.meta)) {
    await recordBaselineSynced(projectRoot, {
      previousRevision: existingMeta?.revision,
      revision: result.meta.revision,
      syncedFiles: collectSyncedFiles(existingMeta, result.meta),
      acceptedStableIds: collectStableIds(result.meta),
      driftDetails: collectDriftDetails(existingMeta, result.meta),
      source: options.source,
    });
  }

  return result;
}

export async function computeKnowledgeBasedAgentsMeta(
  projectRootInput: string,
  existingMeta?: AgentsMeta,
): Promise<AgentsMeta> {
  const projectRoot = normalizeProjectRoot(projectRootInput);
  assertExistingDirectory(projectRoot);

  const previousMeta = existingMeta ?? await readExistingMeta(join(projectRoot, ".fabric", "agents.meta.json"));
  const existingByContentRef = indexExistingNodesByContentRef(previousMeta);
  const ruleFiles = await findKnowledgeFiles(projectRoot);
  const nodes: Record<string, NodeMeta> = {};

  // v2.0: there is no longer a single L0 anchor file. Knowledge entries
  // under `.fabric/knowledge/{decisions,pitfalls,guidelines,models,processes,pending}/`
  // are the content of record. The L0/L1/L2 layer protocol still drives rule
  // precedence (priority/scope_glob), but no bootstrap/README.md is required
  // as a "default L0 node" — empty repos persist as `nodes: {}`.

  for (const contentRef of ruleFiles) {
    const source = await readFile(resolveContentRefPath(projectRoot, contentRef), "utf8");
    const existing = existingByContentRef.get(contentRef);
    const hash = sha256(source);
    const defaults = createDefaultNodeMeta(contentRef);
    const identity = deriveRuleIdentity(contentRef, source, existing?.node);
    // v2.0: knowledge entries are keyed by their declared id (KP-/KT-...) so
    // the persisted node key matches what init-scan's
    // `registerKnowledgeNodesInMeta` writes — avoiding duplicate nodes when
    // both pipelines see the same file. Path-keyed ids remain as a fallback
    // for hand-authored knowledge files that have not yet been allocated a
    // declared id (e.g. drafts).
    const id = isKnowledgeStableId(identity.stableId) ? identity.stableId : deriveNodeId(contentRef);

    nodes[id] = {
      ...defaults,
      ...existing?.node,
      file: contentRef,
      content_ref: contentRef,
      hash,
      stable_id: identity.stableId,
      identity_source: identity.identitySource,
      description: extractRuleDescription(source) ?? existing?.node.description,
      sections: extractRuleSections(source),
    };
  }

  // v2.0: Always serialize the counters envelope (default-zero when v1.x meta
  // had no `counters` key) so the persisted file is forward-compatible with
  // the KnowledgeIdAllocator.
  const counters = previousMeta?.counters ?? defaultAgentsMetaCounters();

  return {
    ...(previousMeta ?? {}),
    revision: computeRevision(nodes),
    nodes: sortNodes(nodes),
    counters,
  };
}

export async function computeKnowledgeTestIndex(
  projectRootInput: string,
  computedMeta: AgentsMeta,
  previousIndex?: KnowledgeTestIndex,
): Promise<KnowledgeTestIndex> {
  const projectRoot = normalizeProjectRoot(projectRootInput);
  assertExistingDirectory(projectRoot);

  const previousLinks = indexPreviousRuleTestEntries(previousIndex?.links ?? []);
  const previousOrphans = indexPreviousRuleTestEntries(previousIndex?.orphan_annotations ?? []);
  const rulesByStableId = indexRulesByStableId(computedMeta);
  const links: KnowledgeTestIndex["links"] = [];
  const orphanAnnotations: KnowledgeTestIndex["orphan_annotations"] = [];

  for (const annotation of await findFabricVerifyAnnotations(projectRoot)) {
    const rule = rulesByStableId.get(annotation.stableId);
    const key = createRuleTestEntryKey(annotation.stableId, annotation.testFile, annotation.line);

    if (rule === undefined) {
      const previous = previousOrphans.get(key) ?? previousLinks.get(key);
      orphanAnnotations.push({
        rule_stable_id: annotation.stableId,
        test_file: annotation.testFile,
        test_hash: annotation.testHash,
        previous_test_hash: getPreviousTestHash(previous, annotation.testHash),
        annotation_line: annotation.line,
      });
      continue;
    }

    const previous = previousLinks.get(key) ?? previousOrphans.get(key);
    const previousHashes = getPreviousRuleTestHashes(previous, rule.hash, annotation.testHash);
    links.push({
      rule_stable_id: annotation.stableId,
      rule_file: rule.content_ref ?? rule.file,
      rule_hash: rule.hash,
      previous_rule_hash: previousHashes.previousRuleHash,
      test_file: annotation.testFile,
      test_hash: annotation.testHash,
      previous_test_hash: previousHashes.previousTestHash,
      annotation_line: annotation.line,
    });
  }

  return {
    schema_version: KNOWLEDGE_TEST_INDEX_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    revision: computedMeta.revision,
    previous_revision:
      previousIndex?.revision !== undefined && previousIndex.revision !== computedMeta.revision
        ? previousIndex.revision
        : previousIndex?.previous_revision,
    links: links.sort(compareRuleTestEntries),
    orphan_annotations: orphanAnnotations.sort(compareRuleTestEntries),
  };
}

export function deriveKnowledgeMetaLayer(relativePath: string): AgentsLayer {
  return deriveAgentsMetaLayer(toAgentsCompatiblePath(relativePath));
}

export function deriveKnowledgeMetaTopologyType(relativePath: string): AgentsTopologyType {
  return deriveAgentsMetaTopologyType(toAgentsCompatiblePath(relativePath));
}

export function isSameKnowledgeTestIndex(left: KnowledgeTestIndex, right: KnowledgeTestIndex): boolean {
  return stableStringify(toComparableKnowledgeTestIndex(left)) === stableStringify(toComparableKnowledgeTestIndex(right));
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(value, Object.keys(flattenKeys(value)).sort());
}

function normalizeProjectRoot(projectRoot: string): string {
  return isAbsolute(projectRoot) ? projectRoot : resolve(process.cwd(), projectRoot);
}

function assertExistingDirectory(projectRoot: string): void {
  if (!existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) {
    throw new Error(`Target directory does not exist: ${projectRoot}`);
  }
}

async function readExistingMeta(metaPath: string): Promise<AgentsMeta | undefined> {
  let raw: string;
  try {
    raw = await readFile(metaPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }

  try {
    return agentsMetaSchema.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

async function readExistingKnowledgeTestIndex(indexPath: string): Promise<KnowledgeTestIndex | undefined> {
  let raw: string;
  try {
    raw = await readFile(indexPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }

  try {
    return knowledgeTestIndexSchema.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

// v2.0 dual-root layout — knowledge entries live under either the team root
// (`.fabric/knowledge/<subdir>/`) or the personal root (`~/.fabric/knowledge/<subdir>/`).
// pending/ is included so unreviewed entries surface in description_index for
// future review flows; their maturity comes from frontmatter, not the subdir.
const KNOWLEDGE_SUBDIRS = ["decisions", "pitfalls", "guidelines", "models", "processes", "pending"] as const;

const PERSONAL_CONTENT_REF_PREFIX = "~/.fabric/knowledge/";
const TEAM_CONTENT_REF_PREFIX = ".fabric/knowledge/";

/**
 * v2.0: Resolve a personal-root content_ref (`~/.fabric/knowledge/...`) back
 * to an absolute filesystem path. Test-friendly via the FABRIC_HOME env var
 * (falls back to os.homedir()).
 */
function resolvePersonalRoot(): string {
  return process.env.FABRIC_HOME ?? homedir();
}

/**
 * v2.0: Resolve a content_ref (relative to its respective root) to an
 * absolute filesystem path. Handles both team (project-relative) and personal
 * (`~/...`) entries.
 */
function resolveContentRefPath(projectRoot: string, contentRef: string): string {
  if (contentRef.startsWith(PERSONAL_CONTENT_REF_PREFIX)) {
    return join(resolvePersonalRoot(), ".fabric", "knowledge", contentRef.slice(PERSONAL_CONTENT_REF_PREFIX.length));
  }
  return join(projectRoot, contentRef);
}

async function findKnowledgeFiles(projectRoot: string): Promise<string[]> {
  const teamRoot = join(projectRoot, ".fabric", "knowledge");
  const personalRoot = join(resolvePersonalRoot(), ".fabric", "knowledge");

  // Auto-mkdir the personal root tree on first scan (idempotent). Mirrors the
  // doctor.ts pattern for missing knowledge subdirs — keeps the scan
  // side-effect-free for callers but materializes the canonical layout.
  try {
    await mkdir(personalRoot, { recursive: true });
    for (const sub of KNOWLEDGE_SUBDIRS) {
      await mkdir(join(personalRoot, sub), { recursive: true });
    }
  } catch {
    // Personal-root creation is best-effort: a read-only home dir or unusual
    // FABRIC_HOME override must not block team-only repos from indexing.
  }

  const files: string[] = [];

  // v2.0 dual-root scan — knowledge subdirs under team and personal roots.
  for (const [root, prefix] of [
    [teamRoot, TEAM_CONTENT_REF_PREFIX] as const,
    [personalRoot, PERSONAL_CONTENT_REF_PREFIX] as const,
  ]) {
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      continue;
    }

    for (const subdir of KNOWLEDGE_SUBDIRS) {
      const dir = join(root, subdir);
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
          continue;
        }
        throw error;
      }

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          files.push(`${prefix}${subdir}/${entry.name}`);
        }
      }
    }
  }

  return files.sort();
}

async function findFabricVerifyAnnotations(projectRoot: string): Promise<FabricVerifyAnnotation[]> {
  const files = await findTestFiles(projectRoot);
  const annotations: FabricVerifyAnnotation[] = [];
  const annotationPattern = /^\s*\/\/\s*@fabric-verify\s+([A-Za-z0-9][A-Za-z0-9/_-]*)\s*$/u;

  for (const testFile of files) {
    const source = await readFile(join(projectRoot, testFile), "utf8");
    const testHash = sha256(source);
    const lines = source.split(/\r?\n/u);

    for (const [index, line] of lines.entries()) {
      const match = annotationPattern.exec(line);
      if (match === null) {
        continue;
      }

      annotations.push({
        stableId: match[1],
        testFile,
        testHash,
        line: index + 1,
      });
    }
  }

  return annotations.sort(compareAnnotationEntries);
}

async function findTestFiles(projectRoot: string): Promise<string[]> {
  const ignoredRootSegments = new Set([".git", ".fabric", "node_modules", "dist", "build", "coverage"]);
  const files: string[] = [];
  const stack = [projectRoot];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }

    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolutePath = join(current, entry.name);
      const relativePath = toPosixPath(relative(projectRoot, absolutePath));
      const [rootSegment] = relativePath.split("/");

      if (entry.isDirectory()) {
        if (!ignoredRootSegments.has(rootSegment) && !ignoredRootSegments.has(entry.name)) {
          stack.push(absolutePath);
        }
        continue;
      }

      if (entry.isFile() && isTestFile(relativePath)) {
        files.push(relativePath);
      }
    }
  }

  return files.sort();
}

function isTestFile(relativePath: string): boolean {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(relativePath);
}

function indexRulesByStableId(meta: AgentsMeta): Map<string, NodeMeta> {
  const rules = new Map<string, NodeMeta>();

  for (const node of Object.values(meta.nodes)) {
    if (node.stable_id !== undefined) {
      rules.set(node.stable_id, node);
    }
  }

  return rules;
}

function indexPreviousRuleTestEntries(
  entries: Array<
    Pick<KnowledgeTestIndex["links"][number], "rule_stable_id" | "test_file" | "test_hash" | "annotation_line"> &
      Partial<Pick<KnowledgeTestIndex["links"][number], "rule_hash" | "previous_rule_hash" | "previous_test_hash">>
  >,
): Map<string, { rule_hash?: string; previous_rule_hash?: string; test_hash: string; previous_test_hash?: string }> {
  const previous = new Map<
    string,
    { rule_hash?: string; previous_rule_hash?: string; test_hash: string; previous_test_hash?: string }
  >();

  for (const entry of entries) {
    previous.set(createRuleTestEntryKey(entry.rule_stable_id, entry.test_file, entry.annotation_line), {
      rule_hash: entry.rule_hash,
      previous_rule_hash: entry.previous_rule_hash,
      test_hash: entry.test_hash,
      previous_test_hash: entry.previous_test_hash,
    });
  }

  return previous;
}

function createRuleTestEntryKey(stableId: string, testFile: string, line: number): string {
  return `${stableId}\0${testFile}\0${line}`;
}

function getPreviousRuleTestHashes(
  previous:
    | { rule_hash?: string; previous_rule_hash?: string; test_hash: string; previous_test_hash?: string }
    | undefined,
  ruleHash: string,
  testHash: string,
): { previousRuleHash?: string; previousTestHash?: string } {
  if (previous === undefined) {
    return {};
  }

  return {
    previousRuleHash:
      previous.rule_hash !== undefined && previous.rule_hash !== ruleHash
        ? previous.rule_hash
        : previous.previous_rule_hash,
    previousTestHash: previous.test_hash !== testHash ? previous.test_hash : previous.previous_test_hash,
  };
}

function getPreviousTestHash(
  previous: { test_hash: string; previous_test_hash?: string } | undefined,
  testHash: string,
): string | undefined {
  if (previous === undefined) {
    return undefined;
  }

  return previous.test_hash !== testHash ? previous.test_hash : previous.previous_test_hash;
}

function compareRuleTestEntries(
  left: Pick<KnowledgeTestIndex["links"][number], "rule_stable_id" | "test_file" | "annotation_line">,
  right: Pick<KnowledgeTestIndex["links"][number], "rule_stable_id" | "test_file" | "annotation_line">,
): number {
  return (
    left.rule_stable_id.localeCompare(right.rule_stable_id) ||
    left.test_file.localeCompare(right.test_file) ||
    left.annotation_line - right.annotation_line
  );
}

function compareAnnotationEntries(left: FabricVerifyAnnotation, right: FabricVerifyAnnotation): number {
  return (
    left.stableId.localeCompare(right.stableId) ||
    left.testFile.localeCompare(right.testFile) ||
    left.line - right.line
  );
}

function toComparableKnowledgeTestIndex(index: KnowledgeTestIndex): Omit<KnowledgeTestIndex, "generated_at"> {
  const { generated_at: _generatedAt, ...comparable } = index;
  return comparable;
}

function indexExistingNodesByContentRef(existingMeta: AgentsMeta | undefined): Map<string, { id: string; node: NodeMeta }> {
  const byContentRef = new Map<string, { id: string; node: NodeMeta }>();

  for (const [id, node] of Object.entries(existingMeta?.nodes ?? {})) {
    byContentRef.set(toPosixPath(node.content_ref ?? node.file), { id, node });
  }

  return byContentRef;
}

function deriveNodeId(file: string): string {
  // v2.0: no special-cased "L0" node for `.fabric/bootstrap/README.md` —
  // knowledge entries (KP-/KT-...) and legacy rules use their derived ids.

  const layer = deriveKnowledgeMetaLayer(file);
  const relativeStem = getRuleRelativeStem(file);

  // v2.0: distinguish personal vs team knowledge entries that share the same
  // subdir/filename (e.g. team decisions/auth.md and personal decisions/auth.md
  // both stem to "decisions/auth") so the node-id remains unique per root.
  if (file.startsWith(PERSONAL_CONTENT_REF_PREFIX)) {
    return `${layer}/personal/${relativeStem}`;
  }
  if (file.startsWith(TEAM_CONTENT_REF_PREFIX)) {
    return `${layer}/team/${relativeStem}`;
  }

  return `${layer}/${relativeStem}`;
}

function createDefaultNodeMeta(contentRef: string): NodeMeta {
  const layer = deriveKnowledgeMetaLayer(contentRef);
  const topologyType = deriveKnowledgeMetaTopologyType(contentRef);

  return {
    file: contentRef,
    content_ref: contentRef,
    scope_glob: deriveScopeGlob(contentRef),
    deps: layer === "L0" ? [] : ["L0"],
    priority: layer === "L0" ? "high" : "medium",
    level: layer,
    layer,
    topology_type: topologyType,
    hash: "",
  };
}

function deriveScopeGlob(contentRef: string): string {
  // v2.0: .fabric/bootstrap/README.md is no longer recognized; the helper
  // falls through to the stem-based derivation below for any input.

  const stem = getRuleRelativeStem(contentRef);
  const segments = stem.split("/").filter(Boolean);

  if (segments.length === 0 || stem === "root") {
    return "**";
  }

  if (segments[0] === "_cross") {
    return "**";
  }

  if (segments.at(-1) === "rules") {
    segments.pop();
  }

  const scopePath = segments.join("/");

  return scopePath === "" ? "**" : `${scopePath}/**`;
}

function getRuleRelativeStem(contentRef: string): string {
  return contentRef
    .replace(/^~\/\.fabric\/knowledge\//u, "")
    .replace(/^\.fabric\/knowledge\//u, "")
    .replace(/\.md$/u, "");
}

/**
 * v2.0: Map a content_ref onto a path that legacy `deriveAgentsMeta*` helpers
 * can consume. Both team (`.fabric/knowledge/...`) and personal
 * (`~/.fabric/knowledge/...`) entries collapse to `.fabric/agents/...` so the
 * shared layer/topology helpers can derive a stable answer regardless of
 * which root the file came from. agents.meta.json itself records the
 * original content_ref so consumers can still disambiguate the layer.
 */
function toAgentsCompatiblePath(contentRef: string): string {
  return contentRef
    .replace(/^~\/\.fabric\/knowledge\//u, ".fabric/agents/")
    .replace(/^\.fabric\/knowledge\//u, ".fabric/agents/");
}

function sortNodes(nodes: Record<string, NodeMeta>): Record<string, NodeMeta> {
  return Object.fromEntries(Object.entries(nodes).sort(([left], [right]) => left.localeCompare(right)));
}

// v2.0-rc.5 (C7): pending/ entries must NOT contribute to revision_hash so
// PreToolUse session-hints cache does not thrash whenever a fab_review pending
// draft is added/modified/rejected. Pending nodes remain in `meta.nodes` (for
// fab_review.list enumeration); they are only excluded from the hash input.
// Detect both team-root (`.fabric/knowledge/pending/`) and personal-root
// (`~/.fabric/knowledge/pending/`) refs. Approval moves the entry to a
// canonical subdir (decisions/, pitfalls/, ...), which DOES change the hash.
function isPendingNode(node: NodeMeta): boolean {
  const ref = node.content_ref ?? node.file ?? "";
  return (
    ref.startsWith(".fabric/knowledge/pending/") ||
    ref.startsWith("~/.fabric/knowledge/pending/")
  );
}

function computeRevision(nodes: Record<string, NodeMeta>): string {
  const revisionSource = Object.entries(sortNodes(nodes))
    .filter(([, node]) => !isPendingNode(node))
    .map(([id, node]) => [id, node.hash, node.stable_id ?? "", node.identity_source ?? ""].join("|"))
    .join("\n");
  return sha256(revisionSource);
}

function collectSyncedFiles(existingMeta: AgentsMeta | undefined, computedMeta: AgentsMeta): string[] {
  if (existingMeta === undefined) {
    return Object.values(computedMeta.nodes).map((node) => node.content_ref ?? node.file).sort();
  }

  const existingByContentRef = indexExistingNodesByContentRef(existingMeta);
  return Object.values(computedMeta.nodes)
    .filter((node) => {
      const existing = existingByContentRef.get(node.content_ref ?? node.file)?.node;
      return (
        existing === undefined ||
        existing.hash !== node.hash ||
        existing.stable_id !== node.stable_id ||
        existing.identity_source !== node.identity_source
      );
    })
    .map((node) => node.content_ref ?? node.file)
    .sort();
}

function collectStableIds(meta: AgentsMeta): string[] {
  return Object.values(meta.nodes)
    .map((node) => node.stable_id)
    .filter((stableId): stableId is string => stableId !== undefined)
    .sort();
}

function collectDriftDetails(existingMeta: AgentsMeta | undefined, computedMeta: AgentsMeta): MetaDriftDetail[] {
  if (existingMeta === undefined) {
    return [];
  }

  const computedByContentRef = indexExistingNodesByContentRef(computedMeta);
  return Object.values(existingMeta.nodes)
    .map((existingNode): MetaDriftDetail | null => {
      const contentRef = existingNode.content_ref ?? existingNode.file;
      const computedNode = computedByContentRef.get(contentRef)?.node;
      const stableId = existingNode.stable_id ?? computedNode?.stable_id;

      if (computedNode === undefined || stableId === undefined || existingNode.hash === computedNode.hash) {
        return null;
      }

      return {
        file: contentRef,
        stable_id: stableId,
        expected_hash: existingNode.hash,
        actual_hash: computedNode.hash,
      };
    })
    .filter((detail): detail is MetaDriftDetail => detail !== null);
}

async function recordBaselineSynced(
  projectRoot: string,
  input: {
    previousRevision?: string;
    revision: string;
    syncedFiles: string[];
    acceptedStableIds: string[];
    driftDetails: MetaDriftDetail[];
    source: KnowledgeMetaBuildSource;
  },
): Promise<void> {
  if (input.driftDetails.length > 0) {
    await appendEventLedgerEvent(projectRoot, {
      event_type: "knowledge_drift_detected",
      revision: input.previousRevision ?? input.revision,
      drifted_stable_ids: input.driftDetails.map((detail) => detail.stable_id),
      missing_files: input.driftDetails.filter((detail) => detail.actual_hash === null).map((detail) => detail.file),
      stale_files: input.driftDetails.filter((detail) => detail.actual_hash !== null).map((detail) => detail.file),
      details: input.driftDetails,
    });
  }
}

function flattenKeys(value: unknown, keys: Record<string, true> = {}): Record<string, true> {
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys[key] = true;
      flattenKeys(child, keys);
    }
  }

  return keys;
}

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}

function deriveRuleIdentity(file: string, source: string, existing: NodeMeta | undefined): RuleIdentity {
  // v2.0: Knowledge entries declare a path-decoupled id (KP-/KT-) in their
  // YAML frontmatter `id:` field. When present we use it verbatim and never
  // regenerate from the path — moving a knowledge file between directories
  // must NOT change its stable_id.
  const declaredKnowledgeId = extractDeclaredKnowledgeId(source);
  if (declaredKnowledgeId !== undefined) {
    return {
      stableId: declaredKnowledgeId,
      identitySource: "declared",
    };
  }

  // v2.0: An existing node already carrying a knowledge id (e.g. a prior
  // build before frontmatter was parsable) is also preserved verbatim.
  if (
    existing?.stable_id !== undefined &&
    isKnowledgeStableId(existing.stable_id)
  ) {
    return {
      stableId: existing.stable_id,
      identitySource: "declared",
    };
  }

  const declaredStableId = extractDeclaredStableId(source);
  const derivedStableId = deriveAgentsMetaStableId(toAgentsCompatiblePath(file));

  if (declaredStableId !== undefined) {
    return {
      stableId: declaredStableId,
      identitySource: "declared",
    };
  }

  if (
    existing?.identity_source === "declared" &&
    existing.stable_id !== undefined &&
    existing.stable_id !== derivedStableId
  ) {
    return {
      stableId: existing.stable_id,
      identitySource: "declared",
    };
  }

  return {
    stableId: derivedStableId,
    identitySource: "derived",
  };
}

function extractDeclaredStableId(source: string): string | undefined {
  const match =
    /^(?:\uFEFF)?(?:---\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$))?<!--\s*fab:rule-id\s+([A-Za-z0-9][A-Za-z0-9/_-]*)\s*-->\s*(?:\r?\n|$)/u.exec(source);
  return match?.[1];
}

/**
 * v2.0: Extract a path-decoupled knowledge id (KP-/KT-{TYPE}-{NNNN}) from
 * the YAML frontmatter `id:` field. Returns undefined when no frontmatter is
 * present, when `id:` is missing, or when the value does not match the
 * knowledge stable_id pattern.
 *
 * Lightweight regex parser (mirrors the rest of the file's intentionally
 * dependency-free frontmatter handling — see extractDescriptionFromFrontmatter).
 */
function extractDeclaredKnowledgeId(source: string): string | undefined {
  const frontmatter = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/u.exec(source);
  if (frontmatter === null) {
    return undefined;
  }
  const idMatch = /^id:\s*(.+?)\s*$/mu.exec(frontmatter[1]);
  if (idMatch === null) {
    return undefined;
  }
  const candidate = idMatch[1].replace(/^["'](.*)["']$/u, "$1").trim();
  return isKnowledgeStableId(candidate) ? candidate : undefined;
}

function extractRuleDescription(source: string): RuleDescription | undefined {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/u.exec(source);
  const description = frontmatter === null
    ? undefined
    : extractDescriptionFromFrontmatter(frontmatter[1]);

  if (description !== undefined) {
    return description;
  }

  const heading = /^#\s+(.+?)\s*$/mu.exec(source);
  const summary = heading?.[1]?.trim();
  if (summary === undefined || summary.length === 0) {
    return undefined;
  }

  // v2.0-rc.22 hotfix (Finding 2 / B1): when frontmatter exists but lacks a
  // `summary:` field (the canonical baseline shape: h1 heading carries the
  // title, knowledge fields live in frontmatter), still pull knowledge
  // fields out of frontmatter rather than emitting all-undefined. Without
  // this, baseline KT-* entries surface in plan-context-hint with empty
  // `type` / `maturity`, which downstream consumers display as ""; only
  // user-promoted entries that author an explicit `summary:` get full
  // knowledge fields. The h1 heading provides the summary; frontmatter
  // provides the rest.
  const knowledge = frontmatter !== null
    ? extractKnowledgeFieldsFromFrontmatter(frontmatter[1])
    : undefined;

  return {
    summary,
    intent_clues: [],
    tech_stack: [],
    impact: [],
    must_read_if: summary,
    // v2.0-rc.22: when frontmatter is present, merge its knowledge fields;
    // when fully absent (no `---` block), all knowledge fields stay
    // undefined, matching the original heading-only fallback contract.
    id: knowledge?.id,
    knowledge_type: knowledge?.knowledge_type,
    maturity: knowledge?.maturity,
    knowledge_layer: knowledge?.knowledge_layer,
    layer_reason: knowledge?.layer_reason,
    created_at: knowledge?.created_at,
    tags: knowledge?.tags,
    // v2.0-rc.5 (C1): default-safe values when there is no frontmatter at all;
    // when frontmatter exists, honor its declared values (extractKnowledge
    // FieldsFromFrontmatter already applies the broad-default for missing
    // or malformed scopes).
    relevance_scope: knowledge?.relevance_scope ?? "broad",
    relevance_paths: knowledge?.relevance_paths ?? [],
  };
}

// v2.0.0-rc.23 TASK-013 (F8b): the heading-format A-set enum
// (MISSION_STATEMENT / MANDATORY_INJECTION / BUSINESS_LOGIC_CHUNKS /
// CONTEXT_INFO inside `## [BRACKET]` shells) was retired alongside the scan
// baseline writers. Section discovery now accepts B-set plain `## <Title>`
// headings (Summary / Why proposed / Session context / Evidence — the rc.7
// fab_extract_knowledge convention). The result is captured in
// agents.meta.json `nodes[].sections` purely as forensic metadata for doctor
// lints — no API surface consumes it.
function extractRuleSections(source: string): string[] | undefined {
  const sections = Array.from(source.matchAll(/^#{2,6}\s+(.+?)\s*$/gmu))
    .map((match) => match[1].trim())
    .filter((section, index, all) => section.length > 0 && all.indexOf(section) === index);

  return sections.length > 0 ? sections : undefined;
}

function extractDescriptionFromFrontmatter(frontmatter: string): RuleDescription | undefined {
  const summary = extractScalar(frontmatter, "summary") ?? extractScalar(frontmatter, "description");
  if (summary === undefined) {
    return undefined;
  }

  const knowledge = extractKnowledgeFieldsFromFrontmatter(frontmatter);

  return {
    summary,
    intent_clues: extractInlineArray(frontmatter, "intent_clues"),
    tech_stack: extractInlineArray(frontmatter, "tech_stack"),
    impact: extractInlineArray(frontmatter, "impact"),
    must_read_if: extractScalar(frontmatter, "must_read_if") ?? summary,
    entities: extractInlineArray(frontmatter, "entities"),
    id: knowledge.id,
    knowledge_type: knowledge.knowledge_type,
    maturity: knowledge.maturity,
    knowledge_layer: knowledge.knowledge_layer,
    layer_reason: knowledge.layer_reason,
    created_at: knowledge.created_at,
    tags: knowledge.tags,
    relevance_scope: knowledge.relevance_scope,
    relevance_paths: knowledge.relevance_paths,
  };
}

/**
 * v2.0 knowledge frontmatter parser. All fields optional + best-effort —
 * invalid values log a warning and remain undefined; parsing never throws,
 * so v1.x frontmatter (lacking these fields) flows through unchanged.
 *
 * Cross-validation: declared id implies a layer (KP→personal, KT→team).
 * If id and layer disagree, we drop both to avoid a corrupt half-state.
 */
type KnowledgeFrontmatterFields = {
  id?: string;
  knowledge_type?: KnowledgeType;
  maturity?: Maturity;
  knowledge_layer?: KnowledgeLayer;
  layer_reason?: string;
  created_at?: string;
  // v2/rc.2: flat flow-style YAML array; populated by init-scan from forensic
  // tech-stack keywords and editable by user.
  tags?: string[];
  // v2.0-rc.5 (C1): relevance scope/paths drive plan-context-hint narrowing.
  // Defaults applied at the parse layer when fields are absent or malformed:
  //   relevance_scope → 'broad'   (always-surface, the safe default)
  //   relevance_paths → []        (no path anchors; broad scope ignores them)
  // Default-safe semantics keep the existing 16 canonical entries valid
  // without requiring frontmatter migration.
  relevance_scope: "narrow" | "broad";
  relevance_paths: string[];
};

function extractKnowledgeFieldsFromFrontmatter(frontmatter: string): KnowledgeFrontmatterFields {
  const rawId = extractScalar(frontmatter, "id");
  const rawType = extractScalar(frontmatter, "type");
  const rawMaturity = extractScalar(frontmatter, "maturity");
  const rawLayer = extractScalar(frontmatter, "layer");
  const rawLayerReason = extractScalar(frontmatter, "layer_reason");
  const rawCreatedAt = extractScalar(frontmatter, "created_at");

  let id: string | undefined;
  if (rawId !== undefined) {
    const parsed = StableIdSchema.safeParse(rawId);
    if (parsed.success) {
      id = parsed.data;
    } else {
      process.stderr.write(`[fabric] frontmatter: invalid knowledge id format ${JSON.stringify(rawId)}; skipping\n`);
    }
  }

  let knowledge_type: KnowledgeType | undefined;
  if (rawType !== undefined) {
    const parsed = KnowledgeTypeSchema.safeParse(rawType);
    if (parsed.success) {
      knowledge_type = parsed.data;
    } else {
      process.stderr.write(`[fabric] frontmatter: unknown knowledge type ${JSON.stringify(rawType)}; skipping\n`);
    }
  }

  let maturity: Maturity | undefined;
  if (rawMaturity !== undefined) {
    const parsed = MaturitySchema.safeParse(rawMaturity);
    if (parsed.success) {
      maturity = parsed.data;
    } else {
      process.stderr.write(`[fabric] frontmatter: unknown maturity ${JSON.stringify(rawMaturity)}; skipping\n`);
    }
  }

  let knowledge_layer: KnowledgeLayer | undefined;
  if (rawLayer !== undefined) {
    const parsed = LayerSchema.safeParse(rawLayer);
    if (parsed.success) {
      knowledge_layer = parsed.data;
    } else {
      process.stderr.write(`[fabric] frontmatter: unknown layer ${JSON.stringify(rawLayer)}; skipping\n`);
    }
  }

  let created_at: string | undefined;
  if (rawCreatedAt !== undefined) {
    if (!Number.isNaN(Date.parse(rawCreatedAt))) {
      created_at = rawCreatedAt;
    } else {
      process.stderr.write(`[fabric] frontmatter: malformed created_at ${JSON.stringify(rawCreatedAt)}; skipping\n`);
    }
  }

  // Cross-validation: id encodes layer (KP→personal, KT→team).
  // If both are present and disagree, drop both fields so consumers see a
  // clean "missing" state instead of inconsistent metadata.
  if (id !== undefined && knowledge_layer !== undefined) {
    const decoded = parseKnowledgeId(id);
    if (decoded !== null && decoded.layer !== knowledge_layer) {
      process.stderr.write(
        `[fabric] frontmatter: id ${id} encodes layer ${decoded.layer} but layer field says ${knowledge_layer}; dropping both\n`,
      );
      id = undefined;
      knowledge_layer = undefined;
    }
  }

  // v2/rc.2: tags — flat flow-style YAML inline array e.g. `tags: [ts, react]`
  const tags = extractInlineArray(frontmatter, "tags");

  // v2.0-rc.5 (C1): relevance_scope — case-sensitive scalar (narrow|broad).
  // Anything else (missing key, mistyped value, leading whitespace within a
  // quoted form) falls back to 'broad'. Defaults are forgiving so the 16
  // canonical entries that pre-date the field still parse cleanly.
  const rawRelevanceScope = extractScalar(frontmatter, "relevance_scope");
  const relevance_scope: "narrow" | "broad" =
    rawRelevanceScope === "narrow" || rawRelevanceScope === "broad"
      ? rawRelevanceScope
      : "broad";

  // v2.0-rc.5 (C1): relevance_paths — flow-style inline YAML array e.g.
  // `relevance_paths: [src/foo.ts, src/bar/]`. Absent or malformed → [].
  // Reuses extractInlineArray (the same helper used for tags / tech_stack /
  // intent_clues), so a missing key returns [] without warning.
  const relevance_paths = extractInlineArray(frontmatter, "relevance_paths");

  return {
    id,
    knowledge_type,
    maturity,
    knowledge_layer,
    layer_reason: rawLayerReason,
    created_at,
    tags: tags.length > 0 ? tags : undefined,
    relevance_scope,
    relevance_paths,
  };
}

function extractScalar(frontmatter: string, key: string): string | undefined {
  const pattern = new RegExp(`^${escapeRegExp(key)}:\\s*(.+?)\\s*$`, "mu");
  const match = pattern.exec(frontmatter);
  if (match === null) {
    return undefined;
  }

  return unquote(match[1].trim());
}

function extractInlineArray(frontmatter: string, key: string): string[] {
  const pattern = new RegExp(`^${escapeRegExp(key)}:\\s*\\[(.*?)\\]\\s*$`, "mu");
  const match = pattern.exec(frontmatter);
  if (match === null) {
    return [];
  }

  return match[1]
    .split(",")
    .map((item) => unquote(item.trim()))
    .filter((item) => item.length > 0);
}

function unquote(value: string): string {
  return value.replace(/^["'](.*)["']$/u, "$1");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
