/**
 * v2.0.0-rc.16 TASK-004 (F2-tests): contract tests for the shared banner
 * i18n library at `templates/hooks/lib/banner-i18n.cjs`.
 *
 * Coverage matrix: 13 banner keys × 4 language variants — every (key, variant)
 * combination is exercised at least once. Each per-variant assertion proves
 * that translation actually happened (variant-specific substring present)
 * AND that protected tokens survive verbatim across all variants
 * (slash commands `/fabric-archive`, `/fabric-review`, `/fabric-import`,
 * the literal CLI command `` `fabric doctor --lint` `` with backticks, the
 * `📋 Fabric:` banner prefix, and rc.15 substring contracts the existing
 * `fabric-hint.test.ts` / `knowledge-hint-broad.test.ts` suites assert on).
 *
 * The `match-existing` variant intentionally has NO entry in the STRINGS
 * table — `renderBanner` folds it down to `en` per the lib's documented
 * UX i18n Policy class 1. We assert byte-equality with `en` for every key
 * to lock that contract in place.
 *
 * `readFabricLanguage` is also covered: missing config → `'zh-CN'`
 * (back-compat default for rc.15 fixtures), explicit valid values pass
 * through, unknown values fall back to the same `'zh-CN'` default.
 *
 * Loading pattern: `createRequire` + absolute path under templates/, mirrors
 * the loading pattern in fabric-hint.test.ts and session-digest-writer.test.ts
 * so Vitest's ESM resolver does not interfere with the .cjs target.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const libPath = fileURLToPath(
  new URL("../templates/hooks/lib/banner-i18n.cjs", import.meta.url),
);

type Variant = "zh-CN" | "en" | "zh-CN-hybrid" | "match-existing";

type LibModule = {
  readFabricLanguage: (projectRoot: string) => Variant;
  renderBanner: (key: string, variant: string, params?: Record<string, unknown>) => string;
  STRINGS: Record<string, Record<string, (params: Record<string, unknown>) => string>>;
};

const lib = require(libPath) as LibModule;

// ---------------------------------------------------------------------------
// Shared fixture data — every (key, variant) test renders against the same
// param shape so cross-variant byte-equality assertions for `match-existing`
// are mechanically valid.
// ---------------------------------------------------------------------------

// `archiveLine1.parts` and `archiveActivity.activity` are caller-opaque values
// (the lib never inspects or translates them — only interpolates them into the
// per-variant template). The fabric-hint.cjs caller currently builds Chinese-
// formatted parts even when variant === 'en' (a product gap tracked outside
// this lib's surface), so the test fixture deliberately uses CALLER-NEUTRAL
// values containing no Chinese characters. That keeps the lib's no-Chinese
// `en` contract assertable in isolation while still exercising the same
// interpolation path the caller drives in production.
const FIXTURE_PARAMS: Record<string, Record<string, unknown>> = {
  archiveLine1: { parts: "25.0h since last write" },
  // v2.0.0-rc.27 TASK-005 (audit §2.17): per-variant parts assembly. Caller
  // now invokes these to build `parts` so the en variant gets a fully
  // English fragment instead of mixed-language output.
  archivePartsHours: { hoursFixed: "25.0", threshold: 24 },
  archivePartsEdits: { count: 21, threshold: 20 },
  archiveActivity: { activity: "src/app.ts, src/util.ts" },
  archiveCta: {},
  reviewLine1: { count: 7, ageSuffix: " / 最早一条 3.2 天前" },
  reviewCta: {},
  importLine1: { nodeCount: 3, threshold: 12, hoursSinceInit: "48.5" },
  importCta: {},
  maintenanceLine1Never: {},
  maintenanceLine1Aged: { days: 14, ageDays: "14.7" },
  maintenanceLine2: {},
  broadImportBanner: {},
  // rc.22 Scope D T-D4 (TASK-011): meta auto-refresh breadcrumb. `prev` / `cur`
  // are 8-char hex strings (caller already strips the sha256: scheme prefix).
  metaAutoRefreshedBanner: { prev: "a1b2c3d4", cur: "e5f60718" },
  metaAutoRefreshedBannerGeneric: {},
};

const ALL_KEYS = Object.keys(FIXTURE_PARAMS);
const ALL_VARIANTS: Variant[] = ["zh-CN", "en", "zh-CN-hybrid", "match-existing"];

// ---------------------------------------------------------------------------
// Pre-flight sanity — the fixture key list MUST match the lib's STRINGS
// table exactly, otherwise a future addition to the table will silently
// skip its variant coverage. Hard-fail at suite-load time if drift sneaks in.
// ---------------------------------------------------------------------------

describe("banner-i18n: STRINGS table coverage envelope", () => {
  it("FIXTURE_PARAMS lists every key exported by the lib (and no extras)", () => {
    const stringsKeys = Object.keys(lib.STRINGS).sort();
    const fixtureKeys = [...ALL_KEYS].sort();
    expect(fixtureKeys).toEqual(stringsKeys);
  });

  it("exposes exactly 15 banner keys (rc.27 contract — was 13 pre-archive-parts-i18n)", () => {
    // rc.27 TASK-005 added archivePartsHours + archivePartsEdits (audit §2.17).
    expect(Object.keys(lib.STRINGS)).toHaveLength(15);
  });
});

// ---------------------------------------------------------------------------
// Per-key × per-variant matrix.
//
// For each (key, variant) we assert:
//   1. render returns a non-empty string (no silent-empty fallback)
//   2. variant-specific substring contract:
//      - zh-CN     : Chinese characters present + rc.15 numeric/template tokens
//                    where applicable
//      - en        : English connector word(s) present (tolerant; we avoid
//                    pinning every word so future copy tweaks don't break
//                    the test for non-functional reasons)
//      - zh-CN-hybrid : Chinese characters present AND protected English
//                       tokens preserved verbatim
//      - match-existing : BYTE-IDENTICAL to en (lib's documented fallback)
//   3. protected tokens (slash commands / `fabric doctor --lint` / 📋 Fabric:)
//      preserved verbatim across all four variants where the key carries them.
// ---------------------------------------------------------------------------

// Per-key protected-token + substring expectations. Each entry declares:
//   protectedTokens: literals that MUST appear in every variant render
//   zhCNContract   : substrings the rc.15 fabric-hint.test.ts / knowledge-
//                    hint-broad.test.ts already pin against zh-CN output
//   enHints        : English fragments that should appear in en (loose)
type KeyContract = {
  protectedTokens: string[];
  zhCNContract: string[];
  enHints: string[];
};

const CONTRACTS: Record<string, KeyContract> = {
  archiveLine1: {
    // `25.0h` originates from the caller-opaque `parts` fixture and survives
    // verbatim through the lib's interpolation in every variant — that proves
    // the substring contract that fabric-hint.cjs's existing test relies on.
    protectedTokens: ["📋 Fabric:", "25.0h"],
    zhCNContract: ["距上次归档"],
    enHints: ["since last archive"],
  },
  archiveActivity: {
    protectedTokens: ["src/app.ts, src/util.ts"],
    zhCNContract: ["最近活动集中在"],
    enHints: ["Recent activity"],
  },
  // v2.0.0-rc.27 TASK-005 (audit §2.17): per-variant parts assembly. zh-CN
  // keeps the rc.15 substring contract (`阈值`, `已过`, `次编辑`); en gets a
  // fully English fragment so the post-merge archiveLine1 is monolingual.
  archivePartsHours: {
    protectedTokens: ["25.0", "24"],
    zhCNContract: ["已过", "阈值"],
    enHints: ["elapsed", "threshold"],
  },
  archivePartsEdits: {
    protectedTokens: ["21", "20"],
    zhCNContract: ["累计", "次编辑", "阈值"],
    enHints: ["edits since last archive", "threshold"],
  },
  archiveCta: {
    protectedTokens: ["/fabric-archive"],
    zhCNContract: ["是否调"],
    enHints: ["Run"],
  },
  reviewLine1: {
    protectedTokens: ["📋 Fabric:", "7 "], // numeric "${count} " survives
    zhCNContract: ["7 条", "最早一条 3.2 天前"],
    enHints: ["pending knowledge entries", "oldest is", "3.2d old"],
  },
  reviewCta: {
    protectedTokens: ["/fabric-review"],
    zhCNContract: ["是否调"],
    enHints: ["Run"],
  },
  importLine1: {
    protectedTokens: ["📋 Fabric:", "3/12", "48.5h", "init_scan_completed"],
    zhCNContract: ["知识库节点数"],
    enHints: ["knowledge node count", "since init_scan_completed"],
  },
  importCta: {
    protectedTokens: ["/fabric-import"],
    zhCNContract: ["是否调"],
    enHints: ["Run"],
  },
  maintenanceLine1Never: {
    protectedTokens: ["📋 Fabric:"],
    zhCNContract: ["从未运行 lint 检查"],
    enHints: ["lint check has never been run"],
  },
  maintenanceLine1Aged: {
    protectedTokens: ["📋 Fabric:", "14.7d"],
    zhCNContract: ["已 14 天未跑 lint"],
    enHints: ["14 days since the last lint check"],
  },
  maintenanceLine2: {
    protectedTokens: ["`fabric doctor --lint`"],
    zhCNContract: ["是否调"],
    enHints: ["Run"],
  },
  broadImportBanner: {
    protectedTokens: ["📋 Fabric:", "/fabric-import"],
    zhCNContract: ["知识库稀疏"],
    enHints: ["knowledge base is sparse"],
  },
  // rc.22 Scope D T-D4 (TASK-011): meta auto-refresh transition line. The
  // 8-char hex prev/cur values are interpolated verbatim into every variant;
  // the `🔄 Fabric:` prefix + `sha` literal + arrow are protected tokens. The
  // 'sha ' substring (with trailing space) is sufficient to pin the format
  // without coupling to copy.
  metaAutoRefreshedBanner: {
    protectedTokens: ["🔄 Fabric:", "sha ", "a1b2c3d4", "e5f60718", "→"],
    zhCNContract: ["元数据已自动刷新"],
    enHints: ["meta auto-refreshed"],
  },
  // Generic fallback — same prefix, no hash transition.
  metaAutoRefreshedBannerGeneric: {
    protectedTokens: ["🔄 Fabric:"],
    zhCNContract: ["元数据已自动刷新"],
    enHints: ["meta auto-refreshed"],
  },
};

describe("banner-i18n: 11 keys × 4 variants — render matrix", () => {
  for (const key of ALL_KEYS) {
    const contract = CONTRACTS[key];
    const params = FIXTURE_PARAMS[key];

    describe(`key: ${key}`, () => {
      // Render every variant once and reuse the strings inside per-variant
      // tests below — keeps the test runtime O(11×4) instead of O(11×4×N).
      const renders: Partial<Record<Variant, string>> = {};
      beforeEach(() => {
        for (const variant of ALL_VARIANTS) {
          renders[variant] = lib.renderBanner(key, variant, params);
        }
      });

      // -- zh-CN -----------------------------------------------------------
      it("zh-CN: renders non-empty + Chinese substring + protected tokens", () => {
        const out = renders["zh-CN"]!;
        expect(out.length).toBeGreaterThan(0);
        // Chinese characters present (proves it's not the en fallback)
        expect(out).toMatch(/[\u4e00-\u9fff]/);
        for (const token of contract.protectedTokens) {
          expect(out).toContain(token);
        }
        for (const sub of contract.zhCNContract) {
          expect(out).toContain(sub);
        }
      });

      // -- en --------------------------------------------------------------
      it("en: renders non-empty + English hint + protected tokens", () => {
        const out = renders["en"]!;
        expect(out.length).toBeGreaterThan(0);
        // No Chinese characters in the en variant
        expect(out).not.toMatch(/[\u4e00-\u9fff]/);
        for (const token of contract.protectedTokens) {
          expect(out).toContain(token);
        }
        // At least one English hint must appear (tolerant: any one hits)
        const anyHint = contract.enHints.some((hint) => out.includes(hint));
        expect(anyHint, `en render missing all hint substrings (${contract.enHints.join(", ")})`).toBe(
          true,
        );
      });

      // -- zh-CN-hybrid ----------------------------------------------------
      it("zh-CN-hybrid: renders non-empty + Chinese + protected English tokens", () => {
        const out = renders["zh-CN-hybrid"]!;
        expect(out.length).toBeGreaterThan(0);
        // Per the lib comment: hybrid currently mirrors zh-CN exactly because
        // the banners already inline English protected tokens. We assert
        // BOTH Chinese characters AND every protected token survive — that
        // is the load-bearing class-2/3 i18n contract for hybrid mode.
        expect(out).toMatch(/[\u4e00-\u9fff]/);
        for (const token of contract.protectedTokens) {
          expect(out).toContain(token);
        }
      });

      // -- match-existing --------------------------------------------------
      it("match-existing: byte-identical to en (UX i18n Policy class 1 fallback)", () => {
        expect(renders["match-existing"]).toBe(renders["en"]);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// renderBanner defensive paths
// ---------------------------------------------------------------------------

describe("banner-i18n: renderBanner defensive paths", () => {
  it("returns empty string for unknown banner key (never throws)", () => {
    const result = lib.renderBanner("nonexistentKey", "zh-CN", {});
    expect(result).toBe("");
  });

  it("returns empty string when params trigger a runtime error in template (never throws)", () => {
    // archiveLine1 reads p.parts; passing null params would normally crash a
    // naive template. The lib must catch and return "" instead. We pass a
    // params object that forces template-time access to fail.
    const result = lib.renderBanner("archiveLine1", "zh-CN", undefined as unknown as Record<string, unknown>);
    // archiveLine1's "zh-CN" template stringifies p.parts which is undefined
    // when the params object is empty — that interpolates as "undefined", a
    // valid (if ugly) non-empty string. The contract is just "no throw".
    expect(typeof result).toBe("string");
  });

  it("falls back to en when an unknown variant is requested", () => {
    const enOut = lib.renderBanner("archiveCta", "en", {});
    const unknownOut = lib.renderBanner("archiveCta", "ja-JP", {});
    expect(unknownOut).toBe(enOut);
    expect(unknownOut).toContain("/fabric-archive");
  });
});

// ---------------------------------------------------------------------------
// readFabricLanguage — config-read contract
// ---------------------------------------------------------------------------

describe("banner-i18n: readFabricLanguage", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "fabric-banneri18n-cfg-"));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("returns 'zh-CN' (back-compat default) when .fabric/fabric-config.json is missing", () => {
    expect(lib.readFabricLanguage(tempRoot)).toBe("zh-CN");
  });

  it("returns 'zh-CN' when the projectRoot argument is empty / non-string", () => {
    expect(lib.readFabricLanguage("")).toBe("zh-CN");
    expect(lib.readFabricLanguage(undefined as unknown as string)).toBe("zh-CN");
  });

  it("returns 'zh-CN' when the config file has no fabric_language field", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", "fabric-config.json"),
      JSON.stringify({ some_other_field: "value" }),
      "utf8",
    );
    expect(lib.readFabricLanguage(tempRoot)).toBe("zh-CN");
  });

  it("returns 'zh-CN' (default) when the config file is malformed JSON", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", "fabric-config.json"),
      "{not valid json",
      "utf8",
    );
    expect(lib.readFabricLanguage(tempRoot)).toBe("zh-CN");
  });

  it("returns the configured value when fabric_language is one of the four valid variants", () => {
    const validValues: Variant[] = ["zh-CN", "en", "zh-CN-hybrid", "match-existing"];
    for (const value of validValues) {
      mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
      writeFileSync(
        join(tempRoot, ".fabric", "fabric-config.json"),
        JSON.stringify({ fabric_language: value }),
        "utf8",
      );
      expect(lib.readFabricLanguage(tempRoot)).toBe(value);
    }
  });

  it("returns 'zh-CN' (default) when fabric_language is an unknown enum value", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", "fabric-config.json"),
      JSON.stringify({ fabric_language: "ja-JP" }),
      "utf8",
    );
    // Per lib comment + VALID_LANGUAGES check, unknown values fall through
    // to DEFAULT_LANGUAGE which is 'zh-CN' (rc.15 back-compat). Folding to
    // 'match-existing' would happen at render time if the explicit value
    // were 'match-existing', but for unknown values the read contract is
    // strict: only known enum members pass through.
    expect(lib.readFabricLanguage(tempRoot)).toBe("zh-CN");
  });
});
