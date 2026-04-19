#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

type TemplateKind = "bootstrap" | "skill";

interface TemplateTarget {
  filePath: string;
  kind: TemplateKind;
}

interface Violation {
  filePath: string;
  message: string;
}

const ROOT = process.cwd();
const BOOTSTRAP_DIR = path.join(ROOT, "templates", "bootstrap");
const CLAUDE_SKILLS_DIR = path.join(ROOT, "templates", "claude-skills");
const PROTECTED_TOKENS_PATH = path.join(
  ROOT,
  "packages",
  "shared",
  "src",
  "i18n",
  "protected-tokens.ts",
);

const BOOTSTRAP_REQUIRED_TOKENS = [
  "fab_get_rules",
  "fab_append_intent",
  "fab_update_registry",
  "AGENTS.md",
  "FABRIC.md",
  ".fabric/agents/",
  ".fabric/agents.meta.json",
  ".fabric/human-lock.json",
  "ledger_entry",
  "agent_meta",
  "shadow constraints",
  "Shadow Mirroring",
  "MUST",
  "NEVER",
];

const SKILL_REQUIRED_TOKENS = [
  "AGENTS.md",
  "FABRIC.md",
  ".fabric/agents.meta.json",
  ".fabric/human-lock.json",
  ".fabric/init-context.json",
  ".fabric/forensic.json",
  "MUST",
  "NEVER",
];

const REGISTRY_REQUIRED_TOKENS = [
  ...BOOTSTRAP_REQUIRED_TOKENS,
  ...SKILL_REQUIRED_TOKENS,
  "CORE RULES",
  "DO NOT TRANSLATE",
];

const CJK_PATTERN = /[\u3400-\u9fff]/;

function relativePath(filePath: string): string {
  return path.relative(ROOT, filePath);
}

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

function extractSection(source: string, headerPattern: RegExp): string | undefined {
  const match = headerPattern.exec(source);

  if (match === null || match.index === undefined) {
    return undefined;
  }

  const sectionStart = match.index + match[0].length;
  const rest = source.slice(sectionStart);
  const nextHeaderIndex = rest.search(/\n##\s+/);
  const section = nextHeaderIndex === -1 ? rest : rest.slice(0, nextHeaderIndex);

  return section.trim();
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
  section: string,
  requiredTokens: string[],
): void {
  for (const token of requiredTokens) {
    if (!section.includes(token)) {
      violations.push({
        filePath,
        message: `core section is missing protected token ${token}`,
      });
    }
  }
}

function validateEnglishCore(
  violations: Violation[],
  filePath: string,
  section: string | undefined,
  requiredTokens: string[],
): void {
  if (section === undefined) {
    violations.push({
      filePath,
      message: "missing core section with DO NOT TRANSLATE marker",
    });
    return;
  }

  if (CJK_PATTERN.test(section)) {
    violations.push({
      filePath,
      message: "core section must remain English-only; move Chinese text to the wrapper section",
    });
  }

  if (!section.includes("MUST") || !section.includes("NEVER")) {
    violations.push({
      filePath,
      message: "core section must contain both MUST and NEVER hard-rule keywords",
    });
  }

  pushMissingTokenViolations(violations, filePath, section, requiredTokens);
}

function validateBootstrapFile(filePath: string, source: string): Violation[] {
  const violations: Violation[] = [];

  if (!/^##\s+CORE RULES\b.*DO NOT TRANSLATE.*$/m.test(source)) {
    violations.push({
      filePath,
      message: "missing '## CORE RULES (DO NOT TRANSLATE)' header",
    });
  }

  if (!/^##\s+使用说明\s*\/\s*Explanation\s*$/m.test(source)) {
    violations.push({
      filePath,
      message: "missing Chinese explanation section '## 使用说明 / Explanation'",
    });
  }

  const coreSection = extractSection(source, /^##\s+CORE RULES\b.*DO NOT TRANSLATE.*\n/m);
  validateEnglishCore(violations, filePath, coreSection, BOOTSTRAP_REQUIRED_TOKENS);

  return violations;
}

function validateSkillFile(filePath: string, source: string): Violation[] {
  const violations: Violation[] = [];

  if (!/^---\nname:\s*[A-Za-z0-9_-]+\ndescription:\s*[A-Za-z0-9]/m.test(source)) {
    violations.push({
      filePath,
      message: "frontmatter name and description must be English fields",
    });
  }

  if (!/^##\s+Hard Rules\b.*DO NOT TRANSLATE.*$/m.test(source)) {
    violations.push({
      filePath,
      message: "missing '## Hard Rules (DO NOT TRANSLATE)' header",
    });
  }

  const hardRulesSection = extractSection(source, /^##\s+Hard Rules\b.*DO NOT TRANSLATE.*\n/m);
  validateEnglishCore(violations, filePath, hardRulesSection, SKILL_REQUIRED_TOKENS);

  return violations;
}

function validateProtectedTokenRegistry(tokens: string[]): Violation[] {
  const violations: Violation[] = [];

  if (tokens.length < 10) {
    violations.push({
      filePath: PROTECTED_TOKENS_PATH,
      message: "PROTECTED_TOKENS must contain at least 10 items",
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

async function main(): Promise<void> {
  const protectedTokenSource = await readFile(PROTECTED_TOKENS_PATH, "utf8");
  const protectedTokens = parseProtectedTokens(protectedTokenSource);
  const violations = validateProtectedTokenRegistry(protectedTokens);

  const bootstrapFiles = (await collectFiles(BOOTSTRAP_DIR)).map<TemplateTarget>((filePath) => ({
    filePath,
    kind: "bootstrap",
  }));
  const skillFiles = (await collectFiles(CLAUDE_SKILLS_DIR))
    .filter((filePath) => filePath.endsWith("SKILL.md"))
    .map<TemplateTarget>((filePath) => ({
      filePath,
      kind: "skill",
    }));

  const targets = [...bootstrapFiles, ...skillFiles];

  for (const target of targets) {
    const source = await readFile(target.filePath, "utf8");
    const targetViolations =
      target.kind === "bootstrap"
        ? validateBootstrapFile(target.filePath, source)
        : validateSkillFile(target.filePath, source);

    violations.push(...targetViolations);
  }

  if (violations.length === 0) {
    process.stdout.write(`protected token lint passed: ${targets.length} template files checked.\n`);
    return;
  }

  process.stderr.write("protected token lint failed.\n");

  for (const violation of violations) {
    process.stderr.write(`- ${relativePath(violation.filePath)}: ${violation.message}\n`);
  }

  process.exitCode = 1;
}

await main();
