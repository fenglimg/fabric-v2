# v2.0.0 GA UX Audit — Algorithms / Policy Paper Verdict (Phase 4 / C2)

**Date**: 2026-05-27
**Scope**: Inventory G 表 9 项交互算法/policy
**Method**: code-based paper audit + 已有实测数据 ([[project-rc32-eval-milestone]] + werewolf [[project-rc31-tagged-local]])
**Verdict scale**: SHIP / NEEDS-N-POLISH / BLOCKER

---

## 1. Cite policy `KB: <id>` 首行规则

**位置**: `AGENTS.md` L52-83;hook: `cite-policy-evict.cjs` (242L) + `lib/cite-contract-reminder.cjs` (173L) + `lib/cite-line-parser.cjs` (152L)

**当前设计**:
- AI 做 edit/decide/propose plan 前,**回复首行**必须写 `KB: <id> (用法) [state]` 或 `KB: none [<reason>]`
- 多个 state:`planned` / `recalled` / `chained-from <id>` / `dismissed:<reason>`
- decisions/pitfalls 类引用要 contract:`→ edit:<glob> [...] !edit:<glob> require:<symbol> forbid:<symbol> skip:<reason>`
- `KB: none [<reason>]` sentinel:`no-relevant` / `not-applicable` / 裸 `none`(legacy)
- 稽核工具:`fabric doctor --cite-coverage`

**实测**(rc.32 milestone):
- **遵循率 3.1%** — 大部分 AI turn 没写 KB 首行
- rc.36 没有针对性 fix(只加了 archive+review nudge,enforcement 没补)

**Issues**:
- 高 cognitive load:每 turn 都要决定写 KB 还是 sentinel
- contract 语法 7 个 skip reason 枚举 + 4 operator,记忆负担大
- enforcement 在 PostToolUse 不在 PreEdit:**只能事后稽核,不能拦阻**
- `[recalled]` 必须两步调用验证 — 防 id 编造,但加重首行成本

**Verdict**: **NEEDS-2-POLISH**

**Recommendation**:
1. 简化首行规则:把 `[state]` 4 选 1 砍到 2 选 1(`recalled` / `none`),取消 `planned`/`chained-from`(low signal)
2. contract 强制范围收窄:只 decisions 类需要 contract,pitfalls 改成 optional
3. 首行 enforcement 升级:可以加 hook 在 PreToolUse Edit 时检查最近一 turn 是否含 `KB:` 行,缺则 warn(不阻断)
4. 3.1% 遵循率核心原因可能不是政策太重,而是 AI 容易忘 — 上面 #3 的 warn hook 是最直接刺激

---

## 2. Self-archive policy (4 触发信号 + anti-loop)

**位置**: `AGENTS.md` L18-50;识别 marker: `fabric-archive/ref/phase-1-5-onboard.md` L26

**当前设计**:
- 4 触发信号(由用户消息识别):Normative / Wrong-turn-revert / Decision-confirmation / Explicit dismissal
- 3 anti-loop:同 turn 最多 1 次 / 同 session 同 outcome 不重复 / Phase 2.5 viability gate 兜底
- 触发后 AI 在 turn 末尾输出 marker `self-archive policy triggered by signal: <X>` + 用户提示
- fabric-archive skill Phase 1.5 onboard 通过 substring match 识别 marker → 路由 E3_ai_self_trigger

**实测**(rc.32 milestone):
- fabric-archive recall 20% — **80% 该归档的没归档**;触发信号识别准确率不够

**Issues**:
- 4 触发信号在用户消息里识别 — AI 主观判断,实测漏召率高
- Marker text 协议复杂(verbatim substring) — fragile,AI 微改文案就识别失败
- 「Decision confirmation」最难判:用户在 weighing ≥2 选项后给 rationale,有时显式有时隐式
- session 内同 outcome 不重复 — 但 session 边界不清(Claude Code session vs Codex session vs Cursor session 切换时)

**Verdict**: **NEEDS-1-POLISH**

**Recommendation**:
1. 4 触发信号合并为 2 大类:**Normative**(显式动词)+ **Conscious-decision**(包含 wrong-turn / confirmation / dismissal,统一为「用户明确表达了不可推断的判断」)— 减少识别决策成本
2. Marker text 加正则容错(允许大小写 / 末尾标点)
3. Recall 提升:Phase 0.5 viability gate 改为更宽松默认,signals_hit=0 不再 hard fail 而是 warn-and-propose,让 AI 提议 candidate 给用户裁
4. 「20% recall」根因可能在 AI 不主动 trigger;upstream 加 hook 在 Stop 时 spot-check 最近 turn 是否有应触发信号未触发,nudge 一下

