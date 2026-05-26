// v2.0.0-rc.23 TASK-009 (d): unit tests for the non-blocking startup gate.
//
// Three timing scenarios mirror the task's convergence criteria:
//   1. ready  — first reconcile resolves quickly; no warning.
//   2. stale  — first reconcile still pending past the timeout; meta_stale warning.
//   3. failed — first reconcile rejected; reconcile_failed warning.
//
// The gate is module-state — tests reset between cases via
// `resetFirstReconcileGate()`. We use short timeouts (50ms) to keep the
// suite snappy; the production default of 5s is exercised by the integration
// path in `index.test.ts`.

import { afterEach, describe, expect, it } from "vitest";

import {
  awaitFirstReconcileGate,
  gateWarning,
  resetFirstReconcileGate,
  setFirstReconcile,
} from "./first-reconcile-gate.js";

afterEach(() => {
  resetFirstReconcileGate();
});

describe("awaitFirstReconcileGate", () => {
  it("returns ready when reconcile resolves before the timeout", async () => {
    // Fast-resolving reconcile — within a few microtasks.
    setFirstReconcile(Promise.resolve());
    // Allow the wrapper to observe the resolution.
    await Promise.resolve();
    await Promise.resolve();

    const result = await awaitFirstReconcileGate(50);
    expect(result).toEqual({ status: "ready" });
    expect(gateWarning(result)).toBeNull();
  });

  it("returns stale when reconcile is still pending past the timeout", async () => {
    // Reconcile that will not resolve within the test window. The gate's
    // 50ms timer will fire first.
    const pending = new Promise<void>(() => {
      // Intentionally never resolves.
    });
    setFirstReconcile(pending);

    const result = await awaitFirstReconcileGate(50);
    expect(result).toEqual({ status: "stale" });

    const warn = gateWarning(result);
    expect(warn).not.toBeNull();
    expect(warn?.code).toBe("meta_stale");
    expect(warn?.file).toBe("<response>");
    expect(warn?.action_hint).toMatch(/Initial reconcile still pending/);
  });

  it("returns failed when reconcile has rejected", async () => {
    const failure = new Error("simulated reconcile failure");
    setFirstReconcile(Promise.reject(failure));
    // Drain the wrapper's catch handler.
    await Promise.resolve();
    await Promise.resolve();

    const result = await awaitFirstReconcileGate(50);
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toBe(failure);
    }

    const warn = gateWarning(result);
    expect(warn).not.toBeNull();
    expect(warn?.code).toBe("reconcile_failed");
    expect(warn?.action_hint).toMatch(/fabric doctor --fix/);
  });

  it("returns ready immediately when no reconcile has been registered", async () => {
    // Unit-test fallback: tools that run without a parent startStdioServer
    // should not block on a gate that was never armed.
    const start = Date.now();
    const result = await awaitFirstReconcileGate(50);
    expect(result).toEqual({ status: "ready" });
    expect(Date.now() - start).toBeLessThan(20);
  });

  it("returns failed for every subsequent call once reconcile rejected", async () => {
    const failure = new Error("persistent failure");
    setFirstReconcile(Promise.reject(failure));
    await Promise.resolve();
    await Promise.resolve();

    const first = await awaitFirstReconcileGate(50);
    const second = await awaitFirstReconcileGate(50);

    expect(first.status).toBe("failed");
    expect(second.status).toBe("failed");
  });
});
