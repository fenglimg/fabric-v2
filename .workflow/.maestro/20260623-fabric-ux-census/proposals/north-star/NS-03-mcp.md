# NS-03 · MCP 工具面北极星重设计

> 命题:**若从零给 AI agent 设计 Fabric 的 MCP 工具面 —— 几个工具、各自什么名、什么返回形态?**
> 消费者 = AI agent(LLM 自身)。北极星标准 = **不读文档就能正确首调**:工具数量对、名字自解释、required 在 schema 层可推断、返回免 join、payload 不浪费。
> 输入:`03-mcp.md`(touchpoint census)+ `00-SYNTHESIS.md`(T4 命名撒谎主题)。横向参照:maestro-flow `team_task`(flat-shape 标准补法)。
> 基线授权:零用户、clean-slate、无兼容包袱。本文给**目标态**,不是 patch list。

---

## ① 现状 4 工具 + 存在性裁决

### 现状 census

| 工具 | 受众真相 | 角色 | 北极星病灶 |
|------|---------|------|-----------|
| `fab_recall` | **agent 直调**(唯一) | 读:取相关 KB 描述 + 读取路径 | 双数组 `candidates[]`/`paths[]` 靠 `stable_id` join;`directive` 每调重灌;`entries[]` 纯输入回声;无 score |
| `fab_review` | skill-driven (`fabric-review`) | 写为主 + list/search 读:pending triage | flat-shape 把 per-action required 全标 `optional`(schema 撒谎);`modify`/`modify-content`/`modify-layer` 三件套;读写混在一个工具无 readOnly 分层 |
| `fab_archive_scan` | skill-internal (`fabric-archive`) | 读:确定性 ledger 扫描出候选 session | description 满是内部状态机术语;agent 无法判断该不该调 |
| `fab_extract_knowledge` | skill-driven (session-stop) | 写:把已组装结构落盘 pending | **名说 extract(读)实则 persist(写)**,且与 server instructions "extract from text" 自相矛盾;7 必填字段,非 agent 随手可调 |

### 核心洞察:工具面混了**两类消费者**

4 个工具平铺在同一 MCP tool list,但实际分两层:

- **Agent-tier**(通用编码回合直调):只有 `fab_recall`。
- **Skill-tier**(由 skill 用 LLM 预处理后驱动):`fab_review` / `fab_archive_scan` / `fab_extract_knowledge`。

北极星问题不是"4 个多还是少",而是 **agent 看不出哪个该自己调、哪个是 skill 的内部管道**。一个第一次连上 Fabric 的 LLM 面对 4 个平铺工具,会把 `fab_extract_knowledge`(名字像"给文本抽知识")当成可随手调的读工具 —— 这是最危险的误调路径。

### 存在性裁决

| 工具 | 裁决 | 理由 |
|------|------|------|
| `fab_recall` | **KEEP + RESHAPE** | 唯一 agent-tier 工具,职责正确;但返回形态要重构(单数组 + score + 去 directive/echo) |
| `fab_extract_knowledge` | **RENAME → `fab_propose`** | 名实错位(synthesis T4 列为 MCP 最严重命名病);"extract" 误导 agent 以为是读工具。新名 `fab_propose` 自解释"提议一条知识落盘 pending" |
| `fab_review` | **KEEP + SPLIT(读写分离)** | list/search(读)抽成独立只读 `fab_pending`(原 list/search),`fab_review` 只留写动作(approve/reject/modify/defer)。恢复 readOnlyHint 指导价值 + 消除 flat-shape 谎言面 |
| `fab_archive_scan` | **MERGE → `fab_propose`(scan mode)** | archive_scan + extract 是**同一"写入流"的两半**:scan 找候选 → extract 落盘。合成一个 `fab_propose`,`mode:"scan"` 找候选、`mode:"write"` 落盘。一个写入流一个工具名 |

**4 → 4(但成员换了):**

```
fab_recall    (agent-tier, 读)      ← KEEP + reshape
fab_pending   (skill-tier, 只读)    ← NEW (从 fab_review 抽 list/search)
fab_review    (skill-tier, 只写)    ← KEEP 写动作 + split
fab_propose   (skill-tier, 写)      ← MERGE(archive_scan + extract)+ RENAME
```

> 为什么不是更少?试过把 `fab_pending` 折回 `fab_review`、把 `fab_propose` 的 scan/write 拆两个工具 —— 都更差。**读写分离**让 annotation(readOnlyHint)重新可信,agent 探查 pending 时知道零副作用;**写入流合并**让 "scan→write" 两步对 agent 是同一工具的两个 mode,而非两个名字。4 是收敛后的稳态,不是没动。