---

## 3. plan-context selectable filter ❌ BLOCKER

**位置**:
- `get-knowledge.ts:174-193 matchRuleNodes` — 主 filter
- `get-knowledge.ts:310-323 shouldLoadNodeForPath` — activation tier gate (`always` / `description` / `path` 三种)
- `get-knowledge.ts:252-271 classifyNode` — L1(selectable)/L2(required) 分类
- `plan-context.ts:474-481` — relevance_scope filter(broad 永远 pass,narrow 需要 relevance_paths anchor 匹配)

**当前设计**:
- 374 总 entry → 由 server 端**双层 filter** 削成 selectable 集
  - Layer 1:`activation.tier === "path"` → minimatch(requestedPath, scope_glob)
  - Layer 2:`relevance_scope === "narrow"` 且 `relevance_paths` 不空 → 必须 anchor 匹配
- L2 = required(强制载入);L1 = ai_selectable(给 LLM 选)
- 实测 werewolf:374 → 7 selectable → LLM 选 1

**Issues**: 见 [[no-server-side-kb-filter]] 已 lock 决策

**Verdict**: ❌ **BLOCKER for v2.0.0 GA**

**Recommendation** (Wave A1 已锁):
- 删 Layer 1/Layer 2 filter
- 返回所有 entry with description / id / scope / tags
- LLM 自选 `ai_selected_stable_ids`,server 直接接受(不做二次验证 except 防 id 编造的 set membership)
- 实施细节见 Task #9 + Wave A1

---

## 4. Recall verification (两步调用强制)

**位置**: `AGENTS.md` L8 + L46;MCP tool `fab_plan_context` → `fab_get_knowledge_sections`

**当前设计**:
- 用 KB 必须先 `fab_plan_context(paths)` 拿 `selection_token` + 候选
- 再 `fab_get_knowledge_sections({selection_token, ai_selected_stable_ids})` 拉全文
- selection_token TTL 5 分钟(`SELECTION_TOKEN_TTL_DEFAULT_MS`)
- `[recalled]` cite 必须紧跟两步调用 — 防 id 编造

**Issues**:
- TTL 5 分钟在长 session 频繁过期,AI 要重跑 plan_context;**用户视角是延迟,server 视角是 over-strict**
- 两步 API 增加 cognitive load;rc.32 cite 3.1% 中,可能有一部分是「想引但嫌两步麻烦,放弃了」
- 防 id 编造的核心机制是 selection_token + ai_selectable_stable_ids 集合校验,**TTL 不是核心防护**

**Verdict**: **NEEDS-1-POLISH**

**Recommendation**:
1. TTL 延长到 30 分钟(或干脆 disable TTL,token 失效靠 revision_hash 而非时间)
2. 单步 API 候选:`fab_recall(paths, ai_selected_stable_ids)` 合并两步,server 内部仍走 selection token,但暴露给 AI 是一次 call — 大幅降 cognitive load
3. 上面 #2 与 Wave A1「删 selectable filter」配合后,变成「列全候选 → 选 → 拉文」三步,合并后两步

---

## 5. Archive viability gate (Phase 0.5)

**位置**: `fabric-archive/SKILL.md` Phase 0.5(已加载)

**当前设计**:
- 8 archive signals:Normative / Wrong-turn / Long diagnostic / New dep / New pattern / Decision-confirmation / Dismissal-with-reason / Process formalization
- 4 anti-archive signals:Typo-only / Pure refactor / Narrow rename / Duplicate of canonical
- gate FAIL → 按 entry_point 分支:E1/E3/E5 silent-skip,E2/E4 显式失败 message

**Issues**:
- 8 signal × 4 anti 是 32 个判断组合,AI 在 LLM-based 实施时容易遗漏
- 「Long diagnostic loop > 15min」用 turn count 估时不准(用户慢节奏 vs 快节奏 turn 数差异大)
- 「Duplicate of canonical」需要 Glob 现有 knowledge/ — 但 SKILL.md 没强制 glob 步骤,AI 经常跳过
- E2/E4 displayed gate-FAIL message 用户看了不知道下一步怎么走(只说 "no signal",没说 "如需归档可显式说...")

**Verdict**: **NEEDS-2-POLISH**

**Recommendation**:
1. 8 signal → 合并/简化:Normative(显式) / Conscious-decision(包含 wrong-turn / confirmation / dismissal) / New-abstraction(包含 dep / pattern / process)三大类
2. 「Long diagnostic」改 absolute time(ms)而非 turn 数
3. 强制 Phase 0.5 跑前 Glob `knowledge/<type>/` 同 slug 候选 — 命中 ≥80% 相似度则归类 Duplicate
4. E2/E4 gate-FAIL message 末尾加「如确认归档请回复 `force-archive`」引导,可路由到 force-archive 路径

