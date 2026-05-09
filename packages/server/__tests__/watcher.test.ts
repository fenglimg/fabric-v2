/**
 * watcher.test.ts — TASK-024 chokidar watcher / Layer 2 P0 review
 *
 * Verifies that handleCacheWatcherEvent calls invalidateRuleSyncCooldown when
 * a .fabric/rules/*.md file changes, so the next MCP call performs a real
 * I/O scan rather than returning a stale cached-fresh response.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import * as ruleSyncModule from "../src/services/rule-sync.js";
import { handleCacheWatcherEvent } from "../src/http.js";

describe("handleCacheWatcherEvent — watcher bridge to rule-sync cooldown", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Minimal sessions map and timer shims required by handleCacheWatcherEvent.
   */
  function makeTimers() {
    let agentsMdTimer: ReturnType<typeof setTimeout> | undefined;
    let toolListTimer: ReturnType<typeof setTimeout> | undefined;
    return {
      getAgentsMdTimer: () => agentsMdTimer,
      getToolListTimer: () => toolListTimer,
      setAgentsMdTimer: (t: ReturnType<typeof setTimeout> | undefined) => { agentsMdTimer = t; },
      setToolListTimer: (t: ReturnType<typeof setTimeout> | undefined) => { toolListTimer = t; },
    };
  }

  it("calls invalidateRuleSyncCooldown when a .fabric/rules/*.md file changes", () => {
    const projectRoot = "/fake/project";
    const sessions = new Map<string, never>();
    const spy = vi.spyOn(ruleSyncModule, "invalidateRuleSyncCooldown");

    handleCacheWatcherEvent(
      ".fabric/rules/core/rule.md",
      projectRoot,
      sessions as Parameters<typeof handleCacheWatcherEvent>[2],
      makeTimers(),
    );

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(projectRoot);
  });

  it("calls invalidateRuleSyncCooldown for nested rule paths", () => {
    const projectRoot = "/fake/project";
    const sessions = new Map<string, never>();
    const spy = vi.spyOn(ruleSyncModule, "invalidateRuleSyncCooldown");

    handleCacheWatcherEvent(
      ".fabric/rules/deep/nested/dir/rule.md",
      projectRoot,
      sessions as Parameters<typeof handleCacheWatcherEvent>[2],
      makeTimers(),
    );

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(projectRoot);
  });

  it("does NOT call invalidateRuleSyncCooldown for non-rule-file events (agents.meta.json)", () => {
    const projectRoot = "/fake/project";
    const sessions = new Map<string, never>();
    const spy = vi.spyOn(ruleSyncModule, "invalidateRuleSyncCooldown");

    handleCacheWatcherEvent(
      ".fabric/agents.meta.json",
      projectRoot,
      sessions as Parameters<typeof handleCacheWatcherEvent>[2],
      makeTimers(),
    );

    expect(spy).not.toHaveBeenCalled();
  });

  it("does NOT call invalidateRuleSyncCooldown for legacy bootstrap README events (v2.0: ignored entirely)", () => {
    const projectRoot = "/fake/project";
    const sessions = new Map<string, never>();
    const spy = vi.spyOn(ruleSyncModule, "invalidateRuleSyncCooldown");

    // v2.0: the legacy bootstrap path is no longer watched, but
    // handleCacheWatcherEvent must still be a safe no-op when called with it
    // (e.g. via stale watch glob in older deployments).
    handleCacheWatcherEvent(
      ".fabric/bootstrap/README.md",
      projectRoot,
      sessions as Parameters<typeof handleCacheWatcherEvent>[2],
      makeTimers(),
    );

    expect(spy).not.toHaveBeenCalled();
  });
});
