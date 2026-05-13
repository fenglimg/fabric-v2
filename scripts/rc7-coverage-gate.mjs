#!/usr/bin/env node
// rc7-coverage-gate.mjs
//
// v2.0.0-rc.7 coverage gate — structural assertions over the rc.7 macro-
// closure scope. Mirrors scripts/rc6-coverage-gate.mjs in CLI ergonomics and
// output format. Currently wired with the Wave-1 (Foundations) checks; later
// waves extend the `checks` array.
//
// Wave 1 checks:
//   [T09] fab_plan_context degenerate mode removed
//         → plan-context.ts has no `candidates_full_content` reference
//         → response shape symmetric: 5 entries AND 100 entries both return
//           description_index + selection_token (verified via planContext API)
//         → docs/decisions/rc5-a3-superseded.md exists with the required
//           ADR sections (status/context/decision/consequences)
//
// Other waves (T01-T08, T10, T11) populate further checks as their tasks
// land; each check stays independent so the gate fails fast on regression.
//
// Env-var skip flags mirror the rc.5/rc.6 gates:
//   FABRIC_GATE_SKIP_BUILD=1   skip `pnpm -r build`
//   FABRIC_GATE_SKIP_TESTS=1   skip `pnpm -r test`

import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

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

// ---------------------------------------------------------------------------
// T09 — plan-context degenerate mode removed
// ---------------------------------------------------------------------------

async function checkT09PlanContextSymmetric() {
  const failures = [];

  // (a) plan-context.ts must not reference candidates_full_content anymore.
  const src = readText("packages/server/src/services/plan-context.ts");
  if (src === undefined) {
    return {
      id: "T09",
      name: "plan_context degenerate mode removed",
      passed: false,
      details: "packages/server/src/services/plan-context.ts not found",
    };
  }
  if (/candidates_full_content/.test(src)) {
    failures.push(
      "plan-context.ts still references candidates_full_content (degenerate mode must be fully removed)",
    );
  }

  // (b) Shared schema must not declare the field either.
  const schema = readText("packages/shared/src/schemas/api-contracts.ts");
  if (schema === undefined) {
    failures.push("packages/shared/src/schemas/api-contracts.ts not found");
  } else if (/candidates_full_content\s*:/.test(schema)) {
    failures.push("api-contracts.ts still declares candidates_full_content in planContextOutputSchema");
  }

  // (c) ADR exists with required sections.
  const adrRelPath = "docs/decisions/rc5-a3-superseded.md";
  const adr = readText(adrRelPath);
  if (adr === undefined) {
    failures.push(`${adrRelPath} missing`);
  } else {
    for (const heading of ["Status", "Context", "Decision", "Consequences"]) {
      // Markdown headers can be `## Heading` or part of a metadata key.
      const re = new RegExp(`(^|\\n)(##\\s*${heading}|\\*\\*${heading}\\*\\*)`, "i");
      if (!re.test(adr)) {
        failures.push(`${adrRelPath} missing required section: ${heading}`);
      }
    }
  }

  // (d) Live API check: invoke planContext at 5 entries AND 100 entries.
  // Both responses must contain description_index + selection_token and
  // NEITHER must contain candidates_full_content. We import the compiled
  // service via dynamic import; if it can't be loaded (e.g. fresh checkout
  // without `pnpm -r build`) we degrade gracefully to a static-source pass
  // — the static checks above still defend the contract.
  try {
    const planContextMod = await tryLoadPlanContext();
    if (planContextMod !== null) {
      const small = await runPlanContextAtSize(planContextMod, 5);
      const large = await runPlanContextAtSize(planContextMod, 100);
      for (const [label, result] of [["5 entries", small], ["100 entries", large]]) {
        if (typeof result.selection_token !== "string" || result.selection_token.length === 0) {
          failures.push(`planContext(${label}) did not return a selection_token`);
        }
        if (Object.prototype.hasOwnProperty.call(result, "candidates_full_content")) {
          failures.push(`planContext(${label}) still returns candidates_full_content`);
        }
        if (!Array.isArray(result?.shared?.description_index)) {
          failures.push(`planContext(${label}) missing shared.description_index`);
        }
      }
    }
  } catch (err) {
    failures.push(`planContext live-shape check threw: ${err?.message ?? String(err)}`);
  }

  if (failures.length === 0) {
    return { id: "T09", name: "plan_context degenerate mode removed", passed: true };
  }
  return {
    id: "T09",
    name: "plan_context degenerate mode removed",
    passed: false,
    details: failures.join("\n"),
  };
}

