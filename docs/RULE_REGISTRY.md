# RULE_REGISTRY: Stable ID 与规则注册状态

本文记录当前仓库可确认的规则身份事实。它不是 `.fabric/agents.meta.json` 的替代品；真实运行时索引必须由 `fabric doctor --fix` 从 `.fabric/rules/` 生成和维护。

## 当前项目 Registry 状态

当前项目根目录只有：

```text
.fabric/events.jsonl
```

缺失：

```text
.fabric/agents.meta.json
.fabric/bootstrap/README.md
.fabric/INITIAL_TAXONOMY.md
.fabric/rules/
.fabric/rule-test.index.json
```

直接证据：

- `fab_plan_context` 对本次目标路径返回 `Fabric agents metadata file is missing: /mnt/c/Project/fabric-v2/.fabric/agents.meta.json`。
- Event Ledger 的 canonical path 是 `.fabric/events.jsonl`。

结论：

- 本仓库当前不能把根 `.fabric/` 当作完整 Fabric runtime registry。
- 下方表格记录的是源码、模板和 example 中的规则身份来源，不等价于当前项目已激活规则。
- 若要让本仓库自身成为 Fabric-managed project，应先运行 `fabric init` 或恢复 `.fabric/rules/`，再用 `fabric doctor --fix` 固化派生索引。

## Stable ID 契约

| 规则 | 状态 |
| --- | --- |
| 核心规则文件首选 `<!-- fab:rule-id scope/name -->`。 | 已实现解析。 |
| `fabric doctor --fix` 将声明 ID 编译为 `stable_id`。 | 目标实现。 |
| 未声明 ID 时使用派生 ID，`identity_source = "derived"`。 | 已实现。 |
| `fab_plan_context` 对派生 ID 给出 warning。 | 已实现。 |
| 修改规则节点时同步更新本文件。 | 本次建立。 |

证据：

- Declared ID regex：规则索引 builder 负责解析 `fab:rule-id`。
- Shared stable-id derivation：`packages/shared/src/schemas/agents-meta.ts:67`。
- Identity source derivation：`packages/shared/src/schemas/agents-meta.ts:77`。
- Derived identity diagnostic：`packages/server/src/services/plan-context.ts:172`。

## RuleTestIndex V1 Sidecar

`.fabric/rule-test.index.json` 是 `fabric doctor --fix` 生成的 V1 静态契约测试 sidecar，不是 registry 真源，也不替代 `.fabric/agents.meta.json`。

V1 sidecar 只记录：

- 测试文件中的 `// @fabric-verify <stable_id>` 声明。
- 对应 rule/test 的当前 hash。
- 上一次索引中的 `previous_rule_hash` 和 `previous_test_hash`，用于 `fabric doctor` 判断 hash drift。
- 声明位置等静态定位信息。

`fabric doctor` 可基于该 sidecar 报告 covered、stale_rule、stale_test、orphan、missing。`orphan` 表示测试声明引用了当前 registry 中不存在的 Stable ID；`missing` 表示需要声明覆盖的规则没有当前索引项。

V1 明确不记录或承诺：

- Jest runner 或测试执行。
- pass/fail evidence。
- `.fabric/rule-test.results.jsonl`。
- `doctor --fix` acknowledgement。
- AI audit、config hash、测试质量分析或 semantic coverage proof。

最小 L2 script test 声明示例：

```ts
// @fabric-verify assets/scripts/seer
describe("seer script contract", () => {
  it("keeps the rule-visible behavior stable", () => {
    // normal project assertions
  });
});
```

## 模板中声明的 Rule IDs

| Stable ID | 文件 | 范围 | 备注 |
| --- | --- | --- | --- |
| `bootstrap/claude` | `templates/bootstrap/CLAUDE.md` | Bootstrap template | 已声明 `fab:rule-id`。 |
| `bootstrap/codex` | `templates/bootstrap/codex-AGENTS-header.md` | Bootstrap template | 已声明 `fab:rule-id`。 |
| `bootstrap/cursor` | `templates/bootstrap/cursor-fabric-bootstrap.mdc` | Bootstrap template | 已声明 `fab:rule-id`。 |
| `bootstrap/gemini` | `templates/bootstrap/GEMINI.md` | Bootstrap template | 已声明 `fab:rule-id`。 |
| `bootstrap/roo` | `templates/bootstrap/roo-fabric.md` | Bootstrap template | 已声明 `fab:rule-id`。 |
| `bootstrap/windsurf` | `templates/bootstrap/windsurf-fabric.md` | Bootstrap template | 已声明 `fab:rule-id`。 |

