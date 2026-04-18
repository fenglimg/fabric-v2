import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { minimatch } from "minimatch";
import { z } from "zod";

import { readAgentsMeta, resolveProjectRoot } from "../meta-reader.js";

type RulesEntry = {
  path: string;
  content: string;
};

type HumanLockedNearby = {
  file: string;
  excerpt: string;
};

type GetRulesInput = {
  path: string;
  client_hash?: string;
};

const inputSchema = {
  path: z.string().describe("Target file path to query rules for"),
  client_hash: z
    .string()
    .optional()
    .describe("Revision hash from prior fab_get_rules response; enables stale detection"),
};

const PRIORITY_ORDER: Record<"high" | "medium" | "low", number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function createTextResponse(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload),
      },
    ],
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

async function readHumanLockedNearby(projectRoot: string): Promise<HumanLockedNearby[]> {
  const humanLockPath = join(projectRoot, ".fabric", "human-lock.json");

  try {
    const raw = await readFile(humanLockPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const entries = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && "human_locked" in parsed && Array.isArray(parsed.human_locked)
        ? parsed.human_locked
        : [];

    return entries.map((entry) => {
      if (!entry || typeof entry !== "object") {
        return {
          file: "(unknown)",
          excerpt: JSON.stringify(entry),
        };
      }

      const file = typeof entry.file === "string" ? entry.file : "(unknown)";
      const excerptCandidate =
        typeof entry.excerpt === "string"
          ? entry.excerpt
          : typeof entry.locked_text === "string"
            ? entry.locked_text
            : typeof entry.text === "string"
              ? entry.text
              : typeof entry.content === "string"
                ? entry.content
                : JSON.stringify(entry);

      return {
        file,
        excerpt: excerptCandidate,
      };
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export function registerGetRules(server: McpServer): void {
  server.tool(
    "fab_get_rules",
    "MANDATORY: Call before modifying any file to retrieve Fabric rules for a target path.",
    inputSchema,
    async ({ path, client_hash }: GetRulesInput) => {
      const projectRoot = resolveProjectRoot();
      const meta = readAgentsMeta(projectRoot);
      const stale = client_hash !== undefined && client_hash !== meta.revision;
      const requestedPath = normalizePath(path);
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

      const humanLockedNearby = await readHumanLockedNearby(projectRoot);

      return createTextResponse({
        revision_hash: meta.revision,
        stale,
        rules: {
          L0: l0Content,
          L1: l1,
          L2: l2,
          human_locked_nearby: humanLockedNearby,
        },
      });
    },
  );
}
