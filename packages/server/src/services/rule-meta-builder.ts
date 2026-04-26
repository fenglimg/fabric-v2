import { readdir, readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  RULE_TEST_INDEX_SCHEMA_VERSION,
  agentsMetaSchema,
  deriveAgentsMetaLayer,
  deriveAgentsMetaStableId,
  deriveAgentsMetaTopologyType,
  ruleTestIndexSchema,
  type AgentsIdentitySource,
  type AgentsLayer,
  type AgentsMeta,
  type AgentsTopologyType,
  type RuleDescription,
  type RuleTestIndex,
} from "@fenglimg/fabric-shared";

import { appendEventLedgerEvent } from "./event-ledger.js";
import { atomicWriteText, ensureParentDirectory, sha256 } from "./_shared.js";

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

export type RuleMetaBuildSource = "doctor_fix" | "sync_meta";

export type RuleMetaBuildResult = {
  meta: AgentsMeta;
  ruleTestIndex: RuleTestIndex;
  changed: boolean;
};

export type WriteRuleMetaOptions = {
  source: RuleMetaBuildSource;
};

export async function buildRuleMeta(projectRootInput: string): Promise<RuleMetaBuildResult> {
  const projectRoot = normalizeProjectRoot(projectRootInput);
  assertExistingDirectory(projectRoot);

  const metaPath = join(projectRoot, ".fabric", "agents.meta.json");
  const ruleTestIndexPath = join(projectRoot, ".fabric", "rule-test.index.json");
  const existingMeta = await readExistingMeta(metaPath);
  const existingRuleTestIndex = await readExistingRuleTestIndex(ruleTestIndexPath);
  const meta = await computeRulesBasedAgentsMeta(projectRoot, existingMeta);
  const ruleTestIndex = await computeRuleTestIndex(projectRoot, meta, existingRuleTestIndex);

  return {
    meta,
    ruleTestIndex,
    changed:
      existingMeta === undefined ||
      stableStringify(existingMeta) !== stableStringify(meta) ||
      existingRuleTestIndex === undefined ||
      !isSameRuleTestIndex(existingRuleTestIndex, ruleTestIndex),
  };
}

