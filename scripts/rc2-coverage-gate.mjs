#!/usr/bin/env node
// rc2-coverage-gate.mjs
//
// Per-file coverage gate for Fabric v2.0 rc.2 NEW source files.
// Reads packages/{server,cli}/coverage/coverage-summary.json (json-summary
// reporter output) and asserts each ALLOWLIST file meets the per-file
// threshold (lines/statements >= 90, functions >= 90, branches >= 80).
//
// Why external (not vitest.config thresholds): existing files in the
// repo carry a 70-75% global floor; bumping vitest thresholds globally
// would fail on unrelated files. This script enforces the elevated bar
// only on rc.2-new code, by explicit allowlist.
//
// Allowlist drift is by design: each rc cycle updates the lists below.
// DIFF_SCOPE files are reported but NOT gated — they pre-existed this rc
// and were only touched in scope (e.g. deepMerge extension in json.ts).
//
// Usage: node scripts/rc2-coverage-gate.mjs
// Exits 0 on PASS, 1 on FAIL.

import { readFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(__filename, "..", "..");

const ALLOWLIST = [
  "packages/server/src/services/extract-knowledge.ts",
  "packages/server/src/tools/extract-knowledge.ts",
  "packages/cli/src/install/skills-and-hooks.ts",
];

// Files that were extended in rc.2 (not net-new) — report-only, no gate.
const DIFF_SCOPE = [
  "packages/cli/src/config/json.ts",
];

// Coverage summaries to consume.
const COVERAGE_SUMMARIES = [
  "packages/server/coverage/coverage-summary.json",
  "packages/cli/coverage/coverage-summary.json",
];

// Per-file thresholds. Branches relaxed (industry-norm) — error paths
// often skip the unhappy branch when input validation is upstream.
const THRESHOLDS = {
  lines: 90,
  statements: 90,
  functions: 90,
  branches: 80,
};

function loadAllSummaries() {
  /** @type {Record<string, {lines: {pct: number}, statements: {pct: number}, functions: {pct: number}, branches: {pct: number}}>} */
  const merged = {};
  for (const rel of COVERAGE_SUMMARIES) {
    const abs = resolve(REPO_ROOT, rel);
    if (!existsSync(abs)) {
      throw new Error(
        `Coverage summary missing: ${rel}\n` +
        `Run \`pnpm --filter <pkg> test:coverage\` first to generate it.`,
      );
    }
    const json = JSON.parse(readFileSync(abs, "utf8"));
    for (const [absPath, metrics] of Object.entries(json)) {
      if (absPath === "total") continue;
      const relPath = relative(REPO_ROOT, absPath);
      merged[relPath] = metrics;
    }
  }
  return merged;
}

function fmtRow(file, metrics, status) {
  const { lines, statements, functions, branches } = metrics;
  return [
    status.padEnd(6),
    file.padEnd(56),
    String(lines.pct).padStart(7),
    String(statements.pct).padStart(7),
    String(functions.pct).padStart(7),
    String(branches.pct).padStart(7),
  ].join(" | ");
}

function header() {
  return [
    "STATUS".padEnd(6),
    "FILE".padEnd(56),
    "LINES".padStart(7),
    "STMT".padStart(7),
    "FUNC".padStart(7),
    "BRANCH".padStart(7),
  ].join(" | ");
}

function checkFile(file, metrics) {
  /** @type {string[]} */
  const reasons = [];
  if (metrics.lines.pct < THRESHOLDS.lines) {
    reasons.push(`lines ${metrics.lines.pct} < ${THRESHOLDS.lines}`);
  }
  if (metrics.statements.pct < THRESHOLDS.statements) {
    reasons.push(`statements ${metrics.statements.pct} < ${THRESHOLDS.statements}`);
  }
  if (metrics.functions.pct < THRESHOLDS.functions) {
    reasons.push(`functions ${metrics.functions.pct} < ${THRESHOLDS.functions}`);
  }
  if (metrics.branches.pct < THRESHOLDS.branches) {
    reasons.push(`branches ${metrics.branches.pct} < ${THRESHOLDS.branches}`);
  }
  return reasons;
}

function main() {
  const all = loadAllSummaries();

  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const missing = [];
  const rows = [];

  console.log("rc.2 per-file coverage gate");
  console.log(`thresholds: lines>=${THRESHOLDS.lines} statements>=${THRESHOLDS.statements} functions>=${THRESHOLDS.functions} branches>=${THRESHOLDS.branches}`);
  console.log("");
  console.log(header());
  console.log("-".repeat(110));

  // Gate ALLOWLIST.
  for (const file of ALLOWLIST) {
    const metrics = all[file];
    if (!metrics) {
      missing.push(file);
      console.log(["MISS  ", file.padEnd(56), "n/a".padStart(7), "n/a".padStart(7), "n/a".padStart(7), "n/a".padStart(7)].join(" | "));
      continue;
    }
    const reasons = checkFile(file, metrics);
    const status = reasons.length === 0 ? "PASS" : "FAIL";
    rows.push({ file, metrics, status, reasons });
    console.log(fmtRow(file, metrics, status));
    if (reasons.length > 0) {
      failures.push(`${file}: ${reasons.join(", ")}`);
    }
  }

  // Report-only DIFF_SCOPE.
  if (DIFF_SCOPE.length > 0) {
    console.log("-".repeat(110));
    console.log("(report-only — pre-existing files extended in rc.2; not gated)");
    for (const file of DIFF_SCOPE) {
      const metrics = all[file];
      if (!metrics) {
        console.log(["INFO  ", file.padEnd(56), "n/a".padStart(7), "n/a".padStart(7), "n/a".padStart(7), "n/a".padStart(7)].join(" | "));
        continue;
      }
      console.log(fmtRow(file, metrics, "INFO"));
    }
  }

  // Note: archive-hint.cjs is intentionally not gated by this script —
  // .cjs is excluded from vitest's coverage include glob (src/**/*.ts).
  // It is exercised by __tests__/archive-hint.test.ts; rc.3 may switch
  // to a hand-rolled hook coverage strategy if drift becomes an issue.
  console.log("-".repeat(110));
  console.log("(note) packages/cli/templates/hooks/archive-hint.cjs is covered by");
  console.log("       __tests__/archive-hint.test.ts but not in coverage-summary.json");
  console.log("       (vitest include is src/**/*.ts only).");
  console.log("");

  if (missing.length > 0) {
    console.error("FAIL — files in ALLOWLIST not present in coverage report:");
    for (const f of missing) console.error(`  ${f}`);
    process.exit(1);
  }
  if (failures.length > 0) {
    console.error("FAIL — files below threshold:");
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`PASS — all ${ALLOWLIST.length} rc.2 ALLOWLIST files meet per-file thresholds.`);
}

main();
