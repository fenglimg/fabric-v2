/**
 * fabric-hint.cjs — PROSE assertions (not PR-hard).
 *
 * Sibling of fabric-hint.test.ts. The split follows the structure-vs-wording
 * criterion in docs/TESTING.md: an assertion that names a code-level identifier
 * (signal name, recommended_skill value, `/fabric-archive` CTA target, a
 * computed count) is a contract and stays in the gate; an assertion that quotes
 * the banner's Chinese framing is wording and lives here.
 *
 * Why it is out of the gate: rewording a nudge is a deliberate, reviewed act —
 * it should not turn the PR red in a file the author never opened. Run it when
 * you intentionally rewrite banner prose:
 *
 *   PROMPT_WORDING=1 pnpm --filter @fenglimg/fabric-cli exec vitest run __tests__/fabric-hint.wording.test.ts
 */

import { describe, expect, it } from "vitest";

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const hook = require(
  fileURLToPath(new URL("../templates/hooks/fabric-hint.cjs", import.meta.url)),
) as {
  decide: (...args: unknown[]) => { reason: string } | null;
  evaluateMaintenanceSignal: (...args: unknown[]) => { reason: string } | null;
};

const FIXED_NOW = new Date("2026-05-10T12:00:00.000Z");
const NOW_MS = FIXED_NOW.getTime();
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const archiveEdits = { editsSinceArchive: 20, threshold: 20, anchorPresent: true };

function makeEvent(eventType: string, ts: number): Record<string, unknown> {
  return { kind: "fabric-event", event_type: eventType, ts, schema_version: 1 };
}

describe.runIf(process.env.PROMPT_WORDING === "1")("fabric-hint banner prose", () => {
  it("Signal A uses the 人-first banner: emoji prefix + 是否 framing, never 建议调用", () => {
    const r = hook.decide([], FIXED_NOW, undefined, undefined, archiveEdits, undefined);
    expect(r?.reason.startsWith("📋 Fabric:")).toBe(true);
    expect(r?.reason).toMatch(/是否调 \/fabric-archive/);
    expect(r?.reason).not.toMatch(/建议调用/);
  });

  it("Signal B (review) uses the 人-first banner with question framing", () => {
    const r = hook.decide([], FIXED_NOW, { count: 12, oldestAgeMs: 8 * DAY_MS });
    expect(r?.reason.startsWith("📋 Fabric:")).toBe(true);
    expect(r?.reason).toMatch(/是否调 \/fabric-review/);
    expect(r?.reason).not.toMatch(/建议调用/);
  });

  it("Signal C (import) uses the 人-first banner with question framing", () => {
    const r = hook.decide(
      [makeEvent("init_scan_completed", NOW_MS - 48 * HOUR_MS)],
      FIXED_NOW,
      undefined,
      { nodeCount: 3, threshold: 10 },
    );
    expect(r?.reason.startsWith("📋 Fabric:")).toBe(true);
    expect(r?.reason).toMatch(/是否调 \/fabric-archive/);
    expect(r?.reason).not.toMatch(/建议调用/);
  });

  it("Signal D (maintenance) keeps the banner prefix, the never-ran phrasing and a question line", () => {
    const r = hook.evaluateMaintenanceSignal([], FIXED_NOW, 10, null);
    expect(r?.reason).toMatch(/📋 Fabric:/);
    expect(r?.reason).toMatch(/从未运行 lint 检查/);
    expect(r?.reason).toMatch(/fabric doctor/);
    expect(r?.reason).toMatch(/是否调/);
  });

  it("no signal reintroduces the retired 'candidates detected' framing", () => {
    const archive = hook.decide([], FIXED_NOW, undefined, undefined, archiveEdits);
    const review = hook.decide([], FIXED_NOW, { count: 10, oldestAgeMs: DAY_MS });
    const importSig = hook.decide(
      [makeEvent("init_scan_completed", NOW_MS - 48 * HOUR_MS)],
      FIXED_NOW,
      undefined,
      { nodeCount: 3, threshold: 10 },
    );
    const maint = hook.evaluateMaintenanceSignal([], FIXED_NOW, 10, null);
    for (const r of [archive, review, importSig, maint]) {
      expect(r).not.toBeNull();
      expect(r?.reason.toLowerCase()).not.toMatch(/candidates detected/);
    }
  });
});
