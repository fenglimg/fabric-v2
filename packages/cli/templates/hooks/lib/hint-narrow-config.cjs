// ISS-20260713-053: narrow hint config readers.

const FABRIC_DIR_REL = ".fabric";
const FABRIC_CONFIG_FILE = "fabric-config.json";
const DEFAULT_HINT_NARROW_TOP_K = 5;
const DEFAULT_HINT_NARROW_DEDUP_WINDOW_TURNS = 5;
const DEFAULT_HINT_NARROW_COOLDOWN_HOURS = 0;
const DEFAULT_HINT_REMINDER_TO_CONTEXT = true;
const DEFAULT_SUMMARY_MAX_LEN = 80;
const {
  readConfig,
  readGlobalConfig,
  readConfigNumber,
  readConfigBoolean,
} = require("./config-cache.cjs");

function _readNarrowConfigValue(projectRoot) {
  const parsed = readConfig(projectRoot);
  return Object.keys(parsed).length > 0 ? parsed : null;
}

function readNarrowTopK(projectRoot) {
  return readConfigNumber(projectRoot, "hint_narrow_top_k", DEFAULT_HINT_NARROW_TOP_K, {
    min: 1,
    max: 20,
    floor: true,
    globalFallback: true,
  });
}

function readNarrowDedupWindowTurns(projectRoot) {
  return readConfigNumber(
    projectRoot,
    "hint_narrow_dedup_window_turns",
    DEFAULT_HINT_NARROW_DEDUP_WINDOW_TURNS,
    { min: 1, max: 50, floor: true, globalFallback: true },
  );
}

function readNarrowCooldownHours(projectRoot) {
  return readConfigNumber(
    projectRoot,
    "hint_narrow_cooldown_hours",
    DEFAULT_HINT_NARROW_COOLDOWN_HOURS,
    { min: 0, max: 168, globalFallback: true },
  );
}

function readNarrowDismissed(projectRoot) {
  const projectSignals = readConfig(projectRoot).hint_dismiss_signals;
  if (Array.isArray(projectSignals)) return projectSignals.includes("narrow");
  const globalSignals = readGlobalConfig().hint_dismiss_signals;
  if (Array.isArray(globalSignals)) return globalSignals.includes("narrow");
  return false;
}

function readReminderToContext(projectRoot) {
  return readConfigBoolean(
    projectRoot,
    "hint_reminder_to_context",
    DEFAULT_HINT_REMINDER_TO_CONTEXT,
    { globalFallback: true },
  );
}

function readSummaryMaxLen(projectRoot) {
  return readConfigNumber(projectRoot, "hint_summary_max_len", DEFAULT_SUMMARY_MAX_LEN, {
    min: 40,
    max: 240,
    floor: true,
    globalFallback: true,
  });
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
