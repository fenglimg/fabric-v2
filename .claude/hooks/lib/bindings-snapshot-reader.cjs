#!/usr/bin/env node
// v2.1.0-rc.1 P4 — hook-side resolved-bindings snapshot reader (F4/S63/S65).
//
// Hooks are a REMINDER layer (KT-DEC-0007) and must never block. They are also
// FORBIDDEN from re-resolving stores or walking `.fabric` store trees directly
// — a hook reads ONLY the CLI-pre-generated snapshot at
// `~/.fabric/state/bindings/<project_id>_resolved.json` (written by P3
// install/sync/bind). This keeps the resolver logic in one place (the CLI) and
// keeps hooks a thin, store-unaware-by-construction projection. Missing /
// unreadable / malformed snapshot → null (harmless degrade; the hook proceeds
// without store labels). Zero-dep CJS so it inline-loads at hook runtime.

const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { homedir } = require("node:os");

// `~/.fabric` (FABRIC_HOME override mirrors the CLI's resolveGlobalRoot).
function resolveGlobalRoot() {
  return join(process.env.FABRIC_HOME || homedir(), ".fabric");
}

function bindingsSnapshotPath(projectId, globalRoot) {
  return join(
    globalRoot || resolveGlobalRoot(),
    "state",
    "bindings",
    projectId + "_resolved.json",
  );
}

// Read + shallow-validate the snapshot. Returns the parsed object, or null when
// absent / unreadable / not the expected shape. NEVER throws.
function readBindingsSnapshot(projectId, globalRoot) {
  if (typeof projectId !== "string" || projectId.length === 0) {
    return null;
  }
  const path = bindingsSnapshotPath(projectId, globalRoot);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.read_set &&
      Array.isArray(parsed.read_set.stores)
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

// Render a compact, per-store label line for a SessionStart / Stop hook from a
// snapshot. Empty string when there is nothing to show (degrade silently). The
// label is provenance only — it never re-resolves; it just echoes the read-set
// the CLI already computed, with the write-target flagged (F4 store labels).
function formatStoreLabels(snapshot) {
  if (!snapshot || !snapshot.read_set || !Array.isArray(snapshot.read_set.stores)) {
    return "";
  }
  const writeAlias = snapshot.write_target && snapshot.write_target.alias;
  const parts = snapshot.read_set.stores.map((store) => {
    const tag = store.alias === writeAlias ? " (write)" : store.writable ? "" : " (ro)";
    return store.alias + tag;
  });
  if (parts.length === 0) {
    return "";
  }
  return "[fabric] read-set stores: " + parts.join(", ");
}

module.exports = {
  resolveGlobalRoot,
  bindingsSnapshotPath,
  readBindingsSnapshot,
  formatStoreLabels,
};
