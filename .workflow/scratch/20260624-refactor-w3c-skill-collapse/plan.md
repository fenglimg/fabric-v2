# W3-C 重构方案 — skill 8→2 real + 2 shim + 0 router

> 权威 spec: gap-census §2 row W3-C + grill GRL-001 (D3/D4/D5,无 open Q)
> 分支: `feat/w3c-skill-collapse`(从含 W3-E 的 main 切出)

## 终态(grill 锁定)
| skill | 去向 |
|---|---|
| archive | real leaf,+ source mode(吸收 import 冷启动回灌) |
| review | real leaf,+ retire mode(吸收 audit deprecate,引擎仍 doctor)+ relate mode(吸收 connect,复用 fab_review modify) |
| store / sync | 厚→薄 shim(仅意图→CLI 路由,剥 i18n/precondition/触发词重资产) |
| fabric(router)/connect/import/audit | 删(0 router) |

- 破坏性 store(migrate scope/promote/backfill)confirm-before-mutate 门进 CLI(镜像 doctor --fix consent + KT-PIT-0016)
- 触发词 ~45→~10;零新写路径;一次落终态(router 直接删,git revert 兜)

## 现状体量(实测)
- skills/: archive(187+16ref)/review(199+8ref)/import(151+7ref)/audit(63,无ref)/connect(单文件)/store/sync/fabric(100 router)/lib/shared-policy.md
- install/skills-and-hooks.ts **1759 行**(每 skill 硬编码模板路径 + router 注册)— R1 高风险
- 活契约:scope-explain 被 sync/import/review/archive 调;import 折入 archive 后该调用随迁

## TDD 任务分解(每步 tsc + 相关 vitest)
- T1: archive + source mode(吸收 import SKILL+ref 的 mining/dedup/checkpoint)
- T2: review + retire mode(audit deprecate-over-delete via doctor)+ relate mode(connect related,复用 modify)
- T3: store/sync 削薄 shim
- T4: 删 fabric router + connect + import + audit 目录(content 折完 + migrate 完才删)
- T5: 重写 install skills-and-hooks.ts(去 router + 删 skill 的 copy/register;uninstall 清旧;lib 收口)
- T6: store 破坏性操作 CLI confirm 门
- T7: migrate-before-delete:bootstrap AGENTS.md skill 清单 7→4;scope-explain caller import→archive;删 skill 名残留引用;RETIRED registry
- T8: 验证 tsc+vitest(install/skill-parity)+ fabric install round-trip + audit retired + smoke

## 风险
- R1(高)install 硬编码每 skill 路径,重写易漏 → skill-parity/install 测试守 + round-trip 兜
- R2(中)retire mode 跨引擎(audit=doctor / review=fab_review)→ T2 先读两 body 确认不引新写面
- R3(中)删 router 后 /fabric 入口没了 → 确认 4 leaf 自身 trigger 覆盖
- R4(低)跨 skill lib(shared-policy.md)被删 skill 引用
