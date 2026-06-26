# W3-H Refactor — reflection log

> scope 三轴自解释。分支 `feat/w3h-scope-self-explain`。

## GATE 2 决策(用户确认 2026-06-24)
- **OQ-A → `audit why-not-surfaced`**(非 doctor):只读诊断,与 W3-D 架构一致(doctor=健康+修,audit=只读诊断);放回 doctor 会重引入 W3-D 刚清的混用。
- **OQ-B → 不改 store 别名**:S6 的真实药方 = 诊断 + bootstrap 决策表(把碰撞"解释"清楚),非"消灭"。census 的"store 改用物理别名"是越界加料(`"team"` 别名散 81 文件 + 用户真实 store,破坏性),不做。

## 落地
- **① server `explainWhyNotSurfaced(projectRoot, id)`**(why-not-surfaced.ts):逐因诊断 5 verdict(not_found / store_unbound / project_mismatch / narrow_timing / should_surface),报**第一个**阻塞因。复用 `buildStoreResolveInput`+`createStoreResolver.resolveReadSet`(与 recall 同源,verdict 不漂移)+ all-mounted-stores walk(`readKnowledgeAcrossStores`,能找 read-set 外条目)+ `scopeRoot` G-FILTER 语义(镜像 cross-store-recall filterByActiveProject)。
- **② CLI `audit why-not-surfaced <id>`**(audit.ts subcommand,照 retired 模型):renderer(plain-English + symbol,与 audit 组兄弟一致)+ --json + required positional id。server fn 经 index.ts 导出。
- **③ bootstrap 三因决策表**:bootstrap-canonical.ts zh:89 / en:157 各加一 bullet,解释 3 正交轴 + 名称撞车 + 指向 why-not-surfaced 出口。i18n 双写 parity。

## 工具纪律(W3-J 教训应用)
- 全程用 `rg -a` / node / fab_recall,不用裸 Bash grep(本机=ugrep,对 NUL-byte .cjs 假阴性)。
- 删/改前 + 收尾跑 `fabric audit retired` round-trip oracle 兜底。

## 验证(全绿 + 真数据 round-trip)
- tsc -r;server 782(+7)/ shared 627 / bootstrap-parity 9 / cli wiring 2;CLI bootstrap-propagation + audit + surface-snapshot + parity 全过。
- 4 CI gate:knip / protected-tokens / strategy / store-only-e2e 全过。
- **真 dogfood round-trip 实证**:`audit why-not-surfaced` 对真实条目正确判定 —— KT-MOD-0001(broad)→should_surface、KT-DEC-9999→not_found、**KT-DEC-0027→narrow_timing**(与其真实 frontmatter relevance_scope=narrow 一致,producer-consumer 验证)。
- `fabric install --yes` 重生 dogfood → bootstrap bullet 已传播 + `audit retired` 零残留。

## 风险(全 mitigated)
- R1 producer-consumer 漂移 → 复用同源 read-set resolver + scopeRoot,真数据 round-trip 验。
- R2 qualified/local id → toLocalId 双认 + 测试覆盖。
- R3 bootstrap parity → en+zh 同步 + parity 闸 9 绿。
