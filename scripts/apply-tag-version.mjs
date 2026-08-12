#!/usr/bin/env node
/**
 * Apply one version to every place this repo DECLARES its version.
 *
 * This is the single write entry for a version bump — both the rc release flow
 * (.claude/skills/release-rc/SKILL.md Phase 2) and the publish job
 * (.github/workflows/release.yml) go through it. Anything that states the
 * version and can go stale belongs here, not in a caller's ad-hoc loop.
 *
 * README.md is here because it was NOT: the rc.4 bump moved every manifest and
 * left README declaring rc.3, which scripts/doc-drift-gate.mjs then failed in
 * CI. The gate detects that drift; this script is why it should not happen.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { rewriteVersionClaims } from "./lib/version-claim.mjs";

const ROOT = process.cwd();
const ROOT_PACKAGE_PATH = path.join(ROOT, "package.json");
const PACKAGES_DIR = path.join(ROOT, "packages");

/** Docs whose line-leading `**vX.Y.Z**` claim states the active release line. */
const VERSION_DECLARING_DOCS = ["README.md"];

function parseTagArg() {
  const fromCli = process.argv[2];
  const fromEnv = process.env.GITHUB_REF_NAME;
  const raw = fromCli ?? fromEnv;

  if (!raw) {
    throw new Error(
      "Tag not provided. Pass as first arg or set GITHUB_REF_NAME (e.g. v2.0.0-rc.8).",
    );
  }

  const version = raw.startsWith("v") ? raw.slice(1) : raw;

  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Tag "${raw}" does not parse as a semver version.`);
  }

  return version;
}

async function rewriteVersion(filePath, version) {
  const source = await readFile(filePath, "utf8");
  const manifest = JSON.parse(source);
  const previous = manifest.version;
  manifest.version = version;
  const trailingNewline = source.endsWith("\n") ? "\n" : "";
  await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}${trailingNewline}`);
  return { name: manifest.name, previous, next: version };
}

async function collectWorkspacePackagePaths() {
  const entries = await readdir(PACKAGES_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(PACKAGES_DIR, entry.name, "package.json"))
    .sort();
}

async function rewriteDocVersion(filePath, version) {
  const source = await readFile(filePath, "utf8");
  const relPath = path.relative(ROOT, filePath);
  // Throws when the doc states no version at all — a silent no-op here is what
  // let README drift in the first place.
  const { content, claims } = rewriteVersionClaims(source, version, relPath);

  if (content !== source) {
    await writeFile(filePath, content);
  }

  return { relPath, claims };
}

async function main() {
  const version = parseTagArg();
  const targets = [ROOT_PACKAGE_PATH, ...(await collectWorkspacePackagePaths())];

  for (const target of targets) {
    const result = await rewriteVersion(target, version);
    process.stdout.write(`${result.name}: ${result.previous} -> ${result.next}\n`);
  }

  for (const relPath of VERSION_DECLARING_DOCS) {
    const { claims } = await rewriteDocVersion(path.join(ROOT, relPath), version);
    for (const claim of claims) {
      process.stdout.write(
        `${relPath}:${claim.line}: ${claim.previous} -> ${claim.next}` +
          (claim.changed ? "\n" : " (already current)\n"),
      );
    }
  }

  process.stdout.write(
    `Applied version ${version} to ${targets.length} package manifest(s) and ` +
      `${VERSION_DECLARING_DOCS.length} version-declaring doc(s).\n`,
  );
}

await main();
