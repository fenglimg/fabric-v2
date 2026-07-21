// ISS-20260713-040: threshold readers + documented defaults for fabric-hint.
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { readGlobalConfig } = require("./config-cache.cjs");

const FABRIC_DIR = ".fabric";
const CONFIG_FILE = "fabric-config.json";

const DEFAULT_ARCHIVE_HINT_HOURS = 24;
const MS_PER_HOUR = 60 * 60 * 1000;
const DEFAULT_ARCHIVE_EDIT_THRESHOLD = 20;
const PENDING_DIR = "knowledge/pending";
const PENDING_TYPES = ["decisions", "pitfalls", "guidelines", "models", "processes"];
const DEFAULT_REVIEW_HINT_PENDING_COUNT = 10;
const DEFAULT_REVIEW_HINT_PENDING_AGE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_MAINTENANCE_HINT_DAYS = 14;
const DEFAULT_MAINTENANCE_HINT_COOLDOWN_DAYS = 7;
const KNOWLEDGE_CANONICAL_TYPES = PENDING_TYPES;
const DEFAULT_UNDERSEED_NODE_THRESHOLD = 10;
const UNDERSEED_POST_INIT_QUIET_HOURS = 24;
const UNDERSEED_NO_PROPOSED_HOURS = 24;
const DEFAULT_COOLDOWN_HOURS = 12;
const SHOWN_CACHE_FILE = ".fabric/.cache/archive-hint-shown.json";
const MAINTENANCE_HINT_LAST_EMIT_FILE = ".fabric/.cache/maintenance-hint-last-emit";
const MAINTENANCE_HINT_MIN_CANONICAL = 5;

// ledger-scan defaults re-exported for CONSTANTS surface when needed by readers
let DEFAULT_ARCHIVE_BACKLOG_SESSION_COUNT = 2;
let DEFAULT_ARCHIVE_BACKLOG_IDLE_HOURS = 24;
try {
  const ledgerScan = require("./ledger-scan.cjs");
  DEFAULT_ARCHIVE_BACKLOG_SESSION_COUNT = ledgerScan.DEFAULT_ARCHIVE_BACKLOG_SESSION_COUNT;
  DEFAULT_ARCHIVE_BACKLOG_IDLE_HOURS = ledgerScan.DEFAULT_ARCHIVE_BACKLOG_IDLE_HOURS;
} catch {
  /* keep local defaults */
}

function _readConfigNumber(projectRoot, fieldName, defaultValue) {
  const configPath = join(projectRoot, FABRIC_DIR, CONFIG_FILE);
  if (existsSync(configPath)) {
    try {
      const parsed = JSON.parse(readFileSync(configPath, "utf8"));
      const v = parsed && parsed[fieldName];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
    } catch {
      // fall through to global
    }
  }
  const gv = readGlobalConfig()[fieldName];
  if (typeof gv === "number" && Number.isFinite(gv) && gv > 0) return gv;
  return defaultValue;
}

function readArchiveHintHours(projectRoot) {
  return _readConfigNumber(projectRoot, "archive_hint_hours", DEFAULT_ARCHIVE_HINT_HOURS);
}

function readReviewHintPendingCount(projectRoot) {
  return _readConfigNumber(
    projectRoot,
    "review_hint_pending_count",
    DEFAULT_REVIEW_HINT_PENDING_COUNT,
  );
}

function readReviewHintPendingAgeDays(projectRoot) {
  return _readConfigNumber(
    projectRoot,
    "review_hint_pending_age_days",
    DEFAULT_REVIEW_HINT_PENDING_AGE_DAYS,
  );
}

function readMaintenanceHintDays(projectRoot) {
  return _readConfigNumber(projectRoot, "maintenance_hint_days", DEFAULT_MAINTENANCE_HINT_DAYS);
}

function readMaintenanceHintCooldownDays(projectRoot) {
  return _readConfigNumber(
    projectRoot,
    "maintenance_hint_cooldown_days",
    DEFAULT_MAINTENANCE_HINT_COOLDOWN_DAYS,
  );
}

