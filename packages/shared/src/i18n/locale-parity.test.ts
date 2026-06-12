import { describe, expect, it } from "vitest";

import { enMessages } from "./locales/en.js";
import { zhCNMessages } from "./locales/zh-CN.js";

// ---------------------------------------------------------------------------
// i18n census invariant — locale key parity (fallback-purge Wave 0, G-INVARIANT)
//
// The translator resolves `active[key] ?? en[key] ?? key`, so a missing key is
// SILENT: a key present only in en degrades zh-CN users to English; a key
// present only in zh-CN shows en users the raw key literal. Neither path
// errors, so a literal grep (or a forgotten key during a copy-paste) rots the
// UI without any test catching it. This census asserts the two locale tables
// are key-for-key identical at the data level — the deterministic gate that
// replaces ad-hoc grep parity checks.
// ---------------------------------------------------------------------------

describe("i18n locale parity census", () => {
  const enKeys = Object.keys(enMessages).sort();
  const zhKeys = Object.keys(zhCNMessages).sort();

  it("en and zh-CN expose an identical key set (no silent fallback / raw-key leak)", () => {
    const enOnly = enKeys.filter((k) => !(k in zhCNMessages));
    const zhOnly = zhKeys.filter((k) => !(k in enMessages));

    // Named assertions so a drift report points at the offending keys directly.
    expect({ missingInZh: enOnly, missingInEn: zhOnly }).toEqual({
      missingInZh: [],
      missingInEn: [],
    });
  });

  it("every message value is a non-empty string in both locales", () => {
    const emptyEn = enKeys.filter((k) => typeof enMessages[k] !== "string" || enMessages[k].length === 0);
    const emptyZh = zhKeys.filter((k) => typeof zhCNMessages[k] !== "string" || zhCNMessages[k].length === 0);

    expect({ emptyEn, emptyZh }).toEqual({ emptyEn: [], emptyZh: [] });
  });
});
