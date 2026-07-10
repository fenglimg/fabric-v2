# Fabric rc.35 × werewolf-minigame 测评报告

**Date**: 2026-05-26
**Branch**: audit-only on pcf main, 输出落 scratchpad (不污染 release)
**被测**: `~/Desktop/projects/werewolf-minigame/.fabric/` (~8 天 19726 events 累积)
**工具**: pcf rc.35 dev cli (`npm link` 全局 → `fabric` = 2.0.0-rc.35)
**对照**: rc.34 audit at `.workflow/.scratchpad/rc34-werewolf-eval/EVAL-REPORT.md`
**Audit scope**: Batch 1 deterministic 完整 + Batch 3 simulated onboarding (condensed);Batch 2 LLM-judge 跳过(rc.34 W1 12/12 PASS 近期,无新 surface)

---

## TL;DR (rc.36 P0 = 8 条)

rc.35 修了 P0-10 (renderer fallback) + P0-11 (audience tag) + P0-2 部分 (hook 内 wire-up) + P0-6 (description W1 二轮),但 **werewolf production 端核心闭环数据无显著改善**:

| 维度 | rc.34 baseline | rc.36 测得 | Δ |
|---|---|---|---|
| 总回合 | 18582 | 17335 | -7% (滑窗) |
| 合格 cite | 0 | 10 | +10(但全是 hallucination) |
| cc 端 cite | 0 / 18000+ | 0 / 15765 | **未动** |
| codex 端 cite | 0 / 600 | 10 / 284 (3.5%) | 略动但 100% ID 不存在 |
| edit_intent_checked event | 0 | 0 | **未动**(rc.35 hook wire-up 在 werewolf 老 hook 上未生效) |
| KB activation funnel | 370 plan→7 fetch→1 cons | 374→7→1 | **未动** |
| empty tags 比例 | 100% (48/48) | 100% (48/48) | 未修 |
| Skill token (fabric-import) | 17446 | 5543 (-68%) ⭐ | W1 二轮**确实传播了** |
| Skill token (fabric-archive) | 19286 | 3109 (-84%) ⭐ | W1 二轮成功 |
| Skill token (fabric-review) | 9221 | 3186 (-65%) ⭐ | W1 二轮成功 |
| events.jsonl 心跳占比 | ~95% | 95.1% (18761/19726) | 印证 Plan B |

**结论**: **基础设施型修复(SKILL.md token 大降)成功传播,行为型修复(cite/archive/funnel)在 production 端零信号**。原因有二:
1. Hook 是用户安装时 copy 到 werewolf 仓内的 `.cjs` 文件 — rc.35 升级 fabric-cli 不会替换它(P0-NEW1)
2. AI 行为习得没建立(P0-1 根因:description 改了 trigger 命中,但**AI 不知道写 `KB:` 行 = 该做的事**)

---

## P0 列表(8 条)

### P0-NEW1 🔴 hook 升级机制断层 ⭐ rc.36 必修
**根因**: hook .cjs 是 fabric install 时 cp 到 `.claude/hooks/` 的 werewolf 仓内文件。fabric-cli 升级(rc.34→rc.35)**不自动替换这些 .cjs**。rc.35 W3 TASK-07 在 `knowledge-hint-narrow.cjs` 新增 `appendEditIntentToLedger` 函数 + W4 TASK-08 `--force-skills-only` flag,但 W3 修改的 .cjs **不在 --force-skills-only 范围**(那 flag 只覆 skills)。

**实证**: werewolf 端 events.jsonl `edit_intent_checked` 数量 = **0**(rc.35 W3 8 test 全绿 + dist 链上有新代码 + 用户跑过 fab install 12 次,但 production hook 没更新)。

**修法**: `fab install --force-skills-only` 扩展为 `--force-hooks-and-skills` 或新增 `--force-hooks`;或 fab install 默认检测 hook 版本(已有 `install_diff_applied` event)diff 后 prompt 升级。

