# W3-F Refactor — reflection log

> 命令表收敛 9 人面 + 2 RPC。分支 `feat/w3f-command-table-converge`。

## GATE 2 决策(用户确认 2026-06-24)
- **OQ-1 → RPC 保持 hidden 不改名**(零迁移):沿用 `internal:true` allowlist;grouped-help 派生机制已结构性根治「命令浮空」,`__` 前缀唯一增量价值(调用点自文档)边际,而改 SessionStart spawn 名有非零回归风险。价值÷成本 → 不改。
- **scope-explain 删命令合入 info scope** → 终态 **9 人面 + 2 hidden RPC**(NS-01 §2 树的真实终态,非 census 字面「3 RPC」)。

## Discovery 修正(grounded,推翻文档)
- **「迁 4 skill」实为 2 skill / 3 站点**:grep `templates/skills/` 全量仅 `fabric-review:45`、`fabric-archive:51,65`;`fabric-sync`/`fabric-import` 零命中(NS-01/census 文案 stale)。
- **凑 9 人面需删顶层 `metrics`**:当前 10 露人 → NS-01 §2 树无顶层 metrics(MERGE→`audit metrics`)。`metrics.ts` 文件保留(audit.ts:685 仍 `metrics: metricsCommand` 当 `audit metrics` 子命令);仅删 index.ts 注册行。
- **`commands/scope-explain.ts`(命令)删 ≠ `store/scope-explain.ts`(lib)**:lib 的 `scopeExplain()` 被 info.ts + bindings-io.ts 用,保留;`scope-explain.test.ts` 测的是 lib,不动。

## T1 — grouped-help 价值轴分组
- `GROUP_ORDER` `Setup/Daily/Diagnostic/Advanced`→`Knowledge/Project/Maintain`;`COMMAND_META` 重归组 + 删 metrics/scope-explain 条目 + 加 `inspect`/`audit`(audit 原来漏在 DEFAULT 组)。
- i18n 8 help-group key 重命名到新价值轴前缀(en+zh 同步),删 `diagnostic.metrics`,加 `maintain.audit`。8 key 仅 grouped-help.ts 引用,无外部 referencer。

## T2 — context→inspect
- `git mv` context.ts→inspect.ts + 测试同名迁移;`contextCommand`→`inspectCommand`、`runContext`→`runInspect`、`RunContextOptions`→`RunInspectOptions`、meta.name、error 串、cjs 4 处 nudge(1181/1182 live 串 + 1079/1247 注释)。

## T3 — info scope 升真子命令
- info.ts 加 `subCommands: { scope: scopeCommand }`,parent run 只留 status/whoami;`scopeCommand` 取 required positional `coord`;删旧 `resolveMode`/`InfoMode` 位置参伪子命令逻辑。
- **判断**:citty 0.2.2 支持 parent-run + subCommands 共存(config.ts:273/277 实证);首位 positional 匹配 subCommand key→路由子命令,否则 parent run。`info scope --help` 现真子命令可用。

## T4/T5 — 删 + 迁 + RETIRED
- index.ts 删 `metrics`/`scope-explain`/`context` 注册;`git rm commands/scope-explain.ts`。
- 2 skill(3 站点)`fabric scope-explain`→`fabric info scope`;cjs nudge `fabric context`→`fabric inspect`;docs/RUNTIME-CONTRACTS.md CLI 契约表刷新到 9 人面终态(顺手补了原本漏列的 audit、清了 whoami/status/scope-explain 残条)。
- RETIRED_TOKENS 加 3 token(`fabric scope-explain`/`fabric context`/`fabric metrics`,command-qualified 防 generic substring 误报)。

## 测试迁移(producer-consumer 暴露的空壳)
- `i18n-project-commands.test.ts:93` import 已删的 `scope-explain.ts` → 改走 `infoCmd.subCommands.scope`(coord:team)。
- `skills-store-aware.test.ts:24/54` 硬断言 `scope-explain` → `info scope`。
- `knowledge-hint-broad.test.ts:637/1748` `/fabric context/` → `/fabric inspect/`。
- `grouped-help.test.ts` INTERNAL 去 scope-explain;新增价值轴分组 + inspect/无-metrics 断言。

## 验证门(全绿)
- tsc -r noEmit ✓;CLI 1142✓(install-url-bind 单测 timeout=已知并行高负载 flaky,隔离跑 320ms 绿)、server 775✓、shared 625✓。
- 4 CI gate:knip --strict ✓ / protected-tokens ✓ / test:strategy PASS / test:store-only-e2e verdict=pass。
- 真源 sync:`fabric install --yes` 重生 dogfood → `fabric audit retired` = `[ok] no retired references, scanned 116 surfaces`。
- 命令面实证:help 渲染 9 命令 3 价值轴;`info scope team` 出 JSON;`info --help` 列 scope 真子命令;`audit metrics` 可达;retired 命令 graceful 落 root help。

## 风险(全 mitigated)
- R1 citty parent+sub 共存 → config.ts 实证 + help/JSON 双验。
- R2 metrics.ts 复用 → 确认只删注册行,文件留。
- R3 RETIRED round-trip → audit retired 116 surface 零残留。
- R4 i18n parity → en+zh 同步 + shared suite 625 绿。
