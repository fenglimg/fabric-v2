# MCP 工具交互触点等深度全审

> 范围:`packages/server/src/tools/*` + `index.ts`(tool 注册 + server instructions)+ `packages/shared/src/schemas/api-contracts.ts` 契约 schema。
> 使用者 = AI agent 自身。"好不好用" = LLM 不读文档能否直觉正确调用、返回结构解析顺不顺、命名是否自解释。
> 基线:C1 已落地(recall 自动 cite 记账、lean body、BM25F)。本审找 C1 之外的新问题。
> 横向参照:`maestro-flow/src/tools/team-tasks-mcp.ts`(同样 action-discriminated 单工具模式)。

---

## 一、Census 全集(4 个注册工具)

| 工具 | 注册位置 | 必填参数 | 可选参数(节选) | 返回关键字段 | annotations |
|------|---------|---------|------------------|-------------|-------------|
| `fab_recall` | `recall.ts:27` | `paths: string[].min(1)` | `intent`, `known_tech`, `detected_entities`, `client_hash`, `correlation_id`, `session_id`, `layer_filter(team\|personal\|both)`, `target_paths`, `ids`, `include_related` | `candidates[]`(描述索引)、`paths[]`(读取路径索引 `{stable_id,path,store?}`)、`entries[]`(per-path requirement_profile)、`intent`、`omitted_candidate_count?`、`preflight_diagnostics[]`、`redirects?`、`related_appended?`、`directive`(常驻 cite 指令)、`next_steps?`、`revision_hash`、`stale`、`auto_healed?`、`warnings?` | readOnly/idempotent ✓ |
| `fab_review` | `review.ts:25` | `action`(8 值枚举) + 各 action 条件必填 | 扁平 shape:`filters`、`pending_paths`、`pending_path`、`reason`、`changes`、`query`、`until`(实际必填性由 handler 内 `FabReviewInputSchema.parse` 的 discriminatedUnion 兜) | discriminatedUnion per-action:list→`items[]`、approve→`approved[]{pending_path,stable_id}`、reject→`rejected[]`、modify*→…、search→`items[]{area,path,...}`、defer→…;每分支带 `warnings?` | 无 readOnly(写工具) |
| `fab_archive_scan` | `archive-scan.ts:22` | (全可选) | `range(string[]\|"all")`、`now_ms`、`correlation_id`、`session_id` | `anchor_ts`、`session_ids[]`、`dropped[]{session_id,reason}`、`covered_through_ts`、`already_proposed_keys[]`、`warnings?` | readOnly/idempotent ✓ |
| `fab_extract_knowledge` | `extract-knowledge.ts:26` | `source_sessions[].min(1)`、`recent_paths[]`、`user_messages_summary`、`type`、`slug`、`proposed_reason`、`session_context(≥20)` | `audience`、`paths`、`intent_clues`、`tech_stack`、`impact`、`must_read_if`、`tags` | (output schema:pending_path 等) + `warnings?` | 写工具 |

**关键观察(census 即暴露的结构问题)**:
- 4 个工具命名分两类心智:`fab_recall`(读)直觉强;`fab_review` / `fab_extract_knowledge` / `fab_archive_scan` 是 **skill-side 工具**(描述里明写 "Skill-side tool — invoked by fabric-review" `review.ts:29`、"invoked at session-stop" `extract-knowledge.ts:30`)。即 **4 个工具里只有 1 个(`fab_recall`)是给 agent 在通用编码回合直接调的**,另 3 个预期由 skill 驱动。但它们平铺在同一个 MCP tool list 里,没有任何"我不该被你随手调"的信号 —— 见问题 §三.A。
- `fab_extract_knowledge` 的工具 **名(extract)与实际语义(persist 落盘 pending)完全错位** —— 见问题 §五.A,这是最严重命名问题。

---

## 二、`fab_recall` 审计

### 现状
- `recall.ts:30-31` description:一大段(~120 词)解释 candidates/paths 两索引 + "不返 bodies,Read `paths[].path` 取正文" + `ids` scope + `include_related`。
- 返回:`recallOutputSchema`(`api-contracts.ts:474-523`)。两步模型核心:`candidates[]`(描述)与 `paths[]`(读取路径)是**两个并列数组**,靠 `stable_id` 关联。
- `directive`(`recall.ts:66`)= 常驻 cite 自动记账指令;`next_steps`(`recall.ts:173`)= 截断/related 动态提示。
- `always_active`(`api-contracts.ts:89`)标记某 candidate 的 body 已在 SessionStart 全量注入,叫 agent 别浪费一次 Read。

