#!/usr/bin/env node
/**
 * Dogfood harness for Fabric v2.0 rc.4 doctor --lint + --apply-lint flow (TASK-009).
 *
 * Runs end-to-end against the Fabric self-repo .fabric/ tree:
 *   Phase 0 (pre-state): snapshot agents.meta.json + events.jsonl size
 *   Phase 1 (raw lint): runDoctorReport() — capture 21-check report, baseline findings
 *   Phase 2 (seed fixtures): create 2 synthetic canonical entries to demonstrate
 *     - orphan-demote (stable maturity, created_at backdated 100d, no events)
 *     - stale-archive (draft maturity, created_at backdated 110d, no events)
 *     (Index drift already exists naturally from rc.3 KT-DEC-9001 fallback test.)
 *   Phase 3 (seeded lint): runDoctorReport() — confirm 3 lint candidates surface
 *   Phase 4 (apply-lint): runDoctorApplyLint() — capture mutations + new events
 *   Phase 5 (verify): events.jsonl tail, meta diff, file states
 *   Phase 6 (idempotency): runDoctorApplyLint() again — expect 0 mutations
 *   Phase 7 (final lint): runDoctorReport() — confirm seeded targets cleared
 *
 * Outputs JSON-shaped trace to stdout for capture into dogfood-evidence.md.
 *
 * Note: install verification is performed separately via `fab hooks install`
 * (executed prior to this script). Fixture seed entries persist on disk as
 * forensic evidence per rc.2/rc.3 precedent.
 */

import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  runDoctorReport,
  runDoctorApplyLint,
} from "../packages/server/dist/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const FABRIC_DIR = resolve(REPO_ROOT, ".fabric");
const KNOWLEDGE_DIR = resolve(FABRIC_DIR, "knowledge");
const META_PATH = resolve(FABRIC_DIR, "agents.meta.json");
const EVENTS_PATH = resolve(FABRIC_DIR, "events.jsonl");

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function header(label) {
  process.stdout.write(`\n===== ${label} =====\n`);
}

