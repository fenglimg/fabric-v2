#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

interface Violation {
  filePath: string;
  message: string;
}

const ROOT = process.cwd();
const BOOTSTRAP_DIR = path.join(ROOT, "packages", "cli", "templates", "bootstrap");
const SKILLS_DIR = path.join(ROOT, "packages", "cli", "templates", "skills");
const PROTECTED_TOKENS_PATH = path.join(
  ROOT,
  "packages",
  "shared",
  "src",
  "i18n",
  "protected-tokens.ts",
);

// Tokens every bootstrap template MUST contain verbatim. v2.0 bootstrap files
// are short pointer files (the heavy lifting moved into AGENTS.md + the
// runtime fab_get_knowledge_sections payload), so the universal contract is
// just: which two MCP tools to call on edit, and where the event ledger lives.
// Drifting any of these silently breaks the AI-client handshake.
const BOOTSTRAP_REQUIRED_TOKENS = [
  "fab_plan_context",
  "fab_get_knowledge_sections",
  ".fabric/events.jsonl",
];

// Tokens every SKILL.md MUST contain verbatim. v2.0 skills are intentionally
// mixed bilingual (Chinese narrative + English protocol tokens) so the lint
// enforces only the load-bearing English anchors, not section structure.
const SKILL_REQUIRED_TOKENS = ["MUST", "NEVER", ".fabric/knowledge/"];

// Per-skill MCP tool that the skill wires up. Keyed by the parent directory
// name under templates/skills/. Each entry MUST name the MCP tool(s) that
// the skill actually calls — translating them breaks the skill's behavior.
const SKILL_MCP_TOKENS: Record<string, string[]> = {
  "fabric-archive": ["fab_extract_knowledge"],
  "fabric-import": ["fab_extract_knowledge", "fab_review"],
  "fabric-review": ["fab_review"],
};

// PROTECTED_TOKENS registry MUST include these — they form the canonical
// v2.0 protocol surface (MCP tools + ledger anchors + hard-rule keywords)
// that any future tooling reuse should respect.
const REGISTRY_REQUIRED_TOKENS = [
  ...BOOTSTRAP_REQUIRED_TOKENS,
  ...SKILL_REQUIRED_TOKENS,
  ".fabric/agents.meta.json",
  "fab_extract_knowledge",
  "fab_review",
];

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function parseProtectedTokens(source: string): string[] {
  const arrayMatch = /export\s+const\s+PROTECTED_TOKENS\s*=\s*\[([\s\S]*?)\]\s*as\s+const\s*;/.exec(source);

  if (arrayMatch === null) {
    throw new Error("Cannot find exported PROTECTED_TOKENS array.");
  }

  const tokens: string[] = [];
  const stringPattern = /"((?:\\.|[^"\\])*)"/g;

  for (const match of arrayMatch[1].matchAll(stringPattern)) {
    tokens.push(JSON.parse(`"${match[1]}"`) as string);
  }

  return tokens;
}

function pushMissingTokenViolations(
  violations: Violation[],
  filePath: string,
  source: string,
  requiredTokens: readonly string[],
): void {
  for (const token of requiredTokens) {
    if (!source.includes(token)) {
      violations.push({
        filePath,
        message: `template is missing protected token ${token}`,
      });
    }
  }
}

export function validateBootstrapFile(filePath: string, source: string): Violation[] {
  const violations: Violation[] = [];
  pushMissingTokenViolations(violations, filePath, source, BOOTSTRAP_REQUIRED_TOKENS);
  return violations;
}

export function validateSkillFile(filePath: string, source: string): Violation[] {
  const violations: Violation[] = [];
  pushMissingTokenViolations(violations, filePath, source, SKILL_REQUIRED_TOKENS);

  const skillName = path.basename(path.dirname(filePath));
  const mcpTokens = SKILL_MCP_TOKENS[skillName];
  if (mcpTokens !== undefined) {
    pushMissingTokenViolations(violations, filePath, source, mcpTokens);
  }

  return violations;
}

function validateProtectedTokenRegistry(tokens: string[]): Violation[] {
  const violations: Violation[] = [];

  if (tokens.length === 0) {
    violations.push({
      filePath: PROTECTED_TOKENS_PATH,
      message: "PROTECTED_TOKENS must contain at least one entry",
    });
  }

  for (const token of new Set(REGISTRY_REQUIRED_TOKENS)) {
    if (!tokens.includes(token)) {
      violations.push({
        filePath: PROTECTED_TOKENS_PATH,
        message: `PROTECTED_TOKENS is missing ${token}`,
      });
    }
  }

  return violations;
}

function relativePath(filePath: string): string {
  return path.relative(ROOT, filePath);
}

export async function main(): Promise<void> {
  const protectedTokenSource = await readFile(PROTECTED_TOKENS_PATH, "utf8");
  const protectedTokens = parseProtectedTokens(protectedTokenSource);
  const violations = validateProtectedTokenRegistry(protectedTokens);

  const bootstrapFiles = await collectFiles(BOOTSTRAP_DIR);
  const skillFiles = (await collectFiles(SKILLS_DIR)).filter((filePath) =>
    filePath.endsWith("SKILL.md"),
  );

  for (const filePath of bootstrapFiles) {
    const source = await readFile(filePath, "utf8");
    violations.push(...validateBootstrapFile(filePath, source));
  }

  for (const filePath of skillFiles) {
    const source = await readFile(filePath, "utf8");
    violations.push(...validateSkillFile(filePath, source));
  }

  const totalChecked = bootstrapFiles.length + skillFiles.length;

  if (violations.length === 0) {
    process.stdout.write(`protected token lint passed: ${totalChecked} template files checked.\n`);
    return;
  }

  process.stderr.write("protected token lint failed.\n");

  for (const violation of violations) {
    process.stderr.write(`- ${relativePath(violation.filePath)}: ${violation.message}\n`);
  }

  process.exitCode = 1;
}

const entryPath = process.argv[1];
const isMainModule = entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url;

if (isMainModule) {
  await main();
}
