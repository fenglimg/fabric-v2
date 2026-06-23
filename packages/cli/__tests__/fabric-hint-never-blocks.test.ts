/**
 * ux-w0-3 INVARIANT: the fabric-hint Stop hook is a reminder layer, NEVER a gate
 * (KT-DEC-0007). No signal — archive / archive_backlog / review / import /
 * maintenance — may ever emit `decision: "block"`. This test is the deterministic
 * guard against a regression that re-introduces the blocking contract.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const hookPath = fileURLToPath(
  new URL("../templates/hooks/fabric-hint.cjs", import.meta.url),
);
const hook = require(hookPath) as {
  decide: (...args: unknown[]) => { decision?: string; signal?: string } | null;
  evaluateMaintenanceSignal: (...args: unknown[]) => { decision?: string; signal?: string } | null;
};

const FIXED_NOW = Date.UTC(2026, 5, 23, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

describe("fabric-hint INVARIANT — the Stop hook never blocks (ux-w0-3 / KT-DEC-0007)", () => {
  it('the hook source contains NO "block" decision token (code or comment)', () => {
    const src = readFileSync(hookPath, "utf8");
    // The blocking contract is retired entirely — neither the decide() returns,
    // the emit path, nor the doc comments reference a "block" decision anymore.
    expect(src).not.toContain('"block"');
    expect(src).not.toContain("'block'");
  });

  it("every triggering signal returns decision:'soft', never 'block'", () => {
    const archive = hook.decide(
      [],
      FIXED_NOW,
      undefined,
      undefined,
      { editsSinceArchive: 20, threshold: 20, anchorPresent: true },
    );
    expect(archive?.signal).toBe("archive");
    expect(archive?.decision).toBe("soft");

    const backlog = hook.decide(
      [],
      FIXED_NOW,
      undefined,
      undefined,
      { editsSinceArchive: 0, threshold: 20, anchorPresent: true },
      undefined,
      undefined,
      undefined,
      { threshold: 2, deadSessionCount: 2 },
    );
    expect(backlog?.signal).toBe("archive_backlog");
    expect(backlog?.decision).toBe("soft");

    const review = hook.decide([], FIXED_NOW, { count: 10, oldestAgeMs: 1 * DAY_MS });
    expect(review?.signal).toBe("review");
    expect(review?.decision).toBe("soft");

    const initEvent = { kind: "fabric-event", event_type: "init_scan_completed", ts: FIXED_NOW - 48 * HOUR_MS };
    const importSignal = hook.decide([initEvent], FIXED_NOW, undefined, { nodeCount: 4, threshold: 10 });
    expect(importSignal?.signal).toBe("import");
    expect(importSignal?.decision).toBe("soft");
  });

  it("the maintenance signal returns decision:'soft', never 'block'", () => {
    // No doctor_run ever + a canonical corpus → maintenance fires.
    const maintenance = hook.evaluateMaintenanceSignal(
      [],
      FIXED_NOW,
      5,
      null,
      { maintenanceHintDays: 14, maintenanceHintCooldownDays: 7 },
    );
    expect(maintenance?.signal).toBe("maintenance");
    expect(maintenance?.decision).toBe("soft");
  });
});
