# Grill Report: Fabric 配置分层收尾 (A vs B + 物理搬旋钮 vs 只文档化)

**Session**: grill-config-layering-wrapup
**Depth**: standard (5 branches)
**Date**: 2026-07-20
**Upstream**: none (topic text)
**Branch (git)**: refactor/config-two-home-architecture @ 7c7f977e (== main，两根架构已落地，无未提交改动)

## Discovery Summary

### 配置拓扑现实（代码为真源）

| 层 | 物理位置 | 住什么 | Schema |
|----|----------|--------|--------|
| **Global（机器级）** | `~/.fabric/fabric-global.json` | `language`（单机语言基调，界面+知识写作）、store 别名/registry | `globalConfigSchema` (store.ts:340) |
| **Global cache** | `~/.fabric/cache/embed` | 嵌入模型权重（下一次，全机共享） | — |
| **Project（仓库级）** | `<repo>/.fabric/fabric-config.json` | ~40 个旋钮：hook nudge、recall（top_k/ratio）、credibility 衰减、**向量配方 4 旋钮**、store 绑定 | `fabricConfigSchema` (fabric-config.ts:158) |
| **Project cache** | `<repo>/.fabric/.cache/vectors/` | 每项目向量索引（按 `embed_model` 做 key，可重建，不入 git） | — |
| **Env** | 环境变量 | **非统一层**：仅零散逃生口 `FABRIC_HOME` / `FABRIC_PROJECT_ROOT` / `FAB_LANG` / `FABRIC_EMBED_CACHE_DIR` / 几个 CI·debug flag | — |

### 关键证据（挑战премиса的三条硬发现）

1. **「删死旋钮」几乎无剩余目标。** `fabric-config.ts` 通篇是退休注释——`retrieval_budget_profile`(KT-DEC-0037)、`hint_broad_top_k`(W3-J)、`hint_broad_budget_chars`(KT-DEC-0036)、`cite_evict_interval`、`import_*/archive_max_*`、`fabric_language`、fixture-path 全已删净。疑似死的 `maintenance_hint_days/cooldown` 经核实为 **LIVE**（Signal D 已上线：maintenance-signal.cjs / hint-config.cjs:72 / knowledge-hint-broad.cjs:1251 真消费）。→ **A 的「删死旋钮」子项无靶。**

2. **「接线」缺口(embed_enabled 声明漂移, KT-PIT-0029)已修。** config-loader.ts:122 `enabled = config.embed_enabled !== false`（默认 true）= schema 默认 true（fabric-config.ts:545），注释明写「keep the two in sync」。→ **A 的「接线」子项已闭合。**

3. **B 的前提被证伪。** 向量索引是 **per-project 可重建缓存**（`.fabric/.cache/vectors/`，`embed_model` 做 cache key，换模型即失效重嵌），**不入 git、不随 store**；store 只存知识正文，每个消费者本地重嵌。store schema 无任何向量字段。→ **「embed_model 必须随 store 走」不成立**（KT-DEC-0063 的「裸向量入 git 跨平台漂移」风险在当前架构下根本不触发，因为无向量被提交）。

4. **文档缺口是真的。** `docs/configuration.md` 不存在，但 schema 注释(line 255/264)已引用它 → 悬空引用 + 分层无成文说明。这是「文档化分层」唯一真实靶。

### 相关既有知识
- KT-DEC-0003 双根布局（team→repo/.fabric，personal→~/.fabric）
- KT-MOD-0002 env>project>global 是 12-factor 惯例（心智模型，非统一解析器）
- KT-DEC-0037 删 retrieval_budget_profile enum
- KT-PIT-0029 embed_enabled 声明漂移（已修）
- KT-DEC-0063 向量缓存能否随 git（裸向量跨平台漂移风险）
- KT-MOD-0003 向量检索默认开

---

## ⚠️ 用户重定向(Q1）：真问题不是 A/B，是配置分层架构

用户掀翻原 A/B frame：真痛点是「配置散在 5 个声称的层级（①global 机器 / ②personal store / ③team store / ④project / ⑤local 覆盖），有冗余、有未接线、有分散」。核心诉求：**哪些层能合并？哪些旋钮必须住在哪一层，才能保证一个知识库仓库团队分发后 Fabric 行为一致（broad_index、向量配方、远程 API 嵌入、向量缓存）？**

### 5 层的真实现状（代码坐实）

