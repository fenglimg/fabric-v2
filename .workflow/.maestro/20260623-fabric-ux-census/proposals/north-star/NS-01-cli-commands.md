# NS-01 · Fabric CLI 命令表北极星重设计

> 设计师：CLI 命令表重设计师
> 日期：2026-06-23
> 问题：**不是修 bug，是问"今天从零设计 Fabric 的 CLI 命令表，它该长什么样"。** 倾向「少而正交」。
> 输入基线：`01-cli.md`（命令级 D1/D2/S1/I1/H1 方案，本文不重复）+ `00-SYNTHESIS.md`（跨维度 T1–T6）。本文在其上做**存在性/形态**裁决。
> 授权：零用户、可 clean-slate、无兼容包袱。
> 真源：`packages/cli/src/commands/index.ts:6-34` `allCommands`（13 主命令 ＋ 3 deprecated 别名 ＝ 注册 16 项）。

---

## 0. 三个关键事实修正（grounded，影响存在性裁决）

审计文档把三个命令当"死/可删"，但 grep 实证它们是**活跃数据源**。北极星必须基于此，否则会误删 hook/skill 依赖：

| 命令 | 审计印象 | grep 实证（真相） | 裁决含义 |
|---|---|---|---|
| `plan-context-hint` | "MCP 侧已退役 → 该删" | **退役的是 MCP 工具 `fab_plan_context`**（`packages/server/src/index.test.ts:72` 断言 server instructions 不含它）。**CLI 命令 `plan-context-hint` 不是它**——`templates/hooks/knowledge-hint-broad.cjs:468` 每次 SessionStart **spawn `fabric plan-context-hint --all` 取 JSON** 灌 broad sink。这是 hook 的活跃数据管道。 | **KEEP（但改名 + 永久 hidden）**。删它＝断 SessionStart 知识注入。 |
| `scope-explain` | "deprecated 墓碑 → 删" | 4 个 skill 真源模板**仍调 `fabric scope-explain team` 的 JSON** resolve writeTarget/readSet：`fabric-archive/SKILL.md:48`、`fabric-import:45`、`fabric-review:45`、`fabric-sync:13`。 | 命令身份可并入 `info scope`，但**这条 store-resolution 数据契约必须先迁移** skill 调用点，不能裸删。 |
| `onboard-coverage` | "skill 专用冗余" | `fabric-archive` Phase 1.5 活跃依赖 `fabric onboard-coverage --json`（`ref/phase-1-5-onboard.md:101/104/204`）。 | **KEEP（hidden，skill-only RPC）**。不是人面命令但有真消费者。 |
| `metrics` | "维护者 dashboard" | **无 skill / hook caller**（grep 零命中）。纯人面维护者遥测。 | 可 MERGE 进新 `audit` 组。 |

**根因（呼应 SYNTHESIS T1）**：Fabric 没有"退役物全仓引用扫描"闸，导致审计也会把"MCP 工具退役"误读成"同名 CLI 命令退役"。北极星把 **CLI 命令 vs MCP 工具的命名空间彻底分开**（见 §3 动词体系）。

---

## 1. 现状命令表 ＋ 逐命令存在性裁决

注册 16 项（`index.ts:6-34`），但其中 9 项面向人、3 项 hidden RPC、1 项浮空、3 项 deprecated 别名。裁决一律 grounded。

