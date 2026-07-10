# v2.0.0 GA UX Audit — Skills Paper Walkthrough (Phase 2 / C3)

**Date**: 2026-05-27
**Skills audited**: fabric-archive, fabric-import, fabric-review (3 个 canonical)
**Method**: paper walkthrough — Read SKILL.md → 模拟用户跑一遍 → 列 noise/confusion/dead-end 点
**待补**: werewolf-minigame 真实 dogfood(C-WEREWOLF task,user-owned)

---

## 1. fabric-archive

### 触发入口(4 种 E1-E5)

| Entry | 触发条件 | 用户感知 |
|---|---|---|
| E1_hook | Stop hook stdout JSON `{"decision":"block","reason":"...fabric-archive"}` | hook nudge:archive cadence 超阈值 |
| E2_explicit | 用户显式 "archive what we just did" / "fabric archive" / "/fabric-archive" | 主动归档 |
| E3_ai_self_trigger | AI 内部 marker `self-archive policy triggered by signal: <X>` | self-archive policy 4 触发信号 |
| E4_user_range | 显式带 time/topic 范围(`今日复盘` / `上周 cite policy`) | 回溯式归档 |
| E5_cron | OS cron / `/loop` 调度 | 自动每日复盘(silent-skip if no signal) |

### Golden path(8 个 phase)

```
Phase 0 Range Resolution → 0.5 Config Load → 1 Cross-Session Digest →
Phase 2 Collect Candidates → 2.5 Viability Gate → 3 Classify+Review →
Phase 3.5 Scope+relevance_paths → 4 fab_extract_knowledge → 4.5 Persist Attempt
```

### Paper walkthrough 发现的问题

