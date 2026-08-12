import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import type { FabricSkillInstallSpec } from "./distribution-targets.js";
import { FABRIC_SKILL_INSTALL_SPECS, SKILL_LIB_DESTINATIONS } from "./distribution-targets.js";
import type { InstallStepResult } from "./step-result.js";
import { copyTextIdempotent, findTemplatePath, readTemplate } from "./template-io.js";

/**
 * Ships the 6 Fabric skills: each `SKILL.md`, its `ref/*.md` companions, and
 * the cross-skill `skills/lib/*.md` policy shared by all of them.
 *
 * Which skills exist is `FABRIC_SKILL_INSTALL_SPECS`; this file only knows how
 * to place one. Whether a skill HAS ref companions is answered by the template
 * directory rather than a flag — see `installFabricSkill`.
 */

// rc.34 TASK-02: SKILL.md size pre-check + stale-install detection.
//
// Backstory: rc.33 W3-6 introduced a doctor skill_token_budget lint that
// estimates SKILL.md size as chars/3. It flagged canonical templates AND
// installed copies — but install-time silence meant users could end up with
// 19K-char stale installs from older RCs (rc.21 era) sitting on disk
// indefinitely. This pre-check + stale signal closes that loop:
//
//   - Pre-check: if the canonical template itself estimates > ERROR_TOKENS,
//     install throws (drift→abort, per cli-design philosophy). Fabric must
//     ship clean; oversized templates are a release bug, not a recoverable
//     runtime state.
//   - Stale detection: if an existing target estimates > STALE_INSTALL_RATIO
//     × canonical, we surface a `stale-replaced` message in the
//     InstallStepResult. copyTextIdempotent already overwrites diff content;
//     the message tells operators *why* they saw a write.
//
// Thresholds mirror server/src/services/doctor/doctor.ts inspectSkillTokenBudget
// (chars/3 token estimate, 10K ERROR). Kept duplicated rather than imported
// because shared has no canonical home for these and importing from server
// into cli would invert the dependency direction.
const SKILL_TOKEN_ERROR_TOKENS = 10_000;
const STALE_INSTALL_RATIO = 1.5;

export function estimateSkillTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

export function validateSkillCanonicalSize(source: string, slug: string): void {
  const tokens = estimateSkillTokens(source);
  if (tokens > SKILL_TOKEN_ERROR_TOKENS) {
    throw new Error(
      `Skill '${slug}' canonical SKILL.md estimates ${tokens} tok ` +
        `(>${SKILL_TOKEN_ERROR_TOKENS} ERROR threshold). Install aborted — ` +
        `this is a Fabric release bug, not a user-recoverable state. ` +
        `Re-split SKILL.md via progressive disclosure (see fabric-archive/phases/* ` +
        `as canonical example) and rebuild.`,
    );
  }
}

export function inspectStaleInstall(target: string, source: string): string | null {
  if (!existsSync(target)) return null;
  let existing: string;
  try {
    existing = readFileSync(target, "utf8");
  } catch {
    return null;
  }
  const existingTok = estimateSkillTokens(existing);
  const sourceTok = estimateSkillTokens(source);
  if (existingTok > sourceTok * STALE_INSTALL_RATIO) {
    return `stale-replaced (${existingTok} tok → ${sourceTok} tok canonical)`;
  }
  return null;
}

async function installFabricSkill(
  projectRoot: string,
  spec: FabricSkillInstallSpec,
): Promise<InstallStepResult[]> {
  const source = await readTemplate(spec.templateRel);
  validateSkillCanonicalSize(source, spec.slug);
  const targets = spec.destinations.map((rel) => join(projectRoot, rel));
  const results: InstallStepResult[] = [];
  for (const target of targets) {
    const staleMsg = inspectStaleInstall(target, source);
    const result = await copyTextIdempotent(spec.step, source, target);
    if (staleMsg && result.status === "written") {
      result.message = result.message ? `${staleMsg}; ${result.message}` : staleMsg;
    }
    results.push(result);
  }
  // Unconditional: whether a skill HAS ref/ companions is a fact about its
  // template tree, so let the filesystem answer it. `installSkillRefFiles`
  // returns a `no-ref-dir` skip row for the ref-less skills. The hand-kept
  // `includeRefFiles: true` flag this replaces was a third source of truth
  // beside the template dir and uninstall's own copy of the same boolean — it
  // had already drifted: fabric-recall-playbook's SKILL.md points twice at
  // `ref/scenarios.md`, but the flag was never set, so install shipped a skill
  // that told the agent to open a file no install had ever written.
  results.push(...(await installSkillRefFiles(projectRoot, spec.slug)));
  return results;
}

