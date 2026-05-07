/**
 * TASK-024: Tests for the chokidar cache-watcher event handler.
 *
 * Strategy: test handleCacheWatcherEvent() directly — no real chokidar
 * instance required.  This covers change / add / unlink semantics because
 * createFabricHttpApp() registers the same callback for all three events.
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

import { contextCache } from "./cache.js";
import { appendEventLedgerEvent } from "./services/event-ledger.js";
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

describe("handleCacheWatcherEvent — rules/ paths (TASK-024)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("invalidates cache when a new rule file is added (.add event path)", () => {
    handleCacheWatcherEvent(
      ".fabric/rules/foo.md",
      PROJECT_ROOT,
      emptySessions() as unknown as Map<string, never>,
      makeTimers(),
    );

    expect(contextCache.invalidate).toHaveBeenCalledTimes(1);
    expect(contextCache.invalidate).toHaveBeenCalledWith("file_watch", PROJECT_ROOT);
  });

  it("invalidates cache when an existing rule file is edited (.change event path)", () => {
    handleCacheWatcherEvent(
      ".fabric/rules/nested/bar.md",
      PROJECT_ROOT,
      emptySessions() as unknown as Map<string, never>,
      makeTimers(),
    );

    expect(contextCache.invalidate).toHaveBeenCalledTimes(1);
    expect(contextCache.invalidate).toHaveBeenCalledWith("file_watch", PROJECT_ROOT);
  });

  it("invalidates cache when a rule file is deleted (.unlink event path)", () => {
    handleCacheWatcherEvent(
      ".fabric/rules/deep/nested/baz.md",
      PROJECT_ROOT,
      emptySessions() as unknown as Map<string, never>,
      makeTimers(),
    );

    expect(contextCache.invalidate).toHaveBeenCalledTimes(1);
    expect(contextCache.invalidate).toHaveBeenCalledWith("file_watch", PROJECT_ROOT);
  });

  it("does NOT call appendEventLedgerEvent for any rule file event (no ledger writes)", () => {
    for (const path of [
      ".fabric/rules/foo.md",
      ".fabric/rules/sub/bar.md",
      ".fabric/rules/deep/nested/baz.md",
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

  it("also handles Windows-style backslash paths in rules/ correctly", () => {
    handleCacheWatcherEvent(
      ".fabric\\rules\\windows-rule.md",
      PROJECT_ROOT,
      emptySessions() as unknown as Map<string, never>,
      makeTimers(),
    );

    expect(contextCache.invalidate).toHaveBeenCalledWith("file_watch", PROJECT_ROOT);
  });

  it("does NOT invalidate cache for non-md files in rules/ (path does not match glob)", () => {
    handleCacheWatcherEvent(
      ".fabric/rules/README.txt",
      PROJECT_ROOT,
      emptySessions() as unknown as Map<string, never>,
      makeTimers(),
    );

    // .txt is not .md — handler should ignore it
    expect(contextCache.invalidate).not.toHaveBeenCalled();
  });
});
