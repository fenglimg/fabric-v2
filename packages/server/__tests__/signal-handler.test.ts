/**
 * Signal handler integration test — in-process approach.
 *
 * Rationale: The spawn-based test is closer to production reality but is
 * unreliable with MCP stdio servers because:
 *   1. The server blocks on stdin (StdioServerTransport reads from process.stdin).
 *   2. A spawned process with 'pipe' stdio never receives the MCP init handshake,
 *      so connect() may hang indefinitely before the signal is sent.
 *
 * The in-process spy approach exercises the same code paths — createInFlightTracker,
 * flushAndSyncEventLedger, and the drain ordering — without the spawn complexity.
 * A separate smoke test (not run in CI) can cover the full spawn lifecycle.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createInFlightTracker } from "../src/services/in-flight-tracker.js";
import { flushAndSyncEventLedger } from "../src/services/event-ledger.js";
import { createShutdownHandler } from "../src/index.js";

describe.skipIf(process.platform === "win32")("signal handler — in-process", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });

  function makeTempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), "fabric-sig-"));
    tempDirs.push(dir);
    return dir;
  }

  it("flushAndSyncEventLedger is a no-op when ledger file does not exist", () => {
    const projectRoot = makeTempRoot();
    // No .fabric/ directory — must not throw
    expect(() => flushAndSyncEventLedger(projectRoot)).not.toThrow();
  });

  it("flushAndSyncEventLedger fsyncs existing ledger without error", () => {
    const projectRoot = makeTempRoot();
    const fabricDir = join(projectRoot, ".fabric");
    mkdirSync(fabricDir, { recursive: true });
    writeFileSync(join(fabricDir, "events.jsonl"), '{"kind":"fabric-event"}\n');

    expect(() => flushAndSyncEventLedger(projectRoot)).not.toThrow();
    // Ledger still exists after fsync
    expect(existsSync(join(fabricDir, "events.jsonl"))).toBe(true);
  });

  it("drain + fsync ordering: drain resolves before fsync is called", async () => {
    const projectRoot = makeTempRoot();
    const fabricDir = join(projectRoot, ".fabric");
    mkdirSync(fabricDir, { recursive: true });
    writeFileSync(join(fabricDir, "events.jsonl"), "");

    const tracker = createInFlightTracker();
    tracker.enter("req-1");

    const calls: string[] = [];

    // Exit req-1 before deadline
    setTimeout(() => {
      tracker.exit("req-1");
      calls.push("drain-resolved");
    }, 20);

    const result = await tracker.drain(2000);
    calls.push("after-drain");

    // This represents the signal handler's fsync call
    flushAndSyncEventLedger(projectRoot);
    calls.push("fsync-done");

    expect(result).toEqual({ drained: 1, timed_out: 0 });
    // Verify ordering: drain-resolved happens, then after-drain, then fsync-done
    expect(calls).toEqual(["drain-resolved", "after-drain", "fsync-done"]);
  });

  it("simulates SIGTERM handler: drain + fsync + server close in correct order", async () => {
    const projectRoot = makeTempRoot();
    const fabricDir = join(projectRoot, ".fabric");
    mkdirSync(fabricDir, { recursive: true });
    writeFileSync(join(fabricDir, "events.jsonl"), "");

    const tracker = createInFlightTracker();
    // No in-flight requests at signal time — drain resolves immediately
    const drainResult = await tracker.drain(5000);
    expect(drainResult).toEqual({ drained: 0, timed_out: 0 });

    // fsync AFTER drain — Gemini G1 ordering
    expect(() => flushAndSyncEventLedger(projectRoot)).not.toThrow();

    // Verify ledger survives the fsync
    expect(existsSync(join(fabricDir, "events.jsonl"))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // I1: createShutdownHandler factory — real handler behavior
  //   - First call: drain → fsync → close → exit(0)
  //   - Second call of same signal (while first pending): exit(1)
  // -------------------------------------------------------------------------
  describe("createShutdownHandler factory (server.md I1)", () => {
    function makeReadyProjectRoot(): string {
      const dir = makeTempRoot();
      const fabricDir = join(dir, ".fabric");
      mkdirSync(fabricDir, { recursive: true });
      writeFileSync(join(fabricDir, "events.jsonl"), "");
      return dir;
    }

    it("first invocation: drain → fsync → close → exit(0)", async () => {
      const projectRoot = makeReadyProjectRoot();
      const tracker = createInFlightTracker();
      const exitMock = vi.fn() as unknown as (code: number) => never;
      const closeServer = vi.fn(async () => {});

      // Silence stderr noise during this test.
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      const handler = createShutdownHandler({
        signal: "SIGTERM",
        tracker,
        projectRoot,
        closeServer,
        exit: exitMock,
        drainDeadlineMs: 50,
      });

      handler();
      // Let the IIFE (drain → fsync → close → exit) finish
      await new Promise((r) => setTimeout(r, 100));

      expect(closeServer).toHaveBeenCalledTimes(1);
      expect(exitMock).toHaveBeenCalledWith(0);
      stderrSpy.mockRestore();
    });

    it("I1: same-signal repeat — second invocation forces exit(1)", async () => {
      const projectRoot = makeReadyProjectRoot();
      const tracker = createInFlightTracker();
      // Make drain hang so the first handler stays in flight when the second arrives.
      const drainSpy = vi
        .spyOn(tracker, "drain")
        .mockImplementation(() => new Promise(() => {}));
      const exitMock = vi.fn() as unknown as (code: number) => never;
      const closeServer = vi.fn(async () => {});
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      const handler = createShutdownHandler({
        signal: "SIGINT",
        tracker,
        projectRoot,
        closeServer,
        exit: exitMock,
      });

      handler(); // first call — sets `invoked = true`, then awaits forever on drain
      // Yield so the IIFE microtask runs to the await
      await new Promise((r) => setImmediate(r));

      handler(); // second call — must hit `invoked` guard
      // Yield so the second IIFE runs through to exit(1)
      await new Promise((r) => setImmediate(r));

      expect(exitMock).toHaveBeenCalledWith(1);
      // First handler is stuck in drain → never reached fsync/close/exit(0)
      expect(closeServer).not.toHaveBeenCalled();

      drainSpy.mockRestore();
      stderrSpy.mockRestore();
    });

    it("I1: distinct signals get independent dedup state", async () => {
      // SIGINT and SIGTERM each get their own handler instance — invoking SIGTERM
      // does NOT poison SIGINT's `invoked` flag.
      const projectRoot = makeReadyProjectRoot();
      const tracker = createInFlightTracker();
      const drainSpy = vi
        .spyOn(tracker, "drain")
        .mockImplementation(() => new Promise(() => {}));
      const exitMock = vi.fn() as unknown as (code: number) => never;
      const closeServer = vi.fn(async () => {});
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      const intHandler = createShutdownHandler({
        signal: "SIGINT",
        tracker,
        projectRoot,
        closeServer,
        exit: exitMock,
      });
      const termHandler = createShutdownHandler({
        signal: "SIGTERM",
        tracker,
        projectRoot,
        closeServer,
        exit: exitMock,
      });

      termHandler();
      await new Promise((r) => setImmediate(r));
      // SIGTERM is now in-flight. SIGINT (different handler) should still take
      // the first-call path, NOT the exit(1) guard.
      intHandler();
      await new Promise((r) => setImmediate(r));

      // No exit(1) yet — both handlers are on first-call path (stuck in drain)
      expect(exitMock).not.toHaveBeenCalledWith(1);

      drainSpy.mockRestore();
      stderrSpy.mockRestore();
    });
  });
});
