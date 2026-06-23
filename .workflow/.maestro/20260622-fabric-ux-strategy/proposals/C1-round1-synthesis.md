# C1 — Round 1 综合擂主:fabric 交互+策略迭代 + 后续集成路线

> 综合来源:B(策略,winner 85.3)骨架 + C(集成,83.7)增益 + A(交互,75.0)好交互点(剔镀金)。三家强收敛。
> 冷评:B 85.3 / C 83.7(epsilon 内并列)/ A 75.0 / BASELINE 68.7。

---

## 一、策略层:字段模型 + 复杂度内化(本版核心)

### 1. 作者只填 2 个字段(B 主导,修掉 A 的自相矛盾)
```yaml
# ❌ 现状 5 字段(layer/semantic_scope/visibility_store/relevance_scope/relevance_paths)
# ✅ C1:作者只碰 2 个
audience: project:fabric-v2   # team | project:X | personal
paths: ["src/render/**"]       # 空=broad(总是冒) / 有 glob=narrow(改到才冒)
```
- **物理 store 目录 = 边界真源**(A 的 Location-is-Configuration 对的那一半):个人 store 目录→personal,团队 store→team;`audience` 只在团队内细分 `project:X`。**`layer`/`visibility_store`/`store` 全由"store 目录 + audience"引擎推导,不写进 frontmatter。**
- **比擂主"显式 layer"更安全**:store 物理隔离是硬边界,不靠推导,焊死"个人知识泄漏进团队"。
- **修掉 A 的漏洞**:不引 `.fabric-store.json` 把 metadata 偷渡回来(冷评抓到的自相矛盾)——边界就是目录本身。
- `paths` glob 语法直接采 Copilot `applyTo` / Cursor `globs`(C 提醒,守跨端护城河,别自创)。
- 其余(maturity/created_at/id/store…)收进引擎隐藏 envelope(B 的 `fabric:` namespace),作者/AI 都不碰。

### 2. cite 内化(B):删首行 contract 八股
- 删 AGENTS.md 首行 `KB: id [applied] → edit:<glob>...` 这套。
- PreToolUse recall 命中 → 引擎自动在 events.jsonl 记 `[recall_kb_ids] ↔ [edit_paths]` 映射;PostToolUse 自动算 cite-coverage。
- AI 零负担,只在要 `dismissed`/override 时才显式说一句。

### 3. self-archive 内化(B+A):AI 不再输出触发文本
- 删 AI 输出 `self-archive policy triggered...`(省 token + 防 agent loop)。触发判定搬进 hook。
- 写 pending 后系统在 stderr 打**一行确定性回执**:`📥 已记 1 条 → pending/pitfalls/K-084 (撤销: 回 undo)`。
- **净结果:AGENTS.md 从"13 条考纲" → 瘦成说明书**(讲 fabric 替你做了什么,不是给 AI 背的题)。

---

## 二、交互层:4 个会话时刻(本版)

### 1. SessionStart 单 HUD(擂主+A 内容,剔 A 镀金)
- 一行人话 + 状态盘点:读/写 store · 激活规则数 · backlog 数。
- **不画 ASCII 大框**(A 的 box-drawing 太重,冷评判 gold-plating)——保持单行紧凑可读。**不报规则。**

### 2. PreToolUse 一行相关 + 被动补注入(擂主+C)
- 改文件那刻一行 `🗃️ 相关: K-002 atlas premultiplyAlpha 反向坑`。
- 系统被动注入(C):AI 即使漏了 recall,引擎也按 `paths` 静默把相关 KB 补进该次 tool call context,**不报错、不打断**(替代"惩罚式 nudge")。

### 3. archive 记知识 11→3 stage(擂主)+ Stage2 AST 去重闸(A)
- 收集 → **判重+归类(BM25F)**:重合 >85% 丢弃/追加 evidence;50-85% 或矛盾 → 标 `[CONFLICT:K-XXX]` 落盘;唯一 → 干净落盘 → 落 pending + 一行回执。
- 人工审核挪下游 fabric-review **单次**(消除双重审核)。3 stage 做成所有入口(手动/AI自触发/会话识别/backlog补/import)**共享内核**,仅 Stage1 扫描源可插拔。

