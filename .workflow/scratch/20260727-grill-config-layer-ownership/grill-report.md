# Grill Report: 配置层职责重划 —— project 只承身份，策略上移 global，corpus 归 store

**Session**: 20260727-grill-config-layer-ownership
**Depth**: standard (5 branches)
**Date**: 2026-07-27
**Upstream**: none（承接同会话 config 分布普查）

## Discovery Summary

### Project Context
Fabric v2.5.0-rc.3。同会话已完成配置全量普查：项目层 `.fabric/fabric-config.json` 从 25 字段清理到 7（18 个等于默认值 + 1 个被机器层覆盖的死配置 `embed_model`），`fabric doctor` 48 项通过不变，`readEmbedConfig` 输出逐字节一致。

### Codebase Surface

普查基于直接读源，非 agent 采样：

| 事实 | 证据 |
|---|---|
| server 级联 = `env > project > store > default` | `packages/server/src/config-loader.ts:23-40` |
| hook 级联(源模板) = `project > global > fallback`，**逐 key opt-in** | `packages/cli/templates/hooks/lib/config-cache.cjs:114-152` |
| hook 级联(本 repo 安装副本) = **仅 project**，落后源模板 55 行 | `.claude/hooks/lib/config-cache.cjs` 107 行 vs 模板 162 行 |
| canonical 顺序已定为 `env > project > global > default` | KT-MOD-0002（2026-07-09 grill 锁定，nudge_mode 落地 4 层） |
| store 层声明 15 组可下沉，实际仅 12 组生效 | `STORE_OVERRIDABLE_KNOBS` vs config-loader 实读 |
| hook 19 个 key 中 7 个已开 `globalFallback` | 模板 hook 普查 |
| schema 外野生 key 2 个 | `archive_backlog_idle_hours` / `archive_backlog_session_count` |

**globalFallback 现状分界**（未经设计说明，但与用户直觉高度吻合）：

- 已开(7)：`cite_recall_nudge` `cite_recall_window_minutes` `hint_narrow_top_k` `hint_narrow_dedup_window_turns` `hint_narrow_cooldown_hours` `hint_reminder_to_context` `hint_summary_max_len` → 全为**人的偏好**（提示样式/密度/冷却）
- 未开(12)：`archive_edit_threshold` `archive_hint_hours` `archive_hint_cooldown_hours` `archive_backlog_*`×2 `review_hint_pending_count` `review_hint_pending_age_days` `maintenance_hint_days` `maintenance_hint_cooldown_days` `hint_broad_cooldown_hours` `broad_index_backstop` `underseed_node_threshold` → 全为**节奏阈值/corpus 规模**

### Upstream Material
N/A

---

## Branch Log

| # | Branch | Status | Decisions | Open Questions |
|---|--------|--------|-----------|----------------|
| 1 | Scope & Boundaries | ✅ 完成 | 3 locked | 0 |
| 2 | Data Model & State | ✅ 完成 | 2 locked | 0 |
| 3 | Edge Cases & Failure Modes | ✅ 完成 | 2 locked | 0 |
| 4 | Integration & Dependencies | ✅ 完成 | 2 locked | 0 |
| 5 | Scale & Performance | ✅ 完成 | 2 locked | 0 |

---

## Branch 1: Scope & Boundaries

**Status**: ✅ 完成 · **Questions**: 3 · **Decisions locked**: 3

### Q1.1: archive_edit_threshold 是「人的偏好」还是「项目节奏」？

**Answer**: 项目节奏 —— 但仍应收敛在 global 配置，project 未设置走 global 值，允许 project 单独覆盖单个 key。

**Evidence**: 用户明确以「收敛」为判据，而非属性归属。这修正了提案原表述「策略偏向人的偏好」——真正的判据是**配置面集中**，不是语义归类。

**Decision**: locked
**Constraint**: 配置分层的判据 MUST 是「配置面收敛度」，NOT「属性语义归属」。一个字段即便语义上属于项目，只要它是可调策略，就归 global。

### Q1.2: 覆盖面铺多宽？

