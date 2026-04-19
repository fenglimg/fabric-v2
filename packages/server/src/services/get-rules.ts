import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { minimatch } from "minimatch";

import { readAgentsMeta } from "../meta-reader.js";
import { readHumanLock } from "./read-human-lock.js";

type RulesEntry = {
  path: string;
  content: string;
};

type HumanLockedNearby = {
  file: string;
  excerpt: string;
};

export type GetRulesInput = {
  path: string;
  client_hash?: string;
};

export type GetRulesResult = {
  revision_hash: string;
  stale: boolean;
  rules: {
    L0: string;
    L1: RulesEntry[];
    L2: RulesEntry[];
    human_locked_nearby: HumanLockedNearby[];
  };
};

const PRIORITY_ORDER: Record<"high" | "medium" | "low", number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export async function getRules(projectRoot: string, input: GetRulesInput): Promise<GetRulesResult> {
  const meta = readAgentsMeta(projectRoot);
  const stale = input.client_hash !== undefined && input.client_hash !== meta.revision;
  const requestedPath = normalizePath(input.path);
  const l0Content = await readFile(join(projectRoot, "AGENTS.md"), "utf8");

  const matchedNodes = Object.entries(meta.nodes)
    .filter(([, node]) => minimatch(requestedPath, normalizePath(node.scope_glob), { dot: true }))
    .sort((left, right) => {
      const [leftId, leftNode] = left;
      const [rightId, rightNode] = right;
      const priorityDelta = PRIORITY_ORDER[leftNode.priority] - PRIORITY_ORDER[rightNode.priority];

      return priorityDelta !== 0 ? priorityDelta : leftId.localeCompare(rightId);
    });

  const loadedRules = await Promise.all(
    matchedNodes.map(async ([nodeId, node]) => ({
      level: classifyNode(nodeId),
      entry: {
        path: node.file,
        content: await readFile(join(projectRoot, node.file), "utf8"),
      },
    })),
  );

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

  const humanLockedNearby = (await readHumanLock(projectRoot)).map((entry) => ({
    file: entry.file,
    excerpt: JSON.stringify(entry),
  }));

  return {
    revision_hash: meta.revision,
    stale,
    rules: {
      L0: l0Content,
      L1: l1,
      L2: l2,
      human_locked_nearby: humanLockedNearby,
    },
  };
}

function normalizePath(value: string): string {
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
