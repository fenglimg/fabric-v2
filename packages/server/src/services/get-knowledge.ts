import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { deriveAgentsMetaLayer } from "@fenglimg/fabric-shared";
import { minimatch } from "minimatch";

import { contextCache } from "../cache.js";
import { readAgentsMeta, type AgentsMeta } from "../meta-reader.js";
import { appendEventLedgerEvent } from "./event-ledger.js";
import { loadActiveMeta } from "./load-active-meta.js";

// v2.0.0-rc.29 TASK-006 (BUG-Q1): dropped `export` on the following types and
// helpers — knip confirmed they are referenced only inside this file and have
// no cross-package consumers (cli/shared/test). Keeping them local shrinks the
// emitted .d.ts surface without breaking any caller.
type KnowledgeEntryItem = {
  path: string;
  content: string;
};

type DescriptionStub = {
  path: string;
  description: string;
};

type SharedDescriptionStub = DescriptionStub & {
  stable_id: string;
  identity_source: NonNullable<AgentsMeta["nodes"][string]["identity_source"]>;
  level: "L1" | "L2";
};

type HumanLockedNearby = {
  file: string;
  excerpt: string;
};

export type KnowledgePayload = {
  L0: string;
  L1: KnowledgeEntryItem[];
  L2: KnowledgeEntryItem[];
  human_locked_nearby: HumanLockedNearby[];
  description_stubs?: DescriptionStub[];
};

export type GetKnowledgeInput = {
  path: string;
  client_hash?: string;
  correlation_id?: string;
  session_id?: string;
};

export type GetKnowledgeResult = {
  revision_hash: string;
  stale: boolean;
  rules: KnowledgePayload;
};

export type GetKnowledgeContext = {
  meta: AgentsMeta;
  l0Content: string;
  humanLockedNearby: HumanLockedNearby[];
};

type LoadedRule = {
  level: "L1" | "L2";
  stable_id: string;
  identity_source: NonNullable<AgentsMeta["nodes"][string]["identity_source"]>;
  entry: KnowledgeEntryItem;
};

type LoadedKnowledgeResult = {
  rules: LoadedRule[];
  stubs: SharedDescriptionStub[];
};

type MatchedRuleNode = {
  node_id: string;
  level: "L1" | "L2" | null;
  stable_id: string;
  identity_source: NonNullable<AgentsMeta["nodes"][string]["identity_source"]>;
  node: AgentsMeta["nodes"][string];
};

// v2.0.0-rc.30 TASK-003: PRIORITY_ORDER removed alongside matchRuleNodes'
// priority-based tiebreaker. Sort key is now stable_id lex only; reintroduce
// this constant if a real priority signal returns to the schema.

export async function getKnowledge(projectRoot: string, input: GetKnowledgeInput): Promise<GetKnowledgeResult> {
  // v2.0.0-rc.22 Scope D T-D2: strict meta-load happens BEFORE the context
  // cache lookup so a stale on-disk meta is auto-healed (and the ledger event
  // emitted) before any downstream path-based rule matching runs. If a heal
  // fired the meta slot is already invalidated by loadActiveMeta — we also
  // drop the context slot here so the rebuilt context picks up the new meta
  // instead of returning a TTL-cached snapshot keyed on the prior revision.
  const metaResult = await loadActiveMeta(projectRoot, { caller: "getKnowledge" });
  if (metaResult.auto_healed) {
    // contextCache.invalidate only knows "meta_write" / "file_watch"; the
    // first clears just the meta slot, the second clears meta + context. We
    // want "context too" because the cached GetKnowledgeContext embeds the
    // pre-heal meta. "file_watch" is the closest reason — semantically the
    // on-disk file did just change (we just wrote it).
    contextCache.invalidate("file_watch", projectRoot);
  }
  const context = await loadGetKnowledgeContext(projectRoot);
  const stale = input.client_hash !== undefined && input.client_hash !== context.meta.revision;
  const matchedNodes = matchRuleNodes(context.meta, input.path);
  const requiredStableIds = matchedNodes
    .filter((node) => node.level === "L2")
    .map((node) => node.stable_id);
  const aiSelectableStableIds = matchedNodes
    .filter((node) => node.level === "L1")
    .map((node) => node.stable_id);
  const rules = await resolveKnowledgeForPath(projectRoot, context, input.path);
  const result = {
    revision_hash: context.meta.revision,
    stale,
    rules,
  };

  try {
    await appendEventLedgerEvent(projectRoot, {
      event_type: "knowledge_context_planned",
      target_paths: [input.path],
      required_stable_ids: requiredStableIds,
      ai_selectable_stable_ids: aiSelectableStableIds,
      final_stable_ids: [...requiredStableIds, ...aiSelectableStableIds],
      client_hash: input.client_hash,
      correlation_id: input.correlation_id,
      session_id: input.session_id,
    });
  } catch {
    // Telemetry is best-effort and must not block rule delivery.
  }

  return result;
}

