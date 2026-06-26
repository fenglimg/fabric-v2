// W3-B TASK-005: snapshot-pin the reskinned install renderer (ConsoleOutputRenderer)
// under NO_COLOR — install steps as tree branches + grid summary (mockup #2) and
// the error left-bar block (mockup #4). NO_COLOR is stubbed BEFORE importing the
// builders so the structure primitives (tree/grid, which read live env) and the
// explicit colorOn=false agree on the ASCII fallback.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildStepLine,
  buildSummaryBlock,
  buildErrorBlock,
} from "../src/tui/ConsoleOutputRenderer.js";
import { t } from "../src/i18n.js";
import type { StepInfo, SummaryInfo, ErrorInfo } from "../src/tui/types.js";

beforeEach(() => {
  vi.stubEnv("NO_COLOR", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const STEPS: StepInfo[] = [
  { name: "Preflight", current: 1, total: 7, status: "success" },
  { name: "Environment", current: 2, total: 7, status: "success" },
  { name: "Store", current: 3, total: 7, status: "success" },
  { name: "Hooks", current: 4, total: 7, status: "skipped" },
  { name: "MCP", current: 5, total: 7, status: "success" },
  { name: "Validate", current: 6, total: 7, status: "success" },
  { name: "Guidance", current: 7, total: 7, status: "success" },
];

describe("ConsoleOutputRenderer reskin — install steps + summary (NO_COLOR)", () => {
  it("renders install steps as ASCII tree branches (mockup #2)", () => {
    const out = STEPS.map((s) => buildStepLine(s, false)).join("\n");
    // ASCII fallback: +- for non-final, `- for the final step, no box glyphs.
    expect(out).toContain("+- ");
    expect(out).toContain("`- ");
    expect(out).not.toContain("├─");
    expect(out).not.toContain("└─");
    expect(out).toMatchSnapshot();
  });

  it("renders the summary grid block (mockup #2)", () => {
    const summary: SummaryInfo = {
      title: "Summary",
      successCount: 7,
      skippedCount: 0,
      errorCount: 0,
    };
    const out = buildSummaryBlock(summary, false);
    // TASK-002 (G1): the count words + status line are localized via t(); assert
    // against the active-locale t() values, NOT hardcoded English (the renderer
    // honors the machine-wide locale, so a literal "succeeded" would be flaky).
    expect(out).toContain(`7 ${t("cli.summary.count.succeeded")}`);
    expect(out).toContain(t("cli.summary.all-ok"));
  });

  it("renders a summary with failures (mockup #2, count + status line)", () => {
    const summary: SummaryInfo = {
      title: "Summary",
      successCount: 5,
      skippedCount: 1,
      errorCount: 1,
      details: [{ label: "Store", value: "clone failed", status: "error" }],
    };
    const out = buildSummaryBlock(summary, false);
    // TASK-002 (G1): n-failed status line localized via t() ({count} interpolated).
    expect(out).toContain(t("cli.summary.n-failed", { count: "1" }));
  });
});

describe("ConsoleOutputRenderer reskin — error block (NO_COLOR)", () => {
  it("renders the gutter-free error block with hint + stack (spec §0.4)", () => {
    const info: ErrorInfo = {
      title: "InstallError",
      message: "Store clone failed: remote unreachable",
      code: "ECONNREFUSED",
      hint: "check the URL or run with --debug",
      stack: "Error: boom\n    at clone (store.ts:42)\n    at install (install.ts:88)",
    };
    const out = buildErrorBlock(info, true, false);
    // spec §0.4: B-横线 `[err]` header + plain-indented body, NO `│`/`| ` wall, no `▌`.
    expect(out).toContain("[err] InstallError");
    expect(out).not.toContain("| ");
    expect(out).not.toContain("▌");
    expect(out).not.toContain("│");
    expect(out).toContain("💡 check the URL");
    expect(out).toMatchSnapshot();
  });

  it("renders the gutter-free error block without hint/stack (non-verbose, spec §0.4)", () => {
    const info: ErrorInfo = {
      title: "Error",
      message: "something failed",
    };
    const out = buildErrorBlock(info, false, false);
    expect(out).toContain("[err] Error");
    expect(out).not.toContain("│");
    expect(out).not.toContain("| ");
    expect(out).not.toContain("💡");
    expect(out).toMatchSnapshot();
  });
});
