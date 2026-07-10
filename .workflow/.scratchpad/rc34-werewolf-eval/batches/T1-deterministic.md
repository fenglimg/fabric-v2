# Batch 1: Deterministic Findings (werewolf-minigame, pcf rc.34 dev cli)

被测: `~/Desktop/projects/werewolf-minigame/.fabric/` (8 天真实长跑, 46 sessions, 19535 events, 240 user edits)

---

## P0-1 — Cite policy 在真实长跑下 0% 遵循 (远低于 rc.32 baseline 3.1%)

**数据**:
- 18582 `assistant_turn_observed` events 跨 8 天
- 96.8% (17996) 完全无 `kb_line_raw` (AI 根本没写 KB: line)
- 3.2% (586) 有 cite tag → **全部** 是 `["none"]` (qualifying cite=0)
- 0 个 `planned`/`recalled`/`chained-from` cite
- 0 个 `KB: planned` / `KB: recalled` / `KB: chained-from`

**Why**:
1. `KB:` line policy SKILL.md / AGENTS.md 描述 ≠ 真实 AI 行为习得; auto-invoke 没强信号; description recall 还不够
2. AI 在做完动作 (Edit/Write) 后不主动回写 cite line
3. 240 edits 跨 8 天, 但 `edit_intent_checked` event = 0 (见 P0-2)

**Impact**:
- `fab doctor --cite-coverage` 永远显示 0% — 用户拿不到 contract validation 信号
- 整个 cite policy infrastructure (recall verification / dismissed reason / contract operator) **结构性死亡**

---

## P0-2 — `edit_intent_checked` event 在 production 代码路径上完全无 emitter

**数据**:
- `appendLedgerEntry` (`packages/server/src/services/read-ledger.ts:92`) 是**唯一**写 `edit_intent_checked` 的地方
- `grep -rn 'appendLedgerEntry' packages/ | grep -v test` 在 production code 0 caller
- 18582 turn / 240 edit-counter event / 0 edit_intent_checked

**Why**:
- read-ledger.ts:75 注释明确写到 "writeLedger from API" 但 API events.ts 只读不写
- 历史: rc.20 设计了 cite contract operators (require/forbid/edit), 但缺写入端 wire-up
- hook (knowledge-hint-narrow.cjs) 在 PreToolUse:Edit|Write|MultiEdit 触发 → 写到 edit-counter cache, 但**不**写到 events.jsonl

**Impact**:
- `doctor.ts:7307` editsTouched 永远 = 0
- contract operator (`→ edit:<glob>` / `require:<symbol>`) 验证完全失效
- "缺契约 0" / "已附契约 0" 不是因为合规, 而是因为没东西可统计

---

## P0-3 — KB activation funnel 漏到 0% (370 plan_context → 0 final selection)

**数据**:
- 370 `knowledge_context_planned` events (hook 正确触发 plan_context)
- 平均 ai_selectable = 3.3 个 KB 候选 / call
- **final_stable_ids 平均 = 0, 100% (370/370) call 最终选 0 个 KB**
- 只 7 个 `knowledge_sections_fetched` (1.9% 转化)
- 1 个 `knowledge_consumed`

**Why**:
- AI 看到 hook 推的 `ai_selectable_stable_ids` 但**不**真的选 → 没调 `get_knowledge_sections`
- 跟 P0-1 同根: cite policy 不 work → AI 没动力去 fetch 内容

**Impact**:
- KB discovery → recall → cite 整个闭环 0% 转化
- 48 entry 知识库等于摆设
- 用户 + AI 都看不到知识价值

---

## P0-4 — Archive 行为接近零 (46 session / 8 天 → 1 archive attempt)

**数据**:
- 46 sessions, 8 天活跃
- 1 个 `session_archive_attempted` event
- 17 个 `knowledge_proposed` (推测来自非 self-archive 路径, 如 user 手工 + import)
- archive_attempts / total_sessions = 2.2%
- archive-hint-shown.json 显示 review hint 1 次 / archive hint 1 次 (累计)

**Why**:
- Self-archive policy SKILL.md 触发条件 (normative / wrong-turn / decision) 太罕见
- Stop hook 即使弹 hint, AI 也不主动调 `fabric-archive`
- 用户对 archive 价值感知不足 (3 次 reject 表明: 跑了 archive 也常被 dismiss)

**Impact**:
- 48 KB entry 增长接近停滞 (8 天只 17 proposed)
- 长期 KB 容量 vs 项目复杂度脱节
- 与 rc.32 cohort decay 推荐 (rc.35 不实施) 矛盾: cohort 衰减不是因为旧 entry 过期, 而是新 entry 几乎不产

---

## P0-5 — Skill description quality + token budget 严重超标 (W1 未在 werewolf 端落地)

**数据** (doctor 报告):
- `fabric-archive` SKILL.md: 19286 tok (W3 lint 警戒线 9K, 超标 2.1x)
- `fabric-import`: 17446 tok (超标 1.9x)
- `fabric-review`: 9221 tok (warn)
- 3 个 description **同时** too_long (>60 tok) + no_cjk (无中文 trigger 词)