### 问题

**交互角度(对 agent)**:
1. **`candidates[]` 与 `paths[]` 双数组靠 `stable_id` join,是给 agent 的关系型负担**(`api-contracts.ts:491` vs `496`)。agent 想"读第 1 个候选的正文",得先从 `candidates[0].stable_id` 拿到 id,再去 `paths[]` 里线性找同 id 的 `path`。两步模型本身没问题,但**把 description 和它的 read-path 拆成两个数组**是反直觉的 —— 自然结构是"每个候选对象上直接挂 `path`"。当前设计源于 `ids` 能让 `paths[]` 比 `candidates[]` 短(scope 过滤),但代价是**稳态(不传 ids)下 agent 永远要做一次 join**,而稳态是 99% 的调用。
2. **`always_active` 是布尔且"only ever true"(`api-contracts.ts:88`),但 agent 不读这条注释**。一个 candidate 没有 `always_active` 字段时,agent 无法区分"body 没注入(该 Read)"和"字段被省略"。语义靠"缺失=false"约定,对 LLM 不可靠。
3. **`directive` 是每次 recall 都返回的常驻字符串**(`recall.ts:66-67`,~50 词)。它是行为指令不是数据,塞进数据返回体里,每次 recall 都重灌一遍 —— 与 C1 "lean body 不每轮重灌" 的精神相悖(只是换成了重灌 directive 而非 body)。server-level instructions(`index.ts:210`)里已有 "Cite the KB id you applied or dismissed" —— **directive 与 server instructions 内容重叠**,每 call 重发是冗余。
4. **`entries[]`(per-path requirement_profile)对 agent 几乎无用**(`api-contracts.ts:480-485`)。`requirement_profile` 只剩 `{target_path, known_tech, detected_entities}`(`api-contracts.ts:105`)—— 全是**caller 自己刚传进来的输入回声**。agent 传了 paths/known_tech,recall 又把它们逐 path 抄回来。C1 已删了 `user_intent` 的 per-path 复制,但 `entries[]` 整个数组仍是纯输入回声,N 个 path 就 N 份,是 payload 噪声。

**策略角度**:
5. **`omitted_candidate_count` 的补救建议自相矛盾**。schema 注释(`api-contracts.ts:505`)和 next_steps(`recall.ts:183`)都说 "pass a narrower intent ... to surface them"。但**收窄 intent 不会让被预算截掉的低分候选浮上来** —— 收窄只会让排序更聚焦,低分项更沉。真正能 surface 的是 *raise top_k* 或换关键词。这条 hint 给 agent 的是错误的自救方向。
6. **BM25F 排序(C1)+ topK 截断,但 agent 看不到分数**。`candidates[]` 只有 ranked 顺序,无 relevance score。agent 无法判断"第 3 个候选是 0.9 还是 0.2",只能要么全信要么全读。一个 `score` 或 `confidence` 字段能让 agent 自己决定读几条正文。

### 方案

**A(激进,推荐):合并 `candidates[]` + `paths[]` 为单一 `candidates[]`,read-path 作为每项的字段。**
```
before:
  candidates: [{stable_id, description, always_active?}]
  paths:      [{stable_id, path, store?}]   // 靠 stable_id join
after:
  candidates: [{
    stable_id, description,
    read_path: string,        // 直接挂在候选上,无需 join
    store?: {alias},
    body_already_in_context?: boolean,  // 重命名 always_active,语义自解释
    score?: number            // 暴露 BM25F 相关性,让 agent 决定读几条
  }]
```
`ids` scope 的语义改为"过滤 `candidates[]` 本身"(本就该如此 —— scope 掉的候选连描述都不必给)。`include_related` 追加项即追加 candidate 对象。**join 消失,自然结构。**
- 价值÷成本:**高**。消除每次稳态调用的 join 负担 + 修 always_active 语义模糊 + 给 score。成本:改 1 个 output schema + recall.ts 组装逻辑 + 测试;`paths[]` 有下游消费者(cite 记账键 off `target_paths`,见 MEMORY `project_recall_cite_accounting_locus`)需确认不受影响。零用户无兼容包袱,适合现在做。

