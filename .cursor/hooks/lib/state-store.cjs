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

// Namespace import (not destructured) so the atomic write goes through a single
// mutable fs reference — also what the atomicity tests spy on (ISS-016).
const fs = require("node:fs");
const { dirname, join } = require("node:path");

const CACHE_DIR_REL = join(".fabric", ".cache");

function cachePath(projectRoot, fileName) {
  return join(projectRoot, CACHE_DIR_REL, fileName);
}

// ISS-016: write to a unique temp file then rename over the target. rename is
// atomic on POSIX, so a reader sees either the old or the new file in full —
// never a truncated/garbled write from a crash or concurrent writer. The temp
// suffix (pid + clock) keeps concurrent windows from colliding on the temp.
function atomicWrite(path, data) {
  fs.mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, path);
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      // best-effort temp cleanup
    }
    throw err;
  }
}

function readJsonState(projectRoot, fileName, validate) {
  const path = cachePath(projectRoot, fileName);
  if (!fs.existsSync(path)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(path, "utf8"));
    if (typeof validate === "function" && !validate(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeJsonState(projectRoot, fileName, value) {
  try {
    atomicWrite(cachePath(projectRoot, fileName), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function readTextState(projectRoot, fileName) {
  const path = cachePath(projectRoot, fileName);
  if (!fs.existsSync(path)) return null;
  try {
    return fs.readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
}

function writeTextState(projectRoot, fileName, text) {
  try {
    atomicWrite(cachePath(projectRoot, fileName), String(text));
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
  atomicWrite,
  CACHE_DIR_REL,
};