**Answer**（经用户两轮澄清修正）: 比「global 存默认 + project 覆盖」更激进 —— **所有策略（含 per-project 差异）全部收敛到 `~/.fabric/fabric-global.json`**，repo 侧只承担身份。用户并提出更绝的变体：连 `fabric-config.json` 都取消。

**Evidence**:
- 已有 canonical KT-MOD-0002 定 `env > project > global > default`，但实现仅 7/19 hook key 开了 `globalFallback` → 现状是**对自己 canonical 的漂移**，不是设计
- 同会话实证：repo 侧 25 字段中 18 个等于默认值、1 个（`embed_model`）被机器层覆盖恒失效 → repo 侧策略配置的实际信息量接近零

**Decision**: locked
**Constraint**: 51 个策略字段 + `workspace_binding_id` MUST 收敛到 `~/.fabric/fabric-global.json`。

### Q1.3: 身份 5 个字段是否也收 global？

**Answer**: 不收 —— 身份留 repo。（用户反问「你觉得怎么样」后接受执行者判断）

**Evidence**（三条硬约束，前两条来自代码）:
1. `fabric-config.json` 是 **git-tracked**（`git ls-files` 确认）→ `required_stores` / `write_routes` 是团队契约，是 Fabric「团队知识不用重学」主张的元知识
2. schema 注释 [fabric-config.ts:191-197](packages/shared/src/schemas/fabric-config.ts:191)：`project_id` 是 UUID，"remote-derived hash is only a SUGGESTED default, never authoritative — so re-homing the git remote does not change project identity"。收 global 后必须换索引键（路径→移目录丢身份；remote→换 remote 丢身份），两者都违反此决策
3. `workspace_binding_id` 注释自陈其作用是隔离 worktree 运行时状态"while keeping the same **committed** project identity" → 设计意图明写身份入 git
4. 收益÷成本：收敛收益 90% 来自策略 51 个字段；身份仅 5 个且全由 `install`/`store bind`/`store switch-write` 自动写，用户从不手改

**反方证据**（已评估未采纳）: KT-DEC-0055「不为未观测的痛造机器」+ Fabric 零外部用户 → 团队契约可视为想象的痛。未采纳理由：Fabric 已发布 npm（`@fenglimg/fabric-cli@2.5.0-rc.3`），team store 是核心卖点，非纯内部工具。

**Decision**: locked
**Constraint**: `project_id` / `required_stores` / `write_routes` / `active_project` / `active_write_store` MUST 留在 git-tracked 的 `.fabric/fabric-config.json`。`workspace_binding_id` MUST 移入 global（per-machine 运行时隔离标识）。

**副产物**: 身份留 repo 顺带解决了 global 侧 per-project 分段的索引键问题 —— `project_id` 可从 repo 读到，作为 global 里 per-project 覆盖段的稳定键。

---

## Branch 2: Data Model & State

**Status**: 🔴 进行中

### Q2.1: global 文件结构 —— 分段还是全扁平？

**Answer**: 分段 `defaults` + `projects`（用户授权执行者判断后锁定）。

```jsonc
{
  // 顶层：机器身份与密钥，零迁移不动
  "uid": "...", "language": "zh-CN", "stores": [...],
  "embed_endpoint": "...", "embed_api_key": "...", "embed_model": "...",
  // 新增：我的默认值（51 个策略，只写改过的）
  "defaults": { "archive_edit_threshold": 20, ... },
  // 新增：per-project 例外，键 = repo 侧 project_id
  "projects": { "a64bccdc-...": { "archive_edit_threshold": 50 } }
}
```

**Evidence**:
- 顶层含 `embed_api_key` 密钥。51 个旋钮扁平铺入 → 顶层 57 key 大平铺，密钥淹没在数字阈值中，审阅易漏
- 现有 6 字段零迁移
- 解析实现单行：`projects[id]?.[key] ?? defaults[key] ?? codeDefault`

**Decision**: locked
**Constraint**: global 策略 MUST 分段存放于 `defaults` / `projects.<project_id>`，顶层仅保留机器身份与密钥。

