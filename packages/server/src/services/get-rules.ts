import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { minimatch } from "minimatch";

import { contextCache } from "../cache.js";
import { readAgentsMeta, type AgentsMeta } from "../meta-reader.js";
import { appendGetRulesAuditEvent } from "./audit-log.js";
import { readHumanLock } from "./read-human-lock.js";

export type RulesEntry = {
  path: string;
  content: string;
};

export type DescriptionStub = {
  path: string;
  description: string;
};

export type SharedDescriptionStub = DescriptionStub & {
  stable_id: string;
  identity_source: NonNullable<AgentsMeta["nodes"][string]["identity_source"]>;
  level: "L1" | "L2";
};

export type HumanLockedNearby = {
  file: string;
  excerpt: string;
};

export type RulesPayload = {
  L0: string;
  L1: RulesEntry[];
  L2: RulesEntry[];
  human_locked_nearby: HumanLockedNearby[];
  description_stubs?: DescriptionStub[];
};

export type GetRulesInput = {
  path: string;
  client_hash?: string;
};

export type GetRulesResult = {
  revision_hash: string;
  stale: boolean;
  rules: RulesPayload;
};

export type GetRulesContext = {
  meta: AgentsMeta;
  l0Content: string;
  humanLockedNearby: HumanLockedNearby[];
};

type LoadedRule = {
  level: "L1" | "L2";
  stable_id: string;
  identity_source: NonNullable<AgentsMeta["nodes"][string]["identity_source"]>;
  entry: RulesEntry;
};

export type LoadedRulesResult = {
  rules: LoadedRule[];
  stubs: SharedDescriptionStub[];
};

export type MatchedRuleNode = {
  node_id: string;
  level: "L1" | "L2" | null;
  stable_id: string;
  identity_source: NonNullable<AgentsMeta["nodes"][string]["identity_source"]>;
  node: AgentsMeta["nodes"][string];
};

const PRIORITY_ORDER: Record<"high" | "medium" | "low", number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export async function getRules(projectRoot: string, input: GetRulesInput): Promise<GetRulesResult> {
  const context = await loadGetRulesContext(projectRoot);
  const stale = input.client_hash !== undefined && input.client_hash !== context.meta.revision;
  const rules = await resolveRulesForPath(projectRoot, context, input.path);
  const result = {
    revision_hash: context.meta.revision,
    stale,
    rules,
  };

  try {
    await appendGetRulesAuditEvent(projectRoot, {
      path: input.path,
      client_hash: input.client_hash,
    });
  } catch {
    // Compliance telemetry is best-effort and must not block rule delivery.
  }

  return result;
}

export async function loadGetRulesContext(projectRoot: string): Promise<GetRulesContext> {
  const cached = contextCache.get<GetRulesContext>("context", projectRoot);
  if (cached !== undefined) {
    return cached;
  }

  const meta = await readAgentsMeta(projectRoot);
  const l0Content = await readFile(join(projectRoot, ".fabric", "bootstrap", "README.md"), "utf8");
  const humanLockedNearby = (await readHumanLock(projectRoot)).map((entry) => ({
    file: entry.file,
    excerpt: JSON.stringify(entry),
  }));

  const context: GetRulesContext = {
    meta,
    l0Content,
    humanLockedNearby,
  };

  contextCache.set("context", projectRoot, context);
  return context;
}

export async function resolveRulesForPath(
  projectRoot: string,
  context: GetRulesContext,
  path: string,
  options: {
    dedupeByPath?: boolean;
  } = {},
): Promise<RulesPayload> {
  const matchedNodes = matchRuleNodes(context.meta, path);
  const loaded = await loadMatchedRules(projectRoot, matchedNodes);
  return buildRulesPayload(context, loaded, options);
}

export function normalizeRulesPath(value: string): string {
  return value.replaceAll("\\", "/");
}

export function matchRuleNodes(meta: AgentsMeta, path: string): MatchedRuleNode[] {
  const requestedPath = normalizeRulesPath(path);

  return Object.entries(meta.nodes)
    .filter(([, node]) => shouldLoadNodeForPath(requestedPath, node))
    .sort((left, right) => {
      const [leftId, leftNode] = left;
      const [rightId, rightNode] = right;
      const priorityDelta = PRIORITY_ORDER[leftNode.priority] - PRIORITY_ORDER[rightNode.priority];

      return priorityDelta !== 0 ? priorityDelta : leftId.localeCompare(rightId);
    })
    .map(([nodeId, node]) => ({
      node_id: nodeId,
      level: classifyNode(nodeId, node),
      stable_id: node.stable_id ?? nodeId,
      identity_source: node.identity_source ?? "derived",
      node,
    }));
}

