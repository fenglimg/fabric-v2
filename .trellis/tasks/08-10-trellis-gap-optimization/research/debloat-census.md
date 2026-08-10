# 三轴普查:失效功能 / 注释噪声 / 低价值测试

方法沿用档 A/档 B 的教训:**先普查全集(标 in/out),再挑代表深挖**。凭命名例子反推会把判定做错 —— 档 A 4 个里错了 3 个,档 B "10,768 行要拆" 实测只有 5.9% 耦合。

普查脚本口径:`git ls-files` 驱动(避开 `packages/cli/.claude/` `.codex/` 这类 gitignore 的 dogfood 安装副本 —— 它们体量与 `templates/` 相当,按目录遍历会把统计翻倍);全部用 node `includes` 判定,不用 Bash grep(本机是 ugrep,已知假阴性)。

---

## 轴 1 · 失效功能与死代码

### 1.1 event ledger:65 个 event_type,18 个无任何生产引用(28%)

`packages/shared/src/schemas/event-ledger.ts` 声明 65 个 `event_type` 变体。逐个全仓查引用(排除 schema 自身),**18 个只有测试引用、零生产 emitter、零生产 reader**。

这 18 个分两类,判定完全不同:

**(a) 真死 —— 功能已退休,事件忘了删(10 个 / schema 92 行)**

| event_type | schema 行 | 为什么死 |
|---|---:|---|
| `meta_reconciled` + `meta_reconciled_on_startup` | 40 | `.fabric/agents.meta.json` co-location 已在 W5 I1 退休 |
| `reapply_completed` | 7 | `--reapply` flag 在 rc.15 随 `--force` 一起删了 |
| `install_diff_applied` | 7 | 只有 v1 安装器发,v1 已在本轮 W1 删除 |
| `claude_skill_path_migrated` / `claude_hook_path_migrated` / `codex_skill_path_migrated` | 18 | 一次性路径迁移事件,迁移的旧路径本身已不存在 |
| `knowledge_path_dangled` | 6 | 注释写"由 doctor lint 发出",doctor 里已无 emitter |
| `pending_auto_archived` | 7 | 同上,注释指向 rc.5 TASK-009 B2 的自动归档,该路径已不在 |
| `knowledge_meta_auto_healed` | 8 | agents.meta 自愈,随 co-location 一起退休 |

**(b) 计划中未实现 —— schema 先行的 instrumentation debt(8 个 / schema 64 行)**

`payload_guard_observed`、`skill_invocation_started`、`skill_invocation_completed`、`skill_phase_transition`、`skill_trigger_candidate`、`llm_judge_run`、`client_capability_snapshot`、`precompact_observed`。

来源可追:`docs/methodology/e2e-methodology-FINAL.md` 的 "NEW-N-3 instrumentation debt —— 产品须补 9 个 ledger 事件"。schema 写了,emitter 一个没写。

**它们和 (a) 的危害不同**:(a) 是残骸,(b) 是**假装已实现**。一个只读 schema 的人(或 AI)会认为这些遥测存在,基于它规划分析;`fab_recall` 把 schema 当权威也会这么认为。这正是我这轮踩过的坑的反面 —— 我曾从脏样本反推 schema,而这里是 schema 反过来骗读者。

### 1.2 fabric-config:51 个 key,0 个死键

全部有生产 reader(最低 2 处)。这一面是干净的,不用动。

### 1.3 knip 非严格模式:46 unused exports + 42 unused types

弱信号 —— 绝大多数是"只为测试而 export"。它提示的是封装问题(该测公开面却测了内部),不是死代码。**本轮不动**,单独议题。

---

## 轴 2 · 注释里的一次性任务代号

### 全集口径

| 指标 | 数值 |
|---|---:|
| 受追踪代码文件 | 646 |
| 总行数 | 157,883 |
| 注释行 | 27,948(**17.7%**) |
| 带一次性代号的注释行 | **4,272**(占注释 15.3%,占总行 2.7%) |
| 受影响文件 | **492 / 646** |

