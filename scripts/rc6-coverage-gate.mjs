#!/usr/bin/env node
// rc6-coverage-gate.mjs
//
// v2.0.0-rc.6 coverage gate — structural assertions over the rc.6 scope
// (Fabric Knowledge Pivot: SessionStart broad-injection, PreToolUse narrow-
// injection, session-hints cache, edit-counter sidecar, Signal A upgrade,
// lint #26 + #27, silence-counter telemetry, install wiring).
//
// Mirrors scripts/rc5-coverage-gate.mjs (committed in a92b144 / TASK-018):
//   - Same CLI ergonomics: `node scripts/rc6-coverage-gate.mjs` or `pnpm rc6:gate`.
//   - Same env-var skip flags: FABRIC_GATE_SKIP_BUILD=1, FABRIC_GATE_SKIP_TESTS=1.
//   - Same output format: per-check OK/PASS table, build+test tail, RESULT line.
//   - Same exit semantics: 0 on full PASS, non-zero on any failure.
//
// Check → TASK mapping (rc.6):
//   [1] rc.5 anchor still green       — re-run rc.5 gate (skip build/tests; they fire here)
//   [2] E1 SessionStart broad hook    — TASK-019 (knowledge-hint-broad.cjs + 3 configs)
//   [3] E2 PreToolUse narrow hook     — TASK-020 (knowledge-hint-narrow.cjs + 3 configs)
//   [4] E4 edit-counter sidecar       — TASK-020 (narrow.cjs appends .fabric/.cache/edit-counter)
//   [5] E3 session-hints cache        — TASK-021 (session-hints-X.json + lint #27)
//   [6] E5 Signal A 24h-OR-edits      — TASK-022 (fabric-hint reads edit-counter; schema field)
//   [7] E6 lint #26 + silence-counter — TASK-023 (narrow_too_few Part A+B; silence sidecar)
//   [8] Install wiring + validate     — install helpers + validateHookPaths 3x3 matrix
//
// CLI hook tests subset (check #8 tail):
//   We invoke vitest with a specific test-file list rather than `pnpm --filter
//   @fenglimg/fabric-cli test`. The package-wide vitest run pulls in werewolf-
//   stub-dependent integration tests that are known-broken pre-existing
//   failures from rc.5 A4 cleanup (dashboard drop). Per the TASK-024 spec we
//   target only the hook-related suites:
//
//     - fabric-hint.test.ts           (Stop hook, E5 Signal A upgrade)
//     - knowledge-hint-broad.test.ts  (E1 SessionStart broad)
//     - knowledge-hint-narrow.test.ts (E2/E3/E4/E6 PreToolUse narrow + cache)
//     - hooks-install-validate.test.ts (install wiring matrix)
//
// Each check returns { id, name, passed, details? }. The script exits 0
// iff every check passes AND build/tests are green (or skipped via env).

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");

// ---------------------------------------------------------------------------
// helpers (mirror rc.5 gate)
// ---------------------------------------------------------------------------

function readText(relPath) {
  const abs = resolve(REPO_ROOT, relPath);
  if (!existsSync(abs)) return undefined;
  return readFileSync(abs, "utf8");
}

function fileExists(relPath) {
  return existsSync(resolve(REPO_ROOT, relPath));
}

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

// Parse a client-config Stop/SessionStart/PreToolUse hook block. Returns the
// array of registered entries regardless of whether the file uses the
// Claude-Code `hooks.X` envelope or the Codex/Cursor `events.X` envelope.
// Returns null when the slot is missing/empty/malformed.
function readHookSlot(configPath, slotName) {
  const raw = readText(configPath);
  if (raw === undefined) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const slot = parsed?.hooks?.[slotName] ?? parsed?.events?.[slotName];
  return Array.isArray(slot) && slot.length > 0 ? slot : null;
}

// Stringify a hook slot for content-grep regardless of nested shape. Both
// shapes (Claude `hooks: [{ command }]` and Codex/Cursor flat `command`)
// flatten to a single JSON string we can pattern-match against.
function slotText(slot) {
  return slot === null ? "" : JSON.stringify(slot);
}

