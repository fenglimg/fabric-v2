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
  console.log("building packages…");
  run("pnpm", ["--filter", "@fenglimg/fabric-shared", "build"], { cwd: ROOT, stdio: "inherit" });
  run("pnpm", ["--filter", "@fenglimg/fabric-server", "build"], { cwd: ROOT, stdio: "inherit" });
}

function maturityOf(path) {
  const m = readFileSync(path, "utf8").match(/^maturity:\s*(\S+)/m);
  return m?.[1] ?? null;
}

async function main() {
  ensureBuild();

  const { reviewKnowledge } = await import(SERVER_DIST);

  const work = mkdtempSync(join(tmpdir(), "fab-quality-"));
  const fabricHome = work;
  const globalRoot = join(fabricHome, ".fabric");
  const projectRoot = join(work, "project");
  // Two-layer layout: stores/personal|<group>/<uuid> (storeRelativePathForMount)
  const personalDir = join(globalRoot, "stores", "personal", PERSONAL);
  const teamDir = join(globalRoot, "stores", "team", TEAM);
  const pendingDir = join(teamDir, "knowledge", "pending", "guidelines");

  mkdirSync(join(personalDir, "knowledge"), { recursive: true });
  mkdirSync(pendingDir, { recursive: true });
  mkdirSync(join(teamDir, "knowledge", "guidelines"), { recursive: true });
  mkdirSync(join(projectRoot, ".fabric"), { recursive: true });

  process.env.FABRIC_HOME = fabricHome;

  writeFileSync(
    join(globalRoot, "fabric-global.json"),
    JSON.stringify(
      {
        uid: "u-quality-dogfood",
        stores: [
          { store_uuid: PERSONAL, alias: "personal", personal: true, writable: true },
          { store_uuid: TEAM, alias: "team", remote: "git@e:t.git", writable: true },
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

  const slug = "quality-flywheel-draft";
  const pendingPath = join(pendingDir, `${slug}.md`);
  const pendingBody = `---
type: guidelines
maturity: draft
layer: team
created_at: ${new Date().toISOString()}
source_session: sess-quality-flywheel
tags: [dogfood, quality]
x-fabric-idempotency-key: sha256:0000000000000000000000000000000000000000000000000000000000000001
---

## Summary

D4 quality flywheel dogfood: promote me from draft to verified via fab_review.

## Evidence

Hermetic e2e seed — not production knowledge.
`;
  writeFileSync(pendingPath, pendingBody, "utf8");

  try {
    const approve = await reviewKnowledge(projectRoot, {
      action: "approve",
      pending_paths: [pendingPath],
    });
    if (approve.action !== "approve" || !approve.approved?.[0]?.stable_id) {
      console.error("FAIL: approve did not return stable_id", approve);
      process.exit(1);
    }
    const { stable_id: stableId } = approve.approved[0];
    const canonicalPath = join(teamDir, "knowledge", "guidelines", `${stableId}--${slug}.md`);
    if (!existsSync(canonicalPath)) {
      console.error("FAIL: canonical missing after approve", canonicalPath);
      process.exit(1);
    }
    if (maturityOf(canonicalPath) !== "draft") {
      console.error("FAIL: expected draft after approve, got", maturityOf(canonicalPath));
      process.exit(1);
    }

    const modify = await reviewKnowledge(projectRoot, {
      action: "modify",
      pending_path: canonicalPath,
      changes: { maturity: "verified" },
    });
    if (modify.action !== "modify") {
      console.error("FAIL: modify failed", modify);
      process.exit(1);
    }
    if (maturityOf(canonicalPath) !== "verified") {
      console.error("FAIL: maturity not verified after modify", maturityOf(canonicalPath));
      process.exit(1);
    }

    console.log("PASS quality flywheel: approve + modify draft → verified");
    console.log(
      JSON.stringify(
        {
          stable_id: stableId,
          before: "draft",
          after: "verified",
          path: canonicalPath,
        },
        null,
        2,
      ),
    );
    console.log("NOTE: retire path = fab_review action=retire; no default LLM-judge auto-promote");
    process.exit(0);
  } catch (err) {
    console.error("FAIL:", err?.message ?? err);
    process.exit(1);
  } finally {
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

main();