按代号族(一行可命中多个):

```
1503  rc.N            1014  TASK-NNN         892  W-phase       832  F/S/C/D-NNN
 689  version-rc       438  B/T-N batch      425  KT-/KP- id    353  P0..P4
 343  ISS-...          146  G-gate           135  ralph/grill   122  NEW-N
  57  ux-wN-N           46  crack N
```

按区域:`cli` 1181 / `server` 1031 / `shared` 784 / 测试合计 1221 / `scripts` 20。

### 抽样分类(55 条分层抽样)

- **A 类 · 纯考古前缀,删前缀留句子** —— `v2.0.0-rc.24 TASK-10`、`rc.31 NEW-6`、`v2.2 全砍 F10`、`W3-C`、`ux-w2-4`、`rc.35 TASK-04 (P0-9.b)`。代号后面的句子才是内容,代号只回答"这行是哪次任务改的" —— 那是 git blame 的职责。**占绝大多数。**
- **B 类 · 代号是活约束的简称,留约束、去代号** —— `C-008 hot-path-safe`(热路径不许抛)、`S5 locked set`、`C-107 id guard`。约束是真的,但读者无法从 `C-008` 推出"热路径安全",要把话说全。
- **C 类 · 可解析的真 id,保留** —— `KT-DEC-0070`、`KT-PIT-0005` 等 425 处。这些能通过 `fab_recall` 取回正文,是活引用,**不是代号噪声**。
- **D 类 · 陈述本身已过时** —— 例:`extract-knowledge.ts:598 // v2.0.0-rc.37 NEW-6: this branch is now unreachable because…`。注释说这条分支不可达 —— 这是轴 1 的线索,不是轴 2 的。

**判据**:注释回答**为什么**,不回答**哪次任务**。历史归 git log。唯一例外是 C 类可解析 id。

我自己也犯过:本轮我写的注释带了 `B8:` `T-2:` `T-5:` 前缀,同样要按此判据清掉。

---

## 轴 3 · 低价值测试

规模基线:300 个测试文件 / 72,847 行 / 3,077 个 `it()`。

### 3.1 先证伪一个直觉

按断言写法扫"可疑模式"(`toBeDefined` 135、`length>0` 47、`typeof` 38…)**没有判定价值** —— 逐个 `it()` 块分析后,42 个"无断言"里 37 个是假阳性(`schemas-roundtrip.test.ts` 的断言在 `roundTrip()` helper 里,是正经的 JSON 往返测试)。**按断言 idiom 判定测试价值行不通**,和档 B 的结论同构。

### 3.2 真正的三类

**(a) 一条实现被复制成 N 个 `it`(24 个族,~541 冗余行)**

最典型:`errors-prototype-chain.test.ts` 用 8 个近乎逐字相同的 `it` 断言 `new XError() instanceof X/Parent/FabricError/Error`。而 `Object.setPrototypeOf` 只在基类 `FabricError` 写了**一行**,且 target 是 ES2022(本就不需要这行)。8 个测试测的是同一行。

更值得注意的是:仓里有 11 个 error 子类,这 8 个只覆盖了 7 个 —— `StoreWriteTargetUnresolvedError` / `PersonalScopeLeakError` **没被覆盖**。所以正确动作不是"删 7 个",而是**收成一条 `it.each` 遍历全部导出的 error 类** —— 行数降到 1/8,覆盖面反而变全。这个模式适用于整族。

**(b) 为死 schema 写的测试**

轴 1 的 18 个死 event_type 在 `event-ledger.test.ts` / `schemas-roundtrip.test.ts` 里都有往返测试。测试没错,但测的是**没有生产者也没有消费者的形状**。随 schema 一起删。

**(c) 同义反复**

