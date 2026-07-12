#!/usr/bin/env node
// Drift gate for docs/TESTING.md (slim).
//
// Keeps the testing strategy entry anchored to real package scripts and CI
// gates. Does NOT re-litigate methodology keyword coverage — deep docs live
// under .workflow/ and are linked from TESTING.md Appendix.

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
const release = readText(".github/workflows/release.yml");

// Deep methodology must still exist on disk (linked from Appendix), but the
// gate no longer forces TESTING.md to restate every keyword.
const methodologyArtifacts = [
  "docs/methodology/test-methodology-v6.md",
  "docs/methodology/e2e-methodology-FINAL.md",
  "docs/methodology/mainstream-research.md",
  "docs/methodology/samespace-research.md",
  "docs/methodology/trackd-research.md",
  "docs/methodology/backtest-answer-set.md",
  "docs/methodology/discovery-rubric.md",
];

for (const artifact of methodologyArtifacts) {
  readText(artifact);
}

for (const heading of [
  "## Commands",
  "## Gate Map",
  "## Package Boundaries",
  "## Optional (not PR hard)",
  "## Do not",
  "## Appendix",
]) {
  requireIncludes(docsPath, docs, heading);
}

for (const phrase of [
  "test:strategy",
  "test:store-only-e2e",
  "test:upgrade-e2e",
  "reusable-validate",
  "store-only",
  "upgrade-e2e",
  "test-methodology-v6.md",
  "e2e-methodology-FINAL.md",
  "Windows smoke",
  "PR hard",
  "Release hard",
]) {
  requireIncludes(docsPath, docs, phrase);
}

for (const scriptName of [
  "build",
  "test",
  "test:coverage",
  "test:strategy",
  "test:store-only-e2e",
  "test:upgrade-e2e",
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
  "pnpm test:upgrade-e2e",
  "node scripts/perf-benchmark.mjs",
]) {
  requireIncludes(".github/workflows/reusable-validate.yml", reusableValidate, command);
}

// NO_COLOR gate: must still run under NO_COLOR for CLI snapshot/reskin tests.
// Prefer scoped vitest (reskin/i18n only) — full CLI re-run after coverage is redundant.
if (!reusableValidate.includes("NO_COLOR=1 pnpm --filter @fenglimg/fabric-cli")) {
  fail(
    '.github/workflows/reusable-validate.yml missing a NO_COLOR=1 fabric-cli step ' +
      '(scoped vitest or full package test)',
  );
}
if (
  !reusableValidate.includes("install-renderer-reskin") &&
  !reusableValidate.includes("pnpm --filter @fenglimg/fabric-cli test")
) {
  fail(
    ".github/workflows/reusable-validate.yml NO_COLOR step must cover reskin/i18n snapshots " +
      "(install-renderer-reskin and/or full fabric-cli test)",
  );
}

for (const command of [
  "pnpm --filter @fenglimg/fabric-shared test",
  "node packages/cli/dist/index.js --help",
  "node packages/cli/dist/index.js --version",
]) {
  requireIncludes(".github/workflows/ci.yml", ci, command);
}

// Release must stay on the same validate path as PR (parity check).
requireIncludes(".github/workflows/release.yml", release, "reusable-validate.yml");

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}

console.log("[test-strategy-gate] PASS");