### Q2.2: store 层与 global defaults 谁优先？

**Answer**: `store > defaults`。最终级联 = **`env > projects[id] > store > defaults > code default`**。

**Evidence**:
- 能进 store 的 19 个字段（`credibility_*`×8 / `orphan_demote_*`×3 / `plan_context_top_k` / `recall_relevance_ratio` / `embed_weight` / `fusion` / `default_layer_filter` / `conflict_lint_similarity_threshold` / `broad_review_recheck_days` / `selection_token_ttl_ms`）**全部是 corpus 属性**，store 是其语义之家
- 用户定义 store 配置为「允许分发的」→ 分发前提是能生效
- **反例锚定**：若 `defaults > store`，用户一旦写满 defaults，store 层彻底死掉 —— 这正是同会话实证的 `embed_model` 坑（机器层写死 → project 层永远轮不到）的翻版
- 强制单 repo 值的诉求由最高层 `projects[id]` 承接，不需要靠 defaults 抢优先级

**Decision**: locked
**Constraint**: 级联顺序 MUST 为 `env > projects[<project_id>] > store > defaults > code default`。语义梯度：项目显式意志 > 知识库固有特性 > 我的通用偏好 > 出厂设置。

---

## Branch 3: Edge Cases & Failure Modes

**Status**: ✅ 完成 · **Questions**: 2 · **Decisions locked**: 2

### Q3.1: embed_model 放哪层（今天实证的死配置怎么修）？

**Answer**: 跟 endpoint 绑定 —— 有 remote endpoint 时 `embed_model` 归顶层机器配置（与 `embed_endpoint`/`embed_api_key` 成对不拆）；无 remote 时走正常级联 `store > defaults > code default`。

**Evidence**:
- 两套模型命名空间互不兼容：远程 `BAAI/bge-m3`（siliconflow）vs 本地 `fast-bge-small-zh-v1.5`（fastembed 枚举）
- [config-loader.ts:336](packages/server/src/config-loader.ts:336) 已识别双模式（`remoteEndpoint !== undefined` 时放宽 guard 为任意非空字符串），但**优先级未随之分开** —— 这是坑的根因
- 同会话实证：`readEmbedConfig` 返回 `model: "BAAI/bge-m3"`，项目层写的 `fast-bge-small-zh-v1.5` 恒不生效
- 若统一降为 defaults 级：配了远程 endpoint 而 store 写本地枚举值 → 拿本地模型名请求远程 API，直接坏

**Decision**: locked
**Constraint**: `embed_model` MUST 与 `embed_endpoint` 同层绑定 —— remote 模式下同属顶层机器配置，local 模式下走 `store > defaults > code default`。

### Q3.2: global 并发写的 RMW 竞态

**Answer**: 列为**前置依赖** —— 先修 RMW，再做收敛。

**Evidence**（既有缺陷，非提案引入，但提案放大暴露面数倍）:
- [global-config-io.ts:62-71](packages/shared/src/store/global-config-io.ts:62)：`saveGlobalConfigAsync` 的 `withFileLock` **只包住 write**，read 在锁外
- 调用点均为锁外 RMW：`store.stage.ts:780` `await saveGlobalConfigAsync({ ...config, stores: nextStores })`，其中 `config` 来自锁外 `loadGlobalConfig()`；`install-global.ts:89`、`config.ts:426` 同型
- 文件第 22-23 行注释声称 "concurrent mount/unmount/switch-write RMW cannot clobber each other" —— **该声明不成立**，锁只保证单次写原子，不保证 RMW 串行
- 放大机制：收敛后每个 project 的每次策略调整都写这一个文件；用户工作方式为常开多窗口并发改同一 repo（已观测，非假设）
- 对照：项目侧 `saveProjectConfig` 本就是 non-atomic plain write（ISS-20260713-025），故收敛到 global 在**单次写原子性**上其实是改善，问题仅在 RMW 串行性