| 声称层 | 真存在 | 物理 | 装什么 | 随 store 分发 |
|--------|--------|------|--------|--------------|
| ① global 机器 | ✅ | `~/.fabric/fabric-global.json` (globalConfigSchema) | uid / language / stores[] 挂载表 / active_personal_store | — 机器级 |
| ② personal store 偏好 | ⚠️ 半个 | personal store 的 `store.json` (storeIdentitySchema) | **仅 identity**（uuid/scope/desc），零偏好旋钮 | 是（仅 identity） |
| ③ store 知识库配置 | ❌ 行为部分不存在 | `store.json` | 同上，纯 identity | 是，**零行为旋钮** |
| ④ project 代码库 | ✅ | `<repo>/.fabric/fabric-config.json` (fabricConfigSchema) | **全部 ~40 行为旋钮** | ❌ **不随 store** |
| ⑤ local 覆盖 | ❌ 不存在 | — | — | — |

### 结构性根因（用户直觉命中的真 gap）
**唯一「随知识库走」的文件（store.json）只装身份证、不装行为旋钮；所有行为旋钮住在 per-repo 的 project 配置里、不跟 store 走 → 团队分发后行为一致在结构上不可能。** 例：队友 A repo 设 `embed_model:bge-zh`、B 设 `mle5`，挂同一 team 库召回结果却不同。broad_index_backstop 同理。远程 API 嵌入：代码零实现（vector-retrieval.ts 纯本地 fastembed），是未来诉求。

### 旋钮归属重分类（按「团队一致性」目标）
- **Store 层**（应随库走）：决定共享语料排序/浮现/维护 — `embed_model`⭐ `broad_index_backstop`⭐ `fusion` `embed_weight` `recall_relevance_ratio` `plan_context_top_k` `credibility_*` `orphan_demote_*` `conflict_lint_*`
- **Machine 层**（global）：`language`、模型权重缓存、(未来)远程嵌入 endpoint+key
- **Repo/dev 层**（project）：`nudge_mode` `observe` `*_hint_*` `archive_edit_threshold` `cite_*`、store 绑定
- **精妙点**：远程嵌入劈两半 — 用哪个模型=Store 层，打哪个 endpoint+谁的 key=Machine 层。

---

## 用户重定向 2（Q1 二轮）：拆分层级 + 挑战合并 + 逐旋钮 CRUD + 远程嵌入本地/远程双模；优先级待「层级完全挑战后」定。

### 层级合并挑战（5 → 3 家 + 1 机制）
- **②personal 偏好 ⊕ ③store 配置 → 合并为单一「Store 层」**：personal / team store 结构同构（S42），`personal:true` 只是 flag，非独立配置层。个人偏好 = 个人 store 的 store-config。
- **⑤local → 覆盖机制而非层**：无专属旋钮，是 env + 可选 gitignored `.local.json` 的横切覆盖手段。
- **结论**：Machine（`~/.fabric/fabric-global.json`）· Store（committed 进 store git，personal/team 同构）· Repo（`.fabric/fabric-config.json`）· + env/local 覆盖机制。

### 逐旋钮 CRUD 全量普查（fabricConfigSchema 51 项 + global 4 + store.json 5）

**图例**：归属 = 该旋钮"改了影响谁"的正确家；动作 = keep（不动）/ move→X（下沉/上移）/ del（已死或应删）/ split（劈层）。

| 旋钮 | 今在 | 应归属 | 动作 | 理由（团队一致性视角） |
|------|------|--------|------|------|
| **embed_model** ⭐ | project | **Store** | move→store（默认）+project 可覆盖 | 决定共享语料的向量语义空间；成员模型不一致→召回不可比 |
| **broad_index_backstop** ⭐ | project | **Store** | move→store 默认 | 决定所有人看到的 broad 菜单规模；不一致→"我和队友看的不一样" |
| embed_weight / fusion | project | **Store** | move→store 默认 | 共享语料融合排序；应团队一致 |
| recall_relevance_ratio / plan_context_top_k | project | **Store** | move→store 默认 | 共享语料召回形状 |
| credibility_half_life_*(5) / credibility_floor_*(3) | project | **Store** | move→store 默认 | 共享知识评分衰减 |
| orphan_demote_*(3) / broad_review_recheck_days | project | **Store** | move→store 默认 | 共享知识维护节奏 |
| conflict_lint_similarity_threshold | project | **Store** | move→store 默认 | 共享语料冲突检测 |
| mcpPayloadLimits / selection_token_ttl_ms | project | Repo | keep | 本地 MCP 传输/会话，非共享语义 |
| embed_enabled | project | Repo/Machine | keep（+能力探测） | "本机能否跑嵌入"是机器事实；开关留 repo，能力看 Machine |
| language | global | **Machine** | keep | 单机语言基调（已对） |
| uid / stores[] / active_personal_store | global | **Machine** | keep | 机器身份/挂载（已对） |
| store_uuid / created_at / canonical_alias / description / allowed_scopes | store.json | **Store（identity）** | keep | 身份，已随库走 |
| nudge_mode / observe / *_hint_* / archive_edit_threshold / archive_hint_* / review_hint_* / maintenance_hint_* / underseed_node_threshold / hint_dismiss_signals / hint_summary_max_len / hint_reminder_to_context | project | **Repo/dev** | keep | 本地工作流节奏，不影响共享语料语义；per-dev 合理 |
| cite_recall_nudge / cite_recall_window_minutes / cite_nudge_ignore_globs / cite_policy_enabled / self_archive_policy_enabled | project | **Repo/dev** | keep | 个人行为策略逃生口（D2 user-in-control） |
| required_stores / active_write_store / active_project / write_routes / default_write_store | project | **Repo（绑定）** | keep | 本 repo 挂哪些库/写哪，天然 per-repo |
| scanIgnores / audit_mode / onboard_slots_opted_out / fabric_event_retention_days / altitude_propose_gate | project | Repo | keep | 本地扫描/审计/事件/onboard，非共享语义 |
| review_stale_pending_days | project | Repo | keep | review skill 本地分页阈值 |
| clientPaths / project_id / workspace_binding_id | project | Repo（identity） | keep | 本 repo 客户端/身份 |
| **（远程嵌入）新增** | — | **split** | add | model→Store（语义空间团队共享）；endpoint+api_key+use_remote→Machine（各人各 key） |