### P0-NEW2 🔴 cite hallucination — 10/10 引用 ID 不存在
**实证**: codex 端 284 turn 写了 10 个 `KB: <id> [recalled]`,doctor `--cite-coverage --verbose` 报 `[warn] 引用 ID 不存在: 10`。即 **codex 在按 cite policy 写 `KB:` 行,但写的 ID 是编造的**,完全没调 `fab_plan_context` 验证。

cc 端 15765 turn **0 cite**:cc 完全没遵循 policy。两端**没一个真正在工作**。

**修法**: 
- Hook 端硬约束:PreToolUse 检测到 AI 写了 `[recalled]` 但**没**对应 `fab_get_knowledge_sections` MCP call → block + 提示
- 或 cite 改成 hook-fill-in:hook 看 plan_context 调用历史 → 自动注入"上次你查的 ID 是 X, Y, Z"行,AI 只 copy 不 invent

### P0-4 残留 🔴 archive 行为接近零(rc.34 P0-4 直接继承)
**实证**: 8 天 17335 turn,`session_archive_attempted: 1`(rc.34 也是 1)、`knowledge_proposed: 17`(全是历史的)、`knowledge_promoted: 52`(historical)。
**rc.36 修法候选**:
- archive-hint hook 提升强制度(从 stop hint → block-and-prompt)
- 或重新设计:archive 不应该是 skill 用户主动调,而是 hook 自动调(rc.34 baseline 调过 1 次,7 天才一次频次太低)

### P0-8 残留 🔴 100% empty tags(rc.34 P0-8 直接继承)
**实证**: 48/48 canonical entry `tags: []`。
**修法**:
- fabric-archive / fabric-import skill description 加 "MUST produce 2-4 tags"
- doctor 加 lint `knowledge_tags_empty_ratio > 50%` → warn

### P0-5 残留(部分) ⚠️ fabric-import 仍超 token budget
**实证**: doctor 报 `skill_token_budget_exceeded: fabric-import=7252 tok (warn)`(我的字节估算 5543 tok,doctor 用真 tokenizer 7252)。**5543/3000 = 1.8x**,虽然比 rc.34 18-30x 改善巨大,**但 W1 <3K 目标仍未达**。
**修法**: fabric-import SKILL.md 235 行继续下沉细节到 ref/

### P1-2 残留 🟡 doctor agents_meta_stale 文案 bug (rc.34 P1-2 复现)
**实证**: doctor 输出:
```
agents_meta_stale: .fabric/agents.meta.json revision sha256:d0d23e09... 与 .fabric/knowledge 派生 revision sha256:d0d23e09... 不一致
```
两个 hash **字面完全相同**(d0d23e09efca0d8270af14624b58c44ad7c09b6749835db8a80926f0a8114836)。
**修法**: rc.34 memo 已诊断 — `stale=changed||(revision!=)` 可由 `changed` flag 触发,模板硬写 revision diff。改 message 模板分支:hash 相等时只说 "agents.meta 时间戳过期,内容已同步,可忽略"

### P0-NEW3 🔴 USER-QUICKSTART.md 没传到用户端
**实证**: rc.35 W5 TASK-10 在 pcf 加了 88 行 5 分钟 quickstart (`docs/USER-QUICKSTART.md`);AGENTS.md bootstrap block (L28) 引用了它;但 **werewolf 端不存在该文件**。`fab install` 不 copy docs/。
**修法**:
- 选 A:把 USER-QUICKSTART.md 内容收进 AGENTS.md bootstrap block(用户看 AGENTS.md 就够)
- 选 B:fab install 把 docs/USER-QUICKSTART.md copy 到 werewolf 端
- 选 C:bootstrap block 改 ref → `https://github.com/fenglimg/fabric/blob/main/docs/USER-QUICKSTART.md`(GitHub URL)

