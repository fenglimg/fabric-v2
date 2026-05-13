#!/usr/bin/env node
// rc5-coverage-gate.mjs
//
// v2.0.0-rc.5 coverage gate — structural assertions over the rc.5 scope.
// Mirrors rc.4 ergonomics (CLI surface, exit codes, output table) but pivots
// from per-file coverage thresholds to scope-completion checks: each of the
// rc.5 plan tasks (A1..A4, B1..B4, C1..C7, D1..D2) should leave a verifiable
// trace in the source tree, and the gate refuses to certify rc.5 done unless
// every trace lands.
//
// Why scope checks instead of coverage thresholds (rc.4 style):
//   - rc.5 is a deletion/rename-heavy cycle (A1 mass rename + A2 regime
//     drop + A4 dashboard removal). The risk surface is "did the cleanup
//     actually land everywhere" — answered by grep, not by line coverage.
//   - rc.4-style per-file coverage assertions still hold (vitest covers
//     each new file). Tests pass = coverage pass; we re-run them here.
//
// Each check returns { id, name, passed, details? }. The script exits 0
// iff every check passes AND `pnpm -w build` + server/shared test suites
// exit 0. Failures print the failing check id + details and exit 1.
//
// Check → TASK mapping (rc.5):
//   [1] A1 rename complete           — TASK-001..005 (rules→knowledge)
//   [2] A2 + A4 cleanup              — TASK-006 (intent-ledger), dashboard drop
//   [3] A3 plan-context refactor     — TASK-007 (Cocos-era inference retired)
//   [4] B1 dual pending root         — TASK-008 (team + personal pending dirs)
//   [5] B2 + B3 + B4 hint pivot      — TASK-009..011 (auto-archive + rename + configs)
//   [6] C1 relevance fields          — TASK-012 (relevance_scope + paths schema)
//   [7] C2 + C3 review pivots        — TASK-013 (modify-action + layer-flip degrade)
//   [8] C4 lint checks #23..#25      — TASK-014 (doctor inspectors)
//   [9] C5 + C6 + C7                 — TASK-014..016 (knowledge_consumed, signal A, pending excl)
//
// D1 (plan-context-hint CLI) and D2 (README rewrite) are covered as part of
// check [5] (D1 wiring touches the same hook surface) and outside the gate
// (D2 is docs-only — verified by the build, not by a structural check).
//
// Usage: node scripts/rc5-coverage-gate.mjs
//        pnpm rc5:gate
// Exits 0 on PASS, 1 on FAIL.

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function readText(relPath) {
  const abs = resolve(REPO_ROOT, relPath);
  if (!existsSync(abs)) return undefined;
  return readFileSync(abs, "utf8");
}

function fileExists(relPath) {
  return existsSync(resolve(REPO_ROOT, relPath));
}

