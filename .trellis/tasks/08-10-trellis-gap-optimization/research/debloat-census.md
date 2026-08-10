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
