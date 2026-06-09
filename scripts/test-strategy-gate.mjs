#!/usr/bin/env node
// Drift gate for docs/TESTING.md.
//
// This does not judge coverage quality. It keeps the testing strategy entry
// anchored to the repository's real methodology artifacts, documented root
// scripts, and CI gates.

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

const methodologyArtifacts = [
  ".workflow/.maestro/20260602-test-methodology-optimize/scratchpad/test-methodology-v6.md",
  ".workflow/.scratchpad/e2e-methodology-FINAL.md",
  ".workflow/.maestro/20260602-test-methodology-optimize/scratchpad/mainstream-research.md",
  ".workflow/.maestro/20260602-test-methodology-optimize/scratchpad/samespace-research.md",
  ".workflow/.maestro/20260602-test-methodology-optimize/scratchpad/trackd-research.md",
  ".workflow/.maestro/20260602-test-methodology-optimize/scratchpad/backtest-answer-set.md",
  ".workflow/.maestro/20260602-test-methodology-optimize/scratchpad/discovery-rubric.md",
];

for (const artifact of methodologyArtifacts) {
  readText(artifact);
}

for (const heading of [
  "## Commands",
  "## Authority",
  "## Package Boundaries",
  "## Strategy Model",
  "## Scenario Matrix",
  "## TDD Write-Red Discipline",
  "## Fabric E2E/Dogfood",
  "## Drift Gates",
  "## Gate Map",
  "## Coverage Policy",
]) {
  requireIncludes(docsPath, docs, heading);
}

for (const phrase of [
  "test-methodology-v6.md",
  "e2e-methodology-FINAL.md",
  "mainstream-research.md",
  "samespace-research.md",
  "trackd-research.md",
  "backtest-answer-set.md",
  "discovery-rubric.md",
  "四赛道",
  "认识论轴",
  "Phase 0 历史先验 census",
  "Examination",
  "Reality",
  "Intent-interrogation",
  "producer→consumer",
  "J-META",
  "J-EXP-META",
  "T1-ledger",
  "T3-LLM-judge",
  "OWASP LLM Top 10",
  "write-red",
  "it.fails",
  "Methodology backtest",
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
