// config-layering W3 (TASK-003): REMOTE embedding dual-mode.
//
// resolveEmbedder is the SINGLE embedder-selection site on the recall hot path.
// These tests cover the three selection branches + the remote HTTP transport,
// and prove (ROUND-TRIP) that a remote fake-HTTP client is actually reached
// THROUGH the plan-context-scoring recall path — so the selector is not dead
// code (R-01). No real network: the HTTP client is an injectable seam (unit) or
// a stubbed global `fetch` (round-trip).

import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuleDescriptionIndexItem } from "@fenglimg/fabric-shared";

import { DEFAULT_EMBED_MODEL } from "../config-loader.js";
import {
  resolveEmbedder,
  loadRemoteEmbedder,
  buildVectorScores,
  __resetEmbedderForTesting,
  __resetVectorCache,
  __setRemoteKeyMissingHintForTesting,
  type Embedder,
} from "./vector-retrieval.js";
import { buildScoringContext } from "./plan-context-scoring.js";

const tempDirs: string[] = [];
let savedEnv: {
  endpoint: string | undefined;
  apiKey: string | undefined;
  home: string | undefined;
};

beforeEach(async () => {
  savedEnv = {
    endpoint: process.env.FABRIC_EMBED_ENDPOINT,
    apiKey: process.env.FABRIC_EMBED_API_KEY,
    home: process.env.FABRIC_HOME,
  };
  // Isolate the machine layer: with no remote env set, resolveMachineSecret falls
  // back to ~/.fabric global config — repoint it at an empty temp home so a real
  // developer ~/.fabric never leaks an embed_endpoint/embed_api_key into a test.
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-remote-embed-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
  delete process.env.FABRIC_EMBED_ENDPOINT;
  delete process.env.FABRIC_EMBED_API_KEY;
  __resetEmbedderForTesting(undefined);
  __resetVectorCache();
  __setRemoteKeyMissingHintForTesting(undefined);
});

afterEach(async () => {
  const restore = (name: string, value: string | undefined): void => {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  };
  restore("FABRIC_EMBED_ENDPOINT", savedEnv.endpoint);
  restore("FABRIC_EMBED_API_KEY", savedEnv.apiKey);
  restore("FABRIC_HOME", savedEnv.home);
  vi.unstubAllGlobals();
  __resetEmbedderForTesting(undefined);
  __resetVectorCache();
  __setRemoteKeyMissingHintForTesting(undefined);
  await Promise.all(tempDirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

async function freshProjectRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fabric-remote-embed-proj-"));
  tempDirs.push(dir);
  return dir;
}

function idxItem(localId: string, text: string): RuleDescriptionIndexItem {
  return {
    stable_id: `team:${localId}`,
    description: {
      summary: text,
      intent_clues: [],
      tech_stack: [],
      impact: [],
      must_read_if: "",
    },
  };
}

// A fake OpenAI-compatible embeddings fetch. Records every call and returns one
// `dim`-wide embedding per input, aligned to input order.
function recordingFetch(dim = 3): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; headers: Record<string, string>; body: { model: string; input: string[] } }>;
} {
  const calls: Array<{
    url: string;
    headers: Record<string, string>;
    body: { model: string; input: string[] };
  }> = [];
  const fetchImpl = (async (url: unknown, init: unknown) => {
    const reqInit = init as { headers: Record<string, string>; body: string };
    const body = JSON.parse(reqInit.body) as { model: string; input: string[] };
    calls.push({ url: String(url), headers: reqInit.headers, body });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          data: body.input.map((t, i) => ({
            embedding: Array.from({ length: dim }, (_, d) => (t.length + i + d) % 5),
          })),
        };
      },
    };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("loadRemoteEmbedder — HTTP transport", () => {
  it("POSTs { model, input } with a Bearer header and maps data[].embedding in order", async () => {
    const { fetchImpl, calls } = recordingFetch();
    const embedder = await loadRemoteEmbedder(
      "https://embed.example/v1/embeddings",
      "sk-secret",
      "fast-bge-small-en",
      fetchImpl,
    );
    const vecs = await embedder.embed(["a", "bb"]);
    expect(vecs).toHaveLength(2);
    expect(calls[0].url).toBe("https://embed.example/v1/embeddings");
    expect(calls[0].headers.authorization).toBe("Bearer sk-secret");
    expect(calls[0].body.model).toBe("fast-bge-small-en");
    expect(calls[0].body.input).toEqual(["a", "bb"]);
  });

  it("throws (caller degrades) on a non-2xx status", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 503, async json() { return {}; } })) as unknown as typeof fetch;
    const embedder = await loadRemoteEmbedder("https://e/embeddings", "sk", "m", fetchImpl);
    await expect(embedder.embed(["x"])).rejects.toThrow();
  });

  it("throws on a misaligned response (row count != input count)", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      async json() { return { data: [{ embedding: [1, 2] }] }; },
    })) as unknown as typeof fetch;
    const embedder = await loadRemoteEmbedder("https://e/embeddings", "sk", "m", fetchImpl);
    await expect(embedder.embed(["x", "y"])).rejects.toThrow();
  });
});

