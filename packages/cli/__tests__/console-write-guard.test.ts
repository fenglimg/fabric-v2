/**
 * The console's write channel: POST-only, loopback-Origin-only.
 *
 * The product decision is "no auth" — anything that reaches loopback can already
 * edit ~/.fabric, so a password buys nothing. That covers WHO, not WHETHER the
 * user asked: a page on the open internet can make the browser POST to
 * 127.0.0.1, and a hostile DNS name can resolve to 127.0.0.1 so the packet looks
 * local. These lock the two checks that separate "the console page asked" from
 * "something asked the console".
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { isSameOriginLoopback } from "../src/console/security.js";
import { startPreviewServer, type PreviewServerHandle } from "../src/commands/preview.js";

describe("isSameOriginLoopback", () => {
  const PORT = 7777;

  it("accepts a request from the console page itself", () => {
    expect(
      isSameOriginLoopback({ host: "127.0.0.1:7777", origin: "http://127.0.0.1:7777" }, PORT).ok,
    ).toBe(true);
    expect(
      isSameOriginLoopback({ host: "localhost:7777", origin: "http://localhost:7777" }, PORT).ok,
    ).toBe(true);
  });

  it("rejects a cross-site Origin", () => {
    const v = isSameOriginLoopback(
      { host: "127.0.0.1:7777", origin: "https://evil.example" },
      PORT,
    );
    expect(v.ok).toBe(false);
  });

  it("rejects a non-loopback Host even though the socket is local (DNS rebinding)", () => {
    // The browser sends the NAME it dialled. A hostile domain pointed at
    // 127.0.0.1 arrives with that domain here, so inspecting the socket address
    // instead of this header would wave it through.
    const v = isSameOriginLoopback(
      { host: "rebind.evil.example:7777", origin: "http://rebind.evil.example:7777" },
      PORT,
    );
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toMatch(/non-loopback Host/u);
  });

  it("rejects a missing Origin", () => {
    // Browsers attach Origin to every non-GET request, same-origin included, so
    // absence means no page-initiated fetch and therefore no user gesture.
    const v = isSameOriginLoopback({ host: "127.0.0.1:7777" }, PORT);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toMatch(/missing Origin/u);
  });

  it("rejects another loopback service's port", () => {
    // A different local program is still not this console.
    const v = isSameOriginLoopback(
      { host: "127.0.0.1:7777", origin: "http://127.0.0.1:3000" },
      PORT,
    );
    expect(v.ok).toBe(false);
  });

  it("compares against the BOUND port, not the default", () => {
    // 7777 is often busy and the server falls back to an ephemeral port. Pinning
    // the requested port would reject every real request in that case.
    expect(
      isSameOriginLoopback({ host: "127.0.0.1:54321", origin: "http://127.0.0.1:54321" }, 54321).ok,
    ).toBe(true);
    expect(
      isSameOriginLoopback({ host: "127.0.0.1:54321", origin: "http://127.0.0.1:54321" }, 7777).ok,
    ).toBe(false);
  });

  it("handles a bracketed IPv6 loopback Host", () => {
    expect(isSameOriginLoopback({ host: "[::1]:7777", origin: "http://[::1]:7777" }, PORT).ok).toBe(
      true,
    );
  });
});

describe("write endpoints over HTTP", () => {
  const handles: PreviewServerHandle[] = [];
  afterEach(async () => {
    await Promise.all(handles.splice(0).map((h) => h.close()));
    vi.restoreAllMocks();
  });

  async function start(opener?: (file: string) => void): Promise<{ base: string; port: number }> {
    const handle = await startPreviewServer(opener ? { port: 0, opener } : { port: 0 });
    handles.push(handle);
    return { base: handle.url.replace(/\/$/u, ""), port: handle.port };
  }

  it("refuses GET on a write endpoint (405)", async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/open`);
    expect(res.status).toBe(405);
  });

  // The guard is driven by the WRITE_ROUTES table, so every route in it must
  // inherit the same treatment. Pinning the SECOND route is what turns "the
  // table works" from a claim about one endpoint into a claim about the
  // mechanism — a per-handler guard would pass the /api/open cases above and
  // still leave this one open.
  it("refuses GET on /api/config/set (405) while /api/config stays readable", async () => {
    const { base } = await start();
    // The read and the write deliberately live at different paths: membership in
    // WRITE_ROUTES refuses every non-POST method, so sharing one path would need
    // an exception carved into the guard.
    expect((await fetch(`${base}/api/config`, { method: "GET" })).status).toBe(200);
    expect((await fetch(`${base}/api/config/set`, { method: "GET" })).status).toBe(405);
  });

  // The THIRD route. Each new write endpoint is a fresh chance to add a handler
  // and forget the guard, and the guard being table-driven is only a safety net
  // if membership in the table is what gets asserted — not the handler's own
  // first line.
  it("refuses GET and a foreign Origin on /api/config/preset", async () => {
    const { base } = await start();
    expect((await fetch(`${base}/api/config/preset`, { method: "GET" })).status).toBe(405);

    const res = await fetch(`${base}/api/config/preset`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ preset: "relaxed", target: { scope: "machine" } }),
    });
    expect(res.status).toBe(403);
  });

  it("refuses an illegal preset id from a legitimate Origin (400, nothing applied)", async () => {
    const { base, port } = await start();
    const res = await fetch(`${base}/api/config/preset`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: `http://127.0.0.1:${String(port)}`,
      },
      body: JSON.stringify({ preset: "../../etc/passwd", target: { scope: "machine" } }),
    });
    // 400, not 403: the guard let it through and the HANDLER refused the id.
    // The distinction is the point — a 403 here would leave the closed enum
    // untested.
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("unknown preset");
  });

  // The FOURTH route, and the only one that can start a child process — so the
  // assertion that matters is not just "the guard covers it" but "an illegal
  // action is refused BEFORE anything is spawned".
  it("refuses GET and a foreign Origin on /api/repair", async () => {
    const { base } = await start();
    expect((await fetch(`${base}/api/repair`, { method: "GET" })).status).toBe(405);

    const res = await fetch(`${base}/api/repair`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ action: "install" }),
    });
    expect(res.status).toBe(403);
  });

  it("refuses an unknown repair action from a legitimate Origin, spawning nothing", async () => {
    const { base, port } = await start();
    for (const action of ["doctor", "install; rm -rf /", "", null]) {
      const res = await fetch(`${base}/api/repair`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: `http://127.0.0.1:${String(port)}`,
        },
        body: JSON.stringify({ action }),
      });
      // 400, not 403: the guard passed it and the closed ACTIONS table refused.
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("unknown action");
      // The content type is the "nothing was spawned" oracle. A child's output
      // is streamed as text/plain, and that response is committed with its
      // first chunk — so a JSON body proves the streaming branch was never
      // entered. Status alone would still pass against a handler that ran the
      // command and only then decided it was illegal.
      expect(res.headers.get("content-type")).toContain("application/json");
    }
  });

  it("refuses a repair aimed at machine scope, spawning nothing", async () => {
    // There is no machine-wide install tree. Refusing beats the alternative the
    // scope switcher already rules out: quietly repairing the launch directory
    // while the page says you are looking at the machine.
    const { base, port } = await start();
    const res = await fetch(`${base}/api/repair`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: `http://127.0.0.1:${String(port)}`,
      },
      body: JSON.stringify({ action: "install", scope: "machine" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("machine scope");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("refuses a config POST carrying a foreign Origin (403)", async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/config/set`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ key: "nudge_mode", value: "silent" }),
    });
    expect(res.status).toBe(403);
  });

  it("refuses a POST carrying a foreign Origin (403)", async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/open`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ qualifiedId: "whatever" }),
    });
    expect(res.status).toBe(403);
  });

  it("refuses a POST with no Origin at all (403)", async () => {
    // node's fetch does not add Origin, so this is the default shape of a
    // non-browser client — exactly what the guard is meant to turn away.
    const { base } = await start();
    const res = await fetch(`${base}/api/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ qualifiedId: "whatever" }),
    });
    expect(res.status).toBe(403);
  });

  it("reaches the handler when the Origin is this console (and still validates input)", async () => {
    const opened: string[] = [];
    const { base, port } = await start((file) => opened.push(file));
    const res = await fetch(`${base}/api/open`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: `http://127.0.0.1:${String(port)}`,
      },
      body: JSON.stringify({ qualifiedId: "no-such-store:KT-NOPE-9999" }),
    });
    // 404, not 403: the guard let it through and the HANDLER rejected the id.
    // Asserting the distinction is what proves the guard is not the thing
    // failing here — a 403 would make the rest of this endpoint untestable.
    expect(res.status).toBe(404);
    expect(opened).toEqual([]);
  });

  it("does not put read endpoints behind the write guard", async () => {
    // Regression fence for the dispatcher: the guard is keyed off a route table,
    // and a table typo that swallowed a read route would break the whole UI.
    const { base } = await start();
    for (const path of ["/api/knowledge", "/api/revision", "/api/status"]) {
      expect((await fetch(`${base}${path}`)).status).toBe(200);
    }
  });
});
