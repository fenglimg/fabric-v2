#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface ClientSpec {
  outputName: string;
  frontmatter: Record<string, unknown>;
}

type ClientsJson = Record<string, ClientSpec>;

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE_DIR = path.join(ROOT, "packages", "cli", "templates", "skill-source", "fabric-init");
const SOURCE_MD = path.join(SOURCE_DIR, "SOURCE.md");
const CLIENTS_JSON = path.join(SOURCE_DIR, "clients.json");

function serializeFrontmatter(fm: Record<string, unknown>): string {
  const lines: string[] = ["---"];

  for (const [key, value] of Object.entries(fm)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => JSON.stringify(v)).join(", ")}]`);
    } else if (typeof value === "string") {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }

  lines.push("---");
  return lines.join("\n");
}

export interface BuildSkillsOptions {
  /** Base directory for client output folders. Defaults to repo root. */
  outputBase?: string;
}

export interface BuildSkillsResult {
  /** Map of clientName -> { outputPath, content } */
  outputs: Map<string, { outputPath: string; content: string }>;
}

export async function buildSkills(opts?: BuildSkillsOptions): Promise<BuildSkillsResult> {
  const outputBase = opts?.outputBase ?? ROOT;

  const clientOutputDirs: Record<string, string> = {
    claude: path.join(outputBase, "packages", "cli", "templates", "claude-skills"),
    codex: path.join(outputBase, "packages", "cli", "templates", "codex-skills"),
  };

  const [sourceBody, clientsRaw] = await Promise.all([
    readFile(SOURCE_MD, "utf8"),
    readFile(CLIENTS_JSON, "utf8"),
  ]);

  const clients = JSON.parse(clientsRaw) as ClientsJson;
  const outputs = new Map<string, { outputPath: string; content: string }>();

  for (const [clientName, spec] of Object.entries(clients)) {
    const baseDir = clientOutputDirs[clientName];

    if (baseDir === undefined) {
      process.stderr.write(`[skills] unknown client "${clientName}" — skipping\n`);
      continue;
    }

    const outputDir = path.join(baseDir, spec.outputName);
    const outputPath = path.join(outputDir, "SKILL.md");

    const frontmatterBlock = serializeFrontmatter(spec.frontmatter);
    const content = `${frontmatterBlock}\n\n${sourceBody}`;

    await mkdir(outputDir, { recursive: true });
    await writeFile(outputPath, content, "utf8");

    const bytes = Buffer.byteLength(content, "utf8");
    process.stdout.write(`[skills] wrote ${path.relative(outputBase, outputPath)} (${bytes} bytes)\n`);

    outputs.set(clientName, { outputPath, content });
  }

  return { outputs };
}

// Run as CLI when invoked directly
await buildSkills();
