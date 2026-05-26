# Fabric rc.34 × werewolf-minigame 测评报告

**Date**: 2026-05-26
**Branch**: 主线 (audit-only, 不 bump)
**被测**: `~/Desktop/projects/werewolf-minigame/.fabric/` (真实 8 天 46 session 19535 events long-running state)
**工具**: pcf dev cli v2.0.0-rc.34 (`node packages/cli/dist/index.js`)
**对照**: 全局安装 fab rc.30 (werewolf 真实运行版本)
**输出**: `.workflow/.scratchpad/rc34-werewolf-eval/`

---

## TL;DR (5 P0)

测评在真实长跑项目上抓到 **15 个 P0 + 9 个 P1 + 7 个 P2 = 31 个具体问题** (Batch 4-6 second-round 新增 P0-12/13 + P1-7 + P2-6/7; Batch 7 onboarding sim 新增 P0-14/15 + P1-8/9)。最关键的发现:

**整个 Fabric 自动闭环在生产用户端 90% 失效**, 因为:

1. **P0-9 全局 fab rc.30 与 werewolf agents.meta.json schema desync** → SessionStart / PreToolUse hooks **全部 silent exit**, AI 完全感知不到 KB 存在。rc.31+ 4 个版本的修复在用户端**完全没生效**。
2. **P0-1 cite policy 在真实长跑下 0% 遵循率** (rc.32 baseline 3.1%, 现在 werewolf 0%): 18582 turn 跨 8 天, 96.8% 无 cite, 3.2% 全是 `KB: none` placeholder, **零** `planned/recalled/chained-from`.
3. **P0-2 cite contract operator 完全无 production caller** — `appendLedgerEntry` 只在 test 用, production 0 emitter → `edits_touched` 永远 0, contract 验证形同虚设.
4. **P0-3 KB activation funnel 100% 漏失** — 370 plan_context call / 100% 最终 `final_stable_ids = 0` / 7 个 get_sections / 1 个 consumed.
5. **P0-6 SKILL.md description 在 werewolf 老安装下 recall 60%, 新版 100%** (Gemini 量化), 但 rc.34 W1 修复**没传播到 npm 安装的用户**.

**整体闭环图**:
```
新 dev 开 session → SessionStart hook 调全局 fab → schema 爆炸 silent
→ AI 不知 KB 存在 → SKILL description OLD → cite 不写 → archive 不调
→ pending 不审 → KB 越来越死 → 用户跑 doctor → 5/7 remediation 不可操作
→ 用户放弃
```

---

## 完整问题列表 (按 P0 → P1 → P2)

### P0 (11 个, 阻断核心闭环 / 数据风险 / 多 LLM 共识)

| # | 标题 | 根因 | 影响层 |
|---|---|---|---|
| **P0-1** | cite policy 在 werewolf 真实长跑下 0% 遵循 | description recall + 无正反馈 + AI 行为习得 | AI 行为 |
| **P0-2** | `edit_intent_checked` 在 production code 0 emitter, contract operator 验证结构性死亡 | `appendLedgerEntry` 没 wire 到 hook / MCP / cite tracker | 基础设施 |
| **P0-3** | KB activation funnel 100% 漏失 (370 plan → 0 final selection) | description low recall + opaque summary + AI 行为 | 闭环 |
| **P0-4** | Archive 行为接近零 (46 session / 8 天 / 1 archive_attempt) | SKILL description + AI 习得 + 用户感知不足 | 闭环 |
| **P0-5** | Skill token budget 严重超标 (archive 19286 / import 17446 / review 9221) | W1 修复未传播 + werewolf 老安装 | host 端召回 |
| **P0-6** | SKILL.md description recall 60% vs 100% (OLD vs NEW), 含 fabric-import 误触 git history 查询的污染 (Gemini 量化) | rc.34 W1 修复未传播 + 老 description 缺中文 trigger + 无负向约束 | host 端召回 |
| **P0-7** | 48 entry 全部由单次 fabric-import 产出, 13 天工作流贡献 1 pending / 0 canonical | P0-4 + P0-6 复合, 真实流量为 0 | KB 增长 |
| **P0-8** | 100% entry empty tags `[]`, 主题聚类完全失效 | fabric-import / fabric-archive 不产 tags + doctor 不 lint | 可发现性 |
| **P0-9** | 全局 fab rc.30 与 werewolf agents.meta.json schema desync → hook 完全 silent | rc.31 z.preprocess fix 未发布到用户全局 + hook 调全局 PATH | 整个闭环 |
| **P0-10** | broad/narrow hint 输出 42/43 个 summary == id (opaque) → AI 无法选择 → 100% 全跳 | agents.meta.json schema 没强制非空 summary, init scan 没产 summary 字段 | discovery |
| **P0-11** | Doctor remediation 5/7 假设用户有 pcf 源码或读 AI 内部词汇 (G1-G5 等) | remediation 文案为 fabric maintainer 写的, 没区分 user vs maintainer 视角 | UX |

