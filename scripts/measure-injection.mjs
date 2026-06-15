#!/usr/bin/env node
/**
 * v2.2 G-PERF payload scorecard — measures the two corpus-dependent injection
 * payloads the cold-start latency benchmark (perf-benchmark.mjs) cannot:
 *
 *   1. SessionStart hook injection — the bytes the broad hook renders into the
 *      client channel per session boot (the per-boot context tax).
 *   2. MCP recall response — the bytes a single fab_recall round-trip returns
 *      (the per-edit context tax; the product already warns at 16384B).
 *
 * Unlike perf-benchmark's hermetic synthetic fixture (which surfaces 0 entries
 * because a freshly-minted store has no built index), this measures against the
 * CURRENT repo's REAL .fabric corpus — the representative "what a heavy dogfood
 * user actually sees". The number is corpus-dependent (it tracks a trend across
 * releases, per the brief's optimization-as-metric goal). Two thresholds mirror
 * the product's balanced retrieval-budget profile (retrieval-budget.ts):
 *   - WARN 16384B  — soft; reported, does NOT fail the gate. Expected to be
 *     crossed by a large dogfood corpus (description-first keeps bodies lean but
 *     many candidate descriptions still add up).
 *   - HARD 65536B  — the product's hard payload ceiling; exceeding it fails.
 *
 * Caller must `pnpm -r build` first. Exits 1 only if a payload exceeds HARD.
 * Prints JSON to stdout + summary to stderr.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const WARN_BYTES = 16384;
const HARD_BYTES = 65536;
const REPO_ROOT = process.cwd();
const HOOK_PATH = join(REPO_ROOT, "packages/cli/templates/hooks/knowledge-hint-broad.cjs");
const SERVER_PATH = join(REPO_ROOT, "packages/server/dist/index.js");

function bytes(s) {
  return Buffer.byteLength(typeof s === "string" ? s : JSON.stringify(s ?? ""), "utf8");
}

function measureHookInjection() {
  if (!existsSync(HOOK_PATH)) return { error: `missing hook: ${HOOK_PATH}` };
  const res = spawnSync(process.execPath, [HOOK_PATH], {
    cwd: REPO_ROOT,
    input: JSON.stringify({ hook_event_name: "SessionStart", session_id: "measure-injection" }),
    encoding: "utf8",
    timeout: 10_000,
    // CLAUDE_PROJECT_DIR + FABRIC_HINT_CLIENT force detectClient()=cc so the
    // hook actually renders its injection sink against the real repo corpus.
    env: { ...process.env, CLAUDE_PROJECT_DIR: REPO_ROOT, FABRIC_HINT_CLIENT: "cc" },
  });
  const ai = bytes(res.stdout);
  const human = bytes(res.stderr);
  return { ai_sink_bytes: ai, human_banner_bytes: human, total_bytes: ai + human };
}

async function measureRecall() {
  if (!existsSync(SERVER_PATH)) return { error: `missing server dist: ${SERVER_PATH}` };
  try {
    const server = await import(pathToFileURL(SERVER_PATH).href);
    if (typeof server.recall !== "function") return { error: "server.recall not exported" };
    const result = await server.recall(REPO_ROOT, {
      paths: ["packages/shared/src/types/config.ts", "packages/cli/src/commands/install.ts"],
      intent: "G-PERF recall payload measurement against the real repo corpus",
      session_id: "measure-injection",
      correlation_id: "measure-injection",
    });
    return {
      response_bytes: bytes(result),
      candidate_count: Array.isArray(result?.candidates) ? result.candidates.length : null,
      bodies_returned: result?.body_tier?.bodies_returned ?? null,
      product_warn_emitted: Array.isArray(result?.warnings)
        ? result.warnings.some((w) => w?.code === "mcp_payload_warn")
        : false,
    };
  } catch (err) {
    return { error: String(err?.message ?? err) };
  }
}

function classify(n) {
  if (typeof n !== "number") return "error";
  if (n > HARD_BYTES) return "over-hard";
  if (n > WARN_BYTES) return "over-warn";
  return "pass";
}

const hook = measureHookInjection();
const recall = await measureRecall();
const report = {
  schema_version: 1,
  warn_bytes: WARN_BYTES,
  hard_bytes: HARD_BYTES,
  hook_injection: hook,
  recall,
};

const hookVerdict = hook.error ? "error" : classify(hook.total_bytes);
const recallVerdict = recall.error ? "error" : classify(recall.response_bytes);
report.verdict = { hook_injection: hookVerdict, recall: recallVerdict };

function mark(v) {
  return v === "pass" ? "✓" : v === "over-warn" ? "⚠ over-warn (within hard)" : v === "over-hard" ? "✗ OVER HARD" : v;
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.stderr.write(
  [
    `[measure-injection] (real repo corpus, warn ${WARN_BYTES}B / hard ${HARD_BYTES}B)`,
    `  Hook injection: ${hook.error ?? `${hook.total_bytes}B (ai=${hook.ai_sink_bytes} human=${hook.human_banner_bytes}) ${mark(hookVerdict)}`}`,
    `  MCP recall:     ${recall.error ?? `${recall.response_bytes}B (candidates=${recall.candidate_count} bodies=${recall.bodies_returned}) ${mark(recallVerdict)}`}`,
    "",
  ].join("\n"),
);

// Only a HARD breach fails the gate; over-warn is reported but expected for a
// large corpus (description-first already keeps bodies lean).
if (hookVerdict === "over-hard" || recallVerdict === "over-hard") process.exit(1);
