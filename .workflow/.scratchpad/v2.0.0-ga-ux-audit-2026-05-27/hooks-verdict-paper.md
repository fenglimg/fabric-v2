# v2.0.0 GA UX Audit — Hooks Paper Walkthrough (Phase 3 / C4)

**Date**: 2026-05-27
**Hooks audited**: 4 主 hook + 5 helper lib(packages/cli/templates/hooks/)
**Method**: paper walkthrough — Read .cjs source → 列触发频率 / nudge 文案 / dismiss 路径 / 跨 client 行为
**Bonus**: 本 session 实际触发 2 次 Stop hook (archive cadence + pending review) 提供真实 UX 数据点

---

## 1. fabric-hint.cjs (Stop event, **1841 行**)

### 触发条件 + 4 signal

```
Stop hook fires every turn (Claude/Codex/Cursor)
  ↓
Multi-signal evaluation order:
  Signal A (archive)     — edit counter ≥ threshold (default 20) OR hours_since ≥ 24h
  Signal B (import)      — import-state.json missing AND <24h post-init quiet
  Signal C (review)      — pending count ≥ 10 OR oldest ≥ 7 days
  Signal D (maintenance) — doctor_run > 14d ago AND node_count ≥ underseed threshold
```

**Cooldown**:
- Signal A/B/C 共享 `archive_hint_cooldown_hours` 默认 12h
- Signal D 独立 sidecar `maintenance-hint-last-emit`,默认 7d
- 触发后写 timestamp,12h/7d 内不再 nag

**Output 格式**:Claude Code stdout JSON envelope `{decision: 'block', reason: '...', signal: '...', recommended_skill: '...'}`

### Paper walkthrough 发现的问题

| # | 问题 | 严重 |
|---|---|---|
| 1 | **1841 行单 .cjs** — 4 signal + state file 处理 + i18n + helper lib 全塞;**复杂度过高**,debug 困难 | HIGH |
| 2 | **Stop hook 每 turn fire** — 即使 silent skip,仍读 events.jsonl 尾 + 多个 state file,**性能开销持续** | MED |
| 3 | **Cooldown 12h 同时管 A/B/C** — 用户实测一次 archive nudge 触发后,即使 Signal B/C 阈值也到了,**仍被同一 cooldown 静音**;3 signal 该独立 cooldown 但共用 | MED |
| 4 | **没有 "永久 dismiss" 机制** — 用户对某 signal 一直说"不",hook 仍 cooldown 后再 nag;**没 session-level dismiss memory** | HIGH |
| 5 | **Nudge 文案缺"如何 dismiss"引导** — 本 session 实测:`📋 Fabric: 距上次归档 已过 169.0h ... 是否调 /fabric-archive`,**没说怎么"不归档,别再问"** | HIGH |
| 6 | **跨 signal 同时触发优先级不明** — 4 signal 同时阈值过,**只 emit 第一个** (alphabetical),其他 signal 被静音 | MED |
| 7 | **Underseed Signal D 复杂条件** — 同时要 `hoursSinceInit >= 24h` AND `(hoursSinceProposed === null OR >= 24h)` AND `nodeCount < threshold` AND **配套 cooldown 7d** — 测试矩阵极大 | MED |
| 8 | **Signal D 触发文案** — `${nodeCount}/${threshold}` template 显式数字,**默认 10 个 node** 在新项目实际意义?低 corpus 项目永远卡 underseed signal? | MED |
| 9 | **i18n via banner-i18n.cjs lib** — 但 nudge 模板硬编码在 hook 内的 fallback path,**lib unavailable 时降级英文**,zh-CN 用户突然看英文 confusing | LOW |
| 10 | **Cross-client only Claude Code stdout JSON** — Codex CLI / Cursor 不支持 `decision: block` 协议,只通过 stderr 显示;**跨 client 行为不一致** | HIGH |

### Verdict: **NEEDS-4-POLISH**

**Recommendations**:
1. **拆分 4 signal 到 4 独立 .cjs**(`archive-hint.cjs` / `import-hint.cjs` / `review-hint.cjs` / `maintenance-hint.cjs`),每个 ≤ 500 行 — fabric-hint.cjs 改为 dispatcher 调对应子 hook
2. **每 signal 独立 cooldown** — Signal A/B/C 拆开,允许同时 nag(用户视角:今天该归档了 + 你还有 pending 等审,是两件事)
3. **session-level dismiss memory** — `.fabric/.cache/dismiss-state-<session_id>.json`,用户 reply "stop nudging archive in this session" → 写入 → cooldown 升 24h
4. **Nudge 文案加 dismiss 引导** — `📋 Fabric: ... 是否调 /fabric-archive?(回 "skip" 跳过本次,回 "mute" 本会话不再提)`
5. **跨 client 统一 fallback** — Codex/Cursor 通过 stderr + 标准化前缀 `[fabric-hint]`,文案与 Claude stdout JSON 对齐

