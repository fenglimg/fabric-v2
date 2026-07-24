import { afterEach, describe, expect, it } from "vitest";

import { startPreviewServer, type PreviewServerHandle } from "../src/commands/preview.js";

// The source/deprecated controls now live INSIDE the single lumen template
// (header source switch + deprecated filter chip) — the injected floating bar
// and the variant/gallery machinery are gone. These tests lock that contract.
describe("preview single-template controls", () => {
  const handles: PreviewServerHandle[] = [];

  afterEach(async () => {
    await Promise.all(handles.splice(0).map((h) => h.close()));
  });

  async function start(): Promise<string> {
    const handle = await startPreviewServer({ port: 0 });
    handles.push(handle);
    return handle.url.replace(/\/$/, "");
  }

  it("serves lumen at / with in-template source + deprecated controls", async () => {
    const base = await start();
    const html = await (await fetch(`${base}/`)).text();
    // sessionStorage keys preserved from the old injected bar (behavior parity).
    expect(html).toContain("fabricPreviewAllStores");
    expect(html).toContain("fabricPreviewHideDeprecated");
    // The injected floating bar is gone for good.
    expect(html).not.toContain("fabric-source-toggle");
    // The three relocated controls are template-authored.
    expect(html).toContain('id="sourceswitch"');
    expect(html).toContain('id="depfilter"');
    expect(html).toContain('id="graphtab"');
  });

  it("removed the gallery route", async () => {
    const base = await start();
    const res = await fetch(`${base}/gallery`);
    expect(res.status).toBe(404);
  });

  it("removed the /v/<name> variant route", async () => {
    const base = await start();
    const res = await fetch(`${base}/v/lumen`);
    expect(res.status).toBe(404);
  });

  it("keeps the graph module route alive", async () => {
    const base = await start();
    const res = await fetch(`${base}/graph`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("关联图");
  });
});