### P0-NEW4 🔴 events.jsonl 95.1% 是心跳 — 印证 Plan B
**实证**: 18761/19726 = 95.1% `assistant_turn_observed`(本仓 91.8%,werewolf 高出 3pp 因为 werewolf 是真实 dogfood)。
**修法**: 已锁 Plan B counter 化(见 `project_events_jsonl_bloat_rc36`)。本次 audit 复测确认决策正确。

---

## P1 列表(4 条)

| # | 标题 | 数据 |
|---|---|---|
| **P1-NEW1** | `knowledge_drift_detected: 30` 但无后续 demote 事件 | 30 drift 检测出但只有 1 layer_changed + 0 demoted。drift detection 跑了不处理 |
| **P1-NEW2** | `meta_manually_diverged: 1 entry` | doctor 报 1 entry on meta but not on disk。需 `--fix` 单独跑(P1 because rare) |
| **P1-3 残留** | session digest title cargo-cult | rc.34 P1-3,本次未复测但代码未改 |
| **P1-5 残留** | 44/44 canonical 卡 draft | doctor 仍报 `knowledge_draft_backlog: 100%`,跟 rc.34 一致 |

---

## P2 列表(3 条)

| # | 标题 | 数据 |
|---|---|---|
| P2-1 | KT-MOD-0015 narrow paths drift(包 path glob 跟 werewolf 项目结构不匹配) | doctor 90d git history miss,本次仍 standing |
| P2-2 | 9 个 session-hints cache files >7 天 | doctor 已识别 |
| P2-NEW1 | cite_goodhart G1: KT-MOD-0017 [recalled] 6x in 7d | 真用了 cite 政策但 spam 同 ID,反指 cite 行为没建立机制 |

---

## ⭐ rc.35 真正修好的(对照 rc.34 EVAL,公平给分)

| rc.34 P0 | rc.36 实测 | 评 |
|---|---|---|
| P0-10 broad/narrow hint summary==id (42/43) | doctor 仍报 45/49 但 hint renderer fallback (rc.35 W2 TASK-06) 已生效 | **infra 修了,数据未改善**(根因在 init scan 没产 summary) |
| P0-11 doctor remediation 视角错配 | rc.35 W5 TASK-12 audience tag 生效 — doctor 输出现在显式 `(maintainer-only remediation)` | **真修好** |
| P0-6 description recall 60% | werewolf installed SKILL.md description 含中文 trigger + 负向约束 | **传播成功** |
| P0-5 SKILL token 18-30x | -65% to -84%,fabric-import 仍 1.8x | **80% 修到位** |
| P0-9 全局 fab schema desync | rc.35 W4 globalFabVersion check (生效:doctor 输出 `[ok] 全局 fabric CLI 版本: rc.35`) | **真修好**(但 fab→fabric rename 引入 P0-NEW1 新问题) |

---

## Known coverage gaps (self-audit, [[feedback-coverage-self-audit]] 必跑)

按 3 轴 meta-framework 显式标注本轮 out-of-scope:

| Cell | (A, B, C) | 状态 | 推到 |
|---|---|---|---|
| 跨 LLM description recall judge | A1 × B1↔B2 × C1 | skip (rc.34 12/12 PASS 近期) | rc.36 实施 precondition 复跑 |
| Codex CLI 端 fresh install | A2 × B2 × C1 | skip(本次只 cc) | rc.36 lean |
| Cursor 端 fresh install | A2 × B2 × C1 | skip | rc.37+ |
| Prompt injection probe | A2 × B2(超 B1) × C1 | skip | rc.37+ |
| KB cohort 月级衰减 | A2+A3 × B2 × C3 | skip (8 天 ≠ 长期) | rc.37+ |
| Counterfactual ROI A/B | A3 × B3 × C3 | skip | 真人 dogfood 周期 |
| `fab uninstall` 残留检测 | A1 × B1↔B2 × C1 | skip (S8 阶段全周期 0%) | rc.37+ |