/**
 * Copy templates/skills/fabric-archive/SKILL.md into both .claude/skills/
 * and .codex/skills/ subtrees under the project root. Idempotent: if the
 * destination already contains an identical copy, no write occurs.
 *
 * v2.0.0-rc.28 TASK-01 (audit §3.1): also walks the skill's `ref/` directory
 * and ships every `*.md` companion to the same client subtrees so
 * load-on-demand references resolve at runtime.
 *
 * v2.0.0-rc.34 TASK-02: validates canonical SKILL.md size before copy
 * (throws if > 10K tok ERROR threshold); annotates results with
 * `stale-replaced` when existing target is > 1.5× canonical.
 */
export async function installFabricArchiveSkill(
  projectRoot: string,
): Promise<InstallStepResult[]> {
  return installFabricSkill(projectRoot, FABRIC_SKILL_INSTALL_SPECS.fabricArchive);
}

/**
 * Copy templates/skills/fabric-review/SKILL.md into both .claude/skills/
 * and .codex/skills/ subtrees under the project root. Idempotent: if the
 * destination already contains an identical copy, no write occurs.
 *
 * Sibling installer to {@link installFabricArchiveSkill}; the v2/rc.3
 * fabric-review Skill is deployed alongside fabric-archive so the user's
 * AI client surfaces both archive (write-side) and review (read-side)
 * knowledge flows.
 */
export async function installFabricReviewSkill(
  projectRoot: string,
): Promise<InstallStepResult[]> {
  return installFabricSkill(projectRoot, FABRIC_SKILL_INSTALL_SPECS.fabricReview);
}

/**
 * v2.1.0-rc.1 P4 (S46): install the fabric-sync Skill — the AI-assisted layer
 * over `fabric sync` (multi-store git traversal + rebase-conflict resolution).
 * Sibling installer to archive/review/import; same 2-client coverage. No `ref/`
 * dir (single-file skill), so installSkillRefFiles records a `no-ref-dir` skip.
 */
export async function installFabricSyncSkill(
  projectRoot: string,
): Promise<InstallStepResult[]> {
  return installFabricSkill(projectRoot, FABRIC_SKILL_INSTALL_SPECS.fabricSync);
}

/**
 * v2.1 ADJ-NEWN-1/#4: install the fabric-store Skill — the conversational
 * façade over `fabric store …` (create/add/bind/list/switch-write). Sibling
 * installer to archive/review/import/sync; same 2-client coverage. Single-file
 * skill (no `ref/` dir).
 */
export async function installFabricStoreSkill(
  projectRoot: string,
): Promise<InstallStepResult[]> {
  return installFabricSkill(projectRoot, FABRIC_SKILL_INSTALL_SPECS.fabricStore);
}

/**
 * S2 (sivtr inspiration): install the retrieval playbook skill — protocol for
 * fab_recall / lazy body Read / failure paths. Single-file + thin ref/, same
 * install path as store/sync shims.
 */
export async function installFabricRecallPlaybookSkill(
  projectRoot: string,
): Promise<InstallStepResult[]> {
  return installFabricSkill(projectRoot, FABRIC_SKILL_INSTALL_SPECS.fabricRecallPlaybook);
}

/**
 * config-single-home W9: install the config checkup / conversational-tuning
 * skill. Same single-file shim path as store/sync — the CLI does the work; the
 * skill only translates a feeling into a key and reads its explanations off
 * `fabric config --list --json`.
 */
export async function installFabricConfigSkill(
  projectRoot: string,
): Promise<InstallStepResult[]> {
  return installFabricSkill(projectRoot, FABRIC_SKILL_INSTALL_SPECS.fabricConfig);
}