**B:`directive` 移出每-call 返回,只放 server instructions。** server instructions 在 `initialize` 时发一次即可承载 cite 约定(`index.ts:210` 已有)。recall 返回体删 `directive`,保留动态的 `next_steps`(那是 per-call 变化的真信息)。
- 价值÷成本:**中高**。每 call 省 ~50 词常驻噪声,与 C1 lean 精神一致。成本:删字段 + 把 dismiss 语法挪进 server instructions。

**C:删 `entries[]` 输入回声数组。** requirement_profile 全是输入回声,agent 不需要服务端抄回。若 cite 记账内部需要 target_paths,在服务端保留、不上 wire。
- 价值÷成本:**中**。省 N 份 per-path 噪声。成本:确认无下游消费 `entries[]`。

**D:修 `omitted_candidate_count` 的自救 hint** —— 把 "narrower intent" 改成 "raise plan_context_top_k(配置)或更换关键词";narrower intent 是错误方向。
- 价值÷成本:**高**(改 2 处字符串,修一个会误导 agent 的 bug)。

---

## 三、`fab_review` 审计(用户点名 action 命名)

### 现状
- `review.ts:29` description:"Discriminated by `action`: list (enumerate), approve (...), reject/modify/search/defer (TASK-002)"。
- 8 个 action:`list | approve | reject | modify | modify-content | modify-layer | search | defer`(`api-contracts.ts:1021`)。
- MCP SDK 限制:discriminatedUnion 不能直接做 inputSchema,所以对外暴露 **扁平 `FabReviewInputShape`**(`api-contracts.ts:1019`):`action` 必填 + 其余字段全 `.optional()`;真正的 per-action 必填性靠 handler 内 `FabReviewInputSchema.parse`(`review.ts:48`)兜。

### 问题

**交互角度(对 agent)** —— 这是本类最大的直觉性黑洞:
1. **扁平 shape 对 agent 撒谎:所有 per-action 字段都显示 `optional`**(`api-contracts.ts:1028-1064`)。LLM 读 inputSchema 看到 `pending_paths` optional、`reason` optional,完全无法从 schema 推断"`action=reject` 必须给 `reason`"。约束只活在 handler 的 runtime parse 里 —— **agent 第一次必然调错,靠 zod 报错才学会**。这是 schema 与契约的结构性裂缝(代码注释 `api-contracts.ts:1006-1018` 自己承认了)。
2. **8 个 action 里 `modify` / `modify-content` / `modify-layer` 三件套对 agent 是认知地狱。** `modify` 是 legacy combined alias(`api-contracts.ts:978`),按 `changes.layer` 是否存在路由;`modify-content` 禁止带 layer;`modify-layer` 强制带 layer。一个第一次见的 LLM 面对"modify / modify-content / modify-layer"必然懵:我该用哪个?legacy alias 留着只增加选择困难,无用户需兼容。
3. **action 命名本身评分**(裸看 name+desc 能否猜对用途):
   - `list` ✓ 直觉 / `search` ✓ / `approve` ✓ / `reject` ✓ / `defer` ✓(稍弱,但 reason 字段帮忙)
   - `modify` / `modify-content` / `modify-layer` ✗✗ —— 三选一无法直觉区分。

**策略角度**:
4. **`fab_review` 既是 list/search(读)又是 approve/reject(写),annotations 无 readOnlyHint** —— 整个工具被标成有副作用,但 `list`/`search` 是纯读。agent 若有"只读探查"诉求,会误以为 review 全程有副作用。读写混在一个工具削弱了 annotation 的指导价值。
5. **`filters.include_body`(`api-contracts.ts:918`)默认 off 是对的(防 prompt-injection),但 agent 不读那段注释**,可能在 approve 前不开 body 就批准,绕过了"先看正文再批"的安全意图。约束靠 skill 流程而非 schema 强制。

### 横向参照(maestro-flow `team_task`)
maestro-flow 用**完全相同**的 flat-shape + action 模式(`team-tasks-mcp.ts:438`,operation enum + 其余 optional),但有两个 Fabric 缺的关键 UX 补偿:
- description 里嵌一整块 **"Operations & Required Parameters"**(`team-tasks-mcp.ts:413-436`),逐 action 列必填/可选参数 + **REQUIRED** 加粗。LLM 不需 trial-and-error 就知道每个 action 要什么。
- 每个参数 description 用 **`[create]` / `[update/get]` 前缀**(`team-tasks-mcp.ts:452`)标明所属 action。