| 命令 | 现裁决 | 理由（file:line） | 迁移面（谁 import / 引用） |
|---|---|---|---|
| `install` | **KEEP** | 安装入口，标准动词，`index.ts:8`。命名零歧义。 | wizard/summary/diff 5 文件 import `install.ts` 死类型（IN1，正交清理，不影响命令表） |
| `uninstall` | **KEEP** | `index.ts:21`，标准。 | 无 |
| `config` | **KEEP** | `index.ts:22`，交互 panel，策略一致（"能交互选就别 flag"）。 | `dismiss-slot`/`onboard-reset` hidden 子命令 argv hack（config.ts:290，正交） |
| `sync` | **KEEP** | `index.ts:12`，干净，知识同步一等动词。 | `fabric-sync` skill 调用 |
| `doctor` | **KEEP ＋ SHRINK** | `index.ts:20`，健康检查通用隐喻保留；但 8 合 1 ＋ 14 隐藏 flag（D1）→ 遥测面拆出（见下 `audit`）。doctor 收窄成「健康＋修」。 | 拆 cite-coverage/conflicts/history/descriptions/metrics 到新 `audit` 组 |
| `store` | **KEEP ＋ 重组** | `index.ts:10`，知识库心脏。但 12 子命令爆炸、`add`/`create` 同义、`switch-write`/`route-write` 同义（S1）。 | 运维子命令降权进 `store migrate`；4 skill 经 `store list`/`scope-explain` |
| `info` | **KEEP ＋ SPLIT scope** | `index.ts:14`，合并 whoami/status 合理；但 `info scope` 是位置参伪子命令（info.ts:85），应升真子命令。 | — |
| `context` | **KEEP ＋ RENAME** | `index.ts:33`，**非 hidden 但 grouped-help 漏接 → 用户永远看不到**（H1，context.ts:142 无 hidden）。名字"context 是啥的 context"不直观。 | 改名 `inspect`/`show-context`，并入 Diagnostic 组 |
| `whoami` | **KILL（删别名）** | `index.ts:17`，已 deprecated → `info --global`（whoami.ts:10/19）。零外部 caller。 | grouped-help.ts:55 墓碑移除；命令文件删 |
| `status` | **KILL（删别名）** | `index.ts:18`，已 deprecated → `info`。 | grouped-help.ts:62 墓碑移除；命令文件删 |
| `scope-explain` | **MERGE→`info scope`**（先迁数据契约） | `index.ts:19`，deprecated（scope-explain.ts:25）；**但 4 skill 仍调其 JSON**（§0）。 | **必须先把 4 skill 的 `fabric scope-explain team` 改成 `fabric info scope team --json` 并验证 JSON 形状一致**，再删别名 |
| `plan-context-hint` | **KEEP（RENAME ＋ 永久 hidden）** | `index.ts:23`，**非死命令**：broad hook 活跃数据源（§0，hint-broad.cjs:468）。但名字是人面误导（不是给人调的）。 | 改名 `__plan-context`（或归 `internal` 命名空间）；改 hint-broad.cjs spawn 名 1 处；纯派生不入人面 help |
| `onboard-coverage` | **KEEP（hidden，skill-only）** | `index.ts:27`，`fabric-archive` Phase 1.5 活跃依赖（phase-1-5-onboard.md:101）。 | 同上归 `internal`；改 archive skill 调用名 |
| `metrics` | **MERGE→`audit metrics`** | `index.ts:30`，**无 skill caller**，纯维护者遥测。和 doctor 拆出的 cite-coverage 同语义（遥测）。 | 并入新 `audit` 组；零 skill 迁移 |

**子命令级裁决（store 12 子 ＋ doctor flag）**：

| store 子命令 | 裁决 | 理由 |
|---|---|---|
| `list` | KEEP（表格化） | store.ts:411，但裸 `\t`（store.ts:58）→ 复用 install-summary 表格渲染器 |
| `create` | KEEP | 建新 store，语义清 |
| `add` | **RENAME→`mount`** | store.ts:64「Mount an existing store」与 `create` 同义撞车 |
| `bind` | KEEP | dev 日常，AGENTS.md 点名 |
| `switch-write` | KEEP | dev 日常 |
| `route-write` | **RENAME→`write-route`** 或 MERGE 进 `switch-write --scope` | store.ts:201，与 switch-write 都含 write，同义 |
| `explain` | KEEP | 干净 |
| `remove` | KEEP | 标准 |
| `backfill-scope` | **MERGE→`store migrate`** | store.ts:260，内部运维黑话，dev 零直觉 |
| `re-scope` | **MERGE→`store migrate`** | store.ts:354，同上 |
| `promote` | **MERGE→`store migrate`** | store.ts:384，同上 |
| `project {list,create}` | KEEP（降一层歧义评估） | 三层嵌套 `store project create`，"project"与仓库 project 易混；保留但文档消歧 |
| doctor `--fix` / `--fix-knowledge` | **MERGE→单一 `--fix`** | D2，两个都叫 fix 还 mutex（doctor.ts:506） |
| doctor `--cite-coverage/--lint-conflicts/--history/--archive-history/--enrich-descriptions` | **SPLIT→`audit` 子命令** | D1，遥测面不属 doctor 健康语义 |

---

## 2. 目标命令树（北极星）

设计律：**人面命令按"知识价值轴"分 3 组（共 9 个人面命令），内部 RPC 收进 `__internal`，遥测收进 `audit`，deprecated 别名清零。** 从 13 人面注册项 → **9 人面命令**，从 16 总注册 → **目标 ~12 注册项（9 人面 ＋ 3 hidden RPC）**。

