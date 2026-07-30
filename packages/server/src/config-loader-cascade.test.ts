import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { saveGlobalConfig } from "@fenglimg/fabric-shared";

import {
  BROAD_REVIEW_RECHECK_DAYS_DEFAULT,
  DEFAULT_EMBED_MODEL,
  PLAN_CONTEXT_TOP_K_DEFAULT,
  RECALL_RELEVANCE_RATIO_DEFAULT,
  readBroadReviewRecheckThresholdDays,
  readConflictLintThreshold,
  readCredibilityFloors,
  readCredibilityHalfLives,
  readDefaultLayerFilter,
  readEmbedConfig,
  readOrphanDemoteThresholdDays,
  readPlanContextTopK,
  readRecallRelevanceRatio,
  readSelectionTokenTtlMs,
  resolveGlobalPolicy,
  resolveStoreConfig,
} from "./config-loader.js";
import { resolveWriteTargetStoreDir } from "./services/cross-store-write.js";

// ---------------------------------------------------------------------------
// config-single-home W2 — per-CLASS cascade, with NO key writable in two places.
//
//   PREFERENCE class  env > global.projects[<project_id>] > global.defaults > default
//   CORPUS class      env > <store>/store-config.json > default
//   IDENTITY class    repo .fabric/fabric-config.json only (no cascade)
//
// The decisive property this suite pins is the SINGLE-HOME invariant: a corpus
// knob written into global policy has NO effect, and a preference knob written
// into a store-config has NO effect. That is what removes the "the value I can
// see is not the value in effect" failure mode the previous 4-layer cascade had
// (a `defaults` entry silently losing to a store entry, while a `projects` entry
// silently beat it — same file, opposite outcomes).
//
// STORE-layer cases need a real resolved team store root, so the fixture mirrors
// write-scope-meta.test.ts: fake FABRIC_HOME + mounted stores + a repo bound to
// the team store, with store-config.json written at the resolved root.
// ---------------------------------------------------------------------------

const TEAM = "22222222-2222-4222-8222-222222222222";
const PERSONAL = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "proj-aaaaaaaa-1111-4111-8111-111111111111";

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
  "FABRIC_BROAD_REVIEW_RECHECK_DAYS",
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

/**
 * Write `~/.fabric/fabric-global.json` with the mounted stores plus whichever
 * policy segments a case needs. `projects` is keyed by PROJECT_ID so it lines up
 * with the repo config written by {@link makeRepo}.
 */
function writeGlobal(policy: {
  defaults?: Record<string, unknown>;
  projects?: Record<string, Record<string, unknown>>;
  embed_remote?: { endpoint: string; api_key?: string; model?: string };
  flatEmbed?: Record<string, unknown>;
} = {}): void {
  saveGlobalConfig({
    uid: "test-uid",
    stores: [
      { store_uuid: PERSONAL, alias: "personal", personal: true, writable: true },
      { store_uuid: TEAM, alias: "team", remote: "git@e:t.git", writable: true },
    ],
    ...(policy.defaults !== undefined ? { defaults: policy.defaults } : {}),
    ...(policy.projects !== undefined ? { projects: policy.projects } : {}),
    ...(policy.embed_remote !== undefined ? { embed_remote: policy.embed_remote } : {}),
    ...(policy.flatEmbed ?? {}),
  });
}

/**
 * A repo bound to the team store. The repo config carries IDENTITY ONLY — that
 * is the point of config-single-home, so these fixtures never write policy knobs
 * into it.
 */
async function makeRepo(
  opts: { storeConfig?: object | string; bindTeam?: boolean; projectId?: string | null } = {},
): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-cascade-proj-"));
  tempDirs.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  const bind = opts.bindTeam !== false;
  const identity = {
    ...(opts.projectId === null ? {} : { project_id: opts.projectId ?? PROJECT_ID }),
    ...(bind ? { required_stores: [{ id: "team" }], active_write_store: "team" } : {}),
  };
  await writeFile(
    join(projectRoot, ".fabric", "fabric-config.json"),
    `${JSON.stringify(identity, null, 2)}\n`,
  );
  if (opts.storeConfig !== undefined) {
    const storeRoot = resolveWriteTargetStoreDir("team", projectRoot);
    await mkdir(storeRoot, { recursive: true });
    await writeFile(
      join(storeRoot, "store-config.json"),
      typeof opts.storeConfig === "string"
        ? opts.storeConfig
        : `${JSON.stringify(opts.storeConfig, null, 2)}\n`,
    );
  }
  return projectRoot;
}

