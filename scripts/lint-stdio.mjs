#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SERVER_SRC_DIR = path.join(ROOT, "packages", "server", "src");
const BANNED_PATTERN = /\bconsole\.(log|warn|info|error)\s*\(/g;

async function collectTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && fullPath.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

function getLineAndColumn(source, index) {
  const preceding = source.slice(0, index);
  const lines = preceding.split("\n");

  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function formatMatchLabel(match) {
  return match[0].slice(0, match[0].indexOf("("));
}

async function main() {
  let files = [];

  try {
    files = await collectTypeScriptFiles(SERVER_SRC_DIR);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }

    throw error;
  }

  const violations = [];

  for (const filePath of files) {
    const source = await readFile(filePath, "utf8");

    for (const match of source.matchAll(BANNED_PATTERN)) {
      const index = match.index ?? 0;
      const position = getLineAndColumn(source, index);

      violations.push({
        filePath,
        line: position.line,
        column: position.column,
        label: formatMatchLabel(match),
      });
    }
  }

  if (violations.length === 0) {
    return;
  }

  process.stderr.write("stdio lint failed: packages/server must never write to stdout.\n");

  for (const violation of violations) {
    const relativePath = path.relative(ROOT, violation.filePath);

    process.stderr.write(
      `- ${relativePath}:${violation.line}:${violation.column} uses ${violation.label}; use process.stderr.write(...) instead.\n`,
    );
  }

  process.exitCode = 1;
}

await main();
