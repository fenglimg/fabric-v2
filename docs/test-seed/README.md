# Test Seeds — fabric

≤1 页/包的薄种子，连接维护者意图与 integration-test-cycle。种子表达**意图**，不复述实现；由 cycle 在生成测试前作为单点 prompt 引用。

## §1 模块单位定义

种子粒度与 [CODEBASE_LANDSCAPE](../CODEBASE_LANDSCAPE.md) 表一致，且与各包测试文件的组织粒度对齐。

- **cli**：命令级。仅覆盖 4 个公共命令 `init`、`scan`、`doctor`、`serve`；`scanner/`、`config/` 等内部子例程不单列模块，仅在所属命令的 §2/§3 中作为支撑细节出现。
- **server**：endpoint + service + MCP tool 级。覆盖 12 个 REST endpoints、14 个 services、2 个 MCP tools（`fab_plan_context`、`fab_get_rule_sections`）。SSE `/events` 与 Dashboard static 作为 endpoint 各占一格。
- **shared**：export 子路径级。`packages/shared/package.json` 中每个 `./xxx` 导出（schemas、detector、i18n、types 等）是一个种子单位；不向下展开到具体 schema 或 type。

## §2 种子使用约定

1. **双受众**。integration-test-cycle 把种子作为单点意图入口；维护者把种子作为可读 review 文档。两类受众共用一份正文，不分叉。
2. **路径引用**。cycle 启动 prompt 形如 `/workflow:integration-test-cycle "依据 docs/test-seed/<pkg>.md 的 §2 invariants 与 §3 known-tricky cases 生成测试..."`，cycle 的 cli-explore-agent 自动读取该文件并据此生成测试。
3. **代码是真理**。种子表达**意图**；当种子与实现冲突时，以 `packages/<pkg>/src/`、既有测试与 zod schema 为 source of truth。种子被视为可被代码反驳的注解。
4. **冲突处理**。cycle 反思日志若检测到 invariant 与实际行为冲突，必须输出 `⚠️ Invariant Conflict` 标记并停下，由维护者裁定（修代码、修种子或删 invariant），**不自动 fix**。
5. **CI 强度**。日常 PR 不强制 invariant 全覆盖；release 流水线 gate 强制对账，每个 minor 版本一次。
6. **测试落地**。cycle 生成的新测试统一进入 `packages/<pkg>/__tests__/integration/`（shared 用 `test/integration/`），与维护者手写测试可视区分。
7. **跑法**。按包独立跑 cycle（cli、server、shared 各一个 session），不混跑；session 之间不共享上下文。
8. **双门退出**。cycle 完成判定 = coverage 阈值（cli 70% / server 75% / shared 85%）+ §2 invariants 全部 represented，两门都过才算这一轮收敛。

## §3 索引

- [cli.md](./cli.md) — 命令级种子。
- [server.md](./server.md) — endpoint + service + MCP tool 级种子。
- [shared.md](./shared.md) — export 子路径级种子。

以上文件由 AI 起草后维护者 review；review 之前 cycle 不应消费这些种子。

## §4 反模式

写种子时禁止：

- ❌ 写成 Gherkin Given/When/Then。仪式重，与 fabric 受众错位；本仓 fabric 文档不使用 BDD 形式。
- ❌ 枚举每个测试用例。种子是意图汇编，不是测试清单；测试清单由 cycle 生成。
- ❌ 描述实现细节。实现变化时种子不应跟着变；写到"行为契约"为止，不下钻到函数签名或文件路径。
- ❌ 单文件超过 200 行。硬上限；超长说明粒度错位，应回看 §1 模块单位是否切得过细。
- ❌ AI 起草后未经维护者 review 直接喂给 cycle。

## §5 维护节奏

| 触发 | 含义 | 频次预期 |
| --- | --- | --- |
| §1 Feature Surface 改动 | 命令、endpoint、service、MCP tool、export 新增或删除 | 每个 minor 版本一次 |
| §2 Invariants 改动 | 行为契约变更，例如默认值变化、错误码语义调整 | 每个 minor 版本一次 |
| §3 Known-Tricky 追加 | 出过的坑被修复后追加一条 | 月均 1–2 次 |

反指标：6 个月后若 §1 + §2 修改频次超过月均 1 次，说明种子写得太细，需重新评估 §1 粒度。
