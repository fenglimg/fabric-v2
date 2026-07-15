// ISS-20260713-053: narrow hint config readers.

const FABRIC_DIR_REL = ".fabric";
const FABRIC_CONFIG_FILE = "fabric-config.json";
const DEFAULT_HINT_NARROW_TOP_K = 5;
const DEFAULT_HINT_NARROW_DEDUP_WINDOW_TURNS = 5;
const DEFAULT_HINT_NARROW_COOLDOWN_HOURS = 0;
const DEFAULT_HINT_REMINDER_TO_CONTEXT = true;
const DEFAULT_SUMMARY_MAX_LEN = 80;
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

function _readNarrowConfigValue(projectRoot) {
  const configPath = join(projectRoot, FABRIC_DIR_REL, FABRIC_CONFIG_FILE);
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return null;
  }
}

function readNarrowTopK(projectRoot) {
  const parsed = _readNarrowConfigValue(projectRoot);
  if (parsed && typeof parsed === "object") {
    const v = parsed.hint_narrow_top_k;
    if (typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 20) {
      return Math.floor(v);
    }
  }
  return DEFAULT_HINT_NARROW_TOP_K;
}

function readNarrowDedupWindowTurns(projectRoot) {
  const parsed = _readNarrowConfigValue(projectRoot);
  if (parsed && typeof parsed === "object") {
    const v = parsed.hint_narrow_dedup_window_turns;
    if (typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 50) {
      return Math.floor(v);
    }
  }
  return DEFAULT_HINT_NARROW_DEDUP_WINDOW_TURNS;
}

function readNarrowCooldownHours(projectRoot) {
  const parsed = _readNarrowConfigValue(projectRoot);
  if (parsed && typeof parsed === "object") {
    const v = parsed.hint_narrow_cooldown_hours;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 168) {
      return v;
    }
  }
  return DEFAULT_HINT_NARROW_COOLDOWN_HOURS;
}

function readNarrowDismissed(projectRoot) {
  const parsed = _readNarrowConfigValue(projectRoot);
  if (parsed && typeof parsed === "object" && Array.isArray(parsed.hint_dismiss_signals)) {
    return parsed.hint_dismiss_signals.includes("narrow");
  }
  return false;
}

function readReminderToContext(projectRoot) {
  const parsed = _readNarrowConfigValue(projectRoot);
  if (parsed && typeof parsed === "object") {
    const v = parsed.hint_reminder_to_context;
    if (typeof v === "boolean") return v;
  }
  return DEFAULT_HINT_REMINDER_TO_CONTEXT;
}

function readSummaryMaxLen(projectRoot) {
  const parsed = _readNarrowConfigValue(projectRoot);
  if (parsed && typeof parsed === "object") {
    const v = parsed.hint_summary_max_len;
    if (typeof v === "number" && Number.isFinite(v) && v >= 40 && v <= 240) {
      return Math.floor(v);
    }
  }
  return DEFAULT_SUMMARY_MAX_LEN;
}

module.exports = {
  FABRIC_DIR_REL,
  FABRIC_CONFIG_FILE,
  DEFAULT_HINT_NARROW_TOP_K,
  DEFAULT_HINT_NARROW_DEDUP_WINDOW_TURNS,
  DEFAULT_HINT_NARROW_COOLDOWN_HOURS,
  DEFAULT_HINT_REMINDER_TO_CONTEXT,
  DEFAULT_SUMMARY_MAX_LEN,
  _readNarrowConfigValue,
  readNarrowTopK,
  readNarrowDedupWindowTurns,
  readNarrowCooldownHours,
  readNarrowDismissed,
  readReminderToContext,
  readSummaryMaxLen,
};
