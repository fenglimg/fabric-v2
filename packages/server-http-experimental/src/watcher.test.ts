/**
 * watcher.test.ts — TASK-024 chokidar watcher / Layer 2 P0 review
 *
 * v2/rc.2: tests retargeted from `.fabric/rules/**\/*.md` to
 * `.fabric/knowledge/**\/*.md` to match the v2 cache-watcher glob.
 *
 * Verifies that handleCacheWatcherEvent calls contextCache.invalidate when
 * a .fabric/knowledge/*.md file changes, so the next MCP call performs a
 * real I/O scan rather than returning a stale cached-fresh response.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Module-level mock so we can spy on contextCache.invalidate without
// importing the real cache.
vi.mock("./cache.js", () => {
  const invalidate = vi.fn();
  return {
    contextCache: { invalidate },
    // re-export the type alias so TypeScript consumers are happy
    InvalidationReason: {},
  };
});

// Mock appendEventLedgerEvent so we can assert it is NEVER called.
vi.mock("./services/event-ledger.js", () => ({
  appendEventLedgerEvent: vi.fn(),
  readEventLedger: vi.fn(),
}));

import { contextCache } from "@fenglimg/fabric-server";
import { appendEventLedgerEvent } from "@fenglimg/fabric-server";
import { handleCacheWatcherEvent } from "./http.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT_ROOT = "/fake/project";

function makeTimers() {
  let agentsMd: ReturnType<typeof setTimeout> | undefined;
  let toolList: ReturnType<typeof setTimeout> | undefined;
  return {
    getAgentsMdTimer: () => agentsMd,
    getToolListTimer: () => toolList,
    setAgentsMdTimer: (t: ReturnType<typeof setTimeout> | undefined) => { agentsMd = t; },
    setToolListTimer: (t: ReturnType<typeof setTimeout> | undefined) => { toolList = t; },
  };
}

function emptySessions() {
  return new Map<string, never>();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleCacheWatcherEvent — knowledge/ paths (TASK-024, v2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("invalidates cache when a new knowledge file is added (.add event path)", () => {
    handleCacheWatcherEvent(
      ".fabric/knowledge/decisions/foo.md",
      PROJECT_ROOT,
      emptySessions() as unknown as Map<string, never>,
      makeTimers(),
    );

    expect(contextCache.invalidate).toHaveBeenCalledTimes(1);
    expect(contextCache.invalidate).toHaveBeenCalledWith("file_watch", PROJECT_ROOT);
  });

  it("invalidates cache when an existing knowledge file is edited (.change event path)", () => {
    handleCacheWatcherEvent(
      ".fabric/knowledge/guidelines/nested/bar.md",
      PROJECT_ROOT,
      emptySessions() as unknown as Map<string, never>,
      makeTimers(),
    );

    expect(contextCache.invalidate).toHaveBeenCalledTimes(1);
    expect(contextCache.invalidate).toHaveBeenCalledWith("file_watch", PROJECT_ROOT);
  });

  it("invalidates cache when a knowledge file is deleted (.unlink event path)", () => {
    handleCacheWatcherEvent(
      ".fabric/knowledge/pending/deep/nested/baz.md",
      PROJECT_ROOT,
      emptySessions() as unknown as Map<string, never>,
      makeTimers(),
    );

    expect(contextCache.invalidate).toHaveBeenCalledTimes(1);
    expect(contextCache.invalidate).toHaveBeenCalledWith("file_watch", PROJECT_ROOT);
  });

  it("does NOT call appendEventLedgerEvent for any knowledge file event (no ledger writes)", () => {
    for (const path of [
      ".fabric/knowledge/decisions/foo.md",
      ".fabric/knowledge/guidelines/sub/bar.md",
      ".fabric/knowledge/pending/deep/nested/baz.md",
    ]) {
      handleCacheWatcherEvent(
        path,
        PROJECT_ROOT,
        emptySessions() as unknown as Map<string, never>,
        makeTimers(),
      );
    }

    expect(appendEventLedgerEvent).not.toHaveBeenCalled();
  });

  it("also handles Windows-style backslash paths in knowledge/ correctly", () => {
    handleCacheWatcherEvent(
      ".fabric\\knowledge\\decisions\\windows-rule.md",
      PROJECT_ROOT,
      emptySessions() as unknown as Map<string, never>,
      makeTimers(),
    );

    expect(contextCache.invalidate).toHaveBeenCalledWith("file_watch", PROJECT_ROOT);
  });

  it("does NOT invalidate cache for non-md files in knowledge/ (path does not match glob)", () => {
    handleCacheWatcherEvent(
      ".fabric/knowledge/decisions/README.txt",
      PROJECT_ROOT,
      emptySessions() as unknown as Map<string, never>,
      makeTimers(),
    );

    // .txt is not .md — handler should ignore it
    expect(contextCache.invalidate).not.toHaveBeenCalled();
  });
});
