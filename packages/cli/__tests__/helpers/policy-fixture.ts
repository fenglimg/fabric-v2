/**
 * config-single-home test fixtures.
 *
 * After the W3/W4 split there are three homes and a test must write to the right
 * one or the value simply has no effect:
 *
 *   IDENTITY    → `<repo>/.fabric/fabric-config.json`
 *   PREFERENCE  → `<FABRIC_HOME>/.fabric/fabric-global.json` → `defaults` /
 *                 `projects[<project_id>]`
 *   CORPUS      → `<write-target store>/store-config.json`, located through the
 *                 bindings snapshot
 *
 * `routePolicyConfig` lets existing call sites keep passing ONE flat object: it
 * splits the keys along that line. `writeStoreCorpusConfig` builds the minimal
 * store + snapshot pair a corpus knob needs.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Keys that legitimately stay in the repo config. */
export const REPO_IDENTITY_KEYS: ReadonlySet<string> = new Set([
  "project_id",
  "workspace_binding_id",
  "required_stores",
  "write_routes",
  "active_project",
  "active_write_store",
  "default_write_store",
  // Not identity, but the hooks' locale resolution (lib/banner-i18n.cjs) reads it
  // directly off the repo file. That path predates this refactor — keep the key
  // where the reader still looks.
  "fabric_language",
]);

/**
 * Split `cfg` into identity (repo file) and policy (global `defaults`) and write
 * both. The policy segment is ALWAYS rewritten — including when empty — because
 * vitest.setup.ts gives an entire test FILE one FABRIC_HOME, so a skipped write
 * would leave the previous test's defaults in place and silently alter unrelated
 * cases downstream.
 *
 * Writes into the ambient FABRIC_HOME when one is set (several suites point it at
 * a fixture home holding a bindings snapshot; clobbering that breaks store
 * resolution). Falls back to adopting `root` as the home when unset.
 */
export function routePolicyConfig(root: string, cfg: Record<string, unknown>): void {
  const identity: Record<string, unknown> = {};
  const policy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(cfg)) {
    if (REPO_IDENTITY_KEYS.has(key)) identity[key] = value;
    else policy[key] = value;
  }
  mkdirSync(join(root, ".fabric"), { recursive: true });
  writeFileSync(join(root, ".fabric", "fabric-config.json"), JSON.stringify(identity), "utf8");

  const home = process.env.FABRIC_HOME ?? root;
  process.env.FABRIC_HOME = home;
  const globalDir = join(home, ".fabric");
  mkdirSync(globalDir, { recursive: true });
  writeFileSync(
    join(globalDir, "fabric-global.json"),
    JSON.stringify({ uid: "test-uid", stores: [], defaults: policy }),
    "utf8",
  );
}

/** Same split, but the policy lands in `projects[<projectId>]` instead of `defaults`. */
export function routeProjectScopedConfig(
  root: string,
  projectId: string,
  policy: Record<string, unknown>,
): void {
  mkdirSync(join(root, ".fabric"), { recursive: true });
  writeFileSync(
    join(root, ".fabric", "fabric-config.json"),
    JSON.stringify({ project_id: projectId }),
    "utf8",
  );
  const home = process.env.FABRIC_HOME ?? root;
  process.env.FABRIC_HOME = home;
  const globalDir = join(home, ".fabric");
  mkdirSync(globalDir, { recursive: true });
  writeFileSync(
    join(globalDir, "fabric-global.json"),
    JSON.stringify({ uid: "test-uid", stores: [], projects: { [projectId]: policy } }),
    "utf8",
  );
}

/**
 * Seed a write-target store carrying `cfg` in its store-config.json, plus the
 * bindings snapshot that points at it. Returns a restore fn for FABRIC_HOME —
 * always call it (try/finally), or the override leaks into later tests in the
 * same file.
 */
export function writeStoreCorpusConfig(
  root: string,
  cfg: Record<string, unknown>,
  opts: { bindingId?: string; language?: string } = {},
): () => void {
  const prevHome = process.env.FABRIC_HOME;
  const bindingId = opts.bindingId ?? "corpus-fixture-binding";
  mkdirSync(join(root, ".fabric"), { recursive: true });
  writeFileSync(
    join(root, ".fabric", "fabric-config.json"),
    JSON.stringify({
      project_id: bindingId,
      ...(opts.language !== undefined ? { fabric_language: opts.language } : {}),
    }),
    "utf8",
  );
  process.env.FABRIC_HOME = root;
  const storeRoot = join(root, ".fabric", "stores", "team", "fixture-store");
  mkdirSync(storeRoot, { recursive: true });
  writeFileSync(join(storeRoot, "store-config.json"), JSON.stringify(cfg), "utf8");
  const snapDir = join(root, ".fabric", "state", "bindings");
  mkdirSync(snapDir, { recursive: true });
  writeFileSync(
    join(snapDir, `${bindingId}_resolved.json`),
    JSON.stringify({
      version: 1,
      project_id: bindingId,
      workspace_binding_id: bindingId,
      generated_at: "2026-01-01T00:00:00.000Z",
      read_set: { stores: [], warnings: [] },
      write_target: { store_uuid: "fixture-uuid", alias: "team" },
      write_target_store_dir: storeRoot,
    }),
    "utf8",
  );
  return () => {
    if (prevHome === undefined) delete process.env.FABRIC_HOME;
    else process.env.FABRIC_HOME = prevHome;
  };
}