**Decision**: locked
**Constraint**: 收敛实施前 MUST 先提供锁内 `mutateGlobalConfig(fn)`（load→modify→save 整体入锁）并迁移全部约 8 处调用点。不得在竞态未修的基础上叠加写入频率。

---

## Branch 4: Integration & Dependencies

**Status**: ✅ 完成 · **Questions**: 2 · **Decisions locked**: 2

### Q4.1: 旧 project 侧策略字段如何处置？

**Answer**: clean-slate 硬切 —— 旧字段直接失效，doctor 加 lint 提示「这些 key 已搬到 global」。

**Evidence**:
- 符合 KT-DEC-0002（v2.0 clean-slate rebrand，不为旧 artifacts 提供迁移路径）与用户既有 clean-slate 偏好
- `fabricConfigSchema` 根为 lenient（无 `.strict()`），旧 key 本就被静默丢弃，无需额外删除逻辑
- 影响面实测：`~/.fabric/state/bindings/` 仅 7 个已绑定项目，且 pcf 今日已清至 7 字段，重配成本近零
- 反方（自动迁移）代价：会把今日刚清掉的 18 个「等于默认值」噪声又搬回 global

**硬约束（非选项）**: 无论迁移策略如何，所有已安装 repo MUST 重跑 `fabric install` 才能拿到新 hook —— KT-PIT-0004，hook 三镜像仅在 init/reapply 时复制同步。本 repo 安装副本落后源模板 55 行即为活证据（源模板 global 层早已实现却从未生效）。

**Decision**: locked
**Constraint**: 旧 project 侧策略字段 MUST 直接失效，不做自动迁移；doctor MUST 新增 lint 指出已搬迁的 key。

### Q4.2: 收敛后配置怎么改（写入接口）？

**Answer**: 补非交互写入 —— `fabric config set <key> <value> --scope defaults|project`，走锁内 `mutateGlobalConfig`。

**Evidence**:
- ISS-20260713-003 已记录 `fabric config` interactive-only（非完整 TTY 拒绝编辑）不可自动化
- Fabric 的使用者本就是人 + AI 两类；interactive-only 把 AI 排除在配置能力外 —— 本会话执行者修改配置只能绕过 CLI 直接写 JSON，绕过了 schema 校验与文件锁
- 人走 TUI、AI/脚本走 `set`，两条路复用同一写入引擎，顺带收口 ISS-20260713-003

**Decision**: locked
**Constraint**: MUST 提供非交互写入子命令，与 TUI 共用同一加锁写入引擎。手写 JSON MUST NOT 成为 AI 修改配置的唯一途径。

---

## Branch 5: Scale & Performance

**Status**: ✅ 完成 · **Questions**: 2 · **Decisions locked**: 2

### Q5.1: `projects` 段累积如何处置？

**Answer**: 不做清理机制 —— 接受累积，doctor 加只读列表供人工判断。

**Evidence**:
- **实测推翻自动清理的可行性**：binding 快照（`~/.fabric/state/bindings/*_resolved.json`）只有 `project_id` / `workspace_binding_id` / `read_set` / `write_target` / `knowledge_stats`，**无 repo 路径字段** → `project_id → repo path` 反向映射不存在，无法自动判孤儿
- 规模测算：单段约 5 key ≈ 200 字节，100 项目 ≈ 20KB，`JSON.parse` 微秒级 → 痛未被观测（KT-DEC-0055 标准）
- 反方（`last_seen_at` 活跃度）代价：把纯读路径变成写路径，每次 hook fire 回写时间戳，直接撞上 Q3.2 刚锁定的 RMW 竞态面

**Decision**: locked
**Constraint**: MUST NOT 为 `projects` 段引入自动清理或活跃度回写。doctor MAY 提供只读列表。

### Q5.2: hook 是否实现完整 5 层级联？

**Answer**: 实现完整 5 层 —— 复用 binding 快照的 `knowledge_store_dirs` 拿 store root，读其下 `store-config.json`。

