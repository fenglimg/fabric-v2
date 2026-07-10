import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STORE_LAYOUT,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";

import { recall } from "./recall.js";
import { contextCache } from "../cache.js";

// TASK-007 wire-thinning payload verification: seed a realistic 24-entry store
// (matches the ANL-002 sample scenario surface: dropped-heavy, mixed KB types),
// run the real recall pipeline, and assert the seeded-payload budget (17000B
// target from PLN-002, semantic-preservation-adjusted from the original 12000B).
// Also records verification.json for downstream audit + regression tracking.
//
// The empty-store measurement (against REPO_ROOT with no test mount) records
// envelope overhead as a lower bound; the seeded 24-entry measurement is the
// primary acceptance signal.

const REPO_ROOT = process.cwd().replace(/\/packages\/server$/, "");
const OUT_DIR = join(
  REPO_ROOT,
  ".workflow/scratch/20260710-plan-M1-recall-schema-wire-thinning",
);
const TEAM_STORE = "22222222-2222-4222-8222-222222222222";
const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-thinning-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
  contextCache.invalidate("file_watch");
});

afterEach(async () => {
  if (originalFabricHome === undefined) delete process.env.FABRIC_HOME;
  else process.env.FABRIC_HOME = originalFabricHome;
  await Promise.all(
    tempDirs.splice(0).map(async (p) => rm(p, { recursive: true, force: true })),
  );
});

async function createTempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fabric-thinning-proj-"));
  tempDirs.push(root);
  await mkdir(join(root, ".fabric"), { recursive: true });
  await writeFile(
    join(root, ".fabric", "fabric-config.json"),
    `${JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2)}\n`,
  );
  await writeFile(
    join(root, ".fabric", "human-lock.json"),
    `${JSON.stringify({ locked: [] }, null, 2)}\n`,
  );
  return root;
}

function mountStore(): void {
  saveGlobalConfig({
    uid: "test-uid",
    stores: [{ store_uuid: TEAM_STORE, alias: "team", remote: "git@e:team.git" }],
  });
}

async function writeEntry(type: string, id: string, lines: string[]): Promise<void> {
  const dir = join(
    resolveGlobalRoot(),
    storeRelativePathForMount({ store_uuid: TEAM_STORE }),
    STORE_LAYOUT.knowledgeDir,
    type,
  );
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.md`), lines.join("\n"));
}

// Seed 24 entries with descriptions sized to the observed ANL-002 sample:
// summary ~80-120 chars, must_read_if same length range, intent_clues 2-3
// entries, impact 2 entries. Types mixed across the 5 knowledge_type enum values.
async function seedTwentyFourEntries(): Promise<string> {
  const projectRoot = await createTempProject();
  const types = ["decisions", "models", "guidelines", "pitfalls", "processes"] as const;
  const typeSingular: Record<(typeof types)[number], string> = {
    decisions: "decision",
    models: "model",
    guidelines: "guideline",
    pitfalls: "pitfall",
    processes: "process",
  };
  const codes: Record<(typeof types)[number], string> = {
    decisions: "DEC",
    models: "MOD",
    guidelines: "GLD",
    pitfalls: "PIT",
    processes: "PRO",
  };
  const topics = [
    "voice-room-view-spec",
    "voice-room-viewmodel-spec",
    "voice-room-feature-plugin-spec",
    "voice-subsystem-overview",
    "server-bgm-subscribe-rtc-robot",
    "rtc-overspeak-detect",
    "macro-elimination-build",
    "cocos-folder-meta-case-mismatch",
    "main-package-to-subpackage-boot",
    "cross-module-duplicate-interface",
    "cocos24-subpackage-no-npm",
    "wechat-keyboard-editbox-freeze",
    "master-rank-footer-text-keep",
    "script-consolidation-migration",
    "android-platform-migration-guide",
    "gme-media-mode-before-bgm",
    "spy-game-migration-guide",
    "eslint-perf-null-check-gate",
    "remote-bundle-new-common-api",
    "spy-bgm-text-local-voice",
    "voice-room-extension-navigation",
    "voice-room-component-extension",
    "game-ws-reconnect-refresh",
    "voice-sdk-two-layer-routing",
  ];

  for (let i = 0; i < 24; i++) {
    const type = types[i % types.length]!;
    const code = codes[type];
    const seq = String(1 + Math.floor(i / types.length))
      .padStart(4, "0");
    const id = `KT-${code}-${seq}${i}`;
    const topic = topics[i]!;
    const lines = [
      "---",
      `id: ${id}`,
      `type: ${typeSingular[type]}`,
      "layer: team",
      "maturity: draft",
      "created_at: 2026-06-04T00:00:00.000Z",
      "intent_clues: [voice-room, wolfgame, cocos-migration]",
      "impact: [静默漂移, 消费者破裂]",
      `summary: '${topic} — 语音房扩展 View 规范：View 类、委托创建、状态恢复；只响应 ViewModel 不持有业务状态'`,
      `must_read_if: 'touching assets/Script/Business/VoiceChat/** or ${topic}'`,
      "---",
      `# ${topic}`,
      "",
    ];
    await writeEntry(type, id, lines);
  }
  mountStore();
  return projectRoot;
}