const CLIENT_CONFIGS = [
  "packages/cli/templates/hooks/configs/claude-code.json",
  "packages/cli/templates/hooks/configs/codex-hooks.json",
  "packages/cli/templates/hooks/configs/cursor-hooks.json",
];

// ---------------------------------------------------------------------------
// [1] rc.5 anchor still green — re-run rc.5 gate (skip build+tests; those will
// run at the end of THIS gate, so duplicating them here would double the
// runtime for no extra signal).
// ---------------------------------------------------------------------------
function checkRc5AnchorGreen() {
  const res = run("node", ["scripts/rc5-coverage-gate.mjs"], {
    env: {
      ...process.env,
      FABRIC_GATE_SKIP_BUILD: "1",
      FABRIC_GATE_SKIP_TESTS: "1",
    },
  });
  if (res.code === 0) {
    return { id: 1, name: "rc.5 anchor still green", passed: true };
  }
  // Surface the rc.5 gate's own failure summary (last few lines of stdout).
  const tail = res.stdout.trim().split("\n").slice(-15).join("\n");
  return {
    id: 1,
    name: "rc.5 anchor still green",
    passed: false,
    details: `rc.5 gate exited ${res.code}\n${tail}`,
  };
}

// ---------------------------------------------------------------------------
// [2] E1 SessionStart broad hook (TASK-019)
// knowledge-hint-broad.cjs exists; all 3 client configs register it under
// their SessionStart event slot.
// ---------------------------------------------------------------------------
function checkE1BroadHook() {
  const failures = [];

  if (!fileExists("packages/cli/templates/hooks/knowledge-hint-broad.cjs")) {
    failures.push("packages/cli/templates/hooks/knowledge-hint-broad.cjs missing");
  }

  for (const cfg of CLIENT_CONFIGS) {
    const slot = readHookSlot(cfg, "SessionStart");
    if (slot === null) {
      failures.push(`${cfg}: SessionStart slot missing/empty`);
      continue;
    }
    if (!/knowledge-hint-broad\.cjs/.test(slotText(slot))) {
      failures.push(`${cfg}: SessionStart does not invoke knowledge-hint-broad.cjs`);
    }
  }

  if (failures.length === 0) {
    return { id: 2, name: "E1 SessionStart broad hook", passed: true };
  }
  return {
    id: 2,
    name: "E1 SessionStart broad hook",
    passed: false,
    details: failures.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// [3] E2 PreToolUse narrow hook (TASK-020)
// knowledge-hint-narrow.cjs exists; all 3 client configs register it under
// PreToolUse with Edit|Write|MultiEdit matchers.
// ---------------------------------------------------------------------------
function checkE2NarrowHook() {
  const failures = [];

  if (!fileExists("packages/cli/templates/hooks/knowledge-hint-narrow.cjs")) {
    failures.push("packages/cli/templates/hooks/knowledge-hint-narrow.cjs missing");
  }

  for (const cfg of CLIENT_CONFIGS) {
    const slot = readHookSlot(cfg, "PreToolUse");
    if (slot === null) {
      failures.push(`${cfg}: PreToolUse slot missing/empty`);
      continue;
    }
    const text = slotText(slot);
    if (!/knowledge-hint-narrow\.cjs/.test(text)) {
      failures.push(`${cfg}: PreToolUse does not invoke knowledge-hint-narrow.cjs`);
    }
    // Matchers — must cover all three edit-shaped tool names. The matcher
    // value is a single regex-style alternation per the Claude/Cursor/Codex
    // PreToolUse contract.
    const matcherCovers = (tool) =>
      new RegExp(`"matcher"\\s*:\\s*"[^"]*\\b${tool}\\b[^"]*"`).test(text);
    for (const tool of ["Edit", "Write", "MultiEdit"]) {
      if (!matcherCovers(tool)) {
        failures.push(`${cfg}: PreToolUse matcher missing ${tool}`);
      }
    }
  }

  if (failures.length === 0) {
    return { id: 3, name: "E2 PreToolUse narrow hook", passed: true };
  }
  return {
    id: 3,
    name: "E2 PreToolUse narrow hook",
    passed: false,
    details: failures.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// [4] E4 edit-counter sidecar (TASK-020)
// knowledge-hint-narrow.cjs source references .fabric/.cache/edit-counter
// AND has appendFile-style logic AND exports the path constant.
//
// Mirrors rc.5 gate methodology (source-grep over the hook surface) rather
// than spawning the hook — keeps the gate fast + deterministic.
// ---------------------------------------------------------------------------
function checkE4EditCounter() {
  const src = readText("packages/cli/templates/hooks/knowledge-hint-narrow.cjs");
  if (src === undefined) {
    return {
      id: 4,
      name: "E4 edit-counter sidecar",
      passed: false,
      details: "knowledge-hint-narrow.cjs missing",
    };
  }
  const failures = [];

  // Path reference — the canonical .fabric/.cache/edit-counter location.
  // Accept either literal path or the join() decomposition.
  const hasPath =
    /\.fabric\/\.cache\/edit-counter/.test(src) ||
    (/\.fabric/.test(src) && /\.cache/.test(src) && /edit-counter/.test(src));
  if (!hasPath) {
    failures.push("no reference to .fabric/.cache/edit-counter");
  }

  // appendFile-style logic — appendFileSync or appendFile is the documented
  // sidecar semantic (one timestamp line per fire).
  if (!/appendFileSync|appendFile\b/.test(src)) {
    failures.push("no appendFile-style write logic");
  }

  // Exported path constant — TASK-022 (E5 Signal A upgrade) reads this
  // constant via the cross-hook contract. The CONSTANTS export bag is the
  // expected vehicle.
  if (!/EDIT_COUNTER_(?:FILE|DIR|FILE_REL)/.test(src)) {
    failures.push("no EDIT_COUNTER_* constant exported");
  }

  if (failures.length === 0) {
    return { id: 4, name: "E4 edit-counter sidecar", passed: true };
  }
  return {
    id: 4,
    name: "E4 edit-counter sidecar",
    passed: false,
    details: failures.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// [5] E3 session-hints cache (TASK-021)
// knowledge-hint-narrow.cjs references the session-hints-{id}.json filename
// pattern AND reads revision_hash from the CLI output; doctor defines lint
// #27 knowledge_session_hints_stale.
// ---------------------------------------------------------------------------
function checkE3SessionHints() {
  const failures = [];

  const narrow = readText("packages/cli/templates/hooks/knowledge-hint-narrow.cjs");
  if (narrow === undefined) {
    failures.push("knowledge-hint-narrow.cjs missing");
  } else {
    if (!/session-hints-/.test(narrow)) {
      failures.push("narrow.cjs: no session-hints- filename pattern");
    }
    // revision_hash is consumed from the CLI's plan-context-hint output to
    // drive the cache-invalidation branch.
    if (!/revision_hash/.test(narrow)) {
      failures.push("narrow.cjs: no revision_hash read from CLI output");
    }
  }

  const doctor = readText("packages/server/src/services/doctor.ts");
  if (doctor === undefined) {
    failures.push("server/services/doctor.ts missing");
  } else if (!/knowledge_session_hints_stale/.test(doctor)) {
    failures.push("doctor.ts: lint #27 knowledge_session_hints_stale missing");
  }

  if (failures.length === 0) {
    return { id: 5, name: "E3 session-hints cache", passed: true };
  }
  return {
    id: 5,
    name: "E3 session-hints cache",
    passed: false,
    details: failures.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// [6] E5 Signal A upgrade (TASK-022)
// fabric-hint.cjs reads the edit-counter sidecar (via EDIT_COUNTER_FILE_REL
// or the literal path) AND defines countEditsSince AND reads
// archive_edit_threshold; fabric-config schema defines the field with
// default 20.
// ---------------------------------------------------------------------------
function checkE5SignalA() {
  const failures = [];

  const hint = readText("packages/cli/templates/hooks/fabric-hint.cjs");
  if (hint === undefined) {
    failures.push("fabric-hint.cjs missing");
  } else {
    const refsCounter =
      /EDIT_COUNTER_FILE_REL/.test(hint) || /\.fabric\/\.cache\/edit-counter/.test(hint);
    if (!refsCounter) {
      failures.push("fabric-hint.cjs: no reference to edit-counter sidecar");
    }
    if (!/archive_edit_threshold/.test(hint)) {
      failures.push("fabric-hint.cjs: archive_edit_threshold not consumed");
    }
    if (!/countEditsSince/.test(hint)) {
      failures.push("fabric-hint.cjs: countEditsSince function missing");
    }
  }

  const schema = readText("packages/shared/src/schemas/fabric-config.ts");
  if (schema === undefined) {
    failures.push("packages/shared/src/schemas/fabric-config.ts missing");
  } else {
    if (!/archive_edit_threshold/.test(schema)) {
      failures.push("fabric-config.ts: archive_edit_threshold field missing");
    }
    // Default of 20. Accept either `.default(20)` (zod fluent) or a
    // documented default in a comment near the field — but the canonical
    // expectation is the fluent call.
    if (!/archive_edit_threshold[\s\S]{0,200}?\.default\(\s*20\s*\)/.test(schema)) {
      failures.push("fabric-config.ts: archive_edit_threshold has no default(20)");
    }
  }

  if (failures.length === 0) {
    return { id: 6, name: "E5 Signal A 24h-OR-edits", passed: true };
  }
  return {
    id: 6,
    name: "E5 Signal A 24h-OR-edits",
    passed: false,
    details: failures.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// [7] E6 lint #26 + silence-counter (TASK-023)
// doctor.ts defines lint knowledge_narrow_too_few with Part A (structural
// ratio) AND Part B (silence rate) logic; narrow.cjs references the
// hint-silence-counter sidecar + appendHintSilenceCounter helper.
// ---------------------------------------------------------------------------
function checkE6LintAndSilence() {
  const failures = [];

  const doctor = readText("packages/server/src/services/doctor.ts");
  if (doctor === undefined) {
    failures.push("doctor.ts missing");
  } else {
    if (!/knowledge_narrow_too_few/.test(doctor)) {
      failures.push("doctor.ts: lint #26 knowledge_narrow_too_few missing");
    }
    // Part A: structural ratio — the inspector tracks narrow-with-paths
    // share over total canonical entries. Accept either the explicit
    // `narrow_ratio` or `narrow_with_paths` accumulator.
    const hasPartA =
      /narrow_ratio/.test(doctor) || /narrow_with_paths/.test(doctor);
    if (!hasPartA) {
      failures.push("doctor.ts: lint #26 Part A (structural ratio) absent");
    }
    // Part B: silence rate — silence_rate or silence_fires_in_window
    // accumulator from the hint-silence-counter window read.
    const hasPartB =
      /silence_rate/.test(doctor) || /silence_fires_in_window/.test(doctor);
    if (!hasPartB) {
      failures.push("doctor.ts: lint #26 Part B (silence rate) absent");
    }
  }

  const narrow = readText("packages/cli/templates/hooks/knowledge-hint-narrow.cjs");
  if (narrow === undefined) {
    failures.push("knowledge-hint-narrow.cjs missing");
  } else {
    if (!/hint-silence-counter/.test(narrow)) {
      failures.push("narrow.cjs: hint-silence-counter sidecar path missing");
    }
    if (!/appendHintSilenceCounter/.test(narrow)) {
      failures.push("narrow.cjs: appendHintSilenceCounter helper missing");
    }
  }

  if (failures.length === 0) {
    return { id: 7, name: "E6 lint #26 + silence-counter", passed: true };
  }
  return {
    id: 7,
    name: "E6 lint #26 + silence-counter",
    passed: false,
    details: failures.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// [8] Install wiring + validate
// skills-and-hooks.ts exports installKnowledgeHintBroadHook AND
// installKnowledgeHintNarrowHook; hooks.ts validateHookPaths covers all 3
// hook scripts across all 3 clients.
// ---------------------------------------------------------------------------
function checkInstallWiring() {
  const failures = [];

  const install = readText("packages/cli/src/install/skills-and-hooks.ts");
  if (install === undefined) {
    failures.push("packages/cli/src/install/skills-and-hooks.ts missing");
  } else {
    if (!/export\s+(?:async\s+)?function\s+installKnowledgeHintBroadHook\b/.test(install)) {
      failures.push(
        "skills-and-hooks.ts: installKnowledgeHintBroadHook not exported as a function",
      );
    }
    if (!/export\s+(?:async\s+)?function\s+installKnowledgeHintNarrowHook\b/.test(install)) {
      failures.push(
        "skills-and-hooks.ts: installKnowledgeHintNarrowHook not exported as a function",
      );
    }
  }

  const hooks = readText("packages/cli/src/commands/hooks.ts");
  if (hooks === undefined) {
    failures.push("packages/cli/src/commands/hooks.ts missing");
  } else {
    if (!/function\s+validateHookPaths\b/.test(hooks)) {
      failures.push("hooks.ts: validateHookPaths function missing");
    }
    // All three hook scripts must be referenced inside the validate function
    // surface (or its module-scoped descriptor table). We grep at file level
    // because TypeScript may hoist the descriptor const above the function.
    const requiredScripts = [
      "fabric-hint.cjs",
      "knowledge-hint-broad.cjs",
      "knowledge-hint-narrow.cjs",
    ];
    for (const s of requiredScripts) {
      if (!hooks.includes(s)) {
        failures.push(`hooks.ts: validateHookPaths does not cover ${s}`);
      }
    }
  }

  if (failures.length === 0) {
    return { id: 8, name: "Install wiring + validate", passed: true };
  }
  return {
    id: 8,
    name: "Install wiring + validate",
    passed: false,
    details: failures.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// build + test verifications
// ---------------------------------------------------------------------------

function runBuild() {
  const res = run("pnpm", ["-w", "build"], { stdio: ["ignore", "pipe", "pipe"] });
  return { passed: res.code === 0, code: res.code, stderr: res.stderr };
}

function runFilterTests(filterPkg) {
  const res = run("pnpm", ["--filter", filterPkg, "test"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const m = res.stdout.match(/Tests\s+(\d+)\s+passed\b/);
  const passedCount = m ? parseInt(m[1], 10) : undefined;
  return {
    passed: res.code === 0,
    code: res.code,
    passedCount,
    stderr: res.stderr.split("\n").slice(-30).join("\n"),
    stdoutTail: res.stdout.split("\n").slice(-15).join("\n"),
  };
}

// CLI hook tests — file-targeted to dodge werewolf-stub integration suites
// known broken from rc.5 A4 cleanup. We point vitest at the specific files
// rather than running the whole `--filter @fenglimg/fabric-cli test`.
function runCliHookTests() {
  const files = [
    "__tests__/fabric-hint.test.ts",
    "__tests__/knowledge-hint-broad.test.ts",
    "__tests__/knowledge-hint-narrow.test.ts",
    "__tests__/hooks-install-validate.test.ts",
  ];
  const res = run(
    "pnpm",
    [
      "--filter",
      "@fenglimg/fabric-cli",
      "exec",
      "vitest",
      "run",
      ...files,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const m = res.stdout.match(/Tests\s+(\d+)\s+passed\b/);
  const passedCount = m ? parseInt(m[1], 10) : undefined;
  return {
    passed: res.code === 0,
    code: res.code,
    passedCount,
    stderr: res.stderr.split("\n").slice(-30).join("\n"),
    stdoutTail: res.stdout.split("\n").slice(-20).join("\n"),
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  console.log("rc.6 Coverage Gate");
  console.log("==================");

  const checks = [
    checkRc5AnchorGreen(),
    checkE1BroadHook(),
    checkE2NarrowHook(),
    checkE4EditCounter(),
    checkE3SessionHints(),
    checkE5SignalA(),
    checkE6LintAndSilence(),
    checkInstallWiring(),
  ];

  for (const c of checks) {
    const mark = c.passed ? "PASS" : "FAIL";
    const label = c.name.padEnd(32, " ");
    console.log(`[${c.id}/8] ${label} ${c.passed ? "OK  " : "FAIL"} ${mark}`);
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

  const skipBuild = process.env.FABRIC_GATE_SKIP_BUILD === "1";
  const skipTests = process.env.FABRIC_GATE_SKIP_TESTS === "1";

  console.log("---");

  let buildResult = { passed: true, skipped: true };
  if (!skipBuild) {
    process.stdout.write("Build:    running pnpm -w build ... ");
    buildResult = runBuild();
    console.log(buildResult.passed ? "green" : `FAIL (exit ${buildResult.code})`);
    if (!buildResult.passed) {
      console.error(buildResult.stderr);
    }
  } else {
    console.log("Build:    skipped (FABRIC_GATE_SKIP_BUILD=1)");
  }

  let serverResult = { passed: true, skipped: true };
  let sharedResult = { passed: true, skipped: true };
  let cliHookResult = { passed: true, skipped: true };
  if (!skipTests) {
    process.stdout.write("Server:   running pnpm --filter @fenglimg/fabric-server test ... ");
    serverResult = runFilterTests("@fenglimg/fabric-server");
    console.log(
      serverResult.passed
        ? `${serverResult.passedCount ?? "?"} passed`
        : `FAIL (exit ${serverResult.code})`,
    );
    if (!serverResult.passed) {
      console.error(serverResult.stdoutTail);
      console.error(serverResult.stderr);
    }

    process.stdout.write("Shared:   running pnpm --filter @fenglimg/fabric-shared test ... ");
    sharedResult = runFilterTests("@fenglimg/fabric-shared");
    console.log(
      sharedResult.passed
        ? `${sharedResult.passedCount ?? "?"} passed`
        : `FAIL (exit ${sharedResult.code})`,
    );
    if (!sharedResult.passed) {
      console.error(sharedResult.stdoutTail);
      console.error(sharedResult.stderr);
    }

    process.stdout.write(
      "CLI hooks: running vitest (fabric-hint + broad + narrow + install-validate) ... ",
    );
    cliHookResult = runCliHookTests();
    console.log(
      cliHookResult.passed
        ? `${cliHookResult.passedCount ?? "?"} passed`
        : `FAIL (exit ${cliHookResult.code})`,
    );
    if (!cliHookResult.passed) {
      console.error(cliHookResult.stdoutTail);
      console.error(cliHookResult.stderr);
    }
  } else {
    console.log("Server:   skipped (FABRIC_GATE_SKIP_TESTS=1)");
    console.log("Shared:   skipped (FABRIC_GATE_SKIP_TESTS=1)");
    console.log("CLI hooks: skipped (FABRIC_GATE_SKIP_TESTS=1)");
  }

  console.log("---");

  const allGreen =
    buildResult.passed &&
    serverResult.passed &&
    sharedResult.passed &&
    cliHookResult.passed;
  if (allGreen) {
    const buildLabel = buildResult.skipped ? "skipped" : "green";
    const serverLabel = serverResult.skipped
      ? "skipped"
      : `${serverResult.passedCount ?? "?"} passed`;
    const sharedLabel = sharedResult.skipped
      ? "skipped"
      : `${sharedResult.passedCount ?? "?"} passed`;
    const cliLabel = cliHookResult.skipped
      ? "skipped"
      : `${cliHookResult.passedCount ?? "?"} passed`;
    console.log(
      `RESULT: PASS (${checks.length}/${checks.length} checks, build ${buildLabel}, server ${serverLabel}, shared ${sharedLabel}, cli-hooks ${cliLabel})`,
    );
    process.exit(0);
  }

  console.log(
    `RESULT: FAIL (${checks.length}/${checks.length} checks but build/test gate failed)`,
  );
  process.exit(1);
}

main();
