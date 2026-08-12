import { describe, expect, it } from "vitest";

import {
  BOOTSTRAP_CANONICAL_ZH,
  BOOTSTRAP_MARKER_BEGIN,
  BOOTSTRAP_MARKER_END,
  BOOTSTRAP_REGEX,
} from "../../src/templates/bootstrap-canonical";

describe("bootstrap-canonical", () => {
  describe("BOOTSTRAP_CANONICAL_ZH", () => {
    // T-3: the prose H2 headings + section ordering + byte floor moved to
    // bootstrap-canonical.wording.test.ts (PROMPT_WORDING=1, outside the PR
    // gate). What stays here is the PATH the dev section must point at — a path
    // is a contract with the repo, a heading is a wording choice.
    it("points developers at the quickstart doc that actually exists", () => {
      expect(BOOTSTRAP_CANONICAL_ZH).toContain("docs/USER-QUICKSTART.md");
    });

    describe("cite policy invariants", () => {
      it("contains the KB cite reply-line format anchor", () => {
        expect(BOOTSTRAP_CANONICAL_ZH).toContain("KB: <id>");
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

      it("references the fabric audit cite command", () => {
        expect(BOOTSTRAP_CANONICAL_ZH).toContain("fabric audit cite");
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

  describe("pre-action gating + archive-as-truth (peer micro-transfer)", () => {
    // T-3: the two Chinese framing phrases moved to the wording file; the two
    // identifiers below are the actual contract — if the bootstrap stops naming
    // `fab_recall(paths=` / `session_id=`, agents are taught a call shape the
    // MCP surface does not accept.
    it("teaches fab_recall(paths= with session_id before edit", () => {
      expect(BOOTSTRAP_CANONICAL_ZH).toContain("fab_recall(paths=");
      expect(BOOTSTRAP_CANONICAL_ZH).toContain("session_id=");
    });

    it("states pending→review as only path into canonical", () => {
      expect(BOOTSTRAP_CANONICAL_ZH).toContain("fab_propose");
      expect(BOOTSTRAP_CANONICAL_ZH).toMatch(/fabric-review|fab_review/);
      expect(BOOTSTRAP_CANONICAL_ZH).toContain("canonical");
      expect(BOOTSTRAP_CANONICAL_ZH).toContain("pending");
    });

    it("keeps soft archive cadence default 20 / archive_edit_threshold", () => {
      expect(BOOTSTRAP_CANONICAL_ZH).toContain("archive_edit_threshold");
      expect(BOOTSTRAP_CANONICAL_ZH).toContain("20");
    });
  });

});
