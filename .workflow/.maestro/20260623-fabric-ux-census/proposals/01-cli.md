# Fabric CLI 交互审计 — 等深度全审

审计员：CLI 交互触点 UX/DX
日期：2026-06-23
范围：`packages/cli/src/commands/*` + `install/*` + `lib/*` + `tui/*` + `index.ts` + i18n
基调：双角度（交互 + 策略）/ 激进授权（零用户、可 clean-slate）/ 全 grounded（file:line）
基线说明：C1（commits c1-w1..w7）已落地。C1 改的是**知识层策略**（frontmatter 砍到 2 字段、cite 内化删首行八股、self-archive marker-free、BM25F 召回、Stop hook 静音）。**C1 完全没动 CLI 命令表层**——本审计的所有发现都是 C1 之外的新问题。

---

## 一、Census 全集表（每个 `fabric` 子命令 + 关键 flag）

来源：`commands/index.ts:6-34`（路由注册）+ 各 command 文件。

| # | 命令 | 注册于 | 子命令 / 关键 flag | help 可见性 | 审了? | 一句话状态 |
|---|------|--------|-------------------|------------|------|-----------|
| 1 | `install` | index.ts:8 → install-v2.ts | `--global --url --dry-run --yes --target --debug --enable-embed --embed-model` | Setup 组 | ✅ | wizard/TUI 双渲染器互斥逻辑可疑；legacy install.ts 死代码 |
| 2 | `store` | index.ts:10 | `list create add remove explain bind switch-write route-write backfill-scope re-scope promote project{list,create}` (12 子命令) | Advanced 组 | ✅ | 子命令爆炸；create/add 同义歧义；输出裸 `\t` 分隔 |
| 3 | `sync` | index.ts:12 | `--continue --abort` | Daily 组 | ✅ | 干净；输出裸 `\t` |
| 4 | `info` | index.ts:14 | 位置参 `scope <path>` + `--global/-g --json` | Daily 组 | ✅ | 三态混在一命令；`info scope` 伪子命令 |
| 5 | `whoami` | index.ts:17 | `--json` | Advanced(deprecated) | ✅ | 已弃用 → `info --global` |
| 6 | `status` | index.ts:18 | `--json` | Advanced(deprecated) | ✅ | 已弃用 → `info` |
| 7 | `scope-explain` | index.ts:19 | 位置参 `scope` | Advanced(deprecated) | ✅ | 已弃用 → `info scope` |
| 8 | `doctor` | index.ts:20 | `--fix --fix-knowledge --json --verbose` (曝光) + 14 个隐藏 flag | Diagnostic 组 | ✅ | **重灾区**：1650 行、14 隐藏 flag、6 个 mutex 报错、cite-coverage 渲染 20+ 行 |
| 9 | `uninstall` | index.ts:21 | `--dry-run --yes --target --debug` | Setup 组(隐含) | ✅ | 干净；wizard 已 grill 修过 |
| 10 | `config` | index.ts:22 | `--target` + 子命令 `dismiss-slot`/`onboard-reset`(均 hidden) | Setup 组 | ✅ | 交互 panel；隐藏子命令 argv 扫描 hack |
| 11 | `plan-context-hint` | index.ts:23 | `--paths --all --target` | hidden | ⚠️ 部分 | AI/skill 专用 JSON 适配器，非人面 |
| 12 | `onboard-coverage` | index.ts:27 | `--json --target` | hidden | ✅ | skill 专用；人面表格冗余 |
| 13 | `metrics` | index.ts:30 | `--json --target --since` | hidden | ✅ | 维护者向 dashboard |
| 14 | `context` | index.ts:33 | `--render human\|ai --explain --target` | 可见(未分组!) | ✅ | **未进 grouped-help 任何组**——浮空 |

**Census 关键发现**：
- 注册 14 个命令，但 `grouped-help.ts` 只列 **9 个**（install/uninstall/config/sync/info/doctor/store/whoami/status/scope-explain）。`context`（#14，**非 hidden**，meta 无 `hidden:true`）既不在任何组里、又不是 hidden——它会出现在 citty 默认 usage 但**不在自定义 grouped help**，即用户跑 `fabric --help` **永远看不到 `fabric context`**，但它是个面向人的命令（"看 SessionStart 注入了什么"）。这是 census 漏接的硬伤（见 §问题 H1）。
- `plan-context-hint`/`onboard-coverage`/`metrics` 三个 hidden 命令是 skill/AI 内部 RPC，不该算人面 CLI，但它们仍占着顶层命名空间。