---

## ② 目标工具集(4 个)+ schema/返回草案

通用约定(4 工具统一):
- **返回 envelope**:`structuredContent` 携完整数据;`content[].text` 只放**人类可读单行摘要**(非 JSON 复制),消除现状 double-payload(`recall.ts:98` 把 `JSON.stringify(structuredContent)` 又塞进 text)。
- **required 可推断**:能用真 Zod required(非 flat-shape)的就用;必须 flat-shape 的(action-discriminated)走 maestro-flow 标准补法 —— description 内嵌逐-action required 清单 + 参数 `[action]` 前缀。
- **错误回执**:handler catch zod parse error,映射成 `{ error, action_hint }` 带 action 上下文,让 agent 一次自纠。
- **自救方向正确**:删 "narrower intent" 谬误(收窄 intent 不会让被预算截掉的低分项浮现),改 "raise top_k / 换关键词"。

---

### 2.1 `fab_recall` — agent-tier 读(唯一 agent 直调)

**职责**:改文件前一调,拿回相关 KB 的描述 + 读取路径。两步取正文模型的入口。

**input schema**(真 required,无 flat-shape):

```ts
{
  paths: string[]        // REQUIRED, min(1). 你即将改动的文件路径
  intent?: string        // 可选. 你要做什么(自然语言),用于排序
  known_tech?: string[]  // 可选. 涉及的技术栈
  session_id?: string    // 可选但强烈建议. 当前 client session id,
                         //   用于跨会话 knowledge-debt 追踪
  ids?: string[]         // 可选. 已知要哪几条时,scope 候选集本身
  include_related?: boolean  // 可选. 追加一跳 related 邻居
}
```

> 砍掉现状的 `detected_entities` / `client_hash` / `correlation_id` / `target_paths` / `layer_filter` —— 对 agent 是噪声参数(内部遥测/回声/罕用 scope),收进服务端默认或并入 `intent`。**agent 面只剩 6 个、3 个常用**。

**返回形态(核心重构:单数组,免 join)**:

```jsonc
{
  "intent": "refactor sprite atlas loader",   // 回声一次(非每 path N 份)
  "entries": [                                  // ← candidates[]+paths[] 合并成单数组
    {
      "id": "KT-PIT-0007",
      "summary": "atlas.premultiplyAlpha flag 方向反了会致 sprite 黑边",
      "must_read_if": "touching anything under atlas/loader",
      "read_path": "team-store/knowledge/pitfalls/KT-PIT-0007--atlas-premul.md",
      "store": "team-store",                    // 省略=unqualified
      "score": 0.91,                            // ← 暴露 BM25F 相关性
      "body_in_context": false,                 // ← 重命名 always_active,语义自解释
      "related": ["KT-MOD-0001"]
    }
  ],
  "omitted_count": 5,                           // >0 = 还有更低分的没浮出
  "more_hint": "raise plan_context_top_k or refine keywords to surface them",
  "revision_hash": "...", "stale": false,
  "warnings": []                               // 结构化软警告,无 directive 常驻字符串
}
```

**重构点(对 agent 最关键)**:
1. **`candidates[]` + `paths[]` → 单 `entries[]`**,`read_path` 直接挂条目上。agent "读第 1 条正文" = `entries[0].read_path` 做原生 Read,**不再 stable_id join**(稳态 99% 调用受益)。`ids` scope 改为过滤 `entries[]` 本身。
2. **`score` 字段**:暴露 BM25F 相关性,agent 自己决定读几条正文(0.91 读、0.2 跳),不再要么全信要么全读。
3. **`body_in_context`**(原 `always_active`):布尔语义自解释 —— true = body 已在 SessionStart 全量注入,别浪费 Read。
4. **删 `directive`**:cite-before-edit 约定属行为指令,搬进 server instructions(initialize 发一次),不每 call 重灌 ~50 词。
5. **删 `entries[].requirement_profile`**:纯输入回声(caller 刚传的 known_tech/entities 抄回),服务端 cite 记账内部保留、不上 wire。
6. **`omitted_count` + 正确 `more_hint`**:修 narrower-intent 谬误。
7. **content[].text** = `"Recalled 4 KB (top KT-PIT-0007, score .91). Read paths in entries[]."`,完整数据只在 structuredContent。

