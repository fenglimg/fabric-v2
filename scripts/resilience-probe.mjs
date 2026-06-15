#!/usr/bin/env node
// resilience-probe.mjs — G-RESILIENCE dogfood: concurrent multi-session isolation
// + backend-down graceful degradation, driving the REAL hook functions.
//
// Two failure modes the brief calls out:
//   A. Concurrent multi-window sessions must not cross-contaminate per-session
//      signals (张冠李戴). The cooldown sidecar is session-scoped (F13 /
//      ISS-20260531-038): a nudge fired in window A must NOT silence the same
//      nudge in window B. We drive read/writeMaintenanceLastEmit for two distinct
//      session ids in one project root and assert independence.
//   B. When the backend (fabric CLI / MCP) is unavailable, hooks must degrade
//      silently — never throw, never crash the host client. We invoke the broad
//      hint hook's main() against a cwd with no fabric on PATH and assert it
//      returns silent (no banner, no throw).
//
// Any contaminated signal or any thrown error → non-zero exit. Hard gate.

import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const fabricHint = require(join(ROOT, "packages/cli/templates/hooks/fabric-hint.cjs"));
const broadHint = require(join(ROOT, "packages/cli/templates/hooks/knowledge-hint-broad.cjs"));

const results = [];
const fails = [];
const check = (probe, expectation, ok, detail) => {
  results.push({ probe, expectation, ok, detail });
  if (!ok) fails.push({ probe, detail });
};

function withTempRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), "resilience-"));
  mkdirSync(join(root, ".fabric", ".cache"), { recursive: true });
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ── Probe A: concurrent multi-session isolation (F13 session-scoped sidecar) ──
withTempRoot((root) => {
  const tA = 1_700_000_000_000;
  // Window A fires the maintenance nudge → enters cooldown.
  fabricHint.writeMaintenanceLastEmit(root, tA, "session-A");

  // Window A sees its own cooldown timestamp.
  const aSees = fabricHint.readMaintenanceLastEmit(root, "session-A");
  check("concurrent-isolation", "A reads its own cooldown", aSees === tA, `A=${aSees} expected=${tA}`);

  // Window B (concurrent) must NOT be silenced by A's cooldown — independent sidecar.
  const bSees = fabricHint.readMaintenanceLastEmit(root, "session-B");
  check(
    "concurrent-isolation",
    "B not silenced by A's nudge (independent sidecar)",
    bSees === null,
    `B=${bSees} (expected null — B never fired)`,
  );

  // Now B fires; A's value must remain its own (no clobber).
  const tB = tA + 999;
  fabricHint.writeMaintenanceLastEmit(root, tB, "session-B");
  const aStill = fabricHint.readMaintenanceLastEmit(root, "session-A");
  const bNow = fabricHint.readMaintenanceLastEmit(root, "session-B");
  check("concurrent-isolation", "A unchanged after B fires", aStill === tA, `A=${aStill} expected=${tA}`);
  check("concurrent-isolation", "B distinct from A", bNow === tB && bNow !== aStill, `B=${bNow} A=${aStill}`);

  // Legacy (absent session id) keeps the non-scoped path — upgrade compatibility.
  fabricHint.writeMaintenanceLastEmit(root, tA, null);
  const legacy = fabricHint.readMaintenanceLastEmit(root, null);
  check("concurrent-isolation", "absent sessionId → legacy non-scoped path works", legacy === tA, `legacy=${legacy}`);
});

// ── Probe B: backend-down graceful degradation ──
withTempRoot((root) => {
  // Strip fabric from PATH so the hook's spawnSync("fabric", ...) hits ENOENT.
  const savedPath = process.env.PATH;
  process.env.PATH = "/nonexistent-path-for-resilience-probe";

  let threw = null;
  let banner = "";
  try {
    const out = { write: (s) => (banner += s) };
    const err = { write: () => {} };
    // env.payload undefined → forces the real CLI spawn, which now fails (ENOENT).
    broadHint.main({ cwd: root, skipCooldown: true }, { stdout: out, stderr: err });
  } catch (e) {
    threw = e;
  } finally {
    process.env.PATH = savedPath;
  }
  check("backend-down", "broad hint main() does not throw when fabric absent", threw === null, threw ? String(threw.message) : "no throw");
  check("backend-down", "broad hint stays silent (no banner) on backend-down", banner.trim() === "", `banner=${JSON.stringify(banner.slice(0, 60))}`);

  // invokePlanContextHint must return null (not throw) when the bin is gone.
  process.env.PATH = "/nonexistent-path-for-resilience-probe";
  let invokeThrew = null;
  let payload = "sentinel";
  try {
    payload = broadHint.invokePlanContextHint(root);
  } catch (e) {
    invokeThrew = e;
  } finally {
    process.env.PATH = savedPath;
  }
  check("backend-down", "invokePlanContextHint returns null (never throws) on ENOENT", invokeThrew === null && payload === null, `threw=${!!invokeThrew} payload=${JSON.stringify(payload)}`);
});

// ── Report ──
console.log(`G-RESILIENCE probe — ${results.length} checks across 2 failure modes\n`);
const byProbe = {};
for (const r of results) {
  (byProbe[r.probe] ??= { total: 0, ok: 0 }).total++;
  if (r.ok) byProbe[r.probe].ok++;
  console.log(`  [${r.probe}] ${r.expectation}: ${r.ok ? "✓" : "✗ FAIL"}  (${r.detail})`);
}
console.log("");
for (const [p, c] of Object.entries(byProbe)) console.log(`  ${p.padEnd(22)} ${c.ok}/${c.total}`);

if (fails.length > 0) {
  console.error(`\nG-RESILIENCE FAIL: ${fails.length} check(s) failed`);
  for (const f of fails) console.error(`    ✗ [${f.probe}] ${f.detail}`);
  process.exit(1);
}
console.log(`\nG-RESILIENCE PASS: concurrent sessions independent (no 张冠李戴) + backend-down degrades silently (never throws)`);