---

## 二、逐命令审计

### H1. `context` 命令在 help 里浮空（grouped-help census 漏接）

**现状**：`context.ts:142-145` meta 无 `hidden`，是面向人的命令。但 `grouped-help.ts:30-76` 的 4 个组（Setup/Daily/Diagnostic/Advanced）硬编码命令名，**没有 `context`**。`customShowUsageGrouped`（grouped-help.ts:130-133）对 root 命令只渲染这张硬编码表。

**问题（交互）**：用户 `fabric --help` 看不到 `context`。这是个有用命令（"Fabric 到底往我会话里塞了什么"，对调试"AI 怎么没用上某条知识"极有价值），却只能靠口口相传发现。
**问题（策略）**：grouped-help 用**手维护的命令名白名单**而非从 `allCommands` 派生——任何新命令默认从 help 消失。这违反 census 律（全集可见）。已经发生一次（context）。

**方案（激进）**：grouped-help **从 `allCommands` 派生**，给每个命令在注册处打 `group: "daily"` 标签（或在 meta 加 `group` 字段），grouped-help 遍历 `allCommands` 按 group 归并，未打 group 且非 hidden 的进 "Other" 兜底组——**结构上不可能再漏命令**。`context` 归 Diagnostic 组。
**价值÷成本**：价值 High（修真 bug + 防回归）÷ 成本 Med（动注册结构但范围小）。

---

### D1. `doctor` —— 用户原话点名"输出格式难读"，确实是重灾区

**现状**：
- 单文件 **1650 行**（doctor.ts）。
- 14 个隐藏 flag（doctor.ts:135-150 `HIDDEN_FLAGS`），只曝光 4 个（`EXPOSED_FLAGS` doctor.ts:125-131）。
- **6 处 mutex 报错**（`history-mutex` :323、`archive-history-mutex` :366、`enrich-descriptions-mutex` :400、`cite-coverage-mutex` :425、`lint-conflicts-mutex` :487、`fix-knowledge-fix-mutually-exclusive` :507）——8 个 flag 两两互斥。
- 默认输出：状态行 + TL;DR top-3（:811）+ 逐 check（默认只 warn/error，:698-703）+ 3 个 issue section + payload-limits + store health。
- `--cite-coverage` 单独渲染 **20+ 行**指标（doctor.ts:1070-1186）：edits_touched / qualifying_cites / recalled_unverified / compliance_rate / recall_coverage / uncorrelatable / exposed_and_mutated / mutations_observed / mutation_pool / sessions_closed / by_store + per-client + dismissed histogram + none histogram + contract block。

**问题（交互）**：
1. `doctor` 被塞成了**一个命令做 8 件事**：lint / fix / fix-knowledge / cite-coverage / enrich-descriptions / archive-history / history / lint-conflicts。每件事一个 flag、互相 mutex，用户要记"哪些能组合哪些不能"。这是把 8 个子命令压进 flag 命名空间的反模式——maestro 对照（参 maestro 把诊断拆成 `view`/`collab preflight`/`workspace status` 等独立命令，src/commands）。
2. `--cite-coverage` 的 20+ 行指标墙是给**维护者/Goodhart 审计**看的，普通用户撞见一脸懵。它根本不属于"doctor"（健康检查）语义。
3. 隐藏 flag 模式（`HIDDEN_FLAGS` + `renderDoctorFilteredHelp` doctor.ts:1612）= 承认"这命令 flag 太多见不得人"，于是藏一半。藏 flag 不等于减复杂度，只是把复杂度藏进只有维护者知道的暗角。

**问题（策略）**：把 `cite-coverage`/`metrics`-类**遥测报告**和 `--fix`/`--fix-knowledge`**修复动作**塞进同一个 `doctor` 命令，混淆了"诊断（只读、给人看健康）"与"审计（遥测、给维护者看趋势）"两种正交意图。doctor 应是"5 秒看健康、一键修"，不是遥测中控台。

