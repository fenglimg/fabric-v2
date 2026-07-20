import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { saveGlobalConfig } from "@fenglimg/fabric-shared";

import {
  DEFAULT_EMBED_MODEL,
  PLAN_CONTEXT_TOP_K_DEFAULT,
  RECALL_RELEVANCE_RATIO_DEFAULT,
  readConflictLintThreshold,
  readCredibilityHalfLives,
  readDefaultLayerFilter,
  readEmbedConfig,
  readOrphanDemoteThresholdDays,
  readPlanContextTopK,
  readRecallRelevanceRatio,
  readSelectionTokenTtlMs,
  resolveStoreConfig,
} from "./config-loader.js";
import { resolveWriteTargetStoreDir } from "./services/cross-store-write.js";

// ---------------------------------------------------------------------------
// config-layering W2 (TASK-002): env > project > store > default cascade.
//
// The 7-case norm PER cascade knob:
//   1. env-only            → env wins
//   2. project-only        → project value
//   3. store-only          → store value
//   4. env > project       → env beats project
//   5. project > store     → project beats store (C-004)
//   6. full fallthrough    → library default
//   7. malformed-at-a-layer → falls through to the lower layer (never throws)
//
// STORE-layer cases require a real resolved team store root, so the fixture
// mirrors write-scope-meta.test.ts: fake FABRIC_HOME + mounted stores + a repo
// bound to the team store, with store-config.json written at the resolved root.
// ---------------------------------------------------------------------------

const TEAM = "22222222-2222-4222-8222-222222222222";
const PERSONAL = "33333333-3333-4333-8333-333333333333";

// Every FABRIC_* env this suite manipulates — snapshot + restore so a case that
// sets an env override never bleeds into the next.
const TOUCHED_ENV = [
  "FABRIC_PLAN_CONTEXT_TOP_K",
  "FABRIC_RECALL_RELEVANCE_RATIO",
  "FABRIC_EMBED_WEIGHT",
  "FABRIC_EMBED_MODEL",
  "FABRIC_EMBED_ENDPOINT",
  "FABRIC_EMBED_API_KEY",
  "FABRIC_DEFAULT_LAYER_FILTER",
  "FABRIC_SELECTION_TOKEN_TTL_MS",
  "FABRIC_CONFLICT_LINT_SIMILARITY_THRESHOLD",
  "FABRIC_CREDIBILITY_HALF_LIFE_DECISIONS_DAYS",
  "FABRIC_ORPHAN_DEMOTE_PROVEN_DAYS",
] as const;

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;
const envSnapshot: Record<string, string | undefined> = {};

beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  for (const key of TOUCHED_ENV) {
    envSnapshot[key] = process.env[key];
    delete process.env[key];
  }
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-cascade-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
});

