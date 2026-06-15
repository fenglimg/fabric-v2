#!/usr/bin/env node
// surface-census.mjs — G-CENSUS deterministic surface derivation + wiring/observability map.
//
// Derives the full eval surface inventory from REAL declaration sources via the
// shared lib/surface-derive.mjs (CLI allCommands / MCP registerTool / skill
// templates / hook templates), so it cannot rot silently.
//
// For each surface: wired (impl artifact exists & non-trivial) + observable (a
// live telemetry producer attributable to the surface emits a usage event).
//
// G-CENSUS hard criterion: ZERO unwired shells. Observability gaps are NOT
// re-blocked here — they are the G-OBSERV concern, already adjudicated under
// ADJ-1 (recommendation B = degrade, behavioural telemetry deferred to 2.3).
// Recorded honestly so the degrade is grounded, not asserted.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, deriveSurfaces } from "./lib/surface-derive.mjs";

const rows = deriveSurfaces();
const unwired = rows.filter((r) => !r.wired);
const unobservable = rows.filter((r) => r.wired && !r.observable);

const byClass = {};
for (const r of rows) {
  const c = (byClass[r.surface] ??= { total: 0, wired: 0, observable: 0 });
  c.total++;
  if (r.wired) c.wired++;
  if (r.observable) c.observable++;
}

const scorecard = {
  generated_by: "surface-census.mjs",
  gate: "G-CENSUS",
  summary: {
    total_surfaces: rows.length,
    unwired_shells: unwired.length,
    observable: rows.filter((r) => r.observable).length,
    unobservable_wired: unobservable.length,
    by_class: byClass,
  },
  // Honest degrade record: wired surfaces with no usage telemetry, cross-ref ADJ-1.
  observability_gap: {
    cross_ref: "ADJ-1 (G-OBSERV / F3) — behavioural telemetry deferred to 2.3, recommendation B=degrade",
    surfaces: unobservable.map((r) => `${r.surface}:${r.name}`),
  },
  surfaces: rows,
};

const OUT = ".workflow/.maestro/20260615-release-eval-22/.scratchpad/g-census-scorecard.json";
writeFileSync(join(ROOT, OUT), JSON.stringify(scorecard, null, 2));

console.log(`G-CENSUS surface census — ${rows.length} surfaces from live registries`);
for (const [cls, c] of Object.entries(byClass)) {
  console.log(`  ${cls.padEnd(6)} total=${c.total} wired=${c.wired} observable=${c.observable}`);
}
console.log(`  unwired shells: ${unwired.length}`);
for (const r of unwired) console.log(`    ✗ ${r.surface}:${r.name} (${r.impl})`);
console.log(`  wired-but-unobservable: ${unobservable.length} → ${scorecard.observability_gap.cross_ref}`);
console.log(`  scorecard → ${OUT}`);

if (unwired.length > 0) {
  console.error(`\nG-CENSUS FAIL: ${unwired.length} unwired shell(s) — registered surface with no real impl`);
  process.exit(1);
}
console.log(`\nG-CENSUS PASS: zero unwired shells; observability gaps recorded (ADJ-1 degrade)`);