**方案（激进，clean-slate 拆分）**：
```
before:  fabric doctor [--fix|--fix-knowledge|--cite-coverage|--enrich-descriptions
                        |--archive-history|--history|--lint-conflicts|...14 flags]
after:
  fabric doctor              # 只读健康：TL;DR + actionable checks + store health。默认面。
  fabric doctor --fix        # 保留（合并 fix + fix-knowledge，见下）
  fabric audit cite          # ← 原 --cite-coverage（遥测，移出 doctor）
  fabric audit conflicts     # ← 原 --lint-conflicts
  fabric audit history [mode]# ← 原 --history/--archive-history 合一
  fabric audit descriptions  # ← 原 --enrich-descriptions
  (metrics 命令 #13 也归入 fabric audit metrics)
```
新增一个 `fabric audit <subcommand>` 命令组收纳所有"遥测/审计"读面，`doctor` 回归"健康+修复"本职。mutex 报错从 6 个降到 1 个（fix vs fix-knowledge，且这俩也建议合并见 D2）。
**价值÷成本**：价值 High（直击用户原话痛点 + 语义正本清源）÷ 成本 High（拆命令、迁移 i18n、改文档/skill 调用点）。**Top 候选**。

---

### D2. `doctor --fix` vs `--fix-knowledge` 双修复 flag 反直觉

**现状**：`--fix` 修 derived-state（agents.meta.json），`--fix-knowledge` 修 knowledge 条目（frontmatter + git mv），两者 mutex（doctor.ts:506-510）。help 里并列两个"fix"（doctor.ts:1631）。

**问题（交互）**：用户第一次见 `--fix` 和 `--fix-knowledge`，**猜不出区别**——都叫 fix。还得读文档才知道一个修元数据一个修知识，且不能同时用。"我就想修好，为什么要我选修哪一半？"
**问题（策略）**：让用户承担"derived-state vs knowledge mutation"的内部架构区分，是把实现细节泄漏成 UX。注释（doctor.ts:502-505）说"combining them is ambiguous"——但对用户**毫不 ambiguous**：用户要的就是"全修好"。

**方案**：合并为单一 `fabric doctor --fix`，内部先跑 derived-state fix 再跑 knowledge fix（knowledge fix 的 git-mv/frontmatter 写仍走原 consent 闸 doctor.ts:963-990）。需要只修一半的高级用户用 `--fix --only=derived|knowledge`（隐藏）。before: 2 个并列 fix flag + mutex；after: 1 个 fix + 可选 `--only`。
**价值÷成本**：价值 High÷ 成本 Med。

---

### S1. `store` —— 12 个子命令，create/add 同义歧义，输出裸 `\t`

**现状**：`store.ts:411-426` 注册 12 个子命令：`list create add remove explain bind switch-write route-write backfill-scope re-scope promote project`（project 下还有 list/create，三层嵌套 `store project create`）。

**问题（交互）**：
1. **`create` vs `add` 命名撞车**（store.ts:64「add = Mount an existing store」vs :100「create = Create a brand-new store」）。第一次见 `store add` / `store create` 区分不出"加已有 / 建新的"——两个词在日常英语里几乎同义。
2. **`switch-write` vs `route-write` 撞车**（:188 switch-write = 设默认写 store；:201 route-write = 把某 scope 路由到 store）。又是两个含 "write" 的命令，语义微妙不同，靠用户读 description 区分。
3. **`backfill-scope` / `re-scope` / `promote`** 三个都是"改条目 semantic_scope"的运维命令（:260/:354/:384），三个动词三套 flag，普通团队成员根本用不到（AGENTS.md 明说 dev 只需 `bind`/`switch-write`）。
4. 输出裸 `\t` 分隔（`store.ts:58` `${alias}\t${mount_name}\t${uuid}\t${remote}`，list 命令），无表头、无对齐。对照 install-summary.ts 已有 `padEnd`/表格渲染器（install-summary.ts:173），store 没复用。

**问题（策略）**：`store` 把"日常 3 命令（bind/switch-write/list）"和"运维/迁移 9 命令（add/create/route-write/backfill-scope/re-scope/promote/project*）"平铺在同一层。AGENTS.md 自己都说 dev 只碰前者——说明命令表没反映使用频率分层。

**方案（激进）**：
- 重命名消歧：`store add`→`store mount`（挂载已有），`store create` 保留（建新）。`route-write`→`store write-route`（或并入 `switch-write` 加 `--scope` flag）。
- 运维子命令降权：把 `backfill-scope`/`re-scope`/`promote` 收进 `store migrate {scope,promote}` 子组，或直接移给 `fabric doctor --fix` / `fabric audit` 自动处理（这些本就是数据修复）。
- `store list` 改用 install-summary 的表格渲染器（表头 + 对齐列），别裸 `\t`。
- before: `store {list,create,add,remove,explain,bind,switch-write,route-write,backfill-scope,re-scope,promote,project}` (12)
  after: `store {list,create,mount,remove,bind,switch-write,explain,migrate{...}}` (~8，运维归 migrate)
