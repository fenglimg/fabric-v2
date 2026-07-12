#!/usr/bin/env node
/**
 * dogfood-first-value.mjs — M-first-value-loop / D5-5 regression oracle
 *
 * Hermetic FABRIC_HOME fixture (no global CLI pollution):
 *   mount team store + bind + one starter guideline → first-hit exit 0
 *
 * Prefer workspace CLI dist so monorepo changes are tested.
 *
 * Usage: pnpm run dogfood:first-value
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_DIST = join(ROOT, "packages/cli/dist/index.js");
const TEAM = "22222222-2222-4222-8222-222222222222";
const PERSONAL = "11111111-1111-4111-8111-111111111111";

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
}

function ensureBuild() {
  if (existsSync(CLI_DIST)) return;
  console.log("building packages…");
  run("pnpm", ["--filter", "@fenglimg/fabric-shared", "build"], { cwd: ROOT, stdio: "inherit" });
  run("pnpm", ["--filter", "@fenglimg/fabric-server", "build"], { cwd: ROOT, stdio: "inherit" });
  run("pnpm", ["--filter", "@fenglimg/fabric-cli", "build"], { cwd: ROOT, stdio: "inherit" });
}

function main() {
  ensureBuild();

  const work = mkdtempSync(join(tmpdir(), "fabric-first-value-"));
  const fabricHome = work;
  const projectRoot = join(work, "project");
  const globalRoot = join(fabricHome, ".fabric");
  // storeRelativePathForMount without mount_name → stores/team/<uuid>
  // (mount_name: "team" would resolve to stores/team/team — keep uuid layout).
  const teamStoreDir = join(globalRoot, "stores", "team", TEAM);
  const knowledgeDir = join(teamStoreDir, "knowledge", "guidelines");

  mkdirSync(join(projectRoot, ".fabric"), { recursive: true });
  mkdirSync(join(projectRoot, ".claude", "hooks"), { recursive: true });
  mkdirSync(knowledgeDir, { recursive: true });
  mkdirSync(join(globalRoot, "stores", "personal", PERSONAL, "knowledge"), { recursive: true });

  writeFileSync(
    join(globalRoot, "fabric-global.json"),
    JSON.stringify(
      {
        uid: "u-first-value",
        stores: [
          { store_uuid: PERSONAL, alias: "personal", personal: true, writable: true },
          {
            store_uuid: TEAM,
            alias: "team",
            remote: "git@example.com:team/first-value.git",
            writable: true,
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  writeFileSync(
    join(projectRoot, ".fabric", "fabric-config.json"),
    JSON.stringify(
      {
        version: 1,
        required_stores: [{ id: "team" }],
        active_write_store: "team",
      },
      null,
      2,
    ),
    "utf8",
  );

  writeFileSync(join(projectRoot, ".claude", "hooks", "knowledge-hint-broad.cjs"), "module.exports={};\n");
  writeFileSync(join(projectRoot, ".claude", "hooks", "knowledge-pretooluse.cjs"), "module.exports={};\n");

  // Starter knowledge so empty_store does not fire (simulates first-hit --seed result).
  writeFileSync(
    join(knowledgeDir, "KT-GLD-0001--first-value-seed.md"),
    `---
id: KT-GLD-0001
type: guidelines
layer: team
maturity: draft
relevance_scope: broad
relevance_paths: []
summary: First-value dogfood seed — proves store surface is non-empty.
created_at: 2026-07-12
---

# First-value seed

## Summary

Deterministic starter entry for dogfood:first-value.
`,
    "utf8",
  );

  const env = {
    ...process.env,
    FABRIC_HOME: fabricHome,
    HOME: work,
  };

  console.log("dogfood-first-value: workspace", ROOT);
  console.log("dogfood-first-value: FABRIC_HOME", fabricHome);

  let raw = "";
  let status = 0;
  try {
    raw = run("node", [CLI_DIST, "first-hit", "--json", "--target", projectRoot], {
      cwd: projectRoot,
      env,
    });
  } catch (err) {
    status = err.status ?? 1;
    raw = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }

  let report = null;
  const jsonMatch = raw.match(/\{[\s\S]*\}\s*$/m);
  if (jsonMatch) {
    try {
      report = JSON.parse(jsonMatch[0]);
    } catch {
      /* fall through */
    }
  }

  const ok =
    status === 0 &&
    report &&
    report.ok === true &&
    (report.code === "ok" || report.total_entries > 0);

  if (!ok) {
    console.error("G-FIRST-VALUE FAIL");
    console.error("status", status);
    console.error(raw.slice(0, 1200));
    rmSync(work, { recursive: true, force: true });
    process.exit(status || 1);
  }

  console.log("G-FIRST-VALUE PASS: first-hit exit 0 with non-empty store");
  console.log(
    JSON.stringify(
      {
        code: report.code,
        total_entries: report.total_entries,
        write_target: report.write_target,
      },
      null,
      2,
    ),
  );

  rmSync(work, { recursive: true, force: true });
  process.exit(0);
}

main();
