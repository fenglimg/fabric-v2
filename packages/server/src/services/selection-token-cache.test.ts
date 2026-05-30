import { afterEach, describe, expect, it } from "vitest";

import {
  createSelectionToken,
  readSelectionToken,
  __resetSelectionTokenCache,
  __selectionTokenCacheSize,
} from "./plan-context.js";

// W4-04 (ISS-027): the selection-token cache must be bounded — a capacity cap
// with LRU eviction plus a proactive expiry sweep, so a long-lived MCP server
// does not accumulate one never-read token per plan-context call.

const FAR_FUTURE_TTL = 60 * 60 * 1000; // 1h — well beyond any test wall-clock
const CAP = 1000;

afterEach(() => __resetSelectionTokenCache());

describe("selectionTokenCache eviction (ISS-027)", () => {
  it("caps the cache and evicts the least-recently-used token", () => {
    __resetSelectionTokenCache();
    const first = createSelectionToken("rev", ["a.ts"], [], [], 1, FAR_FUTURE_TTL);
    // Fill exactly to the cap with distinct later timestamps.
    for (let i = 2; i <= CAP; i += 1) {
      createSelectionToken("rev", ["a.ts"], [], [], i, FAR_FUTURE_TTL);
    }
    expect(__selectionTokenCacheSize()).toBe(CAP);
    // The very first token is still the LRU at this point.
    // One more insert must evict it (size stays capped).
    const newest = createSelectionToken("rev", ["a.ts"], [], [], CAP + 1, FAR_FUTURE_TTL);
    expect(__selectionTokenCacheSize()).toBe(CAP);
    expect(readSelectionToken(first, CAP + 2)).toBeUndefined(); // evicted
    expect(readSelectionToken(newest, CAP + 2)).toBeDefined(); // retained
  });

  it("bumps a token's recency on read so it survives eviction", () => {
    __resetSelectionTokenCache();
    const protectedToken = createSelectionToken("rev", ["a.ts"], [], [], 1, FAR_FUTURE_TTL);
    for (let i = 2; i <= CAP; i += 1) {
      createSelectionToken("rev", ["a.ts"], [], [], i, FAR_FUTURE_TTL);
    }
    // Read the oldest token → LRU bump moves it to the back.
    expect(readSelectionToken(protectedToken, CAP + 1)).toBeDefined();
    // The next insert must now evict the *second*-oldest, not the bumped token.
    createSelectionToken("rev", ["a.ts"], [], [], CAP + 2, FAR_FUTURE_TTL);
    expect(readSelectionToken(protectedToken, CAP + 3)).toBeDefined();
  });

  it("sweeps expired tokens on insert", () => {
    __resetSelectionTokenCache();
    // A token that expires at t=10.
    const shortLived = createSelectionToken("rev", ["a.ts"], [], [], 1, 9);
    expect(__selectionTokenCacheSize()).toBe(1);
    // Insert another at t=100 → the expired short-lived token is swept.
    createSelectionToken("rev", ["a.ts"], [], [], 100, FAR_FUTURE_TTL);
    expect(readSelectionToken(shortLived, 100)).toBeUndefined();
    expect(__selectionTokenCacheSize()).toBe(1); // only the fresh one remains
  });
});
