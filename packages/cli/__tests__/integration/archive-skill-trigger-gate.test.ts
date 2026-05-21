/**
 * v2.0.0-rc.25 TASK-11 — archive-skill Phase 0.4 trigger-gate documentation
 * tests.
 *
 * `SKILL.md` is an LLM-driven markdown spec — there is no executable code
 * path to invoke for the gate. TASK-11's `implementation[6]` calls out the
 * fallback strategy used here: validate the SKILL.md DOCUMENT itself
 * contains the required gate-logic markers for each of the 5 entry-points.
 * This is the deliberately-conservative choice from the trade-off table:
 *   - rejected: spawn a Claude Code session per entry_point (brittle, slow)
 *   - rejected: omit the test surface entirely (TASK-12 dogfood is not
 *     reproducible in CI)
 *   - chosen: grep + parse the markdown — fast, deterministic, and locks
 *     in the load-bearing entry-point detection contract
 *
 * The 5 entry points and the markers that MUST be present per
 * planning-context.md Q3.6 + SKILL.md `Phase 0.4 Trigger Gate (rc.25 —
 * entry-context aware)`:
 *
 *   E1 hook_passive          → references stdout JSON `{decision:'block'}`
 *                              from archive-hint.cjs
 *   E2 explicit_user_invoke  → recognises `fabric archive` /
 *                              `/fabric-archive` direct invocations
 *   E3 ai_self_trigger       → recognises self-archive policy marker
 *   E4 user_range_rollback   → recognises Phase -0.5 parsed range hint +
 *                              user invoking
 *   E5 cron                  → recognises `今日复盘` / `daily recap` +
 *                              no human present
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// v2.0.0-rc.28 TASK-01 (audit §3.1): the Phase 0.4 trigger-gate doc moved
// out of SKILL.md (~1343 lines) into ref/phase-0-4-onboard.md. The gate
// contract — entry-point detection table + SKIP/PROCEED decision per entry
// type — is unchanged; only its file location did. The skill loader still
// surfaces a hot-path pointer in SKILL.md; this test pins the gate region
// at the new authoritative location.
const SKILL_MD_PATH = fileURLToPath(
  new URL(
    "../../templates/skills/fabric-archive/ref/phase-0-4-onboard.md",
    import.meta.url,
  ),
);

const SKILL_MD = readFileSync(SKILL_MD_PATH, "utf8");

/**
 * Extract the Phase 0.4 Trigger Gate region (`#### Phase 0.4 Trigger Gate`
 * heading through the next `####` or `###` heading). Lets each test
 * narrow the haystack to the gate-specific block so unrelated SKILL.md
 * edits cannot accidentally satisfy a marker check.
 */
function extractGateRegion(): string {
  // v2.0.0-rc.28: gate-region heading kept as `####` for byte-identity with
  // the pre-split content; the new file just has the gate region a level
  // deeper than the file's top-level heading.
  const startMarker = "#### Phase 0.4 Trigger Gate";
  const startIdx = SKILL_MD.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error(
      "ref/phase-0-4-onboard.md is missing 'Phase 0.4 Trigger Gate' heading — rc.28 TASK-01 split may have regressed",
    );
  }
  // Find the next major heading (### or ####) AFTER the start marker.
  // The detection table + gate decision + rationale + worked-example
  // sub-headings (##### …) all belong to the gate region; we stop at
  // the next #### or ### that closes the section.
  const tail = SKILL_MD.slice(startIdx + startMarker.length);
  const nextSectionMatch = tail.match(/\n#{1,4} (?!##### )/);
  const endIdx = nextSectionMatch ? nextSectionMatch.index : tail.length;
  return SKILL_MD.slice(startIdx, startIdx + startMarker.length + (endIdx ?? tail.length));
}

const GATE_REGION = extractGateRegion();