---

## 6. Archive layer classification(强 team / 强 personal / 默认 team)

**位置**: `fabric-archive/SKILL.md` Phase 1 layer heuristic 块(verbatim 中文锁定)

**当前设计**:
- 强 team:引用本项目代码 / 团队共识用语 / fabric-import 路径产物 / 业务领域 / 绑定本项目 pitfall
- 强 personal:第一人称偏好 / 跨项目通用 / 工具偏好 / 个人工作流
- 默认 team:安全偏置(错标 team 在 PR review 中会被发现,错标 personal 静默丢失)

**Issues**:
- 五条强 team 信号 vs 四条强 personal 信号,**实测分类很主观** — 比如「pnpm catalog 用法」是 team 还是 personal?
- 「默认 team」的偏置是对的,但实际归档时 AI 容易误标 personal(看到「我」就标),反而违背安全偏置
- 没有 cross-LLM 复核机制;rc.32 没专门测过分类准确率

**Verdict**: **NEEDS-1-POLISH**

**Recommendation**:
1. 简化为二元决策树:**含本项目路径 / 业务域 / `we/team` 用语 → team**;**显式个人偏好 + 跨项目通用 → personal**;**模糊 → team(安全偏置)**
2. fab_review approve 阶段加 layer reconfirmation step(让用户最终拍板,AI 标错可纠)
3. 加 doctor lint:`knowledge/personal/` 下 entry 引用本项目路径 → warn(很可能误标)

---

## 7. Archive slug naming (5 规则)

**位置**: `fabric-archive/SKILL.md` Phase 1 slug 块

**当前设计**:
- kebab-case lowercase + digits + hyphens
- 2-5 词
- 20-40 字符
- semantic core only(drop the/a/stuff/thing)
- unique within (type, layer) bucket,collision → 加 discriminating word(NOT counter)

**Issues**:
- 字符上限 40 在长 slug(`gemini-review-apply-exact-suggested-fix` = 40 字)上 borderline,AI 会被迫缩词
- 5 规则记得清,但实施时 unique check 需要 glob 现有 slug,**AI 经常跳过 unique check** → 后期 collision

**Verdict**: **NEEDS-1-POLISH**

**Recommendation**:
1. 字符上限放宽到 50(对长 multi-concept slug 友好)
2. server 端 fab_extract_knowledge tool **强制 collision check + 自动 disambiguate**(AI 提的 slug 冲突时,server 加 -2 / -alt 后缀并 return,而非 reject)— 当前是 server may sanitize,但没自动 disambiguate

---

## 8. relevance_paths derivation (Phase 1.5)

**位置**: `fabric-archive/SKILL.md` Phase 1.5(6-step algorithm)

**当前设计**(rc.5 single-signal: edit_paths only):
- Step 1 collect — edit/Write/MultiEdit tool_use file_path
- Step 2 dedupe
- Step 3 blacklist filter — `**/*.<ext>` 单文件 / repo-root single files / read-only paths
- Step 4 public-prefix generalize — depth ≤ 2, minGroupSize = 2
- Step 5 scope gate — broad → [],narrow → Step 4 结果
- Step 6 attach read-only evidence to body

**Issues**:
- **edit_paths single-signal** 限制太死:基于 conversation 决策(无 edit)的归档(本会话 9 条决策)derivation 出来的 relevance_paths 都是 [] 或不准确
- minGroupSize = 2 在 2 个文件刚好 group → 过早 generalize;大概率出现「关注点不一致的两文件被 glob 化」
- read-only paths 进 body Evidence — 但 plan-context 后续不会用 Evidence 做 activation 判断,**Evidence 是死信息**

**Verdict**: **NEEDS-1-POLISH**

**Recommendation**:
1. 加 conversation-based signal:user-mentioned paths(用户消息里出现的文件路径)+ read_paths(本 session 读过的)= 候选源
2. minGroupSize 升到 3(或 user-mentioned path 不参与 generalize)
3. 与 Wave A1 配合:relevance_paths 重要性下降(server 不再过滤),body Evidence 才是 LLM 看的 — 把 Evidence 升级为 frontmatter `evidence_paths: []`

---

## 9. Doctor remediation 文案 (35 check × zh/en)

**位置**: `packages/server/src/services/doctor.ts` (8734L) + `packages/shared/src/i18n/locales/{zh-CN,en}.ts`

**当前设计**:
- 每 check 有 title / description / remediation 三段
- rc.26 完成 35 check 双 locale snapshot + zh-CN remediation sweep
- doctor.ts L75-79:knowledge auto-fix 5 类 tag