**净动作**：~15 个"共享语料"旋钮 move→Store（store 给团队默认，project/env 可覆盖）；其余 ~35 个 keep 在 Repo/Machine（本就对）；新增远程嵌入 split 两层。**无旋钮需删**（死旋钮前轮已确认删净）。

### 远程嵌入本地/远程双模设计（Q1 新纳入）
- **model 身份 → Store 层**：`embed_model` 扩成可命名本地(`fast-bge-small-zh-v1.5`)或远程(`openai:text-embedding-3-small`)语义空间。团队必须同意同一空间，否则向量不可比。
- **provider endpoint + api_key + 是否走远程 → Machine 层**：各成员自己的 key；一台机器一套 provider 配置。
- **降级张力（关键 edge）**：store 声明远程 model 但某成员无 key → **不能静默改用本地模型**（那会换语义空间、破一致性）；正确降级是**该成员向量通道关闭走纯文本 BM25**（一致性保住，召回质量降），doctor 大声告警"缺 key，向量降级"。这复用 KT-MOD-0003 degrade-safe 但把"换模型"改成"关通道"。

---

## Branch Log

| # | Branch | Status | Decisions | Open |
|---|--------|--------|-----------|------|
| 1 | Scope & Boundaries | 🟢 | 原 A/B 证伪 → 真问题=配置分层架构；blueprint-first | — |
| 2 | Data Model & State（层级归属） | 🟢 | 3 家+1 机制；51 旋钮 CRUD 普查；15 move→Store | — |
| 3 | Edge Cases & Failure（配置打架/降级） | 🟢 | C-006 单一默认家；远程无 key→关向量通道 | — |
| 4 | Integration & Dependencies（解析器） | 🟢 | env>project>store 级联 + doctor 软告警 | 解析器 hot-path 实现细节→blueprint |
| 5 | Migration & Rollback | 🟢 | 零用户 clean-slate；无迁移；blueprint-first | store-config 跨版本 back-compat→blueprint |

---

## Synthesis

### Decision Summary