`event-ledger-census.test.ts` 的第二个 `it`("every member is a unique non-empty discriminator")—— zod 的 `discriminatedUnion` 在**构建期**就会对重复/空 discriminator 抛错,这条断言不可能失败。

> 同文件第一个 `it`(inline snapshot 钉住成员全集)**要保留**,它的注释讲清了理由:event_type 是按字符串动态分发的,grep 证明不了某个成员死了,所以用 census 快照强制显式 review。这正是轴 1 能做出来的前提。

---

## 建议动作(未执行,待确认)

| # | 动作 | 量 | 风险 |
|---|---|---:|---|
| 1 | 删 10 个"真死" event_type + 其往返测试 | ~92 schema 行 + 测试 | 低。删前跑一次全仓 round-trip:确认 `.fabric/events.jsonl` 历史行不含这些类型,否则老 ledger 会 parse 失败 |
| 2 | 8 个"计划中"事件:要么删、要么在 schema 上打显式 `@planned no emitter` 标记 | ~64 行 | **需要你定** —— 见下 |
| 3 | 注释去代号:A 类删前缀、B 类把约束说全、C 类保留 | 4,272 行 / 492 文件 | 中。纯注释改动不影响行为,但量大,建议分包提交、每包跑一次全量测试 |
| 4 | 24 个复制族收成 `it.each` | ~541 行 | 低,且部分反而扩大覆盖面 |
| 5 | 删同义反复断言 | 个位数 | 无 |

---

## 轴 4 · 测试有没有效果(变异测试实测)

轴 3 用的是"读代码判断"。但轴 3.1 已经证明:按写法判定测试价值行不通。所以这一轮换成唯一可信的判据 ——

> **如果实现是错的,这个测试会不会红?**

做法是**变异测试**:把源码里的某个判断/常量改成一个错误的版本,跑测试。测试红了 = 这个变异被"杀死",说明测试有判别力;测试仍绿 = 变异"存活",说明这段代码没有任何测试在守。

### 4.1 靶场本身要先被验证

两个坑,都实际踩到了:

**坑一 · 只跑本包测试会误报。** 一个包自己的测试瞎,不代表下游包的测试瞎。第一轮只跑 owning package,得到一堆"存活",跨包复跑后其中一半以上其实被别的包杀掉。所以流程必须是两段:

1. 廉价初筛(`vitest related <src>`)—— 产出的只是**候选**,不是结论;
2. 复核(改源码 → 重建 shared dist → 重新生成 hook lib → 跑全部三个套件)—— 只有这一步的判决算数。

**坑二 · 等价变异会伪装成"没测试"。** 我给 `git-remote-allowlist.ts` 的测试专用旁路设的靶子是把
`process.env.VITEST !== undefined` 改成 `=== undefined`,报告"存活"。但后半句 `|| VITEST_WORKER_ID !== undefined` 在 vitest 下恒真 —— 这个变异**根本没改变行为**。改成 `return false` 真正关掉旁路后,CLI 套件立刻红:这条旁路是活的、被依赖的。

**教训:靶场必须带对照组。** 我在复核批次里塞了一个已知应该被杀的变异(`theme.ts` 的 `FORCE_COLOR` 判断),它确实被 CLI 杀掉,才能确认这套靶场不是在无脑报"全存活"。

### 4.2 实测结果

初筛杀死率:shared 68/124(55%)、server 147/265(55%)、cli 抽样 65/120(54%)。7 个候选跨包复核后:

| 候选 | 判决 |
|---|---|
| `theme.ts` FORCE_COLOR(对照组) | 被 cli 杀 ✔ 靶场可信 |
| `git-remote-allowlist` VITEST 旁路 | 等价变异,重做后被 cli 杀 |
| `resolve-input` mount_name 展开守卫 | 被 server 杀 |
| `high-value-predicate` session_id 过滤 | 被 server + cli 杀 |
| `store-counters` EEXIST 守卫 | 被 server 杀 |
| **`plan-context-score-factors` 排序权重** | **存活** |
| **`doctor-cite-goodhart` 阈值边界** | **存活** |

