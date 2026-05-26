import { describe, expect, it } from "vitest";

import {
  BOOTSTRAP_CANONICAL,
  BOOTSTRAP_MARKER_BEGIN,
  BOOTSTRAP_MARKER_END,
  BOOTSTRAP_REGEX,
  LEGACY_KB_MARKER_BEGIN,
  LEGACY_KB_MARKER_END,
  LEGACY_KB_REGEX,
} from "../../src/templates/bootstrap-canonical";

describe("bootstrap-canonical", () => {
  describe("BOOTSTRAP_CANONICAL", () => {
    it("starts with the locked header + opening clause", () => {
      expect(BOOTSTRAP_CANONICAL.startsWith("# Fabric Bootstrap\n\n本项目")).toBe(
        true,
      );
    });

    it("contains all required H2 sections", () => {
      // rc.35 TASK-11 (P0-13/P1-9): For Developers section sits between the
      // intro paragraph and the existing AI-facing sections. ≤5 lines,
      // second-person, points dev at USER-QUICKSTART.md to deflect the
      // "AGENTS.md is dev onboarding" misread Batch 7 caught.
      expect(BOOTSTRAP_CANONICAL).toContain("## For Developers");
      expect(BOOTSTRAP_CANONICAL).toContain("docs/USER-QUICKSTART.md");
      expect(BOOTSTRAP_CANONICAL).toContain("## 行为规则");
      expect(BOOTSTRAP_CANONICAL).toContain("## 知识库(KB)");
      expect(BOOTSTRAP_CANONICAL).toContain("## Cite policy");
    });

    it("For Developers section precedes the AI-facing sections", () => {
      const devIdx = BOOTSTRAP_CANONICAL.indexOf("## For Developers");
      const aiIdx = BOOTSTRAP_CANONICAL.indexOf("## 行为规则");
      expect(devIdx).toBeGreaterThan(0);
      expect(aiIdx).toBeGreaterThan(devIdx);
    });

    it("is at least 800 bytes (utf-8)", () => {
      // rc.24: grew from ≥400 with cite-contract syntax bullets (operators +
      // skip-reason dictionary + type routing + personal-layer mention).
      expect(Buffer.byteLength(BOOTSTRAP_CANONICAL, "utf8")).toBeGreaterThanOrEqual(
        800,
      );
    });

    describe("cite policy invariants", () => {
      it("contains the KB cite reply-line format anchor", () => {
        expect(BOOTSTRAP_CANONICAL).toContain("KB: <id>");
      });

      it("contains all four cite status keywords", () => {
        expect(BOOTSTRAP_CANONICAL).toContain("planned|recalled|chained-from");
        expect(BOOTSTRAP_CANONICAL).toContain("dismissed:<reason>");
      });

      it("enumerates all dismissed-reason values", () => {
        expect(BOOTSTRAP_CANONICAL).toContain("scope-mismatch");
        expect(BOOTSTRAP_CANONICAL).toContain("outdated");
        expect(BOOTSTRAP_CANONICAL).toContain("not-applicable");
      });

      it("references the fabric doctor --cite-coverage audit command", () => {
        expect(BOOTSTRAP_CANONICAL).toContain("fabric doctor --cite-coverage");
      });

      describe("cite contract syntax (rc.24)", () => {
        // rc.24: `[recalled]` cite lines for decisions/pitfalls类 entries must
        // append operator-based contract commitments. BOOTSTRAP_CANONICAL is
        // the byte-locked source of truth for the contract vocabulary —
        // operators, skip-reason dictionary, and type routing all live here
        // first, then propagate to hooks + doctor via fabric install.

        it("contains-operator-syntax — shows the `→ edit:` operator anchor", () => {
          expect(BOOTSTRAP_CANONICAL).toContain("→ edit:");
        });

        it("contains-operator-syntax — enumerates all 5 operators", () => {
          expect(BOOTSTRAP_CANONICAL).toContain("edit:<glob>");
          expect(BOOTSTRAP_CANONICAL).toContain("!edit:<glob>");
          expect(BOOTSTRAP_CANONICAL).toContain("require:<symbol>");
          expect(BOOTSTRAP_CANONICAL).toContain("forbid:<symbol>");
          expect(BOOTSTRAP_CANONICAL).toContain("skip:<reason>");
        });

        it("contains-skip-reason-dict — enumerates all 6 skip reasons", () => {
          expect(BOOTSTRAP_CANONICAL).toContain(
            "sequencing | conditional | semantic | aesthetic | architectural | other:<text>",
          );
        });

        it("contains-type-routing-bullet — documents models reference-cite policy", () => {
          expect(BOOTSTRAP_CANONICAL).toContain("models 类引用为 reference cite");
        });

        it("contains-KP-personal-mention — Discovery bullet calls out personal layer", () => {
          expect(BOOTSTRAP_CANONICAL).toContain("KP-*");
        });
      });

      describe("KB: none sentinel enums (rc.23 T8c)", () => {
        // rc.23 T8c: `KB: none` accepts two reason sentinels — `[no-relevant]`
        // (LLM searched but found nothing) and `[not-applicable]` (action not
        // in cite scope). Bare `KB: none` is treated as `[unspecified]` for
        // legacy/lazy emissions.

        it("documents the [no-relevant] sentinel", () => {
          expect(BOOTSTRAP_CANONICAL).toContain("[no-relevant]");
        });

        it("documents the [not-applicable] sentinel as a KB: none reason", () => {
          // 'not-applicable' already exists as a dismissed reason — the T8c
          // addition is the explanatory phrase tying it to KB: none scope.
          expect(BOOTSTRAP_CANONICAL).toContain("不在 cite 范围");
        });

        it("retains bare `KB: none` as legacy [unspecified] form", () => {
          expect(BOOTSTRAP_CANONICAL).toContain("[unspecified]");
        });

        it("uses the new bracketed reply-line shape `KB: none [<reason>]`", () => {
          expect(BOOTSTRAP_CANONICAL).toContain("KB: none [<reason>]");
        });
      });
    });

    it("does not contain a UTF-8 BOM", () => {
      expect(BOOTSTRAP_CANONICAL.charCodeAt(0)).not.toBe(0xfeff);
    });

    describe("two-step KB read flow (rc.23 F1)", () => {
      // rc.23 F1: the template teaches the real two-step API
      //   step 1 — fab_plan_context(paths=[...]) → returns selection_token + entries
      //   step 2 — fab_get_knowledge_sections({selection_token, ai_selected_stable_ids, sections})
      // The pre-rc.23 single-step `fab_get_knowledge_sections(id=...)` form would
      // fail schema validation on the very first KB read.

      it("mentions fab_plan_context as the step-1 entry point", () => {
        expect(BOOTSTRAP_CANONICAL).toContain("fab_plan_context");
      });

      it("mentions ai_selected_stable_ids as a required step-2 argument", () => {
        expect(BOOTSTRAP_CANONICAL).toContain("ai_selected_stable_ids");
      });

      it("references selection_token as the inter-step contract", () => {
        expect(BOOTSTRAP_CANONICAL).toContain("selection_token");
      });

      // rc.23 TASK-013 (F8b): the legacy KNOWLEDGE_SECTION_NAMES tuple
      // (MISSION_STATEMENT / MANDATORY_INJECTION / BUSINESS_LOGIC_CHUNKS /
      // CONTEXT_INFO) was retired. The bootstrap no longer enumerates a
      // section enum — fab_get_knowledge_sections returns the full body and
      // the LLM scans whatever B-set headings the rule defines.
      it("no longer references the retired KNOWLEDGE_SECTION_NAMES enum", () => {
        expect(BOOTSTRAP_CANONICAL).not.toContain("MISSION_STATEMENT");
        expect(BOOTSTRAP_CANONICAL).not.toContain("MANDATORY_INJECTION");
        expect(BOOTSTRAP_CANONICAL).not.toContain("BUSINESS_LOGIC_CHUNKS");
        expect(BOOTSTRAP_CANONICAL).not.toContain("CONTEXT_INFO");
      });

      it("no longer shows a `sections:` parameter in the step-2 example", () => {
        // The `sections` input parameter on fab_get_knowledge_sections was
        // removed in rc.23 F8b. The two-step example must not demo it.
        expect(BOOTSTRAP_CANONICAL).not.toMatch(/sections:\s*\[/);
      });

      it("does not teach the obsolete single-step fab_get_knowledge_sections(id=...) form", () => {
        // The bare `id=` arg form is the rc.22-and-earlier mistake that drove
        // KB:none 25/25. Schema requires selection_token + ai_selected_stable_ids.
        expect(BOOTSTRAP_CANONICAL).not.toMatch(/fab_get_knowledge_sections\(id=/);
      });
    });
  });

  describe("marker constants", () => {
    it("exports the new bootstrap marker pair as exact HTML-comment literals", () => {
      expect(BOOTSTRAP_MARKER_BEGIN).toBe("<!-- fabric:bootstrap:begin -->");
      expect(BOOTSTRAP_MARKER_END).toBe("<!-- fabric:bootstrap:end -->");
    });

    it("exports the legacy knowledge-base marker pair as exact HTML-comment literals", () => {
      expect(LEGACY_KB_MARKER_BEGIN).toBe(
        "<!-- fabric:knowledge-base:begin -->",
      );
      expect(LEGACY_KB_MARKER_END).toBe("<!-- fabric:knowledge-base:end -->");
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

    it("LEGACY_KB_REGEX matches a begin/body/end region", () => {
      expect(
        LEGACY_KB_REGEX.test(
          "<!-- fabric:knowledge-base:begin -->\nbody\n<!-- fabric:knowledge-base:end -->",
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
      expect((shared as { BOOTSTRAP_CANONICAL?: string }).BOOTSTRAP_CANONICAL).toBe(
        BOOTSTRAP_CANONICAL,
      );
      expect(
        (shared as { BOOTSTRAP_MARKER_BEGIN?: string }).BOOTSTRAP_MARKER_BEGIN,
      ).toBe(BOOTSTRAP_MARKER_BEGIN);
    });
  });
});