export async function loadMatchedRules(
  projectRoot: string,
  matchedNodes: MatchedRuleNode[],
  fileContentCache: Map<string, Promise<string>> = new Map(),
): Promise<LoadedRulesResult> {
  const rules: LoadedRule[] = [];
  const stubs: SharedDescriptionStub[] = [];

  for (const matchedNode of matchedNodes) {
    if (matchedNode.level === null) {
      continue;
    }

    if (matchedNode.node.activation?.tier === "description") {
      stubs.push({
        stable_id: matchedNode.stable_id,
        identity_source: matchedNode.identity_source,
        level: matchedNode.level,
        path: matchedNode.node.file,
        description: matchedNode.node.activation.description ?? "",
      });
      continue;
    }

    rules.push({
      level: matchedNode.level,
      stable_id: matchedNode.stable_id,
      identity_source: matchedNode.identity_source,
      entry: {
        path: matchedNode.node.file,
        content: await readRuleContent(projectRoot, matchedNode.node.file, fileContentCache),
      },
    });
  }

  return { rules, stubs };
}

export function buildRulesPayload(
  context: GetRulesContext,
  loaded: LoadedRulesResult,
  options: {
    dedupeByPath?: boolean;
  } = {},
): RulesPayload {
  const { L1, L2 } = partitionRulesByLevel(loaded.rules, options.dedupeByPath ?? false);

  return {
    L0: context.l0Content,
    L1,
    L2,
    human_locked_nearby: context.humanLockedNearby,
    description_stubs:
      loaded.stubs.length > 0 ? dedupeDescriptionStubsByPath(loaded.stubs).map(toDescriptionStub) : undefined,
  };
}

function classifyNode(
  nodeId: string,
  node: AgentsMeta["nodes"][string],
): "L1" | "L2" | null {
  if (nodeId.startsWith("L1/")) {
    return "L1";
  }

  if (nodeId.startsWith("L2/")) {
    return "L2";
  }

  return node.layer === "L0" ? null : node.layer;
}

function partitionRulesByLevel(
  loadedRules: LoadedRule[],
  dedupeByPath: boolean,
): Pick<RulesPayload, "L1" | "L2"> {
  const l1: RulesEntry[] = [];
  const l2: RulesEntry[] = [];

  for (const rule of loadedRules) {
    if (rule.level === "L1") {
      l1.push(rule.entry);
      continue;
    }

    if (rule.level === "L2") {
      l2.push(rule.entry);
    }
  }

  return {
    L1: dedupeByPath ? dedupeEntriesByPath(l1) : l1,
    L2: dedupeByPath ? dedupeEntriesByPath(l2) : l2,
  };
}

function dedupeEntriesByPath(entries: RulesEntry[]): RulesEntry[] {
  const seenPaths = new Set<string>();

  return entries.filter((entry) => {
    if (seenPaths.has(entry.path)) {
      return false;
    }

    seenPaths.add(entry.path);
    return true;
  });
}

function shouldLoadNodeForPath(
  requestedPath: string,
  node: AgentsMeta["nodes"][string],
): boolean {
  switch (node.activation?.tier) {
    case "always":
      return true;
    case "description":
      return true;
    case "path":
    case undefined:
      return minimatch(requestedPath, normalizeRulesPath(node.scope_glob), { dot: true });
  }
}

function dedupeDescriptionStubsByPath(stubs: DescriptionStub[]): DescriptionStub[] {
  const seenPaths = new Set<string>();

  return stubs.filter((stub) => {
    if (seenPaths.has(stub.path)) {
      return false;
    }

    seenPaths.add(stub.path);
    return true;
  });
}

function toDescriptionStub(stub: DescriptionStub): DescriptionStub {
  return {
    path: stub.path,
    description: stub.description,
  };
}

async function readRuleContent(
  projectRoot: string,
  file: string,
  fileContentCache: Map<string, Promise<string>>,
): Promise<string> {
  const cached = fileContentCache.get(file);
  if (cached !== undefined) {
    return await cached;
  }

  const pending = readFile(join(projectRoot, file), "utf8");
  fileContentCache.set(file, pending);
  return await pending;
}
