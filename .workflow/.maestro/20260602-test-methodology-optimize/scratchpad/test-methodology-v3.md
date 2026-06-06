# 全面测试方法论 v3（三赛道 · 主流锚 · eval-driven 操作骨架）

> 目的:对一个多域软件项目(尤指含 AI-in-use 功能的)做"全面测试/审计",系统暴露所有有嫌疑的问题:已知 / 疑似 / 可疑 / 做了没接入(空壳) / 漏做 / **做了但没用(效能死)**。
> v2→v3 是 frame-pivot(human 掀 frame 后重构,非补丁):从"单工具(面枚举缺陷发现器)"升级为"**三赛道 × 主流锚 × eval-driven 闭环**"。v0-v2 不废,降为 Track A 的内容。
> 锚来源见文末 §附录(R1 经典框架 + R2 同空间产品实测,全带 URL)。

---

## 0. 纲领:一个工具干不了三件事 → 拆三赛道

"全面"是三个不同问题,认识论不同,别塞一个 loop:

| 赛道 | 回答 | 认识论 | 主流锚 |
|---|---|---|---|
| **A 正确性** | 有没有 / 对不对 / 接没接线 | bottom-up 偏差检测 | HTSM 技法 + **fitness functions** · ISO **Correctness** |
| **B 完备性** | **漏没漏** | **top-down**,撞墙发现非清点 | 探索式/HTSM SFDIPOT+tours · ISO **Completeness** · 风险驱动 |
| **C 效能** | **做了到底有没有用** | 反事实 / outcome 度量 | ISO **Appropriateness**+使用质量模型 · 消融 · AI-eval(RAGAS/agent-trajectory/LLM-judge) |

> ISO 25010 "功能适用性"三子特性 = Completeness/Correctness/Appropriateness,正好就是这三赛道的标准命名。

---

## Part I. 组织原则:用「质量维度 × 风险」替代「功能点枚举」(治 tag 爆炸)

**别按技术 surface 打 tag(服务端/cli/mcp/向量…会组合爆炸)。** 改两条稳定轴:
1. **维度锚 ISO 25010**(8-9 特性 + 31 子特性):功能适用性/可靠性/性能效率/易用性/安全性/兼容性/可维护性/可移植性(2023+Safety)。维度集**封顶可判完备**,不自创不漏面。
2. **风险加权**(ISTQB):每块按 `风险 = 爆炸半径 × 改动频率 × 历史缺陷密度 × 用户可见度` 排序。**高风险深测、低风险采样,明写没测的(no-silent-caps)。不追假 100% census(它给 false confidence)。**

→ "服务端/客户端/cli/AI内/向量"退化为**实现细节**;测试在 (维度 × 风险区) 的稳定网格上跑,不在 N 个漂移 feature tag 上跑。

---

## Part II. 三赛道细则

### Track A — 正确性(有没有 / 对不对 / 接没接线)
> v0-v2 的强项全在这条。锚:HTSM 9 技法 + 架构 fitness functions。

- **四 oracle**(= HTSM Claims Testing + fitness functions 的操作化):
  - producer-consumer(写了没人读 / 读了没人写 / 回路不通)
  - declared-vs-impl(声明在实现壳 / vocab 不一致)
  - doc-vs-code(文档/注释/help ≠ 代码 = Claims Testing"verify every claim")
  - invariant(恒成立性质被破坏)
