import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { defineCommand } from "citty";

import { resolveIgnores } from "../scanner/ignores.js";

type NodeMeta = {
  file: string;
  scope_glob: string;
  deps: string[];
  priority: string;
  hash: string;
};

type AgentsMeta = {
  revision: string;
  nodes: Record<string, NodeMeta>;
  [key: string]: unknown;
};

type SyncMetaArgs = {
  target: string;
  "check-only"?: boolean;
};

export const syncMetaCommand = defineCommand({
  meta: {
    name: "sync-meta",
    description: "Sync Fabric metadata from AGENTS.md files.",
  },
  args: {
    target: {
      type: "string",
      description: "Target project path. Defaults to the current working directory.",
      default: process.cwd(),
    },
    "check-only": {
      type: "boolean",
      description: "Exit with code 1 if .fabric/agents.meta.json is stale.",
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
        writeStderr("Fabric metadata drift detected. Run fab sync-meta to update.");
        process.exitCode = 1;
      }
      return;
    }

    if (existingMeta && stableStringify(existingMeta) === stableStringify(computedMeta)) {
      return;
    }

    mkdirSync(join(target, ".fabric"), { recursive: true });
    writeFileSync(metaPath, `${JSON.stringify(computedMeta, null, 2)}\n`, "utf8");
    writeStderr(`Updated ${metaPath}`);
  },
});

export default syncMetaCommand;

export function computeAgentsMeta(target: string): AgentsMeta {
  assertExistingDirectory(target);

  const metaPath = join(target, ".fabric", "agents.meta.json");
  const existingMeta = readExistingMeta(metaPath);
  const existingByFile = indexExistingNodesByFile(existingMeta);
  const agentsFiles = findAgentsFiles(target);
  const nodes: Record<string, NodeMeta> = {};

  for (const file of agentsFiles) {
    const existing = existingByFile.get(file);
    const id = existing?.id ?? deriveNodeId(file);
    const hash = sha256(readFileSync(join(target, file), "utf8"));
    const defaults = createDefaultNodeMeta(file);

    nodes[id] = {
      ...defaults,
      ...existing?.node,
      file,
      hash,
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
    throw new Error(`Target must be an existing directory: ${target}`);
  }
}

function readExistingMeta(metaPath: string): AgentsMeta | undefined {
  if (!existsSync(metaPath)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(metaPath, "utf8")) as AgentsMeta;
  } catch {
    return undefined;
  }
}

function findAgentsFiles(target: string): string[] {
  const ignorePatterns = resolveIgnores();
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

      if (shouldIgnore(relativePath, entry.isDirectory(), ignorePatterns)) {
        continue;
      }

      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else if (entry.isFile() && entry.name === "AGENTS.md") {
        files.push(relativePath);
      }
    }
  }

  return files.sort();
}

function shouldIgnore(relativePath: string, isDirectory: boolean, ignorePatterns: string[]): boolean {
  return ignorePatterns.some((pattern) => matchesIgnorePattern(relativePath, isDirectory, pattern));
}

function matchesIgnorePattern(relativePath: string, isDirectory: boolean, pattern: string): boolean {
  const normalizedPattern = toPosixPath(pattern);

  if (normalizedPattern === "**/*.meta") {
    return relativePath.endsWith(".meta");
  }

  if (normalizedPattern.endsWith("/**")) {
    const directoryPrefix = normalizedPattern.slice(0, -3);
    return (
      relativePath === directoryPrefix ||
      relativePath.startsWith(`${directoryPrefix}/`) ||
      (isDirectory && `${relativePath}/` === directoryPrefix)
    );
  }

  return relativePath === normalizedPattern;
}

function indexExistingNodesByFile(existingMeta: AgentsMeta | undefined): Map<string, { id: string; node: NodeMeta }> {
  const byFile = new Map<string, { id: string; node: NodeMeta }>();

  for (const [id, node] of Object.entries(existingMeta?.nodes ?? {})) {
    byFile.set(toPosixPath(node.file), { id, node });
  }

  return byFile;
}

function deriveNodeId(file: string): string {
  if (file === "AGENTS.md") {
    return "L0";
  }

  return file.replace(/\/AGENTS\.md$/, "");
}

function createDefaultNodeMeta(file: string): NodeMeta {
  const scope = file === "AGENTS.md" ? "**" : `${file.replace(/\/AGENTS\.md$/, "")}/**`;

  return {
    file,
    scope_glob: scope,
    deps: file === "AGENTS.md" ? [] : ["L0"],
    priority: file === "AGENTS.md" ? "high" : "medium",
    hash: "",
  };
}

function sortNodes(nodes: Record<string, NodeMeta>): Record<string, NodeMeta> {
  return Object.fromEntries(Object.entries(nodes).sort(([left], [right]) => left.localeCompare(right)));
}

function computeRevision(nodes: Record<string, NodeMeta>): string {
  const hashes = Object.values(sortNodes(nodes)).map((node) => node.hash).join("");
  return sha256(hashes);
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