describe("resolveEmbedder — three-branch selection", () => {
  it("branch 1: endpoint + key → remote embedder POSTing model/input via the injected fetch", async () => {
    const projectRoot = await freshProjectRoot();
    process.env.FABRIC_EMBED_ENDPOINT = "https://embed.example/v1/embeddings";
    process.env.FABRIC_EMBED_API_KEY = "sk-abc";
    const { fetchImpl, calls } = recordingFetch();
    const embedder = await resolveEmbedder(projectRoot, { fetchImpl });
    expect(embedder).not.toBeNull();
    await embedder!.embed(["hello"]);
    expect(calls[0].url).toBe("https://embed.example/v1/embeddings");
    expect(calls[0].headers.authorization).toBe("Bearer sk-abc");
    // No project/store config → the model falls back to the library default.
    expect(calls[0].body.model).toBe(DEFAULT_EMBED_MODEL);
  });

  it("branch 2: endpoint present but NO key → null + ONE-TIME hint, never the local model", async () => {
    const projectRoot = await freshProjectRoot();
    process.env.FABRIC_EMBED_ENDPOINT = "https://embed.example/v1/embeddings";
    delete process.env.FABRIC_EMBED_API_KEY;
    let hintCount = 0;
    __setRemoteKeyMissingHintForTesting(() => {
      hintCount += 1;
    });
    // Preload a local embedder so we can PROVE the missing-key branch never
    // silently substitutes it: if resolveEmbedder wrongly fell to loadEmbedder,
    // this embed() would be reachable — but the branch returns null instead.
    __resetEmbedderForTesting({
      async embed() {
        throw new Error("local model must NOT be used on the missing-key branch");
      },
    });
    const first = await resolveEmbedder(projectRoot);
    const second = await resolveEmbedder(projectRoot);
    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(hintCount).toBe(1); // one-time across repeated recalls
  });

  it("branch 3: no endpoint → the local fastembed path (loadEmbedder), byte-identical", async () => {
    const projectRoot = await freshProjectRoot();
    delete process.env.FABRIC_EMBED_ENDPOINT;
    delete process.env.FABRIC_EMBED_API_KEY;
    const localFake: Embedder = {
      async embed(texts) {
        return texts.map(() => [9, 9]);
      },
    };
    // __resetEmbedderForTesting seeds loadEmbedder's per-process cache, so the
    // no-endpoint branch returns exactly this local embedder.
    __resetEmbedderForTesting(localFake);
    const embedder = await resolveEmbedder(projectRoot);
    expect(embedder).toBe(localFake);
  });

  it("remote HTTP error degrades to null through buildVectorScores (never throws into recall)", async () => {
    const projectRoot = await freshProjectRoot();
    process.env.FABRIC_EMBED_ENDPOINT = "https://embed.example/v1/embeddings";
    process.env.FABRIC_EMBED_API_KEY = "sk-x";
    const failing = (async () => ({ ok: false, status: 500, async json() { return {}; } })) as unknown as typeof fetch;
    const embedder = await resolveEmbedder(projectRoot, { fetchImpl: failing });
    expect(embedder).not.toBeNull();
    const scores = await buildVectorScores(embedder, "query", [{ stable_id: "x", text: "doc" }]);
    expect(scores).toBeNull(); // text-only degrade
  });
});

describe("ROUND-TRIP — remote embedder reached through the recall scoring path (R-01)", () => {
  it("remote config → buildScoringContext → fake HTTP embed() invoked with endpoint + model", async () => {
    const projectRoot = await freshProjectRoot();
    process.env.FABRIC_EMBED_ENDPOINT = "https://embed.example/v1/embeddings";
    process.env.FABRIC_EMBED_API_KEY = "sk-roundtrip";
    // Production passes NO fetchImpl to resolveEmbedder, so loadRemoteEmbedder
    // uses the global fetch — stub it to prove the wiring end-to-end.
    const { fetchImpl, calls } = recordingFetch();
    vi.stubGlobal("fetch", fetchImpl);

    const items: RuleDescriptionIndexItem[] = [
      idxItem("KT-DEC-0001", "alpha beta gamma"),
      idxItem("KT-DEC-0002", "delta epsilon zeta"),
    ];
    const ctx = await buildScoringContext(projectRoot, "rev-roundtrip-1", items, {
      queryText: "alpha",
      targetPaths: [],
    });

    // The selector was actually reached and produced vector scores.
    expect(ctx.vectorScores).toBeDefined();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].url).toBe("https://embed.example/v1/embeddings");
    expect(calls[0].body.model).toBe(DEFAULT_EMBED_MODEL);
    // The query text is always embedded (first element of the batch).
    expect(calls[0].body.input).toContain("alpha");
  });
});
