# W3-H 重构方案 — scope 三轴自解释

> 权威 spec: gap-census §2 row W3-H + `proposals/05-strategy.md` S6/P1
> 分支: `feat/w3h-scope-self-explain`
> GATE 2 已确认(2026-06-24):
> - OQ-A → 诊断命令归 **`audit why-not-surfaced`**(只读诊断,与 W3-D 架构一致,非 doctor)
> - OQ-B → **不改 store 别名**(S6 未要求;`"team"` 别名散 81 文件,破坏性);碰撞靠 bootstrap 决策表"解释"消解

## 背景(S6)
scope 三正交轴:`semantic_scope`(受众 team/project/personal)× `relevance_scope`(时机 broad/narrow)× `store`(物理库),两轴共用 "team/broad" 词 → 3 条独立失败路径无统一诊断出口。用户困惑"为啥这条没浮现"。

## 落地

### ① `audit why-not-surfaced <id>`(本波主体)
新 server 函数 `explainWhyNotSurfaced(projectRoot, id)` 逐因诊断:

| verdict | 判定 | 数据源(全 grounded) |
|---|---|---|
| not_found | 全 mounted store 都无此 id | `loadGlobalConfig().stores[]` 枚举全库 + frontmatter id 匹配 |
| store_unbound | 找到但其 store 不在 read-set | `scopeExplain(root, scope).readSet.stores` 比对 |
| project_mismatch | semantic_scope=project:OTHER ≠ 本仓 active_project | `filterByActiveProject`(cross-store-recall:115)+ `activeProjectOf` |
| narrow_timing | relevance_scope=narrow | frontmatter `relevance_scope`(RRuleDescription) |
| should_surface | 过全部 gate + broad | 兜底:提示查 snapshot 陈旧(KT-PIT-0019) |

- 复用面:`collectStoreCanonicalEntries`(read-set 内)+ 新增 all-mounted-stores walk(cause-1 必须能找到 read-set 外的条目)。
- CLI `audit why-not-surfaced <id>` subcommand(照 `retired` 模型:meta+args{target,json}+run 调 server fn + renderer);加进 `auditCommand.subCommands`。
- i18n: 诊断渲染串 en+zh(locale-parity)。
- read-only,无 fix,与 audit 语义一致。

### ② bootstrap 三因决策表
`bootstrap-canonical.ts:89`(zh)/`:157`(en)已有 semantic_scope 三层 Discovery bullet;追加 3 轴×3 失败路径小决策表 + 指向 `fabric audit why-not-surfaced <id>` 自解释出口。i18n 双写 + parity 闸(KT-DEC-0034)。

### defer
relevance 轴砍除(census/grill 已定 defer)。

## TDD 任务分解(每步 tsc + vitest)
- **T1**: server `explainWhyNotSurfaced` — 先写测试(5 verdict 各一 fixture:not_found / store_unbound / project_mismatch / narrow_timing / should_surface),再实现 all-stores walk + 3-cause 判定。
- **T2**: CLI `audit why-not-surfaced` subcommand + renderer + json + i18n(en+zh)。测试:subcommand 注册 + json 形状。
- **T3**: bootstrap-canonical 三因决策表(zh:89 + en:157)+ bootstrap-parity 测试绿。
- **T4**: 全验 — tsc -r / vitest(shared+server+cli)/ 4 CI gate / `fabric install --yes` dogfood + `audit retired` round-trip / `audit why-not-surfaced` 实跑冒烟。

## 风险
- R1(中): all-stores walk 新原语 —— 须能读 read-set 外的 store(loadGlobalConfig + storeRelativePathForMount)。复用 walkReadSetStores 的 frontmatter 解析逻辑,别重写解析(producer-consumer 漂移)。
- R2(低): qualified vs local id —— 入参可能 `KT-DEC-0001` 或 `team:KT-DEC-0001`,两种都要认。
- R3(低): bootstrap i18n parity —— en+zh 同步,否则 parity 闸红。
- R4(低): 工具纪律 —— 用 rg -a / node 普查(本机 grep=ugrep 对 NUL-byte .cjs 假阴性,W3-J 实证);删/改前跑 round-trip oracle。