describe("resolveStoreConfig — corpus layer source", () => {
  it("returns {} when no team write-target resolves (unbound repo, never throws)", async () => {
    writeGlobal();
    const projectRoot = await makeRepo({ bindTeam: false });
    expect(resolveStoreConfig(projectRoot)).toEqual({});
  });

  it("returns {} when the team store has no store-config.json", async () => {
    writeGlobal();
    const projectRoot = await makeRepo({});
    expect(resolveStoreConfig(projectRoot)).toEqual({});
  });

  it("returns {} on malformed store-config JSON (never throws)", async () => {
    writeGlobal();
    const projectRoot = await makeRepo({ storeConfig: "{ not json" });
    expect(resolveStoreConfig(projectRoot)).toEqual({});
  });

  it("drops an out-of-range field but keeps valid siblings", async () => {
    writeGlobal();
    const projectRoot = await makeRepo({
      storeConfig: { credibility_half_life_decisions_days: 99999, credibility_floor_proven: 0.9 },
    });
    expect(resolveStoreConfig(projectRoot)).toEqual({ credibility_floor_proven: 0.9 });
  });
});

describe("resolveGlobalPolicy — policy layer source", () => {
  it("returns empty segments when no global config exists", async () => {
    const projectRoot = await makeRepo({ bindTeam: false });
    expect(resolveGlobalPolicy(projectRoot)).toEqual({ project: {}, defaults: {} });
  });

  it("splits defaults from the project-scoped segment keyed by project_id", async () => {
    writeGlobal({
      defaults: { plan_context_top_k: 40 },
      projects: { [PROJECT_ID]: { plan_context_top_k: 55 } },
    });
    const projectRoot = await makeRepo({});
    expect(resolveGlobalPolicy(projectRoot)).toEqual({
      defaults: { plan_context_top_k: 40 },
      project: { plan_context_top_k: 55 },
    });
  });

  it("yields an empty project segment when the repo carries no project_id", async () => {
    writeGlobal({ projects: { [PROJECT_ID]: { plan_context_top_k: 55 } } });
    const projectRoot = await makeRepo({ projectId: null });
    expect(resolveGlobalPolicy(projectRoot).project).toEqual({});
  });

  it("yields an empty project segment when no entry matches this project_id", async () => {
    writeGlobal({ projects: { "some-other-project": { plan_context_top_k: 55 } } });
    const projectRoot = await makeRepo({});
    expect(resolveGlobalPolicy(projectRoot).project).toEqual({});
  });
});