annotations:`readOnlyHint:true, idempotentHint:true`。

---

### 2.2 `fab_pending` — skill-tier 只读(从 fab_review 抽出)

**职责**:枚举 / 搜索 pending 知识。纯读,无副作用。

**input**(真 required):

```ts
{
  query?: string                              // 可选. 全文搜索(omit=list all)
  filters?: { type?, status?, store?, audience? }  // 可选. 结构化过滤
  include_body?: boolean                      // 可选,默认 false(防 prompt-injection)
}
```

**返回**:

```jsonc
{
  "items": [
    { "pending_path": "...", "type": "pitfalls", "slug": "...",
      "summary": "...", "proposed_reason": "...", "audience": "team",
      "body": null }                          // include_body:true 才填
  ],
  "total": 14,
  "warnings": []
}
```

> 拆出来的收益:**readOnlyHint:true 重新可信** —— agent 探查 backlog 时知道零副作用;`fab_review` 不再读写混杂。`include_body` 默认 off 的安全意图(批前先看正文)由独立工具 + description 明示承载,而非藏在大工具的某个 filter 注释里。

annotations:`readOnlyHint:true, idempotentHint:true`。

---

### 2.3 `fab_review` — skill-tier 只写(triage 决策)

**职责**:对 pending 做 approve / reject / modify / defer。**只写**(list/search 已搬 `fab_pending`)。

action 从 8 收敛到 **4**:
- 删 `list` / `search`(→ `fab_pending`)。
- **`modify` 三件套 → 单 `modify`**:layer flip 由 `changes.layer` 存在与否自动路由(现 legacy 行为),删 `modify-content` / `modify-layer` 显式变体。agent 只记一个 modify。

**input**(MCP SDK 要求 action-discriminated 必须 flat-shape → 走 maestro 标准补法):

```ts
// flat shape(SDK 限制),required 靠 description 清单 + handler 二次 parse 兜
{
  action: "approve" | "reject" | "modify" | "defer"   // REQUIRED
  pending_paths?: string[]   // [approve/reject/defer] 目标条目
  pending_path?: string      // [modify] 单条目标
  reason?: string            // [reject REQUIRED] [defer 可选]
  changes?: object           // [modify REQUIRED] 标量补丁(含可选 layer→自动 flip)
  until?: string             // [defer 可选] 重审时点
}
```

**description 内嵌逐-action required 清单(maestro-flow `team_task` 标准补法,补偿 flat-shape 的 optional 谎言)**:

```
Triage pending knowledge (WRITE). Read-only enumeration lives in `fab_pending`.
Pick `action`, supply that action's REQUIRED params:

  approve: pending_paths (REQUIRED, non-empty) — allocate stable_id, promote to canonical
  reject:  pending_paths (REQUIRED) + reason (REQUIRED) — move to rejected/, reason is the knowledge
  modify:  pending_path (REQUIRED) + changes (REQUIRED) — scalar patch;
           include changes.layer to flip store, omit to edit in place
  defer:   pending_paths (REQUIRED) + [until] [reason] — re-surface later
```

每参数 description 带 `[action]` 前缀(`[reject] Why rejected — the reason itself is captured as knowledge`)。

**返回**(per-action discriminated,每分支带结构化 reason 回执):

```jsonc
// approve
{ "action": "approve", "approved": [{ "pending_path": "...", "stable_id": "KT-DEC-0042" }], "warnings": [] }
// reject — 借鉴 archive_scan 的 dropped[] 结构化 reason 范例
{ "action": "reject", "rejected": [{ "pending_path": "...", "reason": "outdated" }], "warnings": [] }
```

**错误回执**(修 §七:zod fail 映射成 action 上下文):
```jsonc
{ "error": "action=reject requires non-empty `reason`",
  "action_hint": "retry with reason explaining the rejection" }
```

annotations:`readOnlyHint:false`(纯写,诚实)。

---

### 2.4 `fab_propose` — skill-tier 写(MERGE: archive_scan + extract)

**职责**:知识写入流。**一个工具两 mode** —— `scan` 找候选 session,`write` 把组装好的结构落盘 pending。合并消除"两个名字一条流"。

**input**(mode-discriminated flat-shape,同补法):