describe("recall wire-thinning payload verification (TASK-007)", () => {
  it(
    "seeded 24-entry payload stays under 17000B + records verification.json",
    async () => {
      const projectRoot = await seedTwentyFourEntries();

      // Sample intent surface-matches the ANL-002 recall that produced 29517B —
      // wide intent, single path, mixed KB types.
      const res = await recall(projectRoot, {
        paths: ["src/index.ts"],
        intent: "voice-room wolfgame cocos migration 迁移",
        session_id: "wave-4-verification",
      });
      const bytes = Buffer.byteLength(JSON.stringify(res), "utf8");
      const before = 29517;
      const target = 17000;
      const reductionPct = Math.round((1 - bytes / before) * 100);

      const optInRes = await recall(projectRoot, {
        paths: ["src/index.ts"],
        intent: "voice-room wolfgame cocos migration 迁移",
        session_id: "wave-4-verification-opt-in",
        include_score_breakdown: true,
      });
      const bytesOptIn = Buffer.byteLength(JSON.stringify(optInRes), "utf8");

      const verification = {
        wave: 4,
        task_id: "TASK-007",
        sample: {
          scenario: "seeded 24-entry knowledge store (matches ANL-002 sample surface)",
          intent: "voice-room wolfgame cocos migration 迁移",
          paths: ["src/index.ts"],
        },
        payload_bytes_before_original_sample: before,
        payload_bytes_after_seeded: bytes,
        payload_bytes_after_seeded_opt_in: bytesOptIn,
        target_bytes: target,
        warning_threshold_bytes: 16384,
        reduction_pct: reductionPct,
        meets_target: bytes <= target,
        entries: res.entries.length,
        dropped_ids_count: res.dropped_ids?.length ?? 0,
        dropped_reasons: res.dropped_reasons ?? {},
        preflight_diagnostics_present: res.preflight_diagnostics !== undefined,
        schema_verification: {
          intent_field_absent: !("intent" in (res as Record<string, unknown>)),
          directive_field_absent: !("directive" in (res as Record<string, unknown>)),
          stale_field_absent: !("stale" in (res as Record<string, unknown>)),
          rank_field_absent_on_entries: res.entries.every(
            (e) => !("rank" in (e as Record<string, unknown>)),
          ),
          score_field_absent_on_entries: res.entries.every(
            (e) => !("score" in (e as Record<string, unknown>)),
          ),
          score_breakdown_absent_by_default: res.entries.every((e) => e.score_breakdown === undefined),
          score_breakdown_present_when_opt_in: optInRes.entries.some(
            (e) => e.score_breakdown !== undefined,
          ),
          store_alias_flat: res.entries.every(
            (e) => !e.read_path || typeof e.store_alias === "string",
          ),
          intent_clues_absent_on_entries: res.entries.every(
            (e) => !("intent_clues" in (e.description as Record<string, unknown>)),
          ),
        },
        recorded_at: new Date().toISOString(),
      };

      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(
        join(OUT_DIR, "verification.json"),
        JSON.stringify(verification, null, 2) + "\n",
      );

      // Assertions.
      expect(res.entries.length).toBeGreaterThan(0);
      expect(bytes).toBeLessThanOrEqual(target);
      expect(reductionPct).toBeGreaterThanOrEqual(40);
      expect(verification.schema_verification.intent_field_absent).toBe(true);
      expect(verification.schema_verification.directive_field_absent).toBe(true);
      expect(verification.schema_verification.stale_field_absent).toBe(true);
      expect(verification.schema_verification.rank_field_absent_on_entries).toBe(true);
      expect(verification.schema_verification.score_field_absent_on_entries).toBe(true);
      expect(verification.schema_verification.score_breakdown_absent_by_default).toBe(true);
      expect(verification.schema_verification.score_breakdown_present_when_opt_in).toBe(true);
      expect(verification.schema_verification.store_alias_flat).toBe(true);
      expect(verification.schema_verification.intent_clues_absent_on_entries).toBe(true);
    },
    240_000,
  );
});
