/**
 * v2.0.0-rc.37 NEW-19: shared fabric-config reader for hook scripts.
 *
 * Before this lib, every hook re-implemented the same defensive
 * `readFileSync(.fabric/fabric-config.json) → JSON.parse → validate one key →
 * fall back to default` boilerplate, once PER KEY (knowledge-hint-broad alone
 * read the file 5× per SessionStart fire: cooldown / top_k / underseed /
 * summary_max_len / reminder_to_context). This module centralises the read +
 * mtime-keyed memoisation so a single hook fire parses the config once.
 *
 * Provides:
 *   - readConfig(projectRoot) → object
 *       Parsed fabric-config.json (memoised on path+mtime). Returns `{}` on
 *       any failure (missing file / parse error / non-object). Never throws.
 *       mtime-keyed so a config rewrite mid-process (test harness) invalidates
 *       the cached value automatically — production hooks are single-shot so
 *       the common case is one stat + one parse.
 *   - readGlobalConfig() → object
 *       Parsed ~/.fabric/fabric-global.json (or $FABRIC_HOME equivalent),
 *       with the same cache and never-throw behavior.
 *   - readConfigNumber(root, key, fallback, { min, max, integer, globalFallback }) → number
 *   - readConfigBoolean(root, key, fallback, { globalFallback }) → boolean
 *   - readConfigString(root, key, fallback, { globalFallback }) → string
 *       Typed getters with inline range/shape validation; any miss → fallback.
 *   - configPathFor(projectRoot) → absolute config path
 *   - clearConfigCache() → void   (test helper)
 *
 * Never-throw contract: every export degrades to its fallback rather than
 * throwing, preserving the reminder-layer hook invariant (KT-DEC-0007: hooks
 * never block on their own malfunction).
 */

const { existsSync, readFileSync, statSync } = require("node:fs");
const { join } = require("node:path");
const { homedir } = require("node:os");

const FABRIC_DIR_REL = ".fabric";
const FABRIC_CONFIG_FILE = "fabric-config.json";
const GLOBAL_CONFIG_FILE = "fabric-global.json";

// path → { mtime, value }. Per-process; mtime-keyed for test-mutation safety.
const _cache = new Map();

function configPathFor(projectRoot) {
  return join(projectRoot, FABRIC_DIR_REL, FABRIC_CONFIG_FILE);
}

function readConfig(projectRoot) {
  const path = configPathFor(projectRoot);
  let mtime;
  try {
    if (!existsSync(path)) {
      _cache.delete(path);
      return {};
    }
    mtime = statSync(path).mtimeMs;
  } catch {
    return {};
  }
  const cached = _cache.get(path);
  if (cached && cached.mtime === mtime) return cached.value;
  let value = {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (raw && typeof raw === "object") value = raw;
  } catch {
    value = {};
  }
  _cache.set(path, { mtime, value });
  return value;
}

/**
 * Read the machine-global config at ~/.fabric/fabric-global.json (mtime-cached).
 * Returns {} on any failure. Never throws.
 */
function readGlobalConfig() {
  const globalRoot = process.env.FABRIC_HOME || join(homedir(), ".fabric");
  const path = join(globalRoot, GLOBAL_CONFIG_FILE);
  let mtime;
  try {
    if (!existsSync(path)) {
      _cache.delete(path);
      return {};
    }
    mtime = statSync(path).mtimeMs;
  } catch {
    return {};
  }
  const cached = _cache.get(path);
  if (cached && cached.mtime === mtime) return cached.value;
  let value = {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (raw && typeof raw === "object") value = raw;
  } catch {
    value = {};
  }
  _cache.set(path, { mtime, value });
  return value;
}

function clearConfigCache() {
  _cache.clear();
}

// opts:
//   min / max          — inclusive range; out-of-range → fallback
//   integer            — require Number.isInteger; non-integer → fallback (strict)
//   floor              — accept any in-range number, return Math.floor(v) (lenient)
//   globalFallback     — try ~/.fabric/fabric-global.json between project and fallback
// `integer` and `floor` are independent: `integer` rejects fractional values,
// `floor` truncates them. Pick whichever matches the caller's legacy contract.
function readConfigNumber(projectRoot, key, fallback, opts) {
  const { min, max, integer, floor, globalFallback } = opts || {};
  function validate(v) {
    if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
    if (integer && !Number.isInteger(v)) return undefined;
    if (typeof min === "number" && v < min) return undefined;
    if (typeof max === "number" && v > max) return undefined;
    return floor ? Math.floor(v) : v;
  }
  const projVal = validate(readConfig(projectRoot)[key]);
  if (projVal !== undefined) return projVal;
  if (globalFallback) {
    const globalVal = validate(readGlobalConfig()[key]);
    if (globalVal !== undefined) return globalVal;
  }
  return fallback;
}

function readConfigBoolean(projectRoot, key, fallback, opts) {
  const { globalFallback } = opts || {};
  const v = readConfig(projectRoot)[key];
  if (typeof v === "boolean") return v;
  if (globalFallback) {
    const gv = readGlobalConfig()[key];
    if (typeof gv === "boolean") return gv;
  }
  return fallback;
}

function readConfigString(projectRoot, key, fallback, opts) {
  const { globalFallback } = opts || {};
  const v = readConfig(projectRoot)[key];
  if (typeof v === "string" && v.length > 0) return v;
  if (globalFallback) {
    const gv = readGlobalConfig()[key];
    if (typeof gv === "string" && gv.length > 0) return gv;
  }
  return fallback;
}

module.exports = {
  readConfig,
  readGlobalConfig,
  clearConfigCache,
  readConfigNumber,
  readConfigBoolean,
  readConfigString,
  configPathFor,
};
