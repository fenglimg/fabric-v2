#!/usr/bin/env node
// upgrade-e2e.mjs — G-UPGRADE end-to-end upgrade journey (P0-NEW1 regression guard).
//
// The P0-NEW1 bug: a plain `fabric install` re-run did NOT refresh a STALE
// on-disk hook/skill from a prior version — the client kept running outdated
// bytes. This e2e drives the BUILT CLI as a black box and proves the upgrade
// path now overwrites stale managed artifacts with the current template bytes.
//
// Journey:
//   1. Fresh install into a temp project + isolated FABRIC_HOME (the "v2.0.1" install).
//   2. Assert fresh-install artifacts are byte-identical to the shipped templates.
//   3. Staleify: overwrite an installed hook + skill on disk with sentinel "old
//      version" bytes (simulating drift from an older release).
//   4. Re-run `install --yes` (the "upgrade to 2.2").
//   5. Assert the stale hook + skill are now byte-identical to the CURRENT template
//      again — the sentinel is gone, the upgrade refreshed them.
//
// Any stale artifact that survives the re-install → non-zero exit. Hard gate.

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages/cli/dist/index.js");

const results = [];
const fails = [];
const check = (step, expectation, ok, detail) => {
  results.push({ step, expectation, ok, detail });
  if (!ok) fails.push({ step, detail });
};

const tmpRoot = mkdtempSync(join(tmpdir(), "upgrade-e2e-"));
const fabricHome = join(tmpRoot, "home");
const proj = join(tmpRoot, "proj");
mkdirSync(fabricHome, { recursive: true });
mkdirSync(proj, { recursive: true });

const env = { ...process.env, FABRIC_HOME: fabricHome, HOME: fabricHome };
function install(label) {
  const r = spawnSync(process.execPath, [CLI, "install", "--yes"], { cwd: proj, env, encoding: "utf8" });
  if (r.status !== 0) {
    check("install", `${label} install exits 0`, false, `status=${r.status} stderr=${(r.stderr || "").slice(0, 200)}`);
    return false;
  }
  return true;
}

try {
  // git init so install treats proj as a repo root.
  spawnSync("git", ["init", "-q"], { cwd: proj });

  // ── 1. Fresh install (baseline "old version") ──
  if (!install("fresh")) throw new Error("fresh install failed");

  // The artifacts under test: one hook + one skill (both client-managed copies).
  const HOOK = join(proj, ".claude/hooks/fabric-hint.cjs");
  const SKILL = join(proj, ".claude/skills/fabric-archive/SKILL.md");
  const HOOK_TPL = join(ROOT, "packages/cli/templates/hooks/fabric-hint.cjs");
  const SKILL_TPL = join(ROOT, "packages/cli/templates/skills/fabric-archive/SKILL.md");

  check("fresh-install", "hook installed", existsSync(HOOK), HOOK);
  check("fresh-install", "skill installed", existsSync(SKILL), SKILL);

  // ── 2. Fresh artifacts byte-identical to current templates ──
  const hookTpl = readFileSync(HOOK_TPL, "utf8");
  const skillTpl = readFileSync(SKILL_TPL, "utf8");
  check("fresh-install", "hook byte-identical to template", readFileSync(HOOK, "utf8") === hookTpl, "fresh hook == template");
  check("fresh-install", "skill byte-identical to template", readFileSync(SKILL, "utf8") === skillTpl, "fresh skill == template");

  // ── 3. Staleify — simulate drift from an older release ──
  const STALE_HOOK = "// STALE v2.0.1 hook — should be overwritten on upgrade\nmodule.exports={};\n";
  const STALE_SKILL = "---\nname: fabric-archive\n---\nSTALE v2.0.1 skill body — should be overwritten on upgrade\n";
  writeFileSync(HOOK, STALE_HOOK);
  writeFileSync(SKILL, STALE_SKILL);
  check("staleify", "hook now stale", readFileSync(HOOK, "utf8") === STALE_HOOK, "stale bytes written");
  check("staleify", "skill now stale", readFileSync(SKILL, "utf8") === STALE_SKILL, "stale bytes written");

  // ── 4. Re-run install (the upgrade) ──
  if (!install("upgrade")) throw new Error("upgrade install failed");

  // ── 5. Stale artifacts refreshed to current template bytes ──
  const hookAfter = readFileSync(HOOK, "utf8");
  const skillAfter = readFileSync(SKILL, "utf8");
  check(
    "upgrade-refresh",
    "stale hook refreshed to current template (P0-NEW1 guard)",
    hookAfter === hookTpl && hookAfter !== STALE_HOOK,
    hookAfter === hookTpl ? "hook == current template" : `hook still stale (len=${hookAfter.length})`,
  );
  check(
    "upgrade-refresh",
    "stale skill refreshed to current template (P0-NEW1 guard)",
    skillAfter === skillTpl && skillAfter !== STALE_SKILL,
    skillAfter === skillTpl ? "skill == current template" : `skill still stale (len=${skillAfter.length})`,
  );
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}

// ── Report ──
console.log(`G-UPGRADE e2e — ${results.length} checks (2.0.1-era → upgrade → current)\n`);
const byStep = {};
for (const r of results) {
  (byStep[r.step] ??= { total: 0, ok: 0 }).total++;
  if (r.ok) byStep[r.step].ok++;
  console.log(`  [${r.step}] ${r.expectation}: ${r.ok ? "✓" : "✗ FAIL"}  (${r.detail})`);
}
console.log("");
for (const [s, c] of Object.entries(byStep)) console.log(`  ${s.padEnd(16)} ${c.ok}/${c.total}`);

if (fails.length > 0) {
  console.error(`\nG-UPGRADE FAIL: ${fails.length} check(s) — a stale artifact survived the upgrade`);
  for (const f of fails) console.error(`    ✗ [${f.step}] ${f.detail}`);
  process.exit(1);
}
console.log(`\nG-UPGRADE PASS: fresh install byte-identical to templates + upgrade refreshes stale hook/skill to current (P0-NEW1 cannot recur)`);
