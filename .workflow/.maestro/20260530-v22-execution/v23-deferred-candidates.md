# v2.3 候选清单 — v2.2 里程碑溢出的非阻塞裁决

> 来源:`20260530-v22-execution` 的 `needs_adjudication`(5 条 ADJ)。
> v2.2 已 `ALL_GOALS_DONE`(18/18 absorb + 4 门绿)。这 5 条都是**非阻塞的设计取舍**,不影响发布。
> 决策心法:**价值确定 + 改动不大 → 现在做;价值还靠猜 → 留触发器,信号出现再做**。

---

## ✅ 已处理:ADJ-W3-INJECTION-CONCURRENCY(并发写日志加锁)

**不再是 v2.3 候选 —— 已在 v2.2 收尾实现。**

- 改动:`injection-log.cjs` 加 advisory lock(`O_EXCL` 原子建锁 → 写 → 释放;争用时丢行保不交错;stale 锁超 5s 回收)。
- 原因:用户多窗口并发改同一 repo 是高频场景(价值确定),改动小(性价比正)。
- 验证:cli 839 测绿(+2 并发测)、tsc 0。提交见下方 ledger。
- **残留触发器**:若后续真见 `injections.jsonl` 出现损坏行 / 命中率数字异常 → 把"丢行"升级为"带退避重试的真锁",或引 ledger-lock 模式。

---

## ⏸️ 留 v2.3 / 待信号

### ① ADJ-W1-BM25WEIGHT — BM25 权重 cap

- **是什么**:检索打分里 BM25(正文相关性)权重 = 50,压过 locality/recency(各 100 量级)。
- **争点**:codex 担心大 N(~200 条)下单个 rare token 原始 IDF(~4.9×50≈245)可压过"同文件夹/刚用过"。gemini 认为这正是 content-leads 的预期。
- **为什么 defer**:属调参主观,非 correctness bug;当前行为(独含罕见 query term 的 doc 优先)是设计意图。
- **触发信号** → 才做:真实 eval 显示"单个怪词就霸榜 / 检索老被罕见词带偏"。
- **届时改动**:给单 token 的 BM25 贡献加 cap,或归一化 IDF。小改,在 `bm25.ts` / `plan-context.ts` 打分处。

### ② ADJ-W1-TOKENSUPERSET — selection_token 超集一致性清理

- **是什么**:payload byte-trim 发生在 tool 层,晚于 selection_token 在 service 层 mint,致 `token.ai_selectable_stable_ids` ⊇ 实际返回 candidates(菜单比实物多)。
- **为什么 defer**:benign 超集——每个显示候选都可 fetch(无害方向);top_k=24 下 >64KB 罕触发。
- **触发信号** → 才做:top_k 调大 / 单条正文变长,使 >64KB 截断变常态。
- **届时改动**:把 byte-trim 下沉进 `planContext` 的 service token mint 之前(需一并把 gate/sync warnings + payload limits 下沉)。中等改动,动检索管线分层。

### ③ ADJ-SK5-BOOTSTRAP-GUT — cite 契约是否真从 bootstrap 删

- **是什么**:SK5 字面要把 cite 契约从 bootstrap(每会话加载)搬进 skill ref 减膨胀;但 `bootstrap-canonical.test` 把 cite 明细钉成 always-on 治理不变式,且 cite-coverage 是项目首要指标。
- **现状**:已用**非破坏读**达成实质——建权威 `ref/cite-contract.md` + bootstrap 纯增指针,不 gut。
- **为什么 defer(实为待 human 拍 frame)**:真 gut(删 bootstrap pinned 内容 + 对应 test)= 移除被测治理保证 + 可能回归 cite 覆盖(推翻 rc.33)。**这是产品价值排序题(省 token vs 治理强度),非工程题。**
- **推荐**:**维持现状,不 gut**。小收益冒大险不划算,且实质目的已达成。除非将来 bootstrap token 预算真成瓶颈,再由 human 重新权衡。

### ④ ADJ-W3-VECTOR-SUPPLEMENT — 向量从"召回补充"升"语义纠偏"

- **是什么**:可选向量检索权重 cap ≤49 < BM25_WEIGHT 50,故向量翻不动 BM25,只在 BM25 弱区/打平区起作用。
- **争点**:codex 觉得价值窄。但这是 by-design——C2 定位是"语义**召回补充**"(捞词法漏的)非"语义纠偏";且 W2-REVIEW codex 自己要求 cap<BM25 防覆盖词法。"不许盖过" 与 "能纠偏" 本互斥。
- **为什么 defer**:真要语义纠偏需换架构(hybrid rank fusion / RRF),是另一个设计(与 defer 的 C1-RRF 同族)。
- **触发信号** → 才做:实际用起来发现"语义对的条目就是排不上来"。
- **届时改动**:大工程。引 rank fusion(RRF)统一融合 BM25 + 向量两路排序,而非加权相加。与 C1-RRF 合并设计。

---

## 一句话

- **现在动**:无(⑤ 已在 v2.2 收尾完成)。
- **维持现状**:③(不 gut,实质已达成)。
- **待真实信号**:①(怪词霸榜)、②(>64KB 变常态)、④(语义排序不准)—— 信号出现前不投入,出现后问题已具体、改法已清晰。