### 4. nudge 双锚(C 修正擂主的洞)
- **review backlog nudge → SessionStart**(开局状态盘点,欢迎)。
- **archive cadence nudge → 留 Stop**(因"这批 edit 刚做完"信号只有 Stop 时完整),但做成响应式渐强(平时静默→过阈值一行→翻倍稍重不 blocking)。
- **不全搬 SessionStart**(擂主原案会让 archive 提示滞后一整个会话)。

---

## 三、后续集成路线(maestro→fabric,C 主导)

| 档位 | 集成项 | 判定 | 理由 |
|---|---|---|---|
| **本版** | BM25F 四字段 + CJK n-gram | 改造抄 | 中文 KB 召回硬伤;纯函数搬 search.ts:29-48/96-129,落 fab_recall 服务端不依赖 dashboard |
| **本版** | credibility 连续衰减乘子 | 改造抄 | **复用 events.jsonl 算 age→recall 时乘进 BM25,零新存储,不引 sqlite**(credibility.ts:78-87) |
| **vNext** | spec-setup 冷启动扫描(砍3步) | 改造抄 | 解零用户空 KB 冷启动,接进现有 fabric-import |
| **vNext** | knowhow recipe 维度 | 改造抄(只抄recipe) | 不抄 9 类型(过载);processes 支持可执行配方 |
| **vNext** | L3 e2e(archive→review 全链路) | 抄 | 54ca613 这条对了,核心资产缺端到端回归 |
| **不抄** | 7 视图 web dashboard | 错战场 | 无后端零用户;可视化落 AI 终端内不是浏览器 |
| **不抄** | sqlite credibility 表 | 错战场 | 无后端引 sqlite=新依赖+新 drift,只取算法不取存储 |
| **降级** | L4 大规模 stress | 延后 | 零用户无性能压力,54ca613 高估优先级 |

**比 54ca613 原 roadmap 更对**:原案按"maestro 有啥补啥"(用 fabric 短板追 maestro 长板);C1 按"能否在无后端 MCP+hook+markdown 形态存活"筛,每分成本加固护城河而非稀释。

---

## 四、证据锚点(嫁接 B/C 源码实证,补 C1 文档证据维)

> 这些行号来自 B(codex 读 fabric 源码)与 C(claude 读 maestro 源码)的实证,集中列出供落地时直接定位。

**策略层落点(fabric 现状,B 实证):**
- `packages/shared/src/schemas/api-contracts.ts:667` — 现 frontmatter/契约 schema(2 字段化的改造点)
- `packages/server/src/services/scope.ts:31` — scope 解析(layer/audience 推导落点)
- `packages/server/src/services/cross-store-write.ts:120/148` — 写入路由(audience→store 推导、防泄漏边界)
- cite/self-archive 内化:PreToolUse recall→events.jsonl 映射、PostToolUse 自动 cite-coverage(现有 events.jsonl 账本扩展)

**集成层落点(maestro 源码,C 实证):**
- `../maestro-flow/dashboard/src/server/wiki/search.ts:29-48` — FIELD_CONFIGS 四字段权重(BM25F 改造蓝本)
- `../maestro-flow/dashboard/src/server/wiki/search.ts:96-129` — CJK n-gram tokenize(逐字可抄)
- `../maestro-flow/dashboard/src/server/wiki/search.ts:294-334` — searchBM25F 主函数
- `../maestro-flow/src/graph/kg/credibility.ts:78-87` — computeDecayFactor 连续衰减(复用 events.jsonl age,**不抄 sqlite**)
- `../maestro-flow/src/graph/kg/credibility.ts:36-49` — 类型半衰期表
- `../maestro-flow/src/hooks/spec-injector.ts:79/293` — maestro "复杂度藏代码" 的对照样板

**设计原则锚点:**
- `design-research.md:47/274` — InKH 核心句 "complexity absorbed by system not transferred to user"
- `design-research.md:80-91` — responsive salience(nudge 渐强依据)
- `design-research.md:105-115` — progressive disclosure(HUD 单行+按需展开)
- `cross-product/conclusions.json:215-221` — `when` glob 直采 Copilot applyTo/Cursor globs 守跨端

---

## 收敛依据
三家独立挑战者强收敛于:**2 字段+引擎推导 / cite·self-archive 内化进 hook·ledger / BM25F本版零新存储 / 无 dashboard / dual-anchor nudge / AST 去重闸**。C1 = 取此交集 + 修 A 的 Location-is-Config 自相矛盾 + 剔镀金 + 嫁接 B/C 源码锚点。
