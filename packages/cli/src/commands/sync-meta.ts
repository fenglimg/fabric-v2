import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  agentsMetaSchema,
  deriveAgentsMetaLayer,
  deriveAgentsMetaStableId,
  deriveAgentsMetaTopologyType,
  type AgentsLayer,
  type AgentsMeta,
  type AgentsIdentitySource,
  type AgentsTopologyType,
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
    const computedMeta = computeAgentsMeta(target);
    const existingMeta = readExistingMeta(metaPath);

    if (args["check-only"]) {
      if (!existingMeta || stableStringify(existingMeta) !== stableStringify(computedMeta)) {
        writeStderr(t("cli.sync-meta.drift-detected"));
        process.exitCode = 1;
      }
      return;
    }

    if (existingMeta && stableStringify(existingMeta) === stableStringify(computedMeta)) {
      return;
    }

    mkdirSync(join(target, ".fabric"), { recursive: true });
    writeFileSync(metaPath, `${JSON.stringify(computedMeta, null, 2)}\n`, "utf8");
    recordBaselineSynced(target, {
      previousRevision: existingMeta?.revision,
      revision: computedMeta.revision,
      syncedFiles: collectSyncedFiles(existingMeta, computedMeta),
      acceptedStableIds: collectStableIds(computedMeta),
      driftDetails: collectDriftDetails(existingMeta, computedMeta),
      source: "sync_meta",
    });
    writeStderr(t("cli.sync-meta.updated", { label: t("cli.shared.updated"), path: metaPath }));
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
