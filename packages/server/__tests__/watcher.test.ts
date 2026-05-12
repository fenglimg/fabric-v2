/**
 * watcher.test.ts — TASK-024 chokidar watcher / Layer 2 P0 review
 *
 * v2/rc.2: tests retargeted from `.fabric/rules/**\/*.md` to
 * `.fabric/knowledge/**\/*.md` to match the v2 cache-watcher glob.
 *
 * Verifies that handleCacheWatcherEvent calls invalidateKnowledgeSyncCooldown
 * when a .fabric/knowledge/*.md file changes, so the next MCP call performs
 * a real I/O scan rather than returning a stale cached-fresh response.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import * as knowledgeSyncModule from "../src/services/knowledge-sync.js";
import { handleCacheWatcherEvent } from "../src/http.js";

describe("handleCacheWatcherEvent — watcher bridge to knowledge-sync cooldown (v2)", () => {
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

  it("calls invalidateKnowledgeSyncCooldown when a .fabric/knowledge/*.md file changes", () => {
    const projectRoot = "/fake/project";
    const sessions = new Map<string, never>();
    const spy = vi.spyOn(knowledgeSyncModule, "invalidateKnowledgeSyncCooldown");

    handleCacheWatcherEvent(
      ".fabric/knowledge/decisions/rule.md",
      projectRoot,
      sessions as Parameters<typeof handleCacheWatcherEvent>[2],
      makeTimers(),
    );

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(projectRoot);
  });

  it("calls invalidateKnowledgeSyncCooldown for nested knowledge paths", () => {
    const projectRoot = "/fake/project";
    const sessions = new Map<string, never>();
    const spy = vi.spyOn(knowledgeSyncModule, "invalidateKnowledgeSyncCooldown");

    handleCacheWatcherEvent(
      ".fabric/knowledge/guidelines/deep/nested/dir/rule.md",
      projectRoot,
      sessions as Parameters<typeof handleCacheWatcherEvent>[2],
      makeTimers(),
    );

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(projectRoot);
  });

  it("does NOT call invalidateKnowledgeSyncCooldown for non-knowledge-file events (agents.meta.json)", () => {
    const projectRoot = "/fake/project";
    const sessions = new Map<string, never>();
    const spy = vi.spyOn(knowledgeSyncModule, "invalidateKnowledgeSyncCooldown");

    handleCacheWatcherEvent(
      ".fabric/agents.meta.json",
      projectRoot,
      sessions as Parameters<typeof handleCacheWatcherEvent>[2],
      makeTimers(),
    );

    expect(spy).not.toHaveBeenCalled();
  });

  it("does NOT call invalidateKnowledgeSyncCooldown for legacy bootstrap README events (v2.0: ignored entirely)", () => {
    const projectRoot = "/fake/project";
    const sessions = new Map<string, never>();
    const spy = vi.spyOn(knowledgeSyncModule, "invalidateKnowledgeSyncCooldown");

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
