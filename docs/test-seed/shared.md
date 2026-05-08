# Test Seed — shared

> 模块单位: export 子路径级（package.json `exports` 每个 `./xxx` 一格，不向下展开）
> 维护原则: 仅在意图变更时更新（详见 ../README.md §5）
> 最近更新: 2026-05-08 / v1.8.0

## §1 Feature Surface

### Public exports（来自 `packages/shared/package.json`）
- `.` — 聚合 re-export（types + i18n + 全部 schemas）
- `./i18n` — translator 工厂、locale 检测、protected-tokens
- `./types` — agents / config / ledger 类型聚合
- `./node` — Node-only helpers 聚合入口
- `./node/atomic-write` — tmp+rename + 可选 fsync 写入器
- `./node/mcp-payload-guard` — 16KB warn / 64KB hard limit
- `./node/bootstrap-guide` — bootstrap README 模板生成
- `./errors` — `FabricError` + 5 子类
- `./schemas/api-contracts` — MCP tool input/output zod schemas（含 `action_hint` 字段）

### Schemas（11 zod，皆 `.parse()` 可用）
- `agents-meta`, `api-contracts`, `event-ledger`, `events`, `fabric-config`, `forensic-report`, `human-lock`, `init-context`, `ledger-entry`, `rule-test-index`（剩余 1 项归并入 `.` 聚合）

### Errors（5 子类共享 `FabricError` 基类）
- `ConfigError`, `RuleError`, `IOFabricError`, `MCPError`, `InitError`
- 基类强制 `actionHint` 非空；含 `code` / `httpStatus` / `fixable` / 可选 `details`；`toJSON()` 序列化字段

### i18n
- `createTranslator()` 工厂 + `t(key, params)` 接口
- `detectNodeLocale()` 从环境/系统检测
- locale 文件: `en.ts`, `zh-CN.ts`
- `protected-tokens` — 命令名 / flag 名 / 错误 code 不被翻译

### Detector
- `detectFramework()` — 在项目根识别框架；空目录返回 `unknown`

### Node helpers
- `atomic-write` — 生成 `.tmp` → `rename`，可选 fsync；失败清理 `.tmp`
- `mcp-payload-guard` — 16KB warn / 64KB throw `MCPError(MCP_PAYLOAD_TOO_LARGE)`
- `bootstrap-guide` — 文本模板拼装

### Types
- `agents.ts`, `config.ts`, `ledger.ts`（结构类型，无运行时行为）

## §2 Invariants

I1. 11 个 zod schema 满足 parse round-trip：对任意合法输入 `x`，`parse(JSON.parse(JSON.stringify(parse(x))))` deep-equals `parse(x)`。
I2. `atomic-write` 用 tmp+rename 序列：rename 步骤抛错时，磁盘上不残留 `.tmp` 文件且目标文件保持原内容（不被部分写入）。
I3. `atomic-write` 对相同输入幂等：连续两次写入同一 (path, content) 后磁盘内容 byte-identical（mtime 可不同，bytes 必须一致）。
I4. `mcp-payload-guard` 在 payload size >16KB 触发 warning（不抛），>64KB 抛 `MCPError` (code=`MCP_PAYLOAD_TOO_LARGE`)；恰好等于阈值的边界归 warn 一侧（≥16K warn / ≥64K throw 实现一致）。
I5. `FabricError` 5 个子类保持 `instanceof FabricError` 与 `instanceof XxxError` 双向类型链；通过 `Object.setPrototypeOf` 跨包传递不破坏 `instanceof`。
I6. `FabricError.toJSON()` 输出含 `name` / `code` / `message` / `actionHint` / `fixable`，`details` 仅在 defined 时出现；序列化后的对象可被消费方按 code 路由处理。
I7. i18n protected-tokens（命令名、flag 名、错误 code 等）在任意 locale 下不被翻译；`t()` 替换占位符不破坏被保护片段。
I8. `detectFramework` 在目录不存在 / 为空 / 仅含无关文件时返回 `unknown` framework，不抛异常；返回值 shape 稳定。
I9. `FabricError` 构造器在 `actionHint` 缺失或空字符串时抛错（构造层守门，禁止无 hint 的错误对外传播）。

## §3 Known-Tricky Cases

T1. **forensic-report 极大文件** — `forensic-report` schema 对超大 `fileTree` / `recommendations` 数组的解析行为：是否截断、是否保持顺序、refine 错误是否带可定位的字段路径。
    覆盖: `packages/shared/src/schemas/forensic-report.ts` + 配套 round-trip 测试。

T2. **init-context 跨版本 migration** — 1.7 → 1.8 字段变化（client trio 收敛，部分历史 client key 被移除）；schema 对未知 client key 的处理：strict 拒绝 vs. passthrough 保留。
    覆盖: `packages/shared/src/schemas/init-context.ts`；与 doctor `init_context_invalid` 行为对齐。

T3. **mcp-payload-guard 边界** — 恰好 16384 / 16385 / 65535 / 65536 字节的判定（`<` vs `<=` 边界一致性）；UTF-8 多字节字符的 byteLength 计算与 string length 区分。
    覆盖: `packages/shared/src/node/mcp-payload-guard.ts` + 边界单测。

T4. **zod refine 错误消息形态** — 自定义 refine 错误必须带可读 `message` 与可定位 `path`，避免 `Invalid input` 这类无信息错误穿透到用户层。
    覆盖: `packages/shared/src/schemas/*` 中所有用 `.refine` / `.superRefine` 的 schema。

T5. **atomic-write 跨设备 rename** — 当 `tmp` 与目标位于不同 mount 时 `fs.rename` 抛 `EXDEV`；helper 应明确不做 fallback copy（保持原子性承诺），错误冒泡且 `.tmp` 被清理。
    覆盖: `packages/shared/src/node/atomic-write.ts` + 错误路径测试。

## §4 Out of Scope

- cli / server 中如何调用 shared（属于消费方测试范围，见 `cli.md` / `server.md`）
- dashboard 中对 schemas 的浏览器端复用（包级隔离，shared 不打包浏览器代码）

## §5 Source Traceability

- `packages/shared/package.json`（`exports` 字段 = §1 Feature Surface 真理来源）
- `packages/shared/src/index.ts`（`.` 聚合点）
- `packages/shared/src/schemas/*.ts`（11 个 zod schema）
- `packages/shared/src/errors/{fabric-error,config-error,rule-error,io-error,mcp-error,init-error}.ts`
- `packages/shared/src/i18n/{create-translator,detect-node-locale,protected-tokens}.ts`
- `packages/shared/src/node/{atomic-write,mcp-payload-guard,bootstrap-guide}.ts`
- `docs/RULE_REGISTRY.md`、`CHANGELOG.md` 1.8.0 段（FabricError 5 子树、atomic-write、payload guard）