**Evidence**:
- 快照已持久化 resolved store ROOT dirs（`bindings-snapshot-reader.cjs:118-128` 注释明载），且 hook 本就在读该快照 → **无需文件系统 walk**，增量成本仅一次 `existsSync`（该文件通常不存在）
- 涉及的 2 个 key 语义确为 store 属性：`broad_index_backstop`（该库有多少 broad 条目）、`underseed_node_threshold`（该库有多少节点）→ 降级为「人的偏好」是语义错误
- 收益：server 与 hook 两套引擎级联语义完全一致，消除「这个 key 在哪层生效」的记忆负担 —— 而这正是本次 grill 起点处发现的三处漂移的共同根因

**Decision**: locked
**Constraint**: hook 侧 MUST 实现与 server 相同的 5 层级联，store root 经 binding 快照获取，MUST NOT 引入文件系统 walk。

---

## Synthesis

### Decision Summary

| # | Decision | Status | Branch | RFC 2119 |
|---|----------|--------|--------|----------|
| D1 | 分层判据为「配置面收敛度」而非「属性语义归属」 | locked | 1 | MUST |
| D2 | 51 个策略字段 + `workspace_binding_id` 收敛入 global | locked | 1 | MUST |
| D3 | 身份 5 字段留 git-tracked 的 repo 侧 | locked | 1 | MUST |
| D4 | global 分段 `defaults` / `projects.<project_id>`，顶层仅机器身份与密钥 | locked | 2 | MUST |
| D5 | 级联 = `env > projects[id] > store > defaults > code default` | locked | 2 | MUST |
| D6 | `embed_model` 与 `embed_endpoint` 同层绑定（双模式分离） | locked | 3 | MUST |
| D7 | 先修 global RMW 竞态，再做收敛（前置依赖） | locked | 3 | MUST |
| D8 | 旧 project 策略字段 clean-slate 硬切，不自动迁移 | locked | 4 | MUST |
| D9 | 补非交互写入子命令，与 TUI 共用加锁引擎 | locked | 4 | MUST |
| D10 | `projects` 段不做自动清理，doctor 只读展示 | locked | 5 | MUST NOT |
| D11 | hook 实现完整 5 层级联，store root 走 binding 快照 | locked | 5 | MUST |

### Verified Constraints

全部 11 条均有代码锚点或用户显式确认，无 orchestrator 单方推断。关键锚点：

- `packages/server/src/config-loader.ts:23-40, 313, 336, 340`
- `packages/cli/templates/hooks/lib/config-cache.cjs:114-152`
- `packages/shared/src/store/global-config-io.ts:62-71`
- `packages/shared/src/schemas/fabric-config.ts:77-93, 191-202`
- `packages/shared/src/schemas/store.ts:376-445`
- `packages/shared/src/resolver/project-context-resolver.ts:39`
- `.claude/hooks/lib/bindings-snapshot-reader.cjs:118-128`

### Open Questions

无。5 分支全部走完，11 项决策全部锁定，0 open。

### Risk Register

| # | Risk | Branch | Severity | Mitigation |
|---|------|--------|----------|------------|
| R1 | global RMW 竞态未修即叠加写入频率 → 静默丢配置，最难排查 | 3 | **高** | D7 列为前置依赖，`mutateGlobalConfig` 先落地 |
| R2 | hook 安装副本滞后 → 改了源模板但所有 repo 不生效（已实证 55 行落差） | 4 | **中** | 发版说明明示必须重跑 `fabric install`；doctor 加副本版本漂移 lint |
| R3 | `embed_model` 双模式绑定后，用户切换 remote↔local 需同步改 model，否则模型名跨命名空间 | 3 | **中** | `fabric config` 切换 endpoint 时联动提示 model；doctor 加配对校验 lint |
| R4 | clean-slate 硬切使 7 个已绑定项目的策略配置静默失效 | 4 | 低 | D8 的 doctor lint 指出搬迁；用户为唯一用户且已清理主项目 |
| R5 | `project_id → repo path` 反向映射不存在，孤儿段永久累积 | 5 | 低 | 已评估接受（20KB/100 项目）；doctor 只读展示 |
| R6 | store 层配置需在 store 仓库 git commit 才能分发给团队 | 2 | 低 | `fabric sync` 已覆盖；文档说明 |

