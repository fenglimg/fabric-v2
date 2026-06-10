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

import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, lstatSync, readlinkSync, symlinkSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const { deriveMountLabel, storeMountSubPath, STORES_ROOT_DIR } = await import(
  join(here, "..", "packages", "shared", "dist", "index.js")
);

const STORE_BY_ALIAS_DIR = "by-alias";

function resolveGlobalRoot() {
  const home = process.env.FABRIC_HOME;
  return home === undefined ? join(homedir(), ".fabric") : join(home, ".fabric");
}

function tsStamp() {
  // Avoid Date in tests? This is a one-shot CLI script; plain timestamp is fine.
  return new Date().toISOString().replace(/[:.]/gu, "-");
}

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function main() {
  const globalRoot = resolveGlobalRoot();
  const configPath = join(globalRoot, "fabric-global.json");
  if (!existsSync(configPath)) {
    log(`no fabric-global.json at ${configPath} — nothing to migrate`);
    return;
  }

  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const stores = Array.isArray(config.stores) ? config.stores : [];
  if (stores.length === 0) {
    log("no mounted stores — nothing to migrate");
    return;
  }

  // 1) Back up the entire ~/.fabric before touching anything.
  const backup = `${globalRoot}.bak-${tsStamp()}`;
  cpSync(globalRoot, backup, { recursive: true });
  log(`backed up ${globalRoot} → ${backup}`);

  const storesRoot = join(globalRoot, STORES_ROOT_DIR);
  const tmpRoot = join(storesRoot, ".__mig_two_layer");
  rmSync(tmpRoot, { recursive: true, force: true });

  // 2) Plan moves: for each store compute its NEW two-layer subpath + label,
  //    and its CURRENT on-disk location (old single-layer `mount_name`|uuid).
  const plan = [];
  for (const s of stores) {
    const label = deriveMountLabel({ remote: s.remote, alias: s.alias, store_uuid: s.store_uuid });
    const newSub = storeMountSubPath({ store_uuid: s.store_uuid, mount_name: label, personal: s.personal === true });
    const newDir = join(storesRoot, newSub);
    const oldSingle = s.mount_name ?? s.store_uuid;
    const oldDir = join(storesRoot, oldSingle);
    plan.push({ store: s, label, newSub, newDir, oldDir, oldSingle });
  }

  // 3) Stage every store dir into a temp area (old names collide with the new
  //    group bucket names, e.g. old `stores/personal` vs new group `personal/`).
  let staged = 0;
  for (const p of plan) {
    if (existsSync(p.newDir) && existsSync(join(p.newDir, "store.json"))) {
      log(`already two-layer: ${p.newSub} — skipping`);
      continue;
    }
    if (!existsSync(join(p.oldDir, "store.json"))) {
      log(`WARN: no store tree at ${p.oldDir} (store.json missing) — skipping ${p.store.alias}`);
      continue;
    }
    mkdirSync(tmpRoot, { recursive: true });
    const stagePath = join(tmpRoot, p.store.store_uuid);
    renameSync(p.oldDir, stagePath);
    p.stagePath = stagePath;
    staged += 1;
  }

  // 4) Drop the old by-alias layer (rebuilt below against the new paths).
  rmSync(join(storesRoot, STORE_BY_ALIAS_DIR), { recursive: true, force: true });

  // 5) Move each staged store into its two-layer destination.
  for (const p of plan) {
    if (p.stagePath === undefined) continue;
    mkdirSync(join(p.newDir, ".."), { recursive: true }); // the `stores/<group>/` bucket
    renameSync(p.stagePath, p.newDir);
    log(`moved ${p.oldSingle} → ${p.newSub}`);
  }
  rmSync(tmpRoot, { recursive: true, force: true });

  // 6) Update the registry: mount_name becomes the new label.
  for (const p of plan) {
    p.store.mount_name = p.label;
  }
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  log("updated fabric-global.json mount_name labels");

  // 7) Rebuild the by-alias readability symlinks against the two-layer paths.
  rebuildByAlias(globalRoot, stores);
  log("migration complete");
}

function rebuildByAlias(globalRoot, stores) {
  const byAliasDir = join(globalRoot, STORES_ROOT_DIR, STORE_BY_ALIAS_DIR);
  mkdirSync(byAliasDir, { recursive: true });
  // Remove anything stale.
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

main();
