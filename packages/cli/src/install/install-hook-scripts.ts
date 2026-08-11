import { chmodSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  HOOK_BROAD_SCRIPT_TEMPLATE_REL,
  HOOK_CITE_EVICT_SCRIPT_TEMPLATE_REL,
  HOOK_LIB_DESTINATIONS,
  HOOK_LIB_TEMPLATE_DIR_REL,
  HOOK_NARROW_SCRIPT_TEMPLATE_REL,
  HOOK_POST_TOOLUSE_SCRIPT_TEMPLATE_REL,
  HOOK_PRETOOLUSE_SCRIPT_TEMPLATE_REL,
  HOOK_SCRIPT_DESTINATIONS,
  HOOK_SCRIPT_TEMPLATE_REL,
  HOOK_SESSION_END_SCRIPT_TEMPLATE_REL,
} from "./distribution-targets.js";
import type { InstallStepResult } from "./step-result.js";
import { copyTextIdempotent, findTemplatePath, readTemplate } from "./template-io.js";

/**
 * Ships the hook `.cjs` scripts and the `hooks/lib/` helpers they require at
 * runtime.
 *
 * Placing a script is only half of wiring a hook — a script on disk that no
 * client config registers is invoked by nobody. `hook-config-merge.ts` owns the
 * other half, and doctor's `hooks_wired` check is what notices when only one of
 * the two happened.
 */

/**
 * ISS-20260711-155: shared copy+chmod for hook scripts. Every per-hook installer
 * only differs by template path, destination list, and step label.
 * Marked executable on POSIX (chmod 0o755). Skipped on Windows where the bit is ignored.
 */
async function installHookScriptCopies(
  step: string,
  templateRel: string,
  destRels: readonly string[],
  projectRoot: string,
): Promise<InstallStepResult[]> {
  const source = await readTemplate(templateRel);
  const results: InstallStepResult[] = [];
  for (const rel of destRels) {
    const target = join(projectRoot, rel);
    const result = await copyTextIdempotent(step, source, target);
    if (result.status === "written" && process.platform !== "win32") {
      try {
        chmodSync(target, 0o755);
      } catch {
        // best-effort — hook still functions when invoked via `node script.cjs`
      }
    }
    results.push(result);
  }
  return results;
}

/**
 * Copy templates/hooks/fabric-hint.cjs into both supported clients'
 * hooks directories: .claude/hooks/ and .codex/hooks/.
 * Renamed from archive-hint in rc.5 TASK-010; function name preserved for call-sites.
 */
export async function installArchiveHintHook(
  projectRoot: string,
): Promise<InstallStepResult[]> {
  return installHookScriptCopies(
    "hook-script",
    HOOK_SCRIPT_TEMPLATE_REL,
    HOOK_SCRIPT_DESTINATIONS.fabricHint,
    projectRoot,
  );
}

/**
 * Copy templates/hooks/knowledge-hint-broad.cjs (SessionStart broad-injection).
 */
export async function installKnowledgeHintBroadHook(
  projectRoot: string,
): Promise<InstallStepResult[]> {
  return installHookScriptCopies(
    "hook-broad-script",
    HOOK_BROAD_SCRIPT_TEMPLATE_REL,
    HOOK_SCRIPT_DESTINATIONS.knowledgeHintBroad,
    projectRoot,
  );
}

/**
 * Copy templates/hooks/knowledge-hint-narrow.cjs (PreToolUse narrow-injection).
 */
export async function installKnowledgeHintNarrowHook(
  projectRoot: string,
): Promise<InstallStepResult[]> {
  return installHookScriptCopies(
    "hook-narrow-script",
    HOOK_NARROW_SCRIPT_TEMPLATE_REL,
    HOOK_SCRIPT_DESTINATIONS.knowledgeHintNarrow,
    projectRoot,
  );
}

/**
 * ux-w2-6: copy templates/hooks/knowledge-pretooluse.cjs (PreToolUse orchestrator).
 */
export async function installKnowledgePretoolUseHook(
  projectRoot: string,
): Promise<InstallStepResult[]> {
  return installHookScriptCopies(
    "hook-pretooluse-script",
    HOOK_PRETOOLUSE_SCRIPT_TEMPLATE_REL,
    HOOK_SCRIPT_DESTINATIONS.knowledgePretoolUse,
    projectRoot,
  );
}

/**
 * v2.0.0-rc.34 TASK-06: copy templates/hooks/cite-policy-evict.cjs
 * (Claude Code destinations only via HOOK_SCRIPT_DESTINATIONS.citePolicyEvict).
 */
