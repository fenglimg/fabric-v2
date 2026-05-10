#!/usr/bin/env node
/**
 * Dogfood harness for Fabric v2.0 rc.3 fab_review flow (TASK-008).
 *
 * Runs end-to-end against the Fabric self-repo's live .fabric/knowledge/pending/
 * entries (the 3 created in rc.2 dogfood, commit baecd5d):
 *   - decisions/rc2-single-cjs-hook-across-clients.md
 *   - pitfalls/codex-hook-config-is-json-not-toml.md
 *   - guidelines/deepmerge-array-append-paths-for-stop-ho.md
 *
 * Step A list -> Step B approve (decision)
 *               -> Step C approve+layer-flip team->personal (pitfall, FABRIC_HOME redirected)
 *               -> Step D reject (guideline)
 *               -> Step E search (type=decisions)
 *               -> Step F filesystem-edit fallback (manual canonical file + doctor x2)
 *
 * Outputs JSON-shaped trace to stdout for capture into dogfood-evidence.md.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { reviewKnowledge, runDoctorReport } from "../packages/server/dist/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

// Personal-layer redirect for safe layer-flip dogfood. Lives at repo root so
// dogfood evidence can capture its contents post-run; cleaned up at script exit
// unless KEEP_PERSONAL_TMP=1.
const PERSONAL_TMP = resolve(REPO_ROOT, ".fabric-personal-dogfood-tmp");

function header(label) {
  process.stdout.write(`\n===== ${label} =====\n`);
}

function dump(label, value) {
  process.stdout.write(`-- ${label}\n`);
  process.stdout.write(JSON.stringify(value, null, 2));
  process.stdout.write("\n");
}

async function main() {
  // Ensure FABRIC_HOME redirect for personal layer is in effect BEFORE any
  // reviewKnowledge call (resolvePersonalRoot reads process.env.FABRIC_HOME).
  // The personal-layer write occurs inside step C only; the redirect is
  // harmless for the team-layer steps (they use projectRoot, not FABRIC_HOME).
  process.env.FABRIC_HOME = PERSONAL_TMP;
  if (!existsSync(PERSONAL_TMP)) {
    mkdirSync(PERSONAL_TMP, { recursive: true });
  }

  // ---------- Step A: list ----------
  header("STEP A: list pending");
  const listResult = await reviewKnowledge(REPO_ROOT, { action: "list", filters: {} });
  dump("list result", listResult);

  // ---------- Step B: approve decision ----------
  header("STEP B: approve decision (team)");
  const decisionPending = ".fabric/knowledge/pending/decisions/rc2-single-cjs-hook-across-clients.md";
  const approveDecision = await reviewKnowledge(REPO_ROOT, {
    action: "approve",
    pending_paths: [decisionPending],
  });
  dump("approve decision result", approveDecision);

  // ---------- Step C: approve pitfall, then layer-flip team -> personal ----------
  header("STEP C: approve pitfall then layer-flip team -> personal");
  const pitfallPending = ".fabric/knowledge/pending/pitfalls/codex-hook-config-is-json-not-toml.md";
  const approvePitfall = await reviewKnowledge(REPO_ROOT, {
    action: "approve",
    pending_paths: [pitfallPending],
  });
  dump("approve pitfall result", approvePitfall);

  // Resolve the canonical team path produced by the approve. The schema field
  // is `pending_path` (overloaded for canonical paths post-approve).
  const teamPitfallId = approvePitfall.approved[0]?.stable_id;
  if (!teamPitfallId) {
    throw new Error("approve pitfall did not return a stable_id");
  }
  const teamPitfallCanonical = `.fabric/knowledge/pitfalls/${teamPitfallId}--codex-hook-config-is-json-not-toml.md`;
  if (!existsSync(resolve(REPO_ROOT, teamPitfallCanonical))) {
    // Best-effort: layer flip resolver derives slug from filename; if the
    // canonical name was different, list a directory hint and fail loudly.
    throw new Error(`expected canonical file missing: ${teamPitfallCanonical}`);
  }

  const flipResult = await reviewKnowledge(REPO_ROOT, {
    action: "modify",
    pending_path: teamPitfallCanonical,
    changes: { layer: "personal" },
  });
  dump("layer-flip result", flipResult);

  // ---------- Step D: reject guideline ----------
  header("STEP D: reject guideline");
  const guidelinePending = ".fabric/knowledge/pending/guidelines/deepmerge-array-append-paths-for-stop-ho.md";
  const rejectResult = await reviewKnowledge(REPO_ROOT, {
    action: "reject",
    pending_paths: [guidelinePending],
    reason: "too narrow scope; covered by data-schema.md",
  });
  dump("reject result", rejectResult);

  // ---------- Step E: search type=decisions ----------
  header("STEP E: search query='rc2' filter type=decisions");
  const searchResult = await reviewKnowledge(REPO_ROOT, {
    action: "search",
    query: "rc2",
    filters: { type: "decisions" },
  });
  dump("search result", searchResult);

  // ---------- Step F: filesystem-edit fallback ----------
  header("STEP F: filesystem-edit fallback");
  const manualSlug = "manual-rc3-fallback-test";
  const manualId = "KT-DEC-9001";
  const manualRel = `.fabric/knowledge/decisions/${manualId}--${manualSlug}.md`;
  const manualAbs = resolve(REPO_ROOT, manualRel);
  const manualContent = `---
id: ${manualId}
type: decisions
maturity: draft
layer: team
created_at: ${new Date().toISOString()}
source_session: WFS-rc3-dogfood-2026-05-10
tags: [dogfood, fallback]
---

## Summary

Synthetic decision file created via direct filesystem write (no fab_review approve)
to exercise rc.3 doctor's filesystem-edit fallback. Doctor should detect this
orphan and synthesize a knowledge_promoted event with reason
'[synthesized] filesystem-edit-fallback'. A second doctor run should be a no-op.

## Evidence

This entry is intentionally synthetic and may be removed by future cleanup.
`;
  mkdirSync(dirname(manualAbs), { recursive: true });
  writeFileSync(manualAbs, manualContent, "utf8");
  process.stdout.write(`manual write: ${manualRel}\n`);

  // Doctor run #1 — expect synthesized event to be appended.
  const report1 = await runDoctorReport(REPO_ROOT);
  const synthCheck1 = report1.checks.find((c) => c.code === "knowledge_promoted_synthesized");
  dump("doctor #1 filesystem-edit-fallback check", synthCheck1 ?? "<no synth check; report check name match failed>");

  // Doctor run #2 — should be idempotent (no new synthesis for the same id).
  const report2 = await runDoctorReport(REPO_ROOT);
  const synthCheck2 = report2.checks.find((c) => c.code === "knowledge_promoted_synthesized");
  dump("doctor #2 filesystem-edit-fallback check", synthCheck2 ?? "<no synth check; idempotent>");

  // ---------- Cleanup hint ----------
  header("CLEANUP HINT");
  process.stdout.write(
    `Personal-layer dogfood files at: ${PERSONAL_TMP}\n` +
    `Set KEEP_PERSONAL_TMP=1 to retain; default behavior preserves the dir for evidence capture.\n` +
    `(rm -rf "${PERSONAL_TMP}" after evidence committed if desired.)\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`dogfood-rc3-review failed: ${err?.stack ?? err}\n`);
  process.exit(1);
});