| # | Decision | Status | Branch | RFC 2119 |
|---|----------|--------|--------|----------|
| D1 | 配置分层 = Machine / Store / Repo 三家 + env·local 覆盖机制（②③合并，⑤降为机制） | Locked | 2 | 配置 MUST 归入三家之一；personal 是 store 的 `personal:true` flag，NOT 独立层 |
| D2 | ~15 个"共享语料"旋钮下沉为 Store 层默认（embed_model / broad_index_backstop / fusion / embed_weight / recall_relevance_ratio / plan_context_top_k / credibility_*(8) / orphan_demote_*(3) / broad_review_recheck_days / conflict_lint_*） | Locked | 2 | 决定共享语料排序/浮现/维护的旋钮 MUST 有 Store 层默认 |
| D3 | 优先级 `env > project(repo) > store默认 > 硬编码`，覆盖 store 层旋钮 MUST 触发 doctor 软告警（非阻断） | Locked | 4 | store 层旋钮的 repo 覆盖 MUST 被 doctor 标记为团队不一致风险 |
| D4 | 不硬锁：个人可覆盖以保留本地实验自由（D2 user-in-control 红线，KT-DEC-0007） | Locked | 4 | store 层旋钮 MUST NOT 硬锁禁止 repo 覆盖 |
| D5 | 远程嵌入本地/远程双模：model→Store 层（团队共享语义空间），endpoint+api_key+use_remote→Machine 层 | Locked | 2 | 嵌入 model 身份 MUST 住 Store；provider 凭证 MUST 住 Machine |
| D6 | 远程 model 声明但成员缺 key → 关向量通道走纯文本 BM25 + doctor 大声告警；MUST NOT 静默换本地模型 | Locked | 3 | 缺 key 时 MUST 关通道保一致性，MUST NOT 换语义空间 |
| C-006 | 配置防打架：每个旋钮唯一"默认家"，其他层仅显式覆盖且 doctor 可见；无旋钮被两家共有却无确定解析顺序 | Locked | 3 | 每旋钮 MUST 有唯一 canonical home；跨层 MUST 有确定 precedence |
| D7 | 落地节奏 = 先出全量 blueprint（含 15 旋钮迁移 + 远程嵌入 + 覆盖层 + 解析器）再实现 | Locked | 5 | 实现前 MUST 先产出 blueprint/roadmap |

### Refuted / Dropped（代码证伪的原前提）
- **原 B「向量配方迁 store 因 index 随库走」** → 证伪：向量是 per-project 可重建缓存，store 不存向量（但 D2/D5 以"团队一致性"重新论证了 embed_model 该住 Store，理由不同）。
- **原 A「删死旋钮」** → 无靶：死旋钮已删净（maintenance_hint_* 经核实为 LIVE）。
- **原 A「接线 embed_enabled」** → 已修（KT-PIT-0029 resolved，config-loader:122）。

### Non-Goals
- 一次性五层全重构（scope creep，改为 blueprint 分阶段）。
- store 硬锁不可覆盖（牺牲个人实验自由，拒）。
- 提交裸向量进 git（KT-DEC-0063 跨平台漂移，不做）。

### Risk Register

| # | Risk | Branch | Severity | Mitigation |
|---|------|--------|----------|------------|
| R1 | 配置跨层打架（同旋钮 store+project 共设，解析歧义） | 3 | High | C-006：唯一默认家 + 显式覆盖 + doctor 可见；解析器确定级联 |
| R2 | 远程 model 在 store、成员无 key → 召回降级 | 3 | Med | 关向量通道走文本（保一致），doctor 大声告警缺 key |
| R3 | blueprint 范围膨胀（15 旋钮+远程+覆盖层+解析器） | 5 | Med | blueprint 内分阶段：先 embed_model+broad_index 两个 seam，其余 backlog |
| R4 | store-config 解析进召回 hot-path → 性能/健壮 | 4 | Med | 复用现有 best-effort hot-path-safe reader 模式（parse 失败回默认，不崩） |
| R5 | store-config committed 文件跨版本 back-compat（老 clone 遇新字段） | 5 | Med | lenient/passthrough parser（mirror globalConfigSchema `.passthrough()`） |
| R6 | store 层默认 + repo 覆盖仍可能重演不一致（覆盖泛滥） | 4 | Low | 默认一致是"最省力路径"+doctor 告警显形；接受软约束 |

### 路由决策更新（session 末）
- **D7 SUPERSEDED**：用户在完成 grill 后覆盖 blueprint-first，改为「直接 maestro-ralph 一次性全做，跳过 blueprint 文档」。已两次告知 R3 scope 风险 + D7 反转，用户清醒确认。执行者按此路由，但保留波次结构做 checkpoint。
- **3 开放子决策的执行者拍定默认**（grill 证据支撑，非盲选）：
  - 分阶段：W1 解析器+embed_model+broad_index_backstop 切片 → W2 剩 13 旋钮 → W3 远程嵌入双模 → W4 doctor 软告警 lint。
  - local 覆盖：先 env-only；`.fabric/fabric-config.local.json` 记 follow-up backlog。
  - store-config 落点：新增独立 committed `store-config.json`（并列 store.json/projects.json/counters.json），lenient/passthrough parser；理由 store.json 为 mint-once immutable identity，行为默认应分离。

### Recommended Next Step
`Skill({ skill: "maestro-blueprint", args: "Fabric 配置分层架构（Machine/Store/Repo 三家 + 覆盖机制）：15 共享语料旋钮下沉 Store 层默认 + env>project>store 级联解析器 + doctor 软告警 + 远程嵌入本地/远程双模 --from grill:GRL-20260720-config-layering" })` — 用户已锁 blueprint-first（D7）。

---