### 4.3 两个真存活的含义

这两处是**行覆盖率骗人的教科书案例**:

- `plan-context-score-factors.ts`(463 行,`fab_recall` 排序的全部权重)被 260 个测试传递执行、计入覆盖率,3 次常量变异 0 杀。**排序算错了不会有任何测试变红。**
- `doctor-cite-goodhart.ts` 的 G1/G2/G5 三条启发式被 280 个测试执行,`doctor.test.ts` 里只在一份检查项名单里出现过它的标签字符串 —— 没有一行验证过它的行为。

结论不是"删测试",而是反过来:**"有 260 个测试覆盖"这句话本身没有信息量**。

### 4.4 已执行

**删**`packages/shared/test/property-based/atomic-write.test.ts`(commit `21ccdec2`)

判据是直接做出来的:把 `atomicWriteText` 换成完全非原子的朴素 `writeFile`,这 3 条属性测试**全绿**。原因是它们生成的是**内容字符串**,而原子性不变量根本不依赖内容取值 —— 属性打在了错误的轴上。真正有意思的轴是**失败空间**(rename 失败、父目录缺失、写到一半崩),那些由 `test/atomic-write.test.ts` 的示例测试覆盖(同一个非原子实现被它抓出 5 条失败)。

代价侧:这个文件 3.95s,是 shared 套件最贵的单文件,~600 个生成用例。删后 shared 套件 **4.27s → 1.99s**。

> 对照:同目录的 `payload-guard.test.ts` 属性测试 3/3 全杀 —— 属性测试本身没问题,问题是**打在哪个轴上**。`zod-roundtrip.test.ts` 便宜(不进耗时榜),留着。

**补**`doctor-cite-goodhart.test.ts`(16 测试,28ms,commit `21ccdec2`)—— 全部钉在阈值边界上(恰好等于阈值不触发 / 超过一格触发),因为阈值代码唯一的错法就是差一。**10 条变异 10 杀**(此前 0/3)。

**补**`plan-context-score-factors.test.ts`(22 测试,7ms,commit `b72ac752`)—— 钉的是注释里明写的**校准意图**而非常量数值(content 压过 locality、locality 压过 recency、salience 最细、RRF 下纯结构候选低于任何 content 命中、credibility 按成熟度兜底),这样重新调参只要意图不变就仍绿,调反了才红。**22 条变异 19 杀**(此前 0/3),余下 4 条经推导为等价变异。

写这个测试的过程里还抓到自己写的一条无判别力断言:credibility floor 那条原本断 `draftScore > 0`,但去掉 floor 后 `2^-100` 仍是正浮点数,断言照绿。改成跨成熟度比较后才咬得住。**——同一个陷阱,写新测试时照样会踩。**

### 4.5 测试流程的成本分布(未动,记录)

CLI 套件 226s 测试时间,前 15 个文件占 81%。最贵的是 install/uninstall 类集成测试(每个 test 1–4s,因为真的跑一次安装)。这类**有效果**(install 是产品本体,`cross-client-parity` 钉的是 .claude/.codex 安装面字节一致,只能真装才能验),成本是固有的,不建议动。

真正的候选是**同一次完整安装被 5+ 个文件各自重跑一遍**(`install-skills-and-hooks` / `uninstall-skills-and-hooks` / `install-cli-surface` / `install-diff-mode` / `init-guard`)。共享一次安装产物再分文件断言可能省掉大半,但这是**测试架构改造**,风险高于本轮的删除动作,单独立项。

### 4.6 未行动的候选(初筛 0 杀文件清单)

初筛报告 shared 12 / server 20 / cli 10(43 个抽样中)个文件 0 杀,存于 `/tmp/mut/stage1-*.json`。**没有据此批量动手** —— 4.1 的坑一已经证明初筛会误报一半以上,每一条都要跨包复核才能定性。留作下一批的输入。
