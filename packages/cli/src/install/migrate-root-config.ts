import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// A1 (KT-DEC-0003 dual-root) — one-time migration of the legacy project-root
// `fabric.config.json` into the single source of truth `.fabric/fabric-config.json`.
//
// Before A1 the project root held a SECOND config file: the SERVER runtime +
// MCP-client config (embed_*, plan_context, payload/budget, orphan_demote,
// clientPaths), read by config-loader / installMcpClients. The panel + hooks
// read `.fabric/fabric-config.json`. Two files for one project = split-brain
// (e.g. embed_enabled:true at root vs :false in .fabric). This folds the legacy
// root file into `.fabric/` and deletes it so there is one config root only.
//
// Merge rule: `.fabric` is the base (panel-managed keys win). The legacy root is
// authoritative for the SERVER-runtime keys it uniquely owned — so a user who
// explicitly enabled embed (root embed_enabled:true) keeps it instead of being
// silently reverted to the scaffolded `.fabric` default (false). Any root key
// absent from `.fabric` is carried over (root wins for it).

// Keys the legacy root file is authoritative for on conflict. Listed EXPLICITLY
// (not derived from the panel-field set) so that promoting one of these onto the
// panel later — e.g. embed_enabled in Block 2 — never flips the migration to
// drop the user's explicit root value.
const ROOT_AUTHORITATIVE_KEYS = new Set<string>([
  "embed_enabled",
  "embed_model",
  "embed_weight",
  "plan_context_top_k",
  "mcpPayloadLimits",
  "selection_token_ttl_ms",
  "orphan_demote_proven_days",
  "orphan_demote_verified_days",
  "orphan_demote_draft_days",
  "clientPaths",
]);

export interface MigrateRootConfigResult {
  /** true when a legacy root file existed and was merged + removed. */
  migrated: boolean;
  /** root keys folded into `.fabric/fabric-config.json`. */
  mergedKeys: string[];
  rootPath: string;
  fabricPath: string;
}

function readJsonObject(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Migrate a legacy project-root `fabric.config.json` into `.fabric/fabric-config.json`.
 * Idempotent: a no-op (migrated:false) when no readable root file exists. Never
 * throws — a corrupt/unreadable root file is treated as "nothing to migrate" so
 * doctor/install never crash on a malformed legacy file.
 */
export function migrateRootConfig(projectRoot: string): MigrateRootConfigResult {
  const rootPath = join(projectRoot, "fabric.config.json");
  const fabricPath = join(projectRoot, ".fabric", "fabric-config.json");
  const result: MigrateRootConfigResult = {
    migrated: false,
    mergedKeys: [],
    rootPath,
    fabricPath,
  };

  const rootConfig = readJsonObject(rootPath);
  if (rootConfig === null) {
    // No legacy root file (or unreadable) — nothing to migrate. If an unreadable
    // root file exists, remove it: it is dead weight the server no longer reads.
    if (existsSync(rootPath)) {
      rmSync(rootPath, { force: true });
      result.migrated = true;
    }
    return result;
  }

  const fabricConfig = readJsonObject(fabricPath) ?? {};
  const merged: Record<string, unknown> = { ...fabricConfig };
  const mergedKeys: string[] = [];
  for (const [key, value] of Object.entries(rootConfig)) {
    const fabricHasKey = Object.prototype.hasOwnProperty.call(merged, key);
    // Root wins for the server-runtime keys it owns, and for any key `.fabric`
    // does not already carry. Panel-managed keys present in `.fabric` keep their
    // `.fabric` value (root loses).
    if (ROOT_AUTHORITATIVE_KEYS.has(key) || !fabricHasKey) {
      if (!fabricHasKey || merged[key] !== value) {
        mergedKeys.push(key);
      }
      merged[key] = value;
    }
  }

  mkdirSync(dirname(fabricPath), { recursive: true });
  writeFileSync(fabricPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
  rmSync(rootPath, { force: true });

  result.migrated = true;
  result.mergedKeys = mergedKeys;
  return result;
}
