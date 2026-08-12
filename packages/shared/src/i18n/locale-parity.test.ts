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

  // -------------------------------------------------------------------------
  // W4 B5 — dead-key ratchet.
  //
  // 403 of 1265 keys (31.9%) were provably unreferenced: the whole v1.8
  // `dashboard.*` subsystem (201), the retired `--force-skills-only` /
  // `--force-hooks-only` install flags, and the `agents_meta` check that went
  // with the retired co-location index. Nothing failed while they sat there —
  // an unused key costs nothing at runtime, which is exactly why they piled up
  // for two minor lines. This ratchet is the only thing that notices.
  //
  // To change the count you must RE-RUN THE CENSUS, not just edit the number.
  // The census is not a checked-in script on purpose (the last one,
  // scripts/i18n-audit.mjs, rotted into a "not committed" one-off that duplicated
  // the parity test above): scan every file under the repo — every suffix,
  // including .cjs hook templates and installed .claude/.codex copies — for each
  // key, treating a key as ALIVE when a file `includes()` it literally OR it
  // matches a `${...}`-wildcarded template literal found in the source. Both
  // halves are required: `doctor.check.<code>.message.${singular}` and
  // `cli.config.fields.${key}.label` are built dynamically and a literal-only
  // scan reports 562 false deaths.
  // -------------------------------------------------------------------------
  // 2026-08-11 (W5 轴F): 862 → 865. Net +3 = four added (`cli.store.{backfill,
  // rescope,promote,reroot}.description`, routing the store migration commands'
  // hardcoded English through t() like every other store command) minus one
  // removed (`doctor.conflict.deep_no_judge`, orphaned when the empty
  // `audit conflicts --deep` flag was deleted). A fifth, `cli.store.link
  // .description`, was added and then removed in the same pass when the whole
  // `store link` command turned out to be dead on arrival and was deleted.
  // Census re-run per the note above: 10,011 files, 454 template patterns,
  // 0 provably dead.
  //
  // Re-running it caught a bug worth repeating here, because it is the natural
  // way to write the wildcard half and it is wrong: escape the key THEN
  // substitute `${...}` and you get `\[A-Za-z0-9_.-]+` — an escaped literal
  // bracket matching nothing — which reported 100+ live keys as dead. Split on
  // `${...}` first, escape each literal segment, then join with the wildcard.
  // 2026-08-12(合并 feat/sync-readme-version): 865 → 867。净 +2 = `cli.audit
  // .why.maturity-draft` 与其 `.hint`,G3「draft 的 guideline/model 不进
  // SessionStart 常驻层」给 `fabric audit why-not-surfaced` 补的那条归因分支;
  // 两个 key 的消费者都是 packages/cli/src/commands/audit.ts。
  // 按上面的规矩重跑了 census:1901 文件、175 个 template pattern、0 provably dead。
  //
  // ⚠️ 文件数比上一轮的 10,011 少了八千,不是漏扫 —— 差额是 W5 删掉的 `tmp/`
  // 下那 10 个 vendor 克隆(对照阅读用的别家仓库)。拿别的项目的源码给我们的
  // key 判「活」本来就是假阳性,少扫它们让判据更严而不是更松。
  it("key count matches the pinned census (bump ONLY after re-running the dead-key scan)", () => {
    expect(enKeys.length).toBe(867);
  });

  it("no key resurrects the deleted v1.8 dashboard namespace", () => {
    // The dashboard subsystem has no source left in the tree — 201 orphaned
    // strings were all that remained of it. A `dashboard.*` key reappearing
    // means someone is reviving a UI that does not exist.
    expect(enKeys.filter((k) => k.startsWith("dashboard."))).toEqual([]);
  });

  // Absorbed from scripts/i18n-audit.mjs check [3] before deleting it: an `en`
  // value containing CJK is an untranslated string that shipped to English
  // users. Its check [4] ("zh value byte-identical to en") was NOT absorbed —
  // 21 of those are intentional (protected tokens, format strings, proper
  // nouns), so as a gate it is pure churn.
  it("no en value carries untranslated CJK", () => {
    const INTENTIONAL_CJK = new Set([
      // Quotes the literal anti-trigger token a SKILL.md description must contain.
      "doctor.check.skill_description.remediation",
      // A language picker labels each language in its own script, by design.
      "cli.install.language.option.zh-CN",
    ]);
    const leaked = enKeys.filter(
      (k) => !INTENTIONAL_CJK.has(k) && /[一-鿿]/.test(enMessages[k]),
    );
    expect(leaked).toEqual([]);
  });
});
