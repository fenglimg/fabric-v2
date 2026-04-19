import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  agentsMetaSchema,
  deriveAgentsMetaLayer,
  deriveAgentsMetaTopologyType,
  type AgentsLayer,
  type AgentsMeta,
  type AgentsTopologyType,
} from "@fenglimg/fabric-shared";
import { defineCommand } from "citty";

import { t } from "../i18n.js";

type NodeMeta = AgentsMeta["nodes"][string];

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

  const bootstrapNode = createBootstrapNode(target, existingByFile.get("AGENTS.md")?.node);

  if (bootstrapNode !== undefined) {
    nodes.L0 = bootstrapNode;
  }

  for (const file of agentsFiles) {
    const existing = existingByFile.get(file);
    const id = deriveNodeId(file);
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
  if (file === "AGENTS.md") {
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
  const bootstrapPath = join(target, "AGENTS.md");

  if (!existsSync(bootstrapPath)) {
    return undefined;
  }

  const hash = sha256(readFileSync(bootstrapPath, "utf8"));

  return {
    ...createDefaultNodeMeta("AGENTS.md"),
    ...existing,
    file: "AGENTS.md",
    hash,
  };
}

function deriveScopeGlob(file: string): string {
  if (file === "AGENTS.md") {
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