### P1 (6 个, 体验降级 / 长期维护)

| # | 标题 | 根因 |
|---|---|---|
| **P1-1** | Promote ledger invariant 历史失衡 (17 proposed < 48 promote_started, 31 缺口) | rc.31 才补 self-propose, 历史 31 个 approve 缺 propose 事件 (仅可观测性) |
| **P1-2** | Doctor agents_meta_stale 文案 bug (两个 hash 相等却报"不一致") | `stale=changed||(revision!=)` 可由 `changed` 触发, 模板硬写 revision diff |
| **P1-3** | Session digest 标题 cargo-cult 取首条 user message (含 AGENTS injection) | digest writer 直接 slice 首条 user message N 字符做 title, 没过滤 |
| **P1-4** | Edit-counter 在跑 (240 edit 跨 8 天) 但下游 cite/contract 0 → "hook 工作了" 假象 | 上游 hook 写到 .cache/edit-counter (本地), 不写 events.jsonl edit_intent_checked |
| **P1-5** | 100% canonical entry 卡 draft maturity (44/44, rc.32 baseline 92%) | fabric-review 调用频率低 + skill description 老版本 |
| **P1-6** | Codex delegate 多步任务下 stream stale 600s, 跨 LLM 协作 codex 路径不稳 | codex CLI 不返回中间 grep/read tool 结果给 stdout 管道 |

### P2 (5 个, cosmetic / 噪音)

| # | 标题 | 影响 |
|---|---|---|
| **P2-1** | KT-MOD-0015 (`packages/**/package.json`) 与 werewolf 项目类型不匹配 | doctor 90d git history miss; init scan 误产, 可 reject |
| **P2-2** | 9 个 session-hints cache 文件 >7 天 (doctor 已识别, 手工删) | 可改 auto-prune |
| **P2-3** | Cite goodhart G5: 15 placeholder "KB: none" in 7d | 已小, sentinel 拆分已生效 |
| **P2-4** | 48 entry 全 KT (team), 0 KP (personal) | personal layer feature 未被发现/使用 |
| **P2-5** | KB entry 内容质量 6 分 (能用不深, fabric-import 出来的格式僵化) | 修不是优先级, 拉流量 (P0-4) 优先 |

---

## Sizing 三档建议

### 🟥 lean (P0 only — 推荐 rc.35 默认)
**目标**: 拯救核心闭环, 让生产用户跑通最基本流程

修复列表 (~8 task):
- **rc.35 release blocker**: P0-9 — release notes 明确告诉用户必须升级 fab; 加 doctor lint `globalFabVersion < installedSchemaVersion`
- P0-5 + P0-6: rerun `fab install` 在 werewolf 端落地新 SKILL.md (用户做) — 但 fabric 端要出 `fab install --force-skills-only` 命令降摩擦
- P0-2: appendLedgerEntry 接 hook → 单 patch, hook 写 events.jsonl 而不只是 edit-counter (option A from Batch 1 Codex 任务)
- P0-10: doctor 加 lint `summary_eq_id`; renderer fallback 读 .md ## Summary
- P0-11: remediation 文案改写, 区分 user-action vs maintainer-action

**Cost 估**: ~15-20h (1 sprint), 不动核心 schema

### 🟨 full (P0 + P1 — 完整打磨期)
**额外**:
- P0-1 + P0-3 + P0-4 + P0-7 共同根因: skill description recall + AI behavior 习得 — 跟 rc.34 W1 同范式做 W4 二轮 (extended SKILL.md + few-shot examples)
- P1-2 文案 bug 修
- P1-3 session digest title generator 改 — 跳过 AGENTS injection
- P1-6 跨 LLM 协作: codex prompt 模板拆小 step

**Cost 估**: +10-15h, ~30h total

### 🟩 extended (+ P2 + 体系级)
**额外**:
- P0-8: tag schema 设计 + AI 产 tags (新功能, 不是 fix)
- P1-1 + P1-5: ledger backfill script
- P2-1 / P2-4 / P0-7 联动: 第二次 fabric-import 拉新增 git history (5-13 → 5-26)

**Cost 估**: +15-20h, ~50h total

---

## Batch 3 真人 dogfood checklist (推下个周期 H1-H4 真人版)

跑过本次 simulated, 给真人版准备的 checklist:

1. **H1 — 新 dev fresh install**:
   - 新机器装 `npm install -g @fenglimg/fabric-cli@rc.34` 后跑 `fabric install` 在 werewolf
   - 录第一次 SessionStart 看 broad hint 输出 (P0-9 修后)
   - 观察用户能否在 60 秒内回答 "这项目有什么 KB"

