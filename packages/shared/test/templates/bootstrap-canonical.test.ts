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
      expect(BOOTSTRAP_CANONICAL).toContain("## 行为规则");
      expect(BOOTSTRAP_CANONICAL).toContain("## 知识库(KB)");
      expect(BOOTSTRAP_CANONICAL).toContain("## Cite policy");
    });

    it("is at least 400 bytes (utf-8)", () => {
      expect(Buffer.byteLength(BOOTSTRAP_CANONICAL, "utf8")).toBeGreaterThanOrEqual(
        400,
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

      it("references the fab doctor --cite-coverage audit command", () => {
        expect(BOOTSTRAP_CANONICAL).toContain("fab doctor --cite-coverage");
      });
    });

    it("does not contain a UTF-8 BOM", () => {
      expect(BOOTSTRAP_CANONICAL.charCodeAt(0)).not.toBe(0xfeff);
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
