import { afterEach, describe, expect, it } from "vitest";

import { startPreviewServer, type PreviewServerHandle } from "../src/commands/preview.js";

// The relationship graph module (`/graph`) is a self-contained server-rendered
// view. These lock the route + its entry point in the lumen header view tab.
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

  it("enhanced view: connected subgraph + labels + orphan list + store clusters", async () => {
    const base = await start();
    const html = await (await fetch(`${base}/graph`)).text();
    // 孤点折叠清单入口(不静默隐藏)。
    expect(html).toContain("未关联条目");
    // 常驻节点短标签(SVG text)。
    expect(html).toContain("text-anchor");
    expect(html).toContain("truncate14");
    // 仿真/绘制只用有边子图。
    expect(html).toContain("n.deg>0");
    // 按 store 分簇着色 + 点击侧板跳详情。
    expect(html).toContain("storeColor");
    expect(html).toContain("/?entry=");
    // 旧的 scope 三色图例硬编码已被动态 store 图例取代。
    expect(html).not.toContain('--team:#0d9488');
    // 边源不变:仅同 store 解析 related。
    expect(html).toContain("byKey[e.store+'|'+rid]");
  });

  it("exposes a graph entry point from the lumen header view tab", async () => {
    const base = await start();
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain("关联图");
    expect(html).toContain('id="graphtab"');
    // The tab carries the current source selection (?all=) when painted.
    expect(html).toContain("/graph?all=");
  });

  it("lumen carries the truncation title-relief pass", async () => {
    const base = await start();
    const html = await (await fetch(`${base}/`)).text();
    // #2/#6: clipped labels get a native title= tooltip so the full value shows.
    expect(html).toContain("titleTruncated");
  });
});
