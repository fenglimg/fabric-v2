# 全面测试方法论 v6（四赛道 × 认识论轴 · 主流锚 · eval-driven 操作骨架）

> v5→v6 变更(human frame-challenge:"能掀=没收敛"):**+认识论轴(Part 0.5)** —— v5 整套是"基于内部 oracle 的 examination",对两类问题结构性失明:oracle-缺席(只有现实能发现)+ oracle-本身错(intent 自己是 bug)。补三 epistemology:①检视[现 v5] ②现实暴露(canary/chaos/bug-bounty/dogfood)③intent 拷问(证伪需求本身),与四赛道正交。+ **收敛判据重定义**(Part IV):从"掀不动"改为"剩余掀不再 material"(frame 无限可掀=Gödel/agy 无穷回归,"掀不动"永不发生)。

> v4→v5 变更(Round 5 多-LLM quorum,均 refinement 级=收敛区):Track D 补全 OWASP(+LLM03 供应链/+LLM09 幻觉/+compliance 注)· Track A 加异步/事件 round-trip(correlation-ID)+ "合成数据合法性"caveat(防自造假绿)· Part IV 诚实纳入方法论自身 3 元风险(agy frame-challenge)。其余单票(fixture 抽样规则/可评价性阈值/沙箱回滚/词意漂移)按 anti-bloat 标"执行期/项目特定",不进骨架。

> 目的:对一个多域软件项目(尤含 AI-in-use 功能的)做"全面测试/审计",系统暴露所有有嫌疑的问题:已知 / 疑似 / 可疑 / 做了没接入(空壳) / 漏做 / 做了但没用(效能死) / **做了坏事或失控(安全·成本·可控)**。
> v3→v4 变更(Round 4 多-LLM quorum + human frame-challenge):**+Track D 安全/对抗/可控**(human 拍板,gemini+agy)· 恢复 Phase 0 历史 census(D1 回归修)· Track C 去 Fabric 硬编码(抽通用元模型)· 锚精度校正(ISO/fitness-function 各归各位)· Track C 加冷启动 fallback + 验收阈值 · 新增"不可评价"finding 类。
> 文档融合 = 用户原创方法论(Track A+横切)⊕ 主流锚(R1 经典 + R2 同空间),见 §附录。

---

## 0. 纲领:全面 = 四个不同问题,四种认识论,别塞一个 loop

| 赛道 | 回答 | 认识论 | 主流锚 |
|---|---|---|---|
| **A 正确性** | 有没有 / 对不对 / 接没接线 | bottom-up 偏差检测 | HTSM 技法 · 集成/契约测试 · 结构断言=fitness functions · ISO Correctness |
| **B 完备性** | **漏没漏** | **top-down**,撞墙发现非清点 | 探索式/HTSM SFDIPOT+tours · ISO Completeness · 风险驱动 |
| **C 效能** | **做了到底有没有用** | 反事实 / outcome 度量 | ISO Appropriateness · 使用质量模型 · Performance Efficiency · 消融 · AI-eval(RAGAS/agent-trajectory/LLM-judge) |
| **D 安全·可控** ★v4 | **会不会做坏事 / 失控** | **逆向防御 / 对抗**(与 A/B/C 的"正向 does-it-work"相反) | OWASP LLM Top10 · Guardrails · token/loop budgeting · ISO Security/Safety |

> A/B/C = "做对的事";D = "别做坏事 + 别失控"。认识论相反故单列(否则被正向视角结构性遗漏)。

---

## Part 0.5. 认识论轴：发现问题的三种 oracle 来源（v6 新增,与四赛道正交）★

> 四赛道是"测什么";认识论轴是"**靠谁当 oracle 去发现**"。每个赛道都可经三种 epistemology 跑。v5 只做了第一种 → 对另两类问题结构性失明。

| 认识论 | oracle 是谁 | 抓什么(其他模式抓不到的) | 落地手段 |
|---|---|---|---|
| **① 检视 Examination**(现 v5 全部) | **内部参照**(代码/spec/doc/ISO/OWASP) | oracle 可校验的偏差/空壳/漏做 | 四赛道全套 oracle/round-trip/red-team-by-us/eval-loop |
| **② 现实暴露 Reality**(v6 补) | **世界**(时间×规模×真对手×真用户) | **没人想象得到的未知未知** | 灰度/canary · chaos engineering · 外部 bug bounty/真红队 · 真用户 dogfood · prod A/B · 线上 trace 主动挖(非被动监控) |
| **③ intent 拷问 Intent-interrogation**(v6 补) | **质疑参照本身** | **"正确地实现了错的 intent"/伪需求/根本不该存在的功能** | 证伪 spec/goal/需求本身(非 code-vs-spec) · 问"删了这功能有人真受影响吗" · 真实用户问题 vs 假想问题 |

