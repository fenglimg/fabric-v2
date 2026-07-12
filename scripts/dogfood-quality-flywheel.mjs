#!/usr/bin/env node
/**
 * dogfood-quality-flywheel.mjs — D4-3 oracle
 *
 * Isolated FABRIC_HOME + team store fixture:
 *   seed pending draft → reviewKnowledge approve → modify maturity draft→verified
 *   assert observable maturity change on the canonical file.
 *
 * D4-5: does NOT enable LLM-judge auto-promote.
 *
 * Usage: pnpm run dogfood:quality-flywheel
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIST = join(ROOT, "packages/server/dist/index.js");
const PERSONAL = "11111111-1111-4111-8111-111111111111";
const TEAM = "22222222-2222-4222-8222-222222222222";

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
}

function ensureBuild() {
  if (existsSync(SERVER_DIST)) return;
  console.log("building packages for quality flywheel…");
  run("pnpm", ["--filter", "@fenglimg/fabric-shared", "build"], { cwd: ROOT, stdio: "inherit" });
  run("pnpm", ["--filter", "@fenglimg/fabric-server", "build"], { cwd: ROOT, stdio: "inherit" });
}

function maturityOf(path) {
  const m = readFileSync(path, "utf8").match(/^maturity:\s*(\S+)/mu);
  return m?.[1] ?? null;
}

async function main() {
  ensureBuild();

  const work = mkdtempSync(join(tmpdir(), "fab-quality-"));
  const fabricHome = work;
  process.env.FABRIC_HOME = fabricHome;
  process.env.HOME = work;

  const projectRoot = join(work, "project");
  mkdirSync(join(projectRoot, ".fabric"), { recursive: true });
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

  // Mirror review.test provisionStores: global + mount dirs under FABRIC_HOME/.fabric
  const globalRoot = join(fabricHome, ".fabric");
  mkdirSync(globalRoot, { recursive: true });
  writeFileSync(
    join(globalRoot, "fabric-global.json"),
    JSON.stringify(
      {
        uid: "u-quality-dogfood",
        stores: [
          { store_uuid: PERSONAL, alias: "personal", personal: true, writable: true },
          {
            store_uuid: TEAM,
            alias: "team",
            remote: "git@example:team.git",
            writable: true,
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  const teamStoreDir = join(globalRoot, "stores", TEAM);
  const pendingDir = join(teamStoreDir, "knowledge", "pending", "decisions");
  mkdirSync(pendingDir, { recursive: true });
  mkdirSync(join(globalRoot, "stores", PERSONAL, "knowledge"), { recursive: true });

  const slug = "quality-flywheel-seed";
  const pendingPath = join(pendingDir, `${slug}.md`);
  writeFileSync(
    pendingPath,
    [
      "---",
      "type: decisions",
      "maturity: draft",
      "layer: team",
      `created_at: ${new Date().toISOString()}`,
      "source_session: dogfood-quality-flywheel",
      "tags: [dogfood, quality]",
      "x-fabric-idempotency-key: sha256:0000000000000000000000000000000000000000000000000000000000000001",
      "---",
      "",
      "## Summary",
      "",
      "Deterministic D4 quality flywheel seed — promote draft to verified via fab_review.",
      "",
    ].join("\n"),
    "utf8",
  );

  // Init git so approve's git-aware paths do not explode if they touch projectRoot.
  try {
    run("git", ["init", "--quiet"], { cwd: projectRoot });
    run("git", ["config", "user.email", "dogfood@example.com"], { cwd: projectRoot });
    run("git", ["config", "user.name", "Fabric Dogfood"], { cwd: projectRoot });
  } catch {
    /* non-fatal */
  }

  const { reviewKnowledge } = await import(SERVER_DIST);

  const approve = await reviewKnowledge(projectRoot, {
    action: "approve",
    pending_paths: [pendingPath],
  });

  if (approve.action !== "approve" || !approve.approved?.[0]?.stable_id) {
    console.error("FAIL: approve did not return stable_id", approve);
    rmSync(work, { recursive: true, force: true });
    process.exit(1);
  }

  const stableId = approve.approved[0].stable_id;
  const canonicalPath = join(
    teamStoreDir,
    "knowledge",
    "decisions",
    `${stableId}--${slug}.md`,
  );

  if (!existsSync(canonicalPath)) {
    console.error("FAIL: canonical missing after approve:", canonicalPath);
    rmSync(work, { recursive: true, force: true });
    process.exit(1);
  }

  const before = maturityOf(canonicalPath);
  if (before !== "draft") {
    console.error("FAIL: post-approve maturity expected draft, got", before);
    rmSync(work, { recursive: true, force: true });
    process.exit(1);
  }

  const modify = await reviewKnowledge(projectRoot, {
    action: "modify",
    pending_path: canonicalPath,
    changes: { maturity: "verified" },
  });

  if (modify.action !== "modify") {
    console.error("FAIL: modify action unexpected", modify);
    rmSync(work, { recursive: true, force: true });
    process.exit(1);
  }

  const after = maturityOf(canonicalPath);
  if (after !== "verified") {
    console.error("FAIL: maturity not verified after modify, got", after);
    rmSync(work, { recursive: true, force: true });
    process.exit(1);
  }

  console.log("PASS quality flywheel: draft → verified via reviewKnowledge");
  console.log(
    JSON.stringify(
      {
        stable_id: stableId,
        before,
        after,
        path: canonicalPath,
        note: "retire path = fab_review action=retire; no default LLM-judge auto-promote",
      },
      null,
      2,
    ),
  );

  rmSync(work, { recursive: true, force: true });
  process.exit(0);
}

main().catch((err) => {
  console.error("FAIL quality flywheel:", err);
  process.exit(1);
});