describe("TASK-11 SKILL.md Phase 0.4 trigger-gate — entry-point detection", () => {
  it("Phase 0.4 Trigger Gate section exists in SKILL.md", () => {
    expect(SKILL_MD).toContain("#### Phase 0.4 Trigger Gate");
    expect(GATE_REGION.length).toBeGreaterThan(200);
  });

  it("E1 hook_passive: gate documents stdout JSON {decision:'block'} from archive-hint.cjs", () => {
    // E1 detection rule must reference the hook stdout payload shape so an
    // LLM reader knows to inspect it. Both substrings must appear in the
    // same region so the wording is unambiguous.
    expect(GATE_REGION).toMatch(/E1/);
    expect(GATE_REGION).toMatch(/hook_passive/);
    expect(GATE_REGION).toMatch(/decision['"]?:\s*['"]block['"]/);
    expect(GATE_REGION).toMatch(/archive-hint\.cjs/);
    // Gate decision MUST classify E1 as SKIP.
    expect(GATE_REGION).toMatch(/E1[\s\S]{0,200}SKIP|SKIP[\s\S]{0,200}E1/);
  });

  it("E2 explicit_user_invoke: gate documents `fabric archive` / `/fabric-archive` direct-invocation phrases", () => {
    expect(GATE_REGION).toMatch(/E2/);
    expect(GATE_REGION).toMatch(/explicit_user_invoke/);
    expect(GATE_REGION).toMatch(/fabric archive/);
    expect(GATE_REGION).toMatch(/\/fabric-archive/);
    // Gate decision MUST classify E2 as PROCEED.
    expect(GATE_REGION).toMatch(/E2[\s\S]{0,200}PROCEED|PROCEED[\s\S]{0,200}E2/);
  });

  it("E3 ai_self_trigger: gate documents self-archive policy marker", () => {
    expect(GATE_REGION).toMatch(/E3/);
    expect(GATE_REGION).toMatch(/ai_self_trigger/);
    // The detection rule cites the AGENTS.md self-trigger signals; both
    // "self-archive policy" and a reference to the AGENTS.md source MUST
    // be visible so the contract stays traceable.
    expect(GATE_REGION).toMatch(/self-archive policy/);
    expect(GATE_REGION).toMatch(/AGENTS\.md/);
    // Gate decision MUST classify E3 as SKIP.
    expect(GATE_REGION).toMatch(/E3[\s\S]{0,200}SKIP|SKIP[\s\S]{0,300}E3/);
  });

  it("E4 user_range_rollback: gate documents Phase -0.5 parsed range hint + user invoking", () => {
    expect(GATE_REGION).toMatch(/E4/);
    expect(GATE_REGION).toMatch(/user_range_rollback/);
    expect(GATE_REGION).toMatch(/Phase -0\.5/);
    // The detection rule must mention BOTH "range hint" and "user" so the
    // condition stays AND-shaped (range alone is not enough; cron also
    // carries a range hint).
    expect(GATE_REGION).toMatch(/range hint/);
    expect(GATE_REGION).toMatch(/user is invoking|user invoking|the user is invoking/);
    // Gate decision MUST classify E4 as PROCEED.
    expect(GATE_REGION).toMatch(/E4[\s\S]{0,200}PROCEED|PROCEED[\s\S]{0,200}E4/);
  });

  it("E5 cron: gate documents 今日复盘 / daily recap literal + no-human marker", () => {
    expect(GATE_REGION).toMatch(/E5/);
    expect(GATE_REGION).toMatch(/cron/);
    expect(GATE_REGION).toMatch(/今日复盘/);
    expect(GATE_REGION).toMatch(/daily recap/);
    // No-human / cron context MUST be present so the rule does not fire
    // for an interactive user who happens to type "today" or "daily".
    expect(GATE_REGION).toMatch(/no human|no live user|cron|\/loop/);
    // Gate decision MUST classify E5 as SKIP.
    expect(GATE_REGION).toMatch(/E5[\s\S]{0,200}SKIP|SKIP[\s\S]{0,300}E5/);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting contract — the gate decision pseudo-code must explicitly
// list which entries proceed and which skip, in the canonical 2-vs-3 split.
// ---------------------------------------------------------------------------

describe("TASK-11 SKILL.md Phase 0.4 trigger-gate — canonical 2v3 split", () => {
  it("PROCEED set is exactly {E2, E4} and SKIP set is exactly {E1, E3, E5}", () => {
    // The pseudo-code block uses set-membership notation. Both lines
    // MUST be present verbatim so an LLM reader applying the gate cannot
    // get the partitioning wrong.
    expect(GATE_REGION).toMatch(
      /entry_point\s*∈\s*\{[^}]*E2[^}]*E4[^}]*\}/,
    );
    // E1/E3/E5 are documented as the SKIP set either via ∈ {…} or as
    // an explicit ELSE branch listing all three.
    expect(GATE_REGION).toMatch(/E1[^|]*\|[^|]*E3[^|]*\|[^|]*E5|\{E1[^}]*E3[^}]*E5\}/);
  });
});