describe("PREFERENCE class — env > projects[id] > defaults > default", () => {
  it("1. no layer set → library default", async () => {
    writeGlobal();
    expect(readPlanContextTopK(await makeRepo({}))).toBe(PLAN_CONTEXT_TOP_K_DEFAULT);
  });

  it("2. defaults-only → defaults value", async () => {
    writeGlobal({ defaults: { plan_context_top_k: 40 } });
    expect(readPlanContextTopK(await makeRepo({}))).toBe(40);
  });

  it("3. projects-only → project value", async () => {
    writeGlobal({ projects: { [PROJECT_ID]: { plan_context_top_k: 55 } } });
    expect(readPlanContextTopK(await makeRepo({}))).toBe(55);
  });

  it("4. projects beats defaults", async () => {
    writeGlobal({
      defaults: { plan_context_top_k: 40 },
      projects: { [PROJECT_ID]: { plan_context_top_k: 55 } },
    });
    expect(readPlanContextTopK(await makeRepo({}))).toBe(55);
  });

  it("5. env beats projects", async () => {
    process.env.FABRIC_PLAN_CONTEXT_TOP_K = "7";
    writeGlobal({ projects: { [PROJECT_ID]: { plan_context_top_k: 55 } } });
    expect(readPlanContextTopK(await makeRepo({}))).toBe(7);
  });

  it("6. malformed env falls through to projects (never throws)", async () => {
    process.env.FABRIC_PLAN_CONTEXT_TOP_K = "not-a-number";
    writeGlobal({ projects: { [PROJECT_ID]: { plan_context_top_k: 55 } } });
    expect(readPlanContextTopK(await makeRepo({}))).toBe(55);
  });

  it("7. out-of-range projects value falls through to defaults", async () => {
    writeGlobal({
      defaults: { plan_context_top_k: 40 },
      projects: { [PROJECT_ID]: { plan_context_top_k: 9999 } },
    });
    expect(readPlanContextTopK(await makeRepo({}))).toBe(40);
  });

  it("8. type-strict: a stringified number is not accepted", async () => {
    writeGlobal({ defaults: { plan_context_top_k: "40" } });
    expect(readPlanContextTopK(await makeRepo({}))).toBe(PLAN_CONTEXT_TOP_K_DEFAULT);
  });

  it("float knob (recall_relevance_ratio) follows the same order", async () => {
    writeGlobal({
      defaults: { recall_relevance_ratio: 0.1 },
      projects: { [PROJECT_ID]: { recall_relevance_ratio: 0.5 } },
    });
    expect(readRecallRelevanceRatio(await makeRepo({}))).toBe(0.5);
    writeGlobal({ defaults: { recall_relevance_ratio: 0.1 } });
    expect(readRecallRelevanceRatio(await makeRepo({}))).toBe(0.1);
    writeGlobal();
    expect(readRecallRelevanceRatio(await makeRepo({}))).toBe(RECALL_RELEVANCE_RATIO_DEFAULT);
  });

  it("enum knob (default_layer_filter) follows the same order", async () => {
    writeGlobal({
      defaults: { default_layer_filter: "team" },
      projects: { [PROJECT_ID]: { default_layer_filter: "personal" } },
    });
    expect(readDefaultLayerFilter(await makeRepo({}))).toBe("personal");
    writeGlobal({ defaults: { default_layer_filter: "team" } });
    expect(readDefaultLayerFilter(await makeRepo({}))).toBe("team");
    writeGlobal({ defaults: { default_layer_filter: "nonsense" } });
    expect(readDefaultLayerFilter(await makeRepo({}))).toBe("both");
  });

  it("undefined-means-fallback knob (selection_token_ttl_ms) stays undefined when unset", async () => {
    writeGlobal();
    expect(readSelectionTokenTtlMs(await makeRepo({}))).toBeUndefined();
    writeGlobal({ defaults: { selection_token_ttl_ms: 60_000 } });
    expect(readSelectionTokenTtlMs(await makeRepo({}))).toBe(60_000);
    writeGlobal({
      defaults: { selection_token_ttl_ms: 60_000 },
      projects: { [PROJECT_ID]: { selection_token_ttl_ms: 120_000 } },
    });
    expect(readSelectionTokenTtlMs(await makeRepo({}))).toBe(120_000);
  });
});

