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

// v2.0.0-rc.37 Wave A2: `ServeLockHeldError` no longer re-exported from the
// main server package (the class itself lives at server/src/services/serve-lock.ts
// for doctor's stale-lock advisory, but is no longer part of the public API).
// FabricError subclass coverage is still provided by the plain-object tests
// below (`hasActionHint` / `renderFabricError` only care about the structural
// shape `{ message: string, actionHint: string }`).
import {
  hasActionHint,
  renderFabricError,
  renderTopLevelError,
  renderUnexpectedError,
} from "../src/lib/error-render.js";

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
  // v2.0.0-rc.37 Wave A2: ServeLockHeldError-shaped test removed (class no
  // longer re-exported). Structural type guard coverage continues via the
  // plain-object tests below — they exercise the same shape contract.

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

describe("renderTopLevelError (ISS-030 top-level CLI catch)", () => {
  it("renders a FabricError-shaped failure (message + actionHint) and returns 'fabric-error'", () => {
    const stream = captureStream();
    const verdict = renderTopLevelError(
      { message: "agents.meta.json is corrupt and was NOT overwritten", actionHint: "Restore from version control or delete it." },
      stream,
    );
    expect(verdict).toBe("fabric-error");
    expect(stream.captured).toContain("agents.meta.json is corrupt and was NOT overwritten");
    expect(stream.captured).toContain("  -> Restore from version control or delete it.");
  });

  it("returns 'other' and writes nothing for a plain Error (caller falls back to citty)", () => {
    const stream = captureStream();
    const verdict = renderTopLevelError(new Error("plain failure"), stream);
    expect(verdict).toBe("other");
    expect(stream.captured).toBe("");
  });

  it("returns 'other' for a citty CLIError shape (has code, no actionHint)", () => {
    const stream = captureStream();
    const cittyErr = Object.assign(new Error("Unknown command foo"), { code: "E_UNKNOWN_COMMAND" });
    expect(renderTopLevelError(cittyErr, stream)).toBe("other");
    expect(stream.captured).toBe("");
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

  // v2.0.0-rc.37 Wave A2: ServeLockHeldError end-to-end test removed alongside
  // the class re-export. The "writes BOTH message and actionHint" test above
  // still covers the renderer's user-facing contract via plain-object input.

  it("formats actionHint as an indented arrow on its own line", () => {
    const stream = captureStream();
    renderFabricError({ message: "M", actionHint: "A" }, stream);
    expect(stream.captured).toBe("M\n  -> A\n");
  });
});

describe("renderUnexpectedError (W3-I ③ top-level fallback)", () => {
  it("renders a single themed error line with the message, no stack by default", () => {
    const stream = captureStream();
    renderUnexpectedError(new Error("disk exploded"), false, stream);
    expect(stream.captured).toContain("[error]");
    expect(stream.captured).toContain("disk exploded");
    // no stack frames when showStack is false
    expect(stream.captured).not.toContain("at ");
  });

  it("withholds the stack but tells the user how to get it (--debug hint)", () => {
    const stream = captureStream();
    renderUnexpectedError(new Error("boom"), false, stream);
    expect(stream.captured).toContain("--debug");
    expect(stream.captured).toContain("FABRIC_DEBUG=1");
  });

  it("prints the full stack when showStack is true and omits the hint", () => {
    const stream = captureStream();
    const err = new Error("kaboom");
    renderUnexpectedError(err, true, stream);
    expect(stream.captured).toContain("kaboom");
    expect(stream.captured).toContain("at "); // a real stack frame
    expect(stream.captured).not.toContain("--debug");
  });

  it("stringifies a non-Error throwable (string) without crashing", () => {
    const stream = captureStream();
    renderUnexpectedError("plain string failure", false, stream);
    expect(stream.captured).toContain("plain string failure");
    // a string has no stack — the --debug hint still renders
    expect(stream.captured).toContain("--debug");
  });
});
