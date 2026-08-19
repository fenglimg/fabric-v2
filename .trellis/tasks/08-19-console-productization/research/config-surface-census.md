# 可配置面普查（census-before-narrowing）

> 目的：在讨论「配置页该长什么样」之前，先把 Fabric **全部**可配置/可展示的面铺开，标 in/out，再挑代表。
> 方法遵循 census-before-narrowing：不拿几个命名例子把面打死。
> 采集日期 2026-08-19，来源为代码实证（非文档、非推测）。

## A. 配置键面

### A1 已进面板的 18 个键（`getPanelFields()` 自省派生）
来源 [fabric-config-introspect.ts:294](../../../../packages/shared/src/schemas/fabric-config-introspect.ts:294)。分组与 home：

| 组 | 键 | home | 普通人能否自判 |
| --- | --- | --- | --- |
| A_locale | `fabric_language` | global_root | ✅ 能 |
| A_locale | `default_layer_filter` | preference | ⚠️ 需懂 team/personal 分层 |
| B_hint_threshold | `archive_hint_hours` / `archive_hint_cooldown_hours` / `archive_edit_threshold` | preference | ❌ 填几全靠猜 |
| B_hint_threshold | `review_hint_pending_count` / `review_hint_pending_age_days` | preference | ❌ 同上 |
| B_hint_threshold | `maintenance_hint_days` / `maintenance_hint_cooldown_days` | preference | ❌ 同上 |
| B_hint_threshold | `underseed_node_threshold` | **corpus**（写 store） | ❌ 且概念最内部 |
| C_audit | `audit_mode` | preference | ⚠️ |
| D_behavior | `nudge_mode` | preference | ✅ 能 |
| D_behavior | `embed_enabled` | preference | ✅ 能（但生效还依赖 fastembed 是否装上） |
| D_behavior | `cite_policy_enabled` / `self_archive_policy_enabled` | preference | ✅ 能 |
| D_behavior | `cite_recall_nudge` | preference | ✅ 能 |
| D_behavior | `fabric_event_retention_days` | preference | ✅ 能 |
| D_behavior | `review_stale_pending_days` | preference | ❌ |
| D_behavior | `fusion` | preference | ❌ 纯检索调参 |

**结论**：18 项里 **8 项是「多久提醒一次」的数字**（B 组 7 项 + `review_stale_pending_days`），普通人一个都判断不了；真正能自判的只有 6 项左右。这是「geek 感」的主要来源。

### A2 未进面板的 ~22 个项目 schema 键（JSON-only）
[fabric-config.ts](../../../../packages/shared/src/schemas/fabric-config.ts) 共约 40 键，未进面板的包括：
`cite_recall_window_minutes` / `cite_nudge_ignore_globs` / `conflict_lint_similarity_threshold` /
`onboard_slots_opted_out` / `broad_index_backstop` / `altitude_propose_gate` /
`orphan_demote_{proven,verified,draft}_days` / `credibility_half_life_*_days`（5 个）/
`credibility_floor_*`（3 个）/ `broad_review_recheck_days` / `recall_relevance_ratio` /
`embed_weight` / `hint_dismiss_signals` …

**现有决策**（[fabric-config-introspect.ts:364](../../../../packages/shared/src/schemas/fabric-config-introspect.ts:364) 注释）：检索调参与管道键**故意不进面板**——「a panel entry you cannot judge is noise」。
→ 本任务**不推翻**这条；它与「产品化」方向一致（少即是多）。唯一例外候选：`hint_dismiss_signals`（用户被提醒烦到时的直接逃生阀，目前只能手改 JSON）。

### A3 全局根键 `~/.fabric/fabric-global.json`
`uid` / `language` / `stores[]` / `active_personal_store` / `defaults{}` / `projects{}` /
`embed_endpoint` / `embed_api_key` / `embed_model`。
→ 面板目前只暴露 `language` + `defaults` + `projects`；**远程嵌入三件套是只读展示**（key 永不显示原文），stores 与 active_personal_store 完全不在配置页（属 store 运维）。

### A4 store 配置 `store-config.json`
目前面板只有 `underseed_node_threshold`（corpus home）。属「跟着知识库走、全团队共享」的属性。

## B. 安装物件面（**控制台目前 0 可见** ← 用户点名的重点）

| 面 | 实体 | 现状 | 用户能感知到什么 |
| --- | --- | --- | --- |
| B1 MCP server | 每客户端注册一条 MCP server（[mcp.stage.ts](../../../../packages/cli/src/install/pipeline/mcp.stage.ts)） | 装了没有界面可见；MCP 挂了只能靠 `fab_recall` 失败反推 | 「AI 到底连上知识库没有」 |
| B2 hooks | 8 个入口脚本（`fabric-hint` / `knowledge-hint-broad` / `knowledge-hint-subagent` / `knowledge-pretooluse` / `post-tooluse-mutation` / `session-end-marker` / `cite-policy-evict` …）+ ~15 个 lib + 两份客户端 hook 配置（`claude-code.json` / `codex-hooks.json`） | 全不可见 | 「什么时候会被打断、为什么会弹这句提醒」 |
| B3 skills | 6 个 `fabric-*` skill（archive / review / store / sync / config / recall-playbook） | 全不可见 | 「我能让 AI 干哪些 Fabric 活」 |
| B4 guidance | `AGENTS.md` / `CLAUDE.md` 的 managed block | 全不可见 | 「AI 到底被灌了什么规则」 |
| B5 客户端 | Claude Code + Codex CLI 两端各自安装 | 全不可见 | 「我这台机器上哪个 AI 客户端接了 Fabric」 |

**关键约束**（KT-PIT-0067 实证）：给分发清单加「这个物件要不要一起装」的布尔标记会造出**第三份真相**（install spec 一份、uninstall 一份、文件系统一份），已发生过「装下去的 skill 让 AI 打开一个从未被写入的文件、而测试全绿」。
→ 若要在控制台做 hook/skill 的**开关**，必须以文件系统为唯一真源，不得新增一份布尔清单。

## C. 运行时状态面（数据源已存在，多数有 `--json`）

`fabric info scope` / `fabric info projects` / `fabric info --recall` / `doctor` / `audit cite` /
`metrics` / `sync` / 版本三处（npm 最新 / 全局 CLI / 各项目 install-manifest）/
pending backlog / events ledger / store 挂载与 write-target / project registry。

→ 控制台已用：stores + entryCount + revision + 全机器配置 + 项目注册表。
→ **未用**：doctor 体检结果、audit 覆盖率、pending backlog 数、版本漂移（版本页是父任务下唯一未完成的子任务 `console-version-upgrade`，处于 planning）。

## 待决策：三档归类

对 A/B/C 每一项判定属于哪一档：

1. **可改**（面板给控件）：有明确用户意图 + 单一 home + 改完能立刻验证。
2. **只读可见**（看得见、改要走 CLI）：安装物件与运行时状态——它们是**文件与客户端配置的产物**，在界面里逐个开关会造出第二套真相。
3. **不进控制台**：判断不了的调参（A2 主体）。