2. **H2 — Real edit dogfood**:
   - 让 AI 改 SpyGameSoundUtil.ts (跟 audio bug 相关)
   - 看 narrow hint 给出哪些 entry; AI 是否 fetch; AI 是否 cite
   - 30 min 工作量内的 cite 率 baseline

3. **H3 — Normative archive dogfood**:
   - 真人对 AI 说 "以后这种 audio 都先存全局 settings"
   - 录看 AI 是否触发 fabric-archive; 用户看到 archive prompt 后是否 confirm/reject; pending 是否落地
   - 重点: trigger marker 行是否真的出现, Phase 1.5 是否路由对

4. **H4 — Doctor remediation dogfood**:
   - 真人跑 `fab doctor` 在装 rc.35 后的 werewolf
   - 对每个 issue 自检 "我能直接做这事吗"; 不能则记 friction

---

## 反 pattern 防护已落 (本次 audit 自身合规)

- [x] Snapshot 在跑命令前完成 (`evidence/{werewolf,home}-fabric-pre.tar.gz`)
- [x] Batch 严格顺序 0 → 1 → 2 → 3 → 汇总
- [x] 跨 LLM ≥2 家 (Gemini 第二次成功 + Claude 内联; Codex 失败但记录原因)
- [x] EVAL-REPORT.md TL;DR ≤ 5 P0 (本文档前 5 个 P0 总结)
- [ ] **结束前 restore + forensic diff** (下一步执行)

---

## 已知 audit 局限 (self-audit 后追加 Batch 4-6 闭口)

**Batch 1-3 局限**:
- ❌ 没跑 `fab doctor --fix` (auditor 不动状态)
- ❌ Codex 视角缺失 (stream stale), cite infra audit 由 Claude 内联代替 — depth 受限
- ❌ 没真人 onboarding 录屏 — 全 simulated

**Batch 4-6 已补 (本次第二轮)**:
- ✓ Performance baseline (doctor 4.4s + plan-context 0.4s)
- ✓ Cross-client consistency (3 端 byte-identical, .cursor 走 .mdc)
- ✓ Security/PII (events.jsonl 当前 0 真泄, 但缺 sanitization 兜底)
- ✓ AI 决策视角 (Claude self-audit, P0-12 抓到 ritual vs useful action 根因)
- ✓ Mental model 复杂度 (P0-13 抓到 7-layer 学习曲线, AGENTS.md 缺 onboarding-shaped)

**仍未真测 (推真人 dogfood / rc.36+)**:
- ❌ 真跑 fab install 空目录全流程 + 升级路径 (B4.3 只看了 --help)
- ❌ 真 disaster (corrupt agents.meta / events.jsonl partial / .md frontmatter 损) → doctor --fix 行为 (B6.2 只 inspect 结构)
- ❌ Concurrent session (2 个 Claude 同时 archive 是否冲突) — out-of-scope
- ❌ Git merge (.fabric/agents.meta.json 跨 branch 冲突处理) — out-of-scope
- ❌ Personal layer (KP-*) 价值证明 — out-of-scope (0 使用就是答案?)

**新发现 (Batch 4-6 增量)**:
- P0-12 — Cite/archive 是 maintenance ritual 而非 useful action, 框架设计层根因
- P0-13 — Mental model 7-layer 远超 30 min 学习曲线
- P1-7 — `fab doctor` 4.4s 偏慢, 缺 --quick mode
- P2-6 — fabric-init 是废弃 skill 漂流物 (用户确认), fab install 缺 deprecation cleanup 路径
- P2-7 — events.jsonl 当前 PII safe by accident, 缺 sanitization 防未来 schema 变更

**新发现 (Batch 7 onboarding sim 增量)**:
- P0-14 — 30 min 学习曲线实测 4 个 cognitive cliff (T8 doctor JSON / T22 价值感知 2/10 / T24 SKILL 致命 / T30 mental model 0 掌握); 估算 30% Wang T8 放弃, 50% T24 放弃, 只 5% 撑到能主动用
- P0-15 — 缺 `docs/USER-QUICKSTART.md` (5 行核心 + 流程图), AGENTS.md 是 AI 指令不是 dev onboarding
- P1-8 — `fabric` vs `fab` binary 命名不一致 (AGENTS.md 写 fabric, 实装 fab)
- P1-9 — `.fabric/AGENTS.md` 误受众 (Phase 0.4 / E3 / Goodhart G1-G5 AI internal 术语污染 dev-facing 文档)

完整数据见 `batches/T4-coverage-gaps.md` + `T7-onboarding-sim.md`. 总覆盖度从 70% → **90%** (Batch 7 把 dev onboarding 这个最贵 gap 闭口). 剩 10% 是工程兜底 + time-locked C3 长期 + 真用户分布, 推 rc.35+ + 自然演化.

---

## 下一步用户决策

请从 3 档 sizing 选: lean / full / extended → 我开 rc.35 plan

或: 先看本报告, 不开 rc.35 改单点 fix(像 P0-9 release blocker 这种)