| # | 类型 | 描述 | 严重 |
|---|---|---|---|
| 1 | **Cognitive load** | 8 phase + 6 ref/*.md 必读;skill body 已 138 行,加载所有 ref 到完整 context 后接近 2.5K 行 | HIGH |
| 2 | **Phase 0 LLM-as-parser** | "AI is the parser" 设计在不同 LLM(Claude / Codex / Gemini)行为差异大;zh-CN 表 + en 表 同等表达但 LLM 选择存在偏置 | MED |
| 3 | **Phase 1 ledger filter** | Step 4.5 rule a-f 状态机 + `ANTI_LOOP_HOURS=12` / `NORMATIVE_KEYWORDS` 常量;**编程化逻辑放在 LLM 执行**,容易丢步 | HIGH |
| 4 | **Phase 2.5 viability gate** | 8 archive signals + 4 anti-signals + 显式 vs 隐式触发分支;LLM 错判率 80% (rc.32 实测) | HIGH(已被 §2 §5 algo audit 标 NEEDS-POLISH) |
| 5 | **Phase 3 layer 启发式** | "强 team / 强 personal / 默认 team" verbatim 锁定 — 与 §6 algo 一致需简化 | MED |
| 6 | **Phase 3.5 relevance_paths** | rc.5 single-signal (edit_paths only) — 与 §8 algo 一致需扩展 | MED |
| 7 | **dry-run 模式** | 仅通过 prompt substring 检测 `--dry-run`/`预览`,**没显式 flag**;用户误以为是参数 | LOW |
| 8 | **多 ref/*.md 跳转** | "Read ref/phase-X.md" 散布全 SKILL.md;每次 phase 切换都要 Read,user-visible 是工具调用 noise | MED |
| 9 | **文案 "Check-not-Ask"** | "not a preference interview" / "E3-strong mode" 等术语用户不知道含义 | MED |
| 10 | **Phase 4.5 ledger emit 4KB 限制** | `session_context` 500 chars / `source_sessions` 5 entries / `recent_paths` 20 entries 自截断;边界遇到时**LLM 行为不一致**(有时丢首条) | LOW |

### Verdict: **NEEDS-3-POLISH**

**Recommendations**:
1. **简化为 3 phase**(collect / decide / persist),把 8 phase 内部 ref/*.md 进一步合并;skill body 控目标 <80 行
2. **Phase 1 ledger filter 服务端化**:状态机 a-f 移到 server,LLM 只看「是否 re-scan 这个 session(y/n)」标志 — server 已提供 fab_review action="list" 等 deterministic API,这是同类逻辑应放服务端的延伸
3. **dry-run 升级为 explicit `--dry-run` flag**(skill 参数,非 prompt 嗅探)— 与 fabric-import 一致
4. **术语清理**:"Check-not-Ask" / "E3-strong" / "viability gate" → 用户可读语言(skill 内部仍可保留代号但 surface 文案换)
5. 配合 algo audit NEW-2 / NEW-4 实施 — viability gate signal 8→3 简化 + marker 正则容错

---

## 2. fabric-import

### 触发入口

| Entry | 条件 |
|---|---|
| 用户显式 | "import knowledge" / "bootstrap fabric" / "mine changelog" |
| SessionStart hook | `shouldRecommendImport()` 在 first-run / underseed 时建议 |
| 显式 skill 调 | `/fabric-import` |

**SKIP 条件**:`.fabric/` 缺 → 引导 `fabric install`;canonical > 50 → 已饱和;state `phase=complete && last_checkpoint_at < 24h` → 刚跑过。

### Golden path(3 phase pipeline + 0/0.5 init)

```
Phase 0 Init (read state) → 0.5 Config Load →
Phase 1 baseline reference (read agents.meta + glob team/) →
Phase 2 git mining + docs mining (broad+[] mandatory) →
Phase 3 dedup vs canonical (5-way classification) →
final_summary 收尾
```

### Paper walkthrough 发现的问题

| # | 类型 | 描述 | 严重 |
|---|---|---|---|
| 1 | **Broad+[] mandate** | Every call MUST `relevance_scope="broad"` + `relevance_paths=[]`;**NON-NEGOTIABLE**。理由是「import is LLM-driven, narrow→false-narrow silently hides」 — 但与 §8 algo 的"narrow 是基础"哲学冲突 | MED |
| 2 | **broad-only 与 Wave A1 配合** | Wave A1 删 selectable filter 后,broad/narrow 区分价值大幅下降,broad+[] mandate 还有意义吗? | HIGH(与 Wave A1 联动 review) |
| 3 | **Phase 1 严格依赖 baseline** | `agents.meta.json` 缺 OR team/ empty → STOP「请先运行 fabric install」 — **死路径**,如果用户没 install 直接跑 import,被强制踢出 | MED |
| 4 | **窗口默认 60 个月** | first-run 60 月 git log + cap 500 commits — 老项目可能扫不完,**没说明如何分批** | LOW |
| 5 | **commit 类型 mapping 偏静态** | feat→decision/model / fix→pitfall / refactor→decision / docs→guideline;chore/test/ci skip — **mapping 假设用户用 conventional commit**,实际很多项目不这样 | MED |
| 6 | **dry-run 同 archive** | 通过 prompt substring 检测,非 explicit flag | LOW |
| 7 | **state file 原子写** | `.fabric/.import-state.json` 用 `Write .tmp + Bash mv` 实现 POSIX rename(2);**Write alone NOT atomic** — fact 是对的,但要求 skill 调度时**记住分两步**,LLM 容易合并 | MED |
| 8 | **Resume 6-step** | 隐藏在 ref/checkpoint-state.md;用户 mid-fail 后看到 "请重跑 fabric-import",**不知道是 resume 还是从头** | MED |
| 9 | **Phase 3 5-way classification** | duplicate / subsumption / subsumption-with-novelty / contradiction / genuinely-new — **5 类边界主观**,LLM 实测分类一致性低 | HIGH |
| 10 | **错误 5+ halt 询问** | `errors.length > 5` halt + ask `继续 (y) / 中止并保留 state (n)` — **5 是 magic number**,用户不知道为啥这个数;**halt+state 保留** 用户重跑时是否真有用? | LOW |

### Verdict: **NEEDS-2-POLISH**

**Recommendations**:
1. **Broad+[] mandate 重新评估** — Wave A1 删 server-side filter 后,这条 mandate 价值降低;考虑改 "default broad,LLM 可推 narrow"
2. **Phase 1 STOP path 软化** — `agents.meta.json` 缺 → 提示 + 提供 `--init-then-import` 一键路径,而非死磕 install 前置
3. **conventional commit 假设软化** — type mapping 失败时 fallback 到「全部当 decisions」+ LLM 二次过滤,不要 hard-coded skip chore/test
4. **dry-run / state-recovery 升级 explicit flag**:`--dry-run` / `--resume` / `--from-checkpoint <phase>`
5. **5-way classification 减为 3**:合并 subsumption + subsumption-with-novelty → "covered",合并 duplicate → "redundant";contradiction / genuinely-new 保留 — 实测分类一致性会提升

---

## 3. fabric-review

### 触发入口(3 种)

| Entry | 条件 |
|---|---|
| Stop hook overflow | pending count ≥ 10 OR oldest age ≥ 7 days |
| 用户显式 | "review knowledge" / "show pending" / "approve what's queued" / "what's stale" / "look at KT-D-7" |
| Agent 判定 | backlog crossed threshold |

### 4 mode(系统推断,NEVER ask)

| Mode | 触发 keyword | Flow |
|---|---|---|
| `pending` | "approve" / "promote" / "审核" / "通过" | list pending → semantic check → per-item approve/reject/modify/defer/skip |
| `topic` | "search for X about Y" / "找一下 <topic>" | extract keywords → fab_review search → render top-N |
| `health` | "what's stale" / "demote old" / "过期的" | list + stale compute → dashboard → per-stale defer/demote/skip |
| `revisit` | "look at <id>" / "show <slug>" | Read canonical + history → display |

### Paper walkthrough 发现的问题

| # | 类型 | 描述 | 严重 |
|---|---|---|---|
| 1 | **Mode inference 3-step** | keyword scan → events tail scan → pending count default;**3 步降级**,如果 step 1 多 match 或 0 match,step 2/3 兜底 — 实测**很容易走到 step 3 default pending**,失去 4 mode 区分价值 | HIGH |
| 2 | **Semantic check no quantification** | duplicate/contradicts/subsumed 3 flag,**thresholds intentionally NOT quantified** — 让 LLM 主观判 — 一致性低,跨 LLM 行为差异大 | HIGH |
| 3 | **Modify 路径分裂** | title/summary/tags/maturity → in-place;layer change → ONLY legal stable_id mutation + AskUserQuestion target — **两路径写在一个 modify action**,用户/LLM 容易混淆 | MED |
| 4 | **Import-origin entries hint** | `⚠ Imported (broad, [])` 信息性提示「pick modify + say narrow to <paths>」 — 用户看到这句**不知道怎么"say narrow to <paths>"**(自由文本?固定语法?) | HIGH |
| 5 | **AskUserQuestion 高频** | per-pending action 5 选 1(approve/reject/modify/defer/skip);per-stale 3 选 1(defer/demote/skip);layer-flip 2 选 1 — **20 个 pending 要点 20 次 AskUserQuestion**,体验疲劳 | MED |
| 6 | **Batch reject vs modify 分裂** | "Approve and reject MAY be batched within their own action; modify MUST be one call per entry" — **batch 规则不直观**,用户/LLM 误以为可以一次批量 | MED |
| 7 | **events.jsonl 4KB 单行约束** | 与 fabric-archive 同;Phase 同时 emit `knowledge_promote_started` + `knowledge_promoted` + `knowledge_layer_changed` + `knowledge_rejected` + `knowledge_deferred` — **多种 event 顺序 emit**,debugging 时难追 | LOW |
| 8 | **revisit mode "Read canonical OR fab_review.list"** | 两种路径并存,**何时用哪个不明确** | LOW |
| 9 | **DISPLAY 文案 zh-CN body + EN headings** | 中英混排，跨 client 一致性如何?(Codex CLI 默认英文环境可能 jarring) | MED |
| 10 | **stable_id 4 protected tokens** | `prior_stable_id` + `new_stable_id` + `knowledge_promoted` 等不翻译 — **用户读 zh-CN body 时这些 EN token 视觉割裂** | LOW |

### Verdict: **NEEDS-3-POLISH**

**Recommendations**:
1. **Mode inference 简化为 2**:`pending`(默认,处理 queue)+ `topic-or-revisit`(显式带关键词/id 时);删掉 `health` mode 让 doctor 承担,删掉 mode 推断歧义
2. **Semantic check 量化**:加 cosine similarity 或类似 baseline,LLM 在 threshold 之上才 emit `⚠ duplicate`,降低主观判
3. **Modify 拆分为两个 action**:`modify-content`(in-place)+ `modify-layer`(stable_id mutation 路径)— 路径分裂明确,batch 规则不会模糊
4. **Import-origin narrow 路径修复**:hint 文案改为「`fab_review modify <slug> --narrow-to <paths>` 把它收窄到具体路径」— 明确语法
5. **AskUserQuestion batch 支持**:`per-batch action` 选项 — 用户可对一组同类 pending 一次决策(如 "approve all decisions-类")
6. **revisit 路径合并**:统一走 `fab_review action="list" --id <id>` 单一路径

---

## Cross-Skills 共通问题

| # | 共通 | 描述 |
|---|---|---|
| C1 | **多 ref/*.md 跳转** | 3 个 skill 共 12+ ref 文件;每次跳转都是 Read tool 调用 — user-visible noise + cache miss |
| C2 | **dry-run 检测方式不一** | archive/import 都靠 prompt substring,review 没 dry-run — 不一致 |
| C3 | **layer 启发式 / scope 启发式** | 3 个 skill 各自有 layer/scope 决策章节 — 应抽到共享 ref(已部分 done 通过 `强 team / 强 personal / 默认 team` verbatim 块) |
| C4 | **i18n protected tokens 列表** | 3 个 skill 各自维护 protected token 列表,但很多 token 重叠 — DRY 违背 |
| C5 | **events.jsonl 4KB POSIX 约束** | 3 个 skill 都 emit event,4KB 约束 重复说明 — 应抽到 server-side automatic 截断 |
| C6 | **"Hard Rules DISPLAY / WRITE Split"** | 3 个 skill 都有此 section — 同 schema,可统一 |

**统一改进建议**:
1. 引入 `templates/skills/lib/`,把 cross-skill 共享逻辑抽到 lib(layer 启发式 / events emit / protected tokens / dry-run flag handling)
2. server 端自动 truncate events 字段,skill 不再自负担 4KB 约束
3. dry-run 升级 explicit `--dry-run` flag 跨 3 skill 一致

---

## Skills Verdict Matrix

| Skill | Verdict | 严重发现 |
|---|---|---|
| fabric-archive | **NEEDS-3-POLISH** | Cognitive load 高 / Phase 1 ledger filter 应服务端化 / 文案术语黑话 |
| fabric-import | **NEEDS-2-POLISH** | Broad+[] mandate 与 Wave A1 联动 / 5-way classification 分类一致性低 |
| fabric-review | **NEEDS-3-POLISH** | Mode 4 推断容易 default-fallthrough / Semantic check 无量化 / Modify 路径分裂 |

---

## 新 GA fix candidate(影响 Wave 范围,补 NEW-1~8 之外)

| ID | 来源 | 建议位置 |
|---|---|---|
| **NEW-9** | fabric-archive 8 phase 简化 + Phase 1 ledger filter 服务端化 | Wave D 新 task |
| **NEW-10** | dry-run / state-resume 升级 explicit flag(3 skill 共)| Wave D 新 task |
| **NEW-11** | fabric-import broad+[] mandate 与 A1 联动重评 | Wave A1 配套 |
| **NEW-12** | fabric-review mode 4→2 + semantic check 量化 + modify 拆分 2 action | Wave D 新 task |
| **NEW-13** | cross-skill 共享 lib(layer heuristic / events emit / protected tokens)| Wave D 新 task |
| **NEW-14** | events.jsonl 自动截断到 server side | Wave B 配套(events 改造时同步) |
| **NEW-15** | skill 文案术语清理("Check-not-Ask" / "E3-strong" / "viability gate")| Wave D 新 task |

**估时增量**:
- NEW-9 ~ 15 共 ~10-15h,主要落 Wave D 和 Wave A
- Wave D 现 ~13-20h → **~23-35h** (含 NEW-1/2/4/5/8 + 9/10/12/13/15)
- Wave A1 现 ~6-8h → **~7-10h**(含 NEW-3/6/7/11)
- Wave B 现 ~12-15h → **~13-16h**(NEW-14 加入)

**总估时**:~67-92h → **~78-105h**(原 +10-13h 增量)

---

## 下一步

1. user 看本 verdict,确认 NEW-9~15 是否 in-scope
2. 推进 C4 Phase 3 Hooks paper walkthrough → `hooks-verdict-paper.md`
3. 推进 C5 Phase 5 8 阶段旅程 paper coherence → `journey-verdict-paper.md`
4. C6 Phase 6 5 横切 spot-check → `crosscut-verdict.md`
5. C-WEREWOLF(user-owned)dogfood 验证 paper findings
6. C7 GA-VERDICT 汇总