```ts
{
  mode: "scan" | "write"      // REQUIRED
  // ── mode=scan(原 fab_archive_scan)──
  range?: string[] | "all"    // [scan 可选] 限定 session 范围
  // ── mode=write(原 fab_extract_knowledge)──
  source_sessions?: string[]       // [write REQUIRED, min(1)] 来源 session
  type?: "decisions"|"pitfalls"|"guidelines"|"models"|"processes"  // [write REQUIRED]
  slug?: string                    // [write REQUIRED] URL-safe 短标识
  summary?: string                 // [write REQUIRED] 一句话知识正文
  session_context?: string         // [write REQUIRED, ≥20 chars] 目标+转折点
  proposed_reason?: enum           // [write REQUIRED] 为何提议
  audience?: string                // [write 可选] WHO(personal|team|project:x);
                                   //   omit→engine 默认。regex 失败给合法示例
  paths?: string[]                 // [write 可选] relevance 锚点(非空→narrow)
  intent_clues? tech_stack? impact? must_read_if? tags?   // [write 可选] 结构化元数据
}
```

**description(逐-mode required 清单)**:

```
Knowledge write flow. Two modes:

  scan:  find archive-worthy sessions since the last proposal (deterministic
         ledger scan; drops dismissed / cooldown / no-new-signal). No required
         params. → returns session_ids ready for digest load.
  write: PERSIST one assembled pending entry to the active write store's
         knowledge/pending/<type>/<slug>.md. Idempotent on (source_sessions[0],
         type, slug) — repeat appends evidence.
         REQUIRED: source_sessions, type, slug, summary, session_context, proposed_reason
```

**返回**:

```jsonc
// mode=scan(原 archive_scan,保留其 dropped[] 结构化 reason 范例 —— 4 工具里最好的边界回执)
{ "mode": "scan", "session_ids": ["s1","s2"],
  "dropped": [{ "session_id": "s3", "reason": "user_dismissed" }],
  "already_proposed_keys": ["pitfalls/atlas-premul"],
  "anchor_ts": 1..., "covered_through_ts": 1... }
// mode=write
{ "mode": "write", "pending_path": "team-store/knowledge/pending/pitfalls/atlas-premul.md",
  "idempotency": "created" | "appended" }
```

**错误回执**:`audience` regex 失败 →
```jsonc
{ "error": "audience must be a scope coordinate",
  "action_hint": "expected: personal | team | project:<id> | org:<id>" }
```

annotations:`readOnlyHint:false`(write mode 写盘;scan 虽只读,但工具整体有写 mode,标 false 诚实;scan 的只读性由 description 说明)。

> 命名:`fab_propose` 而非 `fab_write_pending` —— "propose" 表达"提议一条进 pending 待审"的语义(它不是直接 canonical 写入,要经 `fab_review` approve),比 "write" 更准。彻底消除 "extract" 的读语义误导。

---

## ③ Server instructions 改写草案

现状 `index.ts:194-211` 病灶:(a)4 工具平铺无受众分层;(b)`fab_extract_knowledge` 行说 "extract from text" 与其 description "Persist" 矛盾;(c)conventions 里 "narrower intent" 谬误。

```text
Fabric is a cross-client knowledge layer: durable team/personal decisions,
pitfalls, guidelines, models, and processes this server surfaces so you do not
re-learn them each session.

═══ Two-step retrieval — do this BEFORE you edit code or commit to a decision ═══
1. Call `fab_recall(paths)` with the files you are about to touch. It returns
   `entries[]` — each with a DESCRIPTION (summary / must_read_if) AND its
   `read_path`. No bodies are returned.
2. To load an entry's full body, Read its `read_path` (native file read) — that
   is observed as `knowledge_body_read`. `score` tells you which entries are
   worth reading; `body_in_context:true` means it is already in your context
   (no Read needed). Reading on demand keeps recall lean.

═══ Tools — by who calls them ═══
AGENT-DIRECT (call these yourself, every coding turn):
  • fab_recall  — recall relevant KB (descriptions + read paths) for given files.

SKILL-DRIVEN (the fabric-* skills orchestrate these; do not hand-call unless the
skill flow directs you):
  • fab_pending — read-only: enumerate / search pending knowledge.
  • fab_review  — write: approve / reject / modify / defer pending entries.
  • fab_propose — write flow: mode=scan finds archive-worthy sessions;
                  mode=write persists one assembled pending entry.

═══ Conventions ═══
• `entries[]` is ranked best-first and bounded; `omitted_count > 0` means more
  exist — raise plan_context_top_k (config) or refine your keywords to surface
  them. (Narrowing intent will NOT surface budget-truncated low-rank entries.)
• Pass the client `session_id` to fab_recall so cross-session knowledge-debt
  tracking stays accurate.
• Cite the KB id you applied or dismissed before edits, per the project's cite
  policy. (This is the standing cite contract — fab_recall no longer repeats it
  on every call.)
```

