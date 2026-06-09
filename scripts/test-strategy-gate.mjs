#!/usr/bin/env node
// Lightweight drift gate for docs/TESTING.md.
//
// This does not judge coverage quality. It keeps the testing strategy entry
// actionable by checking that required sections exist, documented root scripts
// are real, and CI runs the strategy gate.

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");

function readText(relPath) {
  const abs = resolve(REPO_ROOT, relPath);
  if (!existsSync(abs)) {
    throw new Error(`Missing required file: ${relPath}`);
  }
  return readFileSync(abs, "utf8");
}

function fail(message) {
  console.error(`[test-strategy-gate] FAIL: ${message}`);
  process.exitCode = 1;
}

function requireIncludes(label, text, needle) {
  if (!text.includes(needle)) {
    fail(`${label} missing ${JSON.stringify(needle)}`);
  }
}

const docsPath = process.env.FABRIC_TEST_STRATEGY_DOCS ?? "docs/TESTING.md";

const docs = readText(docsPath);
const rootPackage = JSON.parse(readText("package.json"));
const reusableValidate = readText(".github/workflows/reusable-validate.yml");
const ci = readText(".github/workflows/ci.yml");

for (const heading of [
  "## Commands",
  "## Package Boundaries",
  "## Scenario Matrix",
  "## TDD Write-Red Discipline",
  "## Drift Gates",
  "## Gate Map",
  "## Coverage Policy",
]) {
  requireIncludes(docsPath, docs, heading);
}

for (const phrase of [
  "write-red",
  "it.fails",
  "store-only E2E",
  "Cross-client hooks",
  "Windows smoke",
]) {
  requireIncludes(docsPath, docs, phrase);
}

for (const scriptName of [
  "build",
  "test",
  "test:coverage",
  "test:strategy",
  "test:store-only-e2e",
  "rc6:gate",
  "lint",
  "typecheck",
]) {
  if (typeof rootPackage.scripts?.[scriptName] !== "string") {
    fail(`package.json scripts.${scriptName} is missing`);
  }
}

for (const command of [
  "pnpm -r build",
  "pnpm -r exec tsc --noEmit",
  "pnpm lint",
  "pnpm -r --if-present test:coverage",
  "pnpm test:strategy",
  "pnpm test:store-only-e2e",
  "NO_COLOR=1 pnpm --filter @fenglimg/fabric-cli test",
  "node scripts/perf-benchmark.mjs",
]) {
  requireIncludes(".github/workflows/reusable-validate.yml", reusableValidate, command);
}

for (const command of [
  "pnpm --filter @fenglimg/fabric-shared test",
  "node packages/cli/dist/index.js --help",
  "node packages/cli/dist/index.js --version",
]) {
  requireIncludes(".github/workflows/ci.yml", ci, command);
}

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}

console.log("[test-strategy-gate] PASS");
