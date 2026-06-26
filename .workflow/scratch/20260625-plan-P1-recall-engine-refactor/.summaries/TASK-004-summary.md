# TASK-004: CJK 语义默认开 + fastembed optionalDependencies + cosine 下界 [0,1]

## Changes
- `packages/server/package.json`: 新增 `optionalDependencies.fastembed: "^2.0.0"`（默认安装尝试构建,无法构建的平台仍能启动）。版本对齐代码注释中 `fastembed@2.x` 假设(latest 2.1.0,`FlagEmbedding.init` API 匹配)。
- `packages/server/src/config-loader.ts`: `readEmbedConfig` 的 `enabled` 从 `config.embed_enabled === true`（默认关）改为 `config.embed_enabled !== false`（默认开,仅显式 false 才关）。同步更新 docblock。catch-fallback 仍返回 `enabled:false`（corrupt config → 安全文本降级,不静默启用特性)。
- `packages/server/src/services/vector-retrieval.ts`:
  - cosine clamp 从 `Math.max(-1, Math.min(1, sim))` 收紧为 `Math.max(0, Math.min(1, sim))`,契约 [0,1]。
  - 更正 L120/L124(原 `[-1, 1]` 注释)+ L8 header(原 `--no-embed` 默认 / fastembed 非声明依赖)的过期描述。
  - 新增一次性缺包提示:`hintMissingEmbedderOnce()` + 模块级 latch `missingEmbedderHinted`,在 `loadEmbedder` 的两条 null 返回路径(catch / `init===undefined` guard)调用。注入式 sink `__setMissingEmbedderHintForTesting` 供测试断言"恰好一次"。stderr 输出(stdout 是 MCP stdio 通道)。
- `packages/server/src/services/vector-retrieval.test.ts`: 更新 stale clamp 用例 `[-1,1]→[0,1]`(原断言 >= -1 改为 >= 0 并重命名);新增"opposite-direction raw cosine -1 → clamp 0"、"mixed-sign 全 >= 0"、"缺 fastembed 不抛/降级/一次性提示"用例。
- `packages/server/src/config-loader.test.ts`: 更新默认用例为 `enabled: true`;新增"显式 false 才关"用例。
- `packages/server/src/services/plan-context.test.ts`: "falls back to text-only when disabled" 用例改为显式写 `embed_enabled: false`(默认改 true 后,OFF 路径需显式 opt-out)。

## Verification（每条 convergence.criteria）
- [x] fastembed 位于 optionalDependencies 块：`grep -n optionalDependencies` 命中 L48,`fastembed` L49。
- [x] embed_enabled 默认 true：`config.embed_enabled !== false`（config-loader.ts:122,不再 `=== true`）。
- [x] cosine 下界 0：`Math.max(0, Math.min(1, sim))`（vector-retrieval.ts:202);全文件无残留 `Math.max(-1` / `[-1,1]`。
- [x] 新增 cosine >= 0 用例：opposite-pair raw -1 → 0、mixed-sign 全 >= 0。
- [x] 更新既有 clamp 用例：重命名为 "clamps the result into [0, 1] (lower bound 0)",断言 >= 0。
- [x] 缺 fastembed 降级 + 一次性提示用例：注入计数 sink,两次 probe 仅 hintCount===1,resolves toBeNull 不抛。
- [x] `pnpm --filter @fenglimg/fabric-server test`: 69 文件 / 806 用例全绿(vector-retrieval.test.ts 23 用例)。
- [x] `pnpm -r exec tsc --noEmit`: EXIT 0,无 error。

## 负 cosine 依赖排查（risk #3,无条件上线前置）
- `grep -rn cosineSimilarity packages/`：唯一运行时调用方 = vector-retrieval.ts:226（喂 ranking scores),无任何代码分支于负 cosine。
- 旧 clamp 用例用 parallel 向量(sim=1),从未真正触达下界,无 fixture 依赖负值。
- 结论:`[-1,1]→[0,1]` 安全,无静默回归。

## Deviations
- 任务只点名改 vector-retrieval.test.ts,但默认 OFF→ON 连带破坏两处既有用例(config-loader.test.ts 默认断言、plan-context.test.ts disabled 路径)。为保持全绿且不弱化测试,显式更新这两个用例反映新默认语义(均在 packages/server scope 内)。这是必要的行为对齐,非范围蔓延。
- fastembed 版本选 `^2.0.0`(非任务未指定的具体号)对齐代码注释 `fastembed@2.x` 假设。

## Notes
- 缺包一次性提示走 stderr。运行测试时可见两行真实提示输出 —— 来自既有 `loadEmbedder` 用例(L145/L153,用真 sink + afterEach 重置 latch),非泄漏;我的一次性用例用注入计数 sink。
- shared schema `embed_enabled: z.boolean().optional().default(false)` 未改 —— hot read path 绕过 schema parse(与 PLAN_CONTEXT_TOP_K_DEFAULT 等同模式),运行时默认由 config-loader 主导。若后续要全栈一致可单独提 task 改 schema default + 重 build shared(本 task 刻意 server-only 避免 rebuild gotcha)。
