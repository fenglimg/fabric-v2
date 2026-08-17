# Implement — Fabric 全项目深审执行计划

执行顺序有依赖:W1 必须先于 W4(靶子没攻击过,对标结论不可信);W2/W3 可与 W1 并行推进但产出独立。

---

## W1 — 领域 census 与靶子攻击 → `research/domain-census.md`

- [ ] 1.1 web 检索枚举候选全集,四类各至少 3 个:agent memory 产品 / rules-file 生态 / 上下文检索层(含 MCP memory servers)/ 团队知识治理工具链。每个记:定位一句话、生命周期是否有审核环节、是否跨客户端、来源 URL。
- [ ] 1.2 逐个标 in-scope / out-of-scope + 理由(census 表)。
- [ ] 1.3 **靶子攻击**:对 `KT-DEC-0072` 的边界做 design.md §3 轴A 的三问,写成独立一节。这一节不写就算 W1 未完成。
- [ ] 1.4 若攻击结论认为边界确属 self-serving,按"用户真实痛点"重新分组竞争者,并把重新分组后的对手带进 W4。

**验证**:`domain-census.md` 存在,含候选表(每行有 in/out + 理由 + 来源)与靶子攻击节;单一来源的断言均标 `[单源未交叉验证]`。

---

## W2 — 门禁实跑(P1) → `research/engineering-evidence.md` §P1

按此顺序跑,每条记录退出码与关键输出摘录。**长耗时命令后台跑,不阻塞后续。**

- [ ] 2.1 `pnpm -r build`
- [ ] 2.2 `pnpm typecheck`
- [ ] 2.3 `pnpm typecheck:tests`
- [ ] 2.4 `pnpm lint`(knip --strict)
- [ ] 2.5 `pnpm test`
- [ ] 2.6 `pnpm test:strategy` / `test:dangling-refs` / `test:doc-drift`
- [ ] 2.7 `pnpm test:store-only-e2e` / `test:upgrade-e2e`
- [ ] 2.8 `node scripts/nofake-audit.mjs` / `red-team-safety.mjs` / `perf-benchmark.mjs`

**前置注意(既往教训)**:改过 shared schema 后不 build 会 runtime 报错;跨包 typecheck 读依赖的 `dist/*.d.ts`,dist 陈旧会造成本地假红 → 所以 2.1 必须先于 2.2/2.3。

**验证**:每个门禁一行结果表(命令 / 退出码 / 绿红 / 若红则首条错误)。任何未能跑通的记 `UNVERIFIED` 并写明阻塞原因,不省略。

---

## W3 — 门禁严格度探针(P2) → `research/engineering-evidence.md` §P2

- [ ] 3.1 **变异测试**:选 3 个核心模块(召回打分 / knowledge schema 校验 / hook 项目根解析),各注入 1 处语义变异,跑对应测试,记杀/不杀;每处变异后立即 `git checkout` 还原。含 1 个对照组(注入一处**应当**不影响行为的改动,确认不是所有改动都变红)。
- [ ] 3.2 **基线债**:读 `scripts/typecheck-tests-baseline.json`,记条目数与覆盖文件面。
- [ ] 3.3 **门禁自覆盖**:读 `doc-drift-gate.mjs` / `lint-dangling-refs.mjs`,比对实际扫描口径(后缀、目录排除、allowlist)与文档宣称口径,特别查 `.cjs` / 模板目录盲区。
- [ ] 3.4 **未接线能力**:抽 5 个"有实现有测试"的导出,用 Grep 工具(非 Bash grep)查生产侧调用方;零调用方的记为候选。
- [ ] 3.5 **架构分层**:统计 shared→cli、shared→server、server→cli 的反向 import;查循环依赖。
- [ ] 3.6 **发布稳定性**:`git tag` 全量 + 各 tag 间隔 + rc 数量;统计 CI 修复 commit 密度。
- [ ] 3.7 **依赖面**:三包 dependencies 数量、optionalDependencies 处理、Node 版本要求。

**验证**:每个探针有原始命令与输出摘录;变异测试记录必须含"变异内容 + 是否被杀 + 还原确认"。

---

## W4 — 综合判定 → `report.md`

- [ ] 4.1 6 轴对标表(每轴:Fabric 位置 / 最强对手 / 一句证据)。
- [ ] 4.2 两个明确判定(是 / 否 / 有条件是)+ 一句话理由。
- [ ] 4.3 四档差距清单(阻断 / 显著 / 轻微 / 主观偏好)。
- [ ] 4.4 "要成为领域最好还缺什么"的最短路径(按投入产出排序)。
- [ ] 4.5 每节开头一句大白话(这节在看什么、看不好会怎样)。

---

## W5 — 本地对抗复核 → `report.md` §复核 gap

**用户已决定不走外部模型通道**(2026-08-13)。delegate / Gemini 路径作废,不要执行。

- [ ] 5.1 以"检方"视角逐条尝试驳倒 W4 的每条判定;默认立场 refuted,判定须自证才保留。
- [ ] 5.2 只读 `report.md` 正文进行复核,不回看 W1–W3 的中间证据(逼近零上下文条件)。
- [ ] 5.3 每条判定强制产出一句"如果这条是错的,最可能错在哪"。
- [ ] 5.4 按 design.md §4 三档处置(撤回 / 降级 / 保留),gap 单独成节。
- [ ] 5.5 报告顶部写死限定行:"未经零上下文外部复核,判定的乐观偏差未被独立消除"(`KT-GLD-0006` 实测自评 100% vs 冷评 81%)。**不得省略**。

---

## W6 — 收口

- [ ] 6.1 `backlog.md`:按四档严重度排序,每条注明预估影响面;无问题写"无"。
- [ ] 6.2 `git status` 确认 in-scope 代码零改动(会话初始 4 个 dirty 路径除外)。
- [ ] 6.3 归档判断:本段是否有值得进 KB 的结论(Trellis 收口仪式 + Fabric archive cadence)。

---

## 回滚点

- W3.1 变异测试是唯一会临时改代码的步骤:每处变异**单文件、单行、立即还原**,还原后 `git status` 必须干净才进入下一处。
- 任何步骤发现必须永久改代码才能推进 → 停,问用户。