export async function loadGetKnowledgeContext(projectRoot: string): Promise<GetKnowledgeContext> {
  const cached = contextCache.get<GetKnowledgeContext>("context", projectRoot);
  if (cached !== undefined) {
    return cached;
  }

  const meta = await readAgentsMeta(projectRoot);
  const l0Content = await readFile(join(projectRoot, ".fabric", "bootstrap", "README.md"), "utf8");

  const context: GetKnowledgeContext = {
    meta,
    l0Content,
    humanLockedNearby: [],
  };

  contextCache.set("context", projectRoot, context);
  return context;
}

export async function resolveKnowledgeForPath(
  projectRoot: string,
  context: GetKnowledgeContext,
  path: string,
  options: {
    dedupeByPath?: boolean;
  } = {},
): Promise<KnowledgePayload> {
  const matchedNodes = matchRuleNodes(context.meta, path);
  const loaded = await loadMatchedRules(projectRoot, matchedNodes);
  return buildKnowledgePayload(context, loaded, options);
}

export function normalizeKnowledgePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function matchRuleNodes(meta: AgentsMeta, path: string): MatchedRuleNode[] {
  const requestedPath = normalizeKnowledgePath(path);

  // v2.0.0-rc.30 TASK-003: removed `node.priority` passthrough fallback from
  // the sort key. The rc.5 A1 retire dropped `priority` from the declared
  // schema; passthrough values were untrusted and historically defaulted to
  // "medium" for every node anyway (effectively a no-op tiebreaker). Sort
  // now collapses to stable_id lexicographic order, matching the actual
  // observable behaviour on every real workspace.
  return Object.entries(meta.nodes)
    .filter(([, node]) => shouldLoadNodeForPath(requestedPath, node))
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([nodeId, node]) => ({
      node_id: nodeId,
      level: classifyNode(nodeId, node),
      stable_id: node.stable_id ?? nodeId,
      identity_source: node.identity_source ?? "derived",
      node,
    }));
}

async function loadMatchedRules(
  projectRoot: string,
  matchedNodes: MatchedRuleNode[],
  fileContentCache: Map<string, Promise<string>> = new Map(),
): Promise<LoadedKnowledgeResult> {
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

function buildKnowledgePayload(
  context: GetKnowledgeContext,
  loaded: LoadedKnowledgeResult,
  options: {
    dedupeByPath?: boolean;
  } = {},
): KnowledgePayload {
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
  // v2.0.0-rc.30 TASK-003 (B.1 前置): 三段 fallback 简化为二段。
  // node-id prefix override 保留 — get-knowledge.test.ts fixture 用
  // "L1/always" 等 id 形式 pin layer 不依赖 file path 深度。
  // 第三段 `node.layer === "L0" ? null : (node.layer ?? null)` 改为
  // `node.level ?? deriveAgentsMetaLayer(file)`,移除对 passthrough
  // `node.layer` 的依赖 (即将由 TASK-004 删除该字段);
  // declared `node.level` 优先依然有效,只在未声明时走 derive。
  if (nodeId.startsWith("L1/")) {
    return "L1";
  }
  if (nodeId.startsWith("L2/")) {
    return "L2";
  }
  const layer = node.level ?? deriveAgentsMetaLayer(node.file);
  return layer === "L0" ? null : layer;
}

function partitionRulesByLevel(
  loadedRules: LoadedRule[],
  dedupeByPath: boolean,
): Pick<KnowledgePayload, "L1" | "L2"> {
  const l1: KnowledgeEntryItem[] = [];
  const l2: KnowledgeEntryItem[] = [];

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

function dedupeEntriesByPath(entries: KnowledgeEntryItem[]): KnowledgeEntryItem[] {
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
      return minimatch(requestedPath, normalizeKnowledgePath(node.scope_glob), { dot: true });
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