---

## 2. knowledge-hint-broad.cjs (SessionStart, 877 行)

### 触发条件

```
SessionStart 每次会话开启
  ↓
调 `fabric plan-context-hint --all` 
  ↓
渲染 broad-scoped KB 索引 to stderr
```

- **无 state file, 无 cooldown, 无 dedup**
- 每 session 必然渲染一次,**rendering 成本固定**

### Output 格式(per code comment):

```
[fabric] Session start — N broad-scoped knowledge entries available:
  [decision] (proven)
    - <id> · <summary>
  [pitfall] (verified)
    - <id> · <summary>
  ...
revision_hash: <hash>
Use `fab_get_knowledge_sections` to fetch full content.
```

或 `narrow count > 30` 时:per-type grouped truncation 模式

### Paper walkthrough 发现的问题

| # | 问题 | 严重 |
|---|---|---|
| 1 | **每 session boot 必跑 `fabric plan-context-hint --all`** — 调外部 CLI 进程,有 cold start 成本(typically 100-300ms) | MED |
| 2 | **broad-only,与 Wave A1 联动** — 删 server selectable filter 后,broad/narrow 边界模糊;此 hook 与 narrow sibling 的边界要重审 | HIGH |
| 3 | **truncation 30 阈值** — 实际项目 N 通常 < 30(rc.32 werewolf 实测 ~22),但 truncation mode 还存在 — 死代码概率高 | LOW |
| 4 | **stderr only,无 stdout JSON** — Claude 视角是被动 awareness,但 Codex / Cursor stderr 行为不一(Cursor 不显示 stderr inline) | HIGH |
| 5 | **revision_hash 行用户读不懂** — `revision_hash: 7a3b2c...` 看到一串 hash,不知道有什么用 | LOW |
| 6 | **没 dismiss 路径** — 用户每次 session 都看到完整 N 条 KB 列表,**信息密度疲劳** | MED |
| 7 | **`fab_get_knowledge_sections`** prompt — hook 提示用 MCP tool,但 Cursor / Codex 用户不一定有这工具 — instruction 与 client 不匹配 | MED |
| 8 | **失败降级路径** — `fabric plan-context-hint` CLI 调失败 hook 静默 exit 0,**用户不知道 hook 故障** | LOW |

### Verdict: **NEEDS-2-POLISH**

**Recommendations**:
1. **缓存 SessionStart 结果**:`.fabric/.cache/session-broad-hint-<rev>.json`,revision_hash 不变就复用,避免重复 plan-context-hint 调用
2. **truncation 阈值降到 15**:更早进入 grouped 模式,信息密度更高
3. **revision_hash 行去掉或改人读** — `# revision: <date>` 而非 hash
4. **dismiss path**:用户 reply "`!mute-session-start`" → 写 sidecar → 本 session 不渲染
5. **`fab_get_knowledge_sections` 提示与 client adapt**:Claude/Codex/Cursor 各显式说明拉文方式

---

## 3. knowledge-hint-narrow.cjs (PreToolUse Edit|Write|MultiEdit, **1458 行**)

### 触发条件 + 3 责任

```
PreToolUse fires before every Edit/Write/MultiEdit
  ↓
E2 narrow hint — 从 tool_input.file_path 推关键路径 → 调 plan-context-hint --paths
  ↓
E3 session-hints cache — .fabric/.cache/session-hints-{session_id}.json 防重复 nag
  ↓
E4 edit-counter sidecar — 记 edits_since_last_proposed
  ↓
E6 hint-silence-counter telemetry — 记 hint 被静音次数
```

### Paper walkthrough 发现的问题

| # | 问题 | 严重 |
|---|---|---|
| 1 | **1458 行单 hook 承担 4 责任**(E2/E3/E4/E6)— 与 fabric-hint 同问题,复杂度过高 | HIGH |
| 2 | **PreToolUse 每次 Edit 都 fire** — 一个 plan 编辑 30 文件,这 hook 跑 30 次;**累计延迟 3-10 秒**,用户感知卡顿 | HIGH |
| 3 | **plan-context-hint --paths CLI 调** — 每次 hook 都 spawn 进程,**没 in-memory cache 路径** | HIGH |
| 4 | **session-hints cache 防重复** — 但 cache invalidate on revision change → KB 一变所有 session 重新 nag,**revision 频繁(approve pending)时大量重 nag** | MED |
| 5 | **stderr only,narrow.length === 0 完全静默** — 静默就没 noise,但用户不知道 hook 跑没跑(没有"已检查无相关 KB"标识) | LOW |
| 6 | **跨 client matcher 差异**:Claude `Edit\|Write\|MultiEdit`,Codex 无 PreToolUse 等价 event,**Codex 用户完全没此 hint** | HIGH |
| 7 | **edit counter `editsSinceLastProposed`** — 全局 counter,与 fabric-archive Signal A 联动,但 hook 数据流不直观(narrow hint hook 写 counter,archive signal hook 读 counter) | MED |
| 8 | **`(如需重读 broad 决策，调 fab_plan_context 或 fabric plan-context-hint --all)` 文案** — 末尾固定字符串,用户多次看到疲劳;**信息熵低** | LOW |