**为什么必须补(自指证据)**:本方法论自己的诞生史 = examination(v0-v2 多-LLM 冷评)快 2 轮 dry 了,但最大跃迁(三赛道/主流接地/Track D)**全部来自 human 掀 frame(外部 intent oracle)**,无一来自 examination。→ 证明 examination 有天花板,真 oracle 常在系统外。v5 把这写成收敛闸门(Part IV),v6 把它升为**贯穿全程的发现支柱**。

**与四赛道的关系**:正交。例 —— Track C 效能可经 ①检视(消融) / ②现实(prod A/B 真用户留存) / ③intent(这"价值"用户真要吗) 三路验;Track D 安全可经 ①(我们红队) / ②(外部 bug bounty 真攻击) / ③(这权限设计的前提对吗)。**②③ 尤其无法用 ① 替代** —— 内部 oracle 照不到"现实才知道"和"参照本身错"。

**与 Track C appropriateness 区分**:Track C 问"有没有交付**既定**价值";③intent 拷问问"**既定价值本身**对不对"。一个信参照,一个拷打参照。

---

## Part I. 组织原则:「质量维度 × 风险」替代「功能点枚举」(治 tag 爆炸)

不按技术 surface 打 tag(服务端/cli/mcp/向量…组合爆炸)。两条稳定轴:
1. **维度锚 ISO 25010**(8-9 特性+31 子特性:功能适用性/可靠性/性能效率/易用性/安全性/兼容性/可维护性/可移植性,2023+Safety)。维度集**封顶可判完备**。⚠️ 四赛道是"对每个维度问的问题",维度是"问哪些面" —— 二者正交:对每个 ISO 维度都可问 A/B/C/D 四问。
2. **风险加权**:`风险 = 爆炸半径 × 改动频率 × 历史缺陷密度 × 用户可见度`。高风险深测、低风险采样,**明写没测的(no-silent-caps)**,不追假 100% census。

→ 技术 surface 退化为实现细节;测试在 (ISO 维度 × 风险) 网格上跑。

---

## Phase 0. 历史先验 census（任何赛道发现前的第 0 步）★ v4 恢复(D1 回归修)

> v3 误删,v4 恢复并强化(3/3 冷评一致指出)。

发现 loop 第 0 步 = **主动消费项目已有知识**:issue tracker / changelog / commit log / KB / 已知 pitfalls / postmortem。
- **(a)** 已知 confirmed/refuted → **直接转成 backtest anchors**(别重新发现;验"仍在/已修/regression";refuted 别复活)。
- **(b)** 历史 pitfall 模式 **制导 Track A 漏洞挖掘**(高缺陷密度区优先深挖),不只当 Part I 风险排序的一个因子。
- 缺这步 = 对"只能从历史上下文浮出"的 known issue 结构性失明 + 浪费 token 通用探索撞不上业务特有深层逻辑错。

---

## Part II. 四赛道细则

### Track A — 正确性
- **四 oracle**:producer-consumer(写了没人读/读了没人写/回路不通)· declared-vs-impl · doc-vs-code(=HTSM Claims Testing)· invariant。
- **锚归位(v4 校正,agy)**:
  - **结构性断言**(consumer=0 / 依赖方向 / 分层禁忌)= 真正的**架构 fitness function**(Ford),轻量、CI 持续跑。
  - **数据流 round-trip**(写进去读出来)= **端到端集成/契约测试**(非 fitness function;别混进轻量架构断言致 CI 膨胀)。两者都要,但各归各名。
- **Round-trip = 契约级等价**:① 连通(造触发数据走缝)② 保真(字段无静默丢/类型不降)③ 新鲜(非陈旧 cache)④ 双向无悬空 ⑤ 追终端副作用(黑洞假消费者=空壳)⑥ facet 坍缩。
- **★ 异步/事件链路(v5,2/3 quorum)**:多 store 异步同步/事件队列/pub-sub/多 agent 并发链路下,静态 `consumer=0` 会在最终一致性窗口内误报/漏报 → 用 **correlation-ID / event-tracing** 关联上下文断言端到端送达,不可只凭静态引用判接线。
- **★ 合成数据合法性 caveat(v5,防自造假绿)**:"造触发数据走缝"的数据须**领域真实/代表性分布**,不是"为通而造" —— 不合规的合成脚手架数据会让 round-trip 自己产生 scaffolding 假绿(我们核心机制的反噬)。造的数据本身要过"像不像真生产数据"这关。
- **判空壳前三道排除(精确率核心)**:gated+fallback(切 enabled 再测)/ runtime-empty vs structural-hollow(造数据能通=非空壳)/ dead-code≠hollow。
- **搜索边界**:跨 .cjs/模板/动态注册/客户端资产;静态 grep 动态盲区 → 降级 runtime trace。
- **注入矩阵**(invariant 可执行化):文件损坏/缺失/offline/locale/规模阶梯/并发/权限,各 ≥1 次 + teardown 防状态泄漏。
- MCP 工具:MCP Inspector 逐 tool invoke;像 API 测试一样测。

