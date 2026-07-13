// ISS-20260713-040: session-scoped shown-cache / dismiss / maintenance last-emit.
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");
const hintConfig = require("./hint-config.cjs");

const {
  SHOWN_CACHE_FILE,
  MAINTENANCE_HINT_LAST_EMIT_FILE,
} = hintConfig;

let configCache = null;
let stateStore = null;
try {
  configCache = require("./config-cache.cjs");
} catch {
  configCache = null;
}
try {
  stateStore = require("./state-store.cjs");
} catch {
  stateStore = null;
}

const DISMISSABLE_SIGNALS = ["archive", "archive_backlog", "review", "import", "maintenance"];

function sessionScopedCacheFile(baseRelPath, sessionId) {
  if (sessionId === undefined || sessionId === null || String(sessionId).length === 0) {
    return baseRelPath;
  }
  const safe = String(sessionId).replace(/[^A-Za-z0-9_.-]/g, "-");
  const lastSlash = baseRelPath.lastIndexOf("/");
  const dot = baseRelPath.lastIndexOf(".");
  return dot > lastSlash
    ? `${baseRelPath.slice(0, dot)}-${safe}${baseRelPath.slice(dot)}`
    : `${baseRelPath}-${safe}`;
}

function readShownCache(projectRoot, sessionId) {
  const cachePath = join(projectRoot, sessionScopedCacheFile(SHOWN_CACHE_FILE, sessionId));
  if (!existsSync(cachePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(cachePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeShownCache(projectRoot, cache, sessionId) {
  const cachePath = join(projectRoot, sessionScopedCacheFile(SHOWN_CACHE_FILE, sessionId));
  try {
    if (stateStore && typeof stateStore.atomicWrite === "function") {
      stateStore.atomicWrite(cachePath, JSON.stringify(cache));
    } else {
      mkdirSync(dirname(cachePath), { recursive: true });
      writeFileSync(cachePath, JSON.stringify(cache));
    }
  } catch {
    // Silent — cache failure must never block the hook.
  }
}

function sessionDismissFileName(sessionId) {
  const safe = String(sessionId || "anonymous").replace(/[^A-Za-z0-9_.-]/g, "-");
  return `hint-dismiss-${safe}.json`;
}

function readDismissedSignals(projectRoot, sessionId) {
  const dismissed = new Set();
  try {
    if (configCache && typeof configCache.readConfig === "function") {
      const cfg = configCache.readConfig(projectRoot);
      const list = cfg && cfg.hint_dismiss_signals;
      if (Array.isArray(list)) {
        for (const s of list) {
          if (DISMISSABLE_SIGNALS.includes(s)) dismissed.add(s);
        }
      }
    }
  } catch {
    // defensive
  }
  try {
    if (stateStore && typeof stateStore.readJsonState === "function" && sessionId) {
      const sidecar = stateStore.readJsonState(
        projectRoot,
        sessionDismissFileName(sessionId),
        (p) => p && typeof p === "object" && Array.isArray(p.dismissed),
      );
      if (sidecar) {
        for (const s of sidecar.dismissed) {
          if (DISMISSABLE_SIGNALS.includes(s)) dismissed.add(s);
        }
      }
    }
  } catch {
    // defensive
  }
  return dismissed;
}

function writeSessionDismiss(projectRoot, sessionId, signals) {
  if (!stateStore || typeof stateStore.writeJsonState !== "function") return;
  const fileName = sessionDismissFileName(sessionId);
  const prior = stateStore.readJsonState(
    projectRoot,
    fileName,
    (p) => p && typeof p === "object" && Array.isArray(p.dismissed),
  );
  const merged = new Set(prior && Array.isArray(prior.dismissed) ? prior.dismissed : []);
  for (const s of Array.isArray(signals) ? signals : []) {
    if (DISMISSABLE_SIGNALS.includes(s)) merged.add(s);
  }
  stateStore.writeJsonState(projectRoot, fileName, { dismissed: [...merged] });
}

function renderDismissOption(signal, variant) {
  const zh = variant === "zh-CN" || variant === "zh-CN-hybrid";
  return zh
    ? `  (不想再看到此类提醒？在 .fabric/fabric-config.json 设 "hint_dismiss_signals": ["${signal}"]，或让我本会话关闭 ${signal} 提醒)`
    : `  (Silence this nudge? Set "hint_dismiss_signals": ["${signal}"] in .fabric/fabric-config.json, or ask me to dismiss ${signal} for this session)`;
}

function readMaintenanceLastEmit(projectRoot, sessionId) {
  const p = join(projectRoot, sessionScopedCacheFile(MAINTENANCE_HINT_LAST_EMIT_FILE, sessionId));
  if (!existsSync(p)) return null;
  try {
    const raw = readFileSync(p, "utf8").trim();
    if (raw.length === 0) return null;
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return ms;
    const asNum = Number(raw);
    if (Number.isFinite(asNum) && asNum > 0) return asNum;
  } catch {
    // ignore
  }
  return null;
}

function writeMaintenanceLastEmit(projectRoot, nowMs, sessionId) {
  const p = join(projectRoot, sessionScopedCacheFile(MAINTENANCE_HINT_LAST_EMIT_FILE, sessionId));
  try {
    if (stateStore && typeof stateStore.atomicWrite === "function") {
      stateStore.atomicWrite(p, new Date(nowMs).toISOString());
    } else {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, new Date(nowMs).toISOString());
    }
  } catch {
    // Silent — sidecar failure must never block the hook.
  }
}

module.exports = {
  DISMISSABLE_SIGNALS,
  sessionScopedCacheFile,
  readShownCache,
  writeShownCache,
  sessionDismissFileName,
  readDismissedSignals,
  writeSessionDismiss,
  renderDismissOption,
  readMaintenanceLastEmit,
  writeMaintenanceLastEmit,
};