**价值÷成本**：命名消歧 价值 High÷成本 Low；运维降权 价值 Med÷成本 Med；表格化 价值 Med÷成本 Low。

---

### I1. `info` —— 三态压一命令 + `info scope` 伪子命令

**现状**：`info.ts` 把原 whoami/status/scope-explain 合一（EPIC-010）。模式解析 `resolveMode`（info.ts:79-96）：`info scope <path>`→scope-explain；`info --global`→whoami；默认→status。`scope` 是**位置参**伪装成子命令（info.ts:26-35）。

**问题（交互）**：
1. `fabric info` 默认给项目 status，`fabric info --global` 给身份，`fabric info scope team` 给 scope 解析——**三种完全不同的输出靠一个 flag 一个位置参切换**。用户得知道"global 是 flag、scope 是位置参"这种不对称。
2. `info scope` 是**手搓的位置参 dispatch**（info.ts:85 `if args.subcommand === "scope"`），不是 citty 真子命令。意味着 `fabric info scope --help` 不会给 scope 专属帮助，错误处理也是手写（info.ts:58-62）。
3. 输出全裸 `console.log` 拼字符串（info.ts:133-142），无颜色无对齐，和 doctor 的彩色 symbol 体系（colors.ts）不一致。

**问题（策略）**：合并 whoami/status/scope-explain 的初衷（减命令）对，但执行成了"一个命令三种人格"。scope-explain 是"解析某 scope 坐标"（带输入参数的查询），与 status/whoami（无参快照）是不同种类的操作，硬塞一起。

**方案**：
- 保留 `fabric info`（= 项目 status，默认无参快照）和 `fabric info --global`（身份）——这俩同类，合并合理。
- `scope` 拆回**真子命令** `fabric info scope <coord>`（用 citty subCommands，不是位置参 dispatch），这样有独立 help/错误。
- status 输出用 colors.ts 的 paint + 对齐（现 info.ts:133-142 裸拼）。
**价值÷成本**：scope 真子命令化 价值 Med÷成本 Low；输出上色 价值 Low÷成本 Low。

---

### IN1. `install` —— wizard / Ink-TUI 渲染器互斥逻辑可疑 + legacy install.ts 死代码

**现状**：
- `shouldUseInstallRenderer`（install-v2.ts:175-180）：**仅当 `--yes` 或 `--dry-run`** 才用 Ink TUI 渲染器。
- `wizardEnabled`（install-v2.ts:163）：`terminalInteractive && !args.yes && !planOnly`——即**默认交互安装**（无 flag）走 clack wizard。
- 两者构造上互斥：默认 `fabric install` → 无 Ink 渲染器（renderer=undefined，:109-111）、走 wizard（pipeline 内）；`fabric install --yes` → 有 Ink 渲染器、无 wizard。

**问题（交互）**：`--yes`（"别问我，全默认"）反而**触发花哨 TUI 渲染器**，而真正需要可视化引导的**默认交互安装却没有 Ink 渲染器**（只有 clack 文本 wizard）。这关系反了：非交互(`--yes`)要的是干净纯文本日志（便于 CI 抓），交互才需要 TUI。`shouldUseInstallRenderer` 的 `args.yes === true` 条件极可疑。
**问题（策略）**：`install.ts`（legacy v1，含完整 `installCommand` defineCommand at install.ts:245 + InitOptions/InitStageName 等类型）**未被 index.ts 路由**（index.ts:8 只 import install-v2），但 `install-wizard.ts`/`install-summary.ts`/`install-diff.ts`/`install-stage-output.ts`/`install-path-output.ts` 仍从 `commands/install.js` import 类型（grep 实证：5 个文件）。即活跃的 install-v2 与僵尸 install.ts **并存**，类型定义留在死命令文件里。维护者改 install 时面对两个 install 文件不知改哪个。