### Track B — 完备性(漏没漏:top-down,撞墙非清点)
- **探索式当主力遗漏发现器**:带 persona,SFDIPOT survey + tours(money/landmark/back-alley),"想达成某价值却撞墙"处记遗漏。
- **三路 census 补枚举(但不依赖它判完备)**:code-resident grep 全集 · **外部 spec anti-join + drift 甄别**(代码 ⟕ PRD/issue,命中先归一化源 status[active/deprecated/waived]+staleness+ownership,只 active 算候选)· **无-spec baseline checklist**(隐式/平台级漏做兜底)。

### Track C — 效能(做了有没有用)
> **锚归位(v4 校正,3/3)**:Track C 跨多个锚,各有适用边界,不只 ISO Appropriateness:
> - ISO **Functional Appropriateness** = 功能设计是否适配目标(静态 capability-to-goal)
> - ISO **使用质量模型(Quality-in-Use)** = 真实使用中 effectiveness/efficiency/satisfaction(动态 outcome)
> - ISO **Performance Efficiency** = 资源/时间/容量(成本侧)
> - **RAGAS** 锚检索、**agent-trajectory** 锚交互过程、**holistic outcome** 锚任务价值、**消融** 锚"价值是否存在" —— **四者不互相替代**。

- **消融/反事实(最强单招,一击杀"空壳"+"无用")**:拔掉功能看可观测后果是否变化;**拔了什么都没变 = 空壳或无用**。
- **检索/记忆效能三联**:accuracy × cost(mean tokens/query)× latency,**equal-constraints**(同检索预算/模型/延迟)比较。
- **AI 行为 eval(交互轴)**:prompt dataset → 真 agent 跑 → trace(tool call/CLI/编辑)→ 指标 skip率/fallback率/retry/策略遵循率(如 cite)→ LLM-as-judge 判非确定性。教训:关键措辞(optional vs mandatory)本身是被测对象。
- **★ 通用元模型(v4 去 Fabric 硬编码,2/3)**:消融与基准建立在抽象组件元模型上 —— **Plugin/Action · Knowledge/Memory · Policy/Rule · Hook/Trigger**,不绑特定项目。
  - *(示例,非绑定:Fabric 的 hook/skill/KB 条目逐个消融;建合成"记忆基准集"仿 LoCoMo/LongMemEval 做回归。)*
- **★ 冷启动 fallback + 验收阈值(v4,2/3)**:
  - Track C 多依赖 trace/dataset/eval 基建。**基建不存在时的 fallback**:先跑消融(不需基建,只需能开关功能)+ 手工小样本 LLM-judge;同时把"缺基建"登记为 Track-D/可评价性 finding(见下)。
  - 每效能 finding 须带**验收阈值**(如检索 recall 下限 / cite 遵循率下限 / token 上限)+ **最小 efficacy fixture 集**(第一遍冷跑必须覆盖的代表场景),否则"能抓但判不了"。

### Track D — 安全·对抗·可控 ★ v4 新增(human 拍板;认识论 = 逆向防御;R3 已接地)
> 与 A/B/C 相反:不是"功能做对没",是"**会不会做坏事 / 失控**"。主锚 = **OWASP Top 10 for LLM Applications 2025**(维度全集)+ 红队(发现手段)+ budgeting(成本可控)。
- **安全/对抗 ← OWASP LLM Top10 全 10 项(对每项问"本系统中招没")**:LLM01 Prompt Injection(直接/间接,注入的知识可携带间接注入)· LLM02 Sensitive Info Disclosure · LLM03 **Supply Chain**(★v5 补:第三方 MCP server/远程 skill/配置模板/远程 KG 投毒污染,高度插件化应用重灾)· LLM04 Data/Model Poisoning(恶意知识进库)· LLM05 Improper Output Handling · LLM06 **Excessive Agency**(工具越权高危命令,agentic 重灾)· LLM07 System Prompt Leakage(context/跨 store KB 泄漏)· LLM08 **Vector & Embedding Weaknesses**(向量搜索特有)· LLM09 **Misinformation**(★v5 补:多步推理幻觉/偏误污染下游决策)· LLM10 Unbounded Consumption(见下成本)。
  - 发现手段 = **红队/对抗注入矩阵**(promptfoo / DeepTeam 等系统性对抗输入),非 Track A"权限注入"能穷尽的 AI 攻击面。
  - **★ compliance/privacy/data-governance(v5,codex)**:数据生命周期的合规/隐私治理(非攻击型责任)单列子镜头,别全塞进 Security;借 LLM02 但超出之。
