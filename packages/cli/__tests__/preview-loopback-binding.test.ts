/**
 * The console server binds loopback ONLY, and there is no way to change that
 * from the CLI.
 *
 * This is a gate, not a preference. `--host 0.0.0.0` used to exist in
 * commands/preview.ts while TWO comments in that same file asserted "binds
 * 127.0.0.1 ONLY (never 0.0.0.0)". Nothing caught the contradiction because
 * nothing tested it. The console adds a write channel to this server, which
 * turns a LAN-reachable bind from "outsiders can read the knowledge base" into
 * "outsiders can rewrite this machine's Fabric config".
 */

import { describe, expect, it } from "vitest";

import { previewCommand, startPreviewServer } from "../src/commands/preview.js";

describe("preview server binding is loopback-only", () => {
  it("refuses a non-loopback host instead of silently downgrading", async () => {
    // Throwing matters more than the specific address: a silent fallback to
    // 127.0.0.1 would let a caller that asked for 0.0.0.0 believe it succeeded.
    await expect(startPreviewServer({ host: "0.0.0.0", port: 0 })).rejects.toThrow(/loopback-only/u);
    await expect(startPreviewServer({ host: "192.168.1.10", port: 0 })).rejects.toThrow(
      /loopback-only/u,
    );
  });

  it("exposes no CLI surface for changing the bind address", () => {
    // The runtime guard alone is not enough. If someone re-adds `--host` later,
    // the guard turns it into a flag that always errors — every runtime test
    // above still passes, and the only symptom is a user-facing dead end.
    // Asserting on the arg table is what makes re-adding it fail loudly.
    const args = previewCommand.args ?? {};
    expect(Object.keys(args)).not.toContain("host");
    expect(Object.keys(args)).not.toContain("bind");
    expect(Object.keys(args)).not.toContain("address");
  });

  it("binds 127.0.0.1 by default", async () => {
    const handle = await startPreviewServer({ port: 0 });
    try {
      expect(handle.url.startsWith("http://127.0.0.1:")).toBe(true);
    } finally {
      await handle.close();
    }
  });

  it("accepts the loopback aliases", async () => {
    for (const host of ["127.0.0.1", "localhost"]) {
      const handle = await startPreviewServer({ host, port: 0 });
      try {
        expect(handle.port).toBeGreaterThan(0);
      } finally {
        await handle.close();
      }
    }
  });
});
