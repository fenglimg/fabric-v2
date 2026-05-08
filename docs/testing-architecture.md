# fabric 测试框架架构

> 受众: 新贡献者 / reviewer / "fabric 怎么测的？"
> 配套文档: [docs/test-seed/README.md](./test-seed/README.md) — 种子操作手册（如何维护单份种子）
> 决策来源: ANL-2026-05-08-fabric-test-cases (analyze 会话)

本文档讲 **WHAT / WHY**：fabric 用了哪几种测试形态、为什么这么搭、决策依据是什么。
[docs/test-seed/README.md](./test-seed/README.md) 讲 **HOW-TO**：单份种子怎么写、怎么维护、怎么 review。两份文档互补，不重复。

---

## §1 全景图

fabric 的测试体系按职责分四层。最上层是"意图"，最下层是"自动化"，中间两层是"执行"与"防漂移"。

```
+--------------------------------------------------------------------+
| 层 1  意图层（薄种子）                                               |
|                                                                    |
|   docs/test-seed/cli.md     docs/test-seed/server.md               |
|   docs/test-seed/shared.md  docs/test-seed/README.md  [已有]       |
|                                                                    |
|   表达: feature surface + invariants + known-tricky                |
|   不表达: 具体测试用例 / 实现细节 / Gherkin 仪式                    |
+----------------------------|---------------------------------------+
                             | 单点 prompt 引用
                             v
+--------------------------------------------------------------------+
| 层 2  执行层（5 种测试形态共存）                                     |
|                                                                    |
|   (1) 类型契约          TypeScript + zod              [已有]        |
|   (2) Golden Snapshot   vitest snapshot               [已有]        |
|   (3) BDD-leaning it()  vitest (~439 个 it())         [已有]        |
|   (4) Property-based    @fast-check/vitest            [新增]        |
|   (5) Coverage          vitest --coverage             [强化中]      |
+----------------------------|---------------------------------------+
                             | 测试文件落盘后被护栏体系审视
                             v
+--------------------------------------------------------------------+
| 层 3  防漂移护栏                                                    |
|                                                                    |
|   knip 零基线              [已有]                                   |
|   lint-protected-tokens    [已有]                                   |
|   CLI --help drift gate    [新增, TASK-003]                         |
|   lefthook pre-commit      [已有]                                   |
+----------------------------|---------------------------------------+
                             | release gate 强制对账
                             v
+--------------------------------------------------------------------+
| 层 4  AI 自动化轨道                                                 |
|                                                                    |
|   /workflow:integration-test-cycle                                 |
|     按包独立跑（cli / server / shared 各一个 session）              |
|     消费层 1 种子, 产出层 2 测试, 受层 3 护栏审视                   |
+--------------------------------------------------------------------+
```

四层之间是单向依赖：上层定义意图，下层执行并验证；任何一层都可独立工作（即便没有 cycle，已有的 ~439 个 it() 仍是真理）。

---

## §2 五种测试形态（What / Why / Where）

| 形态 | 工具 | 范围 | 示例位置 | 状态 |
|---|---|---|---|---|
| ① 类型契约 | TypeScript + zod | shape 漂移 | `packages/shared/src/schemas/*` | 已有 |
| ② Golden Snapshot | vitest snapshot + zod-to-json-schema | 协议契约 | `packages/server/__tests__/tool-contracts.test.ts` | 已有 |
| ③ BDD-leaning it() | vitest | 行为单测/集成 | 全包 (~439 个) | 已有 |
| ④ Property-based | @fast-check/vitest | 不变量验证 | `packages/shared/test/property-based/`（计划） | **新增**（Rec #3） |
| ⑤ Coverage threshold | vitest --coverage | 兜底 | CI | 强化中 |

简述：

- **① 类型契约**：在编译期就把 shape 钉死，zod schema 同时作为运行时校验。任何 schema 改动会传染到 import 它的所有文件，编译失败即可发现漂移。
- **② Golden Snapshot**：MCP tool 的 JSON Schema 用 zod-to-json-schema 序列化后落 snapshot，协议级变更必须显式 `--update`。它的边界是"协议是否变了"，不是"行为是否对"。
- **③ BDD-leaning it()**：fabric 的主力。it() 名称用动词描述行为（"emits forensic record on init"），无 Given/When/Then 仪式。这是维护者人工写测试的默认形态。
- **④ Property-based**：仅用于不变量级断言（如 detector idempotent、normalization round-trip），不替换 it()，覆盖"枚举不完的边界"。
- **⑤ Coverage threshold**：cli 70% / server 75% / shared 85%，是 cycle 双门退出条件之一，单独不能证明测试有效，需配合 §1 invariants 共同把关。