/**
 * v2.0.0-rc.28 TASK-01 (audit §3.1): copy every `*.md` file under the
 * skill's `templates/skills/<slug>/ref/` directory to BOTH `.claude/skills/
 * <slug>/ref/` and `.codex/skills/<slug>/ref/`. Idempotent — unchanged files
 * skip the write. Missing template `ref/` directory degrades silently with a
 * single `skipped` row noting `no-ref-files` so retro-fitting older skills
 * doesn't require schema migration. Only Claude Code and Codex CLI surface a
 * Skills directory, matching SKILL_DESTINATIONS coverage.
 */
async function installSkillRefFiles(
  projectRoot: string,
  skillSlug: string,
): Promise<InstallStepResult[]> {
  let refTemplateDir: string;
  try {
    refTemplateDir = findTemplatePath(`skills/${skillSlug}/ref`);
  } catch {
    // No ref/ directory in this skill's template tree — silently skip. Most
    // skills do not have ref/ companions; only those refactored under rc.28
    // TASK-01 do. The single-row 'skipped' return preserves the install
    // summary's installed/skipped/error accounting.
    return [
      {
        step: "skill-ref",
        path: `skills/${skillSlug}/ref`,
        status: "skipped",
        message: `no-ref-dir: ${skillSlug}`,
      },
    ];
  }
  let refFiles: string[];
  try {
    refFiles = readdirSync(refTemplateDir).filter((name) => name.endsWith(".md"));
  } catch {
    return [
      {
        step: "skill-ref",
        path: refTemplateDir,
        status: "skipped",
        message: `no-ref-files: ${skillSlug}`,
      },
    ];
  }
  if (refFiles.length === 0) {
    return [
      {
        step: "skill-ref",
        path: refTemplateDir,
        status: "skipped",
        message: `no-ref-files: ${skillSlug}`,
      },
    ];
  }
  const clientPrefixes = [".claude", ".codex"] as const;
  const results: InstallStepResult[] = [];
  for (const refFile of refFiles) {
    const sourcePath = join(refTemplateDir, refFile);
    let source: string;
    try {
      source = readFileSync(sourcePath, "utf8");
    } catch (error: unknown) {
      results.push({
        step: "skill-ref",
        path: sourcePath,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    for (const prefix of clientPrefixes) {
      const target = join(projectRoot, prefix, "skills", skillSlug, "ref", refFile);
      results.push(await copyTextIdempotent("skill-ref", source, target));
    }
  }
  return results;
}

/**
 * v2.0.0-rc.37 NEW-13: copy the cross-skill shared policy lib
 * (templates/skills/lib/*.md) into each client's `skills/lib/` ONCE. The three
 * skills' ref files reference `../../lib/shared-policy.md` for the common core
 * (protected tokens / AskUserQuestion routing keys / layer heuristic / events
 * emit) instead of each re-prosing it. Sibling to the per-skill ref walk; uses
 * the same two client prefixes (.claude + .codex). `skills/lib/` carries no
 * SKILL.md so the client skill loader ignores it, and skill_ref_mirror only
 * scans the three named skill ref/ dirs — so the lib dir never trips parity.
 */
export async function installSharedSkillLib(
  projectRoot: string,
): Promise<InstallStepResult[]> {
  let libTemplateDir: string;
  try {
    libTemplateDir = findTemplatePath("skills/lib");
  } catch {
    return [{ step: "skill-lib", path: "skills/lib", status: "skipped", message: "no-lib-dir" }];
  }
  let libFiles: string[];
  try {
    libFiles = readdirSync(libTemplateDir).filter((name) => name.endsWith(".md"));
  } catch {
    return [{ step: "skill-lib", path: libTemplateDir, status: "skipped", message: "no-lib-files" }];
  }
  const results: InstallStepResult[] = [];
  for (const libFile of libFiles) {
    let source: string;
    try {
      source = readFileSync(join(libTemplateDir, libFile), "utf8");
    } catch (error: unknown) {
      results.push({
        step: "skill-lib",
        path: join(libTemplateDir, libFile),
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    for (const dirRel of SKILL_LIB_DESTINATIONS) {
      const target = join(projectRoot, dirRel, libFile);
      results.push(await copyTextIdempotent("skill-lib", source, target));
    }
  }
  return results;
}
