import { describe, expect, it } from "vitest";

import {
  BOOTSTRAP_CANONICAL_ZH,
  BOOTSTRAP_MARKER_BEGIN,
  BOOTSTRAP_MARKER_END,
  BOOTSTRAP_REGEX,
} from "../../src/templates/bootstrap-canonical";

describe("bootstrap-canonical", () => {
  describe("BOOTSTRAP_CANONICAL_ZH", () => {
    it("starts with the locked header + opening clause", () => {
      expect(BOOTSTRAP_CANONICAL_ZH.startsWith("# Fabric Bootstrap\n\n本项目")).toBe(
        true,
      );
    });

    it("contains all required H2 sections", () => {
      // rc.35 TASK-11 (P0-13/P1-9): For Developers section sits between the
      // intro paragraph and the existing AI-facing sections. ≤5 lines,
      // second-person, points dev at USER-QUICKSTART.md to deflect the
      // "AGENTS.md is dev onboarding" misread Batch 7 caught.
      expect(BOOTSTRAP_CANONICAL_ZH).toContain("## For Developers");
      expect(BOOTSTRAP_CANONICAL_ZH).toContain("docs/USER-QUICKSTART.md");
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
      // rc.24: grew from ≥400 with cite-contract syntax bullets (operators +
      // skip-reason dictionary + type routing + personal-layer mention).
      expect(Buffer.byteLength(BOOTSTRAP_CANONICAL_ZH, "utf8")).toBeGreaterThanOrEqual(
        800,
      );
    });

    describe("cite policy invariants", () => {
      it("contains the KB cite reply-line format anchor", () => {
        expect(BOOTSTRAP_CANONICAL_ZH).toContain("KB: <id>");
      });

      it("teaches recall auto-accounting as the core (zero first-line burden)", () => {
        // v2.2 C1 (W2): the cite contract is internalised — recall auto-accounts
        // the citation; no hand-written first reply line is required.
        expect(BOOTSTRAP_CANONICAL_ZH).toContain("自动记账");
        expect(BOOTSTRAP_CANONICAL_ZH).toContain("无需手写");
      });

      it("keeps the dismissed/override speak-up path", () => {
        // The AI only speaks up to dismiss an inapplicable recalled entry.
        expect(BOOTSTRAP_CANONICAL_ZH).toContain("dismissed: <id>");
        expect(BOOTSTRAP_CANONICAL_ZH).toContain("applied|dismissed");
      });

      it("enumerates all dismissed-reason values", () => {
        expect(BOOTSTRAP_CANONICAL_ZH).toContain("scope-mismatch");
        expect(BOOTSTRAP_CANONICAL_ZH).toContain("outdated");
        expect(BOOTSTRAP_CANONICAL_ZH).toContain("not-applicable");
      });

      it("references the fabric doctor --cite-coverage audit command", () => {
        expect(BOOTSTRAP_CANONICAL_ZH).toContain("fabric doctor --cite-coverage");
      });

      it("offloads the full cite-contract spec to the fabric-review ref", () => {
        // v2.2 C1 (W2): contract operators / store prefix / skip·dismissed
        // dictionaries / type routing / KB: none sentinels / adjudication ladder
        // all moved OUT of the byte-locked bootstrap into the fabric-review
        // skill's ref/cite-contract.md — bootstrap keeps only the executable core.
        expect(BOOTSTRAP_CANONICAL_ZH).toContain("ref/cite-contract.md");
        // the verbose contract vocabulary must NOT bloat the bootstrap anymore.
        expect(BOOTSTRAP_CANONICAL_ZH).not.toContain("→ edit:");
        expect(BOOTSTRAP_CANONICAL_ZH).not.toContain("[no-relevant]");
        expect(BOOTSTRAP_CANONICAL_ZH).not.toContain("skip:<reason>");
      });
    });

    it("does not contain a UTF-8 BOM", () => {
      expect(BOOTSTRAP_CANONICAL_ZH.charCodeAt(0)).not.toBe(0xfeff);
    });

    describe("single-step KB read flow (KT-DEC-0026 / KT-DEC-0030)", () => {
      // KT-DEC-0026: retrieval collapsed to ONE lean tool. fab_recall returns
      // descriptions + native read paths only; the body is read on demand via a
      // native Read (observed as knowledge_body_read, KT-DEC-0030). The two-step
      // fab_plan_context → fab_get_knowledge_sections MCP surface is retired
      // (clean-slate, KT-DEC-0002) — the bootstrap must NOT teach it anymore.

      // EN parity for every token below is enforced by bootstrap-parity.test.ts.
      it("teaches fab_recall as the single retrieval entry point", () => {
        expect(BOOTSTRAP_CANONICAL_ZH).toContain("fab_recall");
      });

      it("teaches native Read of the body path as the on-demand fetch", () => {
        expect(BOOTSTRAP_CANONICAL_ZH).toContain("knowledge_body_read");
      });

      it("no longer teaches the retired two-step MCP surface (fab_plan_context / fab_get_knowledge_sections)", () => {
        expect(BOOTSTRAP_CANONICAL_ZH).not.toContain("fab_plan_context");
        expect(BOOTSTRAP_CANONICAL_ZH).not.toContain("fab_get_knowledge_sections");
        expect(BOOTSTRAP_CANONICAL_ZH).not.toContain("selection_token");
        expect(BOOTSTRAP_CANONICAL_ZH).not.toContain("ai_selected_stable_ids");
      });

      // rc.23 TASK-013 (F8b): the legacy KNOWLEDGE_SECTION_NAMES tuple was
      // retired long ago; the bootstrap must still never resurrect it.
      it("no longer references the retired KNOWLEDGE_SECTION_NAMES enum", () => {
        expect(BOOTSTRAP_CANONICAL_ZH).not.toContain("MISSION_STATEMENT");
        expect(BOOTSTRAP_CANONICAL_ZH).not.toContain("MANDATORY_INJECTION");
        expect(BOOTSTRAP_CANONICAL_ZH).not.toContain("BUSINESS_LOGIC_CHUNKS");
        expect(BOOTSTRAP_CANONICAL_ZH).not.toContain("CONTEXT_INFO");
      });
    });
  });

  describe("marker constants", () => {
    it("exports the new bootstrap marker pair as exact HTML-comment literals", () => {
      expect(BOOTSTRAP_MARKER_BEGIN).toBe("<!-- fabric:bootstrap:begin -->");
      expect(BOOTSTRAP_MARKER_END).toBe("<!-- fabric:bootstrap:end -->");
    });
  });

  describe("regex matchers", () => {
    it("BOOTSTRAP_REGEX matches a begin/body/end region", () => {
      expect(
        BOOTSTRAP_REGEX.test(
          "<!-- fabric:bootstrap:begin -->\nbody\n<!-- fabric:bootstrap:end -->",
        ),
      ).toBe(true);
    });

    it("BOOTSTRAP_REGEX body is non-greedy across multiple sections", () => {
      const text =
        "<!-- fabric:bootstrap:begin -->A<!-- fabric:bootstrap:end -->\n\nmiddle\n\n<!-- fabric:bootstrap:begin -->B<!-- fabric:bootstrap:end -->";
      const match = text.match(BOOTSTRAP_REGEX);
      expect(match).not.toBeNull();
      // non-greedy: should grab the FIRST end marker, not the last
      expect(match![0]).toContain("A");
      expect(match![0]).not.toContain("middle");
      expect(match![0]).not.toContain("B");
    });

    it("BOOTSTRAP_REGEX does not match legacy KB markers", () => {
      expect(
        BOOTSTRAP_REGEX.test(
          "<!-- fabric:knowledge-base:begin -->\nbody\n<!-- fabric:knowledge-base:end -->",
        ),
      ).toBe(false);
    });
  });

  describe("public surface re-export", () => {
    it("is reachable through the package root barrel", async () => {
      const shared = await import("../../src/index");
      expect((shared as { BOOTSTRAP_CANONICAL_ZH?: string }).BOOTSTRAP_CANONICAL_ZH).toBe(
        BOOTSTRAP_CANONICAL_ZH,
      );
      expect(
        (shared as { BOOTSTRAP_MARKER_BEGIN?: string }).BOOTSTRAP_MARKER_BEGIN,
      ).toBe(BOOTSTRAP_MARKER_BEGIN);
    });
  });
});