---

## §3 防漂移护栏

测试只能证明"今天通过"，护栏负责防"明天偷偷漂移"。

- **knip 零基线**（已有）— `knip.config.ts`，死代码检测，与 1.8.0 收敛同步。任何未引用导出立即 CI 失败。
- **lint-protected-tokens**（已有）— `packages/cli/__tests__/lint-protected-tokens.test.ts`，i18n 受保护词（如 `fabric`、`fab`、命令名）不被翻译/改写。
- **CLI --help drift gate**（**新增**，TASK-003）— `packages/cli/__tests__/cli-surface.test.ts`，`fab --help`、`fab init --help`、`fab scan --help`、`fab doctor --help`、`fab serve --help` 输出快照与 [docs/test-seed/cli.md](./test-seed/cli.md) §1 不一致时 CI 失败。这是种子 §1 与代码对账的唯一自动化通道。
- **lefthook pre-commit**（已有）— 本地质量门，在 commit 前跑 lint + typecheck，避免显然错误进入 PR。

护栏不是测试，但与测试共享同一个失败信号源（CI 红/绿）。它们之间的角色分工：测试问"行为对不对"，护栏问"接口面变没变"。

---

## §4 种子 → cycle 管道

种子如何被 integration-test-cycle 消费：

1. **种子位置**：`docs/test-seed/{cli,server,shared}.md`，每份 ≤200 行（[docs/test-seed/README.md](./test-seed/README.md) §4 反模式硬上限）。
2. **cycle 怎么读**：通过 prompt 路径引用（见 §7 命令模板），cycle 内部 `cli-explore-agent` 自动用 Read 工具加载这个文件。fabric 不需要为 cycle 改任何代码，零侵入。
3. **双门完成判定**：cycle 一轮 session 必须同时满足两个条件才算收敛——
   - **coverage 阈值**：cli 70% / server 75% / shared 85% 行覆盖。
   - **invariants 全 represented**：种子 §2 列的每条不变量在新生成测试里至少有 1 条 `it()` 断言。
4. **冲突标记**：cycle 反思日志检测到 invariant 与实际行为冲突时，输出 `⚠️ Invariant Conflict` 标记并暂停。**不自动 fix**，等维护者裁定（修代码 / 修种子 / 删 invariant）。具体处理流程见 §7。

---

## §5 每包策略矩阵

| 包 | 主测试形态 | 工具 | 测试位置 | 种子文件 | 备注 |
|---|---|---|---|---|---|
| cli | spawn-and-assert + --help snapshot | vitest, citty, execa | `__tests__/`、`__tests__/integration/`（cycle 产物） | [docs/test-seed/cli.md](./test-seed/cli.md) | 25 测试文件 / ~140 it() |
| server | colocated unit + integration + golden contract | vitest, zod-to-json-schema | colocated `*.test.ts` + `__tests__/` + `__tests__/integration/` | [docs/test-seed/server.md](./test-seed/server.md) | ~26 测试 / ~210 it() |
| shared | unit + property-based 不变量 | vitest, **fast-check** | `test/`、`test/property-based/` | [docs/test-seed/shared.md](./test-seed/shared.md) | 8 测试 / ~89 it() |
| dashboard | （暂缓，后期补） | vitest jsdom + @testing-library/preact（计划） | （暂无） | （暂无） | 当前覆盖洼地，单独 epic 处理 |

策略差异的根因：

- **cli** 走子进程，所以主形态是 spawn-and-assert + --help snapshot；不变量少，命令面稳定。
- **server** 同时承担 REST、SSE、MCP tool 三套协议，golden snapshot 是它独有的契约线。
- **shared** 是纯库，property-based 在这里收益最高（detector idempotent、schema round-trip）。
- **dashboard** 仍是覆盖洼地，本轮架构不规划，单独 epic 处理。

---

## §6 11 项设计决策溯源

来源：`/.workflow/.analysis/ANL-2026-05-08-fabric-test-cases/discussion.md`。

