#!/usr/bin/env node
/**
 * v2.0.0-rc.37 NEW-35: perf benchmark — measures cold-start latency of the
 * two paths most likely to bottleneck the user experience:
 *
 *   1. CLI cold start  — `node packages/cli/dist/index.js doctor --json`
 *      against a mounted-store fixture. Sets the floor for any interactive
 *      `fabric doctor` invocation.
 *   2. Hook cold start — `node packages/cli/templates/hooks/knowledge-hint-broad.cjs`
 *      against the same mounted-store fixture. Sets the floor for SessionStart
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
// v2.2 G-PERF: SessionStart hook injection payload budget. The hook writes the
// AI sink to stdout (hookSpecificOutput.additionalContext) and the human banner
// to stderr; the AI sink is the per-session-boot context tax we gate on. Mirror
// the MCP payload warn threshold (16384B) — a single injection should cost no
// more than a single MCP recall response. Measured against the fixed 13-entry
// fixture so it tracks render-size regressions, not corpus growth.
const HOOK_PAYLOAD_BUDGET_BYTES = 16384;
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PERSONAL_STORE_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_STORE_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KNOWLEDGE_TYPES = ["models", "decisions", "guidelines", "pitfalls", "processes"];

function measureOnce(command, args, options = {}) {
  const start = performance.now();
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 10_000,
    ...options,
  });
  const elapsed = performance.now() - start;
  return {
    elapsed,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function percentile(samples, p) {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function writeJson(path, value) {
  writeFileSync(
    path,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

function setupStoreDir(globalRoot, store) {
  const storeRoot = join(globalRoot, "stores", store.mount_name);
  for (const type of KNOWLEDGE_TYPES) {
    mkdirSync(join(storeRoot, "knowledge", type), { recursive: true });
  }
  mkdirSync(join(storeRoot, "knowledge", "pending"), { recursive: true });
  mkdirSync(join(storeRoot, "bindings"), { recursive: true });
  mkdirSync(join(storeRoot, "state"), { recursive: true });
  writeJson(join(storeRoot, "store.json"), {
    store_uuid: store.store_uuid,
    created_at: "2026-06-09T00:00:00.000Z",
    canonical_alias: store.alias,
  });
  writeFileSync(join(storeRoot, ".gitignore"), "state/\nagents.meta.json\n.cache/\n", "utf8");
  return storeRoot;
}

function writeKnowledgeEntry(storeRoot, type, id, scope, visibilityStore, summary) {
  const slug = summary.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  writeFileSync(
    join(storeRoot, "knowledge", type, `${id}--${slug}.md`),
    [
      "---",
      `id: ${id}`,
      `type: ${type}`,
      "layer: team",
      "maturity: verified",
      "created_at: 2026-06-09T00:00:00.000Z",
      `semantic_scope: ${scope}`,
      "relevance_scope: broad",
      `visibility_store: "${visibilityStore}"`,
      `summary: ${summary}`,
      "intent_clues: [store-only, perf]",
      "tech_stack: [TypeScript]",
      "---",
      `# ${summary}`,
      "",
      "Store-only benchmark fixture entry.",
      "",
    ].join("\n"),
    "utf8",
  );
}

function setupCliFixture() {
  const root = mkdtempSync(join(tmpdir(), "fabric-perf-"));
  const home = join(root, "home");
  const projectRoot = join(root, "project");
  const globalRoot = join(home, ".fabric");
  mkdirSync(join(projectRoot, ".fabric"), { recursive: true });
  mkdirSync(join(globalRoot, "state", "bindings"), { recursive: true });

  const personal = {
    store_uuid: PERSONAL_STORE_UUID,
    alias: "personal",
    mount_name: "personal",
    personal: true,
    writable: true,
  };
  const team = {
    store_uuid: TEAM_STORE_UUID,
    alias: "team",
    mount_name: "team",
    remote: "git@example.com:team-store.git",
    writable: true,
  };

  const personalRoot = setupStoreDir(globalRoot, personal);
  const teamRoot = setupStoreDir(globalRoot, team);

  for (let i = 1; i <= 10; i++) {
    writeKnowledgeEntry(
      teamRoot,
      "decisions",
      `KT-DEC-${String(i).padStart(4, "0")}`,
      "project:fabric-v2",
      "team",
      `Store-only team decision ${i}`,
    );
  }
  for (let i = 1; i <= 3; i++) {
    writeKnowledgeEntry(
      personalRoot,
      "guidelines",
      `KP-GLD-${String(i).padStart(4, "0")}`,
      "personal",
      "personal",
      `Store-only personal guideline ${i}`,
    );
  }

  writeJson(join(globalRoot, "fabric-global.json"), {
    uid: "perf-bench",
    stores: [personal, team],
  });
  writeJson(join(projectRoot, ".fabric", "fabric-config.json"), {
    project_id: PROJECT_ID,
    active_project: "fabric-v2",
    required_stores: [{ id: "team" }],
    active_write_store: "team",
    default_write_store: "team",
    write_routes: [{ scope: "project:fabric-v2", store: "team" }],
  });
  // Keep the legacy event file present for doctor compatibility, but do not
  // create a project-local knowledge tree; the fixture must stay store-only.
  writeFileSync(join(projectRoot, ".fabric", "events.jsonl"), "", "utf8");

  writeJson(join(globalRoot, "state", "bindings", `${PROJECT_ID}_resolved.json`), {
    version: 1,
    project_id: PROJECT_ID,
    workspace_binding_id: PROJECT_ID,
    generated_at: "2026-06-09T00:00:00.000Z",
    read_set: {
      stores: [
        {
          store_uuid: TEAM_STORE_UUID,
          alias: "team",
          remote: "git@example.com:team-store.git",
          writable: true,
        },
        { store_uuid: PERSONAL_STORE_UUID, alias: "personal", writable: true },
      ],
      warnings: [],
    },
    write_target: { store_uuid: TEAM_STORE_UUID, alias: "team" },
    knowledge_stats: {
      pending_count: 0,
      canonical_count: 13,
      oldest_pending_mtime_ms: null,
    },
  });

  return { projectRoot, fabricHome: home };
}

function benchmarkCli(cliPath) {
  const fixture = setupCliFixture();
  const samples = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const { elapsed, status } = measureOnce(process.execPath, [cliPath, "doctor", "--json"], {
      cwd: fixture.projectRoot,
      env: { ...process.env, FABRIC_HOME: fixture.fabricHome },
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
  let lastStdout = "";
  let lastStderr = "";
  for (let i = 0; i < ITERATIONS; i++) {
    const { elapsed, status, signal, stdout, stderr } = measureOnce(process.execPath, [hookPath], {
      cwd: fixture.projectRoot,
      input: stdinPayload,
      // FABRIC_HINT_CLIENT forces detectClient()=cc so the hook actually renders
      // its injection sink — without a client env it skips emit and the payload
      // measurement is a false-green 0B (honesty: measure the real injection).
      env: { ...process.env, FABRIC_HOME: fixture.fabricHome, FABRIC_HINT_CLIENT: "cc" },
    });
    if (status !== 0 || signal !== null) {
      const detail = signal !== null ? `signal ${signal}` : `status ${status}`;
      const stderrSnippet = typeof stderr === "string" && stderr.trim().length > 0 ? `: ${stderr.trim()}` : "";
      throw new Error(`SessionStart hook failed with ${detail}${stderrSnippet}`);
    }
    lastStdout = typeof stdout === "string" ? stdout : "";
    lastStderr = typeof stderr === "string" ? stderr : "";
    samples.push(elapsed);
  }
  return {
    iterations: ITERATIONS,
    p50_ms: Math.round(percentile(samples, 50)),
    p95_ms: Math.round(percentile(samples, 95)),
    max_ms: Math.round(Math.max(...samples)),
    samples: samples.map((s) => Math.round(s)),
    // v2.2 G-PERF: deterministic injection payload size for the fixed fixture.
    // stdout = AI additionalContext sink (the context tax); stderr = human banner.
    injection_payload: {
      ai_sink_bytes: Buffer.byteLength(lastStdout, "utf8"),
      human_banner_bytes: Buffer.byteLength(lastStderr, "utf8"),
      total_bytes: Buffer.byteLength(lastStdout, "utf8") + Buffer.byteLength(lastStderr, "utf8"),
      budget_bytes: HOOK_PAYLOAD_BUDGET_BYTES,
    },
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
const payload = report.hook_cold_start.injection_payload;
// The hermetic synthetic fixture cannot exercise injection RENDERING:
// `plan-context-hint --all` surfaces 0 entries for a freshly-minted synthetic
// store (no index built), so the hook emits an empty sink → total_bytes=0. A
// 0-byte "pass" would be a false-green, so treat 0 as measurement-invalid (n/a)
// rather than pass. The real injection size is measured against a representative
// corpus in the G-PERF scorecard.
const payloadMeasured = payload.total_bytes > 0;
const payloadPass = payloadMeasured && payload.total_bytes <= HOOK_PAYLOAD_BUDGET_BYTES;
report.verdict = {
  cli_cold_start: cliPass ? "pass" : "fail",
  hook_cold_start: hookPass ? "pass" : "fail",
  hook_injection_payload: !payloadMeasured ? "n/a-synthetic-fixture" : payloadPass ? "pass" : "fail",
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

process.stderr.write(
  [
    "[perf-benchmark]",
    `  CLI cold start: p50=${report.cli_cold_start.p50_ms}ms p95=${report.cli_cold_start.p95_ms}ms (gate ${CLI_BUDGET_MS}ms ${cliPass ? "✓" : "✗"})`,
    `  Hook cold start: p50=${report.hook_cold_start.p50_ms}ms p95=${report.hook_cold_start.p95_ms}ms (gate ${HOOK_BUDGET_MS}ms ${hookPass ? "✓" : "✗"})`,
    `  Hook injection payload: ai=${payload.ai_sink_bytes}B human=${payload.human_banner_bytes}B total=${payload.total_bytes}B (gate ${HOOK_PAYLOAD_BUDGET_BYTES}B ${!payloadMeasured ? "n/a synthetic fixture — see G-PERF scorecard" : payloadPass ? "✓" : "✗"})`,
    "",
  ].join("\n"),
);

// n/a (synthetic fixture surfaced 0 entries) does not fail the gate — only a
// measured over-budget injection does.
const payloadFail = payloadMeasured && !payloadPass;
if (!cliPass || !hookPass || payloadFail) {
  process.exit(1);
}
