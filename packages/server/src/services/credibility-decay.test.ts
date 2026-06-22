import { describe, expect, it } from "vitest";

import { computeDecayFactor, decayFactor, DEFAULT_DECAY_CONFIG } from "./credibility-decay.js";

const { floor } = DEFAULT_DECAY_CONFIG;
const DAY = 86_400_000;

describe("computeDecayFactor", () => {
  it("is 1.0 at age 0 (no decay for a just-touched entry)", () => {
    expect(computeDecayFactor(0, "decisions")).toBe(1);
  });

  it("clamps a negative (future) age to 0 → factor 1.0", () => {
    expect(computeDecayFactor(-50, "decisions")).toBe(1);
  });

  it("is floor + (1-floor)/2 at exactly one half-life", () => {
    const halfLife = DEFAULT_DECAY_CONFIG.halfLives.decisions; // 120
    expect(computeDecayFactor(halfLife, "decisions")).toBeCloseTo(floor + (1 - floor) / 2, 10);
  });

  it("decreases monotonically as age grows", () => {
    const a = computeDecayFactor(30, "decisions");
    const b = computeDecayFactor(120, "decisions");
    const c = computeDecayFactor(400, "decisions");
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });

  it("approaches the floor for very old entries but never drops below it", () => {
    const f = computeDecayFactor(100_000, "decisions");
    expect(f).toBeGreaterThanOrEqual(floor);
    expect(f).toBeCloseTo(floor, 6);
  });

  it("decays a longer-lived type slower than a shorter-lived one at the same age", () => {
    // models (180d half-life) > pitfalls (120d) at the same age.
    expect(computeDecayFactor(120, "models")).toBeGreaterThan(computeDecayFactor(120, "pitfalls"));
  });

  it("falls back to the default half-life for an unknown type", () => {
    expect(computeDecayFactor(120, "totally-unknown")).toBeCloseTo(
      computeDecayFactor(120, "decisions"), // both 120d
      10,
    );
  });
});

describe("decayFactor (age resolution)", () => {
  const nowMs = Date.parse("2026-06-22T00:00:00.000Z");

  it("uses lastActiveMs when present", () => {
    const lastActiveMs = nowMs - 120 * DAY;
    expect(decayFactor({ lastActiveMs, nowMs, knowledgeType: "decisions" })).toBeCloseTo(
      computeDecayFactor(120, "decisions"),
      10,
    );
  });

  it("prefers lastActiveMs over createdAt (a recalled old entry stays fresh)", () => {
    const recentTouch = nowMs - 1 * DAY;
    const oldCreation = new Date(nowMs - 500 * DAY).toISOString();
    const f = decayFactor({
      lastActiveMs: recentTouch,
      createdAt: oldCreation,
      nowMs,
      knowledgeType: "decisions",
    });
    expect(f).toBeCloseTo(computeDecayFactor(1, "decisions"), 10);
  });

  it("falls back to createdAt when there is no last-active signal", () => {
    const createdAt = new Date(nowMs - 200 * DAY).toISOString();
    expect(decayFactor({ createdAt, nowMs, knowledgeType: "decisions" })).toBeCloseTo(
      computeDecayFactor(200, "decisions"),
      10,
    );
  });

  it("returns 1.0 (age 0) when neither last-active nor a parseable createdAt exists", () => {
    expect(decayFactor({ nowMs, knowledgeType: "decisions" })).toBe(1);
    expect(decayFactor({ createdAt: "not-a-date", nowMs, knowledgeType: "decisions" })).toBe(1);
  });
});
