import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  RULE_TEST_INDEX_SCHEMA_VERSION,
  agentsMetaSchema,
  deriveAgentsMetaLayer,
  deriveAgentsMetaStableId,
  deriveAgentsMetaTopologyType,
  ruleTestIndexSchema,
  type AgentsLayer,
  type AgentsMeta,
  type AgentsIdentitySource,
  type AgentsTopologyType,
  type RuleTestIndex,
} from "@fenglimg/fabric-shared";
import { defineCommand } from "citty";

import { t } from "../i18n.js";

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

type EventLedgerEnvelope = {
  kind: "fabric-event";
  id: string;
  ts: number;
  schema_version: 1;
};

type FabricVerifyAnnotation = {
  stableId: string;
  testFile: string;
  testHash: string;
  line: number;
};

type SyncMetaArgs = {
  target: string;
  "check-only"?: boolean;
};

export const syncMetaCommand = defineCommand({
  meta: {
    name: "sync-meta",
    description: t("cli.sync-meta.description"),
  },
  args: {
    target: {
      type: "string",
      description: t("cli.sync-meta.args.target.description"),
      default: process.cwd(),
    },
    "check-only": {
      type: "boolean",
      description: t("cli.sync-meta.args.check-only.description"),
      default: false,
    },
  },
  async run({ args }: { args: SyncMetaArgs }) {
    const target = normalizeTarget(args.target);
    const metaPath = join(target, ".fabric", "agents.meta.json");
    const ruleTestIndexPath = join(target, ".fabric", "rule-test.index.json");
    const computedMeta = computeAgentsMeta(target);
    const existingMeta = readExistingMeta(metaPath);
    const existingRuleTestIndex = readExistingRuleTestIndex(ruleTestIndexPath);
    const computedRuleTestIndex = computeRuleTestIndex(target, computedMeta, existingRuleTestIndex);

    if (args["check-only"]) {
      if (
        !existingMeta ||
        stableStringify(existingMeta) !== stableStringify(computedMeta) ||
        !existingRuleTestIndex ||
        !isSameRuleTestIndex(existingRuleTestIndex, computedRuleTestIndex)
      ) {
        writeStderr(t("cli.sync-meta.drift-detected"));
        process.exitCode = 1;
      }
      return;
    }

    if (
      existingMeta &&
      stableStringify(existingMeta) === stableStringify(computedMeta) &&
      existingRuleTestIndex &&
      isSameRuleTestIndex(existingRuleTestIndex, computedRuleTestIndex)
    ) {
      return;
    }

    mkdirSync(join(target, ".fabric"), { recursive: true });
    writeFileSync(metaPath, `${JSON.stringify(computedMeta, null, 2)}\n`, "utf8");
    writeFileSync(ruleTestIndexPath, `${JSON.stringify(computedRuleTestIndex, null, 2)}\n`, "utf8");
    if (!existingMeta || stableStringify(existingMeta) !== stableStringify(computedMeta)) {
      recordBaselineSynced(target, {
        previousRevision: existingMeta?.revision,
        revision: computedMeta.revision,
        syncedFiles: collectSyncedFiles(existingMeta, computedMeta),
        acceptedStableIds: collectStableIds(computedMeta),
        driftDetails: collectDriftDetails(existingMeta, computedMeta),
        source: "sync_meta",
      });
    }
    writeStderr(t("cli.sync-meta.updated", { label: t("cli.shared.updated"), path: metaPath }));
    writeStderr(t("cli.sync-meta.updated", { label: t("cli.shared.updated"), path: ruleTestIndexPath }));
  },
});

export default syncMetaCommand;

export function computeAgentsMeta(target: string): AgentsMeta {
  assertExistingDirectory(target);

  const metaPath = join(target, ".fabric", "agents.meta.json");
  const existingMeta = readExistingMeta(metaPath);
  const existingByFile = indexExistingNodesByFile(existingMeta);
  const agentsFiles = findFabricAgentsFiles(target);
  const nodes: Record<string, NodeMeta> = {};

  const bootstrapNode = createBootstrapNode(
    target,
    existingByFile.get(".fabric/bootstrap/README.md")?.node ?? existingByFile.get("AGENTS.md")?.node,
  );

  if (bootstrapNode !== undefined) {
    nodes.L0 = bootstrapNode;
  }

  for (const file of agentsFiles) {
    const existing = existingByFile.get(file);
    const source = readFileSync(join(target, file), "utf8");
    const id = deriveNodeId(file);
    const hash = sha256(source);
    const defaults = createDefaultNodeMeta(file);
    const identity = deriveRuleIdentity(file, source, existing?.node);

    nodes[id] = {
      ...defaults,
      ...existing?.node,
      file,
      hash,
      stable_id: identity.stableId,
      identity_source: identity.identitySource,
    };
  }

  return {
    ...(existingMeta ?? {}),
    revision: computeRevision(nodes),
    nodes: sortNodes(nodes),
  };
}

