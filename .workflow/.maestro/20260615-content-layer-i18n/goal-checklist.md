# Goal A: bootstrap 文案修复 + 内容层 i18n (mode③)

> status.json 是真源, 本文件是投影视图。分支 `feat/content-layer-i18n` (off main 9ad706d)。
> 终止判据: 4 扇命名 ship gate 全绿 → 自动 completed。

## 大白话: 在干什么 / 解决什么痛点

Fabric 安装时会往项目写一份给 AI 看的规则文件 (`.fabric/AGENTS.md`), 还会在每条待审知识里写一句"为什么提议归档"。这两处正文**现在永远是中文**, 哪怕用户把机器语言设成英文 —— 英文用户拿到一坨看不懂的中文。本 goal 让这两处正文跟着用户选的语言走 (en/zh 双语), 顺带先修一行过期的规则文案。

## Ship Gate (全绿即达成) — ✅ 全部达成 (2026-06-15)

- [x] **G-ADJ3** — 文案修复收口
  - [x] A1 bootstrap L127 对齐 parser clean-slate
  - [x] A2 修 bootstrap-canonical.test.ts 断言旧文案 → Clean-slate
  - [x] A3 丢弃 stash en2 孤儿快照 (F1: brief 前提被实证推翻, HEAD 快照本就 CI-clean)
  - [x] A4 resync 本仓 AGENTS.md (cp ZH canonical + runDoctorFix L2; doctor 全 ok)
- [x] **G-DUALBODY** — 双语能力
  - [x] B1 BOOTSTRAP_CANONICAL 拆 _EN/_ZH + BY_LOCALE + resolver/match helper
  - [x] B2 PROPOSED_REASON 拆 en/zh BY_LOCALE map
  - [x] B3 writer 侧 (install + doctor --fix) 路由 resolveGlobalLocale
  - [x] B4 drift 比对侧 (bootstrap-lints 容双 locale + cite-coverage 复用) 路由
  - [x] B5 extract-knowledge ## Why proposed 路由
- [x] **G-PARITY** — 结构对齐闸 + 语言切换边界
  - [x] C1 en↔zh parity census (bootstrap-parity.test.ts 9绿: H2数+protected token)
  - [x] C2 语言切换 drift 容忍 (inspectL1 matchBootstrapCanonicalLocale + 回归测试)
- [x] **G-GREEN** — tsc -r 0 error + shared637/server687/cli1048 单跑全绿 0 skip

> 注: `pnpm -r test` 并发跑偶发瞬时失败 (timing-sensitive store/recall + 跨包 FABRIC_HOME 竞争); per-package 单跑为权威结果, 全绿。

## 5 消费点 (G-DUALBODY 接线清单)

| # | 文件 | 当前 | 改后 |
|---|---|---|---|
| 1 | cli/install/write-bootstrap-snapshot.ts | import BOOTSTRAP_CANONICAL | resolveGlobalLocale 挑体 |
| 2 | server/doctor.ts:919 (runDoctorFix) | 写 BOOTSTRAP_CANONICAL | 挑体 |
| 3 | server/doctor-bootstrap-lints.ts inspectL1/L2 | 比对 BOOTSTRAP_CANONICAL | 挑体 (容双 locale) |
| 4 | server/doctor-cite-coverage.ts activation | 比对 BOOTSTRAP_CANONICAL | 挑体 |
| 5 | server/extract-knowledge.ts:773 | PROPOSED_REASON_DESCRIPTIONS[r] | 按 locale 挑 map |

## 铁律

- 改 shared **必 rebuild dist** (`pnpm --filter @fenglimg/fabric-shared build`)。
- BOOTSTRAP_CANONICAL / PROPOSED_REASON byte-稳定敏感, 改后跑 byte-lock + install 测试。
- 快照 -u 前肉眼 diff, 不掩盖真 mismatch。
- protected token / 命令名 / marker 字面量 / 路由 key 保英文 (KT-GLD-0002)。
- 语言流向唯一源 resolveGlobalLocale, 勿自建。

## Resume

续跑: `/goal-mode continue` —— 取下一个 open task, 跑 verification, 原子更新 status.json, 重检 4 gate。