**方案**：
- 修 `shouldUseInstallRenderer`：交互（非 yes、非 dry-run、isTTY）才用 Ink 渲染器；`--yes`/CI 走纯文本 stage 日志。（需确认 pipeline 内 wizard 与 renderer 协作语义，建议先 delegate 验证再改。）
- 把 install.ts 里**仍被引用的类型**（InitOptions/InitStageName/InitStageRecord 等）抽到 `install/types.ts`，删除 install.ts 的死 `installCommand` + 死执行逻辑。consumers 改 import types。
**价值÷成本**：渲染器逻辑修正 价值 Med÷成本 Med（需先验证）；死代码清理 价值 Med÷成本 Med。

---

### E1. 错误渲染 —— 只覆盖 FabricError，其余裸 `console.error(err)`

**现状**：`error-render.ts` 的 `renderTopLevelError`（:45-54）只处理带 `actionHint` 的 FabricError，渲染成 `message\n  -> actionHint`（:30-32，ASCII `-> ` 兼容 GBK，已考虑周到）。但 index.ts:89 兜底 `console.error(err, "\n")`——非 FabricError 的运行时异常直接打**裸 Error 对象（含 stack）**给用户。

**问题（交互）**：只有显式抛 FabricError 的路径（lock-held 等少数）有友好 actionHint。一个普通 `TypeError`/`ENOENT` 会把整个 stack trace 喷给用户（index.ts:89）。命令内各自手写错误（onboard-coverage.ts:326 `onboard-coverage failed:`、context.ts:168、store.ts:287 等）格式各异——有的 `→`、有的 `->`、有的纯文本，无统一前缀（对照 maestro 也是裸 `console.error`，但 Fabric 已有 paint.error 体系却没统一用）。
**问题（策略）**：FabricError 的 actionHint 机制（"每个错误带可执行下一步"）是好策略，但只在少数抛点用了。绝大多数错误路径没产出 actionHint，机制覆盖率低。

**方案**：
- index.ts:89 兜底改为：非 FabricError 也走统一渲染——`paint.error` 前缀 + 单行 message，stack 仅 `--debug` 时出。
- 各命令手写的 `xxx failed:` 收敛到一个 `renderCommandError(name, err)` helper（lib/error-render.ts），统一前缀/颜色/可选 actionHint。
**价值÷成本**：价值 Med÷成本 Med。

---

### G1. grouped-help —— Advanced 组塞 3 个 deprecated，无 Knowledge 概念

**现状**：grouped-help.ts:52-75 的 Advanced 组 = `store` + 3 个 deprecated（whoami/status/scope-explain，各带 `(deprecated → ...)` 后缀）。

**问题（交互）**：
1. Advanced 组 4 项里 3 项是**墓碑**。用户扫 help 时一半 Advanced 是"别用我"。deprecated 命令应从顶层 help **完全移除**（仍可调，但不占 help 视觉空间），而非陈列。
2. 整个 help 没有体现 Fabric 的**核心概念是"知识"**——组名是 Setup/Daily/Diagnostic/Advanced（动作分类），但用户的心智模型是"我的知识库（store）怎么管"。`store` 被埋在 Advanced，而它是 Fabric 的心脏。
**问题（策略）**：组划分按"安装生命周期阶段"（setup→daily→diagnostic），但 Fabric 的价值轴是知识管理。help 没把 store/sync（知识同步）提到一等公民。

**方案（激进）**：
```
before: Setup / Daily / Diagnostic / Advanced(含3墓碑)
after:
  Knowledge:  store, sync          # 心脏：管/同步知识
  Project:    install, config, info
  Maintain:   doctor, audit        # (audit = D1 拆出的新组)
  (deprecated 命令从 help 移除，仅 --help <cmd> 时提示已弃用)
```
**价值÷成本**：墓碑移除 价值 Med÷成本 Low；重组概念轴 价值 Med÷成本 Low。

---

## 三、命名直觉专项（逐命令"第一次见能猜对吗"）

