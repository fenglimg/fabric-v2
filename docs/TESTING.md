# Fabric Testing

测试策略入口。**日常只读本页 Gate Map**；深方法论链到文末附录，不当合入教条。

## Authority

测试策略按 3 层读取：

1. **项目当前事实**：本文件、根 `package.json`、各 package `vitest.config.ts`、`.github/workflows/reusable-validate.yml`、`.github/workflows/ci.yml`。
2. **全面测试方法论**：[test-methodology-v6.md](./methodology/test-methodology-v6.md)。这是 v0→v6 多轮冷评、回测、human frame-challenge 后的 incumbent。
3. **Fabric E2E/dogfood 方法论**：[e2e-methodology-FINAL.md](./methodology/e2e-methodology-FINAL.md)。这是 v2.1 多 store 后的端到端旅程方法论。

方法论调研材料：

- [mainstream-research.md](./methodology/mainstream-research.md)：ISO 25010、HTSM、探索式测试、风险驱动、fitness functions、RAGAS、agent trajectory eval。
- [samespace-research.md](./methodology/samespace-research.md)：mem0/Letta/Zep、Braintrust/LangSmith/Langfuse、MCP Inspector。
- [trackd-research.md](./methodology/trackd-research.md)：OWASP LLM Top 10、LLM/agent 红队、成本和 loop 失控防护。
- [backtest-answer-set.md](./methodology/backtest-answer-set.md)：confirmed/refuted 回测答案集。
- [discovery-rubric.md](./methodology/discovery-rubric.md)：发现力评分规约。

## Commands

根目录：

| 命令 | 用途 |
| --- | --- |
| `pnpm -r build` | 构建（E2E / typecheck 前置） |
| `pnpm -r test` | 包级 vitest |
| `pnpm -r --if-present test:coverage` | 带 coverage 门槛 |
| `pnpm typecheck` | 全仓 `tsc --noEmit` |
| `pnpm lint` | knip |
| `pnpm test:strategy` | 本文件 ↔ scripts ↔ CI 锚点 |
| `pnpm test:store-only-e2e` | 装/绑/写/审/召回黑盒（需先 build） |
| `pnpm test:upgrade-e2e` | install 升级刷新 stale hook/skill（需先 build） |

包级脚本见各 `package.json`。

## Gate Map

### PR hard（每次合入）

与 `.github/workflows/reusable-validate.yml` 对齐：

1. `pnpm -r build`
2. `pnpm -r exec tsc --noEmit`
3. `pnpm lint`
4. `pnpm -r --if-present test:coverage`
5. `pnpm test:strategy`
6. `pnpm test:store-only-e2e`
7. `pnpm test:upgrade-e2e`
8. `node --experimental-strip-types scripts/lint-protected-tokens.ts`
9. `NO_COLOR=1` + scoped CLI reskin/i18n snapshot tests (not full CLI suite)
10. `node scripts/perf-benchmark.mjs`

Windows smoke（`ci.yml`）：shared 合同面 + 已构建 CLI `--help` / `--version`，不替代 Linux 全量。

### Release hard

`.github/workflows/release.yml` **先** `uses: reusable-validate.yml`（`verify_tag: true`），**再** publish。  
**PR 与 Release 同一套确定性门禁**——发版不得更松。

### Optional (not PR hard)

| 命令 / 脚本 | 何时跑 |
| --- | --- |
| `scripts/habit-funnel.mjs` | 看真实 dogfood 习惯漏斗是否「活着」 |
| `scripts/nofake-audit.mjs` | 真实 cite 是否幻觉 id |
| `scripts/measure-injection.mjs` | 真 corpus 注入/recall payload |
| `DOGFOOD_BASELINE=1` + recall dogfood baseline | 调排序质量时 |
| `scripts/red-team-safety.mjs` | 安全对抗（注意脚本路径可复现性） |
| 人工 dogfood 清单 | 里程碑 / 发版前抽检，不当主 CI |

## Package Boundaries

| 包 | 测试位置 | coverage 线（约） |
| --- | --- | --- |
| `@fenglimg/fabric-cli` | `packages/cli/__tests__/` | 70% |
| `@fenglimg/fabric-server` | `src/**/*.test.ts`、`__tests__/` | 75% |
| `@fenglimg/fabric-shared` | `test/`、`src/**/*.test.ts` | 85% |
| `server-http-experimental` | quarantine | **不进**主线 ship gate |

## Do not

| 不做 | 原因 |
| --- | --- |
| 无 validate CI | 发布物进用户环境；确定性回归必须硬拦 |
| 对话式 UAT 当主质量体系 | 人不可规模化；适合抽检，不适合 PR/发版主闸 |
| 整包 maestro-flow auto-test 流水线 | 测业务项目，不是知识层产品 |
| PR 强制真 LLM / 真 `~/.fabric` 全扫 | 贵、抖；放 optional |
| 用 coverage% 顶替 round-trip / store-only | 线覆盖不是 producer→consumer oracle |
| 再写平行总方法论 | v6 + e2e-FINAL 已是附录权威 |

## Drift Gates（轻）

- 本文件 ↔ root scripts ↔ `reusable-validate` / `ci.yml`：`pnpm test:strategy`
- CLI surface snapshot、schema、tool 注册、bootstrap、protected-token：见包测

策略 gate **只保证入口与 CI 不漂**，不评判覆盖质量。

## 变更时最少跑什么

| 变更类型 | 最少命令 |
| --- | --- |
| 纯 shared 契约 | `pnpm --filter @fenglimg/fabric-shared test` |
| server / MCP | `pnpm --filter @fenglimg/fabric-server test` |
| CLI / hook 文案 | `NO_COLOR=1` + scoped reskin/i18n snapshot tests |
| store 旅程 / install | `pnpm -r build && pnpm test:store-only-e2e`（升级路径再加 `test:upgrade-e2e`） |
| 只改本文件或文档命令名 | `pnpm test:strategy` |

写行为 / 修 bug / 加 release 门禁时优先 write-red（先失败断言再实现）。文档-only 可跳过 red，但动到本文件命令名须跑 `test:strategy`。

## Appendix

1. [test-methodology-v6.md](../.workflow/.maestro/20260602-test-methodology-optimize/scratchpad/test-methodology-v6.md) — 四赛道 × 认识论  
2. [e2e-methodology-FINAL.md](../.workflow/.scratchpad/e2e-methodology-FINAL.md) — 旅程 / 交互轴 / T1–T3  
3. 调研材料：同目录 `mainstream-research.md` / `samespace-research.md` / `trackd-research.md` / `backtest-answer-set.md` / `discovery-rubric.md`  
4. 瘦身决策上下文：`.workflow/scratch/20260712-analyze-test-strategy/SLIM-TESTING-SKELETON.md`

Coverage 仍是下限信号；跨写读边界优先 round-trip / store-only 断言。  
