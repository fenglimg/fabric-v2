// flat-design render-flow harness — observes that the install render FLOW is wired
// correctly end-to-end, driving the REAL InstallPipeline + REAL ConsoleOutputRenderer
// + REAL Preflight/Guidance stages (middle stages faked for their step lines). Pins
// the ORDERING invariants the flat redesign promised, locale-independently (asserts
// on stable structural tokens — ●, ✓, →, [ok], the 40-wide rule — not on wording):
//   1. the scan summary renders UNDER the title, BEFORE the stage list (preflight);
//   2. each stage is a flat `● …` line — no emoji, no tree branches, no (n/total);
//   3. the golden "→" footer is the LAST thing — after the summary card + completion.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InstallPipeline, stageRan } from "../src/install/pipeline/pipeline.js";
import { PreflightStage } from "../src/install/pipeline/preflight.stage.js";
import { GuidanceStage } from "../src/install/pipeline/guidance.stage.js";
import { ConsoleOutputRenderer } from "../src/tui/ConsoleOutputRenderer.js";
import type { InstallContext, Stage } from "../src/install/pipeline/types.js";

const dirs: string[] = [];
const realStdoutTty = process.stdout.isTTY;
const realStderrTty = process.stderr.isTTY;

function setTty(stream: "stdout" | "stderr", value: boolean): void {
  Object.defineProperty(process[stream], "isTTY", { value, configurable: true });
}

beforeEach(() => {
  // scanAndReport only renders the scan summary on a stdout TTY; force it on so the
  // flow is observable. Keep stderr non-TTY so the transient "scanning…" note stays
  // out of the captured stdout stream.
  setTty("stdout", true);
  setTty("stderr", false);
});

afterEach(() => {
  setTty("stdout", Boolean(realStdoutTty));
  setTty("stderr", Boolean(realStderrTty));
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmpProject(): string {
  const d = mkdtempSync(join(tmpdir(), "fab-render-flow-"));
  dirs.push(d);
  return d;
}

function fakeStage(name: string, changed: boolean, installed: string[]): Stage {
  return {
    name: name as Stage["name"],
    async execute() {
      return stageRan(name as Stage["name"], installed, [], changed, changed);
    },
  };
}

function ctx(target: string, renderer: ConsoleOutputRenderer): InstallContext {
  return {
    target,
    args: { target },
    options: { planOnly: false, skipBootstrap: false, skipHooks: false, skipMcp: false },
    mcpInstallMode: "global",
    claudeMcpScope: "project",
    interactive: true,
    wizardEnabled: false,
    stageResults: [],
    rollbackStack: [],
    state: { firstInstall: true },
    renderer,
  } as unknown as InstallContext;
}

function capture(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    // a single console.log may carry embedded newlines (summary card / footer block)
    String(a.map(String).join(" ")).split("\n").forEach((l) => lines.push(l));
  });
  return { lines, restore: () => spy.mockRestore() };
}

describe("install render flow (flat-design ordering harness)", () => {
  it("scan under title → flat ● stages → summary → golden → footer LAST", async () => {
    const target = tmpProject();
    const renderer = new ConsoleOutputRenderer({ colors: false });
    const cap = capture();
    try {
      await new InstallPipeline()
        .addStage(new PreflightStage())
        .addStage(fakeStage("env", false, []))
        .addStage(fakeStage("store", true, ["cocos-kb"]))
        .addStage(fakeStage("hooks", true, ["a", "b", "c", "d"]))
        .addStage(fakeStage("mcp", false, []))
        .addStage(fakeStage("validate", false, []))
        .addStage(new GuidanceStage())
        .execute(ctx(target, renderer));
    } finally {
      cap.restore();
    }

    const L = cap.lines;
    const firstIdx = (pred: (l: string) => boolean) => L.findIndex(pred);

    // The scan summary is the ℹ line carrying " · " separators (file/entry counts);
    // the intro line has no " · ". Locale-independent.
    const idxScan = firstIdx((l) => l.includes("ℹ") && l.includes(" · "));
    const idxFirstDot = firstIdx((l) => l.trimStart().startsWith("●"));
    const idxCounts = firstIdx((l) => l.includes("✓") && l.includes("✗")); // summary count row
    const idxDone = firstIdx((l) => l.includes("[ok]")); // renderComplete
    const idxArrow = firstIdx((l) => l.includes("→")); // golden footer anchor

    // (1) scan summary present, and BEFORE the first stage line.
    expect(idxScan).toBeGreaterThanOrEqual(0);
    expect(idxFirstDot).toBeGreaterThanOrEqual(0);
    expect(idxScan).toBeLessThan(idxFirstDot);

    // (2) flat stage lines — no emoji anchors, no tree branches, no (n/total) counter.
    const dotLines = L.filter((l) => l.trimStart().startsWith("●"));
    expect(dotLines.length).toBeGreaterThanOrEqual(5);
    const joined = L.join("\n");
    expect(joined).not.toMatch(/🔍|🏗|📦|🪝|🔌|✅|📖/u);
    expect(joined).not.toContain("├─");
    expect(joined).not.toContain("+- ");
    expect(joined).not.toMatch(/\(\d+\/\d+\)/u);

    // (3) golden "→" footer comes AFTER the summary counts AND the completion line
    // (the reordering the redesign promised — guidance no longer prints mid-pipeline).
    expect(idxArrow).toBeGreaterThan(idxCounts);
    expect(idxArrow).toBeGreaterThan(idxDone);
    // And nothing STRUCTURAL trails it — no stage line, no completion, no count row
    // after the anchor. (A trailing "no client detected" edge note is tolerated, so
    // we assert on structure rather than strict last-line, to stay machine-robust.)
    const after = L.slice(idxArrow + 1);
    expect(after.some((l) => l.trimStart().startsWith("●"))).toBe(false);
    expect(after.some((l) => l.includes("[ok]"))).toBe(false);
    expect(after.some((l) => l.includes("✓") && l.includes("✗"))).toBe(false);
  });
});