| 命令/子命令 | 第一眼能猜对? | 评 + 改名建议 |
|------------|-------------|--------------|
| `install` / `uninstall` | ✅ | 标准，留 |
| `doctor` | ✅ | 健康检查通用隐喻，留（但收窄职能，D1） |
| `sync` | ✅ | 留 |
| `config` | ✅ | 留 |
| `info` | ⚠️ | 太泛，"info 关于啥？"。可接受但默认给 status 不直观 |
| `context` | ⚠️ | "context 是啥的 context？" 不直观；建议 `show-injected` 或归 `doctor context` |
| `store add` vs `store create` | ❌ | 同义撞车 → `add`改 `mount` |
| `store switch-write` vs `route-write` | ❌ | 都含 write → `route-write` 改 `write-route` 或并入 switch-write |
| `store backfill-scope` / `re-scope` / `promote` | ❌ | 内部运维黑话，用户零直觉 → 收进 `store migrate` |
| `store explain` | ✅ | 留 |
| `store project create` | ⚠️ | 三层嵌套 + "project" 与仓库 project 概念易混 |
| `doctor --fix-knowledge` | ❌ | 与 `--fix` 撞 → 合并(D2) |
| `doctor --enrich-descriptions` | ⚠️ | 长且像内部术语 → 移 `audit descriptions` |
| `whoami` | ✅(但已弃用) | 经典，可惜要删 |
| `plan-context-hint` | ❌(hidden,可接受) | AI RPC 名，非人面，OK |
| `onboard-coverage` | ⚠️(hidden) | 黑话，但 hidden 故可接受 |

---

## 四、参数反直觉专项

1. **`doctor --since` 默认 `7d`，但 bare `doctor` 不消费它**（doctor.ts:204-208 + :307-315）：default 值挂在一个只有部分 flag 用的字段上，单跑 `doctor` 时这 default 无意义但仍存在。已有 BUG-M2 修过校验（:301-315），但 default 归属本身反直觉。
2. **`info --global` 用 flag 切换"完全不同的命令"**（info.ts:90）：flag 通常是修饰，不是切换命令身份。`--global` 在这里=换了个命令，反直觉（见 I1）。
3. **`store create --remote` 可选、`store add --remote` 也可选但语义不同**（store.ts:69 add 的 remote="git locator"，:105 create 的 remote="push target"）：同名 flag 在姐妹命令里语义漂移。
4. **`doctor --client` 默认 `all` 但 valueHint `cc|codex|all`**（doctor.ts:209-214）：`cc` 缩写不直观（Claude Code），首次见猜不出。
5. **`doctor --layer` 拒绝 `both` 只接受 `all`**（doctor.ts:1008-1023 + 注释解释 cite 用 `all` 而 plan-context 用 `both`）：**同一 CLI 内两套"全部"词汇**（all vs both）是策略层不一致，注释自己都在解释这个坑——应统一为 `all`。
6. **`config` 顶层只有 `--target`，所有编辑走交互**（config.ts:35-36 注释"能交互选的就别做 flag"）：策略一致、好。但 `dismiss-slot`/`onboard-reset` 是 hidden 子命令，靠 `process.argv` 扫描短路父 run（config.ts:290-293），脆弱 hack——若 citty 升级改 argv 语义会断。
7. **`--dry-run` 在 install 里触发 Ink 渲染器**（install-v2.ts:179）：dry-run 本意"别动 + 给我看计划"，配 TUI 渲染器尚可，但与 `--yes` 共用同一渲染器触发条件，语义混（IN1）。

---

## 五、本类 Top 5 高价值改动（按 价值÷成本 排序）

1. **【grouped-help 从 `allCommands` 派生 + 修 `context` 浮空】(H1)** — 价值 High ÷ 成本 Med。修真 bug（`context` 命令用户永远看不到）+ 结构上杜绝"新命令默认从 help 消失"。一处改动同时治标治本。**最高性价比。**

2. **【`store add`→`mount` + `route-write`→`write-route` 命名消歧】(S1 部分)** — 价值 High ÷ 成本 Low。两组同义撞车命令是新用户最大困惑源，纯重命名（零用户无兼容包袱），改 i18n + 注册名即可。

3. **【合并 `doctor --fix` / `--fix-knowledge` 为单一 `--fix`】(D2)** — 价值 High ÷ 成本 Med。消灭"两个都叫 fix 还互斥"的反直觉，用户"一键修好"。

4. **【拆 `doctor` 的遥测/审计面到 `fabric audit` 命令组】(D1)** — 价值 High ÷ 成本 High。直击用户原话"doctor 输出难读"根因（doctor 一命令做 8 事、cite-coverage 20 行指标墙）。成本高但收益最大，doctor 语义正本清源。

5. **【清理 legacy `install.ts` 死代码 + 修 install 渲染器互斥逻辑】(IN1)** — 价值 Med ÷ 成本 Med。两个 install 文件并存是维护陷阱；`--yes` 触发 TUI 而默认交互无 TUI 的逻辑很可能反了（建议先 delegate 验证 pipeline wizard/renderer 协作再动手）。
