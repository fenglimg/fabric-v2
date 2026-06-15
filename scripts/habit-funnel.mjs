#!/usr/bin/env node
// habit-funnel.mjs — G-HABIT: activation-funnel baseline over REAL dogfood telemetry.
//
// The soft gate asks whether the knowledge habit loop is ALIVE (non-zero, over a
// floor) — not whether it hits an aspirational percentage (追高 is out of scope).
// It measures the activation funnel from .fabric/events.jsonl:
//
//   surface  → hook_surface_emitted        (KB pushed to the AI on session/edit)
//   plan     → knowledge_context_planned   (recall planned a candidate set)
//   consume  → knowledge_consumed          (AI actually fetched KB bodies = 翻库率)
//   select   → knowledge_selection         (AI picked specific entries)
//   fetch    → knowledge_sections_fetched  (two-step body fetch)
//   edit     → file_mutated / edit_intent_checked (work happened against KB)
//   archive  → cite_policy_activated        (cite/archive policy engaged)
//
// Floor: the two load-bearing stages (surface, consume) must be > 0 — i.e. KB is
// both pushed AND pulled. A zero there means the habit loop is dead, not merely
// low. Writes the baseline JSON so future runs can detect regression below floor.
//
// codex caveat: this measures cc dogfood telemetry. A codex session that cannot
// drive the funnel is degraded with explicit accounting (not a blocker — soft gate).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO = process.cwd();
const eventsPath = join(REPO, ".fabric", "events.jsonl");

const counts = {};
if (existsSync(eventsPath)) {
  for (const line of readFileSync(eventsPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      counts[row.event_type] = (counts[row.event_type] || 0) + 1;
    } catch {
      /* skip malformed */
    }
  }
}

const funnel = {
  surface: counts.hook_surface_emitted || 0,
  plan: counts.knowledge_context_planned || 0,
  consume: counts.knowledge_consumed || 0,
  select: counts.knowledge_selection || 0,
  fetch: counts.knowledge_sections_fetched || 0,
  edit: counts.file_mutated || 0,
  edit_intent: counts.edit_intent_checked || 0,
  archive_policy: counts.cite_policy_activated || 0,
  sessions: counts.session_ended || 0,
};

// 翻库率 proxy: consumed / surfaced (how much pushed KB the AI actually pulled).
const recallHitRate = funnel.surface > 0 ? +(funnel.consume / funnel.surface).toFixed(2) : null;

// Floor: the load-bearing stages must be alive.
const FLOOR = { surface: 1, consume: 1 };
const belowFloor = Object.entries(FLOOR).filter(([k, min]) => funnel[k] < min);

const baseline = {
  gate: "G-HABIT",
  generated_by: "habit-funnel.mjs",
  source: ".fabric/events.jsonl (cc dogfood)",
  funnel,
  recall_hit_rate_consume_over_surface: recallHitRate,
  floor: FLOOR,
  floor_status: belowFloor.length === 0 ? "pass" : "below-floor",
  nonzero_stages: Object.values(funnel).filter((v) => v > 0).length,
  total_stages: Object.keys(funnel).length,
  codex_note: "cc dogfood only; codex behavioural funnel deferred (soft gate, explicit degrade — not blocking)",
};

const OUT = ".workflow/.maestro/20260615-release-eval-22/.scratchpad/g-habit-baseline.json";
writeFileSync(join(REPO, OUT), JSON.stringify(baseline, null, 2));

console.log(`G-HABIT activation funnel — real dogfood baseline\n`);
for (const [stage, n] of Object.entries(funnel)) {
  console.log(`  ${stage.padEnd(14)} ${n}`);
}
console.log(`\n  翻库率 (consume/surface):       ${recallHitRate}`);
console.log(`  non-zero stages:               ${baseline.nonzero_stages}/${baseline.total_stages}`);
console.log(`  floor (surface≥1, consume≥1):  ${baseline.floor_status}`);
console.log(`  baseline → ${OUT}`);

if (belowFloor.length > 0) {
  console.error(`\nG-HABIT FAIL: habit loop below floor — ${belowFloor.map(([k]) => k).join(", ")} == 0 (knowledge loop dead)`);
  process.exit(1);
}
console.log(`\nG-HABIT PASS: activation funnel alive — KB pushed (${funnel.surface}) AND pulled (${funnel.consume}), all ${baseline.nonzero_stages} stages non-zero (cc dogfood; codex deferred)`);
