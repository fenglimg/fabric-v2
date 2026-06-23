/**
 * W3-B F-005 (TASK-006): NO_COLOR snapshot of the reskinned SessionStart HUD AI
 * sink (renderAiSink in templates/hooks/knowledge-hint-broad.cjs).
 *
 * Pins the W3-B structure per mockups.md#3: a sectionBar title carrying the
 * active/reference counts, an ALWAYS-ACTIVE sub-section, and a REFERENCE
 * sub-section — each entry line prefixed with a scopeBadge ([team]/[project]/
 * [personal]) + plain two-space indent + [type] + id + summary/must_read_if.
 *
 * The hook is a standalone .cjs consumed by the runtime; we load it via
 * createRequire (same pattern as theme-parity.test.ts) and snapshot the pure
 * renderAiSink fn directly — no spawn, no FS. NO_COLOR=1 is stubbed so the
 * snapshot is the deterministic ASCII fallback (sectionBar → `# …`, scopeBadge →
 * `[scope]`), independent of the CI TTY state.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const hook = require(
  fileURLToPath(new URL("../templates/hooks/knowledge-hint-broad.cjs", import.meta.url)),
) as {
  renderAiSink: (opts: unknown) => string;
  layerToScope: (entry: unknown) => string;
};

// Fixture entries span all three scopes (team / project / personal) across both
// the always-active (guideline/model) and reference (decision/pitfall/process)
// tiers so the snapshot exercises every scopeBadge branch + both sections.
const alwaysBodies = [
  { id: "team:KT-GLD-0001", type: "guidelines", layer: "team", summary: "改源码前先读 bootstrap", body: "..." },
  { id: "project:KP-MOD-0002", type: "models", layer: "project", summary: "scope 是三维度独立", body: "..." },
];
const entries = [
  {
    id: "team:KT-DEC-0036",
    type: "decision",
    maturity: "draft",
    relevance_scope: "broad",
    summary: "SessionStart index-only",
    must_read_if: "改 renderAiSink / 注入预算逻辑时",
  },
  {
    id: "personal:KP-PIT-0007",
    type: "pitfall",
    maturity: "verified",
    relevance_scope: "broad",
    summary: "co-location 删除是读侧迁移",
  },
  // narrow entries stay silent (KT-DEC-0029) — present to prove they're filtered.
  {
    id: "team:KT-DEC-0099",
    type: "decision",
    maturity: "draft",
    relevance_scope: "narrow",
    summary: "narrow noise",
    must_read_if: "should not appear",
  },
];

describe("knowledge-hint-broad.cjs renderAiSink — W3-B reskin (NO_COLOR)", () => {
  beforeEach(() => {
    vi.stubEnv("NO_COLOR", "1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("layerToScope maps layer + id prefix to a scopeBadge scope key", () => {
    expect(hook.layerToScope({ layer: "team" })).toBe("team");
    expect(hook.layerToScope({ layer: "project" })).toBe("project");
    expect(hook.layerToScope({ layer: "personal" })).toBe("personal");
    expect(hook.layerToScope({ id: "project:KT-DEC-0001" })).toBe("project");
    expect(hook.layerToScope({ id: "personal:KP-PIT-0001" })).toBe("personal");
    expect(hook.layerToScope({ id: "KP-GLD-0001" })).toBe("personal");
    expect(hook.layerToScope({ id: "unknown:KT-DEC-0001" })).toBe("team");
    expect(hook.layerToScope({})).toBe("team");
  });

  it("renders the section-bar title + counts + scope-badge groups (en)", () => {
    const out = hook.renderAiSink({
      entries,
      alwaysBodies,
      storeLabel: "team-knowledge",
      broadIndexBackstop: 50,
      summaryMaxLen: 80,
      lang: "en",
    });
    expect(out).toMatchSnapshot();
  });

  it("renders the section-bar title + counts + scope-badge groups (zh-CN)", () => {
    const out = hook.renderAiSink({
      entries,
      alwaysBodies,
      storeLabel: "team-knowledge",
      broadIndexBackstop: 50,
      summaryMaxLen: 80,
      lang: "zh-CN",
    });
    expect(out).toMatchSnapshot();
  });
});
