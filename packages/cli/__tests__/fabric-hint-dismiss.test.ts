/**
 * v2.0.0-rc.37 NEW-16: unit + integration tests for fabric-hint per-signal
 * dismiss (config-durable hint_dismiss_signals + session-scoped sidecar).
 *
 * Pins: dismiss-set union (config ∪ sidecar), writeSessionDismiss additive
 * merge, bilingual dismiss-option line, and end-to-end main() suppression of
 * a triggering archive signal when its type is dismissed.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const hook = require("../templates/hooks/fabric-hint.cjs") as {
  readDismissedSignals: (cwd: string, sessionId: string | null) => Set<string>;
  writeSessionDismiss: (cwd: string, sessionId: string, signals: string[]) => void;
  sessionDismissFileName: (sessionId: string) => string;
  renderDismissOption: (signal: string, variant: string) => string;
  DISMISSABLE_SIGNALS: string[];
  main: (
    env: { cwd: string; now: Date },
    stdio: { stdout: { write: (s: string) => void } },
  ) => void;
};

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "rc37-new16-dismiss-"));
  mkdirSync(join(cwd, ".fabric"), { recursive: true });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function writeConfig(body: object): void {
  writeFileSync(join(cwd, ".fabric", "fabric-config.json"), JSON.stringify(body));
}

describe("fabric-hint dismiss helpers (rc.37 NEW-16)", () => {
  it("DISMISSABLE_SIGNALS covers the four signal types", () => {
    expect(new Set(hook.DISMISSABLE_SIGNALS)).toEqual(
      new Set(["archive", "review", "import", "maintenance"]),
    );
  });

  it("reads config-durable hint_dismiss_signals (filtered to known types)", () => {
    writeConfig({ hint_dismiss_signals: ["archive", "bogus", "review"] });
    const d = hook.readDismissedSignals(cwd, null);
    expect(d.has("archive")).toBe(true);
    expect(d.has("review")).toBe(true);
    expect(d.has("bogus")).toBe(false);
  });

  it("unions config + session sidecar", () => {
    writeConfig({ hint_dismiss_signals: ["archive"] });
    hook.writeSessionDismiss(cwd, "sess-1", ["import"]);
    const d = hook.readDismissedSignals(cwd, "sess-1");
    expect([...d].sort()).toEqual(["archive", "import"]);
  });

  it("writeSessionDismiss merges additively + filters unknown", () => {
    hook.writeSessionDismiss(cwd, "s", ["review", "nope"]);
    hook.writeSessionDismiss(cwd, "s", ["maintenance"]);
    expect([...hook.readDismissedSignals(cwd, "s")].sort()).toEqual(["maintenance", "review"]);
  });

  it("renderDismissOption is bilingual + names the signal", () => {
    expect(hook.renderDismissOption("archive", "zh-CN")).toContain("hint_dismiss_signals");
    expect(hook.renderDismissOption("archive", "zh-CN")).toContain("archive");
    expect(hook.renderDismissOption("review", "en")).toMatch(/Silence this nudge/);
  });

  it("sanitises unsafe session ids into the sidecar filename", () => {
    expect(hook.sessionDismissFileName("a/b")).toBe("hint-dismiss-a-b.json");
  });
});

describe("fabric-hint main() dismiss suppression (rc.37 NEW-16)", () => {
  const NOW_MS = 1_750_000_000_000;
  const now = new Date(NOW_MS);

  function seedArchiveTrigger(): void {
    // knowledge_proposed 25h ago → archive Signal A fires by hours.
    const ev = {
      kind: "fabric-event",
      schema_version: 1,
      id: "event:knowledge_proposed:1",
      event_type: "knowledge_proposed",
      ts: NOW_MS - 25 * 60 * 60 * 1000,
    };
    writeFileSync(join(cwd, ".fabric", "events.jsonl"), `${JSON.stringify(ev)}\n`);
  }

  it("emits archive nudge (with dismiss-option line) when NOT dismissed", () => {
    seedArchiveTrigger();
    const writes: string[] = [];
    hook.main({ cwd, now }, { stdout: { write: (s) => writes.push(s) } });
    expect(writes).toHaveLength(1);
    const payload = JSON.parse(writes[0]) as { signal: string; reason: string };
    expect(payload.signal).toBe("archive");
    expect(payload.reason).toContain("hint_dismiss_signals");
  });

  it("stays silent when archive is dismissed via config", () => {
    seedArchiveTrigger();
    writeConfig({ hint_dismiss_signals: ["archive"] });
    const writes: string[] = [];
    hook.main({ cwd, now }, { stdout: { write: (s) => writes.push(s) } });
    expect(writes).toEqual([]);
  });
});
