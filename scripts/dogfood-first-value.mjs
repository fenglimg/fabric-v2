#!/usr/bin/env node
/**
 * dogfood-first-value.mjs — M-first-value-loop W3
 *
 * Temp project + install-shaped fixtures + fabric first-hit oracle.
 * Prefer workspace CLI (not global) so local source changes are tested.
 *
 * Usage:
 *   pnpm run dogfood:first-value
 *   node scripts/dogfood-first-value.mjs
 *
 * Exit: 0 = ready path proves first-hit; non-zero = failure with remediations.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_DIST = join(ROOT, "packages/cli/dist/index.js");
const CLI_ENTRY = existsSync(CLI_DIST)
  ? CLI_DIST
  : join(ROOT, "packages/cli/src/index.ts");

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
}

function main() {
  const work = mkdtempSync(join(tmpdir(), "fabric-first-value-"));
  const globalRoot = join(work, "global");
  const projectRoot = join(work, "project");
  mkdirSync(globalRoot, { recursive: true });
  mkdirSync(join(projectRoot, ".fabric"), { recursive: true });
  mkdirSync(join(projectRoot, ".claude", "hooks"), { recursive: true });

  // Minimal fabric-config + hooks so first-hit can pass after seed.
  writeFileSync(
    join(projectRoot, ".fabric", "fabric-config.json"),
    JSON.stringify(
      {
        required_stores: [],
        active_write_store: null,
      },
      null,
      2,
    ),
  );
  writeFileSync(join(projectRoot, ".claude", "hooks", "knowledge-hint-broad.cjs"), "module.exports={};\n");
  writeFileSync(join(projectRoot, ".claude", "hooks", "knowledge-pretooluse.cjs"), "module.exports={};\n");

  const env = {
    ...process.env,
    FABRIC_GLOBAL_ROOT: globalRoot,
    HOME: work,
  };

  console.log("dogfood-first-value: workspace root", ROOT);
  console.log("dogfood-first-value: temp", work);

  // Build cli if dist missing
  if (!existsSync(CLI_DIST)) {
    console.log("building @fenglimg/fabric-cli …");
    run("pnpm", ["--filter", "@fenglimg/fabric-cli", "build"], { cwd: ROOT, stdio: "inherit" });
  }

  const fabric = (args) => {
    try {
      return run("node", [CLI_DIST, ...args], { cwd: projectRoot, env });
    } catch (err) {
      const e = err;
      const out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
      return out;
    }
  };

  // 1) Expect not ready (no global / unbound)
  let out = fabric(["first-hit", "--json", "--target", projectRoot]);
  console.log("step1 first-hit (expect fail):\n", out.slice(0, 400));

  // 2) Create + bind + switch-write via store ops if available
  // Prefer install --global path is heavy; use store create/bind when possible.
  out = fabric(["install", "--global", "--yes"]);
  console.log("step2 install --global (may warn):\n", String(out).slice(0, 300));

  out = fabric(["store", "create", "dogfood-first", "--yes"]);
  console.log("step3 store create:\n", String(out).slice(0, 300));

  out = fabric(["store", "bind", "dogfood-first"]);
  console.log("step4 store bind:\n", String(out).slice(0, 300));

  out = fabric(["store", "switch-write", "dogfood-first"]);
  console.log("step5 switch-write:\n", String(out).slice(0, 300));

  out = fabric(["first-hit", "--json", "--target", projectRoot]);
  console.log("step6 first-hit after bind (expect empty_store):\n", String(out).slice(0, 500));

  out = fabric(["first-hit", "--seed", "--json", "--target", projectRoot]);
  console.log("step7 first-hit --seed:\n", String(out).slice(0, 600));

  // Final gate
  let exit = 0;
  try {
    run("node", [CLI_DIST, "first-hit", "--target", projectRoot], {
      cwd: projectRoot,
      env,
      stdio: "inherit",
    });
  } catch (err) {
    exit = err.status ?? 1;
  }

  if (exit === 0) {
    console.log("\nG-FIRST-VALUE PASS: first-hit exit 0 after seed");
  } else {
    console.error(`\nG-FIRST-VALUE FAIL: first-hit exit ${exit}`);
  }

  // cleanup
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    /* keep for debug */
  }
  process.exit(exit);
}

main();