function normalizeTarget(targetInput: string): string {
  return isAbsolute(targetInput) ? targetInput : resolve(process.cwd(), targetInput);
}

function assertExistingDirectory(target: string): void {
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(t("cli.shared.target-invalid", { target }));
  }
}

function readExistingMeta(metaPath: string): AgentsMeta | undefined {
  if (!existsSync(metaPath)) {
    return undefined;
  }

  try {
    return agentsMetaSchema.parse(JSON.parse(readFileSync(metaPath, "utf8")));
  } catch {
    return undefined;
  }
}

function readExistingRuleTestIndex(indexPath: string): RuleTestIndex | undefined {
  if (!existsSync(indexPath)) {
    return undefined;
  }

  try {
    return ruleTestIndexSchema.parse(JSON.parse(readFileSync(indexPath, "utf8")));
  } catch {
    return undefined;
  }
}

function findFabricAgentsFiles(target: string): string[] {
  const agentsRoot = join(target, ".fabric", "agents");

  if (!existsSync(agentsRoot) || !statSync(agentsRoot).isDirectory()) {
    return [];
  }

  const files: string[] = [];
  const stack = [agentsRoot];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = join(current, entry.name);
      const relativePath = toPosixPath(relative(target, absolutePath));

      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(relativePath);
      }
    }
  }

  return files.sort();
}

