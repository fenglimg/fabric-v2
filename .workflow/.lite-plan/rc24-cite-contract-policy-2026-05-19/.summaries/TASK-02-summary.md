# TASK-02: Update BOOTSTRAP_CANONICAL with contract syntax + skip operators + personal layer mention

## Changes
- `packages/shared/src/templates/bootstrap-canonical.ts`:
  - Bumped length-guarantee jsdoc comment from `≥ 400 bytes` to `≥ 800 bytes (rc.24: grew from ≥400 with cite-contract syntax)`.
  - `## 知识库(KB)` Discovery 行扩展: 现包含 personal layer `KP-*` 条目提及("含 personal layer `KP-*` 条目,引用方式相同")。
  - `## Cite policy` 章节插入 3 新 bullet(在 `[recalled]` 验证 与 用户口头规则反查 之间):
    1. **contract 语法**: decisions/pitfalls 类必须加 `→ <operator> [<operator> ...]`,operator ∈ {`edit:<glob>` `!edit:<glob>` `require:<symbol>` `forbid:<symbol>` `skip:<reason>`}。带具体 example `KB: K-001 (auth) [planned] → edit:src/auth/**/*.ts !edit:src/legacy/**` 以满足 convergence criterion `'→ edit:'`。
    2. **skip reason 词典**: `sequencing | conditional | semantic | aesthetic | architectural | other:<text>` (6 值)。
    3. **type 路由**: models 类引用为 reference cite,不需要 contract;guidelines/processes 类暂不强制,推后 LLM-judge。
- `packages/shared/test/templates/bootstrap-canonical.test.ts`:
  - 现行 byte-length 断言 400 → 800,改 `it()` label 同步。
  - 新增 `describe("cite contract syntax (rc.24)")` 块,5 个新 `it()`:
    1. `contains-operator-syntax — shows the '→ edit:' operator anchor`
    2. `contains-operator-syntax — enumerates all 5 operators` (覆盖 5 operator literal)
    3. `contains-skip-reason-dict — enumerates all 6 skip reasons` (整行词典 contain 断言)
    4. `contains-type-routing-bullet — documents models reference-cite policy`
    5. `contains-KP-personal-mention — Discovery bullet calls out personal layer`

## Verification
- [x] BOOTSTRAP_CANONICAL contains exact string `'→ edit:'`: 例子段含 `→ edit:src/auth/**/*.ts`,grep 通过
- [x] BOOTSTRAP_CANONICAL contains all 5 operators (`edit:`, `!edit:`, `require:`, `forbid:`, `skip:`): 全部出现于 contract 语法 bullet
- [x] BOOTSTRAP_CANONICAL contains all 6 skip reasons (`sequencing`, `conditional`, `semantic`, `aesthetic`, `architectural`, `other`): 词典 bullet 全列
- [x] BOOTSTRAP_CANONICAL contains string `'KP-*'`: Discovery bullet 提及
- [x] BOOTSTRAP_CANONICAL contains string `'models 类引用为 reference cite'`: type 路由 bullet
- [x] BOOTSTRAP_CANONICAL byte length ≥ 800: 实际 2973 bytes(从 ~1.4KB 增至 ~2.9KB,符合 plan rationale `~1KB → ~2KB`,略超预估)
- [x] bootstrap-canonical.test.ts adds ≥5 new assertions: 5 个新 `it()` (contains-operator-syntax x2 / contains-skip-reason-dict / contains-type-routing-bullet / contains-KP-personal-mention)
- [x] pnpm --filter @fenglimg/fabric-shared test exits 0: 全部 25 文件 / 359 tests 通过

## Tests
- [x] `pnpm --filter @fenglimg/fabric-shared test bootstrap-canonical`: 30 tests passed(25 原有 + 5 新增)
- [x] `pnpm --filter @fenglimg/fabric-shared test`(全套): 25 files / 359 tests passed,零 regression

## Deviations
- **微调 contract 语法 bullet**: task brief 列的 verbatim 文本里 `→ <operator>` 是占位符,不直接含字面 `→ edit:`。但 convergence criterion 严格要求字面字符串 `'→ edit:'`。为同时满足两者,bullet 末尾追加具体 example `KB: K-001 (auth) [planned] → edit:src/auth/**/*.ts !edit:src/legacy/**`,既保留 operator 语义说明又提供 cite 行实例。Plan.json data_flow stage 1 描述 AI 输出形如 `→ edit:foo.ts !edit:bar.ts`,故例子风格与 plan 一致。
- **byte length 增长**: rationale 估算 `~1KB → ~2KB`,实测 2973 bytes(增 ~110%)。仍在 acceptable pre-launch 阈值内,无需调整。

## Notes
- BOOTSTRAP_CANONICAL 是 byte-locked 单一真相源,本次编辑即 rc.24 的 deliberate version bump 一部分,所有 3 端 managed block(Claude Code AGENTS.md / Codex AGENTS.md / Cursor CLAUDE.md)将在用户跑 `fab uninstall && fab install` 后通过 existing writer 自动同步(migration 已在 plan.rc24_migration 文档)。
- Wave 2(hook parser, TASK-03/04/05)将引用本文件定义的 operator 词典作为 cite-line parser 的 grammar 起点。
- Wave 3 doctor(TASK-06+)将比对 hook 抽取出的 cite_commitments 与 session edit_intent_checked diff,完整闭环。