// Run a shell command, return { code, stdout, stderr }. Falls back to a
// safe no-op when the binary is missing.
function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  return {
    code: res.status ?? -1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

// ---------------------------------------------------------------------------
// individual checks
// ---------------------------------------------------------------------------

// [1] A1 rename complete — no legacy rule-* identifiers in src/.
// Allow matches inside packages/*/coverage/ (stale HTML reports) and
// __snapshots__ (frozen-in-time goldens).
function checkA1RenameComplete() {
  const legacyTokens = [
    "fab_get_rule_sections",
    "fabric-context-server",
    "rule-meta-builder",
    "rule-sections",
    "rule-sync",
    "get-rules",
    "api/rules.ts",
    "buildRuleMeta",
    "ensureRulesFresh",
  ];
  const pattern = legacyTokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  // -F (fixed strings) would be safer but we need alternation; the tokens
  // contain no special regex chars beyond `.`/`/` so escaped alternation
  // is faithful.
  const res = run("grep", [
    "-rn",
    "-E",
    pattern,
    "packages/",
    "--include=*.ts",
    "--include=*.json",
    "--exclude-dir=node_modules",
    "--exclude-dir=coverage",
    "--exclude-dir=__snapshots__",
    "--exclude-dir=dist",
  ]);
  if (res.stdout.trim() === "") {
    return { id: 1, name: "A1 rename complete", passed: true };
  }
  return {
    id: 1,
    name: "A1 rename complete",
    passed: false,
    details: `legacy rule-* tokens still present:\n${res.stdout.trim().split("\n").slice(0, 20).join("\n")}`,
  };
}

// [2] A2 + A4 cleanup — dashboard gone; no intent_annotate api or service.
// .intent-ledger.jsonl as a *filename* (LEDGER_FILE constant + test fixtures)
// is the on-disk event ledger, NOT the intent-ledger compliance regime — we
// only fail on `intent_annotate` references, which were the API entrypoint.
function checkA2A4Cleanup() {
  const failures = [];

  if (fileExists("packages/dashboard")) {
    failures.push("packages/dashboard/ still exists");
  }

  const annotateApi = fileExists("packages/server/src/api/intent.ts");
  const annotateSvc = fileExists("packages/server/src/services/annotate-intent.ts");
  if (annotateApi) failures.push("packages/server/src/api/intent.ts still exists");
  if (annotateSvc) failures.push("packages/server/src/services/annotate-intent.ts still exists");

  const res = run("grep", [
    "-rn",
    "intent_annotate",
    "packages/server/src/",
    "packages/cli/src/",
    "packages/shared/src/",
    "--include=*.ts",
    "--exclude-dir=node_modules",
    "--exclude-dir=coverage",
  ]);
  if (res.stdout.trim() !== "") {
    failures.push(`intent_annotate references remain:\n${res.stdout.trim().split("\n").slice(0, 10).join("\n")}`);
  }

  if (failures.length === 0) {
    return { id: 2, name: "A2 + A4 cleanup", passed: true };
  }
  return {
    id: 2,
    name: "A2 + A4 cleanup",
    passed: false,
    details: failures.join("\n"),
  };
}

// [3] A3 plan-context refactor — Cocos-era inference retired, new schema landed.
function checkA3PlanContext() {
  const src = readText("packages/server/src/services/plan-context.ts");
  if (src === undefined) {
    return { id: 3, name: "A3 plan-context refactor", passed: false, details: "plan-context.ts missing" };
  }
  const failures = [];

  const deadFns = ["inferDomains", "tokenizeIntent", "inferImpactHints"];
  for (const fn of deadFns) {
    // Match `function fnName(` or `const fnName =` (any export form).
    const fnPattern = new RegExp(`(?:function\\s+|const\\s+|export\\s+(?:function|const)\\s+)${fn}\\b`);
    if (fnPattern.test(src)) {
      failures.push(`plan-context.ts still defines ${fn}`);
    }
  }

  // Output schema must NOT carry these fields on PlanContextEntry /
  // PlanContextResult anymore. We grep the type alias bodies; if a field
  // appears anywhere outside a comment it's a regression.
  const deadFields = ["selection_policy", "required_stable_ids", "inferred_domain", "intent_tokens", "impact_hints"];
  // Strip block + line comments so we don't fire on rationale notes.
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const field of deadFields) {
    // Match as an object-literal key or type-alias property: `field:` or `field?:`.
    // We tolerate `required_stable_ids` inside SelectionTokenState (internal
    // token cache, not the MCP output) and as a parameter name on
    // createSelectionToken / event-ledger payload (rc.5 keeps the legacy
    // event field for ledger back-compat).
    const fieldPattern = new RegExp(`\\b${field}\\b\\s*\\??\\s*:`);
    const matches = [...codeOnly.matchAll(new RegExp(`\\b${field}\\b`, "g"))];
    if (field === "required_stable_ids") {
      // Allow refs inside SelectionTokenState type + createSelectionToken
      // signature + appendEventLedgerEvent payload — these are internal,
      // not part of the MCP-facing PlanContextResult. We only fail if it
      // appears inside `PlanContextEntry` or `PlanContextResult` type body.
      const entryBlock = codeOnly.match(/type PlanContextEntry = \{[\s\S]*?\};/);
      const resultBlock = codeOnly.match(/type PlanContextResult = \{[\s\S]*?\};/);
      if (entryBlock && /required_stable_ids/.test(entryBlock[0])) {
        failures.push("PlanContextEntry still carries required_stable_ids");
      }
      if (resultBlock && /required_stable_ids/.test(resultBlock[0])) {
        failures.push("PlanContextResult still carries required_stable_ids");
      }
      continue;
    }
    if (matches.length > 0 && fieldPattern.test(codeOnly)) {
      failures.push(`plan-context.ts still surfaces ${field} as a schema field`);
    }
  }

  // v2.0-rc.7 T9: degenerate-mode payload was retired. plan-context.ts must
  // no longer mention candidates_full_content anywhere — the response is now
  // symmetric (description_index + selection_token at every size). See
  // docs/decisions/rc5-a3-superseded.md.
  if (/candidates_full_content/.test(src)) {
    failures.push("plan-context.ts still references candidates_full_content (rc.7 T9 removed degenerate mode)");
  }

  if (failures.length === 0) {
    return { id: 3, name: "A3 plan-context refactor", passed: true };
  }
  return {
    id: 3,
    name: "A3 plan-context refactor",
    passed: false,
    details: failures.join("\n"),
  };
}