---

## 对抗修订（Adversarial Revision）

用户在 synthesis 后要求对抗「是否最佳、有无更简洁且语义划分更清晰的方案」。执行者自攻方案 A，发现**硬伤**并提出方案 G，用户裁决改用 G。

### A 的硬伤：同文件两段对同一外部文件一输一赢

D5 原级联 `env > projects[id] > store > defaults > code default` 中，`defaults` 与 `projects` **是同一个 global 文件内的两段，中间夹着外部的 store 层**：

```jsonc
// ~/.fabric/fabric-global.json
{ "defaults": { "plan_context_top_k": 40 },              // 输给 store
  "projects": { "pcf": { "plan_context_top_k": 45 } } }  // 赢过 store
// <store>/store-config.json
{ "plan_context_top_k": 32 }   // 实际生效 32，但用户在 global 只看到 40
```

同一文件内两段对同一外部文件一输一赢 → 「看得见的值不是生效的值」，与本会话起点处 `embed_model` 死配置同病。

**根源**：A 允许 23 个字段同时出现在 store 与 global，只要两处能写同一 key，就必然要定优先级，就必然产生认知陷阱。

### G 的解法：每个 key 只有一个家

关键判断 —— 那 23 个字段中，设跨库统一默认值有意义的只有一半：

| 跟**库**走（15）：描述「这批知识什么性质」 | 跟**人**走（8）：描述「我想怎么检索」 |
|---|---|
| `credibility_half_life_*`×5、`credibility_floor_*`×3、`orphan_demote_*`×3、`broad_review_recheck_days`、`broad_index_backstop`、`underseed_node_threshold`、`conflict_lint_similarity_threshold` | `plan_context_top_k`、`recall_relevance_ratio`、`embed_enabled`、`embed_weight`、`embed_model`、`fusion`、`default_layer_filter`、`selection_token_ttl_ms` |

左列设 machine-wide 默认无意义（每个库沉淀速度本就不同），故竞争是伪需求。砍掉竞争后：

| 类别 | 数量 | 唯一的家 | 级联 |
|---|---|---|---|
| 身份 | **6** | repo `.fabric/fabric-config.json` | 无级联 |
| 知识性质 | 15 | `<store>/store-config.json` | `env > store > code default` |
| 我的偏好 | 38(+2 待正式化) | `~/.fabric/fabric-global.json` | `env > projects[id] > defaults > code default` |

### 修订后的决策

| # | 原 | 修订后 |
|---|---|---|
| D3 | 身份 **5** 字段留 repo | 身份 **6** 字段留 repo —— 补 `default_write_store`（与 `active_write_store` 由 `storeSwitchWrite` 成对双写，`resolve-input.ts:52` 消费为 `defaultWriteAlias`） |
| D5 | 统一 5 层 `env > projects[id] > store > defaults > default` | **按类别分级联**：偏好类 `env > projects[id] > defaults > default`；知识性质类 `env > store > default`。**无跨文件竞争** |
| D11 | hook 实现完整 5 层 | hook 按 key 类别分支：15 个知识性质 key 走 store（经 binding 快照），其余走 global。实现比 A 更简单（无优先级合并逻辑） |
| **D12（新增）** | — | **`STORE_OVERRIDABLE_KNOBS` 白名单整体删除** —— 它存在的唯一理由是标记「哪些 key 允许两处写」；无竞争即无需白名单，本会话发现的三处声明/实现漂移随之失去滋生土壤 |

D1/D2/D4/D6/D7/D8/D9/D10 不变。用户原提案「project 只承身份 + 策略收 global + corpus 归 store」三条全部保留 —— G 只砍掉 A 引入的竞争复杂度。

### Recommended Next Step

`maestro-plan` —— 12 项决策全锁定、0 open、依赖顺序明确（D7 → 其余），可直接排 wave。不需要 brainstorm（方案空间已收敛）或 analyze（技术路径无未知）。


