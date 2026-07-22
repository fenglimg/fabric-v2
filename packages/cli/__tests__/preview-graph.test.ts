import { afterEach, describe, expect, it } from "vitest";

import { startPreviewServer, type PreviewServerHandle } from "../src/commands/preview.js";

// The relationship graph module (`/graph`) is a self-contained server-rendered
// view. These lock the route + its entry point in the injected source toggle.
describe("preview relationship graph module", () => {
  const handles: PreviewServerHandle[] = [];
  afterEach(async () => {
    await Promise.all(handles.splice(0).map((h) => h.close()));
  });
  async function start(): Promise<string> {
    const handle = await startPreviewServer({ port: 0 });
    handles.push(handle);
    return handle.url.replace(/\/$/, "");
  }

  it("serves the graph view at /graph", async () => {
    const base = await start();
    const html = await (await fetch(`${base}/graph`)).text();
    expect(html).toContain("知识关联图");
    // Reads the same knowledge endpoint, honoring the source selection.
    expect(html).toContain("/api/knowledge?all=");
    // The SVG graph scaffold + node-coordinate conversion for interactions.
    expect(html).toContain('<svg id="g">');
    expect(html).toContain("getScreenCTM");
  });

  it("exposes a graph entry point from the injected source toggle", async () => {
    const base = await start();
    const html = await (await fetch(`${base}/v/lumen`)).text();
    expect(html).toContain("关联图");
    expect(html).toContain("/graph?all=");
  });

  it("the source toggle injects the truncation title-relief pass", async () => {
    const base = await start();
    const html = await (await fetch(`${base}/v/lumen`)).text();
    // #2/#6: clipped labels get a native title= tooltip so the full value shows.
    expect(html).toContain("titleTruncated");
  });
});