function dump(label, value) {
  process.stdout.write(`-- ${label}\n`);
  process.stdout.write(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  process.stdout.write("\n");
}

function eventLineCount() {
  if (!existsSync(EVENTS_PATH)) return 0;
  return readFileSync(EVENTS_PATH, "utf8").split("\n").filter((l) => l.length > 0).length;
}

function readMetaCounters() {
  const meta = JSON.parse(readFileSync(META_PATH, "utf8"));
  return meta.counters;
}

function summarizeChecks(report) {
  const findings = report.checks.map((c) => ({
    name: c.name,
    status: c.status,
    code: c.code ?? null,
    kind: c.kind ?? null,
    fixable: c.fixable ?? false,
    message: c.message,
  }));
  return {
    status: report.status,
    total_checks: report.checks.length,
    fixable_error_count: report.fixable_errors.length,
    manual_error_count: report.manual_errors.length,
    warning_count: report.warnings.length,
    info_count: report.infos.length,
    findings,
  };
}

// Append a backdated knowledge_promoted event to events.jsonl. Required because
// rc.3's filesystem-edit-fallback (inspectFilesystemEditFallback) runs BEFORE
// orphan-demote / stale-archive checks; if it sees a canonical entry without
// any matching event, it synthesizes a knowledge_promoted with ts=now, which
// resets lastActiveIndex and prevents the lint check from flagging the entry.
// Seeding a backdated event suppresses the synthesis AND seeds the index.
function appendBackdatedPromotedEvent(stableId, ageDays) {
  const ts = Date.now() - ageDays * MS_PER_DAY;
  const iso = new Date(ts).toISOString();
  const event = {
    kind: "fabric-event",
    id: `event:${randomUUID()}`,
    ts,
    schema_version: 1,
    correlation_id: "rc4-dogfood-fixture",
    session_id: "WFS-rc4-dogfood-2026-05-10",
    event_type: "knowledge_promoted",
    stable_id: stableId,
    timestamp: iso,
    reason: "[fixture] rc.4 dogfood seeded promoted event for lint demonstration",
  };
  appendFileSync(EVENTS_PATH, `${JSON.stringify(event)}\n`, "utf8");
  return { stable_id: stableId, ts, iso, ageDays };
}

// Seed fixture: stable-maturity entry, created_at backdated 100d.
// orphan-demote threshold for stable=90d → 100d > 90d triggers candidate.
function seedOrphanDemoteFixture() {
  const id = "KT-PIT-9101";
  const slug = "rc4-dogfood-orphan-demote-fixture";
  const filename = `${id}--${slug}.md`;
  const dir = resolve(KNOWLEDGE_DIR, "pitfalls");
  mkdirSync(dir, { recursive: true });
  const filepath = resolve(dir, filename);
  const backdate = new Date(Date.now() - 100 * MS_PER_DAY).toISOString();
  const content = `---
id: ${id}
type: pitfalls
maturity: stable
layer: team
created_at: ${backdate}
source_session: WFS-rc4-dogfood-2026-05-10
tags: [dogfood, fixture, rc4]
---

## Summary

Synthetic stable-maturity pitfall seeded as a deliberate fixture for rc.4 dogfood.
Backdated created_at by 100 days exceeds the 90-day stable-tier inactivity
threshold; with no recent events referencing this id, doctor --apply-lint
should demote stable -> endorsed and emit a knowledge_demoted event.

## Evidence

This entry is intentionally synthetic and will NOT be cleaned up post-dogfood;
the demoted-state-on-disk plus the events.jsonl entry together form the audit
trail per rc.2/rc.3 dogfood precedent.
`;
  writeFileSync(filepath, content, "utf8");
  return {
    stable_id: id,
    rel_path: `.fabric/knowledge/pitfalls/${filename}`,
    abs_path: filepath,
    backdated_created_at: backdate,
  };
}

// Seed fixture: draft-maturity entry, created_at backdated 110d.
// stale-archive requires 14d (draft demote) + 90d (additional) = 104d.
// 110d > 104d triggers stale-archive candidate.
function seedStaleArchiveFixture() {
  const id = "KT-PRO-9101";
  const slug = "rc4-dogfood-stale-archive-fixture";
  const filename = `${id}--${slug}.md`;
  const dir = resolve(KNOWLEDGE_DIR, "processes");
  mkdirSync(dir, { recursive: true });
  const filepath = resolve(dir, filename);
  const backdate = new Date(Date.now() - 110 * MS_PER_DAY).toISOString();
  const content = `---
id: ${id}
type: processes
maturity: draft
layer: team
created_at: ${backdate}
source_session: WFS-rc4-dogfood-2026-05-10
tags: [dogfood, fixture, rc4]
---

## Summary

Synthetic draft-maturity process seeded as a deliberate fixture for rc.4 dogfood.
Backdated created_at by 110 days exceeds the draft demote threshold (14d) plus
the additional stale-archive quiet window (90d) = 104d total. With no events
referencing this id, doctor --apply-lint should move this file to
.fabric/.archive/processes/ and emit a knowledge_archived event.

## Evidence

This entry is intentionally synthetic; the archived-state-on-disk plus the
events.jsonl entry together form the audit trail.
`;
  writeFileSync(filepath, content, "utf8");
  return {
    stable_id: id,
    rel_path: `.fabric/knowledge/processes/${filename}`,
    abs_path: filepath,
    backdated_created_at: backdate,
  };
}

function findCheckByCode(report, code) {
  return report.checks.find((c) => c.code === code) ?? null;
}

function readEventsTail(n) {
  if (!existsSync(EVENTS_PATH)) return [];
  const lines = readFileSync(EVENTS_PATH, "utf8").split("\n").filter((l) => l.length > 0);
  return lines.slice(-n);
}

async function main() {
  // ---------- Phase 0: pre-state ----------
  header("PHASE 0: pre-state snapshot");
  const preEventCount = eventLineCount();
  const preCounters = readMetaCounters();
  dump("pre_event_count", preEventCount);
  dump("pre_counters", preCounters);

  // ---------- Phase 1: raw lint ----------
  header("PHASE 1: raw doctor --lint (read-only, baseline)");
  const rawReport = await runDoctorReport(REPO_ROOT);
  dump("raw_lint_summary", summarizeChecks(rawReport));

  // ---------- Phase 2: seed fixtures ----------
  header("PHASE 2: seed orphan-demote + stale-archive fixtures");
  const orphanFixture = seedOrphanDemoteFixture();
  const staleFixture = seedStaleArchiveFixture();
  // Suppress filesystem-edit-fallback by pre-seeding backdated promoted events.
  const orphanEvent = appendBackdatedPromotedEvent(orphanFixture.stable_id, 100);
  const staleEvent = appendBackdatedPromotedEvent(staleFixture.stable_id, 110);
  dump("orphan_demote_fixture", orphanFixture);
  dump("stale_archive_fixture", staleFixture);
  dump("orphan_promoted_event_seeded", orphanEvent);
  dump("stale_promoted_event_seeded", staleEvent);

  // ---------- Phase 3: seeded lint ----------
  header("PHASE 3: seeded doctor --lint (expect 3 lint:* candidates)");
  const seededReport = await runDoctorReport(REPO_ROOT);
  dump("seeded_lint_summary", summarizeChecks(seededReport));
  dump("orphan_demote_check", findCheckByCode(seededReport, "knowledge_orphan_demote_required"));
  dump("stale_archive_check", findCheckByCode(seededReport, "knowledge_stale_archive_required"));
  dump("index_drift_check", findCheckByCode(seededReport, "knowledge_index_drift"));

  // ---------- Phase 4: apply-lint mutation pass ----------
  header("PHASE 4: doctor --apply-lint (mutations)");
  const applyReport = await runDoctorApplyLint(REPO_ROOT);
  dump("apply_lint_message", applyReport.message);
  dump("apply_lint_aborted", applyReport.aborted);
  dump("apply_lint_changed", applyReport.changed);
  dump("apply_lint_mutations", applyReport.mutations);
  dump("apply_lint_manual_errors_remaining", applyReport.manual_errors);

  // ---------- Phase 5: verify on-disk state ----------
  header("PHASE 5: verify mutations on disk");
  const postEventCount = eventLineCount();
  const postCounters = readMetaCounters();
  // Pre-state had `preEventCount` events; we then seeded 2 backdated
  // knowledge_promoted fixture events (Phase 2), then ran apply-lint which
  // appends knowledge_demoted + knowledge_archived events (Phase 4). The
  // events strictly produced by apply-lint = postEventCount - preEventCount - 2.
  const seededEventCount = 2;
  const applyLintEventCount = postEventCount - preEventCount - seededEventCount;
  // Tail enough lines to cover everything appended after preEventCount.
  const tailEvents = readEventsTail(postEventCount - preEventCount).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return { _raw: l, _parse_error: true };
    }
  });
  const demotedEvents = tailEvents.filter((e) => e.event_type === "knowledge_demoted");
  const archivedEvents = tailEvents.filter((e) => e.event_type === "knowledge_archived");
  dump("post_event_count", postEventCount);
  dump("seeded_event_count", seededEventCount);
  dump("apply_lint_event_count", applyLintEventCount);
  dump("post_counters", postCounters);
  dump("counter_delta_KT_DEC", `${preCounters.KT.DEC} -> ${postCounters.KT.DEC}`);
  dump("knowledge_demoted_events", demotedEvents);
  dump("knowledge_archived_events", archivedEvents);

  // Verify orphan-demote: file frontmatter maturity changed from stable -> endorsed
  if (existsSync(orphanFixture.abs_path)) {
    const mutated = readFileSync(orphanFixture.abs_path, "utf8");
    const fm = mutated.match(/^---\n([\s\S]*?)\n---/u);
    dump("orphan_fixture_frontmatter_post", fm ? fm[1] : "<no frontmatter>");
  } else {
    dump("orphan_fixture_status", "FILE MISSING (unexpected)");
  }

  // Verify stale-archive: file moved from knowledge/processes/ to .fabric/.archive/processes/
  const archiveAbsPath = resolve(
    REPO_ROOT,
    ".fabric",
    ".archive",
    "processes",
    `${staleFixture.stable_id}--rc4-dogfood-stale-archive-fixture.md`,
  );
  dump("stale_fixture_original_exists", existsSync(staleFixture.abs_path));
  dump("stale_fixture_archived_exists", existsSync(archiveAbsPath));
  dump("stale_fixture_archive_path", archiveAbsPath.replace(REPO_ROOT, ""));

  // ---------- Phase 6: idempotency ----------
  header("PHASE 6: idempotency — second --apply-lint should be no-op");
  const secondApply = await runDoctorApplyLint(REPO_ROOT);
  dump("second_apply_message", secondApply.message);
  dump("second_apply_changed", secondApply.changed);
  dump("second_apply_mutations_count", secondApply.mutations.length);
  dump("second_apply_mutations", secondApply.mutations);

  // ---------- Phase 7: final lint ----------
  header("PHASE 7: final doctor --lint (post-mutation state)");
  const finalReport = await runDoctorReport(REPO_ROOT);
  dump("final_lint_summary", summarizeChecks(finalReport));
  dump("final_orphan_demote_check", findCheckByCode(finalReport, "knowledge_orphan_demote_required"));
  dump("final_stale_archive_check", findCheckByCode(finalReport, "knowledge_stale_archive_required"));
  dump("final_index_drift_check", findCheckByCode(finalReport, "knowledge_index_drift"));

  // ---------- Phase 8: install verification ----------
  header("PHASE 8: install verification (fabric-import skill present?)");
  const installCheck = {
    claude_skill: existsSync(resolve(REPO_ROOT, ".claude/skills/fabric-import/SKILL.md")),
    codex_skill: existsSync(resolve(REPO_ROOT, ".codex/skills/fabric-import/SKILL.md")),
    pointer_in_agents_md: readFileSync(resolve(REPO_ROOT, "AGENTS.md"), "utf8").includes(
      "fabric-import",
    ),
  };
  dump("install_verification", installCheck);

  header("DONE");
}

main().catch((err) => {
  process.stderr.write(`dogfood-rc4-doctor failed: ${err?.stack ?? err}\n`);
  process.exit(1);
});