| Q | 主题 | 决策 | 一句理由 |
|---|---|---|---|
| Q1 | 消费者 | integration-test-cycle | 自迭代闭环；test-fix-gen 需先有失败测试不适用 |
| Q2 | 受众 | 双受众（cycle + 维护者） | 单受众设计会损失种子核心价值 |
| Q3 | 注入方式 | prompt 引用种子路径 | cycle 自带 Read 工具，零侵入 |
| Q4 | source of truth | 代码（含测试 + zod schema） | 种子表达意图，代码是执行真理 |
| Q5 | 修改触发 | intent 变更 + 重大事件后追加 §3 | 避免双重维护；§3 沉淀经验 |
| Q6 | 跑法 | 按包独立跑 cycle | 范围聚焦 + 反思日志清晰 |
| Q7 | 完成判定 | coverage + invariants 双门 | 防"测了实现没测意图" |
| Q8 | 冲突处理 | cycle 标记 ⚠️ → 人工裁定 | 不自动改避免错误掩盖错误 |
| Q9 | 初版起草 | AI 起草 + 维护者 review | 平衡机器抽取与领域经验 |
| Q10 | CI 强度 | release gate | 每 PR 强制会逼出"水测试"反模式 |
| Q11 | 测试落地 | `__tests__/integration/` 子目录 | 与维护者手写测试可视区分 |

---

## §7 cycle 启动指引

### 前置条件

1. `docs/test-seed/<pkg>.md` 已被维护者 review（不消费 AI 草案，参见 [docs/test-seed/README.md](./test-seed/README.md) §3 末尾约定）。
2. `packages/<pkg>/__tests__/integration/` 目录已存在，或允许由 cycle 创建（shared 用 `test/integration/`）。
3. 当前 git 分支干净（cycle 会写入测试文件，脏工作区会让产物追溯困难）。

### 3 条独立命令模板

每个包独立一个 session，**不混跑**。直接复制粘贴：

```bash
# CLI 包 cycle
/workflow:integration-test-cycle "依据 docs/test-seed/cli.md 的 §2 invariants 与 §3 known-tricky cases 为 packages/cli 生成集成测试，落地到 packages/cli/__tests__/integration/，目标双门：coverage ≥ 70% line + §2 所有 invariant 至少 1 条测试断言"
```

```bash
# Server 包 cycle
/workflow:integration-test-cycle "依据 docs/test-seed/server.md 的 §2 invariants 与 §3 known-tricky cases 为 packages/server 生成集成测试，落地到 packages/server/__tests__/integration/，目标双门：coverage ≥ 75% line + §2 所有 invariant 至少 1 条测试断言。重点覆盖 MCP tools 的 contract drift 与跨服务 (rule-sync + event-ledger) 数据流"
```

```bash
# Shared 包 cycle
/workflow:integration-test-cycle "依据 docs/test-seed/shared.md 的 §2 invariants 与 §3 known-tricky cases 为 packages/shared 生成集成测试，落地到 packages/shared/test/integration/，目标双门：coverage ≥ 85% line + §2 所有 invariant 至少 1 条测试断言。优先复用现有 fast-check property-based 测试覆盖不变量"
```

### 冲突处理流程

cycle 反思日志输出 `⚠️ Invariant Conflict` 时：

1. cycle 暂停，**不自动 fix**。
2. 维护者打开反思日志，三选一裁定：
   - **(a) 是 bug** → 修代码（git checkout 后修，再次跑 cycle）。
   - **(b) 意图过时** → 修种子（删/改 invariant，commit 后再跑 cycle）。
   - **(c) 接受现状** → 删 invariant 并在 commit message 说明原因。
3. 解决后用 `/workflow:integration-test-cycle --continue "<pkg>"` 续跑当前 session。

### 产物位置约定

- **cli**: `packages/cli/__tests__/integration/cycle-*.test.ts`
- **server**: `packages/server/__tests__/integration/cycle-*.test.ts`
- **shared**: `packages/shared/test/integration/cycle-*.test.ts`
- **反思日志**（保留供 release 评审）: `.workflow/.integration-test/<sid>/reflection-log.md`

文件名前缀 `cycle-` 是与维护者手写测试的可视区分手段（见 Q11 决策）。

---

## §8 衡量正确性指标

架构是否运转正常，看下表 7 个指标。

| 指标 | 目标 | 数据来源 |
|---|---|---|
| 种子 §1 与 --help/exports 一致 | 100% | TASK-003 自动化（CLI surface drift gate） |
| §2 invariant 测试覆盖率 | ≥ 90% | cycle 反思日志 |
| 单 cycle session 新增测试数 | 30-80 | state.json |
| 反思日志中 ⚠️ 冲突频次 | < 月均 1 次 | reflection-log |
| §1+§2 修改频次 | 月均 ≤ 1 次 | git log |
| §3 修改频次 | 月均 1-2 次 | git log |
| Release gate 拦截次数 | 每 release 1-3 次小修补 | CI |

任一指标长期偏离 → 架构设计需重新评估（详见 [docs/test-seed/README.md](./test-seed/README.md) §5 反指标）。
