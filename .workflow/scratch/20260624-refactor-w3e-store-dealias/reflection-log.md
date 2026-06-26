# W3-E Refactor — reflection log

> store 去同义词 + migrate 组 + 列表对齐。分支 `feat/w3e-store-dealias`。

## GATE 2 决策
- route-write 折进 `switch-write --scope`(非 `migrate route`)—— 用户确认。依据:route-write 写 config(write_routes[]),不碰磁盘知识条目,与 switch-write(default_write_store)是「设写目标」兄弟;migrate 组应保持纯知识坐标重写。

## T1 — store.ts 重构
- `add`→`mount`(const + meta + subCommands key);`list` 裸 `\t`→padEnd 三列对齐表(remote 末列 ragged-right);`switch-write` 加 `--scope` 折叠 route-write(无 scope→storeSwitchWrite、有 scope→storeSetWriteRoute);新建 `migrate` 子组 {scope(←re-scope), promote, backfill(←backfill-scope)};top-level subCommands 按价值轴排序(注册表→接线→migrate→project)。
- **判断**:switch-write 的 route 分支也调 regenerateBindingsSnapshot(原 route-write 没调)—— 统一同命令行为,且写 route 确实改解析,regen 更正确。内部 fn(storeAdd/storeSetWriteRoute/rescopeStore)名不动,只改 CLI surface(minimize)。

## T2 — i18n
- 新增 `cli.store.routed`(en/zh);`doctor.check.store_scope_lint.remediation` 串内 `backfill-scope`→`migrate backfill`、`re-scope`→`migrate scope`。locale-parity 绿。

## T3 — 迁调用点 + RETIRED_TOKENS
- add→mount: resolver×2 / golden×1 / doctor-checks / store-ops 注释·串×5 / install-global / store-lifecycle / fabric-store SKILL×2
- route-write→switch-write --scope: cross-store-write / resolver / golden / USER-QUICKSTART×2
- re-scope→migrate scope: i18n / fabric-audit SKILL / store.ts note
- backfill-scope→migrate backfill: doctor-scope-lint 注释 + i18n + fabric-audit SKILL
- RETIRED_TOKENS 登记 5 token(add/route-write/re-scope/backfill-scope/promote)
- **golden producer-consumer**:resolver 错误串改了 → read-set.golden.json 同步(golden-redsuite.test 守)。

## T4 — 测试迁移
- **producer-consumer 链**:`doctor-scope-lint.test.ts:234` 断言来自 i18n remediation 串 → 同步改 `store migrate backfill`。
- store-ops.test describe/comment「add」→「mount」;route-write 用例描述→「switch-write --scope」(内部 fn 不变,纯 label)。
- **surface 测试语义碰撞**:`store-command-surface.test.ts` 原断言 `not.toContain("migrate")` 守的是 store-only cutover 删掉的**旧 dual-root 迁移器**。W3-E 同词复用为知识 scope 迁移组 → 重写为锁 W3-E 价值轴终态 + 断言 migrate 子组恰为 {scope,promote,backfill}(防旧义复活)。

## T5 — 验证
- tsc --noEmit 全 0;shared build;server+cli build。
- shared 50✓(locale-parity/golden/contracts)/ server 779✓ / cli 1145✓(+1 新 surface 用例)。
- `fabric install --yes` 同步 dogfood → `fabric audit retired` round-trip:122 surface 零残留(W3-D 同招抓过 tracked miss)。
- 冒烟:store --help(价值轴序)/ store migrate --help / store switch-write --help(--scope)全正确。

## Key learnings
- **同词跨语义复用要查历史断言**:`migrate` 这个词在 store-only cutover 时被一条 `not.toContain` 测试钉死过(旧 dual-root 迁移器)。新引入同名组前先 grep 旧断言,否则全套测试红;重写时把"否定旧义"升级成"正向锁新义 + 子集断言防复活"。
- **producer-consumer 串改链**:一条 i18n remediation 串同时被 doctor renderer 与一个 test 断言消费;改文案必须 grep 所有 consumer。golden fixture 同理(resolver 串的下游)。
