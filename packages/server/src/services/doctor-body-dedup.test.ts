import { describe, expect, it, vi } from "vitest";

import { createTranslator, detectNodeLocale } from "@fenglimg/fabric-shared";

import { applyBodyDedupFixes, createBodyDedupCheck } from "./doctor-body-dedup.js";
import type { BodyDedupInspection } from "./doctor-body-dedup.js";

const t = createTranslator(detectNodeLocale());

describe("doctor body dedup (v-next grill D5/D7/D8)", () => {
  describe("applyBodyDedupFixes", () => {
    it("strips ## Summary when verbatim match with frontmatter", () => {
      const content = [
        "---",
        "summary: Short summary here.",
        "---",
        "",
        "## Summary",
        "",
        "Short summary here.",
        "",
        "## Context",
        "",
        "Some context.",
        "",
      ].join("\n");
      const result = applyBodyDedupFixes(content, ["body_summary_verbatim"]);
      expect(result).not.toContain("## Summary");
      expect(result).toContain("## Context");
      expect(result).toContain("Some context.");
    });

    it("strips ## Evidence when redundant with frontmatter evidence_paths", () => {
      const content = [
        "---",
        'evidence_paths: ["src/a.ts", "src/b.ts"]',
        "---",
        "",
        "## Context",
        "",
        "Some context.",
        "",
        "## Evidence",
        "",
        "Recent paths:",
        "- src/a.ts",
        "- src/b.ts",
        "",
      ].join("\n");
      const result = applyBodyDedupFixes(content, ["body_evidence_redundant"]);
      expect(result).not.toContain("## Evidence");
      expect(result).toContain("## Context");
    });

    it("strips ## Why proposed (always obsolete in v-next)", () => {
      const content = [
        "---",
        "proposed_reason: decision-confirmation",
        "---",
        "",
        "## Why proposed",
        "",
        "≥2 alternatives weighed; rationale stated.",
        "",
        "## Context",
        "",
        "Some context.",
        "",
      ].join("\n");
      const result = applyBodyDedupFixes(content, ["body_why_proposed_obsolete"]);
      expect(result).not.toContain("## Why proposed");
      expect(result).toContain("## Context");
    });

    it("renames ## Session context to ## Context", () => {
      const content = [
        "---",
        "summary: test",
        "---",
        "",
        "## Session context",
        "",
        "Session goal: do something.",
        "",
      ].join("\n");
      const result = applyBodyDedupFixes(content, ["body_session_context_rename"]);
      expect(result).not.toContain("## Session context");
      expect(result).toContain("## Context");
      expect(result).toContain("Session goal: do something.");
    });

    it("applies multiple fixes in one pass", () => {
      const content = [
        "---",
        "summary: Short.",
        'evidence_paths: ["a.ts"]',
        "proposed_reason: wrong-turn-revert",
        "---",
        "",
        "## Summary",
        "",
        "Short.",
        "",
        "## Why proposed",
        "",
        "Tried X, reverted.",
        "",
        "## Session context",
        "",
        "Session goal: fix bug.",
        "",
        "## Evidence",
        "",
        "Recent paths:",
        "- a.ts",
        "",
      ].join("\n");
      const result = applyBodyDedupFixes(content, [
        "body_summary_verbatim",
        "body_why_proposed_obsolete",
        "body_session_context_rename",
        "body_evidence_redundant",
      ]);
      expect(result).not.toContain("## Summary");
      expect(result).not.toContain("## Why proposed");
      expect(result).not.toContain("## Session context");
      expect(result).not.toContain("## Evidence");
      expect(result).toContain("## Context");
      expect(result).toContain("Session goal: fix bug.");
      expect(result.endsWith("\n")).toBe(true);
    });

    it("does not strip ## Summary when diverged", () => {
      const content = [
        "---",
        "summary: Frontmatter version.",
        "---",
        "",
        "## Summary",
        "",
        "Completely different body summary with extra detail.",
        "",
        "## Context",
        "",
        "Some context.",
        "",
      ].join("\n");
      const result = applyBodyDedupFixes(content, ["body_summary_diverged"]);
      expect(result).toContain("## Summary");
      expect(result).toContain("Completely different body summary");
    });

    it("merges tech_stack into tags and removes tech_stack field", () => {
      const content = [
        "---",
        "summary: test",
        'tags: ["cli-design", "color"]',
        'tech_stack: ["typescript", "cli"]',
        "---",
        "",
        "## Context",
        "",
        "Some context.",
        "",
      ].join("\n");
      const result = applyBodyDedupFixes(content, ["fm_tech_stack_merge"]);
      expect(result).not.toContain("tech_stack:");
      expect(result).toContain('tags: ["cli-design","color","typescript","cli"]');
      expect(result).toContain("## Context");
    });

    it("merges tech_stack into tags with dedup", () => {
      const content = [
        "---",
        "summary: test",
        'tags: ["typescript", "color"]',
        'tech_stack: ["typescript", "cli"]',
        "---",
        "",
        "## Context",
        "",
        "y",
        "",
      ].join("\n");
      const result = applyBodyDedupFixes(content, ["fm_tech_stack_merge"]);
      expect(result).not.toContain("tech_stack:");
      expect(result).toContain('tags: ["typescript","color","cli"]');
    });

    it("creates tags field when only tech_stack exists", () => {
      const content = [
        "---",
        "summary: test",
        'tech_stack: ["typescript", "cli"]',
        "---",
        "",
        "## Context",
        "",
        "y",
        "",
      ].join("\n");
      const result = applyBodyDedupFixes(content, ["fm_tech_stack_merge"]);
      expect(result).not.toContain("tech_stack:");
      expect(result).toContain('tags: ["typescript","cli"]');
    });

    it("collapses triple+ newlines to double", () => {
      const content = [
        "---",
        "summary: x",
        "---",
        "",
        "## Summary",
        "",
        "x",
        "",
        "",
        "",
        "## Context",
        "",
        "y",
        "",
      ].join("\n");
      const result = applyBodyDedupFixes(content, ["body_summary_verbatim"]);
      expect(result).not.toMatch(/\n{3,}/);
    });
  });

  describe("createBodyDedupCheck", () => {
    it("returns ok when no entries", () => {
      const check = createBodyDedupCheck(t, { entries: [] });
      expect(check.status).toBe("ok");
    });

    it("returns fixable_error for fixable findings", () => {
      const inspection: BodyDedupInspection = {
        entries: [
          {
            stable_id: "team:KT-DEC-0001",
            path: "/tmp/store/knowledge/decisions/KT-DEC-0001.md",
            findings: ["body_summary_verbatim", "body_session_context_rename"],
          },
        ],
      };
      const check = createBodyDedupCheck(t, inspection);
      expect(check.status).toBe("error");
      expect(check.kind).toBe("fixable_error");
      expect(check.fixable).toBe(true);
      expect(check.code).toBe("knowledge_body_dedup");
    });

    it("returns warning for diverged-only (not auto-fixable)", () => {
      const inspection: BodyDedupInspection = {
        entries: [
          {
            stable_id: "team:KT-DEC-0002",
            path: "/tmp/store/knowledge/decisions/KT-DEC-0002.md",
            findings: ["body_summary_diverged"],
          },
        ],
      };
      const check = createBodyDedupCheck(t, inspection);
      expect(check.status).toBe("warn");
      expect(check.kind).toBe("warning");
      expect(check.fixable).toBe(false);
    });

    it("returns warn on scan error", () => {
      const inspection: BodyDedupInspection = {
        entries: [],
        errored: true,
        error_message: "boom",
      };
      const check = createBodyDedupCheck(t, inspection);
      expect(check.status).toBe("warn");
      expect(check.code).toBe("knowledge_body_dedup_scan_error");
    });
  });

  describe("inspectBodyDedup", () => {
    it("detects legacy sections in canonical entries", async () => {
      const entryBody = [
        "---",
        "id: KT-DEC-9999",
        "summary: A decision about caching.",
        'evidence_paths: ["src/cache.ts"]',
        "proposed_reason: decision-confirmation",
        "---",
        "",
        "## Summary",
        "",
        "A decision about caching.",
        "",
        "## Why proposed",
        "",
        "≥2 alternatives weighed.",
        "",
        "## Session context",
        "",
        "Session goal: optimize caching.",
        "",
        "## Evidence",
        "",
        "Recent paths:",
        "- src/cache.ts",
        "",
      ].join("\n");

      vi.resetModules();
      vi.doMock("./cross-store-recall.js", () => ({
        collectStoreCanonicalEntries: vi.fn().mockResolvedValue([
          {
            qualifiedId: "team:KT-DEC-9999",
            file: "/tmp/store/knowledge/decisions/KT-DEC-9999.md",
            type: "decisions",
            body: entryBody,
            description: { summary: "A decision about caching." },
          },
        ]),
      }));
      const { inspectBodyDedup } = await import("./doctor-body-dedup.js");
      const inspection = await inspectBodyDedup("/tmp/project");
      expect(inspection.errored).toBeFalsy();
      expect(inspection.entries).toHaveLength(1);
      const entry = inspection.entries[0]!;
      expect(entry.findings).toContain("body_summary_verbatim");
      expect(entry.findings).toContain("body_evidence_redundant");
      expect(entry.findings).toContain("body_why_proposed_obsolete");
      expect(entry.findings).toContain("body_session_context_rename");
    });

    it("detects tech_stack frontmatter for merge", async () => {
      const entryBody = [
        "---",
        "id: KT-DEC-8888",
        "summary: A clean entry with tech_stack.",
        'tags: ["cli"]',
        'tech_stack: ["typescript"]',
        "---",
        "",
        "## Context",
        "",
        "Some context.",
        "",
      ].join("\n");

      vi.resetModules();
      vi.doMock("./cross-store-recall.js", () => ({
        collectStoreCanonicalEntries: vi.fn().mockResolvedValue([
          {
            qualifiedId: "team:KT-DEC-8888",
            file: "/tmp/store/knowledge/decisions/KT-DEC-8888.md",
            type: "decisions",
            body: entryBody,
            description: { summary: "A clean entry with tech_stack." },
          },
        ]),
      }));
      const { inspectBodyDedup } = await import("./doctor-body-dedup.js");
      const inspection = await inspectBodyDedup("/tmp/project");
      expect(inspection.errored).toBeFalsy();
      expect(inspection.entries).toHaveLength(1);
      expect(inspection.entries[0]!.findings).toEqual(["fm_tech_stack_merge"]);
    });

    it("returns clean when no legacy sections exist", async () => {
      const cleanBody = [
        "---",
        "id: KT-GLD-0001",
        "summary: Clean entry.",
        'evidence_paths: ["src/a.ts"]',
        "---",
        "",
        "## Context",
        "",
        "Session goal: clean.",
        "",
      ].join("\n");

      vi.resetModules();
      vi.doMock("./cross-store-recall.js", () => ({
        collectStoreCanonicalEntries: vi.fn().mockResolvedValue([
          {
            qualifiedId: "team:KT-GLD-0001",
            file: "/tmp/store/knowledge/guidelines/KT-GLD-0001.md",
            type: "guidelines",
            body: cleanBody,
            description: { summary: "Clean entry." },
          },
        ]),
      }));
      const { inspectBodyDedup } = await import("./doctor-body-dedup.js");
      const inspection = await inspectBodyDedup("/tmp/project");
      expect(inspection.errored).toBeFalsy();
      expect(inspection.entries).toHaveLength(0);
    });

    it("handles corpus walk failure gracefully", async () => {
      vi.resetModules();
      vi.doMock("./cross-store-recall.js", () => ({
        collectStoreCanonicalEntries: vi.fn().mockRejectedValue(new Error("walk-boom")),
      }));
      const { inspectBodyDedup } = await import("./doctor-body-dedup.js");
      const inspection = await inspectBodyDedup("/tmp/project");
      expect(inspection.errored).toBe(true);
      expect(inspection.entries).toEqual([]);
    });
  });
});
