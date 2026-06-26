# W3-F 重构方案 — 命令表收敛 9 人面 + 2 RPC

> 权威 spec: `.workflow/.maestro/20260623-fabric-ux-census/gap-census.md` §2 row W3-F + `proposals/north-star/NS-01-cli-commands.md` §2
> 分支: `feat/w3f-command-table-converge`(从含 C/D/E 的 main 切出)
> GATE 2 已确认(2026-06-24): OQ-1 → **RPC 保持 hidden 不改名(零迁移)** + **scope-explain 删命令合入 info scope** → 终态 **9 人面 + 2 hidden RPC**

## Discovery 关键修正(grounded,推翻 census 文案)

1. **"迁 4 skill" 实为 2 skill / 3 站点**:grep `templates/skills/` 全量,仅 `fabric-review/SKILL.md:45`、`fabric-archive/SKILL.md:51,65` 引 `fabric scope-explain`。`fabric-sync`/`fabric-import` 零命中(NS-01/census 文案 stale)。
2. **凑 9 人面需删顶层 `metrics`**:当前 10 露人(install/store/sync/info/doctor/uninstall/config/audit/metrics/context),NS-01 §2 树无顶层 metrics(MERGE→`audit metrics`,W3-D 留了 thin alias)。grep 零 skill/hook caller → 删 thin alias 降到 9。
3. **`commands/scope-explain.ts`(命令)删 ≠ `store/scope-explain.ts`(lib)**:lib 的 `scopeExplain()`/`buildResolveInput()` 被 info.ts + bindings-io.ts 用,**保留**。`scope-explain.test.ts` 测的是 lib,不动。
4. **info scope JSON 同源**:info.ts + scope-explain.ts 都 import 同一 `scopeExplain()`,`info scope <coord>` 无条件 `JSON.stringify` → 与旧 `scope-explain` 逐字节一致,迁移零风险。

## 现状 → 终态命令面(NS-01 §2 价值轴分组)

| 组 | 人面命令(终态 9) | 变化 |
|---|---|---|
| Knowledge | `store` `sync` | 不动(C/D/E 已收) |
| Project | `install` `uninstall` `config` `info`(`scope` 真子命令) `inspect`(←`context`) | info scope 真子命令 + context→inspect |
| Maintain | `doctor` `audit` | 删顶层 `metrics`(只留 `audit metrics`) |
| __hidden RPC(2) | `plan-context-hint` `onboard-coverage` | **不改名**,沿用 `internal:true` allowlist |

## TDD 任务分解(每步 tsc + vitest)

- **T1 — grouped-help 派生 + 价值轴分组**:`GROUP_ORDER` `Setup/Daily/Diagnostic/Advanced`→`Knowledge/Project/Maintain`;`COMMAND_META` 重归组(store/sync→Knowledge;install/uninstall/config/info/inspect→Project;doctor/audit→Maintain);删 `metrics`/`scope-explain` 条目;`context`→`inspect`。先改 `grouped-help.test.ts`(INTERNAL 去 scope-explain;floating 断言 context→inspect、去 metrics)。
- **T2 — context→inspect**:`commands/context.ts` meta.name + `contextCommand`→`inspectCommand`;文件改名 `context.ts`→`inspect.ts`(git mv);`index.ts` registry key `context`→`inspect`;i18n key `cli.help.group.daily.context`→`...project.inspect`(en+zh);`context-command.test.ts` 改名/改断言。
- **T3 — info scope 升真子命令**:info.ts 加 `subCommands: { scope: scopeCommand }`,parent `run` 只留 status/whoami;`scopeCommand` 取 required positional `coord`;删旧 `resolveMode` 位置参伪子命令逻辑。先改 `info-command.test.ts` 断言新 shape。
- **T4 — 删 metrics 顶层 + 删 scope-explain 命令**:`index.ts` 删 2 registry 行;`git rm commands/metrics.ts` `commands/scope-explain.ts`;查 metrics.ts 是否被 audit.ts 复用(audit metrics 子命令)— 若复用则只删顶层注册不删文件。
- **T5 — 迁 skill scope-explain → info scope**:review:45 / archive:51,65 改 `fabric info scope <coord>`;RETIRED_TOKENS 登记 `metrics→audit metrics`、`context→inspect`、`scope-explain→info scope`。
- **T6 — dogfood 同步 + 全验**:`fabric install --yes` 重生 dogfood 副本;全量 `pnpm -r exec tsc --noEmit` + vitest + shared build;本地跑 `reusable-validate.yml` 非-vitest gate(lint / lint-protected-tokens / test:strategy / test:store-only-e2e);`fabric audit retired` round-trip 验零残留;`LEFTHOOK=0 git commit` → 单 PR。

## 风险

- R1(中): info 真子命令 + parent run 共存 — citty 语义:首位 positional 匹配 subCommand key 则路由子命令(parent run 跳过),否则 parent run。`fabric info` / `info --global` 走 parent,`info scope X` 走子命令。需验 `info notascope` 不炸(落 parent status)。
- R2(低): metrics.ts 若被 audit.ts import 复用,删文件会断 `audit metrics`。先 grep 确认再删。
- R3(低): RETIRED round-trip — dogfood 副本(`.claude`/`.codex` 下 skill 镜像)也含 scope-explain 引用,install 重生后须 `audit retired` 兜漏网。
- R4(低): i18n locale-parity — context→inspect key 改名须 en+zh 同步,否则 parity 测试红。