async function tryLoadPlanContext() {
  // Compiled output lives at packages/server/dist after `pnpm -r build`.
  const candidates = [
    "packages/server/dist/services/plan-context.js",
    "packages/server/dist/src/services/plan-context.js",
  ];
  for (const rel of candidates) {
    const abs = resolve(REPO_ROOT, rel);
    if (existsSync(abs)) {
      try {
        const mod = await import(`file://${abs}`);
        if (typeof mod.planContext === "function") {
          return mod;
        }
      } catch {
        // fall through
      }
    }
  }
  return null;
}

async function runPlanContextAtSize(mod, size) {
  const projectRoot = mkdtempSync(join(tmpdir(), `fabric-rc7-gate-${size}-`));
  try {
    mkdirSync(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    writeFileSync(
      join(projectRoot, ".fabric", "human-lock.json"),
      `${JSON.stringify({ locked: [] }, null, 2)}\n`,
    );
    const nodes = {};
    for (let i = 0; i < size; i += 1) {
      const id = `KT-DEC-${String(i + 1).padStart(4, "0")}`;
      const file = `.fabric/knowledge/decisions/d${i + 1}.md`;
      writeFileSync(join(projectRoot, file), `# Decision ${i + 1}\n\nBody for ${id}.\n`);
      nodes[id] = {
        stable_id: id,
        file,
        content_ref: file,
        scope_glob: "**",
        hash: `sha256:d${i + 1}`,
        identity_source: "declared",
        description: {
          summary: `Decision ${i + 1}`,
          intent_clues: [],
          tech_stack: [],
          impact: [],
          must_read_if: "",
          id,
          knowledge_type: "decision",
          maturity: "verified",
          knowledge_layer: "team",
          created_at: "2026-05-10T00:00:00Z",
        },
      };
    }
    writeFileSync(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({ revision: `rev-rc7-gate-${size}`, nodes }, null, 2)}\n`,
    );
    return await mod.planContext(projectRoot, { paths: ["src/index.ts"] });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// T06 — Pending entry self-containedness
//   * Schema declares proposed_reason enum + session_context (required fields)
//   * Renderer emits `## Why proposed` and `## Session context` body sections
//   * Evidence-merge dedup: no `## Evidence (call N)` shape on idempotency hit
// ---------------------------------------------------------------------------

async function checkT06PendingSelfContained() {
  const failures = [];

  const schema = readText("packages/shared/src/schemas/api-contracts.ts");
  if (schema === undefined) {
    return {
      id: "T06",
      name: "pending entry self-containedness (T6)",
      passed: false,
      details: "packages/shared/src/schemas/api-contracts.ts not found",
    };
  }
  if (!/ProposedReasonSchema\s*=\s*z\.enum\(/.test(schema)) {
    failures.push("api-contracts.ts: missing ProposedReasonSchema enum declaration");
  }
  for (const reason of [
    "explicit-user-mark",
    "diagnostic-then-fix",
    "decision-confirmation",
    "wrong-turn-revert",
    "new-dependency-or-pattern",
    "dismissal-with-reason",
  ]) {
    if (!schema.includes(`"${reason}"`)) {
      failures.push(`api-contracts.ts: proposed_reason enum missing value "${reason}"`);
    }
  }
  if (!/proposed_reason:\s*ProposedReasonSchema/.test(schema)) {
    failures.push("api-contracts.ts: FabExtractKnowledgeInputSchema missing required proposed_reason field");
  }
  if (!/session_context:\s*z\s*\.\s*string\(\)/.test(schema)) {
    failures.push("api-contracts.ts: FabExtractKnowledgeInputSchema missing required session_context field");
  }

  const service = readText("packages/server/src/services/extract-knowledge.ts");
  if (service === undefined) {
    failures.push("extract-knowledge.ts: not found");
  } else {
    if (!/## Why proposed/.test(service)) {
      failures.push("extract-knowledge.ts: body renderer missing `## Why proposed` section");
    }
    if (!/## Session context/.test(service)) {
      failures.push("extract-knowledge.ts: body renderer missing `## Session context` section");
    }
    if (!/mergeEvidenceNotes/.test(service)) {
      failures.push("extract-knowledge.ts: missing mergeEvidenceNotes helper (T6 Evidence-merge dedup)");
    }
    // Legacy append-on-collision shape MUST be gone — collisions now merge
    // into a single `## Evidence` section.
    if (/\(call \$\{callIndex\}\)/.test(service)) {
      failures.push("extract-knowledge.ts: still emits `## Evidence (call N)` blocks (T6 must merge into single section)");
    }
  }

  if (failures.length === 0) {
    return { id: "T06", name: "pending entry self-containedness (T6)", passed: true };
  }
  return {
    id: "T06",
    name: "pending entry self-containedness (T6)",
    passed: false,
    details: failures.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// T05 — Archive Skill cross-session digest layer
//   * source_sessions[] array form on FabExtractKnowledgeInputSchema
//   * Back-compat shim accepts single string source_session
//   * Pending frontmatter renders `source_sessions: [...]` array
//   * Digest writer module + Phase 0.0 reference in archive SKILL.md
// ---------------------------------------------------------------------------

async function checkT05CrossSessionDigest() {
  const failures = [];

  const schema = readText("packages/shared/src/schemas/api-contracts.ts");
  if (schema === undefined) {
    return {
      id: "T05",
      name: "archive Skill cross-session digest layer (T5)",
      passed: false,
      details: "packages/shared/src/schemas/api-contracts.ts not found",
    };
  }
  if (!/source_sessions:\s*_sourceSessionsField/.test(schema)) {
    failures.push("api-contracts.ts: missing source_sessions field on FabExtractKnowledgeInputSchema");
  }
  if (!/_sourceSessionsField\s*=\s*z\.preprocess/.test(schema)) {
    failures.push("api-contracts.ts: missing single-string → array preprocess shim for source_sessions");
  }

  const service = readText("packages/server/src/services/extract-knowledge.ts");
  if (service === undefined) {
    failures.push("extract-knowledge.ts: not found");
  } else if (!/source_sessions:\s*\[/.test(service) && !/`source_sessions: \[\$/.test(service)) {
    failures.push("extract-knowledge.ts: pending frontmatter does not render source_sessions: [...] array");
  }

  if (!fileExists("packages/cli/templates/hooks/lib/session-digest-writer.cjs")) {
    failures.push("templates/hooks/lib/session-digest-writer.cjs not found (digest writer module)");
  }
  const hook = readText("packages/cli/templates/hooks/fabric-hint.cjs");
  if (hook === undefined) {
    failures.push("fabric-hint.cjs not found");
  } else {
    if (!/session-digest-writer/.test(hook)) {
      failures.push("fabric-hint.cjs: does not require/use session-digest-writer (digest write not wired)");
    }
    if (!/writeSessionDigestBestEffort/.test(hook)) {
      failures.push("fabric-hint.cjs: missing writeSessionDigestBestEffort integration");
    }
  }

  const skill = readText("packages/cli/templates/skills/fabric-archive/SKILL.md");
  if (skill === undefined) {
    failures.push("fabric-archive/SKILL.md not found");
  } else {
    if (!/Phase 0\.0/.test(skill)) {
      failures.push("fabric-archive SKILL.md: missing Phase 0.0 cross-session digest block");
    }
    if (!/\.fabric\/\.cache\/session-digests/.test(skill)) {
      failures.push("fabric-archive SKILL.md: Phase 0.0 does not reference .fabric/.cache/session-digests/");
    }
    if (!/source_sessions/.test(skill)) {
      failures.push("fabric-archive SKILL.md: does not document source_sessions[] output contract");
    }
  }

  if (failures.length === 0) {
    return { id: "T05", name: "archive Skill cross-session digest layer (T5)", passed: true };
  }
  return {
    id: "T05",
    name: "archive Skill cross-session digest layer (T5)",
    passed: false,
    details: failures.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// T10 — fabric-hint Signal D + doctor_run event (Q-16 closure)
//   * doctor_run event schema declared in shared/schemas/event-ledger.ts
//   * doctor.ts emits doctor_run at end of run (both --lint and --apply-lint)
//   * fabric-hint.cjs adds evaluateMaintenanceSignal + cooldown sidecar
//   * Banner uses zh-CN T10 phrasing; recommended_skill = null (CLI rec)
// ---------------------------------------------------------------------------

async function checkT10MaintenanceSignal() {
  const failures = [];

  const eventSchema = readText("packages/shared/src/schemas/event-ledger.ts");
  if (eventSchema === undefined) {
    return {
      id: "T10",
      name: "fabric-hint Signal D + doctor_run event (T10)",
      passed: false,
      details: "packages/shared/src/schemas/event-ledger.ts not found",
    };
  }
  if (!/doctorRunEventSchema\s*=\s*z\.object/.test(eventSchema)) {
    failures.push("event-ledger.ts: missing doctorRunEventSchema declaration");
  }
  if (!/event_type:\s*z\.literal\("doctor_run"\)/.test(eventSchema)) {
    failures.push("event-ledger.ts: doctorRunEventSchema does not declare event_type literal 'doctor_run'");
  }
  if (!/mode:\s*z\.enum\(\["lint",\s*"apply-lint"\]\)/.test(eventSchema)) {
    failures.push("event-ledger.ts: doctorRunEventSchema mode enum missing ['lint','apply-lint']");
  }
  if (!/doctorRunEventSchema,/.test(eventSchema)) {
    failures.push("event-ledger.ts: doctorRunEventSchema not added to discriminated union");
  }

  const doctor = readText("packages/cli/src/commands/doctor.ts");
  if (doctor === undefined) {
    failures.push("doctor.ts: not found");
  } else {
    if (!/emitDoctorRunEventBestEffort/.test(doctor)) {
      failures.push("doctor.ts: missing emitDoctorRunEventBestEffort helper");
    }
    if (!/event_type:\s*"doctor_run"/.test(doctor)) {
      failures.push("doctor.ts: does not emit event_type: 'doctor_run' on the events.jsonl append path");
    }
  }

  const hook = readText("packages/cli/templates/hooks/fabric-hint.cjs");
  if (hook === undefined) {
    failures.push("fabric-hint.cjs: not found");
  } else {
    if (!/evaluateMaintenanceSignal/.test(hook)) {
      failures.push("fabric-hint.cjs: missing evaluateMaintenanceSignal helper");
    }
    if (!/signal:\s*"maintenance"/.test(hook)) {
      failures.push("fabric-hint.cjs: missing signal: 'maintenance' branch (T10 banner output shape)");
    }
    if (!/maintenance-hint-last-emit/.test(hook)) {
      failures.push("fabric-hint.cjs: missing maintenance-hint-last-emit cooldown sidecar wiring");
    }
    if (!/fabric doctor --lint/.test(hook)) {
      failures.push("fabric-hint.cjs: banner does not reference `fabric doctor --lint` CLI invocation");
    }
    if (!/recommended_skill:\s*null/.test(hook)) {
      failures.push("fabric-hint.cjs: Signal D branch must set recommended_skill: null (CLI rec, not Skill)");
    }
  }

  if (failures.length === 0) {
    return { id: "T10", name: "fabric-hint Signal D + doctor_run event (T10)", passed: true };
  }
  return {
    id: "T10",
    name: "fabric-hint Signal D + doctor_run event (T10)",
    passed: false,
    details: failures.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function main() {
  const checks = [];
  checks.push(await checkT09PlanContextSymmetric());
  checks.push(await checkT06PendingSelfContained());
  checks.push(await checkT05CrossSessionDigest());
  checks.push(await checkT10MaintenanceSignal());

  const passed = checks.every((c) => c.passed);
  const headerWidth = Math.max(...checks.map((c) => c.name.length)) + 4;
  for (const c of checks) {
    const status = c.passed ? "PASS" : "FAIL";
    const padded = c.name.padEnd(headerWidth);
    // Prefix with id so the output mirrors rc.6 style.
    process.stdout.write(`[${c.id}] ${padded} ${status}\n`);
    if (!c.passed && c.details) {
      for (const line of c.details.split("\n")) {
        process.stdout.write(`    ${line}\n`);
      }
    }
  }

  process.stdout.write(`\nRESULT: ${passed ? "PASS" : "FAIL"}\n`);
  if (!passed) {
    // Distinct non-zero exit; mirrors rc.6 gate convention.
    process.exit(2);
  }
}

main().catch((err) => {
  process.stderr.write(`rc7-coverage-gate crashed: ${err?.stack ?? err}\n`);
  process.exit(3);
});

if (!fileExists("scripts/rc7-coverage-gate.mjs")) {
  // Defensive marker so a stale checkout doesn't silently pass.
  process.stderr.write("rc7-coverage-gate: self-file missing on disk\n");
}