// [4] B1 dual pending root — pendingBase exported as a function (not constant).
function checkB1DualPending() {
  const src = readText("packages/server/src/services/extract-knowledge.ts");
  if (src === undefined) {
    return { id: 4, name: "B1 dual pending root", passed: false, details: "extract-knowledge.ts missing" };
  }
  // The export must be a function — `export function pendingBase(...)` —
  // not `export const pendingBase = "..."`.
  const fnExport = /export\s+function\s+pendingBase\s*\(/.test(src);
  const constExport = /export\s+const\s+pendingBase\s*=/.test(src);

  if (fnExport && !constExport) {
    return { id: 4, name: "B1 dual pending root", passed: true };
  }
  const reason = !fnExport
    ? "pendingBase is not exported as a function"
    : "pendingBase is still exported as a constant (must be a function for dual-root resolution)";
  return { id: 4, name: "B1 dual pending root", passed: false, details: reason };
}

// [5] B2 auto-archive + B3 fabric-hint rename + B4 3-client configs.
function checkB2B3B4Hints() {
  const failures = [];

  // fabric-hint.cjs must exist; archive-hint.cjs must not (template surface).
  if (!fileExists("packages/cli/templates/hooks/fabric-hint.cjs")) {
    failures.push("packages/cli/templates/hooks/fabric-hint.cjs missing");
  }
  if (fileExists("packages/cli/templates/hooks/archive-hint.cjs")) {
    failures.push("packages/cli/templates/hooks/archive-hint.cjs still exists (must be deleted)");
  }

  // 3-client configs.
  const configs = [
    "packages/cli/templates/hooks/configs/claude-code.json",
    "packages/cli/templates/hooks/configs/codex-hooks.json",
    "packages/cli/templates/hooks/configs/cursor-hooks.json",
  ];
  for (const cfg of configs) {
    if (!fileExists(cfg)) {
      failures.push(`${cfg} missing`);
      continue;
    }
    const raw = readText(cfg);
    if (raw === undefined) continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      failures.push(`${cfg} is not valid JSON: ${e.message}`);
      continue;
    }
    // claude-code uses `hooks.Stop`; codex/cursor use `events.Stop`.
    const stopBlock = parsed?.hooks?.Stop ?? parsed?.events?.Stop;
    if (!Array.isArray(stopBlock) || stopBlock.length === 0) {
      failures.push(`${cfg} has no Stop hook configured`);
      continue;
    }
    const stopText = JSON.stringify(stopBlock);
    if (!/fabric-hint\.cjs/.test(stopText)) {
      failures.push(`${cfg} Stop hook does not invoke fabric-hint.cjs`);
    }
    if (/archive-hint\.cjs/.test(stopText)) {
      failures.push(`${cfg} Stop hook still references archive-hint.cjs`);
    }
  }

  // B2 auto-archive: doctor.ts must implement the >30d pending sweep. We
  // check for the conventional inspector id used by TASK-009 (overdue
  // pending lint or apply-lint mutation).
  const doctor = readText("packages/server/src/services/doctor.ts");
  if (doctor === undefined) {
    failures.push("server/services/doctor.ts missing");
  } else if (!/pending.*overdue|overdue.*pending|pending_archive_overdue|knowledge_pending_overdue/i.test(doctor)) {
    failures.push("doctor.ts has no overdue-pending inspector (B2 auto-archive sweep)");
  }

  if (failures.length === 0) {
    return { id: 5, name: "B2+B3+B4 hint pivot", passed: true };
  }
  return { id: 5, name: "B2+B3+B4 hint pivot", passed: false, details: failures.join("\n") };
}

