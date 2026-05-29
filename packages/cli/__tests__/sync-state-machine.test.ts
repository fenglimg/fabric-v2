import { describe, expect, it } from "vitest";

import {
  abortSync,
  applySyncEvent,
  continueSync,
  deferredPushStores,
  isSyncSettled,
  planSync,
  syncTransition,
} from "../src/sync/state-machine.js";

// v2.1.0-rc.1 P3 — sync state machine (S9/S17/S37): conflict → --continue/--abort,
// offline-first deferred push, invalid transitions throw.

describe("P3 sync transitions", () => {
  it("pending resolves to clean / conflict / offline", () => {
    expect(syncTransition("pending", "rebase_clean")).toBe("synced");
    expect(syncTransition("pending", "rebase_conflict")).toBe("conflict");
    expect(syncTransition("pending", "network_unavailable")).toBe("offline");
  });

  it("conflict resolves via continue/abort only", () => {
    expect(syncTransition("conflict", "user_continue")).toBe("synced");
    expect(syncTransition("conflict", "user_abort")).toBe("aborted");
    expect(() => syncTransition("conflict", "rebase_clean")).toThrow(/invalid sync transition/);
  });

  it("offline retries to synced", () => {
    expect(syncTransition("offline", "retry")).toBe("synced");
  });

  it("throws on an invalid transition", () => {
    expect(() => syncTransition("synced", "user_continue")).toThrow(/invalid sync transition/);
  });
});

describe("P3 multi-store sync session", () => {
  const stores = [
    { alias: "team", store_uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    { alias: "platform", store_uuid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
  ];

  it("--continue advances the conflicted store, leaving others intact", () => {
    let session = planSync(stores);
    session = applySyncEvent(session, "team", "rebase_clean");
    session = applySyncEvent(session, "platform", "rebase_conflict");
    expect(isSyncSettled(session)).toBe(false);

    session = continueSync(session);
    expect(session.stores.find((s) => s.alias === "platform")?.state).toBe("synced");
    expect(session.stores.find((s) => s.alias === "team")?.state).toBe("synced");
    expect(isSyncSettled(session)).toBe(true);
  });

  it("--abort leaves the conflicted store aborted (others unaffected)", () => {
    let session = planSync(stores);
    session = applySyncEvent(session, "platform", "rebase_conflict");
    session = abortSync(session);
    expect(session.stores.find((s) => s.alias === "platform")?.state).toBe("aborted");
  });

  it("offline stores are settled but flagged for deferred push (S17)", () => {
    let session = planSync(stores);
    session = applySyncEvent(session, "team", "rebase_clean");
    session = applySyncEvent(session, "platform", "network_unavailable");
    expect(isSyncSettled(session)).toBe(true);
    expect(deferredPushStores(session).map((s) => s.alias)).toEqual(["platform"]);
  });

  it("--continue/--abort throw when nothing is conflicted", () => {
    const session = planSync(stores);
    expect(() => continueSync(session)).toThrow(/no conflicted store/);
    expect(() => abortSync(session)).toThrow(/no conflicted store/);
  });
});
