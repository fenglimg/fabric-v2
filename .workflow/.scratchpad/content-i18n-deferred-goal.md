# 待办独立 goal — 内容层 i18n(content-layer i18n)

> 从 fallback-purge(20260612)ADJ-3 收口派生。用户拍「暂不动,立独立 goal 待办」(2026-06-12)。
> fallback-purge 已 6/6 gate 全绿达成,此项**不在其范围**(造新能力,非清兜底)。

## 背景:i18n 两层模型(普查结论)

- **UI 层(`t()` 路由的界面字符串)= 已完整 + 有闸**
  - 基建:`packages/shared/src/i18n/`(resolve-fabric-locale / detect-node-locale / create-translator / protected-tokens / locales/{en,zh-CN}.ts)。
  - **en = zh = 933 key 严格 parity**,由 `locale-parity.test.ts`(G-INVARIANT census 闸)强制。
  - 规范明确:走 t() → parity 守 → protected tokens 永不译。
- **内容层(作者撰写、写进 artifact、byte-稳定敏感)= 单语 zh-CN,无规范** ← 本 goal 要解决

## Scope(4 项)

1. **bootstrap-canonical.ts `BOOTSTRAP_CANONICAL`** — byte-locked zh-CN-hybrid AGENTS.md 模板。en 用户拿到中文 AGENTS.md。
   - 彻底解:双 canonical body(en/zh)+ doctor drift 检测**按 locale 选** body 比对 → **推翻 rc.19 byte-lock 单体契约**(这是核心设计变动,需重定 byte-lock 模型)。
2. **api-contracts.ts `PROPOSED_REASON_DESCRIPTIONS`** — 6 条 zh-CN 描述,写进**每个 pending 知识文件**的 `## Why proposed`。en 审稿者(fabric-review)看到中文。
   - 解:双语 + 按 fabric_language 渲染。注意"changing strings here changes every newly-written pending file"(byte-稳定敏感,同 bootstrap 性质)。
3. **顺带清失真文案行** — `BOOTSTRAP_CANONICAL` 里 `Backward compat: 解析器接受老 4-state tags (planned/recalled/chained-from)→applied` 现**失真**(vocab purge W3-1 已把 parser 改成 legacy→none)。重写 bootstrap 时一并修(改 byte-lock 快照 + drift fixture)。这行是 fallback-purge 唯一留下的 stale doc 债。
4. **立内容层 i18n 规范 + parity 闸** — 当前内容层无规则/无 spec/无闸(对照 UI 层的 t()+parity)。需明确:哪些"作者撰写内容"要按 locale 双体、protected tokens 边界、加内容层 parity 校验防漂移。

## 非缺口(已核,勿动)

- `archive-scan.ts NORMATIVE_KEYWORDS` — 已双语(`以后/下次/记一下/永远不要` + `always/never/from now on`),是**检测模式**非显示文案,完整。

## 触发信号

待真有英文用户 / 明确国际化需求时启动。零用户 clean-slate 阶段 ROI 低,故 defer。
