# TASK-003 Summary — RRF content-only 融合 + fusion flag 门控（HIGH risk）

**Status**: completed（default 保持 `additive`，零线上行为变更——这是预期的完成态，非 blocked）
**Wave**: 3 / Phase 1（最高风险波次）

> 备注：本任务的实现主体由上一执行器在撞 session 额度上限前完成（未提交、未跑 tsc、未收口）。本会话验证半成品 → 修两处测试尾 → 跑全套验证 → 提交收口。

## 实改文件
- `packages/shared/src/schemas/fabric-config.ts` — `fusion: z.enum(["additive","rrf"]).optional().default("additive")`（schema 默认 additive）
- `packages/server/src/config-loader.ts` — `readFusion(projectRoot)` 读旋钮，默认 'additive'
- `packages/server/src/services/bm25.ts` — 新增 `rankDocuments` / `rankByScore`：1-indexed rank、score-DESC、stable_id tie-break、**严格 `score > 0` 才入榜**（零/负匹配排除在建榜层实现）
- `packages/server/src/services/plan-context.ts` —
  - `readFusion` + 在 planContext 主流程按 fusion==='rrf' && queryTerms>0 预算两路 content rank map（`bm25Ranks` / `vectorRanks`）
  - 抽 `contentScore(item, ctx)`：additive vs RRF 选择收敛到**一处**；structural boost（salience/recency/locality）两模式**逐字共用**，永不进 RRF
  - `RRF_K=10`、`RRF_NORMALIZATION=2000`（具名常量，非魔法字面量）
  - `scoreBreakdownForItem` 同步镜像 RRF 模式
- `packages/server/src/services/plan-context-shadow-ranker.test.ts`（新建）— shadow dual-run CI gate

## Convergence 结果（全 PASS）
| # | 准则 | 证据 |
|---|---|---|
| C1 | fusion knob 默认 additive | fabric-config.ts:526 `.default("additive")` + config-loader.ts:256-267 |
| C2 | RRF 计算 | plan-context.ts:1229 `RRF_K=10` + 1270/1272 `1/(RRF_K+rank)` |
| C3 | no-query 走旧 additive 路径 | plan-context.ts:1267 `fusion==='rrf' && hasQuery`，no-query fall-through 到 additive |
| C4 | zero/neg match 排除 ranker | **写法偏差**（见下）：bm25.ts:299/326 `if (score > 0)` 建榜层省略，非 inline `bm25Raw<=0` guard |
| C5 | content 仍压过 structural-only（相对排序，镜像 :1203）| shadow-ranker test 3 PASS：content hit 0001 < structuralOnly 0004 index |
| C6 | shadow no-query diff === [] | test 1 PASS |
| C7 | shadow query diff ⊆ allowlist | test 2 PASS（allowlist 修正见下）|
| C8 | 真实 team store 一次性人工 shadow run | **checkpoint，未做**（见下，翻默认前的人工 gate）|
| C9 | z-score 无引入 | grep 无命中 |
| C10 | 既有 invariants（:852/:1006/:1089/:1107/:1161/:1203）+ scope-rank:120 不回归 | server 全套 802 passed |
| C11 | tsc --noEmit | exit 0（已 rebuild shared）|

## 偏差与决策（2 处，均为修正错误假设，非弱化测试）

### 偏差 1：C4 零匹配排除的实现位置
任务字面 grep 期望 `bm25Raw<=0||vectorRaw<=0` inline guard。实际实现把排除收在 `rankDocuments`/`rankByScore` 建榜层（严格 `score>0` 才入 rank map，零分文档直接不在 map 里 → contentScore 对该路贡献 0）。**行为等价且更干净**：满足锁定约束 L-3「zero/negative match 不进 RRF ranker」，零匹配文档永远拿不到正的尾部名次分，floor 不被破。grep 准则是 proxy，行为已满足。

### 偏差 2：shadow-ranker test 2 的 allowlist（修正上一执行器的错误假设）
上一执行器写的 allowlist `{0001,0002,0003}` + 断言 `diff not contain 0004`，**假设结构锚 0004 位置不变**。实跑结果：
```
ADDITIVE: [0001, 0002, 0004, 0003]   结构锚 0004(140) 压过最弱内容命中 0003
RRF:      [0002, 0001, 0003, 0004]   0004 沉到最后
```
0004 被内容命中超越**是正确行为**：RRF 把三路内容命中（rank 1-3 → 归一化 ~182/167/154）全部抬过 140 结构天花板，连最弱的 0003 也越过 0004——正是 L-4「content 压过 structural-only」对整个内容集的体现，也是 `RRF_NORMALIZATION=2000` 刻意设计（注释 plan-context.ts:1234）。修正：allowlist 纳入 0004（四条都合理参与有界重排），并把错误的「锚不动」断言换成更强的真不变量 `rrf[last]===team:KT-DEC-0004`（结构锚 RRF 下排最后）+ `additive 中 0004 在 0003 之前`（记录基线差异，解释重排成因）。这是修正错误断言使其反映正确行为，非弱化测试。

## RRF 参数选择
- **k=10**：小型 KB（数十条）下让 head-vs-tail gap 仍有表达力（rank-1=1/11≈0.091 明显领先 rank-5=1/15≈0.067），优于 web-scale 惯用的 60。任务起点值，最终值留给真实库 shadow run 调。
- **RRF_NORMALIZATION=2000**：按**最坏情形**（常见 BM25-only 部署，无 embedder）反推：单路 rank-1 ≈ 2000×1/11 ≈ 182 > 140 结构天花板，保证单路命中也压过纯结构条目。双路 rank-1 ≈ 364。这是任务**唯一**留给真实库 shadow run 的可调旋钮，具名常量，校准是一行改动。

## ⚠️ Checkpoint：翻 fusion 默认 additive→rrf 前的一次性人工 shadow run（C8，未做）
默认仍 `additive`，本任务**不翻默认**。翻默认是独立的人工决策，前置门：
1. 在开发者**已绑定的真实 team store** 的仓库里，临时在该 repo 的 `.fabric/fabric-config.json` 写 `"fusion": "rrf"`。
2. 对一组代表性 query（覆盖真实知识检索意图）跑 fab_recall，对比 fusion=additive vs rrf 的 top-k 排序与 `score_breakdown`（TASK-001 已透出）。
3. 重点观察的**校准开放问题**：是否接受「最弱内容命中（单 term）压过完美同文件 locality + proven + recency 的纯结构条目」。若不接受，下调 `RRF_NORMALIZATION` 让弱内容命中落回 140 以下。
4. shadow 结果人工 review 满意后，再把 fabric-config schema 的 `.default("additive")` 改为 `.default("rrf")`（或在真实 repo config 显式置 rrf）。
5. 此 gate 是**人工非 CI**——seeded fixtures 的 CI gate（test 1/2/3）只保证「no-query 不变 + query 重排有界可解释」，不替代真实语料判断。
