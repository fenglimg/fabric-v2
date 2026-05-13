#!/usr/bin/env node

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ROOT_PACKAGE_PATH = path.join(ROOT, "package.json");
const PACKAGES_DIR = path.join(ROOT, "packages");

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

async function main() {
  const version = parseTagArg();
  const targets = [ROOT_PACKAGE_PATH, ...(await collectWorkspacePackagePaths())];

  for (const target of targets) {
    const result = await rewriteVersion(target, version);
    process.stdout.write(`${result.name}: ${result.previous} -> ${result.next}\n`);
  }

  process.stdout.write(`Applied version ${version} to ${targets.length} package manifest(s).\n`);
}

await main();
