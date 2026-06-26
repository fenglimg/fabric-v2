# W3-E 重构方案 — store 去同义词 + migrate 组 + 列表对齐

> 权威 spec: `.workflow/.maestro/20260623-fabric-ux-census/gap-census.md` §2 row W3-E + grill GRL-001
> 分支: `feat/w3e-store-dealias`(从含 W3-D 的 main 切出)
> GATE 2 已确认(2026-06-24): route-write 折叠到 `switch-write --scope`(非 migrate route)

## 现状 → 终态命令面(价值轴分组)

| 轴 | 子命令(终态) | 变化 |
|---|---|---|
| 注册表 | `mount` `list` `create` `remove` `explain` | `add`→`mount`;`list` 裸 `\t`→padEnd 表 |
| 项目接线 | `bind` `switch-write [--scope <s>]` | `route-write` 折进 `switch-write --scope` |
| 知识迁移 | `migrate {scope,promote,backfill}` | `re-scope`→`migrate scope`、`promote`→`migrate promote`、`backfill-scope`→`migrate backfill` |
| store 内项目 | `project {list,create}` | 不变 |

设计依据: switch-write/route-write 都写 config「写目标」(default_write_store vs write_routes[]),是兄弟 → 折叠。
re-scope/promote/backfill 都重写磁盘知识条目坐标 → 归 migrate 组(语义纯)。

## migrate-before-delete 调用点(grep 实证,删前必迁)

- **add→mount**: store-resolver.ts:111,128 / golden:71 / doctor-checks.ts:52 / store-ops.ts:211,341,373,484,548 / install-global.ts:17 / store-lifecycle.ts:7 / fabric-store/SKILL.md:27,41
- **route-write→switch-write --scope**: cross-store-write.ts:41 / store-resolver.ts:181 / golden:130 / USER-QUICKSTART.md:20,75
- **re-scope→migrate scope**: i18n en:701/zh:685(合并串) / fabric-audit/SKILL.md:55 / store.ts:312 note
- **backfill-scope→migrate backfill**: doctor-scope-lint.ts:26(注释) / **doctor-scope-lint.test.ts:234(actionHint 断言,随 i18n 改)** / i18n en:701/zh:685 / fabric-audit/SKILL.md:50
- **promote→migrate promote**: 无外部调用点(仅内部定义)
- **RETIRED_TOKENS 登记** 5 token:`store add` `store route-write` `store re-scope` `store backfill-scope` `store promote`

## TDD 任务分解(每步 tsc + vitest)

- T1: store.ts — mount 改名 / migrate 子组 / switch-write --scope 折叠 / list padEnd / 价值轴排序
- T2: i18n — `cli.store.routed` 新 key;迁走串改名;locale-parity 绿
- T3: 迁所有调用点 + RETIRED_TOKENS 登记 5 token
- T4: 测试迁移 store-ops.test.ts;doctor-scope-lint.test.ts:234 断言跟 i18n 改;`fabric audit retired` round-trip 验零残留
- T5: `fabric install --yes` 同步 dogfood;全量 tsc + vitest + build;LEFTHOOK=0 commit → 单 PR

## 风险

- R1(中): switch-write 折叠 route 后,无 --scope 走 storeSwitchWrite(默认写库)、带 --scope 走 storeSetWriteRoute(scope 路由)—— 两条 config 写路径不能串。
- R2(低): doctor-scope-lint actionHint i18n 串改名 → test:234 断言必须同步(producer-consumer)。
- R3(低): RETIRED_TOKENS round-trip — 登记后跑 `fabric audit retired` 兜 dogfood 漏网(W3-D 抓到过 tracked miss)。
