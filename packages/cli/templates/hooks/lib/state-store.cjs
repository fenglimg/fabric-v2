/**
 * v2.0.0-rc.37 NEW-19: shared `.fabric/.cache/` sidecar I/O for hook scripts.
 *
 * Hooks persist tiny per-session state (turn counters, last-emit timestamps,
 * shown-hint sets) under `.fabric/.cache/`. Each hook had its own copy of the
 * read-JSON-or-null / write-JSON-best-effort / read-text / write-text helpers
 * (cite-policy-evict's readEvictState/writeEvictState, broad's
 * readBroadLastEmit/writeBroadLastEmit, fabric-hint's shown-cache + edit-counter
 * + maintenance-last-emit). This module is the single canonical implementation.
 *
 * Provides (all keyed on a bare `fileName` resolved under .fabric/.cache/):
 *   - cachePath(projectRoot, fileName) → absolute path
 *   - readJsonState(root, fileName, validate?) → parsed | null
 *       null on missing / parse error / validate() === false. Never throws.
 *   - writeJsonState(root, fileName, value) → boolean
 *       mkdir -p + write; false on failure. Never throws.
 *   - readTextState(root, fileName) → trimmed string | null
 *   - writeTextState(root, fileName, text) → boolean
 *
 * Never-throw contract: write failures return false (counter loss is
 * acceptable — the hook never blocks user flow on sidecar I/O, KT-DEC-0007).
 */

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

const CACHE_DIR_REL = join(".fabric", ".cache");

function cachePath(projectRoot, fileName) {
  return join(projectRoot, CACHE_DIR_REL, fileName);
}

function readJsonState(projectRoot, fileName, validate) {
  const path = cachePath(projectRoot, fileName);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (typeof validate === "function" && !validate(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeJsonState(projectRoot, fileName, value) {
  const path = cachePath(projectRoot, fileName);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function readTextState(projectRoot, fileName) {
  const path = cachePath(projectRoot, fileName);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
}

function writeTextState(projectRoot, fileName, text) {
  const path = cachePath(projectRoot, fileName);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, String(text));
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  cachePath,
  readJsonState,
  writeJsonState,
  readTextState,
  writeTextState,
  CACHE_DIR_REL,
};
