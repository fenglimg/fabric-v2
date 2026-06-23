import { describe, expect, it } from "vitest";

import {
  BOOTSTRAP_CANONICAL_BY_LOCALE,
  BOOTSTRAP_CANONICAL_EN,
  BOOTSTRAP_CANONICAL_ZH,
} from "../../src/templates/bootstrap-canonical";

// ---------------------------------------------------------------------------
// Content-layer i18n parity census (G-PARITY C1)
//
// BOOTSTRAP_CANONICAL_ZH and BOOTSTRAP_CANONICAL_EN are two byte-locked bodies
// the install writer / doctor drift comparator select between via
// resolveGlobalLocale. A drift between them is SILENT: a section or protected
// token present in one locale but not the other degrades that locale's users
// (an en user missing the cite-contract bullet, a zh user missing a skill
// reference) without any byte-lock test firing — each locale's own byte-lock
// only guards itself. This census is the deterministic gate that the two
// bodies stay structurally parallel and keep every protected token (per
// KT-GLD-0002: translate prose, keep command names / routing keys / `fab_*`
// calls / marker literals / enum values in English) in BOTH.
// ---------------------------------------------------------------------------

// Language-neutral protected tokens that MUST appear verbatim in BOTH locale
// bodies. A future edit that accidentally translates one of these (or drops it
// from one body) is a contract break the census catches.
const PROTECTED_TOKENS: readonly string[] = [
  // command surface
  "fabric install",
  "fabric doctor",
  "fabric doctor --fix",
  "fabric doctor --cite-coverage",
  "fabric store bind <alias>",
  "fabric store switch-write <alias>",
  "npm install -g @fenglimg/fabric-cli@latest",
  // MCP tools — KT-DEC-0026: retrieval collapsed to the single lean fab_recall;
  // the two-step fab_plan_context / fab_get_knowledge_sections (+ selection_token
  // / ai_selected_stable_ids / candidates[].stable_id) surface is retired, so
  // those tokens no longer appear in either bootstrap body.
  "fab_recall",
  'fab_review action="list"',
  // paths / config
  ".fabric/agents.meta.json",
  // W0-2: language is the single machine-wide tone in ~/.fabric/fabric-global.json
  // (the old per-project `.fabric/fabric-config.json` `fabric_language` field is
  // retired — KT-DEC-0034 — so neither token appears in the bootstrap body).
  "~/.fabric/fabric-global.json",
  "docs/USER-QUICKSTART.md",
  "knowledge/pitfalls/",
  ".fabric/knowledge/pending",
  "fabric-hint.cjs",
  "archive_edit_threshold",
  "atlas.premultiplyAlpha",
  // skills (7)
  "fabric-archive",
  "fabric-review",
  "fabric-import",
  "fabric-store",
  "fabric-sync",
  "fabric-connect",
  "fabric-audit",
  // cite syntax + vocabulary — v2.2 C1 (W2): the cite contract is internalised.
  // Contract operators (→ edit: / skip:<reason> / …), the store-qualified prefix,
  // KB: none sentinels, and the skip·dismissed dictionaries moved OUT of the
  // byte-locked bootstrap into the fabric-review skill's ref/cite-contract.md.
  // The lean bootstrap keeps only the cite-line anchor, the dismissed-reason
  // enum, and the offload pointer.
  "KB: <id>",
  "ref/cite-contract.md",
  // dismissed reasons (the only cite vocabulary the lean bootstrap still carries)
  "scope-mismatch",
  "outdated",
  "not-applicable",
  // discovery / markers
  "KP-*",
  // (v2.2 C1 W3b) the `self-archive policy triggered by signal` routing marker
  // was retired: the AI no longer prints a magic string to signal E3 — the
  // fabric-archive skill routes an AI self-invocation to E3 as the deterministic
  // else-branch. The marker is therefore no longer a protected bootstrap token.
  // language-neutral heading kept identical in both
  "## For Developers",
];

