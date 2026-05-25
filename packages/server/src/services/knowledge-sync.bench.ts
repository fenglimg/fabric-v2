/**
 * knowledge-sync.bench.test.ts — v2.0.0-rc.30 TASK-002 (G1 flip decision).
 *
 * rc.29 TASK-005 PARTIAL 加了 `autoHealOnDrift?: boolean` opt-in,但 MCP
 * tool 入口 (plan-context.ts / knowledge-sections.ts) 默认未传。FIXES.md
 * follow-up 要求"等延迟测量后翻转"。本 bench 测两件事:
 *
 * 1. **no-drift 热路径**: 99% workspace 状态。预期 baseline ≈ with-heal
 *    (autoHealOnDrift 在 events.length === 0 时 short-circuit,无 overhead)。
 * 2. **drift 命中**: 稀有事件,但本来就要付 reconcile cost — sync(flip)
 *    vs async(deferred) 区别。
 *
 * 决策规则:if with-heal_p95 / baseline_p95 <= 1.3 → flip(<30% regression)
 * 否则 PARTIAL,只加 doctor 监控,真正 flip 留 rc.31。
 *
 * 跑法: pnpm --filter @fenglimg/fabric-server exec vitest bench knowledge-sync.bench
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, bench, beforeAll, describe } from "vitest";

import { contextCache } from "../cache.js";
import { writeKnowledgeMeta } from "./knowledge-meta-builder.js";
import { ensureKnowledgeFresh } from "./knowledge-sync.js";

let originalFabricHome: string | undefined;
let noDriftRoot: string;

beforeAll(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "ks-bench-home-"));
  process.env.FABRIC_HOME = fakeHome;

  // No-drift project: seed an entry, materialize meta, never mutate.
  noDriftRoot = await mkdtemp(join(tmpdir(), "ks-bench-nodrift-"));
  for (const sub of ["decisions", "pitfalls", "guidelines", "models", "processes", "pending"]) {
    await mkdir(join(noDriftRoot, ".fabric", "knowledge", sub), { recursive: true });
  }
  await writeFile(
    join(noDriftRoot, ".fabric/knowledge/decisions/d1.md"),
    [
      "---",
      "id: KT-DEC-0001",
      "type: decisions",
      "maturity: verified",
      "layer: team",
      "summary: bench fixture",
      "created_at: 2026-05-25T00:00:00Z",
      "---",
      "# KT-DEC-0001",
      "",
      "Stable body.",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeKnowledgeMeta(noDriftRoot, { source: "doctor_fix" });
  await writeFile(join(noDriftRoot, ".fabric/events.jsonl"), "", "utf8");
});

afterAll(async () => {
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  await rm(noDriftRoot, { recursive: true, force: true });
});

describe("ensureKnowledgeFresh — no-drift hot path (G1 flip decision)", () => {
  // Invalidate per-iteration so we measure the real path each time
  // (otherwise contextCache.get short-circuits after iteration 1).
  bench(
    "baseline: ensureKnowledgeFresh()",
    async () => {
      contextCache.invalidate("file_watch", noDriftRoot);
      await ensureKnowledgeFresh(noDriftRoot);
    },
    { iterations: 100 },
  );

  bench(
    "with-heal: ensureKnowledgeFresh({ autoHealOnDrift: true })",
    async () => {
      contextCache.invalidate("file_watch", noDriftRoot);
      await ensureKnowledgeFresh(noDriftRoot, { autoHealOnDrift: true });
    },
    { iterations: 100 },
  );
});