- **成本/可控 ← OWASP LLM10 Unbounded Consumption**:微妙歧义致死循环刷爆额度("$30K agent loop")→ 内建(非事后)**per-run token/cost budget · step limits · 语义相似度检测循环 · 熔断 circuit breaker**。
- **优雅降级**:对抗性输入/依赖宕机下温和失败而非 crash(与 Track A 环境故障注入互补,视角是"对抗"非"环境")。
- **元模型适用裁剪**:非 AI 项目退化为经典 OWASP Web Top10 + 资源治理;AI 项目按上表。
- *(Fabric 特异高危优先红队:LLM08 向量弱点 · LLM02/07 跨 store KB 泄漏[KP→KT 拓扑] · LLM06 MCP 越权。)*

---

## Part III. 操作骨架:eval-driven 闭环

- **最小单元 = data + task + scorers**(code-based 确定性 + LLM-as-judge 柔性)。AI 功能评 = 端到端 outcome + 单步(tool call/参数)双层。
- **闭环**:trace 全程记录 → 失败 trace 进 dataset → 转可复现 offline eval(像单测,stub 外部依赖用快照)→ **每次改动 deploy 前跑累积套件比对版本分(证明"真变好不只是变了")** → online 监控(全量起步按流量采样)→ 低分 trace 回流 → 过 eval 进永久回归套件。
- **★ 可评价性(observability/testability)= 一等 finding 类(v4 新增,2/3)**:"产不出证据所以没法判"本身是**可报告问题**,不只是前置条件。无 trace/无埋点/无法注入 → 登记 finding(severity 按被遮蔽风险),触发"先补埋点(T2)"。否则效能/安全审计卡在"无法判断"被静默跳过。

---

## Part IV. 横切纪律

- **frame-challenge(human,不可机械化)**:多-LLM/critic 收敛 = frame 内自洽 ≠ 正确。收敛前必过 human 掀 frame(对着**边界暴露 artifact**=未审目录/skip/未触发 surface/未覆盖 persona;**该 artifact 应自动编译**:静态零消费者 + 动态未访问分支 + 未覆盖 spec status 实体,降噪给 human,否则退化形式主义[agy])。留可审计输出;fail → 回流重跑。agent 自生成清单有二阶盲区故必须真 human。
- **verify-before-trust**:候选≠finding,deterministic verify 先;refuted 进 refuted-ledger 留痕;LIBERAL capture 弱信号先记 unverified。
- **统一收口律**:critic 找"再来一个 instance" → 吸收为生成式 pattern 非更多 instance(深度=anchor / 广度=census / 交互=rubric+外部框架 / round-trip=契约等价原则)。
- **非确定性失败统计严谨**:L-LLM 概率失效须 最小样本量+阈值+promoted/refuted 规则,跨执行者可复现。
- **anti-bloat / 可移植**:行为型不编码漂移签名;锚通用框架,声明源是项目 data;**项目专有概念只作示例不进骨架**(用元模型);执行期工具链自举探针(探 build/test/mock 方式)。
  - **执行期/项目特定(不进骨架,v5)**:fixture 自动抽样规则 · 可评价性 finding 的 severity/阻断阈值 · 有状态注入的沙箱隔离/事务回滚 · 多源 spec 真理源裁定 + 词意漂移对齐 —— 这些是执行期按项目定的参数,硬编进方法论=bloat,故只点名留给落地。
- **收敛(v6 重定义)**:frame **原理上无限可掀**(Gödel 式 / agy 无穷回归)—— 故"掀不动了"**永不发生**,不能当收敛判据。真判据 = **三层与门**:① 连续 2 轮无新 distinct confirmed(frame 内 dry)② human frame 挑战:**剩余能掀的层是否 material**(改不改变你接下来真会做的事)③ material 的掀已吸收。**当下一掀只剩 immaterial 哲学层(谁定义"问题"/认识论的认识论)→ 判收敛**,取最优 incumbent。否则跑满预算兜底。
  - 锚:material = 会改变测试动作/优先级/资源 的掀;immaterial = 掀得开但不改变明天做什么。把"还能不能掀"换成"剩余掀重不重要"。

