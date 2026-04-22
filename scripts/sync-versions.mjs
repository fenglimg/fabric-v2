#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ROOT_PACKAGE_PATH = path.join(ROOT, "package.json");
const PACKAGES_DIR = path.join(ROOT, "packages");

async function readPackageManifest(filePath) {
  const source = await readFile(filePath, "utf8");
  const manifest = JSON.parse(source);

  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    throw new Error(`Package manifest at ${relativePath(filePath)} is missing a valid name.`);
  }

  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error(`Package manifest at ${relativePath(filePath)} is missing a valid version.`);
  }

  return manifest;
}

function relativePath(filePath) {
  return path.relative(ROOT, filePath);
}

async function collectWorkspacePackagePaths() {
  const entries = await readdir(PACKAGES_DIR, { withFileTypes: true });
  const packagePaths = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    packagePaths.push(path.join(PACKAGES_DIR, entry.name, "package.json"));
  }

  return packagePaths.sort();
}

async function main() {
  const rootManifest = await readPackageManifest(ROOT_PACKAGE_PATH);
  const workspacePackagePaths = await collectWorkspacePackagePaths();
  const mismatches = [];

  for (const packagePath of workspacePackagePaths) {
    const manifest = await readPackageManifest(packagePath);

    if (manifest.version !== rootManifest.version) {
      mismatches.push({
        name: manifest.name,
        version: manifest.version,
        filePath: packagePath,
      });
    }
  }

  if (mismatches.length > 0) {
    process.stderr.write(
      `Version sync failed: root version is ${rootManifest.version}, but ${mismatches.length} workspace package(s) differ.\n`,
    );

    for (const mismatch of mismatches) {
      process.stderr.write(
        `- ${mismatch.name} at ${relativePath(mismatch.filePath)} has ${mismatch.version}\n`,
      );
    }

    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `Version sync OK: ${workspacePackagePaths.length} workspace package(s) match root version ${rootManifest.version}.\n`,
  );
}

await main();