关键改进:① 工具按**受众分两组**(AGENT-DIRECT vs SKILL-DRIVEN),agent 一眼知道只有 `fab_recall` 该自己调;② **两步取正文模型**写在最前 + 显式 `score`/`body_in_context` 用法;③ cite 约定移到这里承载(recall 删 directive);④ 修 narrower-intent 谬误。

---

## ④ 排序【MCP 收敛清单】(价值÷成本 + P0/P1/P2 + 跨端契约影响)

| # | 改动 | 工具 | 价值÷成本 | 优先级 | 跨端契约影响 |
|---|------|------|----------|--------|-------------|
| 1 | **`fab_extract_knowledge` → `fab_propose`**(name 实义一致)+ 统一 server instructions,消除名实错位 + 自相矛盾 | propose | **极高**(改名+文案) | **P0** | MCP 工具名变 → `fabric-archive` skill 引用要同步;server instructions test 断言更新 |
| 2 | **server instructions 受众分层 + 修 narrower-intent 谬误**(initialize 一次发) | all | **高**(纯文案) | **P0** | `index.test.ts` 断言更新;无 wire 契约变更 |
| 3 | **`fab_review` description 内嵌逐-action required 清单**(maestro 标准补法) | review | **高**(纯文案) | **P0** | 无 schema 变更,纯补偿 flat-shape;skill 文案对齐 |
| 4 | **`fab_recall` 返回 `candidates[]`+`paths[]` 合并单 `entries[]`** + `read_path`/`score`/`body_in_context` | recall | **高** | **P1** | output schema 变 → cite 记账键(off `target_paths`,见 MEMORY `project_recall_cite_accounting_locus`)需确认重定位;hook/skill 消费 `paths[]` 处同步 |
| 5 | **删 recall `directive` 常驻 + `entries[].requirement_profile` 输入回声** | recall | **中高** | **P1** | 删字段;确认无下游消费;cite directive 搬 instructions |
| 6 | **`modify` 三件套 → 单 `modify`**(layer flip 自动路由) | review | **高** | **P1** | union 删 2 分支;`fabric-review` skill 不得硬编码 modify-content/-layer |
| 7 | **content[].text → 单行摘要**(消除 double-payload) | all 4 | **中高**(大返回省半 token) | **P1** | 确认无客户端只读 text content(structuredContent 是主路) |
| 8 | **抽 `fab_pending`(list/search 只读)+ `fab_review` 只留写** | review/pending | **中** | **P2** | 工具数 +1;readOnly 恢复;skill 调用面分两工具 |
| 9 | **MERGE `fab_archive_scan` → `fab_propose` mode=scan** | propose | **中** | **P2** | 工具数 -1;`fabric-archive` skill 把两调合一;scan 返回结构保留 |
| 10 | **错误回执映射**(zod fail → `{error, action_hint}` 带 action 上下文)+ `audience` regex 给合法示例 | review/propose | **中高** | **P2** | handler catch 层;无 schema 契约变更 |

### 落地波次

- **P0(纯文案 + 改名,分钟级,零结构风险)**:#1 #2 #3 —— 立即消除"主动误导 agent"的最严重三处(名实错位、受众混淆、required 推不出)。
- **P1(返回形态重构,需测试 + 下游核查)**:#4 #5 #6 #7 —— recall 单数组 + score 是对 agent 体验提升最大的一批;`modify` 收敛低风险。
- **P2(工具拓扑收敛,改动面大)**:#8 #9 #10 —— 读写分离 + 写入流合并,改 skill 调用面,建议单独 PR + grill。

### 跨端契约总注

- **工具名变更(`fab_propose` / `fab_pending`)是 MCP wire 契约** → Claude Code + Codex CLI 两端都通过 `initialize` 拿工具清单,改名后两端自动同步,但**引用工具名的 skill 文案 / hook 文案 / bootstrap** 需一并改(对照 synthesis T1 "退役物全仓引用扫描"风险 —— 建议同步把工具名纳入 doctor 的 retired-reference lint)。
- **recall output schema 变更**是 4 工具里唯一动 wire 数据形态的 → 必须连带核查 cite 记账 locus + hook 消费 `paths[]` 处,否则自动 cite 覆盖率失准。
