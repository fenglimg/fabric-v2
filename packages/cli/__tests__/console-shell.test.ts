/**
 * The console shell: shared stylesheet, cross-page navigation, status page.
 *
 * AC6 ("change one place, both pages follow") is the reason the CSS assertions
 * here check that pages LINK the shared sheet rather than that they look right —
 * a page carrying its own copy of the palette is exactly the state this task
 * removed, and it renders identically the day you create it.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startPreviewServer, type PreviewServerHandle } from "../src/commands/preview.js";

const handles: PreviewServerHandle[] = [];
const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(handles.splice(0).map((h) => h.close()));
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function start(target?: string): Promise<string> {
  const handle = await startPreviewServer(target === undefined ? { port: 0 } : { port: 0, target });
  handles.push(handle);
  return handle.url.replace(/\/$/u, "");
}

describe("shared shell assets", () => {
  it("serves the stylesheet with the design tokens", async () => {
    const base = await start();
    const res = await fetch(`${base}/assets/shell.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
    const css = await res.text();
    expect(css).toContain("--bg:");
    expect(css).toContain(".navbar");
    expect(css).toContain('[data-theme="dark"]');
  });

  it("serves the shared shell script", async () => {
    const base = await start();
    const res = await fetch(`${base}/assets/shell.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(await res.text()).toContain("pcf-theme");
  });

  it("only serves the whitelisted assets", async () => {
    // The asset route is a fixed map, not a directory handler — a directory
    // handler is one missing path check away from serving the repo.
    const base = await start();
    for (const path of [
      "/assets/../src/commands/preview.ts",
      "/assets/shell.css/../../package.json",
      "/assets/nope.css",
    ]) {
      expect((await fetch(`${base}${path}`)).status).toBe(404);
    }
  });

  it("every page links the shared sheet instead of carrying its own palette", async () => {
    const base = await start();
    for (const path of ["/", "/graph", "/status"]) {
      const html = await (await fetch(`${base}${path}`)).text();
      expect(html).toContain('href="/assets/shell.css"');
    }
    // The graph page used to define its own `:root{--bg…}` block, copied from
    // lumen. That copy is what AC6 forbids, so assert it is gone rather than
    // just that the link is present — a page can do both.
    const graph = await (await fetch(`${base}/graph`)).text();
    expect(graph).not.toContain("--bg:#f6f6f4");
    expect(graph).not.toContain("prefers-color-scheme:dark){:root");
  });

  it("changing the shared sheet is visible to every page that links it", () => {
    // Structural form of AC6: one file on disk backs the route all pages link,
    // so there is no second copy to forget. Asserted on the file rather than by
    // mutating it, so the test does not write into the source tree.
    //
    // The check is that every legacy token name lumen/graph still spell is
    // defined as `var(...)` — an alias onto the current palette — rather than as
    // a frozen literal. That is what makes a re-skin reach the old pages without
    // editing them. Pinning one exact alias pair (this used to assert
    // `--text2: var(--text-tertiary)`) tested the palette of the day instead:
    // re-pointing the alias one hop closer to its source broke the test while
    // the property it was meant to protect held.
    const css = readFileSync(
      new URL("../templates/console/shell.css", import.meta.url),
      "utf8",
    );
    const legacyNames = [
      "--bg",
      "--surface",
      "--surface-2",
      "--surface-hover",
      "--border-strong",
      "--text",
      "--text-secondary",
      "--text-tertiary",
      "--text2",
      "--shadow",
    ];
    for (const name of legacyNames) {
      const decl = new RegExp(`\\${name}:\\s*([^;]+);`).exec(css);
      expect(decl, `${name} must still be declared for lumen/graph`).not.toBeNull();
      expect(decl![1].trim(), `${name} must alias a token, not hardcode a value`).toMatch(
        /^var\(--[\w-]+\)$/,
      );
    }
  });
});

describe("cross-page navigation", () => {
  it("all three pages carry the same nav targets", async () => {
    const base = await start();
    for (const path of ["/", "/graph", "/status"]) {
      const html = await (await fetch(`${base}${path}`)).text();
      expect(html).toContain('class="navbar"');
      expect(html).toContain('href="/graph"');
      expect(html).toContain('href="/status"');
      expect(html).toContain('href="/"');
    }
  });
});

describe("status page", () => {
  it("serves the page", async () => {
    const base = await start();
    const html = await (await fetch(`${base}/status`)).text();
    expect(html).toContain("Fabric 控制台 · 状态");
    expect(html).toContain("/api/status");
  });

  it("reports version, project root and store breakdown", async () => {
    const base = await start();
    const res = await fetch(`${base}/api/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // vitest.config.ts defines __CLI_VERSION__ = "0.0.0-test"; asserting that
    // exact value (not "some string") is what proves the version comes from the
    // build define rather than the "unknown" fallback.
    expect(body.fabricVersion).toBe("0.0.0-test");
    expect(body.projectRoot).toBe(process.cwd());
    expect(Array.isArray(body.stores)).toBe(true);
    expect(typeof body.entryCount).toBe("number");
    expect(typeof body.revision).toBe("string");
  });

  // Three empty states need three DIFFERENT next commands (install / bind a
  // store / seed the store), so they are distinguished by fixture rather than by
  // branching on whatever the test process's cwd happens to contain. A test that
  // asserts "whichever reason came back is the right one for what I observed"
  // passes under every implementation, including a broken one.
  it("reports no-config for a directory with no .fabric", async () => {
    const target = mkdtempSync(join(tmpdir(), "fab-console-noconfig-"));
    tempDirs.push(target);
    const base = await start(target);
    const body = (await (await fetch(`${base}/api/status`)).json()) as {
      emptyReason: string | null;
      projectId: string | null;
      activeWriteStore: string | null;
    };
    expect(body.emptyReason).toBe("no-config");
    expect(body.projectId).toBeNull();
    expect(body.activeWriteStore).toBeNull();
  });

  it("reports no-stores for an installed project that bound nothing", async () => {
    // `{}` is the real shape of fabric-config.json after an install that binds
    // no store — the same fact that forced the project registry to key on path
    // rather than project_id.
    const target = mkdtempSync(join(tmpdir(), "fab-console-nostores-"));
    tempDirs.push(target);
    mkdirSync(join(target, ".fabric"), { recursive: true });
    writeFileSync(join(target, ".fabric", "fabric-config.json"), "{}\n", "utf8");
    const base = await start(target);
    const body = (await (await fetch(`${base}/api/status`)).json()) as {
      emptyReason: string | null;
      stores: unknown[];
    };
    expect(body.emptyReason).toBe("no-stores");
    expect(body.stores).toEqual([]);
  });

  it("ships guidance copy for all three empty reasons", async () => {
    const base = await start();
    const html = await (await fetch(`${base}/status`)).text();
    for (const reason of ["no-config", "no-stores", "no-entries"]) {
      expect(html).toContain(`'${reason}'`);
    }
    // Guidance that does not name a command is not guidance.
    expect(html).toContain("fabric install");
    expect(html).toContain("fabric store bind");
  });
});
