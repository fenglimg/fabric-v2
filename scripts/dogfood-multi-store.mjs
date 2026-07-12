#!/usr/bin/env node
/**
 * dogfood-multi-store.mjs — D3 oracle: required team not mounted → missing_required
 *
 * Uses workspace CLI dist + FABRIC_HOME isolation (same pattern as dogfood-first-value).
 *
 *   pnpm run dogfood:multi-store
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_DIST = join(ROOT, "packages/cli/dist/index.js");

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

  const work = mkdtempSync(join(tmpdir(), "fabric-multi-store-"));
  // resolveGlobalRoot() => join(FABRIC_HOME, ".fabric")
  const fabricHome = work;
  const globalRoot = join(fabricHome, ".fabric");
  const projectRoot = join(work, "project");
  mkdirSync(globalRoot, { recursive: true });
  mkdirSync(join(projectRoot, ".fabric"), { recursive: true });
  mkdirSync(join(projectRoot, ".claude", "hooks"), { recursive: true });

  // Only personal mounted — required team is missing (D3-1/D3-2 fail path).
  writeFileSync(
    join(globalRoot, "fabric-global.json"),
    JSON.stringify(
      {
        uid: "u-dog-ms",
        stores: [
          {
            store_uuid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            alias: "personal",
            personal: true,
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

  const env = {
    ...process.env,
    FABRIC_HOME: fabricHome,
    HOME: work,
  };

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

  // Parse last JSON object in output (CLI may paint before JSON).
  let report = null;
  const jsonMatch = raw.match(/\{[\s\S]*\}\s*$/m);
  if (jsonMatch) {
    try {
      report = JSON.parse(jsonMatch[0]);
    } catch {
      /* fall through */
    }
  }

  const okFail =
    report &&
    report.ok === false &&
    (report.code === "missing_required" ||
      (Array.isArray(report.missing_required_ids) &&
        report.missing_required_ids.includes("team")));

  // Also accept non-zero exit + message containing missing_required when JSON is plain text.
  const textOk =
    !report &&
    status !== 0 &&
    /missing_required/i.test(raw);

  if (okFail || textOk) {
    console.log("PASS missing_required (D3 multi-store dogfood)");
    if (report) console.log(JSON.stringify({ code: report.code, missing: report.missing_required_ids }, null, 2));
    rmSync(work, { recursive: true, force: true });
    process.exit(0);
  }

  console.error("FAIL expected missing_required");
  console.error("exit:", status);
  console.error(raw.slice(0, 1200));
  // keep work dir for debug
  console.error("fixture kept at", work);
  process.exit(1);
}

main();