describe("CORPUS class — env > store > default", () => {
  it("1. no layer set → library default", async () => {
    writeGlobal();
    expect(readCredibilityHalfLives(await makeRepo({})).decisions).toBe(180);
  });

  it("2. store-only → store value", async () => {
    writeGlobal();
    const projectRoot = await makeRepo({
      storeConfig: { credibility_half_life_decisions_days: 120 },
    });
    expect(readCredibilityHalfLives(projectRoot).decisions).toBe(120);
  });

  it("3. env beats store", async () => {
    process.env.FABRIC_CREDIBILITY_HALF_LIFE_DECISIONS_DAYS = "45";
    writeGlobal();
    const projectRoot = await makeRepo({
      storeConfig: { credibility_half_life_decisions_days: 120 },
    });
    expect(readCredibilityHalfLives(projectRoot).decisions).toBe(45);
  });

  it("4. per-maturity floors resolve from the store", async () => {
    writeGlobal();
    const projectRoot = await makeRepo({ storeConfig: { credibility_floor_proven: 0.9 } });
    const floors = readCredibilityFloors(projectRoot);
    expect(floors.proven).toBe(0.9);
    expect(floors.draft).toBe(0.4); // untouched key keeps the library default
  });

  it("5. orphan_demote thresholds resolve from the store, omitting unset keys", async () => {
    writeGlobal();
    const projectRoot = await makeRepo({ storeConfig: { orphan_demote_proven_days: 45 } });
    expect(readOrphanDemoteThresholdDays(projectRoot)).toEqual({ proven: 45 });
  });

  // NOTE: store-config.json lives at the SHARED team-store root, not per-repo, so
  // "set" and "unset" cases must not share an `it` — a second makeRepo() in the
  // same test still sees the file the first one wrote.
  it("6. broad_review_recheck_days resolves from the store", async () => {
    writeGlobal();
    const projectRoot = await makeRepo({ storeConfig: { broad_review_recheck_days: 30 } });
    expect(readBroadReviewRecheckThresholdDays(projectRoot)).toBe(30);
  });

  it("6b. broad_review_recheck_days falls back to the library default", async () => {
    writeGlobal();
    expect(readBroadReviewRecheckThresholdDays(await makeRepo({}))).toBe(
      BROAD_REVIEW_RECHECK_DAYS_DEFAULT,
    );
  });

  it("7. conflict_lint threshold preserves undefined-means-fallback", async () => {
    writeGlobal();
    expect(readConflictLintThreshold(await makeRepo({}))).toBeUndefined();
    const projectRoot = await makeRepo({ storeConfig: { conflict_lint_similarity_threshold: 0.7 } });
    expect(readConflictLintThreshold(projectRoot)).toBe(0.7);
  });

  it("8. orphan_demote honors the canonical proven/verified/draft keys", async () => {
    writeGlobal();
    const projectRoot = await makeRepo({
      storeConfig: {
        orphan_demote_proven_days: 120,
        orphan_demote_verified_days: 45,
        orphan_demote_draft_days: 7,
      },
    });
    expect(readOrphanDemoteThresholdDays(projectRoot)).toEqual({
      proven: 120,
      verified: 45,
      draft: 7,
    });
  });

  it("9. orphan_demote drops out-of-range values without nuking valid siblings", async () => {
    writeGlobal();
    const projectRoot = await makeRepo({
      storeConfig: {
        orphan_demote_proven_days: 0, // below min → dropped
        orphan_demote_verified_days: 30,
        orphan_demote_draft_days: 4000, // above max → dropped
      },
    });
    expect(readOrphanDemoteThresholdDays(projectRoot)).toEqual({ verified: 30 });
  });

  it("10. broad_review_recheck_days rejects out-of-range / non-integer values", async () => {
    writeGlobal();
    for (const bad of [0, 5000, 90.5]) {
      const projectRoot = await makeRepo({ storeConfig: { broad_review_recheck_days: bad } });
      expect(readBroadReviewRecheckThresholdDays(projectRoot)).toBe(
        BROAD_REVIEW_RECHECK_DAYS_DEFAULT,
      );
    }
  });
});

describe("SINGLE-HOME invariant — no key is writable in two places", () => {
  it("a corpus knob placed in global.defaults has NO effect", async () => {
    writeGlobal({ defaults: { credibility_half_life_decisions_days: 10 } });
    const projectRoot = await makeRepo({});
    expect(readCredibilityHalfLives(projectRoot).decisions).toBe(180);
  });

  it("a corpus knob placed in global.projects has NO effect", async () => {
    writeGlobal({ projects: { [PROJECT_ID]: { credibility_floor_proven: 0.1 } } });
    const projectRoot = await makeRepo({});
    expect(readCredibilityFloors(projectRoot).proven).toBe(0.7);
  });

  it("a preference knob placed in store-config has NO effect", async () => {
    writeGlobal();
    const projectRoot = await makeRepo({ storeConfig: { plan_context_top_k: 99 } });
    expect(readPlanContextTopK(projectRoot)).toBe(PLAN_CONTEXT_TOP_K_DEFAULT);
  });

  it("a store entry can never shadow a global.defaults preference value", async () => {
    // The exact trap the previous 4-layer cascade had: `defaults` lost to the
    // store while `projects` beat it — two segments of ONE file, opposite results.
    writeGlobal({ defaults: { plan_context_top_k: 40 } });
    const projectRoot = await makeRepo({ storeConfig: { plan_context_top_k: 32 } });
    expect(readPlanContextTopK(projectRoot)).toBe(40);
  });

  it("policy knobs left in the repo config are inert (clean-slate hard cut)", async () => {
    writeGlobal();
    const projectRoot = await mkdtemp(join(tmpdir(), "fabric-cascade-legacy-"));
    tempDirs.push(projectRoot);
    await mkdir(join(projectRoot, ".fabric"), { recursive: true });
    await writeFile(
      join(projectRoot, ".fabric", "fabric-config.json"),
      `${JSON.stringify({ project_id: PROJECT_ID, plan_context_top_k: 99, fusion: "rrf" }, null, 2)}\n`,
    );
    expect(readPlanContextTopK(projectRoot)).toBe(PLAN_CONTEXT_TOP_K_DEFAULT);
  });
});

