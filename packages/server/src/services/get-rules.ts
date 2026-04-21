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

export type HumanLockedNearby = {
  file: string;
  excerpt: string;
};

export type RulesPayload = {
  L0: string;
  L1: RulesEntry[];
  L2: RulesEntry[];
  human_locked_nearby: HumanLockedNearby[];
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
  level: "L1" | "L2" | null;
  entry: RulesEntry;
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
  const l0Content = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
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
  const loadedRules = await loadRulesForPath(projectRoot, context.meta, path);
  const { L1, L2 } = partitionRulesByLevel(loadedRules, options.dedupeByPath ?? false);

  return {
    L0: context.l0Content,
    L1,
    L2,
    human_locked_nearby: context.humanLockedNearby,
  };
}

export function normalizeRulesPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function classifyNode(nodeId: string): "L1" | "L2" | null {
  if (nodeId.startsWith("L1/")) {
    return "L1";
  }

  if (nodeId.startsWith("L2/")) {
    return "L2";
  }

  return null;
}

async function loadRulesForPath(
  projectRoot: string,
  meta: AgentsMeta,
  path: string,
): Promise<LoadedRule[]> {
  const requestedPath = normalizeRulesPath(path);
  const matchedNodes = Object.entries(meta.nodes)
    .filter(([, node]) => minimatch(requestedPath, normalizeRulesPath(node.scope_glob), { dot: true }))
    .sort((left, right) => {
      const [leftId, leftNode] = left;
      const [rightId, rightNode] = right;
      const priorityDelta = PRIORITY_ORDER[leftNode.priority] - PRIORITY_ORDER[rightNode.priority];

      return priorityDelta !== 0 ? priorityDelta : leftId.localeCompare(rightId);
    });

  return await Promise.all(
    matchedNodes.map(async ([nodeId, node]) => ({
      level: classifyNode(nodeId),
      entry: {
        path: node.file,
        content: await readFile(join(projectRoot, node.file), "utf8"),
      },
    })),
  );
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