```
fabric / fab
│
├─ Knowledge ────────────── 知识库是 Fabric 的心脏，提到一等可见
│  ├─ store
│  │   ├─ list            # 表格化（非裸 \t）
│  │   ├─ create          # 建新 store
│  │   ├─ mount           # ← 原 add（挂载已有，消歧）
│  │   ├─ bind            # dev 日常：绑定本 repo
│  │   ├─ switch-write    # dev 日常：设默认写库（可吸收 route-write --scope）
│  │   ├─ explain
│  │   ├─ remove
│  │   └─ migrate {scope, promote, route}   # ← 原 backfill-scope/re-scope/promote/route-write，运维降权
│  └─ sync  [--continue|--abort]            # 多 store git 同步
│
├─ Project ──────────────── 单 repo 接入与查看
│  ├─ install   [--global --url --dry-run --yes --target]
│  ├─ uninstall [--dry-run --yes --target]
│  ├─ config    [--target]                  # 编辑走交互
│  ├─ info      [--global]                   # 项目 status / --global 身份
│  │   └─ scope <coord> [--json]            # ← 真子命令（原 scope-explain，原 info scope 位置参）
│  └─ inspect   [--render human|ai --explain]  # ← 原 context（改名 + 进 help，修 H1 浮空）
│
├─ Maintain ─────────────── 健康与遥测分离（D1 正本清源）
│  ├─ doctor    [--fix]                      # 5 秒看健康 ＋ 一键修（合并 fix+fix-knowledge）
│  └─ audit                                  # 遥测/审计读面（全移出 doctor）
│      ├─ cite           # ← 原 doctor --cite-coverage（20 行指标墙归这）
│      ├─ conflicts      # ← 原 doctor --lint-conflicts
│      ├─ history [mode] # ← 原 doctor --history / --archive-history 合一
│      ├─ descriptions   # ← 原 doctor --enrich-descriptions
│      ├─ metrics        # ← 原顶层 metrics 命令
│      └─ retired        # ← 新增：退役物全仓引用扫描（根治 SYNTHESIS T1，doctor lint 升命令）
│
└─ __internal ──────────── hidden，AI/skill RPC，永不进人面 help
   ├─ __plan-context  [--paths --all]   # ← 原 plan-context-hint（broad hook 数据源，KEEP）
   └─ __onboard-coverage [--json]       # ← 原 onboard-coverage（archive skill 依赖，KEEP）
```

**对照 maestro-flow 的取舍**：maestro 命令更多（~30 个 `src/commands/*.ts`）但**按领域名词分**（`spec`/`knowhow`/`wiki`/`tool`/`collab`/`workspace`），每个领域一个命令组、子命令做动作。Fabric 借其"领域名词＋子命令动作"的形态（`store`/`audit` 即名词组），但 **Fabric 故意更窄**——maestro 是通用工作流引擎，Fabric 是单一职责知识层，9 人面命令足够。**不照搬** maestro 把每个领域都升顶层命令（Fabric 顶层只留 3 个价值轴分组）。

---

## 3. 动词 / 命名体系

**核心原则：一致的动词模型 ＋ 命名空间隔离。**

### 3.1 动词三层模型

| 层 | 动词 | 语义 | 命令 |
|---|---|---|---|
| **生命周期** | install / uninstall | 装/卸 Fabric 本身 | `install` `uninstall` |
| **知识 CRUD-ish** | create / mount / bind / remove / migrate | 对 store 资源的增删挂 | `store *` |
| **读/查（只读，名词化）** | info / inspect / explain / list / audit | 看状态、不改 | `info` `inspect` `store list/explain` `audit *` |
| **健康/修** | doctor / `--fix` | 诊断 ＋ 修复 | `doctor` |
| **同步** | sync | git pull/push 知识 | `sync` |

**消歧规则（杜绝同义撞车）**：
- 一个语义只用一个动词。`add`/`create` 二选一 → 挂载用 `mount`、新建用 `create`。
- 含 `write` 的命令只保留 `switch-write`（设默认写库）；定向路由 `route-write` 降级为 `switch-write --scope` 或 `migrate route`。
- 含"全部"的词统一 **`all`**，禁用 `both`（doctor.ts:1008 现有 all/both 两套词汇是 bug 级不一致）。

### 3.2 命名空间隔离（根治 §0 误读）

- **人面命令**：进 grouped-help，无 `__` 前缀，名字对人直觉（`inspect` 而非 `context`，`info` 而非 `whoami`）。
- **内部 RPC**：`__` 前缀（`__plan-context` `__onboard-coverage`）+ 永久 hidden，**结构上从人面 help 消失**，但保留可调（hook/skill 用）。前缀让"这不是给你调的"一眼可辨，也让审计不再把它误读成人面死命令。
- **CLI 命令 ≠ MCP 工具**：MCP 工具走 `fab_*`（`fab_recall`/`fab_review`），CLI 命令走 `fabric *`。两个命名空间永不复用同名，避免"`fab_plan_context` 退役"被读成"`plan-context-hint` 退役"。

### 3.3 grouped-help 从 `allCommands` 派生（H1 结构根治）

现 grouped-help.ts 用**手维护命令名白名单**（grouped-help.ts:30-76 硬编码 4 组），新命令默认从 help 消失（已坑 `context`）。北极星：每命令在 `index.ts` 注册处打 `group: "knowledge"|"project"|"maintain"|"internal"`，grouped-help **遍历 `allCommands` 按 group 归并**，未打 group 且非 hidden 的进 "Other" 兜底——**结构上不可能再漏命令**。