- **fitness function 化(属性 over 功能点)**:把 round-trip/oracle 写成可在 CI/流水线**持续跑**的架构断言,不是一次性检查。
- **Round-trip = 契约级等价(不止连通性)**:① 连通(造触发数据走缝,退化数据下空壳不可见)② 保真(字段无静默丢/类型不降)③ 新鲜(非陈旧 cache)④ 双向无悬空 ⑤ 追终端副作用(落盘/网络/UI;黑洞假消费者=空壳)⑥ facet 坍缩(防碎片化掩盖根因)。
- **判空壳前三道排除(精确率核心)**:gated+fallback(切 enabled 再测)/ runtime-empty vs structural-hollow(造数据能通=非空壳)/ dead-code≠hollow。
- **搜索边界**:consumer 搜索跨 .cjs/模板/动态注册/客户端资产,非只 src/;静态 grep 动态盲区 → 降级 runtime trace。
- **MCP 工具**(同空间):用 **MCP Inspector** 逐 tool invoke;"像 API 测试一样测 MCP tools/resources"。
- 注入矩阵(invariant 可执行化):文件损坏/缺失/offline/locale/规模阶梯/并发/权限,各至少一次 + teardown 防状态泄漏。

### Track B — 完备性(漏没漏)
> 铁律:**枚举永远证明不了"没漏"。完备性是 top-down 的,靠撞墙不靠清点。** 锚:探索式 + ISO Completeness。

- **探索式当主力遗漏发现器**(HTSM):带 persona 用 SFDIPOT(Structure/Function/Data/Interfaces/Platform/Operations/Time)做 survey + **tours**(money/landmark/back-alley tour),在"想达成某价值却撞墙"处记遗漏。
- **三路 census 补枚举(但不依赖它判完备)**:
  - code-resident census(声明源 grep 全集,断言每 surface ∈ {covered}∪{waiver})
  - **外部 spec anti-join + drift 甄别**:代码 ⟕ PRD/issue/changelog,命中先归一化源 status(active/deprecated/waived)+ staleness + ownership,**只 active 算漏做候选**(防过期需求假阳性洪灾)。
  - **无-spec baseline checklist**:对"代码与 spec 皆零 footprint"的隐式/平台级漏做(缺优雅降级/缺安全审计/缺错误 remediation)用通用横切清单兜底。
- 风险加权决定哪些区域深探、哪些采样。

### Track C — 效能(做了到底有没有用)★ v0-v2 最大缺口
> 锚:ISO Appropriateness + 使用质量模型 + 消融 + AI-eval 栈。

- **消融/反事实(最强单招,一击杀"空壳"+"无用")**:关掉/拔掉一个功能,看可观测后果是否变化。**拔了什么都没变 = 空壳或无用**,两痛同解。Fabric:逐 hook/skill/KB 条目消融,凡"拔了 agent 行为无变化"皆嫌疑。
- **检索/记忆效能三联(同空间 mem0)**:不止"召没召中",按 **accuracy × cost(mean tokens/query)× latency** 测,且 **equal-constraints**(同检索预算/模型/延迟)比较。可建 Fabric 版记忆基准集(合成多会话知识+问答对,仿 LoCoMo/LongMemEval/BEAM),做回归。
- **AI 行为 eval(hook/skill/mcp = 交互轴,同空间 Langfuse/OpenAI Codex skills 配方)**:
  - prompt dataset → spin up 真 agent 跑 → **trace 每个 tool call/CLI/编辑** → 指标:skip 率 / fallback 率 / retry 次数 / 策略遵循率(如 cite)→ 不可确定性判的上 **LLM-as-judge**。
  - 教训:"措辞 optional vs mandatory 致全败" → skill/policy 关键决策措辞本身是被测对象。
- **使用质量(outcome)**:不只功能层,评"在真任务上是否交付价值"(Letta 式 holistic 任务评估)。

---

## Part III. 操作骨架:eval-driven 闭环(同空间三家共识)★ v0-v2 最缺

不是一次性发现,是**持续回归循环**:

- **最小单元 = data + task + scorers**。两类 scorer:**code-based(确定性)+ LLM-as-judge(柔性)**。
- **agent/AI 功能评 = 端到端 outcome + 单步(tool call/参数准确)双层。**
- **闭环**:
  1. 生产/会话 **trace** 全程记录(每 tool call/CLI/编辑)。
  2. 失败 trace → 一键进 **dataset** → 转成可复现 **offline eval**(像单测,stub 外部依赖用快照)。
  3. **每次改动(prompt/code/schema/架构)deploy 前跑累积 eval 套件,比对版本分数 —— 证明"真变好不只是变了"。**(= 本方法论自身 mode④ 的产品级形态)
  4. 线上 **online 监控**(全量打分起步,按流量采样);低分 trace 回流进 offline dataset。
  5. 过 eval 的用例进**永久回归套件**。