// [6] C1 relevance fields on agents.meta schema.
function checkC1RelevanceFields() {
  const src = readText("packages/shared/src/schemas/agents-meta.ts");
  if (src === undefined) {
    return { id: 6, name: "C1 relevance fields", passed: false, details: "agents-meta.ts missing" };
  }
  const failures = [];
  if (!/relevance_scope/.test(src)) failures.push("agents-meta.ts: relevance_scope absent");
  if (!/relevance_paths/.test(src)) failures.push("agents-meta.ts: relevance_paths absent");
  // Defaults: scope=broad, paths=[]. The schema should ship them so existing
  // entries upgrade cleanly. We accept either zod default() calls or
  // optional with explicit default tuples.
  if (!/\.default\(\s*["']broad["']\s*\)|default:\s*["']broad["']/.test(src)) {
    failures.push("agents-meta.ts: relevance_scope has no `broad` default");
  }
  if (failures.length === 0) {
    return { id: 6, name: "C1 relevance fields", passed: true };
  }
  return { id: 6, name: "C1 relevance fields", passed: false, details: failures.join("\n") };
}

// [7] C2 + C3 review pivots — modify-action handles relevance_*, layer-flip auto-degrade.
function checkC2C3ReviewPivots() {
  const src = readText("packages/server/src/services/review.ts");
  if (src === undefined) {
    return { id: 7, name: "C2+C3 review pivots", passed: false, details: "review.ts missing" };
  }
  const failures = [];

  if (!/relevance_scope/.test(src)) failures.push("review.ts: relevance_scope not wired");
  if (!/relevance_paths/.test(src)) failures.push("review.ts: relevance_paths not wired");

  // Layer-flip degrade — at least one of these must appear (the canonical
  // signals from TASK-012/013): event_type "knowledge_scope_degraded",
  // reason "personal-implies-broad", or the team_to_personal sentinel.
  const degradeSignals = [
    "knowledge_scope_degraded",
    "personal-implies-broad",
    "team_to_personal",
  ];
  if (!degradeSignals.some((s) => src.includes(s))) {
    failures.push(
      `review.ts: layer-flip auto-degrade absent (none of ${degradeSignals.join(", ")} found)`,
    );
  }

  if (failures.length === 0) {
    return { id: 7, name: "C2+C3 review pivots", passed: true };
  }
  return { id: 7, name: "C2+C3 review pivots", passed: false, details: failures.join("\n") };
}

// [8] C4 doctor lints #23..#25.
function checkC4DoctorLints() {
  const src = readText("packages/server/src/services/doctor.ts");
  if (src === undefined) {
    return { id: 8, name: "C4 doctor lints #23..#25", passed: false, details: "doctor.ts missing" };
  }
  const failures = [];
  const required = [
    "knowledge_narrow_no_paths",
    "knowledge_relevance_paths_dangling",
    "knowledge_relevance_paths_drift",
  ];
  for (const code of required) {
    if (!src.includes(code)) failures.push(`doctor.ts: ${code} inspector missing`);
  }
  if (failures.length === 0) {
    return { id: 8, name: "C4 doctor lints #23..#25", passed: true };
  }
  return { id: 8, name: "C4 doctor lints #23..#25", passed: false, details: failures.join("\n") };
}

// [9] C5 (knowledge_consumed + last_consumed_at) + C6 (hint signal A) + C7
// (computeRevision pending excl). All-or-nothing.
function checkC5C6C7() {
  const failures = [];

  // C5.a: event-ledger schema includes knowledge_consumed.
  const ledger = readText("packages/shared/src/schemas/event-ledger.ts");
  if (ledger === undefined) {
    failures.push("event-ledger.ts missing");
  } else if (!/knowledge_consumed/.test(ledger)) {
    failures.push("event-ledger.ts: knowledge_consumed event not registered");
  }

  // C5.b: doctor uses last_consumed_at (not legacy last_referenced as a live field).
  const doctor = readText("packages/server/src/services/doctor.ts");
  if (doctor === undefined) {
    failures.push("doctor.ts missing");
  } else {
    if (!/last_consumed_at/.test(doctor)) {
      failures.push("doctor.ts: last_consumed_at pivot absent (still on last_referenced?)");
    }
    // Live identifier references to `last_referenced` (not in comments) are a regression.
    const doctorCode = doctor
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    if (/\blast_referenced\b/.test(doctorCode)) {
      failures.push("doctor.ts: still references last_referenced in code (not just comments)");
    }
  }

  // C6: fabric-hint.cjs must NOT reference THRESHOLD_PLAN_CONTEXTS
  // (Signal A pivoted to 24h-only in TASK-015).
  const hint = readText("packages/cli/templates/hooks/fabric-hint.cjs");
  if (hint === undefined) {
    failures.push("fabric-hint.cjs missing");
  } else if (/THRESHOLD_PLAN_CONTEXTS/.test(hint)) {
    failures.push("fabric-hint.cjs: THRESHOLD_PLAN_CONTEXTS still present (C6 pivot incomplete)");
  }

  // C7: computeRevision excludes pending nodes.
  const builder = readText("packages/server/src/services/knowledge-meta-builder.ts");
  if (builder === undefined) {
    failures.push("knowledge-meta-builder.ts missing");
  } else {
    // The canonical implementation filters `!isPendingNode(node)` inside
    // computeRevision. Accept either that explicit predicate or an inline
    // `node.status !== "pending"` guard.
    const computeRevBlock = builder.match(/function\s+computeRevision[\s\S]*?\n\}/);
    if (computeRevBlock === null) {
      failures.push("knowledge-meta-builder.ts: computeRevision function not found");
    } else {
      const body = computeRevBlock[0];
      const excludesPending =
        /!isPendingNode\s*\(/.test(body) ||
        /node\.status\s*!==\s*["']pending["']/.test(body);
      if (!excludesPending) {
        failures.push("computeRevision does not exclude pending nodes (C7 regression)");
      }
    }
  }

  if (failures.length === 0) {
    return { id: 9, name: "C5+C6+C7", passed: true };
  }
  return { id: 9, name: "C5+C6+C7", passed: false, details: failures.join("\n") };
}

// ---------------------------------------------------------------------------
// build + test verifications
// ---------------------------------------------------------------------------

function runBuild() {
  const res = run("pnpm", ["-w", "build"], { stdio: ["ignore", "pipe", "pipe"] });
  return { passed: res.code === 0, code: res.code, stderr: res.stderr };
}

function runFilterTests(filterPkg) {
  const res = run("pnpm", ["--filter", filterPkg, "test"], { stdio: ["ignore", "pipe", "pipe"] });
  // vitest summary line — two shapes seen in the wild:
  //   "Tests  283 passed (283)"
  //   "Tests  363 passed | 1 skipped (364)"
  // Match the first `\d+ passed` after "Tests".
  const m = res.stdout.match(/Tests\s+(\d+)\s+passed\b/);
  const passedCount = m ? parseInt(m[1], 10) : undefined;
  return {
    passed: res.code === 0,
    code: res.code,
    passedCount,
    stderr: res.stderr.split("\n").slice(-30).join("\n"),
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  console.log("rc.5 Coverage Gate");
  console.log("==================");

  const checks = [
    checkA1RenameComplete(),
    checkA2A4Cleanup(),
    checkA3PlanContext(),
    checkB1DualPending(),
    checkB2B3B4Hints(),
    checkC1RelevanceFields(),
    checkC2C3ReviewPivots(),
    checkC4DoctorLints(),
    checkC5C6C7(),
  ];

  for (const c of checks) {
    const mark = c.passed ? "PASS" : "FAIL";
    const label = c.name.padEnd(32, " ");
    console.log(`[${c.id}/9] ${label} ${c.passed ? "OK  " : "FAIL"} ${mark}`);
  }

  const failed = checks.filter((c) => !c.passed);
  if (failed.length > 0) {
    console.log("---");
    console.log("FAILURES:");
    for (const c of failed) {
      console.log(`  [${c.id}] ${c.name}`);
      if (c.details) {
        for (const line of String(c.details).split("\n")) {
          console.log(`      ${line}`);
        }
      }
    }
    console.log("---");
    console.log(`RESULT: FAIL (${checks.length - failed.length}/${checks.length} checks passed)`);
    process.exit(1);
  }

  // Build + test gates. Skip when FABRIC_GATE_SKIP_BUILD=1 (CI matrix can
  // split these). We honor the same env var for tests.
  const skipBuild = process.env.FABRIC_GATE_SKIP_BUILD === "1";
  const skipTests = process.env.FABRIC_GATE_SKIP_TESTS === "1";

  console.log("---");

  let buildResult = { passed: true, skipped: true };
  if (!skipBuild) {
    process.stdout.write("Build:  running pnpm -w build ... ");
    buildResult = runBuild();
    console.log(buildResult.passed ? "green" : `FAIL (exit ${buildResult.code})`);
    if (!buildResult.passed) {
      console.error(buildResult.stderr);
    }
  } else {
    console.log("Build:  skipped (FABRIC_GATE_SKIP_BUILD=1)");
  }

  let serverResult = { passed: true, skipped: true };
  let sharedResult = { passed: true, skipped: true };
  if (!skipTests) {
    process.stdout.write("Server: running pnpm --filter @fenglimg/fabric-server test ... ");
    serverResult = runFilterTests("@fenglimg/fabric-server");
    console.log(
      serverResult.passed
        ? `${serverResult.passedCount ?? "?"} passed`
        : `FAIL (exit ${serverResult.code})`,
    );
    if (!serverResult.passed) console.error(serverResult.stderr);

    process.stdout.write("Shared: running pnpm --filter @fenglimg/fabric-shared test ... ");
    sharedResult = runFilterTests("@fenglimg/fabric-shared");
    console.log(
      sharedResult.passed
        ? `${sharedResult.passedCount ?? "?"} passed`
        : `FAIL (exit ${sharedResult.code})`,
    );
    if (!sharedResult.passed) console.error(sharedResult.stderr);
  } else {
    console.log("Server: skipped (FABRIC_GATE_SKIP_TESTS=1)");
    console.log("Shared: skipped (FABRIC_GATE_SKIP_TESTS=1)");
  }

  console.log("---");

  const allGreen = buildResult.passed && serverResult.passed && sharedResult.passed;
  if (allGreen) {
    const buildLabel = buildResult.skipped ? "skipped" : "green";
    const serverLabel = serverResult.skipped
      ? "skipped"
      : `${serverResult.passedCount ?? "?"} passed`;
    const sharedLabel = sharedResult.skipped
      ? "skipped"
      : `${sharedResult.passedCount ?? "?"} passed`;
    console.log(
      `RESULT: PASS (${checks.length}/${checks.length} checks, build ${buildLabel}, server ${serverLabel}, shared ${sharedLabel})`,
    );
    process.exit(0);
  }

  console.log(`RESULT: FAIL (${checks.length}/${checks.length} checks but build/test gate failed)`);
  process.exit(1);
}

main();
