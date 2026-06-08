# KNOWLEDGE_REGISTRY: Stable ID 与知识注册状态

本文记录当前仓库可确认的 knowledge identity 事实。它不是 `.fabric/agents.meta.json` 的替代品；真实运行时索引来自 `.fabric/knowledge/`、挂载 store、以及 doctor / server 的派生缓存。

## 当前项目 Registry 状态

当前主线真源是：

```text
.fabric/knowledge/
~/.fabric/knowledge/
```

派生或运行时状态包括：

```text
.fabric/agents.meta.json
.fabric/.cache/
.fabric/events.jsonl
.fabric/metrics.jsonl
```

结论：

- 本仓库自身已经按 Fabric-managed project 形态运行，不能再把 `.fabric/rules/` 当作主线 registry。
- `.fabric/agents.meta.json` 是派生索引，禁止手动编辑；需要修复时运行 `fabric doctor --fix` 或 `fabric doctor --fix-knowledge`。
- 下方表格记录源码、模板和文档中需要稳定追踪的核心实现节点，不等价于 active knowledge entries。

## Stable ID 契约

| 规则 | 状态 |
| --- | --- |
| canonical knowledge entry 使用 frontmatter `id` / `stable_id` 声明身份。 | 当前实现 |
| team entry 使用 `KT-*` 前缀；personal entry 使用 `KP-*` 前缀。 | 当前实现 |
| type vocabulary 为 `models`、`decisions`、`guidelines`、`pitfalls`、`processes`。 | 当前实现 |
| maturity vocabulary 为 `draft`、`verified`、`proven`。 | 当前实现 |
| `fabric doctor --fix` 修复 deterministic 派生状态；`--fix-knowledge` 执行 knowledge maintenance。 | 当前实现 |
| 修改 knowledge identity、store topology、MCP read path 时同步更新本文。 | 当前流程 |

证据：

- Stable ID schema：`packages/shared/src/schemas/store-stable-id.ts`。
- API contracts：`packages/shared/src/schemas/api-contracts.ts`。
- Store-aware recall：`packages/server/src/services/recall.ts` 与 `packages/server/src/services/cross-store-recall.ts`。
- Review writes：`packages/server/src/services/review.ts`。

## Static Test Traceability

静态 test traceability 使用 `// @fabric-verify <stable_id>` 声明测试与 stable ID 的关系。它只记录声明覆盖和 hash drift 信号，不运行测试，也不证明语义覆盖。

```ts
// @fabric-verify KT-DEC-0001
describe("knowledge-visible behavior", () => {
  it("keeps the documented contract stable", () => {
    // normal project assertions
  });
});
```

`fabric doctor` 可基于派生 sidecar 报告 covered、stale、orphan、missing 等静态状态。语义覆盖仍需人工或 review skill 判断。

## 模板中声明的 Knowledge Anchors

| Anchor | 文件 | 范围 | 备注 |
| --- | --- | --- | --- |
| `bootstrap` | `packages/shared/src/templates/bootstrap-canonical.ts` | Canonical `.fabric/AGENTS.md` content | `fabric install` 写入到各客户端 managed block。 |

## 核心模块 Stable IDs

这些 IDs 用来绑定开发者文档和核心实现节点。除非未来有 canonical knowledge file 显式声明，否则它们不是 `.fabric/agents.meta.json` 中的 active entries。

| Stable ID | 模块 | Source |
| --- | --- | --- |
| `core/cli-entry` | CLI command root 和 lazy command registry | `packages/cli/src/index.ts`, `packages/cli/src/commands/index.ts` |
| `core/install-engine` | Install / reapply pipeline、hook / skill / MCP config 写入 | `packages/cli/src/commands/install-v2.ts`, `packages/cli/src/install/` |
| `core/store` | Knowledge store create / mount / bind / list / switch | `packages/cli/src/commands/store.ts` |
| `core/sync` | Multi-store git sync | `packages/cli/src/commands/sync.ts` |
| `core/info` | Project / store surface summary | `packages/cli/src/commands/info.ts` |
| `core/server-mcp` | stdio MCP server creation 和 tool registration | `packages/server/src/index.ts` |
| `core/recall` | One-step knowledge recall read path | `packages/server/src/services/recall.ts`, `packages/server/src/tools/recall.ts` |
| `core/plan-context` | Candidate planning 和 selection token minting | `packages/server/src/services/plan-context.ts`, `packages/server/src/tools/plan-context.ts` |
| `core/knowledge-sections` | Two-step body fetch | `packages/server/src/services/knowledge-sections.ts`, `packages/server/src/tools/knowledge-sections.ts` |
| `core/extract-knowledge` | Pending knowledge extraction | `packages/server/src/services/extract-knowledge.ts`, `packages/server/src/tools/extract-knowledge.ts` |
| `core/review` | Pending / canonical knowledge review mutations | `packages/server/src/services/review.ts`, `packages/server/src/tools/review.ts` |
| `core/archive-scan` | Archive candidate scan for skills | `packages/server/src/tools/archive-scan.ts` |
| `core/events-schema` | Fabric event schema | `packages/shared/src/schemas/events.ts` |
| ~~`core/http-app`~~ | quarantine v2.0.0-rc.37 | `packages/server-http-experimental/src/http.ts` |

## 必须同步的更新流程

新增或修改 core function 时：

1. 在本文新增或更新 module Stable ID。
2. 如果 execution flow、schema、MCP transport、Stable ID、store topology、cache 或 audit behavior 发生变化，更新 [SPEC_INTERNAL](./SPEC_INTERNAL.md)。
3. 如果 `packages/` 文件新增、删除、重命名或职责变化，更新 [CODEBASE_LANDSCAPE](./CODEBASE_LANDSCAPE.md)。
4. 如果变更创建或修改 canonical knowledge，使用 `fab_review` / `fabric-review` 或 `fabric doctor --fix-knowledge` 走治理路径；不要直接编辑 `.fabric/agents.meta.json`。
