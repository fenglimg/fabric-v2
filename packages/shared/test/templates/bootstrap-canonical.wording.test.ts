/**
 * Prompt-WORDING assertions for the bootstrap canonical — deliberately OUTSIDE
 * the PR gate, opt in with `PROMPT_WORDING=1`.
 *
 * Split criterion (T-3): an assertion that names a code-level identifier — an
 * MCP tool, a config key, a marker literal, an enum value, a file path — is a
 * CONTRACT between the prompt and the code surface, and stays in the gate
 * (`bootstrap-canonical.test.ts`). An assertion that quotes PROSE — a heading,
 * a sentence, the order of narrative sections, a byte-count floor — measures how
 * the prompt is written, not whether it is wired to anything real. Locking prose
 * in the PR gate makes every prompt improvement a false red, which is the exact
 * failure the "unit test output is a boolean, eval output is a score" line
 * warns about.
 *
 * These are kept (not deleted) because they still encode intent worth checking
 * when the bootstrap is deliberately reworked:
 *
 *   PROMPT_WORDING=1 pnpm --filter @fenglimg/fabric-shared exec vitest run \
 *     test/templates/bootstrap-canonical.wording.test.ts
 *
 * Sibling precedent: `DOGFOOD_BASELINE=1` on the recall dogfood baseline.
 */

import { describe, expect, it } from "vitest";

import { BOOTSTRAP_CANONICAL_ZH } from "../../src/templates/bootstrap-canonical";

describe.runIf(process.env.PROMPT_WORDING === "1")("bootstrap-canonical wording", () => {
  it("starts with the locked header + opening clause", () => {
    expect(BOOTSTRAP_CANONICAL_ZH.startsWith("# Fabric Bootstrap\n\n本项目")).toBe(true);
  });

  it("carries the expected prose H2 headings", () => {
    // rc.35 TASK-11 (P0-13/P1-9): For Developers section sits between the intro
    // paragraph and the existing AI-facing sections. The `docs/USER-QUICKSTART.md`
    // path assertion stayed in the gate — a path is a contract, a heading is not.
    expect(BOOTSTRAP_CANONICAL_ZH).toContain("## For Developers");
    expect(BOOTSTRAP_CANONICAL_ZH).toContain("## 行为规则");
    expect(BOOTSTRAP_CANONICAL_ZH).toContain("## 知识库(KB)");
    expect(BOOTSTRAP_CANONICAL_ZH).toContain("## Cite policy");
  });

  it("For Developers section precedes the AI-facing sections", () => {
    const devIdx = BOOTSTRAP_CANONICAL_ZH.indexOf("## For Developers");
    const aiIdx = BOOTSTRAP_CANONICAL_ZH.indexOf("## 行为规则");
    expect(devIdx).toBeGreaterThan(0);
    expect(aiIdx).toBeGreaterThan(devIdx);
  });

  it("is at least 800 bytes (utf-8)", () => {
    // A size floor is a proxy for "the prompt did not get gutted" — useful as a
    // review signal, meaningless as a merge gate.
    expect(Buffer.byteLength(BOOTSTRAP_CANONICAL_ZH, "utf8")).toBeGreaterThanOrEqual(800);
  });

  it("teaches recall auto-accounting in the C1 phrasing", () => {
    expect(BOOTSTRAP_CANONICAL_ZH).toContain("自动记账");
    expect(BOOTSTRAP_CANONICAL_ZH).toContain("无需手写");
  });

  it("phrases the pre-action gate as a hard pre-edit obligation", () => {
    // The `fab_recall(paths=` / `session_id=` identifier assertions stayed in the
    // gate; only the Chinese framing moved here.
    expect(BOOTSTRAP_CANONICAL_ZH).toContain("修改任何文件前");
    expect(BOOTSTRAP_CANONICAL_ZH).toContain("Pre-action gating");
  });
});