### Verdict: **NEEDS-4-POLISH**

**Recommendations**:
1. **拆分 4 责任** — E2 hint / E3 cache / E4 counter / E6 telemetry 拆成 hook-lib 模块,主 hook ≤ 300 行
2. **In-memory cache + invalidate-on-rev**:hook 内自带 memo,同 session 同 path 不再调 CLI;**rev change 时 lazy invalidate**
3. **聚合多 path tool**:`MultiEdit` 单次输入 N 路径,hook 应该聚合 N path 调一次 CLI 而非循环
4. **跨 client 一致性**:Codex 通过 SessionStart hook 改为 "active-files-based broad hint refresh"(模拟 PreToolUse 效果)
5. **counter 数据流抽 server**:`edit_counter` 改为 server 端 `fab_increment_edit_counter` MCP 调用,hook 不直接读写 .fabric/

---

## 4. cite-policy-evict.cjs (UserPromptSubmit, 242 行)

### 触发条件

```
UserPromptSubmit fires on every user message (Claude only)
  ↓
读 .fabric/.cache/cite-evict-state.json → 看 turn_count
  ↓
turn_count % cite_evict_interval == 0 AND interval > 0
  ↓
emit cite-contract reminder via Claude stdout JSON additionalContext
```

**Config**:`cite_evict_interval` 默认 **0 = OFF**(opt-in)。推荐 10-20 active session,5 for critical。

**Cross-client**:**Claude Code only**,Codex / Cursor 没等价 event;cite-coverage telemetry 在 Codex/Cursor 通过 Stop-hook + SessionStart sibling 间接收集。

### Paper walkthrough 发现的问题

