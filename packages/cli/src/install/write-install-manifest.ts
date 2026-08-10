import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, sep } from "node:path";

import {
  INSTALL_MANIFEST_REL,
  INSTALL_MANIFEST_SCHEMA_VERSION,
  hashInstalledFile,
  type InstallManifest,
} from "@fenglimg/fabric-shared";

import {
  HOOK_LIB_DESTINATIONS,
  HOOK_SCRIPT_DESTINATIONS,
  SKILL_DESTINATIONS,
  SKILL_LIB_DESTINATIONS,
} from "./skills-and-hooks.js";

declare const __CLI_VERSION__: string | undefined;

// ---------------------------------------------------------------------------
// Record what `fabric install` just wrote, so `fabric doctor` can tell a
// current installed copy from one that has since drifted. Written at the end of
// a successful install (ValidateStage), because "what is on disk now" is only
// meaningful once every writer has run.
//
// The file set is derived from the same `*_DESTINATIONS` constants the
// installers use — never hand-listed — so a newly shipped artifact is covered
// the moment it is added to a distribution list. Directory-shaped entries
// (hook libs, skill libs, skill ref companions) are walked on disk rather than
// enumerated, since their contents are whatever the template tree holds.
//
// Client hook configs are deliberately absent: install deep-MERGES those into
// the user's own file, so their bytes are supposed to differ from ours.
// ---------------------------------------------------------------------------

function cliVersion(): string {
  return typeof __CLI_VERSION__ === "string" ? __CLI_VERSION__ : "unknown";
}

/** Manifest keys are POSIX-shaped on every platform so they compare stably. */
function manifestKey(projectRoot: string, absPath: string): string {
  return relative(projectRoot, absPath).split(sep).join(posix.sep);
}

async function filesIn(absDir: string, ext: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(absDir);
  } catch {
    return [];
  }
  return names.filter((name) => name.endsWith(ext)).map((name) => join(absDir, name));
}

/**
 * Absolute paths of every wholesale-written artifact, whether or not it exists.
 * Callers hash what is present and skip what is not — a genuinely missing
 * artifact is the validate stage's error to raise, not the manifest's.
 */
async function distributedFiles(projectRoot: string): Promise<string[]> {
  const abs = (rel: string): string => join(projectRoot, ...rel.split("/"));
  const files: string[] = [];

  for (const destinations of Object.values(SKILL_DESTINATIONS)) {
    for (const rel of destinations) {
      const skillMd = abs(rel);
      files.push(skillMd);
      // `<client>/skills/<slug>/ref/*.md` — the companions installSkillRefFiles ships.
      files.push(...(await filesIn(join(dirname(skillMd), "ref"), ".md")));
    }
  }
  for (const rel of SKILL_LIB_DESTINATIONS) {
    files.push(...(await filesIn(abs(rel), ".md")));
  }
  for (const destinations of Object.values(HOOK_SCRIPT_DESTINATIONS)) {
    for (const rel of destinations) files.push(abs(rel));
  }
  for (const rel of HOOK_LIB_DESTINATIONS) {
    files.push(...(await filesIn(abs(rel), ".cjs")));
  }
  return files;
}

/**
 * Build the manifest for a project's current installed copies. Files that are
 * absent or unreadable are omitted rather than recorded with a placeholder
 * hash: a manifest entry is a claim that install wrote these exact bytes, and
 * we only make that claim about bytes we can actually read back.
 */
export async function buildInstallManifest(projectRoot: string): Promise<InstallManifest> {
  const files: Record<string, string> = {};
  for (const abs of await distributedFiles(projectRoot)) {
    let content: Buffer;
    try {
      content = await readFile(abs);
    } catch {
      continue;
    }
    files[manifestKey(projectRoot, abs)] = hashInstalledFile(content);
  }
  return {
    schema_version: INSTALL_MANIFEST_SCHEMA_VERSION,
    fabric_version: cliVersion(),
    generated_at: new Date().toISOString(),
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
  };
}

/**
 * Write `.fabric/install-manifest.json`. Returns the project-root-relative path
 * on success, or `null` when the write failed — a manifest is a diagnostic aid,
 * so failing to record one must never fail an otherwise-good install.
 */
export async function writeInstallManifest(projectRoot: string): Promise<string | null> {
  try {
    const manifest = await buildInstallManifest(projectRoot);
    const target = join(projectRoot, ...INSTALL_MANIFEST_REL.split("/"));
    await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return INSTALL_MANIFEST_REL;
  } catch {
    return null;
  }
}