function readArchiveBacklogSessionCount(projectRoot) {
  return _readConfigNumber(
    projectRoot,
    "archive_backlog_session_count",
    DEFAULT_ARCHIVE_BACKLOG_SESSION_COUNT,
  );
}

function readArchiveBacklogIdleHours(projectRoot) {
  return _readConfigNumber(
    projectRoot,
    "archive_backlog_idle_hours",
    DEFAULT_ARCHIVE_BACKLOG_IDLE_HOURS,
  );
}

function readCooldownHours(projectRoot) {
  return _readConfigNumber(projectRoot, "archive_hint_cooldown_hours", DEFAULT_COOLDOWN_HOURS);
}

function readUnderseedThreshold(projectRoot) {
  // config-layering: env > project > global > store > default
  let storeConfigReader = null;
  try {
    storeConfigReader = require("./store-config-reader.cjs");
  } catch {
    storeConfigReader = null;
  }
  if (storeConfigReader !== null) {
    const envVal = storeConfigReader.readEnvInt("FABRIC_UNDERSEED_NODE_THRESHOLD", { min: 1 });
    if (typeof envVal === "number") return envVal;
  }
  const configPath = join(projectRoot, FABRIC_DIR, CONFIG_FILE);
  if (existsSync(configPath)) {
    try {
      const parsed = JSON.parse(readFileSync(configPath, "utf8"));
      const v = parsed && parsed.underseed_node_threshold;
      if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
    } catch {
      // fall through
    }
  }
  const gv = readGlobalConfig().underseed_node_threshold;
  if (typeof gv === "number" && Number.isFinite(gv) && gv > 0) return gv;
  if (storeConfigReader !== null) {
    const storeRoot = storeConfigReader.resolveTeamStoreRootFromProject(projectRoot);
    const storeVal = storeConfigReader.readStoreConfigNumber(storeRoot, "underseed_node_threshold", {
      min: 1,
    });
    if (typeof storeVal === "number") return storeVal;
  }
  return DEFAULT_UNDERSEED_NODE_THRESHOLD;
}

function readArchiveEditThreshold(projectRoot) {
  return _readConfigNumber(projectRoot, "archive_edit_threshold", DEFAULT_ARCHIVE_EDIT_THRESHOLD);
}

module.exports = {
  FABRIC_DIR,
  CONFIG_FILE,
  DEFAULT_ARCHIVE_HINT_HOURS,
  MS_PER_HOUR,
  DEFAULT_ARCHIVE_EDIT_THRESHOLD,
  PENDING_DIR,
  PENDING_TYPES,
  DEFAULT_REVIEW_HINT_PENDING_COUNT,
  DEFAULT_REVIEW_HINT_PENDING_AGE_DAYS,
  MS_PER_DAY,
  DEFAULT_MAINTENANCE_HINT_DAYS,
  DEFAULT_MAINTENANCE_HINT_COOLDOWN_DAYS,
  KNOWLEDGE_CANONICAL_TYPES,
  DEFAULT_UNDERSEED_NODE_THRESHOLD,
  UNDERSEED_POST_INIT_QUIET_HOURS,
  UNDERSEED_NO_PROPOSED_HOURS,
  DEFAULT_COOLDOWN_HOURS,
  SHOWN_CACHE_FILE,
  MAINTENANCE_HINT_LAST_EMIT_FILE,
  MAINTENANCE_HINT_MIN_CANONICAL,
  DEFAULT_ARCHIVE_BACKLOG_SESSION_COUNT,
  DEFAULT_ARCHIVE_BACKLOG_IDLE_HOURS,
  _readConfigNumber,
  readArchiveHintHours,
  readReviewHintPendingCount,
  readReviewHintPendingAgeDays,
  readMaintenanceHintDays,
  readMaintenanceHintCooldownDays,
  readArchiveBacklogSessionCount,
  readArchiveBacklogIdleHours,
  readCooldownHours,
  readUnderseedThreshold,
  readArchiveEditThreshold,
};
