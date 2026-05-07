import { describe, it, expect } from "vitest";

import { createInFlightTracker } from "./in-flight-tracker.js";

describe("InFlightTracker", () => {
  it("starts with size 0", () => {
    const tracker = createInFlightTracker();
    expect(tracker.size()).toBe(0);
  });

  it("tracks enter and exit cycles correctly", () => {
    const tracker = createInFlightTracker();
    tracker.enter("req-1");
    expect(tracker.size()).toBe(1);
    tracker.enter("req-2");
    expect(tracker.size()).toBe(2);
    tracker.exit("req-1");
    expect(tracker.size()).toBe(1);
    tracker.exit("req-2");
    expect(tracker.size()).toBe(0);
  });

  it("exit of unknown id is a no-op", () => {
    const tracker = createInFlightTracker();
    tracker.enter("req-1");
    tracker.exit("req-unknown");
    expect(tracker.size()).toBe(1);
    tracker.exit("req-1");
    expect(tracker.size()).toBe(0);
  });

  it("drain resolves immediately when no in-flight requests", async () => {
    const tracker = createInFlightTracker();
    const result = await tracker.drain(5000);
    expect(result).toEqual({ drained: 0, timed_out: 0 });
  });

  it("drain resolves when last request exits before deadline", async () => {
    const tracker = createInFlightTracker();
    tracker.enter("req-1");
    tracker.enter("req-2");

    // Exit both requests shortly after drain begins
    setTimeout(() => {
      tracker.exit("req-1");
      tracker.exit("req-2");
    }, 20);

    const result = await tracker.drain(2000);
    expect(result).toEqual({ drained: 2, timed_out: 0 });
  });

  it("drain times out when requests never exit", async () => {
    const tracker = createInFlightTracker();
    tracker.enter("req-stuck-1");
    tracker.enter("req-stuck-2");

    const result = await tracker.drain(50); // very short deadline
    // Both requests never exited so timed_out should reflect remaining
    expect(result.timed_out).toBe(2);
    expect(result.drained).toBe(0);
  });

  it("drain times out partially when some requests exit before deadline", async () => {
    const tracker = createInFlightTracker();
    tracker.enter("req-fast");
    tracker.enter("req-slow");

    // Only exit req-fast before deadline
    setTimeout(() => {
      tracker.exit("req-fast");
    }, 10);

    const result = await tracker.drain(80);
    // req-slow never exited, so timed_out=1, drained=1
    expect(result.timed_out).toBe(1);
    expect(result.drained).toBe(1);
  });
});
