#!/usr/bin/env node
// grill ④ — migrate a user's real ~/.fabric store layout from the single-layer
// `stores/<mount_name>/` to the two-layer `stores/<group>/<label>/` shape.
//
//   group  = personal | team, derived from each store's `personal:true` flag.
//   label  = deriveMountLabel(remote → repo name, else alias, else short uuid).
//
// The store's identity is NEVER touched (store.json/store_uuid are immutable);
// only the on-disk directory and the registry's `mount_name` label move. A full
// `cp -r` backup of ~/.fabric is taken first. Idempotent: a store already at its
// two-layer path is left alone.
//
// Usage:  node scripts/migrate-two-layer-stores.mjs          (real ~/.fabric)
//         FABRIC_HOME=/tmp/x node scripts/migrate-two-layer-stores.mjs  (test root)

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const STORE_BY_ALIAS_DIR = "by-alias";

export function resolveGlobalRoot() {
  const home = process.env.FABRIC_HOME;
  return home === undefined ? join(homedir(), ".fabric") : join(home, ".fabric");
}

function tsStamp() {
  return new Date().toISOString().replace(/[:.]/gu, "-");
}

// The migration core. `deps` injects the layout helpers (deriveMountLabel /
// storeMountSubPath / storesRootDir) so the SAME logic the CLI ships is used
// while staying unit-testable without loading the built dist. `log` is injected
// (defaults to stdout) so tests can stay quiet. Returns a summary for asserts.
export function migrateTwoLayer({ globalRoot, deriveMountLabel, storeMountSubPath, storesRootDir, backup = true, log = (m) => process.stdout.write(`${m}\n`) }) {
  const configPath = join(globalRoot, "fabric-global.json");
  if (!existsSync(configPath)) {
    log(`no fabric-global.json at ${configPath} — nothing to migrate`);
    return { migrated: [], skipped: [], backup: null };
  }

  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const stores = Array.isArray(config.stores) ? config.stores : [];
  if (stores.length === 0) {
    log("no mounted stores — nothing to migrate");
    return { migrated: [], skipped: [], backup: null };
  }

  // 1) Back up the entire ~/.fabric before touching anything.
  let backupPath = null;
  if (backup) {
    backupPath = `${globalRoot}.bak-${tsStamp()}`;
    cpSync(globalRoot, backupPath, { recursive: true });
    log(`backed up ${globalRoot} → ${backupPath}`);
  }

  const storesRoot = join(globalRoot, storesRootDir);
  const tmpRoot = join(storesRoot, ".__mig_two_layer");
  rmSync(tmpRoot, { recursive: true, force: true });

  // 2) Plan moves: NEW two-layer subpath + label vs CURRENT single-layer dir.
  const plan = [];
  for (const s of stores) {
    const label = deriveMountLabel({ remote: s.remote, alias: s.alias, store_uuid: s.store_uuid });
    const newSub = storeMountSubPath({ store_uuid: s.store_uuid, mount_name: label, personal: s.personal === true });
    const newDir = join(storesRoot, newSub);
    const oldSingle = s.mount_name ?? s.store_uuid;
    const oldDir = join(storesRoot, oldSingle);
    plan.push({ store: s, label, newSub, newDir, oldDir, oldSingle });
  }

  // 3) Stage every store dir into a temp area (old single-layer names collide
  //    with the new group bucket names, e.g. old `stores/personal` vs `personal/`).
  const migrated = [];
  const skipped = [];
  for (const p of plan) {
    if (existsSync(join(p.newDir, "store.json"))) {
      log(`already two-layer: ${p.newSub} — skipping`);
      skipped.push(p.store.alias);
      continue;
    }
    if (!existsSync(join(p.oldDir, "store.json"))) {
      log(`WARN: no store tree at ${p.oldDir} (store.json missing) — skipping ${p.store.alias}`);
      skipped.push(p.store.alias);
      continue;
    }
    mkdirSync(tmpRoot, { recursive: true });
    const stagePath = join(tmpRoot, p.store.store_uuid);
    renameSync(p.oldDir, stagePath);
    p.stagePath = stagePath;
  }

  // 4) Drop the old by-alias layer (rebuilt below against the new paths).
  rmSync(join(storesRoot, STORE_BY_ALIAS_DIR), { recursive: true, force: true });

  // 5) Move each staged store into its two-layer destination.
  for (const p of plan) {
    if (p.stagePath === undefined) continue;
    mkdirSync(join(p.newDir, ".."), { recursive: true }); // the `stores/<group>/` bucket
    renameSync(p.stagePath, p.newDir);
    p.store.mount_name = p.label; // 6) registry label becomes the new label
    migrated.push(p.store.alias);
    log(`moved ${p.oldSingle} → ${p.newSub}`);
  }
  rmSync(tmpRoot, { recursive: true, force: true });

  // For idempotent re-runs the labels must still reflect the new layout even when
  // nothing moved (already-two-layer stores).
  for (const p of plan) {
    p.store.mount_name = p.label;
  }
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  log("updated fabric-global.json mount_name labels");

  // 7) Rebuild the by-alias readability symlinks against the two-layer paths.
  rebuildByAlias({ globalRoot, stores, storesRootDir, storeMountSubPath, log });
  log("migration complete");
  return { migrated, skipped, backup: backupPath };
}

function rebuildByAlias({ globalRoot, stores, storesRootDir, storeMountSubPath, log }) {
  const byAliasDir = join(globalRoot, storesRootDir, STORE_BY_ALIAS_DIR);
  mkdirSync(byAliasDir, { recursive: true });
  for (const name of readdirSync(byAliasDir)) {
    rmSync(join(byAliasDir, name), { force: true, recursive: false });
  }
  for (const s of stores) {
    const sub = storeMountSubPath({ store_uuid: s.store_uuid, mount_name: s.mount_name, personal: s.personal === true });
    const link = join(byAliasDir, s.alias);
    const target = join("..", sub);
    try {
      symlinkSync(target, link);
      log(`by-alias: ${s.alias} → ${target}`);
    } catch (err) {
      log(`WARN: could not link by-alias/${s.alias} (${err.code ?? err.message})`);
    }
  }
}

// CLI entry — only when run directly (not when imported by a test). Loads the
// layout helpers from the built shared dist so the migration matches shipped code.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const { deriveMountLabel, storeMountSubPath, STORES_ROOT_DIR } = await import(
    join(here, "..", "packages", "shared", "dist", "index.js")
  );
  migrateTwoLayer({
    globalRoot: resolveGlobalRoot(),
    deriveMountLabel,
    storeMountSubPath,
    storesRootDir: STORES_ROOT_DIR,
  });
}