重复的 package templates：

- `packages/cli/templates/bootstrap/*` 镜像根目录 `templates/bootstrap/*`，用于 packaged CLI assets。
- 部分 package templates 首行仍缺少 `fab:rule-id`，在把 package templates 当作 canonical rule source 前应先统一。

## Example Rule Files

`examples/werewolf-minigame-stub/.fabric/rules/` 下的 example project rule files：

| Derived Stable ID | 文件 | Layer Derivation |
| --- | --- | --- |
| `root` | `examples/werewolf-minigame-stub/.fabric/rules/root.md` | 由 depth source 派生。 |
| `_cross/role-balance` | `examples/werewolf-minigame-stub/.fabric/rules/_cross/role-balance.md` | Cross-cutting L1。 |
| `assets/scripts/hunter` | `examples/werewolf-minigame-stub/.fabric/rules/assets/scripts/hunter.md` | 按 depth 派生 Mirror L1/L2。 |
| `assets/scripts/seer` | `examples/werewolf-minigame-stub/.fabric/rules/assets/scripts/seer.md` | 按 depth 派生 Mirror L1/L2。 |
| `assets/scripts/villager` | `examples/werewolf-minigame-stub/.fabric/rules/assets/scripts/villager.md` | 按 depth 派生 Mirror L1/L2。 |
| `assets/scripts/werewolf` | `examples/werewolf-minigame-stub/.fabric/rules/assets/scripts/werewolf.md` | 按 depth 派生 Mirror L1/L2。 |
| `assets/scripts/witch` | `examples/werewolf-minigame-stub/.fabric/rules/assets/scripts/witch.md` | 按 depth 派生 Mirror L1/L2。 |

这些是 examples，不是当前根项目的 active rules。

## 核心模块 Stable IDs

这些 IDs 用来绑定开发者文档和核心实现节点。除非未来有 rule file 显式声明，否则它们不是 `.fabric/agents.meta.json` rule nodes。

| Stable ID | 模块 | Source |
| --- | --- | --- |
| `core/cli-entry` | CLI command root 和 lazy command registry | `packages/cli/src/index.ts`, `packages/cli/src/commands/index.ts` |
| `core/init-engine` | Init wizard、scaffold、stage execution | `packages/cli/src/commands/init.ts` |
| `core/rule-index-builder` | Rule metadata compiler、stable-id extraction 和 rule-test sidecar builder | target server service |
| `core/forensic-scan` | Forensic project scan 和 evidence model | `packages/cli/src/scanner/forensic.ts` |
| `core/server-mcp` | MCP server creation 和 tool registration | `packages/server/src/index.ts` |
| `core/http-app` | REST/SSE/MCP HTTP app 和 session lifecycle | `packages/server/src/http.ts` |
| `core/get-rules` | Single-path rule resolution service | `packages/server/src/services/get-rules.ts` |
| `core/plan-context` | Batch planning 和 shared rule bundle | `packages/server/src/services/plan-context.ts` |
| `core/events` | SSE event projection 和 replay | `packages/server/src/api/events.ts` |
| `core/dashboard-api-client` | Dashboard REST/SSE client | `packages/dashboard/src/api/client.ts` |
| `core/rule-topology-view` | Dashboard rule hit explanation | `packages/dashboard/src/views/rule-topology.tsx` |
| `core/agents-meta-schema` | Rule metadata schema 和 identity derivation | `packages/shared/src/schemas/agents-meta.ts` |
| `core/events-schema` | Fabric event schema | `packages/shared/src/schemas/events.ts` |

## 必须同步的更新流程

新增或修改 core function 时：

1. 在本文新增或更新 module Stable ID。
2. 如果 execution flow、schema、rule priority、MCP transport、Stable ID、cache 或 audit behavior 发生变化，更新 [SPEC_INTERNAL](./SPEC_INTERNAL.md)。
3. 如果 `packages/` 文件新增、删除、重命名或职责变化，更新 [CODEBASE_LANDSCAPE](./CODEBASE_LANDSCAPE.md)。
4. 如果变更创建或修改 `.fabric/rules/` rules，使用 `fabric doctor --fix` 接受 baseline；不要直接编辑 `.fabric/agents.meta.json`。
