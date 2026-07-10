# UX-5 Skill auto-invoke trigger 准确度 dataset (F1 真值)

3 skill descriptions (auto-invoke 判据 = harness 把 description 喂给 LLM, LLM 决定是否触发):

- **fabric-archive**: 归档对话洞察到 .fabric/knowledge/pending (NOT code review). Triggers 以后/always/never/下次/记一下; wrong-turn-revert; decision-confirm; dismissal-reason; /fabric-archive.
- **fabric-review**: 审 .fabric/knowledge pending+canonical (NOT PR review): approve/reject/modify/revisit/defer。Triggers 审批/驳回/复审/重审/approve/reject/review pending.
- **fabric-import**: 冷启动从 git log + docs/*.md 回灌 .fabric/knowledge/pending (NOT code/data import). Triggers 导入历史/bootstrap fabric/mine changelog/挖掘 commit.

## Labeled set (ground truth)

| # | user message | expected | 说明 |
|---|---|---|---|
| P1 | 以后所有测试都别 mock 数据库 | archive | normative 以后 |
| P2 | 下次注意:改 schema 必须 rebuild dist | archive | normative 下次注意 |
| P3 | always run tsc --noEmit before release | archive | normative always |
| P4 | 记一下这个根因:premultiplyAlpha flag 反向 | archive | 记一下 |
| P5 | never commit .env files from now on | archive | never/from now on |
| P6 | 我先试了 path X, 不行, 改用 path Y 了 | archive | wrong-turn-revert |
| P7 | 审一下 pending 里那几条 | review | 审 pending |
| P8 | approve KT-DEC-0001, 驳回 KT-PIT-9101 | review | approve/驳回 |
| P9 | 复审一下 canonical 的几条 guideline | review | 复审 |
| P10 | review pending knowledge entries | review | review pending |
| P11 | 从 git log 导入历史知识到 fabric | import | 导入历史 |
| P12 | bootstrap fabric for this repo | import | bootstrap fabric |
| P13 | 挖掘 commit 历史回灌 KB | import | 挖掘 commit |
| P14 | mine the changelog for decisions | import | mine changelog |
| N1 | review my code for bugs | none | NOT code review (archive/review 都不该触发) |
| N2 | 帮我 review 一下这个 PR #123 | none | NOT PR review |
| N3 | import { foo } from './bar' | none | NOT code import |
| N4 | 导入这个 CSV 数据到数据库 | none | NOT data import |
| N5 | 帮我看下这段代码哪里有问题 | none | 纯 code 询问 |
| N6 | 重构一下这个函数 | none | 简单 refactor, 无 normative |
| N7 | 这个 bug 怎么修 | none | 纯询问 |
| N8 | 把这个文件导入到编辑器 | none | NOT code/data import (导入但非历史/KB) |

正样本 14 (archive 6 / review 4 / import 4), 负样本 8。共 22。

真值设计依据: 正样本覆盖每 skill description 的显式 Triggers 词; 负样本专打 description 的 "(NOT ...)" 消歧子句 (code review / PR review / code import / data import) + 无 normative 的纯操作请求。

## F1 评分方法

对每条消息, 判 (archive触发? review触发? import触发?)。
- 正样本: 命中 = 触发了 expected skill (且不误触发其他)。漏 = 未触发 expected。
- 负样本: 命中(TN) = 三个都不触发。误触发(FP) = 任一被触发。
- F1 = 2PR/(P+R), P=TP/(TP+FP), R=TP/(TP+FN)。把"该触发未触发"计 FN, "不该触发却触发"计 FP。

baseline (rc.32) F1=71%, floor 65%。

## 结果 (2 LLM 盲判, 零上下文)

- **Judge 1 (claude context-clean subagent, accc8cb5)**: 22/22 全对。14 TP / 0 FP / 0 FN / 8 TN。
- **Judge 2 (gemini, gem-141435-a140, 零上下文)**: 22/22 全对。同上。

两 LLM 完全一致。F1 = 2·14/(2·14+0+0) = **1.00 (100%)** ≥ target 71% (baseline rc.32 71%) → PASS 无回归, 远超 floor 65%。

显式 (NOT code review / NOT PR review / NOT code/data import) 消歧子句把全部 8 个易混负样本正确压制。

## 残留风险 (两 LLM 共同 flag → NEW-1 P3 defer 候选)
日常短触发词 (以后/always/review/导入) 在真实高频编码对话里**可能**被过触发, 当前靠 NOT 子句兜底。gemini 建议改复合限定词 (如 'review knowledge')。本 adversarial set 上 100% 未误触发, 故非 rc.38 blocker; 记 P3 polish, 走 defer review。