afterEach(async () => {
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  for (const key of TOUCHED_ENV) {
    const prior = envSnapshot[key];
    if (prior === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prior;
    }
  }
  await Promise.all(tempDirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

function mountStores(): void {
  saveGlobalConfig({
    uid: "test-uid",
    stores: [
      { store_uuid: PERSONAL, alias: "personal", personal: true, writable: true },
      { store_uuid: TEAM, alias: "team", remote: "git@e:t.git", writable: true },
    ],
  });
}

// A repo bound to the team store (so the STORE layer resolves), with an optional
// project fabric-config.json and an optional store-config.json.
async function makeRepo(opts: {
  projectConfig?: object;
  storeConfig?: object | string;
  bindTeam?: boolean;
}): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-cascade-proj-"));
  tempDirs.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  const bind = opts.bindTeam !== false;
  const baseConfig = bind ? { required_stores: [{ id: "team" }], active_write_store: "team" } : {};
  const merged = { ...baseConfig, ...(opts.projectConfig ?? {}) };
  if (opts.projectConfig !== undefined || bind) {
    await writeFile(
      join(projectRoot, ".fabric", "fabric-config.json"),
      typeof opts.projectConfig === "string" ? opts.projectConfig : `${JSON.stringify(merged, null, 2)}\n`,
    );
  }
  if (opts.storeConfig !== undefined) {
    if (bind) {
      mountStores();
    }
    const storeRoot = resolveWriteTargetStoreDir("team", projectRoot);
    await mkdir(storeRoot, { recursive: true });
    await writeFile(
      join(storeRoot, "store-config.json"),
      typeof opts.storeConfig === "string" ? opts.storeConfig : `${JSON.stringify(opts.storeConfig, null, 2)}\n`,
    );
  } else if (bind) {
    mountStores();
  }
  return projectRoot;
}

// Write a raw (possibly-malformed) project fabric-config.json body.
async function makeRawProjectRepo(rawBody: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-cascade-raw-"));
  tempDirs.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  await writeFile(join(projectRoot, ".fabric", "fabric-config.json"), rawBody);
  return projectRoot;
}

describe("resolveStoreConfig — store-layer source (criteria 5, 6)", () => {
  it("returns {} when no team write-target resolves (unbound repo, never throws)", async () => {
    const projectRoot = await makeRepo({ bindTeam: false });
    expect(resolveStoreConfig(projectRoot)).toEqual({});
  });

  it("returns {} when the team store has no store-config.json", async () => {
    const projectRoot = await makeRepo({});
    expect(resolveStoreConfig(projectRoot)).toEqual({});
  });

  it("returns {} on malformed store-config JSON (never throws)", async () => {
    const projectRoot = await makeRepo({ storeConfig: "{ not json" });
    expect(resolveStoreConfig(projectRoot)).toEqual({});
  });

  it("returns {} when store-config fails schema (out-of-range dropped by lenient root)", async () => {
    // plan_context_top_k out of range → schema strips? storeConfigSchema field
    // is .optional() with a max — an out-of-range value fails safeParse → {}.
    const projectRoot = await makeRepo({ storeConfig: { plan_context_top_k: 9999 } });
    expect(resolveStoreConfig(projectRoot)).toEqual({});
  });

  it("parses a valid store-config from the store ROOT (parallel to store.json)", async () => {
    const projectRoot = await makeRepo({ storeConfig: { plan_context_top_k: 42, embed_model: "fast-multilingual-e5-large" } });
    expect(resolveStoreConfig(projectRoot)).toMatchObject({
      plan_context_top_k: 42,
      embed_model: "fast-multilingual-e5-large",
    });
  });
});

describe("readPlanContextTopK — 7-case cascade (int knob)", () => {
  it("1. env-only wins", async () => {
    process.env.FABRIC_PLAN_CONTEXT_TOP_K = "77";
    const projectRoot = await makeRepo({ bindTeam: false });
    expect(readPlanContextTopK(projectRoot)).toBe(77);
  });

  it("2. project-only", async () => {
    const projectRoot = await makeRepo({ projectConfig: { plan_context_top_k: 55 }, bindTeam: false });
    expect(readPlanContextTopK(projectRoot)).toBe(55);
  });

  it("3. store-only", async () => {
    const projectRoot = await makeRepo({ storeConfig: { plan_context_top_k: 33 } });
    expect(readPlanContextTopK(projectRoot)).toBe(33);
  });

  it("4. env beats project", async () => {
    process.env.FABRIC_PLAN_CONTEXT_TOP_K = "77";
    const projectRoot = await makeRepo({ projectConfig: { plan_context_top_k: 55 }, bindTeam: false });
    expect(readPlanContextTopK(projectRoot)).toBe(77);
  });

  it("5. project beats store (C-004)", async () => {
    const projectRoot = await makeRepo({ projectConfig: { plan_context_top_k: 55 }, storeConfig: { plan_context_top_k: 33 } });
    expect(readPlanContextTopK(projectRoot)).toBe(55);
  });

  it("6. full fallthrough → default", async () => {
    const projectRoot = await makeRepo({ bindTeam: false });
    expect(readPlanContextTopK(projectRoot)).toBe(PLAN_CONTEXT_TOP_K_DEFAULT);
  });

  it("7a. malformed env value falls through to project", async () => {
    process.env.FABRIC_PLAN_CONTEXT_TOP_K = "not-a-number";
    const projectRoot = await makeRepo({ projectConfig: { plan_context_top_k: 55 }, bindTeam: false });
    expect(readPlanContextTopK(projectRoot)).toBe(55);
  });

  it("7b. malformed project VALUE falls through (store layer also collapses under a strict-invalid project config → default)", async () => {
    // A strict-invalid project field makes loadProjectConfig throw during store
    // resolution, so the store layer is unavailable and the value falls to default.
    const projectRoot = await makeRepo({ projectConfig: { plan_context_top_k: "abc" }, bindTeam: false });
    expect(readPlanContextTopK(projectRoot)).toBe(PLAN_CONTEXT_TOP_K_DEFAULT);
  });

  it("7c. malformed store VALUE falls through to default", async () => {
    const projectRoot = await makeRepo({ storeConfig: { plan_context_top_k: -9 } });
    expect(readPlanContextTopK(projectRoot)).toBe(PLAN_CONTEXT_TOP_K_DEFAULT);
  });

  it("7d. malformed project JSON file falls through (never throws)", async () => {
    const projectRoot = await makeRawProjectRepo("{ this is : not json");
    expect(readPlanContextTopK(projectRoot)).toBe(PLAN_CONTEXT_TOP_K_DEFAULT);
  });
});

describe("readRecallRelevanceRatio — 7-case cascade (float knob)", () => {
  it("1. env-only", async () => {
    process.env.FABRIC_RECALL_RELEVANCE_RATIO = "0.9";
    const projectRoot = await makeRepo({ bindTeam: false });
    expect(readRecallRelevanceRatio(projectRoot)).toBe(0.9);
  });

  it("2. project-only", async () => {
    const projectRoot = await makeRepo({ projectConfig: { recall_relevance_ratio: 0.6 }, bindTeam: false });
    expect(readRecallRelevanceRatio(projectRoot)).toBe(0.6);
  });

  it("3. store-only", async () => {
    const projectRoot = await makeRepo({ storeConfig: { recall_relevance_ratio: 0.4 } });
    expect(readRecallRelevanceRatio(projectRoot)).toBe(0.4);
  });

  it("4. env beats project", async () => {
    process.env.FABRIC_RECALL_RELEVANCE_RATIO = "0.9";
    const projectRoot = await makeRepo({ projectConfig: { recall_relevance_ratio: 0.6 }, bindTeam: false });
    expect(readRecallRelevanceRatio(projectRoot)).toBe(0.9);
  });

  it("5. project beats store", async () => {
    const projectRoot = await makeRepo({ projectConfig: { recall_relevance_ratio: 0.6 }, storeConfig: { recall_relevance_ratio: 0.4 } });
    expect(readRecallRelevanceRatio(projectRoot)).toBe(0.6);
  });

  it("6. fallthrough → default", async () => {
    const projectRoot = await makeRepo({ bindTeam: false });
    expect(readRecallRelevanceRatio(projectRoot)).toBe(RECALL_RELEVANCE_RATIO_DEFAULT);
  });

  it("7. out-of-range at project value falls through to default (store layer needs a valid project config)", async () => {
    const projectRoot = await makeRepo({ projectConfig: { recall_relevance_ratio: 1.5 }, bindTeam: false });
    expect(readRecallRelevanceRatio(projectRoot)).toBe(RECALL_RELEVANCE_RATIO_DEFAULT);
  });
});

describe("readDefaultLayerFilter — 7-case cascade (enum knob)", () => {
  it("1. env-only", async () => {
    process.env.FABRIC_DEFAULT_LAYER_FILTER = "personal";
    const projectRoot = await makeRepo({ bindTeam: false });
    expect(readDefaultLayerFilter(projectRoot)).toBe("personal");
  });

  it("2. project-only", async () => {
    const projectRoot = await makeRepo({ projectConfig: { default_layer_filter: "team" }, bindTeam: false });
    expect(readDefaultLayerFilter(projectRoot)).toBe("team");
  });

  it("3. store-only", async () => {
    const projectRoot = await makeRepo({ storeConfig: { default_layer_filter: "personal" } });
    expect(readDefaultLayerFilter(projectRoot)).toBe("personal");
  });

  it("5. project beats store", async () => {
    const projectRoot = await makeRepo({ projectConfig: { default_layer_filter: "team" }, storeConfig: { default_layer_filter: "personal" } });
    expect(readDefaultLayerFilter(projectRoot)).toBe("team");
  });

  it("6. fallthrough → both", async () => {
    const projectRoot = await makeRepo({ bindTeam: false });
    expect(readDefaultLayerFilter(projectRoot)).toBe("both");
  });

  it("7. unrecognized env value falls through to store", async () => {
    process.env.FABRIC_DEFAULT_LAYER_FILTER = "garbage";
    const projectRoot = await makeRepo({ storeConfig: { default_layer_filter: "team" } });
    expect(readDefaultLayerFilter(projectRoot)).toBe("team");
  });
});

describe("readSelectionTokenTtlMs — cascade preserves undefined-means-fallback", () => {
  it("env-only", async () => {
    process.env.FABRIC_SELECTION_TOKEN_TTL_MS = "600000";
    const projectRoot = await makeRepo({ bindTeam: false });
    expect(readSelectionTokenTtlMs(projectRoot)).toBe(600_000);
  });

  it("store-only", async () => {
    const projectRoot = await makeRepo({ storeConfig: { selection_token_ttl_ms: 90_000 } });
    expect(readSelectionTokenTtlMs(projectRoot)).toBe(90_000);
  });

  it("project beats store", async () => {
    const projectRoot = await makeRepo({ projectConfig: { selection_token_ttl_ms: 120_000 }, storeConfig: { selection_token_ttl_ms: 90_000 } });
    expect(readSelectionTokenTtlMs(projectRoot)).toBe(120_000);
  });

  it("no layer → undefined (caller falls back to its own default, not a made-up number)", async () => {
    const projectRoot = await makeRepo({ bindTeam: false });
    expect(readSelectionTokenTtlMs(projectRoot)).toBeUndefined();
  });

  it("out-of-range at every layer → undefined (never throws)", async () => {
    process.env.FABRIC_SELECTION_TOKEN_TTL_MS = "10"; // below 30s
    const projectRoot = await makeRepo({ storeConfig: { selection_token_ttl_ms: 5 } });
    expect(readSelectionTokenTtlMs(projectRoot)).toBeUndefined();
  });
});

describe("readConflictLintThreshold — cascade preserves undefined-means-fallback", () => {
  it("store-only", async () => {
    const projectRoot = await makeRepo({ storeConfig: { conflict_lint_similarity_threshold: 0.7 } });
    expect(readConflictLintThreshold(projectRoot)).toBe(0.7);
  });

  it("project beats store", async () => {
    const projectRoot = await makeRepo({ projectConfig: { conflict_lint_similarity_threshold: 0.3 }, storeConfig: { conflict_lint_similarity_threshold: 0.7 } });
    expect(readConflictLintThreshold(projectRoot)).toBe(0.3);
  });

  it("no layer → undefined", async () => {
    const projectRoot = await makeRepo({ bindTeam: false });
    expect(readConflictLintThreshold(projectRoot)).toBeUndefined();
  });
});

describe("readEmbedConfig — model cascade + machine-layer remote secrets (criterion 8)", () => {
  it("model: env FABRIC_EMBED_MODEL wins", async () => {
    process.env.FABRIC_EMBED_MODEL = "fast-bge-base-en-v1.5";
    const projectRoot = await makeRepo({ projectConfig: { embed_model: "fast-bge-small-en" }, bindTeam: false });
    expect(readEmbedConfig(projectRoot).model).toBe("fast-bge-base-en-v1.5");
  });

  it("model: project beats store", async () => {
    const projectRoot = await makeRepo({ projectConfig: { embed_model: "fast-bge-small-en" }, storeConfig: { embed_model: "fast-multilingual-e5-large" } });
    expect(readEmbedConfig(projectRoot).model).toBe("fast-bge-small-en");
  });

  it("model: store-layer participates when project absent", async () => {
    const projectRoot = await makeRepo({ storeConfig: { embed_model: "fast-multilingual-e5-large" } });
    expect(readEmbedConfig(projectRoot).model).toBe("fast-multilingual-e5-large");
  });

  it("model: unknown value at every layer → DEFAULT_EMBED_MODEL", async () => {
    process.env.FABRIC_EMBED_MODEL = "not-a-real-model";
    const projectRoot = await makeRepo({ bindTeam: false });
    expect(readEmbedConfig(projectRoot).model).toBe(DEFAULT_EMBED_MODEL);
  });

  it("weight: project beats store", async () => {
    const projectRoot = await makeRepo({ projectConfig: { embed_weight: 40 }, storeConfig: { embed_weight: 10 } });
    expect(readEmbedConfig(projectRoot).weight).toBe(40);
  });

  it("weight: out-of-range project value falls through to default", async () => {
    const projectRoot = await makeRepo({ projectConfig: { embed_weight: 99 }, bindTeam: false });
    expect(readEmbedConfig(projectRoot).weight).toBe(30);
  });

  it("enabled: default TRUE, PROJECT-only opt-out (store does NOT toggle it)", async () => {
    const on = await makeRepo({ bindTeam: false });
    expect(readEmbedConfig(on).enabled).toBe(true);
    const off = await makeRepo({ projectConfig: { embed_enabled: false }, bindTeam: false });
    expect(readEmbedConfig(off).enabled).toBe(false);
  });

  it("remoteEndpoint/remoteApiKey: env wins", async () => {
    process.env.FABRIC_EMBED_ENDPOINT = "https://embed.example/v1";
    process.env.FABRIC_EMBED_API_KEY = "sk-env-123";
    const projectRoot = await makeRepo({ bindTeam: false });
    const cfg = readEmbedConfig(projectRoot);
    expect(cfg.remoteEndpoint).toBe("https://embed.example/v1");
    expect(cfg.remoteApiKey).toBe("sk-env-123");
  });

  it("remoteEndpoint/remoteApiKey: fall back to ~/.fabric global config (machine layer)", async () => {
    const projectRoot = await makeRepo({ bindTeam: false });
    // globalConfigSchema is .passthrough() — embed_endpoint/embed_api_key survive.
    saveGlobalConfig({
      uid: "test-uid",
      stores: [],
      embed_endpoint: "https://global.example/v1",
      embed_api_key: "sk-global-999",
    } as never);
    const cfg = readEmbedConfig(projectRoot);
    expect(cfg.remoteEndpoint).toBe("https://global.example/v1");
    expect(cfg.remoteApiKey).toBe("sk-global-999");
  });

  it("remote secrets are NEVER sourced from store-config (KT-DEC-0063)", async () => {
    const projectRoot = await makeRepo({
      storeConfig: { embed_model: "fast-multilingual-e5-large", embed_endpoint: "https://store.example/leak", embed_api_key: "sk-store-leak" } as never,
    });
    const cfg = readEmbedConfig(projectRoot);
    // store model IS honored, but store endpoint/key are ignored.
    expect(cfg.model).toBe("fast-multilingual-e5-large");
    expect(cfg.remoteEndpoint).toBeUndefined();
    expect(cfg.remoteApiKey).toBeUndefined();
  });

  it("no remote config → fields omitted", async () => {
    const projectRoot = await makeRepo({ bindTeam: false });
    const cfg = readEmbedConfig(projectRoot);
    expect(cfg.remoteEndpoint).toBeUndefined();
    expect(cfg.remoteApiKey).toBeUndefined();
    expect("remoteEndpoint" in cfg).toBe(false);
  });
});

describe("map knobs — per-key cascade with store participation", () => {
  it("readCredibilityHalfLives: store overrides one type, others keep defaults", async () => {
    const projectRoot = await makeRepo({ storeConfig: { credibility_half_life_decisions_days: 365 } });
    const out = readCredibilityHalfLives(projectRoot);
    expect(out.decisions).toBe(365);
    expect(out.pitfalls).toBe(120); // default preserved
  });

  it("readCredibilityHalfLives: project beats store, env beats both", async () => {
    const projectRoot = await makeRepo({ projectConfig: { credibility_half_life_decisions_days: 200 }, storeConfig: { credibility_half_life_decisions_days: 365 } });
    expect(readCredibilityHalfLives(projectRoot).decisions).toBe(200);
    process.env.FABRIC_CREDIBILITY_HALF_LIFE_DECISIONS_DAYS = "300";
    const projectRoot2 = await makeRepo({ projectConfig: { credibility_half_life_decisions_days: 200 }, storeConfig: { credibility_half_life_decisions_days: 365 } });
    expect(readCredibilityHalfLives(projectRoot2).decisions).toBe(300);
  });

  it("readOrphanDemoteThresholdDays: Partial — store-set key present, unset key absent", async () => {
    const projectRoot = await makeRepo({ storeConfig: { orphan_demote_proven_days: 45 } });
    const out = readOrphanDemoteThresholdDays(projectRoot);
    expect(out.proven).toBe(45);
    expect(out.verified).toBeUndefined();
  });

  it("readOrphanDemoteThresholdDays: env beats store", async () => {
    process.env.FABRIC_ORPHAN_DEMOTE_PROVEN_DAYS = "60";
    const projectRoot = await makeRepo({ storeConfig: { orphan_demote_proven_days: 45 } });
    expect(readOrphanDemoteThresholdDays(projectRoot).proven).toBe(60);
  });
});