**实测**(rc.32 milestone):
- **2 条 remediation 引导用户删 ledger** — 反例,会导致用户主动破坏 events.jsonl
- rc.36 TASK-07 doctor 文案 batch 修了一部分,但完整 sweep 没做

**Issues**:
- 35 check × 2 locale × 3 段(title/desc/remediation)= 210 个 string,**没系统化 review**
- remediation 文案质量参差:有的指明具体命令(`fab doctor --fix`),有的只描述问题不给路径
- 部分 remediation 触发 user 高危操作(删 ledger / 删 .fabric/)

**Verdict**: **NEEDS-3-POLISH**

**Recommendation**:
1. 系统 audit 35 × 2 = 70 个 remediation 文案,产出 `remediation-audit.md` 列出每 check 的 verdict
2. 删/重写所有「引导删 ledger」/ 「引导删 .fabric/」类文案 — 高危操作必须显式 `--force-` flag
3. 每 remediation 必须含:(1) 一句问题诊断 (2) 具体命令或路径 (3) 可选的 manual fallback
4. 加 doctor lint:`remediation` 字段长度 < 30 字符 / 不含命令 → warn(quality lint)

---

## Summary Verdict Matrix

| # | 算法/policy | Verdict | Wave 归属 |
|---|---|---|---|
| 1 | Cite policy 首行规则 | **NEEDS-2-POLISH** | Wave D 或 E (政策简化 + 文案重写) |
| 2 | Self-archive policy | **NEEDS-1-POLISH** | Wave D (4 触发信号合并为 2 大类) |
| 3 | plan-context selectable filter | ❌ **BLOCKER** | **Wave A1**(已锁) |
| 4 | Recall verification 两步调用 | **NEEDS-1-POLISH** | Wave A1 之后 — 合并为 `fab_recall` 单 API 候选 |
| 5 | Archive viability gate Phase 0.5 | **NEEDS-2-POLISH** | Wave D (信号简化 + duplicate glob 强制) |
| 6 | Archive layer classification | **NEEDS-1-POLISH** | Wave D (二元简化 + lint 加) |
| 7 | Archive slug naming | **NEEDS-1-POLISH** | Wave A 或 D (server 端 auto-disambiguate) |
| 8 | relevance_paths derivation | **NEEDS-1-POLISH** | Wave A1 配套 (Evidence 升级 frontmatter) |
| 9 | Doctor remediation 文案 | **NEEDS-3-POLISH** | Wave D (单独 task,70 个 string sweep) |

**总计**:
- BLOCKER: 1(已锁 Wave A1)
- NEEDS-1-POLISH: 4
- NEEDS-2-POLISH: 3
- NEEDS-3-POLISH: 1

---

## 新发现的 GA fix candidate(影响 Wave A/D/E scope)

| ID | 来源 | 建议位置 |
|---|---|---|
| **NEW-1** | §1 cite policy 4-state → 2-state 简化 + PreEdit warn hook | Wave D 新 task D6 |
| **NEW-2** | §2 self-archive 4 信号 → 2 大类 合并 | Wave D 新 task D7 |
| **NEW-3** | §4 `fab_recall` 单步 API 合并 + TTL 放宽 | Wave A1 配套 |
| **NEW-4** | §5 Phase 0.5 force-archive 引导文案 + duplicate glob 强制 | Wave D 新 task D8 |
| **NEW-5** | §6 personal layer lint(引用本项目路径 → warn) | Wave D 新 task |
| **NEW-6** | §7 server 端 slug auto-disambiguate | Wave A1 配套 |
| **NEW-7** | §8 relevance_paths 多 signal 升级 + Evidence frontmatter 化 | Wave A1 配套 |
| **NEW-8** | §9 doctor remediation 文案系统 sweep (70 string) | Wave D 新独立 task D9 |

**估时影响**:
- Wave A1(原 3-4h)+ A1 配套(NEW-3 / NEW-6 / NEW-7)≈ +3-4h = **6-8h**
- Wave D(原 7-10h)+ 5 个新 sub-task(NEW-1/2/4/5/8)≈ +6-10h = **13-20h**

新 Wave 总估时:**~67-92h**(原 63-82h + 4-10h 增量)。仍在 2-3 RC iteration 内。

---

## 下一步

1. user 看本 verdict,确认 NEW-1 ~ NEW-8 是否 in-scope(可能某些推 v2.1)
2. 若 ack,我 update status.json + TaskList 加 NEW-1~8 sub-task
3. 然后启动 Phase 2/3 paper walkthrough(skills + hooks)
4. 等 Phase 7 verdict 汇总,Wave A/B 启动