**Why**:
- W1 SKILL.md 重构是 pcf rc.34 才做的, werewolf `.codex/skills/` `.claude/skills/` 没跑 `fab install` 更新
- 即 werewolf 是 rc.30 时代安装的 skill, 描述还是老版超长英文版

**Impact**:
- description recall 在 werewolf 端依然 <50% (W1 二轮 100% PASS 是在 pcf 上量的)
- 与 P0-1 / P0-4 形成正反馈: skill 召不出 → AI 不调 → cite 不写 → archive 不触

---

## P1-1 — Promote ledger invariant 历史失衡 (17 proposed < 48 promote_started)

**数据**: 31 缺口
**Why**: rc.31 才补的 review.approve → propose 自调; 历史 31 个 approve 没经过 propose
**Impact**: 仅可观测性, 不影响 KB 功能; rc.31+ 新 approve 不再增加缺口

---

## P1-2 — Doctor `agents_meta_stale` 文案 bug (两个 hash 显示相等却报"不一致")

**数据** (doctor 输出原文):
```
.fabric/agents.meta.json revision sha256:d0d2...4836 与 .fabric/knowledge 派生 revision sha256:d0d2...4836 不一致
```
两个 sha256 字符串完全相同。

**Root cause** (`doctor.ts:2126`):
```ts
stale: changed || (built !== null && meta.revision !== built.meta.revision)
```
`stale=true` 可来自 `changed` 标志 (buildKnowledgeMeta 内部检测到 diff), 即使最终 revision 相等。但文案模板 `doctor.check.agents_meta.message.stale` 硬写"X 与 Y 不一致", 两个值实际相等时仍渲染此句。

**Impact**: 用户看到误导信息, 跑 `--fix` 又确实有效 (reconcile happens), 但报告解释错。

---

## P1-3 — Session digest 标题直接取首条 user message (cargo-cult)

**数据**: session-digest `.md` 首行示例:
```
# # AGENTS.md instructions for /Users/wepie/Desktop/projects/werewolf-minigame <IN
```
这是 Codex 注入的 AGENTS.md 第一条消息 verbatim, 被原样当 title.

**Why**: digest writer 直接 slice 首条 user message 前 N 字符做标题, 没过滤 system/AGENTS injection.

**Impact**:
- 39 个 session-digest 中大部分标题无意义 (`# # AGENTS.md ...` / `# Codex Code Guidelines` / `# <environment_context>`)
- 给 fabric-archive 提供的 source_sessions context 也包含这些噪音

---

## P1-4 — Edit-counter 路径分布证伪 hook 工作正常 (但下游 cite=0)

**数据**:
- 240 edit events 跨 8 天, 78.8% game code (assets/), 15% .workflow/, 4.2% .fabric/, 1.7% other
- 即真用户在改真业务代码

**对照**: P0-1 / P0-2 / P0-3 — 上游 hook 全在跑, 下游 AI cite/select 行为 0

**结论**: 不是 hook bug, 是 AI 行为习得 + skill description recall 没到位

---

## P1-5 — 100% canonical entry 卡在 draft maturity (44/44, rc.32 baseline 92%)

**Why**: 自从 maturity ladder (draft → verified → proven) 引入, archive 产 draft 但 review 接 promote 断流。`/fabric-review` skill 几乎没被调用.

**Impact**: 长期 KB 没有 "经过验证" 标签, AI 拉 KB 时无法识别质量信号.

---

## P2-1 — KT-MOD-0015 ("module-structure", glob `packages/**/package.json`) 与 werewolf 项目不匹配

werewolf 是 Cocos 游戏没有 `packages/` 目录, 但仍 90d git history miss. 该 entry 是 init scan template 误产, 可 reject.

## P2-2 — 9 个 session-hints cache 文件超过 7 天 (doctor 报)

doctor 已正确识别, remediation 是手工删. 可改成 auto-prune.

## P2-3 — Cite goodhart G5: 15 placeholder "KB: none" / "[unspecified]" in 7d

G5 触发但 7d 数据只有 15 个, 比 rc.32 量小. 已有 sentinel 拆分 (no-relevant=89 / not-applicable=321) 量大. AI 在用 sentinel, 但 unspecified 还有 15 个 (近期回归?).

## P2-4 — 48 entry 全 KT (team) 0 KP (personal)

werewolf 用户从未用 personal layer. 不一定是 bug, 但说明 personal layer feature 未被发现/使用.

---

## 出 Batch 1 时的环境快照

- 工具: pcf dev cli v2.0.0-rc.34 (`node packages/cli/dist/index.js`)
- 全局 fab: rc.30 (与 dev cli 差 4 个 rc, 不影响 audit 因为本次用 dev)
- werewolf HEAD: `700dc09` (release/act-0601-sweet-childhood), 4 个 pre-existing modified 文件不动
- snapshot: `evidence/{werewolf,home}-fabric-pre.tar.gz` + filelist 128 files

## Out-of-Batch-1

- Doctor `--fix` 没跑 (auditor 不动状态)
- AI 行为 root cause (skill recall / description) 推到 Batch 2 LLM-judge
- 真人 onboarding / archive UX 推到 Batch 3