export async function installCitePolicyEvictHook(
  projectRoot: string,
): Promise<InstallStepResult[]> {
  return installHookScriptCopies(
    "hook-cite-evict-script",
    HOOK_CITE_EVICT_SCRIPT_TEMPLATE_REL,
    HOOK_SCRIPT_DESTINATIONS.citePolicyEvict,
    projectRoot,
  );
}

/**
 * lifecycle-refactor W2-T2: copy templates/hooks/session-end-marker.cjs.
 */
export async function installSessionEndMarkerHook(
  projectRoot: string,
): Promise<InstallStepResult[]> {
  return installHookScriptCopies(
    "hook-session-end-script",
    HOOK_SESSION_END_SCRIPT_TEMPLATE_REL,
    HOOK_SCRIPT_DESTINATIONS.sessionEndMarker,
    projectRoot,
  );
}

/**
 * lifecycle-refactor W2-T3: copy templates/hooks/post-tooluse-mutation.cjs.
 */
export async function installPostTooluseMutationHook(
  projectRoot: string,
): Promise<InstallStepResult[]> {
  return installHookScriptCopies(
    "hook-post-tooluse-script",
    HOOK_POST_TOOLUSE_SCRIPT_TEMPLATE_REL,
    HOOK_SCRIPT_DESTINATIONS.postTooluseMutation,
    projectRoot,
  );
}

/**
 * Copy every `.cjs` file from templates/hooks/lib/ into each client's
 * `<client>/hooks/lib/` directory (.claude/hooks/lib/, .codex/hooks/lib/).
 * Idempotent per file via {@link copyTextIdempotent}.
 *
 * The directory listing is read at install time (not hard-coded) so
 * adding a new `templates/hooks/lib/foo.cjs` in a future RC ships
 * automatically without further wiring — keeps the lib directory the
 * single source of truth for hook-side helpers.
 *
 * rc.16 TASK-004 (F2-tests): introduced when banner-i18n.cjs became a
 * hard runtime dependency of fabric-hint.cjs and knowledge-hint-broad.cjs.
 * Without this step the user-facing hook scripts crash with
 * `Cannot find module './lib/banner-i18n.cjs'` on the first Stop /
 * SessionStart event after install.
 *
 * rc.24 TASK-04: also ships `cite-line-parser.cjs`, which fabric-hint.cjs
 * `require()`s to parse `KB:` cite lines (including the rc.24 contract-
 * syntax operators that populate `cite_commitments` on
 * assistant_turn_observed events). The auto-glob pattern (every `.cjs`
 * under templates/hooks/lib/) means it is picked up here without further
 * wiring. B8: it is COMPILED from `packages/shared/src/cite-line-parser.ts`
 * by scripts/build-hook-project-context.mjs — it used to be a hand-authored
 * twin guarded by a parity test. `parseCiteLine(raw)` is its single entry
 * point, so a grep for `parseCiteLine` or `cite-line-parser` finds this
 * install-side wiring.
 *
 * Returns one InstallStepResult per (client × lib file) — N libs shipped
 * across 2 clients = 2N rows. Empty lib directory is allowed (returns
 * a single skipped row noting the absence) so the function is safe to
 * call before any libs have been authored.
 */
export async function installHookLibs(
  projectRoot: string,
): Promise<InstallStepResult[]> {
  const libTemplateDir = findTemplatePath(HOOK_LIB_TEMPLATE_DIR_REL);
  let libFiles: string[];
  try {
    libFiles = readdirSync(libTemplateDir)
      .filter((name) => name.endsWith(".cjs"))
      .sort();
  } catch (error: unknown) {
    return [
      {
        step: "hook-lib",
        path: libTemplateDir,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      },
    ];
  }

  const requiredProjectContextLibs = ["project-context-runtime.cjs", "project-root.cjs"];
  const missingProjectContextLibs = requiredProjectContextLibs.filter(
    (name) => !libFiles.includes(name),
  );
  if (missingProjectContextLibs.length > 0) {
    return missingProjectContextLibs.map((name) => ({
      step: "hook-lib",
      path: join(libTemplateDir, name),
      status: "error" as const,
      message: "missing-required-project-context-runtime",
    }));
  }

  if (libFiles.length === 0) {
    return [
      {
        step: "hook-lib",
        path: libTemplateDir,
        status: "skipped",
        message: "no-libs-to-ship",
      },
    ];
  }

  const results: InstallStepResult[] = [];
  for (const libFile of libFiles) {
    const sourcePath = join(libTemplateDir, libFile);
    let source: string;
    try {
      source = readFileSync(sourcePath, "utf8");
    } catch (error: unknown) {
      results.push({
        step: "hook-lib",
        path: sourcePath,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    for (const destDirRel of HOOK_LIB_DESTINATIONS) {
      const target = join(projectRoot, destDirRel, libFile);
      results.push(await copyTextIdempotent("hook-lib", source, target));
    }
  }
  return results;
}
