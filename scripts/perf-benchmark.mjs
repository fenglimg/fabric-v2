#!/usr/bin/env node
/**
 * v2.0.0-rc.37 NEW-35: perf benchmark — measures cold-start latency of the
 * two paths most likely to bottleneck the user experience:
 *
 *   1. CLI cold start  — `node packages/cli/dist/index.js doctor --json`
 *      against a minimal fixture. Sets the floor for any interactive
 *      `fabric doctor` invocation.
 *   2. Hook cold start — `node packages/cli/templates/hooks/knowledge-hint-broad.cjs`
 *      against a synthetic empty workspace. Sets the floor for SessionStart
 *      reminder latency (the user-perceived "client takes a second to start
 *      typing" effect).
 *
 * Methodology: each path runs N=10 trials, sorted, p50/p95 picked. Cold node
 * startup dominates so warmup is irrelevant (every run is "cold" from CI's POV).
 * Gates:
 *   - CLI cold start p95   <= 2000ms (generous; CI VMs are loaded)
 *   - Hook cold start p95  <=  500ms (interactive budget)
 *
 * Runs against the dist/ artifacts so the published bundle is what's measured,
 * not the source tree. Caller must `pnpm -r build` first.
 *
 * Output: JSON to stdout (machine-parseable) + summary to stderr. Exits 1 if
 * any gate is breached.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const ITERATIONS = 10;
const CLI_BUDGET_MS = 2000;
const HOOK_BUDGET_MS = 500;

function measureOnce(command, args, options = {}) {
  const start = performance.now();
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 10_000,
    ...options,
  });
  const elapsed = performance.now() - start;
  return { elapsed, status: result.status, signal: result.signal, stderr: result.stderr };
}

function percentile(samples, p) {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function setupCliFixture() {
  const root = mkdtempSync(join(tmpdir(), "fabric-perf-cli-"));
  mkdirSync(join(root, ".fabric"), { recursive: true });
  writeFileSync(
    join(root, ".fabric", "agents.meta.json"),
    JSON.stringify({ entries: {}, counters: {}, revision: "sha256:0" }),
  );
  writeFileSync(join(root, ".fabric", "events.jsonl"), "");
  return root;
}

function benchmarkCli(cliPath) {
  const fixture = setupCliFixture();
  const samples = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const { elapsed, status } = measureOnce(process.execPath, [cliPath, "doctor", "--json"], {
      cwd: fixture,
    });
    if (status !== 0 && status !== 1) {
      // doctor exits 1 when there are warnings (not green). Acceptable.
      // Anything else (crash / 137 etc.) is a failure.
      throw new Error(`CLI doctor failed with status ${status}`);
    }
    samples.push(elapsed);
  }
  return {
    iterations: ITERATIONS,
    p50_ms: Math.round(percentile(samples, 50)),
    p95_ms: Math.round(percentile(samples, 95)),
    max_ms: Math.round(Math.max(...samples)),
    samples: samples.map((s) => Math.round(s)),
  };
}

function benchmarkHook(hookPath) {
  const fixture = setupCliFixture();
  const stdinPayload = JSON.stringify({
    hook_event_name: "SessionStart",
    session_id: "perf-bench",
  });
  const samples = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const { elapsed, status, signal, stderr } = measureOnce(process.execPath, [hookPath], {
      cwd: fixture,
      input: stdinPayload,
      env: { ...process.env, FABRIC_HOME: fixture },
    });
    if (status !== 0 || signal !== null) {
      const detail = signal !== null ? `signal ${signal}` : `status ${status}`;
      const stderrSnippet = typeof stderr === "string" && stderr.trim().length > 0 ? `: ${stderr.trim()}` : "";
      throw new Error(`SessionStart hook failed with ${detail}${stderrSnippet}`);
    }
    samples.push(elapsed);
  }
  return {
    iterations: ITERATIONS,
    p50_ms: Math.round(percentile(samples, 50)),
    p95_ms: Math.round(percentile(samples, 95)),
    max_ms: Math.round(Math.max(...samples)),
    samples: samples.map((s) => Math.round(s)),
  };
}

const cliPath = join(process.cwd(), "packages/cli/dist/index.js");
const hookPath = join(process.cwd(), "packages/cli/templates/hooks/knowledge-hint-broad.cjs");

const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  node_version: process.version,
  cli_cold_start: benchmarkCli(cliPath),
  hook_cold_start: benchmarkHook(hookPath),
  gates: {
    cli_budget_ms: CLI_BUDGET_MS,
    hook_budget_ms: HOOK_BUDGET_MS,
  },
};

const cliPass = report.cli_cold_start.p95_ms <= CLI_BUDGET_MS;
const hookPass = report.hook_cold_start.p95_ms <= HOOK_BUDGET_MS;
report.verdict = {
  cli_cold_start: cliPass ? "pass" : "fail",
  hook_cold_start: hookPass ? "pass" : "fail",
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

process.stderr.write(
  [
    "[perf-benchmark]",
    `  CLI cold start: p50=${report.cli_cold_start.p50_ms}ms p95=${report.cli_cold_start.p95_ms}ms (gate ${CLI_BUDGET_MS}ms ${cliPass ? "✓" : "✗"})`,
    `  Hook cold start: p50=${report.hook_cold_start.p50_ms}ms p95=${report.hook_cold_start.p95_ms}ms (gate ${HOOK_BUDGET_MS}ms ${hookPass ? "✓" : "✗"})`,
    "",
  ].join("\n"),
);

if (!cliPass || !hookPass) {
  process.exit(1);
}