---

## Part V. 方法论自身的元风险与极限（v5 诚实纳入,agy frame-challenge;不假装解决,只命名 + 按比例应对）

> 测试方法论也是个系统,也受自己的 oracle 约束。三条已知元风险:

1. **复杂度倒挂 / "谁测试测试本身"**:重测试基建(消融+dataset+trace+红队+LLM-judge)可能比业务本体还复杂,且本身是非确定性系统 —— LLM-judge 会被 prompt 注入,消融脚本会 excessive agency。**应对(非求解,无穷回归不可根除)**:① 把测试基建本身纳入 Track A/D 范围(meta-apply:judge 要有自己的校准集,harness 要有自己的权限边界)② 基建复杂度**按风险按比例**,低风险区别上重基建(呼应 Part I 风险加权)。
2. **规约论 vs 涌现智能**:刚性 oracle(round-trip 契约/invariant)的认识论是确定性"规约论";agent 的价值在自适应/涌现。**应对**:区分**must-hold 不变量**(刚性扣死,如"不越权""不泄漏")与**涌现行为**(只测**边界/分布/outcome**,不扣死精确轨迹) —— 别把流动 agent 锁成死状态机。L-DET 走刚性,L-LLM 走统计/outcome。
3. **QA 海森堡效应(观测改变行为)**:重插桩改变 agent runtime 拓扑(上下文长度/延迟/检索分布),沙箱"安全高效"可能是温室幻觉。**应对**:① 优先**低开销观测**;② 必须验证 instrumented ≈ production(把"插桩前后行为 delta"本身当一项指标);③ 关键结论补一次**near-production 撤桩抽检**。

4. **Goodhart 反噬(方法论被当靶子优化,v6 新增)**:一旦这套方法论成了验收标准,团队会**冲着"过四赛道"建设**而非真质量(hollow-compliance:测试通过率成了目标就不再是好度量)。**应对**:保持 Track B 探索式的**不可预测性**(别把方法论 ossify 成固定 checklist)· anti-bloat 不编码可被针对的签名 · 定期 frame-challenge 变换镜头 · 用 ②现实暴露(真用户/真对手不按你的 checklist 出牌)校准 ①检视 的自满。

> 这四条不是缺陷,是测试方法论这一物种的固有上限。诚实标注 > 假装闭合(呼应 frame-challenge 律:能完全机械化闭合的就已落在 frame 内了)。

---

## 附录:锚索引(URL)
**经典(R1)**:ISO/IEC 25010(iso.org/standard/35733.html · perforce.com · iec 2023 9特性)· HTSM/探索式/context-driven(satisfice.com · developsense.com/resource/htsm.pdf)· fitness functions(nealford.com · oreilly ch02)· LLM-judge(evidentlyai.com)· RAG triad/检索三指标(atamel.dev · deepeval.com)· agent trajectory(Vertex · galileo.ai · arxiv 2512.12791)。
**同空间(R2)**:mem0 三联+基准(docs.mem0.ai/core-concepts/memory-evaluation · arxiv 2504.19413 · github mem0ai/memory-benchmarks)· Letta · eval-driven 闭环(braintrust.dev/articles/how-to-eval · langchain.com deep-agents+traces)· skill eval=Fabric 镜像(langfuse.com/blog/2026-02-26-evaluate-ai-agent-skills)· MCP(github modelcontextprotocol/inspector)。
**Track D 锚(R3 已接地)**:OWASP Top 10 for LLM Applications 2025(owasp.org/www-project-top-10-for-large-language-model-applications · genai.owasp.org/llm-top-10 · hackerone.com/blog/owasp-top-10-llms-2025)· 红队(promptfoo.dev/docs/red-team · trydeepteam.com · galileo.ai/blog/llm-red-teaming-strategies)· 成本可控(cloudatler.com/blog/the-50-000-loop · oracle AI agent loop)。详见 scratchpad/trackd-research.md。

## 诚实标(待核/未尽)
- Track D 锚 R3 已接地(OWASP LLM Top10 2025 + 红队 + budgeting);红队工具(promptfoo/DeepTeam)有产品立场,取方法共识。
- ISO 25010:2023 特性更名标"约",待 fetch 原文。
- AI-eval 工具榜半年级变,标 nightly-refresh。
- eval 平台处方有商业立场,取三家趋同核心。
