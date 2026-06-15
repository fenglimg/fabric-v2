import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { atomicWriteText } from "@fenglimg/fabric-shared/node/atomic-write";
import { resolveBootstrapCanonical } from "@fenglimg/fabric-shared/templates/bootstrap-canonical";

import type { InstallStepResult } from "./skills-and-hooks.js";

/**
 * rc.19 TASK-002 — bootstrap snapshot writer.
 *
 * Materializes the canonical L1 bootstrap document at `.fabric/AGENTS.md`
 * from the shared {@link BOOTSTRAP_CANONICAL} constant. This file is the
 * single source of truth that downstream propagation (TASK-03) fans out to
 * per-client thin shells (CLAUDE.md / AGENTS.md) and that
 * the doctor L1 drift check (TASK-05) compares against.
 *
 * Idempotency: byte-compare the existing file (if any) against the canonical
 * body; skip the write entirely when they already match. Otherwise the write
 * goes through {@link atomicWriteText} (tmp+rename) so concurrent installs
 * or interrupted runs never leave a half-written snapshot.
 *
 * The optional companion file `.fabric/project-rules.md` is intentionally
 * NOT scaffolded here — per the locked decision (NEW-4) it is user-authored
 * and only-if-exists. {@link readProjectRulesIfPresent} returns its content
 * (or `null`) for the propagation concat consumer in TASK-03; uninstall in
 * {@link ./uninstall-skills-and-hooks.ts} likewise preserves it.
 */

const FABRIC_AGENTS_RELPATH = join(".fabric", "AGENTS.md");
const PROJECT_RULES_RELPATH = join(".fabric", "project-rules.md");

/**
 * Resolve the absolute path to `.fabric/AGENTS.md` under `targetRoot`.
 *
 * Pure path helper — does not check filesystem existence.
 */
export function fabricAgentsSnapshotPath(targetRoot: string): string {
  return join(targetRoot, FABRIC_AGENTS_RELPATH);
}

/**
 * Resolve the absolute path to `.fabric/project-rules.md` under `targetRoot`.
 *
 * Pure path helper — does not check filesystem existence. Per locked
 * decision NEW-4, project-rules.md is only-if-exists (user-authored); the
 * install pipeline never scaffolds it, so callers MUST gate on
 * {@link readProjectRulesIfPresent} before consuming the contents.
 */
export function projectRulesPath(targetRoot: string): string {
  return join(targetRoot, PROJECT_RULES_RELPATH);
}

/**
 * Read `.fabric/project-rules.md` under `targetRoot` if present, else return
 * `null`. Consumed by TASK-03 propagation concat logic — when present, the
 * file's contents are appended to the per-client thin-shell payload after
 * the BOOTSTRAP_CANONICAL anchor; when absent, the propagator emits the
 * canonical snapshot alone.
 *
 * Errors during read (e.g. permissions, transient I/O) propagate to the
 * caller; the existence gate avoids the common "file not found" path.
 */
export function readProjectRulesIfPresent(targetRoot: string): string | null {
  const path = projectRulesPath(targetRoot);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

/**
 * Idempotent atomic write of `.fabric/AGENTS.md` from BOOTSTRAP_CANONICAL.
 *
 * Returns:
 *   - `status: 'skipped'` when the destination already byte-matches the
 *     canonical body (no write performed).
 *   - `status: 'written'` when the file was created or rewritten.
 *
 * The parent `.fabric/` directory is created on demand (recursive mkdirp).
 * Existing file reads are best-effort: an unreadable destination falls
 * through to the overwrite path rather than failing the step.
 */
export async function writeFabricAgentsSnapshot(
  targetRoot: string,
): Promise<InstallStepResult> {
  const step = "bootstrap-snapshot";
  const target = fabricAgentsSnapshotPath(targetRoot);
  // Content-layer i18n: select the locale-appropriate body via the unified
  // language flow (resolveGlobalLocale, inside resolveBootstrapCanonical). An
  // en machine writes the EN body, a zh-CN machine the ZH body.
  const canonical = resolveBootstrapCanonical();

  if (existsSync(target)) {
    try {
      const existing = readFileSync(target, "utf8");
      if (existing === canonical) {
        return { step, path: target, status: "skipped", message: "up-to-date" };
      }
    } catch {
      // unreadable target — fall through to overwrite
    }
  }

  await mkdir(dirname(target), { recursive: true });
  await atomicWriteText(target, canonical);
  return { step, path: target, status: "written" };
}