describe("readEmbedConfig — embed_remote moves as one unit (D6)", () => {
  it("local mode: model resolves through the preference cascade", async () => {
    writeGlobal({ defaults: { embed_model: "fast-bge-small-en" } });
    const cfg = readEmbedConfig(await makeRepo({}));
    expect(cfg.model).toBe("fast-bge-small-en");
    expect(cfg.remoteEndpoint).toBeUndefined();
  });

  it("local mode: an unknown model name falls back to the fastembed default", async () => {
    writeGlobal({ defaults: { embed_model: "BAAI/bge-m3" } });
    expect(readEmbedConfig(await makeRepo({})).model).toBe(DEFAULT_EMBED_MODEL);
  });

  it("remote mode: endpoint + key + model all come from embed_remote", async () => {
    writeGlobal({
      embed_remote: { endpoint: "https://api.example/v1/embeddings", api_key: "sk-x", model: "BAAI/bge-m3" },
    });
    const cfg = readEmbedConfig(await makeRepo({}));
    expect(cfg.remoteEndpoint).toBe("https://api.example/v1/embeddings");
    expect(cfg.remoteApiKey).toBe("sk-x");
    expect(cfg.model).toBe("BAAI/bge-m3");
  });

  it("remote mode: defaults.embed_model does NOT leak into the remote namespace", async () => {
    writeGlobal({
      defaults: { embed_model: "fast-bge-small-en" },
      embed_remote: { endpoint: "https://api.example/v1/embeddings", model: "BAAI/bge-m3" },
    });
    expect(readEmbedConfig(await makeRepo({})).model).toBe("BAAI/bge-m3");
  });

  it("remote mode is backward-compatible with the pre-W2 flat keys", async () => {
    writeGlobal({
      flatEmbed: {
        embed_endpoint: "https://legacy.example/v1/embeddings",
        embed_api_key: "sk-legacy",
        embed_model: "BAAI/bge-m3",
      },
    });
    const cfg = readEmbedConfig(await makeRepo({}));
    expect(cfg.remoteEndpoint).toBe("https://legacy.example/v1/embeddings");
    expect(cfg.remoteApiKey).toBe("sk-legacy");
    expect(cfg.model).toBe("BAAI/bge-m3");
  });

  it("nested embed_remote wins over the legacy flat keys", async () => {
    writeGlobal({
      embed_remote: { endpoint: "https://new.example/v1", model: "new-model" },
      flatEmbed: { embed_endpoint: "https://legacy.example/v1", embed_model: "legacy-model" },
    });
    const cfg = readEmbedConfig(await makeRepo({}));
    expect(cfg.remoteEndpoint).toBe("https://new.example/v1");
    expect(cfg.model).toBe("new-model");
  });

  it("secrets are NEVER sourced from a store-config (KT-DEC-0063)", async () => {
    writeGlobal();
    const projectRoot = await makeRepo({
      storeConfig: { embed_endpoint: "https://evil.example", embed_api_key: "sk-leak" },
    });
    const cfg = readEmbedConfig(projectRoot);
    expect(cfg.remoteEndpoint).toBeUndefined();
    expect(cfg.remoteApiKey).toBeUndefined();
  });

  it("weight follows the preference cascade and enforces the < BM25 cap", async () => {
    writeGlobal({ defaults: { embed_weight: 20 }, projects: { [PROJECT_ID]: { embed_weight: 45 } } });
    expect(readEmbedConfig(await makeRepo({})).weight).toBe(45);
    writeGlobal({ defaults: { embed_weight: 60 } }); // above the 49 cap → falls through
    expect(readEmbedConfig(await makeRepo({})).weight).toBe(30);
  });

  it("enabled defaults TRUE and is disabled only by an explicit false", async () => {
    writeGlobal();
    expect(readEmbedConfig(await makeRepo({})).enabled).toBe(true);
    writeGlobal({ defaults: { embed_enabled: false } });
    expect(readEmbedConfig(await makeRepo({})).enabled).toBe(false);
    writeGlobal({
      defaults: { embed_enabled: false },
      projects: { [PROJECT_ID]: { embed_enabled: true } },
    });
    expect(readEmbedConfig(await makeRepo({})).enabled).toBe(true);
  });
});
