import { afterEach, describe, expect, it } from "vitest";

import { startPreviewServer, type PreviewServerHandle } from "../src/commands/preview.js";

// The knowledge source toggle ("本项目 / 全部") is injected server-side into every
// variant view so all 7 style templates get it from one place. These tests lock
// the injection wiring: present on full variant views, suppressed in the
// gallery's embedded iframes.
describe("preview source toggle injection", () => {
  const handles: PreviewServerHandle[] = [];

  afterEach(async () => {
    await Promise.all(handles.splice(0).map((h) => h.close()));
  });

  async function start(): Promise<string> {
    const handle = await startPreviewServer({ port: 0 });
    handles.push(handle);
    return handle.url.replace(/\/$/, "");
  }

  it("injects the toggle into a full variant view (/v/<name>)", async () => {
    const base = await start();
    const html = await (await fetch(`${base}/v/lumen`)).text();
    expect(html).toContain("fabric-source-toggle");
    // The fetch wrapper that carries the source selection to /api/knowledge.
    expect(html).toContain("/api/knowledge");
    expect(html).toContain("fabricPreviewAllStores");
  });

  it("injects the toggle into the default landing view (/)", async () => {
    const base = await start();
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain("fabric-source-toggle");
  });

  it("suppresses the toggle in embedded variants (?embed=1)", async () => {
    const base = await start();
    const html = await (await fetch(`${base}/v/lumen?embed=1`)).text();
    expect(html).not.toContain("fabric-source-toggle");
  });

  it("gallery embeds variants as ?embed=1 (so inner frames stay toggle-free)", async () => {
    const base = await start();
    const html = await (await fetch(`${base}/gallery`)).text();
    expect(html).toContain("?embed=1");
    // The gallery shell itself is not a variant view — no toggle script.
    expect(html).not.toContain("fabricPreviewAllStores");
  });

  // The injected control bar also owns #3 (all-view store labels) and #9
  // (deprecated filter/mark) — decorating the shared /api/knowledge payload so
  // every variant gets them without per-template edits. These lock that wiring.
  it("injects the deprecated filter toggle + its persisted flag", async () => {
    const base = await start();
    const html = await (await fetch(`${base}/v/lumen`)).text();
    expect(html).toContain("fabricPreviewHideDeprecated");
    expect(html).toContain("弃用·显示");
    expect(html).toContain("弃用·隐藏");
  });

  it("decorates the shared knowledge payload (store prefix + deprecated mark)", async () => {
    const base = await start();
    const html = await (await fetch(`${base}/v/lumen`)).text();
    // #9: deprecated entries are flagged in the title regardless of layout.
    expect(html).toContain("已弃用 · ");
    // #3: in all-view the store becomes a per-row title prefix.
    expect(html).toContain("['+(e.store||'?')+'] ");
    // The transform runs against /api/knowledge responses.
    expect(html).toContain("e.deprecated");
  });

  it("does not decorate the graph module (it dims deprecated itself)", async () => {
    const base = await start();
    const html = await (await fetch(`${base}/graph`)).text();
    // The graph is a self-contained view, never wrapped by the injected snippet.
    expect(html).not.toContain("fabric-source-toggle");
    expect(html).not.toContain("fabricPreviewHideDeprecated");
  });
});