Fabric `fab_review` 的参数 description 已部分有 `[action]` 语义("Required when action=approve|reject|defer" `api-contracts.ts:1033`),但 **顶层 description(`review.ts:29`)缺 maestro 那种逐 action 的 required-param 清单** —— 这是低成本高回报的直接补法。

### 方案

**A(高价值低成本,直接抄 maestro-flow):重写 `fab_review` 顶层 description,嵌入逐-action required-param 块。**
```
before: "Discriminated by `action`: list (enumerate), approve (...), reject/modify/search/defer"
after(摘要):
  "Triage pending knowledge. Pick `action`, supply that action's required params:
   - list:    [filters?]
   - search:  query(REQUIRED) [filters?]
   - approve: pending_paths(REQUIRED non-empty)
   - reject:  pending_paths(REQUIRED) reason(REQUIRED)
   - defer:   pending_paths(REQUIRED) [until] [reason]
   - modify:  pending_path(REQUIRED) changes(REQUIRED) — scalar edits + optional layer flip
   Read-only actions: list, search."
```
补偿 flat-shape 的 optional 谎言。价值÷成本:**高**(纯文案,无代码改动,直接消除 agent 第一次调错)。

**B(激进):砍掉 `modify` legacy alias,只留 `modify`(合并后)或干脆 `modify-content` + `modify-layer` 两个。** 零用户无兼容包袱。推荐保留**单个 `modify`**,layer flip 由 `changes.layer` 存在与否自动路由(即现 legacy 行为),删掉 `modify-content`/`modify-layer` 两个显式变体 —— agent 只需记一个 modify,带不带 layer 自己决定。
- 价值÷成本:**高**。8 action → 6 action,消除三件套选择困难。成本:删 2 个 union 分支 + handler 路由 + 测试;确认 skill(fabric-review)未硬编码 modify-content/modify-layer。

**C:拆读写 —— 把 `list`/`search` 抽成独立只读工具 `fab_review_list`(readOnlyHint:true),`fab_review` 只留写动作。**
- 价值÷成本:**中**。annotation 恢复指导价值,但增加工具数(与 §三.A "工具太多" 张力)。优先级低于 A/B。

---

## 四、`fab_archive_scan` 审计

### 现状
- `archive-scan.ts:26` description 极详:"Finds the most-recent knowledge_proposed anchor, forward-collects distinct session_ids... drop user_dismissed / 12h cooldown / watermarked..."。
- 全参数可选;返回 `session_ids[]` + `dropped[]` + `already_proposed_keys[]` + `anchor_ts`/`covered_through_ts`。

### 问题
**交互角度**:
1. **这是纯 skill-internal 工具,description 满是 agent 用不上的内部状态机术语**("forward-collect"、"outcome-ledger filter"、"watermarked")。一个通用 agent 看到 `fab_archive_scan` 在 tool list 里,无法判断"我该不该调它"。它**预期只被 fabric-archive skill 调用**,但平铺在 MCP 工具列表里没有任何 gating。
2. 返回结构对 skill 是合理的(deterministic scan → session_ids → skill 加载 digest)。对随手调用的 agent 则是一堆 `session_id` 字符串和 `ts` 数字,无可操作语义。

**策略角度**:
3. `dropped[].reason` 枚举(`user_dismissed|cooldown|no_new_signal`)做得好 —— 给了审计可观测性。**这是 4 工具里错误/边界信息最完善的**,可作为其他工具的参照模板。

### 方案
**A:description 加一行 "Skill-internal: driven by fabric-archive; agents should invoke the fabric-archive skill, not this tool directly."** 与 §六 的"工具受众分层"统一处理。
- 价值÷成本:**中**(一行文案,降低 agent 误调)。

---

## 五、`fab_extract_knowledge` 审计

### 现状
- `extract-knowledge.ts:30` description:"**Persist** a proposed pending knowledge entry into ... knowledge/pending/<type>/<slug>.md. Idempotent on (source_sessions[0], type, slug)..."。
- 7 必填 + 8 可选(`api-contracts.ts:667-792`),是 4 工具里参数最多的。

