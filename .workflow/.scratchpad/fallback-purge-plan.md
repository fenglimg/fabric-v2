# Fallback / 兜底 大清除 — 执行计划与共识终态

> 分支 `chore/fallback-purge`(从 main 9812287 起);完工后再考虑并回 main。
> 目标:0 用户阶段,探清并清除所有「历史包袱 / 架构变更残留 / 过渡态兜底」(Species A),
> 运行时防御(Species B)保留。上线前的一次性 decruft。

## 锁定的 14 项决策(grill 收敛终态)

| # | 分支 | 结论 |
|---|---|---|
| ① | 范围 | 只清 **Species A**(历史包袱/架构残留/过渡态兜底)。**Species B**(schema 默认值、install try/catch、doctor 自愈、first-reconcile-gate、ledger 4KB 截断)全保留——与用户数无关,第 1 个用户就要 |
| ② | doctor `--fix` | **保留**。逐条核实全是确定性机械修复(模板再生/字节截断/计数 floor),交 AI 反更慢更不可靠、违背 hook⊥AI 铁律。判断型修复本就在 skills 走 AI |
| ③ | co-location | 死代码,**删**。零 caller 已验证:`readAgentsMeta`、`getKnowledge`、整个 `knowledge-meta-builder.ts`、`legacy-serve-lock-probe.ts` |
| ④ | 灰区规则 | **先验死代码**:零 caller→删;还有 caller(重构没做完)→先把新路径接完(收尾 cutover)再删旧 |
| ⑤ | vocab shim | 删真翻译器(cite-tag remap + i18n/hook/bootstrap 触手、self-archive 旧信号名、config maturity 别名);**留 doctor 内部 `stable/endorsed` 决斗**(那是 rename 不是 fallback) |
| ⑥ | 发现完整性 | knip 机械全扫 + 分类 census;knip 清单逐条过「先验死代码」(区分 真退役/测试专用/半成品) |
| ⑦ | 半成品功能 | sync 推送(`defaultPush`/`defaultCommitDirty` 未接线)等**单独列清单给用户拍,本轮不动** |
| ⑧ | 覆盖盲区 | census+knip+grep 漏 5 类:①活函数死分支 ②skip 测试 ③断言旧行为的 fixture ④孤儿 config/废弃枚举 ⑤陈旧 seed |
| ⑨ | 测试方法 | **TDD-red 不变式**:对每个要删的旧逻辑先写红测试断言「删除后的世界」,红=旧逻辑还活着,猎到绿=可证明清干净(补 grep/knip 补不上的死分支盲区) |
| ⑩ | 起点 | **先清基线再写红**:14红+105skip 先收到全绿零skip,否则「故意红」vs「坏红」分不清 |
| ⑪ | 14 红性质 | **语言漂移**,非旧逻辑非真 regression(exitCode 断言过,只是期望英文拿到中文,源自 language-first 重构 seed 没回灌) |
| ⑫ | 删除安全闸加固 | 「零 caller grep」对**动态/字符串派发有洞**(已证 60 个 event_type case + i18n key + 计算键 `[layerKey]` + MCP 工具名)。Wave 0 先建 **census 不变式闸**:event_type emitter↔handler 奇偶、i18n key↔locale 奇偶、layer/type 枚举 census、MCP 工具 smoke |
| ⑬ | Species B swallow 审计 | install 30+ try/catch 经查全是**正当 best-effort**(转 skipped/error 记账行,带注释),无静默吞 bug → 保留 |
| ⑭ | seed regen 闸 | 不无脑重灌:`regen → diff 旧 seed → 逐行确认每处变化都被 language-first 解释`;解释不了的搭车漂移=真 bug,修 |

## 执行波次

```
Wave 0  取证 + 清基线 + 建安全闸
        ├─ 跑 knip / vitest --coverage,产出《删除候选清单+定性》(死代码/测试专用/半成品/真shim)
        ├─ 14 红:regen seed + diff 审计(⑭) + 审「语言默认 fallback」(兑现盲区④)
        ├─ 105 skip:逐个 triage(复活 / 随死代码删),归零 skip(⑩)
        ├─ 建 census 不变式闸(⑫):event_type / i18n / layer-type / MCP 工具
        └─ 收口:全绿零skip + tsc --noEmit + git commit
Wave 1  纯死代码:co-location 残骸 / knowledge-meta-builder.ts / legacy-serve-lock-probe.ts(③)
Wave 2  Species A 迁移/兼容:旧 marker 剥离 / .cursor 扁平文件迁移 / MCP TOML 归一化 / config maturity 别名
        （doctor 的 bootstrap_marker_migration、mcp_config_in_wrong_file 两检测随之消失，②自然瘦身）
Wave 3  vocab shim(小心 wave):cite-tag remap + en.ts/zh-CN.ts G1/G3 文案 + self-archive hook 正则 + bootstrap-canonical.ts/AGENTS.md 文案
        ⚠️ 改 packages/shared schema 必须 `pnpm --filter @fenglimg/fabric-shared build` 重建 dist
每个删除目标:先写 red 不变式 → 删 → 转绿。每波收口:tsc --noEmit + 全量测试绿 + git commit。
```

## 留给用户拍的清单(本轮只产出不动)
1. 半成品功能:sync 推送(`run-sync.ts` 的 `defaultPush`/`defaultCommitDirty`/Git* types 未接线)— 要/不要/以后
2. 决斗:doctor 内部 `stable/endorsed` 是否顺手 rename 成 canonical `verified/proven`(独立 refactor,非本次目标)

## 执行时逐条判(无法预先一刀切)
- 105 skip 里哪个复活、哪个随死代码删 — 取决于每个 skip 背后代码去留,case-by-case

## 基线快照(worktree 建立时)
- commit: 9812287 (= main)
- build ✓ / tsc --noEmit ✓
- 测试:shared ✓ / server 704 pass + 99 skip / cli 14 fail(语言漂移)+ 6 it.skip
