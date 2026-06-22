import { describe, expect, it } from "vitest";

import type { ConflictEntry } from "./conflict-lint.js";
import {
  classifyArchiveCandidate,
  formatDedupMarker,
  DEDUP_NEAR_DUPLICATE_THRESHOLD,
} from "./archive-dedup-gate.js";

const DECISION_TEXT = "atlas premultiplyAlpha flag inverted causes sprite black edge halo";

function entry(id: string, text: string, over: Partial<ConflictEntry> = {}): ConflictEntry {
  return { stable_id: id, knowledge_type: "decisions", layer: "team", text, ...over };
}

describe("classifyArchiveCandidate", () => {
  it("returns unique against an empty corpus", () => {
    const result = classifyArchiveCandidate(
      { text: DECISION_TEXT, knowledge_type: "decisions", layer: "team" },
      [],
    );
    expect(result.verdict).toBe("unique");
    expect(result.matches).toEqual([]);
  });

  it("returns unique when no existing entry shares vocabulary", () => {
    const result = classifyArchiveCandidate(
      { text: DECISION_TEXT, knowledge_type: "decisions", layer: "team" },
      [entry("team:KT-DEC-0001", "completely unrelated lifecycle governance store routing topic")],
    );
    expect(result.verdict).toBe("unique");
    expect(result.matches).toEqual([]);
  });

  it("flags a verbatim twin as near-duplicate (similarity ≈ 1.0 ≥ 0.85)", () => {
    const result = classifyArchiveCandidate(
      { text: DECISION_TEXT, knowledge_type: "decisions", layer: "team" },
      [entry("team:KT-DEC-0042", DECISION_TEXT)],
    );
    expect(result.verdict).toBe("near-duplicate");
    expect(result.matches[0]?.stable_id).toBe("team:KT-DEC-0042");
    expect(result.matches[0]?.similarity).toBeGreaterThanOrEqual(DEDUP_NEAR_DUPLICATE_THRESHOLD);
  });

  it("flags the conflict band when similarity sits between the thresholds", () => {
    // A verbatim twin scores ≈ 1.0; push the near-duplicate cut above it so the
    // same strong match lands in the conflict band instead — deterministically
    // exercises the middle branch without tuning fragile partial-overlap text.
    const result = classifyArchiveCandidate(
      { text: DECISION_TEXT, knowledge_type: "decisions", layer: "team" },
      [entry("team:KT-DEC-0042", DECISION_TEXT)],
      { nearDuplicateThreshold: 1.5, conflictThreshold: 0.5 },
    );
    expect(result.verdict).toBe("conflict");
    expect(result.matches[0]?.stable_id).toBe("team:KT-DEC-0042");
  });

  it("ignores entries in a different (type, layer) bucket", () => {
    const result = classifyArchiveCandidate(
      { text: DECISION_TEXT, knowledge_type: "decisions", layer: "team" },
      [
        entry("team:KP-DEC-0001", DECISION_TEXT, { layer: "personal" }), // different layer
        entry("team:KT-PIT-0001", DECISION_TEXT, { knowledge_type: "pitfalls" }), // different type
      ],
    );
    expect(result.verdict).toBe("unique");
    expect(result.matches).toEqual([]);
  });

  it("returns matches sorted by similarity descending", () => {
    const result = classifyArchiveCandidate(
      { text: DECISION_TEXT, knowledge_type: "decisions", layer: "team" },
      [
        entry("team:KT-DEC-0001", DECISION_TEXT), // verbatim → high
        entry("team:KT-DEC-0002", DECISION_TEXT + " plus several extra unrelated trailing tokens here now"),
      ],
    );
    expect(result.matches.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < result.matches.length; i += 1) {
      expect(result.matches[i - 1].similarity).toBeGreaterThanOrEqual(result.matches[i].similarity);
    }
  });

  it("handles CJK content via the shared n-gram tokenizer", () => {
    const zh = "图集 premultiplyAlpha 标志反向导致精灵黑边光晕";
    const result = classifyArchiveCandidate(
      { text: zh, knowledge_type: "decisions", layer: "team" },
      [entry("team:KT-DEC-0099", zh)],
    );
    expect(result.verdict).toBe("near-duplicate");
  });
});

describe("formatDedupMarker", () => {
  it("returns undefined for a unique verdict (no marker emitted)", () => {
    expect(formatDedupMarker({ verdict: "unique", matches: [] })).toBeUndefined();
  });

  it("renders verdict + top match id + 2-dp similarity", () => {
    const marker = formatDedupMarker({
      verdict: "near-duplicate",
      matches: [{ stable_id: "team:KT-DEC-0042", similarity: 0.913 }],
    });
    expect(marker).toBe("near-duplicate of team:KT-DEC-0042 (0.91)");
  });
});