export async function writeRuleMeta(
  projectRootInput: string,
  options: WriteRuleMetaOptions,
): Promise<RuleMetaBuildResult> {
  const projectRoot = normalizeProjectRoot(projectRootInput);
  const metaPath = join(projectRoot, ".fabric", "agents.meta.json");
  const ruleTestIndexPath = join(projectRoot, ".fabric", "rule-test.index.json");
  const existingMeta = await readExistingMeta(metaPath);
  const result = await buildRuleMeta(projectRoot);

  if (!result.changed) {
    return result;
  }

  await ensureParentDirectory(metaPath);
  await atomicWriteText(metaPath, `${JSON.stringify(result.meta, null, 2)}\n`);
  await atomicWriteText(ruleTestIndexPath, `${JSON.stringify(result.ruleTestIndex, null, 2)}\n`);

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

export async function computeRulesBasedAgentsMeta(
  projectRootInput: string,
  existingMeta?: AgentsMeta,
): Promise<AgentsMeta> {
  const projectRoot = normalizeProjectRoot(projectRootInput);
  assertExistingDirectory(projectRoot);

  const previousMeta = existingMeta ?? await readExistingMeta(join(projectRoot, ".fabric", "agents.meta.json"));
  const existingByContentRef = indexExistingNodesByContentRef(previousMeta);
  const ruleFiles = await findFabricRuleFiles(projectRoot);
  const nodes: Record<string, NodeMeta> = {};

  const bootstrapNode = await createBootstrapNode(projectRoot, existingByContentRef.get(".fabric/bootstrap/README.md")?.node);

  if (bootstrapNode !== undefined) {
    nodes.L0 = bootstrapNode;
  }

  for (const contentRef of ruleFiles) {
    const source = await readFile(join(projectRoot, contentRef), "utf8");
    const existing = existingByContentRef.get(contentRef);
    const id = deriveNodeId(contentRef);
    const hash = sha256(source);
    const defaults = createDefaultNodeMeta(contentRef);
    const identity = deriveRuleIdentity(contentRef, source, existing?.node);

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

  return {
    ...(previousMeta ?? {}),
    revision: computeRevision(nodes),
    nodes: sortNodes(nodes),
  };
}

export async function computeRuleTestIndex(
  projectRootInput: string,
  computedMeta: AgentsMeta,
  previousIndex?: RuleTestIndex,
): Promise<RuleTestIndex> {
  const projectRoot = normalizeProjectRoot(projectRootInput);
  assertExistingDirectory(projectRoot);

  const previousLinks = indexPreviousRuleTestEntries(previousIndex?.links ?? []);
  const previousOrphans = indexPreviousRuleTestEntries(previousIndex?.orphan_annotations ?? []);
  const rulesByStableId = indexRulesByStableId(computedMeta);
  const links: RuleTestIndex["links"] = [];
  const orphanAnnotations: RuleTestIndex["orphan_annotations"] = [];

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
    schema_version: RULE_TEST_INDEX_SCHEMA_VERSION,
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

export function deriveRuleMetaLayer(relativePath: string): AgentsLayer {
  return deriveAgentsMetaLayer(toAgentsCompatiblePath(relativePath));
}

export function deriveRuleMetaTopologyType(relativePath: string): AgentsTopologyType {
  return deriveAgentsMetaTopologyType(toAgentsCompatiblePath(relativePath));
}

export function isSameRuleTestIndex(left: RuleTestIndex, right: RuleTestIndex): boolean {
  return stableStringify(toComparableRuleTestIndex(left)) === stableStringify(toComparableRuleTestIndex(right));
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

async function readExistingRuleTestIndex(indexPath: string): Promise<RuleTestIndex | undefined> {
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
    return ruleTestIndexSchema.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

async function findFabricRuleFiles(projectRoot: string): Promise<string[]> {
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

    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolutePath = join(current, entry.name);
      const relativePath = toPosixPath(relative(projectRoot, absolutePath));

      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(relativePath);
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
    Pick<RuleTestIndex["links"][number], "rule_stable_id" | "test_file" | "test_hash" | "annotation_line"> &
      Partial<Pick<RuleTestIndex["links"][number], "rule_hash" | "previous_rule_hash" | "previous_test_hash">>
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
  left: Pick<RuleTestIndex["links"][number], "rule_stable_id" | "test_file" | "annotation_line">,
  right: Pick<RuleTestIndex["links"][number], "rule_stable_id" | "test_file" | "annotation_line">,
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

function toComparableRuleTestIndex(index: RuleTestIndex): Omit<RuleTestIndex, "generated_at"> {
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
  if (file === ".fabric/bootstrap/README.md") {
    return "L0";
  }

  const layer = deriveRuleMetaLayer(file);
  const relativeStem = getRuleRelativeStem(file);

  return `${layer}/${relativeStem}`;
}

function createDefaultNodeMeta(contentRef: string): NodeMeta {
  const layer = deriveRuleMetaLayer(contentRef);
  const topologyType = deriveRuleMetaTopologyType(contentRef);

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

async function createBootstrapNode(projectRoot: string, existing: NodeMeta | undefined): Promise<NodeMeta | undefined> {
  const contentRef = ".fabric/bootstrap/README.md";
  const bootstrapPath = join(projectRoot, contentRef);

  if (!existsSync(bootstrapPath)) {
    return undefined;
  }

  const hash = sha256(await readFile(bootstrapPath, "utf8"));
  const identity = {
    stableId: existing?.stable_id ?? deriveAgentsMetaStableId(contentRef),
    identitySource: existing?.identity_source ?? "derived",
  } satisfies RuleIdentity;

  return {
    ...createDefaultNodeMeta(contentRef),
    ...existing,
    file: contentRef,
    content_ref: contentRef,
    hash,
    stable_id: identity.stableId,
    identity_source: identity.identitySource,
  };
}

function deriveScopeGlob(contentRef: string): string {
  if (contentRef === ".fabric/bootstrap/README.md") {
    return "**";
  }

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
  return contentRef.replace(/^\.fabric\/rules\//u, "").replace(/\.md$/u, "");
}

function toAgentsCompatiblePath(contentRef: string): string {
  return contentRef.replace(/^\.fabric\/rules\//u, ".fabric/agents/");
}

function sortNodes(nodes: Record<string, NodeMeta>): Record<string, NodeMeta> {
  return Object.fromEntries(Object.entries(nodes).sort(([left], [right]) => left.localeCompare(right)));
}

function computeRevision(nodes: Record<string, NodeMeta>): string {
  const revisionSource = Object.entries(sortNodes(nodes))
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
    source: RuleMetaBuildSource;
  },
): Promise<void> {
  if (input.driftDetails.length > 0) {
    await appendEventLedgerEvent(projectRoot, {
      event_type: "rule_drift_detected",
      revision: input.previousRevision ?? input.revision,
      drifted_stable_ids: input.driftDetails.map((detail) => detail.stable_id),
      missing_files: input.driftDetails.filter((detail) => detail.actual_hash === null).map((detail) => detail.file),
      stale_files: input.driftDetails.filter((detail) => detail.actual_hash !== null).map((detail) => detail.file),
      details: input.driftDetails,
    });
  }

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

  return {
    summary,
    intent_clues: [],
    tech_stack: [],
    impact: [],
    must_read_if: summary,
  };
}

function extractRuleSections(source: string): string[] | undefined {
  const sections = Array.from(source.matchAll(/^(?:#{2,6})\s+\[([A-Z_]+)\]\s*$/gmu))
    .map((match) => match[1])
    .filter((section, index, all) => all.indexOf(section) === index);

  return sections.length > 0 ? sections : undefined;
}

function extractDescriptionFromFrontmatter(frontmatter: string): RuleDescription | undefined {
  const summary = extractScalar(frontmatter, "summary") ?? extractScalar(frontmatter, "description");
  if (summary === undefined) {
    return undefined;
  }

  return {
    summary,
    intent_clues: extractInlineArray(frontmatter, "intent_clues"),
    tech_stack: extractInlineArray(frontmatter, "tech_stack"),
    impact: extractInlineArray(frontmatter, "impact"),
    must_read_if: extractScalar(frontmatter, "must_read_if") ?? summary,
    entities: extractInlineArray(frontmatter, "entities"),
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