function findFabricVerifyAnnotations(target: string): FabricVerifyAnnotation[] {
  const files = findTestFiles(target);
  const annotations: FabricVerifyAnnotation[] = [];
  const annotationPattern = /^\s*\/\/\s*@fabric-verify\s+([A-Za-z0-9][A-Za-z0-9/_-]*)\s*$/u;

  for (const testFile of files) {
    const source = readFileSync(join(target, testFile), "utf8");
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

  return annotations.sort((left, right) => compareAnnotationEntries(left, right));
}

function findTestFiles(target: string): string[] {
  const ignoredRootSegments = new Set([".git", ".fabric", "node_modules", "dist", "build", "coverage"]);
  const files: string[] = [];
  const stack = [target];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = join(current, entry.name);
      const relativePath = toPosixPath(relative(target, absolutePath));
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

function isSameRuleTestIndex(left: RuleTestIndex, right: RuleTestIndex): boolean {
  return stableStringify(toComparableRuleTestIndex(left)) === stableStringify(toComparableRuleTestIndex(right));
}

function toComparableRuleTestIndex(index: RuleTestIndex): Omit<RuleTestIndex, "generated_at"> {
  const { generated_at: _generatedAt, ...comparable } = index;
  return comparable;
}

export function deriveLayer(relativePath: string): AgentsLayer {
  return deriveAgentsMetaLayer(relativePath);
}

export function deriveTopologyType(relativePath: string): AgentsTopologyType {
  return deriveAgentsMetaTopologyType(relativePath);
}

function indexExistingNodesByFile(existingMeta: AgentsMeta | undefined): Map<string, { id: string; node: NodeMeta }> {
  const byFile = new Map<string, { id: string; node: NodeMeta }>();

  for (const [id, node] of Object.entries(existingMeta?.nodes ?? {})) {
    byFile.set(toPosixPath(node.file), { id, node });
  }

  return byFile;
}

function deriveNodeId(file: string): string {
  if (file === ".fabric/bootstrap/README.md") {
    return "L0";
  }

  const layer = deriveLayer(file);
  const relativeStem = getMirrorRelativeStem(file);

  return `${layer}/${relativeStem}`;
}

function createDefaultNodeMeta(file: string): NodeMeta {
  const layer = deriveLayer(file);
  const topologyType = deriveTopologyType(file);

  return {
    file,
    scope_glob: deriveScopeGlob(file),
    deps: layer === "L0" ? [] : ["L0"],
    priority: layer === "L0" ? "high" : "medium",
    layer,
    topology_type: topologyType,
    hash: "",
  };
}

function createBootstrapNode(target: string, existing: NodeMeta | undefined): NodeMeta | undefined {
  const bootstrapPath = join(target, ".fabric", "bootstrap", "README.md");
  const legacyBootstrapPath = join(target, "AGENTS.md");
  const sourcePath = existsSync(bootstrapPath) ? bootstrapPath : existsSync(legacyBootstrapPath) ? legacyBootstrapPath : undefined;

  if (sourcePath === undefined) {
    return undefined;
  }

  const hash = sha256(readFileSync(sourcePath, "utf8"));
  const identity = {
    stableId: existing?.stable_id ?? deriveAgentsMetaStableId(".fabric/bootstrap/README.md"),
    identitySource: existing?.identity_source ?? "derived",
  } satisfies RuleIdentity;

  return {
    ...createDefaultNodeMeta(".fabric/bootstrap/README.md"),
    ...existing,
    file: ".fabric/bootstrap/README.md",
    hash,
    stable_id: identity.stableId,
    identity_source: identity.identitySource,
  };
}

export function computeRuleTestIndex(
  target: string,
  computedMeta: AgentsMeta,
  previousIndex?: RuleTestIndex,
): RuleTestIndex {
  assertExistingDirectory(target);

  const previousLinks = indexPreviousRuleTestEntries(previousIndex?.links ?? []);
  const previousOrphans = indexPreviousRuleTestEntries(previousIndex?.orphan_annotations ?? []);
  const rulesByStableId = indexRulesByStableId(computedMeta);
  const links: RuleTestIndex["links"] = [];
  const orphanAnnotations: RuleTestIndex["orphan_annotations"] = [];

  for (const annotation of findFabricVerifyAnnotations(target)) {
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
      rule_file: rule.file,
      rule_hash: rule.hash,
      previous_rule_hash: previousHashes.previousRuleHash,
      test_file: annotation.testFile,
      test_hash: annotation.testHash,
      previous_test_hash: previousHashes.previousTestHash,
      annotation_line: annotation.line,
    });
  }

  const index: RuleTestIndex = {
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

  return index;
}

function deriveScopeGlob(file: string): string {
  if (file === ".fabric/bootstrap/README.md") {
    return "**";
  }

  const stem = getMirrorRelativeStem(file);
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

function getMirrorRelativeStem(file: string): string {
  return file.replace(/^\.fabric\/agents\//, "").replace(/\.md$/, "");
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
    return Object.values(computedMeta.nodes).map((node) => node.file).sort();
  }

  const existingByFile = indexExistingNodesByFile(existingMeta);
  return Object.values(computedMeta.nodes)
    .filter((node) => {
      const existing = existingByFile.get(node.file)?.node;
      return (
        existing === undefined ||
        existing.hash !== node.hash ||
        existing.stable_id !== node.stable_id ||
        existing.identity_source !== node.identity_source
      );
    })
    .map((node) => node.file)
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

  const computedByFile = indexExistingNodesByFile(computedMeta);
  return Object.values(existingMeta.nodes)
    .map((existingNode): MetaDriftDetail | null => {
      const computedNode = computedByFile.get(existingNode.file)?.node;
      const stableId = existingNode.stable_id ?? computedNode?.stable_id;

      if (computedNode === undefined || stableId === undefined || existingNode.hash === computedNode.hash) {
        return null;
      }

      return {
        file: existingNode.file,
        stable_id: stableId,
        expected_hash: existingNode.hash,
        actual_hash: computedNode.hash,
      };
    })
    .filter((detail): detail is MetaDriftDetail => detail !== null);
}

function recordBaselineSynced(
  target: string,
  input: {
    previousRevision?: string;
    revision: string;
    syncedFiles: string[];
    acceptedStableIds: string[];
    driftDetails: MetaDriftDetail[];
    source: "sync_meta";
  },
): void {
  const eventPath = join(target, ".fabric", "events.jsonl");

  if (input.driftDetails.length > 0) {
    appendEventLedgerEvent(eventPath, {
      event_type: "rule_drift_detected",
      revision: input.previousRevision ?? input.revision,
      drifted_stable_ids: input.driftDetails.map((detail) => detail.stable_id),
      missing_files: input.driftDetails.filter((detail) => detail.actual_hash === null).map((detail) => detail.file),
      stale_files: input.driftDetails.filter((detail) => detail.actual_hash !== null).map((detail) => detail.file),
      details: input.driftDetails,
    });
  }

  appendEventLedgerEvent(eventPath, {
    event_type: "rule_baseline_accepted",
    revision: input.revision,
    previous_revision: input.previousRevision,
    accepted_stable_ids: input.acceptedStableIds,
    source: input.source,
  });
  appendEventLedgerEvent(eventPath, {
    event_type: "baseline_synced",
    revision: input.revision,
    previous_revision: input.previousRevision,
    synced_files: input.syncedFiles,
    accepted_stable_ids: input.acceptedStableIds,
    source: input.source,
  });
}

function appendEventLedgerEvent(eventPath: string, event: Record<string, unknown>): void {
  appendFileSync(
    eventPath,
    `${JSON.stringify({
      ...event,
      kind: "fabric-event",
      id: `event:${randomUUID()}`,
      ts: Date.now(),
      schema_version: 1,
    } satisfies EventLedgerEnvelope & Record<string, unknown>)}\n`,
    "utf8",
  );
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, Object.keys(flattenKeys(value)).sort());
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

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function deriveRuleIdentity(file: string, source: string, existing: NodeMeta | undefined): RuleIdentity {
  const declaredStableId = extractDeclaredStableId(source);
  const derivedStableId = deriveAgentsMetaStableId(file);

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
  const match = /^(?:\uFEFF)?<!--\s*fab:rule-id\s+([A-Za-z0-9][A-Za-z0-9/_-]*)\s*-->\s*(?:\r?\n|$)/u.exec(source);
  return match?.[1];
}
