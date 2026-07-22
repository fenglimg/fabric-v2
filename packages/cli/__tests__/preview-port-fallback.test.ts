import { afterEach, describe, expect, it } from "vitest";

import { startPreviewServer, type PreviewServerHandle } from "../src/commands/preview.js";

// P0: a busy port must NOT crash `fabric preview` — it auto-falls back to an
// OS-assigned free port. This locks that behavior (the pre-fix code threw
// EADDRINUSE and exited when a second preview / any 7777 holder was running).
describe("preview port auto-fallback", () => {
  const handles: PreviewServerHandle[] = [];

  afterEach(async () => {
    await Promise.all(handles.splice(0).map((h) => h.close()));
  });

  it("falls back to an ephemeral port when the requested one is busy", async () => {
    // First server grabs an OS-assigned free port (port 0). No fallback here.
    const first = await startPreviewServer({ port: 0 });
    handles.push(first);
    expect(first.portWasBusy).toBe(false);
    expect(first.port).toBeGreaterThan(0);

    // Second server requests the SAME port → busy → auto-fallback to a new port.
    const second = await startPreviewServer({ port: first.port });
    handles.push(second);
    expect(second.portWasBusy).toBe(true);
    expect(second.port).not.toBe(first.port);
    expect(second.port).toBeGreaterThan(0);
    expect(second.url).toContain(`:${second.port}/`);
  });

  it("does not flag a fallback when the requested port is free", async () => {
    const handle = await startPreviewServer({ port: 0 });
    handles.push(handle);
    expect(handle.portWasBusy).toBe(false);
  });
});