### 问题
**交互角度** —— 最严重的命名错位:
1. **工具名 `extract` 与实际语义 `persist(写盘)` 完全相反。** description 第一个词就是 "Persist"(`extract-knowledge.ts:30`),server instructions 却说 "`fab_extract_knowledge` — **extract** structured knowledge from text you supply"(`index.ts:203`)—— **同一工具,description 说写、instructions 说抽取,自相矛盾**。LLM 看名字 "extract knowledge from text" 会以为这是个"给我文本、我帮你抽出结构"的**纯函数读工具**,实际它是把 agent 已组装好的 7+ 字段结构**落盘成 pending 文件**的写工具。这个错位会导致 agent:(a)以为传一段原始对话就能调它(实际要先自己抽好所有结构化字段);(b)不知道它有副作用(写文件)。
2. **7 个必填字段对 agent 是高门槛**:`source_sessions`、`recent_paths`、`user_messages_summary`、`type`、`slug`、`proposed_reason`、`session_context(≥20 字符)`。这是个 skill 用 LLM 预处理后才能填的表,**不是 agent 随手能正确调用的工具** —— 再次印证它是 skill-side(`extract-knowledge.ts:30` 明写 "invoked at session-stop")。

**策略角度**:
3. `session_context.min(20)`(`api-contracts.ts:717`)的报错信息友好("must be ≥20 chars (3-5 lines...)")—— 好。但 `audience` 的 regex `SCOPE_COORDINATE_PATTERN`(`api-contracts.ts:701`)若不匹配,zod 默认报 "Invalid" 不带模式说明,agent 无法自救 —— 见 §七。

### 方案
**A(高价值低成本):工具改名 `fab_extract_knowledge` → `fab_propose_knowledge` 或 `fab_write_pending`,并统一 server instructions 措辞。** 名字必须反映"写盘 pending"语义,消除与 instructions 的"extract from text"矛盾。同时改 `index.ts:203` 那行为 "persist a structured pending knowledge entry"。
- 价值÷成本:**高**(改名 + 1 行 instructions;消除最严重语义错位)。激进但零用户无包袱,现在改最便宜。

**B:server instructions 区分"agent 直调工具"vs"skill 工具"。** instructions 现把 4 工具平列(`index.ts:202-205`),应标注哪个是 agent 通用回合直调(只有 `fab_recall`),哪 3 个是 skill 驱动。

---

## 六、返回 payload 专项

### 现状
- 所有 4 工具走相同信封:`{content:[{type:"text",text:JSON.stringify(response)}], structuredContent:response}`(如 `recall.ts:97-100`)—— **同一份 JSON 既塞进 text content 又塞进 structuredContent,double payload**。
- payload 守护:`enforcePayloadLimit`(`recall.ts:89`)+ `appendPayloadWarning`(`payload-warning.ts:30`)统一软警告 + `action_hint`(C1 已把 4 工具 symmetric 化,`payload-warning.ts:1-9`)。
- 截断信号:`omitted_candidate_count`(recall)、`dropped[]`(archive-scan)。

### 问题
1. **`content[].text` = `JSON.stringify(structuredContent)` 完全重复**(`recall.ts:98-99`)。MCP 客户端若同时消费 text 和 structuredContent,等于双倍 token。这是 MCP SDK 的常见模式但对 payload 预算不友好 —— 大返回(recall 满 candidates)直接翻倍。
2. **payload-warning 的 `action_hint` 给的自救方向同样有 recall 的 narrower-intent 谬误**(`recall.ts:93` "narrower `intent`")—— 与 §二.5 同源 bug。
3. **截断只给 count 不给"被截了哪些"**。`omitted_candidate_count: 5` 告诉 agent "还有 5 个",但 agent 无从知道是否包含它真正需要的那条。archive-scan 的 `dropped[]{session_id,reason}` 模式更好(给了被丢的 id + 原因),recall 可借鉴。

### 方案
**A:`content[].text` 改为人类可读的精简摘要,而非 structuredContent 的完整 JSON 复制。** 例如 recall 返回 `text: "Recalled 4 KB entries (3 read-paths). Top: KT-DEC-0026. Read paths in structuredContent.paths."`,完整数据只在 structuredContent。消除 double payload。
- 价值÷成本:**中高**(大返回省一半 token)。成本:每工具改 text 组装;需确认无客户端只读 text content。