---

## 4. 命令表收敛清单（按 价值÷成本 排序 ＋ 优先级）

> 价值÷成本评级：H=High M=Med L=Low。优先级 P0（先做，低成本高价值/解阻塞）→ P2（大重设计需逐项拍板）。
> **关键依赖**：凡碰 skill/hook 调用点的项，必须先迁移调用点再删旧命令（§0 的活跃数据契约）。

| # | 收敛项 | 类型 | 价值÷成本 | 优先级 | 迁移闸（先做什么才能做） |
|---|---|---|---|---|---|
| 1 | **grouped-help 从 `allCommands` 派生 ＋ group 标签**（修 `context` 浮空 H1） | 结构根治 | H ÷ M | **P0** | 无依赖；一处改动治标治本，防所有未来漏接 |
| 2 | **`store add`→`mount`、`route-write`→`migrate route`/`switch-write --scope` 命名消歧**（S1） | RENAME | H ÷ L | **P0** | 纯改名 ＋ i18n；零用户无兼容包袱 |
| 3 | **合并 `doctor --fix` ＋ `--fix-knowledge`→单一 `--fix`**（D2） | MERGE | H ÷ M | **P0** | 内部先 derived 后 knowledge，consent 闸不变（doctor.ts:963） |
| 4 | **删 deprecated 别名 whoami/status**（grouped-help 墓碑清零） | KILL | H ÷ L | **P0** | 零外部 caller，直接删命令文件 ＋ grouped-help.ts:54-66 |
| 5 | **`plan-context-hint`/`onboard-coverage`→`__`前缀 hidden**（命名空间隔离 §3.2） | RENAME | M ÷ L | **P0** | 改 2 处 spawn 名（hint-broad.cjs:468、archive skill）；防再被误读成死命令 |
| 6 | **`context`→`inspect` ＋ 进 Maintain/Project 组**（H1 配套 #1） | RENAME | M ÷ L | **P1** | 依赖 #1 落地；改名 ＋ 文档 |
| 7 | **`info scope` 升真子命令 ＋ 迁 4 skill 的 scope-explain JSON 调用**（I1 ＋ §0） | SPLIT/MERGE | M ÷ M | **P1** | **先**把 `fabric scope-explain team`→`fabric info scope team --json` 改进 4 skill 真源并验 JSON 形状一致，**再**删 scope-explain 别名 |
| 8 | **拆 doctor 遥测面→`fabric audit {cite,conflicts,history,descriptions}`**（D1） | SPLIT | H ÷ H | **P1** | 迁 i18n ＋ 任何 skill 对这些 flag 的引用；doctor 回归健康＋修 |
| 9 | **顶层 `metrics`→`audit metrics`**（语义归位） | MERGE | M ÷ L | **P1** | 无 skill caller，纯归组；随 #8 一起做 |
| 10 | **新增 `audit retired`（退役物全仓引用扫描）**（根治 SYNTHESIS T1） | NEW | H ÷ M | **P1** | 把 doctor 的 retired-reference lint 升为命令；防未来 stale pointer |
| 11 | **store 运维 3 子命令→`store migrate {scope,promote,route}`** ＋ list 表格化（S1） | MERGE | M ÷ M | **P2** | 运维降权；复用 install-summary 渲染器（install-summary.ts:173） |
| 12 | **store help 重组为 Knowledge/Project/Maintain 价值轴**（G1，配 #1） | 结构 | M ÷ L | **P2** | 依赖 #1 的 group 派生机制 |

**波次建议**：
- **P0（一波清完，低风险）**：#1 #2 #3 #4 #5——全是改名/删墓碑/合并 flag/加前缀，无结构风险，清掉最刺眼的歧义与浮空。命令表立刻从 16 注册 → 12（删 whoami/status，2 RPC 加前缀隐形）。
- **P1（需迁调用点）**：#6–#10——碰 skill/hook 契约的项，每项"先迁调用点 → 验证 → 删旧"。#8（doctor 拆 audit）最大、收益最高，建议单独 PR ＋ grill。
- **P2（大重设计，逐项拍板）**：#11 #12——store 运维收敛与 help 价值轴重组。

---

## 5. 北极星一句话

**今天从零设计，Fabric 该有 9 个人面命令、3 个价值轴分组（Knowledge/Project/Maintain）、2 个 `__`前缀内部 RPC、0 个 deprecated 别名。** doctor 只做"健康＋修"、遥测全归 `audit`、store 去同义词并把运维降权进 `migrate`、grouped-help 从注册表派生使"漏命令"在结构上不可能。最该守的红线：**删任何命令前先确认它不是 hook/skill 的活跃数据源**（plan-context-hint/onboard-coverage/scope-explain 三个都是，审计差点误删）。
