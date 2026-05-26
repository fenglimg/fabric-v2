/**
 * rc.15 TASK-007: error-render util tests.
 *
 * Background: ServeLockHeldError (and other FabricError subclasses) carries
 * both `.message` and `.actionHint`. citty's default error handler prints
 * `.message` only — the actionHint (which carries the TASK-003 verbose PID
 * + Ctrl-C/kill recovery guidance) was being silently dropped at every CLI
 * surface that hits a lock conflict (`fabric serve`, `fabric doctor`, `fabric install`,
 * `fabric uninstall`).
 *
 * The error-render util provides the structural type guard + stderr renderer
 * that lock-check call sites invoke before `process.exit(1)`. These tests
 * verify:
 *   1. `hasActionHint` returns true for FabricError-shaped objects only.
 *   2. `renderFabricError` writes BOTH the main message AND the actionHint
 *      to the supplied stream (so a CLI integration verifies the user
 *      receives the full UX wording).
 */

import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { ServeLockHeldError } from "@fenglimg/fabric-server";

import { hasActionHint, renderFabricError } from "../src/lib/error-render.js";

function captureStream(): Writable & { captured: string } {
  let buf = "";
  const stream = new Writable({
    write(chunk, _enc, cb) {
      buf += chunk.toString();
      cb();
    },
  }) as Writable & { captured: string };
  Object.defineProperty(stream, "captured", {
    get() {
      return buf;
    },
  });
  return stream;
}

describe("hasActionHint", () => {
  it("returns true for ServeLockHeldError (real FabricError subclass)", () => {
    const err = new ServeLockHeldError("lock held", {
      actionHint: "Stop the running serve",
    });
    expect(hasActionHint(err)).toBe(true);
  });

  it("returns true for plain object with message + actionHint", () => {
    expect(hasActionHint({ message: "m", actionHint: "a" })).toBe(true);
  });

  it("returns false for plain Error (no actionHint)", () => {
    expect(hasActionHint(new Error("boom"))).toBe(false);
  });

  it("returns false for string / null / undefined / number", () => {
    expect(hasActionHint("oops")).toBe(false);
    expect(hasActionHint(null)).toBe(false);
    expect(hasActionHint(undefined)).toBe(false);
    expect(hasActionHint(42)).toBe(false);
  });

  it("returns false when actionHint is empty string", () => {
    expect(hasActionHint({ message: "m", actionHint: "" })).toBe(false);
  });

  it("returns false when message is empty string", () => {
    expect(hasActionHint({ message: "", actionHint: "a" })).toBe(false);
  });

  it("returns false when actionHint is non-string", () => {
    expect(hasActionHint({ message: "m", actionHint: 7 })).toBe(false);
  });
});

describe("renderFabricError", () => {
  it("writes BOTH message and actionHint to the supplied stream", () => {
    const stream = captureStream();
    renderFabricError(
      { message: "serve lock held by live PID 12345", actionHint: "Stop the running 'fabric serve' (Ctrl-C or 'kill 12345')" },
      stream,
    );
    expect(stream.captured).toContain("serve lock held by live PID 12345");
    expect(stream.captured).toContain("Stop the running 'fabric serve' (Ctrl-C or 'kill 12345')");
  });

  it("renders ServeLockHeldError end-to-end (TASK-003 wording surfaces in output)", () => {
    const stream = captureStream();
    const err = new ServeLockHeldError("serve lock held by live PID 4242", {
      actionHint: "Stop the running 'fabric serve' (Ctrl-C in its terminal, or 'kill 4242') before retrying.",
    });
    renderFabricError(err, stream);
    // BOTH wording lines must reach the user — this is the regression the
    // hotfix exists to prevent.
    expect(stream.captured).toContain("serve lock held by live PID 4242");
    expect(stream.captured).toContain("kill 4242");
    expect(stream.captured).toMatch(/Ctrl-C|fabric serve/);
  });

  it("formats actionHint as an indented arrow on its own line", () => {
    const stream = captureStream();
    renderFabricError({ message: "M", actionHint: "A" }, stream);
    expect(stream.captured).toBe("M\n  -> A\n");
  });
});