**B:修 payload-warning 的 recall action_hint** —— 同 §二.D,narrower intent → raise top_k。
- 价值÷成本:**高**(改 1 行字符串)。

---

## 七、错误/边界专项

### 现状
- `fab_review` / `fab_extract_knowledge` 靠 handler 内二次 `.parse()` 把 flat-shape 收窄回严格 union(`review.ts:48`、`extract-knowledge.ts:49`)。parse 失败抛 zod 原始 error。
- `first-reconcile-gate` 的 `gateWarning` 以 structured warning 形式进 `warnings[]`(`recall.ts:59`)。
- recall 的 telemetry(`mcp_stdio_trace`)best-effort 包 try/catch,永不阻断(`recall.ts:106-126`)—— 好。

### 问题
1. **zod parse 失败的 error 直接抛给 agent,无 action-specific 修复指引。** `fab_review` 若 agent 调 `action=reject` 漏 `reason`,zod 报 "reason: Required" —— 但因为 flat-shape 把 reason 标 optional(§三.1),agent 看 schema 时根本没料到要给,报错时也没有"reject 需要 reason"的上下文映射。错误信息不足以让 agent 一次自我纠正。
2. **`audience` 的 `SCOPE_COORDINATE_PATTERN` regex 失败**(`api-contracts.ts:701`)默认 zod 报 "Invalid",不给合法模式示例。agent 无法从错误推出该传 `team`/`project:x`/`personal`。
3. **archive-scan 的 `dropped[].reason` 是正面范例** —— 结构化、枚举化的"为什么没纳入"。其他写工具的拒绝路径(review reject / extract 幂等跳过)缺这种结构化 reason 回执。

### 方案
**A:handler catch zod error,映射成带 action 上下文的 structured 错误回执。** 例如 reject 漏 reason → `{error:"action=reject requires non-empty `reason`", action_hint:"retry with reason explaining the rejection"}`。让 agent 一次纠正而非反复试。
- 价值÷成本:**中高**。成本:每个二次-parse 工具加 catch 映射。

**B:给 regex 字段加 `.describe` 示例 + 自定义 zod error message**(`audience` → "expected: team | personal | project:<id> | org:<id>")。
- 价值÷成本:**中**(改 schema describe + refine message)。

---

## 八、本类 Top 5 高价值改动

| # | 改动 | 触点 | 价值÷成本 | 激进? |
|---|------|------|----------|-------|
| **1** | **`fab_extract_knowledge` 改名为 `fab_propose_knowledge`/`fab_write_pending`** + 统一 server instructions 措辞,消除"名说 extract / 实为 persist"且与 instructions 自相矛盾的最严重语义错位(`extract-knowledge.ts:30` vs `index.ts:203`) | extract | **极高**(改名+1行) | 激进✓ |
| **2** | **合并 recall `candidates[]`+`paths[]` 为单数组**,read_path/score/`body_already_in_context` 直接挂候选,消除稳态每调一次的 stable_id join(`api-contracts.ts:491` vs `496`) | recall | **高** | 激进✓ |
| **3** | **`fab_review` 顶层 description 嵌逐-action required-param 清单**(抄 maestro-flow `team_task` 模式 `team-tasks-mcp.ts:413`),补偿 flat-shape 把必填字段全标 optional 的"schema 撒谎"(`api-contracts.ts:1028`) | review | **高**(纯文案) | 否 |
| **4** | **砍 `modify`/`modify-content`/`modify-layer` 三件套为单个 `modify`**,消除 agent 选择困难(`api-contracts.ts:978-991`) | review | **高** | 激进✓ |
| **5** | **修 recall 截断/payload 的 "narrower intent" 错误自救建议**(收窄不会让被预算截掉的低分项浮现;应为 raise top_k / 换关键词),3 处:`api-contracts.ts:505`、`recall.ts:183`、`recall.ts:93` | recall | **高**(改字符串,修误导 bug) | 否 |

**贯穿性主题**:4 个 MCP 工具里只有 `fab_recall` 是 agent 通用回合该直调的;另 3 个是 skill-driven 但平铺在同一 tool list 无受众分层信号 —— 建议 server instructions(`index.ts:202`)显式标注"agent-direct vs skill-internal",降低误调(贯穿 §三.A / §四.A / §五.B,单独成中价值改动)。
