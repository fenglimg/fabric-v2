#!/usr/bin/env node
// self-audit.mjs — G-SELFAUDIT anti-rot guard.
//
// The resident eval set must not quietly fall out of date as the product grows.
// This script re-derives the live surface registry (same lib as the census) and
// diffs it against the committed scorecard. If a live surface has no scorecard
// row — i.e. a command/tool/skill/hook was added but the census was never
// regenerated — the eval set lights itself RED (non-zero exit).
//
// Also flags the reverse (a scorecard row whose surface no longer exists), which
// means a surface was removed without refreshing the scorecard.
//
// Run after surface-census.mjs. Exit non-zero on any drift.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, deriveSurfaces } from "./lib/surface-derive.mjs";

const SCORECARD = ".workflow/.maestro/20260615-release-eval-22/.scratchpad/g-census-scorecard.json";
const scPath = join(ROOT, SCORECARD);

if (!existsSync(scPath)) {
  console.error(`G-SELFAUDIT FAIL: scorecard missing (${SCORECARD}) — run surface-census.mjs first`);
  process.exit(1);
}

const scorecard = JSON.parse(readFileSync(scPath, "utf8"));
const live = deriveSurfaces();

const key = (r) => `${r.surface}:${r.name}`;
const liveKeys = new Set(live.map(key));
const cardKeys = new Set(scorecard.surfaces.map(key));

// Live surface with no scorecard row → eval set is stale (under-covered).
const missingRows = [...liveKeys].filter((k) => !cardKeys.has(k));
// Scorecard row with no live surface → surface removed, scorecard stale (over-covered).
const orphanRows = [...cardKeys].filter((k) => !liveKeys.has(k));

// A wired surface whose scorecard row claims unwired (or vice-versa) → drift in fact.
const wiringDrift = [];
for (const r of live) {
  const card = scorecard.surfaces.find((s) => key(s) === key(r));
  if (card && card.wired !== r.wired) {
    wiringDrift.push(`${key(r)}: live.wired=${r.wired} scorecard.wired=${card.wired}`);
  }
}

console.log(`G-SELFAUDIT — registry vs scorecard diff`);
console.log(`  live surfaces:      ${live.length}`);
console.log(`  scorecard rows:     ${scorecard.surfaces.length}`);
console.log(`  missing rows (live not in scorecard):  ${missingRows.length}`);
for (const k of missingRows) console.log(`    ✗ ${k} — surface added, scorecard not regenerated`);
console.log(`  orphan rows (scorecard not in live):   ${orphanRows.length}`);
for (const k of orphanRows) console.log(`    ✗ ${k} — surface removed, scorecard stale`);
console.log(`  wiring drift:       ${wiringDrift.length}`);
for (const d of wiringDrift) console.log(`    ✗ ${d}`);

const drift = missingRows.length + orphanRows.length + wiringDrift.length;
if (drift > 0) {
  console.error(`\nG-SELFAUDIT FAIL: ${drift} drift item(s) — eval scorecard out of sync with live registry`);
  process.exit(1);
}
console.log(`\nG-SELFAUDIT PASS: scorecard covers every live surface, no orphans, no wiring drift`);