| # | 问题 | 严重 |
|---|---|---|
| 1 | **默认 OFF (interval=0)** — opt-in 行为,**绝大多数用户从不开启**;rc.32 实测 3.1% 遵循率不会自动改善 | HIGH |
| 2 | **interval 配置高 cognitive load** — 10? 20? 5? 用户不知道选什么,默认 0 = 关 | MED |
| 3 | **Claude only** — Codex / Cursor 用户没此 hook,**cite policy 在那两 client 上更弱** | HIGH |
| 4 | **session_id 切换 reset turn_count** — 单 session 内 OK,但 Claude /clear 不切 session_id?需验证 | MED |
| 5 | **reminder 文案** — 通过 `cite-contract-reminder.cjs` lib 渲染,**reminder 内容看不到** — 不确定 reminder 对 LLM 是否 actionable | MED |
| 6 | **state file 写 .fabric/.cache/** — 每 prompt 写一次小 JSON,**累计 I/O 不少**(rc.36 events.jsonl 膨胀的 cousin 问题) | LOW |
| 7 | **强 fallback「any error path → silent exit 0」** — fail-soft,但意味着 cite-policy 失败用户不知道 | LOW |
| 8 | **PreEdit warn 缺失** — 这个 hook 是 UserPromptSubmit 的(用户发问后提醒 AI),**没有 PreEdit 路径**(AI 准备 edit/decide 前检查最近 turn 是否含 `KB:` 行)— 与 algo audit §1 NEW-1 的"PreEdit warn hook"对应 | HIGH(与 §1 联动) |

### Verdict: **NEEDS-3-POLISH**

**Recommendations**:
1. **Default ON,interval=10**:cite-policy 是 GA 核心机制,默认关闭等于让 3.1% 持续
2. **加 PreEdit cite check 分支**:不光 turn counter,**Edit/Write 前 spot check 最近 N turn 是否含 `KB:` 行**;缺则 stdout JSON warn(不阻断)— 与 algo audit NEW-1 配套
3. **Codex / Cursor 支援**:Codex 通过 SessionStart 每 10 session 重渲染 cite-contract;Cursor 通过 PreToolUse 模拟(如 PreToolUse 拦截到 Edit 时 emit reminder)
4. **reminder 文案 audit** — 单独 Read `lib/cite-contract-reminder.cjs` 审 reminder text,actionable verb?给具体 KB 候选?
5. **state file 移除**:turn_count 改 server 端 metrics counter(`fab_bumpCounter("cite_turn", session_id)`)+ MCP read — 与 Wave B events.jsonl Plan B 同步

---

## Cross-Hooks 共通问题

| # | 问题 |
|---|---|
| H1 | **5 个 hook 各自读 .fabric/fabric-config.json** — 重复 I/O,无 hook-wide cache |
| H2 | **state file 散落 .fabric/.cache/ 多 sidecar** — `archive-hint-last-emit` / `maintenance-hint-last-emit` / `session-hints-<id>.json` / `cite-evict-state.json` — 命名 / 格式 / TTL 不统一 |
| H3 | **跨 client 差异显著** — Claude Code 5 个 hook 全有,Codex 缺 PreToolUse + UserPromptSubmit,Cursor 缺 stdout JSON 协议 |
| H4 | **没有"hook health check"** — `fabric doctor` 不告诉用户哪些 hook 已装/正常运行 / 故障(rc.31 加了 hooks_wired check,但只检查 wire 不检查 runtime) |
| H5 | **每 hook 行数 ≥ 200,4 主 hook 总 4418 行 .cjs** — 维护负担(rc.x 期间已多次 BREAKING) |
| H6 | **i18n via lib/banner-i18n.cjs 但 fallback 硬编码英文** — 多个 hook 共此 lib,lib 不全或 load 失败时降级行为 inconsistent |

**统一改进建议**:
1. 引入 `hooks/lib/state-store.cjs` — 统一 state file 命名 + TTL + atomic write
2. 引入 `hooks/lib/config-cache.cjs` — 单 session 共享 config load result
3. 加 `fabric doctor --check-hooks` runtime check — fire 测试 event,确认 hook 真跑了
4. 跨 client adapter pattern — `hooks/lib/client-adapter.cjs` 抽象 stdout JSON / stderr / 不同 event 触发

---

## Hooks Verdict Matrix

| Hook | Verdict | 严重发现 |
|---|---|---|
| fabric-hint.cjs (Stop) | **NEEDS-4-POLISH** | 1841 行 / 4 signal / 无永久 dismiss / cooldown 共享 / 跨 client 差异 |
| knowledge-hint-broad.cjs (SessionStart) | **NEEDS-2-POLISH** | 每 session 跑 CLI 无缓存 / 跨 client 差异 |
| knowledge-hint-narrow.cjs (PreToolUse) | **NEEDS-4-POLISH** | 1458 行 / Edit 30 文件跑 30 次 / 无 in-memory cache / Codex 缺等价 |
| cite-policy-evict.cjs (UserPromptSubmit) | **NEEDS-3-POLISH** | 默认 OFF / Claude only / PreEdit 分支缺失 |

---

## 新 GA fix candidate

| ID | 来源 | 建议位置 |
|---|---|---|
| **NEW-16** | fabric-hint 拆分 4 子 hook + 独立 cooldown + dismiss 机制 + 文案加引导 | Wave D 新 task |
| **NEW-17** | knowledge-hint-narrow in-memory cache + PreToolUse 聚合 multi-path | Wave D 新 task |
| **NEW-18** | cite-policy-evict default ON interval=10 + 加 PreEdit cite-check 分支 | Wave D(NEW-1 配套) |
| **NEW-19** | hooks/lib/state-store / config-cache / client-adapter 抽象 | Wave D 新 task |
| **NEW-20** | fabric doctor `--check-hooks` runtime hook health check | Wave D(NEW-8 配套) |
| **NEW-21** | 跨 client (Codex/Cursor) hook 等价路径补齐(SessionStart 模拟 PreToolUse 效果) | Wave F 新 task(cross-client parity) |

**估时增量**:NEW-16 ~ 21 共 ~10-15h,主要落 Wave D 和 Wave F。

**总估时**:~78-105h → **~88-120h**(再加 +10-15h)

---

## 下一步

1. 推 C5 Phase 5 8 阶段用户旅程 paper coherence → `journey-verdict-paper.md`
2. 推 C6 Phase 6 5 横切 spot-check → `crosscut-verdict.md`
3. user dogfood werewolf 验证 paper findings(C-WEREWOLF)
4. C7 GA-VERDICT 汇总

**本 session 实测数据点**:
- 2 次 Stop hook nudge(archive cadence + pending review)— 验证「cooldown 共享 / 无 dismiss 引导」问题真实存在
- /fabric-archive 自调用 → 经历 6 phase + ref/*.md jumps — 验证「cognitive load 过高」问题真实存在
