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
});