// Retired tokens that must be absent from BOTH bodies (rc.23 F8b cleanup).
const FORBIDDEN_TOKENS: readonly string[] = [
  "MISSION_STATEMENT",
  "MANDATORY_INJECTION",
  "BUSINESS_LOGIC_CHUNKS",
  "CONTEXT_INFO",
];

function h2Count(body: string): number {
  return (body.match(/^## /gmu) ?? []).length;
}

describe("bootstrap canonical en↔zh parity census", () => {
  it("BY_LOCALE maps exactly the two supported locales to their bodies", () => {
    expect(Object.keys(BOOTSTRAP_CANONICAL_BY_LOCALE).sort()).toEqual(["en", "zh-CN"]);
    expect(BOOTSTRAP_CANONICAL_BY_LOCALE["zh-CN"]).toBe(BOOTSTRAP_CANONICAL_ZH);
    expect(BOOTSTRAP_CANONICAL_BY_LOCALE.en).toBe(BOOTSTRAP_CANONICAL_EN);
  });

  it("both bodies share the locked H1 header", () => {
    expect(BOOTSTRAP_CANONICAL_ZH.startsWith("# Fabric Bootstrap\n")).toBe(true);
    expect(BOOTSTRAP_CANONICAL_EN.startsWith("# Fabric Bootstrap\n")).toBe(true);
  });

  it("both bodies have the same number of H2 sections", () => {
    expect(h2Count(BOOTSTRAP_CANONICAL_EN)).toBe(h2Count(BOOTSTRAP_CANONICAL_ZH));
  });

  it("both bodies are at least 800 bytes (utf-8)", () => {
    expect(Buffer.byteLength(BOOTSTRAP_CANONICAL_ZH, "utf8")).toBeGreaterThanOrEqual(800);
    expect(Buffer.byteLength(BOOTSTRAP_CANONICAL_EN, "utf8")).toBeGreaterThanOrEqual(800);
  });

  it("neither body carries a UTF-8 BOM", () => {
    expect(BOOTSTRAP_CANONICAL_ZH.charCodeAt(0)).not.toBe(0xfeff);
    expect(BOOTSTRAP_CANONICAL_EN.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("For Developers precedes the AI-facing sections in both bodies", () => {
    for (const [locale, body, aiHeading] of [
      ["zh-CN", BOOTSTRAP_CANONICAL_ZH, "## 行为规则"],
      ["en", BOOTSTRAP_CANONICAL_EN, "## Behavior Rules"],
    ] as const) {
      const devIdx = body.indexOf("## For Developers");
      const aiIdx = body.indexOf(aiHeading);
      expect(devIdx, `${locale}: For Developers heading`).toBeGreaterThan(0);
      expect(aiIdx, `${locale}: AI section heading`).toBeGreaterThan(devIdx);
    }
  });

  it("every protected token appears verbatim in BOTH locale bodies", () => {
    const missingInEn = PROTECTED_TOKENS.filter((t) => !BOOTSTRAP_CANONICAL_EN.includes(t));
    const missingInZh = PROTECTED_TOKENS.filter((t) => !BOOTSTRAP_CANONICAL_ZH.includes(t));
    expect({ missingInEn, missingInZh }).toEqual({ missingInEn: [], missingInZh: [] });
  });

  it("no retired enum token leaks into either body", () => {
    const inEn = FORBIDDEN_TOKENS.filter((t) => BOOTSTRAP_CANONICAL_EN.includes(t));
    const inZh = FORBIDDEN_TOKENS.filter((t) => BOOTSTRAP_CANONICAL_ZH.includes(t));
    expect({ inEn, inZh }).toEqual({ inEn: [], inZh: [] });
  });

  it("neither body teaches the obsolete single-step fab_get_knowledge_sections(id=...) form", () => {
    expect(BOOTSTRAP_CANONICAL_EN).not.toMatch(/fab_get_knowledge_sections\(id=/u);
    expect(BOOTSTRAP_CANONICAL_ZH).not.toMatch(/fab_get_knowledge_sections\(id=/u);
  });
});