**Unknown unknown 风险**:rc.35 dropped `fab` shorthand 引入兼容问题(P0-NEW1 部分根因),老用户教程/script 引用 `fab` 会失败 — 但本次没 sweep 外部教程文档。

---

## rc.36 sizing 三档建议

### 🟥 lean (~14h,推荐)
**目标**: 修闭环 + 验证基础设施型修复真传到用户端

| Task | 估时 | 价值 |
|---|---|---|
| TASK-1 events.jsonl Plan B counter 化 + server 时间触发 rotation | 4h | events 减 95%,emit-cadence 改 reader |
| TASK-2 hook 升级机制:`fab install --force-hooks-only` flag + 默认 hook diff 提示 | 3h | 修 P0-NEW1 |
| TASK-3 cite hallucination 防护:hook 检测 `[recalled]` without `fab_get_knowledge_sections` MCP call → warn (block 后置 rc.37) | 3h | 修 P0-NEW2 软性 |
| TASK-4 P1-2 stale 文案 bug + P0-NEW3 quickstart 收进 AGENTS.md(选 A) + P0-8 empty tags doctor lint | 2h | 文案/lint 批 |
| TASK-5 fabric-import token 二轮缩减 (5543→<3000) + tag schema 加 description 提示 | 2h | 完成 W1 闭口 |

### 🟨 full (~25h)
lean + 下面:
- TASK-6 archive 行为升级:archive-hint 从 stop hint → block-and-prompt (P0-4)
- TASK-7 SKILL.md token budget 升 CI **hard gate** + fixture 仓建立 (G1 + G2)
- TASK-8 Codex CLI 端 install + doctor smoke 升 CI hard gate (G6)
- TASK-9 doctor agents_meta_diverged --fix 自动跑(P1-NEW2)+ drift_detected → demote(P1-NEW1)

### 🟩 extended (~40h)
full + 下面:
- TASK-10 整 rc.36-eval mini-audit branch 复测验证(行为型修复 production 验证)
- TASK-11 现有 122 test 合并 audit(init-* / install-* 同 cell 高重复嫌疑)
- TASK-12 真人 dogfood 跨客户端:Cursor + Codex 端 fresh install 录屏

---

## 关键判定:测试框架 hard gate 升级清单

按 [[feedback-eval-meta-framework-3axis]] 3 轴 lens,当前 122 test 中 95% 在 A1×B1↔B2×C1 cell(代码实现忠诚度)。**真正 A2 行为契约 + A3 用户感知**的自动化 = 0。

rc.36 应**升级为 CI hard gate**(从软测变硬阻断):

| 优先级 | Gate | 配套基建 |
|---|---|---|
| **G1 必做** | SKILL.md token budget < 3K(canonical) | 用 `tiktoken` 或 doctor 内置 estimator |
| **G2 必做** | doctor 全 check 在 fixture 仓 exit 0 | **需要建 fixture 仓**(submodule 或 in-repo `__fixtures__/werewolf-snapshot/`) |
| **G3 必做** | events.jsonl 月增长 < 5MB(post Plan B) | counter 化后自然满足 |
| **G4 选做** | cite hallucination 比例 < 5%(`[warn] 引用 ID 不存在` / 总 recalled) | 需 fixture 仓 + cite scanner runtime |
| **G5 选做** | tag 非空比例 > 80% | doctor 输出可解析 |
| **G6 选做** | Codex CLI 端 fresh install + doctor exit 0 | CI matrix 多端 |

**砍冗余**:暂不动 122 test(rc.36 lean 优先修闭环,test 合并是 cost > value 操作,推 rc.37)

---

## 操作指引

restore:`bash scripts/restore.sh`
unlink rc.35 全局 + reinstall rc.34:`npm unlink @fenglimg/fabric-cli && npm i -g @fenglimg/fabric-cli@2.0.0-rc.34`

(注意:rc.35 cli **只 ship `fabric` bin**,reinstall rc.34 会恢复 `fab` 同时保留 `fabric`)