- 可观测性前提:trace/埋点。无 trace 的功能,先补埋点(T2)才能进闭环;纯质量项(T3)永远 LLM-judge。

---

## Part IV. 横切纪律(贯穿三赛道)

- **frame-challenge(human,不可机械化)**:多-LLM/critic 收敛 = frame 内自洽 ≠ 正确。收敛前必过 human 掀 frame(对着"边界暴露 artifact"=未审目录/skip/未触发 surface/未覆盖 persona);留可审计输出(挑战问题/waiver/反驳证据);挑战 fail → 失败回流,新维度进探索轴,重跑。**agent 自生成清单有二阶盲区,故必须真 human。**(= context-driven testing 信条)
- **verify-before-trust**:候选 ≠ finding。先 deterministic verify;refuted 进 refuted-ledger(id+reason+证据)不丢弃;LIBERAL capture 弱信号先记 unverified。
- **统一收口律**:critic 持续找"再来一个 instance" → 解是生成式 pattern 吸收为 data,非更多 instance(深度=anchor / 广度=census / 交互=rubric+外部框架 / round-trip=契约等价原则)。
- **非确定性失败统计严谨**:L-LLM 概率失效须 最小样本量 + 阈值 + promoted/refuted 规则,跨执行者可复现,单次不当假阳性丢。
- **anti-bloat / 可移植**:行为型,不编码漂移签名;锚通用框架(ISO/HTSM/RAGAS),声明源是项目 data;执行期工具链自举探针(探 build/test 命令)。
- **收敛**:连续 2 轮无新 distinct confirmed + human frame 挑战通过 才停;否则跑满预算取最优。

---

## 附录:锚索引(带 URL)
**经典(R1)**:ISO/IEC 25010(iso.org/standard/35733.html · perforce.com/blog/qac/what-is-iso-25010 · webstore.iec.ch/en/publication/90024)· HTSM/探索式/context-driven(satisfice.com/download/heuristic-test-strategy-model · satisfice.com/exploratory-testing · developsense.com/resource/htsm.pdf)· fitness functions(nealford.com/books/buildingevolutionaryarchitectures.html · oreilly ch02)· LLM-as-judge(evidentlyai.com/llm-guide/llm-as-a-judge)· RAG triad/检索三指标(atamel.dev/posts/2025/01-09 · deepeval.com)· agent trajectory(cloud.google.com Vertex · galileo.ai · arxiv 2512.12791)。
**同空间产品(R2)**:mem0 记忆评估三参数+基准(docs.mem0.ai/core-concepts/memory-evaluation · arxiv 2504.19413 · github.com/mem0ai/memory-benchmarks)· Letta(letta.com/blog/benchmarking-ai-agent-memory)· eval-driven 闭环(braintrust.dev/articles/how-to-eval · langchain.com/blog/how-we-build-evals-for-deep-agents · langchain.com/blog/traces-start-agent-improvement-loop)· **skill eval=Fabric 镜像**(langfuse.com/blog/2026-02-26-evaluate-ai-agent-skills)· MCP(github.com/modelcontextprotocol/inspector · modelcontextprotocol.io security)。

## 诚实标(待核 / 未尽)
- ISO 25010:2023 特性更名(Usability→Interaction Capability 等)标"约",落正式版前 fetch 原文核。
- AI-eval 工具榜(RAGAS/DeepEval/TruLens 谁主流)半年级变动,标 nightly-refresh。
- AI 编码助手内部 eval 实践公开少,未深挖。
- 各 eval 平台处方有商业立场,取其三家趋同核心(已交叉印证)。
