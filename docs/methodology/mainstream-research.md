# 主流测试框架 census + 与本方法论比对（R1 研究交付物）

> 多源:exa + firecrawl,2026-06-02。关键 claim ≥1 权威源(多数 ≥2)。AI 测试块标时效(快变)。

---

## 第一层:经典 QA 地基(几十年稳定)

### 1. ISO/IEC 25010 质量模型 ★ 最该锚的「维度全集」
- **产品质量模型 = 8 特性(2011)/ 9 特性(2023 版,新增 Safety + 部分更名如 Usability→Interaction Capability、Portability→Flexibility)**:功能适用性 / 可靠性 / 性能效率 / 易用性 / 安全性 / 兼容性 / 可维护性 / 可移植性。每特性下共 31 子特性。
- **"功能适用性"三子特性 = 用户三痛的标准答案**:
  - Functional **Completeness**(功能完备性)= "覆盖所有该有的任务/功能没?" = 用户的**漏没漏**
  - Functional **Correctness**(功能正确性)= "结果对、精度够?" = 用户的**对不对**
  - Functional **Appropriateness**(功能适宜性)= "功能真帮用户达成目标?" = 用户的**有没有用/效能**
- **另有「使用质量模型」5 特性**(有效性/效率/满意度/风险规避/上下文覆盖)—— 这是"产品在真实使用中是否交付价值"的 outcome 模型,正对"效能赛道"。
- 源:iso.org/standard/35733.html · iso.org OBP 全文 · perforce.com/blog/qac/what-is-iso-25010 · helpware.com(2025) · webstore.iec.ch/en/publication/90024(2023 版 9 特性)
- **意义**:用户怕"tag 太多/漏维度" → 锚到这 8-9 特性 + 子特性,**维度集封顶可判完备**,不用自创也不会漏面。

### 2. 测试象限（Marick / Crispin & Gregory《Agile Testing》)— 「立场」结构
- 2×2:业务面 vs 技术面 × 支撑开发 vs 批判产品。本方法论 = **Q3/Q4(批判产品 critique)**:Q3 探索/可用性/UAT,Q4 性能/安全/-ility。
- 意义:确认"缺陷发现"是有正式名分的一类,合法,不野。(经典稳定,知识层,未单独 fetch)

### 3. 测试金字塔 / Testing Trophy(Cohn / Kent C. Dodds)— 「层级」结构
- unit→integration→e2e(Trophy 加 static、重 integration)。这是"测试套件架构",本方法论不在这条(它是评审不是建套件),知道即可。

### 4. 探索式测试 / 上下文驱动学派(Kaner, **Bach**, Bolton)★ 「漏功能点」的主流解
- **核心信条**:"好测试必须有 thinking human 在 loop 里掌舵;测试永远证明不了产品 works"——**= 用户'收敛≠正确、frame 须 human 挑战'的独立重发现**。
- **HTSM(Heuristic Test Strategy Model v6.3, Bach 2024)** 四焦点区:Project Environment / **Product Elements=SFDIPOT**(Structure/Function/Data/Interfaces/Platform/Operations/Time) / Quality Criteria / **9 General Test Techniques**。
- 9 技法里直接命中本方法论的:**Claims Testing「verify every claim」(= declared-vs-impl + doc-vs-code,即"承诺证伪")** · Flow Testing(端到端连跑、不 reset、tours) · Scenario · Stress · Domain · Risk · User · Function · Automatic Checking。
- **omission 靠"撞墙"非"清点"**:survey/exploratory testing 先建产品心智模型,边用边撞出"咦怎么没有 X"。Whittaker《Tours》("money/landmark/back-alley tour"不同游览路线穿产品)。
- 源:satisfice.com/download/heuristic-test-strategy-model · satisfice.com/exploratory-testing · developsense.com/resource/htsm.pdf · et-dynamics3.pdf

### 5. 风险驱动测试(ISTQB codified)★ 「tag 爆炸」的主流解
- 不均匀测,按 风险=可能性×影响 加权,高风险深测、低风险采样、**明写没测哪些**。多域项目(服务端/客户端/cli/AI/向量)本就该这么切,而非追"100% census"(后者给 false confidence)。

### 6. 架构 fitness functions(Neal Ford《Building Evolutionary Architectures》)★ 「空壳/属性」检测的主流名
- 定义:"对某架构特性的客观完整性评估",是"domain 部分的单元测试的架构等价物"。机制 = tests/metrics/monitoring/logging。类别:triggered vs continual、atomic vs holistic、system-wide。
- **= 用户 round-trip / producer-consumer / "属性 over 功能点"的正式名字**。用法:① 选维度 ② 定 fitness function ③ 部署流水线持续验。
- 源:nealford.com/books/buildingevolutionaryarchitectures.html · oreilly ch02 · thoughtworks PDF
- 旁系:Property-based testing(QuickCheck 谱系,"属性非样例")· Metamorphic testing(无 oracle 时用"变换关系",F-NARROW-BUDGET 的生成式版:加无关 doc 不该挤掉精确匹配)。

---

## 第二层:AI/LLM 系统测试(★ 快变,2024-2026,用户"AI 内功能+向量搜索"专属)

### 7. Evals 范式 + LLM-as-a-judge
- **不是单一指标,是技术**:用 LLM + 评测 prompt 按你定的 criteria 给生成文本打分;两法 = **pairwise 比较 / direct 单输出打分**;offline(开发回归)+ online(线上监控)双用。
- 2025 实践:别用 1-10 标度(用离散档/pairwise)、先人工标注再写 judge、慎选 judge 模型。
- **多层 eval**:程序化指标(快)+ LLM-judge(柔性)+ 人工(锚)。
- 源:evidentlyai.com/llm-guide/llm-as-a-judge · arize.com/llm-as-a-judge · galileo.ai · reddit r/LangChain 2025 · ScienceDirect "survey on LLM-as-a-judge"

### 8. RAG / 检索评估(★ 用户向量搜索效能的现成度量,别自搓)
- **拆 retriever vs generator 两段各自度量**:
  - 检索:Contextual **Relevance** / **Recall** / **Precision**(精确度看相关 node 是否排更高 —— 正是 F-NARROW-BUDGET 那类排序问题的标准指标)
  - 生成:**Faithfulness/Groundedness**(输出是否忠于检索上下文,即防幻觉)/ **Answer Relevancy**
- **RAG triad = 无参考版**(context relevance + groundedness + answer relevance),不需要标准答案,适合上线。
- 工具:**RAGAS**(faithfulness/answer-rel/context-precision/context-recall)、**DeepEval**、**TruLens**(RAG triad)、Deepchecks、Evidently。
- 源:atamel.dev(2025,概念清晰)· deepeval.com/blog/deepeval-vs-ragas · deepchecks.com · zilliz top-10

### 9. AI agent / agentic 评估(★ 用户 hook/skill/mcp"AI 内行为"专属)
- **超越"最终输出对不对",评 trajectory(轨迹)**:从 agent 轨迹抽 tool 使用 → 对 **golden labels** 比;评 multi-step 行为 / tool orchestration / 规划 / 反思 / 反复。
- 平台:Vertex Gen AI eval(output + trajectory)、Galileo(agent leaderboard)、Arize(tool-use/planning/reflection 模板)。arXiv 2025 agentic AI 评估框架。
- **= 把"agent-in-the-loop 交互轴"做实的现成范式**;Fabric"知识是否改 agent 行为"正落这里。
- 旁系:CheckList(Ribeiro ACL2020,行为测试 MFT/INV/DIR)= 行为型 rubric 的学术锚。

---

## 第三层:本方法论(v0-v2)在地图上的定位

| 本方法论的东西 | 主流对应 | 判定 |
|---|---|---|
| 4 oracle(producer-consumer/declared-vs-impl/doc-vs-code/invariant) | HTSM 技法子集(尤 **Claims Testing**)+ fitness functions | **对,且操作化好** |
| round-trip / 空壳检测 / 属性 over 功能点 | **架构 fitness functions** | **主流成熟概念,有正式名** |
| frame 挑战 / 收敛≠正确 / 只有 human 掀 frame | **context-driven testing 认识论**(Bach/Kaner) | **独立重发现高级思想,夸** |
| census→narrow(偏枚举) | 风险驱动 + 探索式(但主流靠探索,你靠枚举) | **方向对,手段偏** |
| 三轴(深/广/交互)自创 | 部分撞 ISO25010 + 测试象限 | **重复造轮(可锚替代)** |
| "效能"靠交互轴勉强带 | ISO **Appropriateness** + 使用质量模型 + RAGAS/agent-eval | **最大缺口** |
| 漏做检测 | 探索式 + ISO **Completeness** + 需求覆盖 | **最弱(枚举做不到完备)** |

**元结论:用户直觉对齐主流"高级/成熟端"(context-driven + fitness-function + exploratory),不 low。三个真缺口 = ① 没锚 ISO25010 当维度全集 ② 没把探索式当主力遗漏发现器(过度依赖枚举 census)③ 没用 AI-eval 栈(RAGAS/agent-trajectory)测 AI 功能与向量效能。修法 = 用户自己 v2§7"锚外部框架"律,插锚而非自创。**

---

## v3 骨架建议:三赛道,各锚主流

> v0-v2 不废,降为「Track A 正确性」的方法论(回测达标)。

- **Track A 正确性(对不对/有没有接线)** ←锚→ HTSM 9 技法 + **fitness functions**(把 round-trip/4-oracle 正名为 fitness function,持续在流水线跑)。ISO: Functional Correctness。
- **Track B 完备性(漏没漏)** ←锚→ ISO Functional **Completeness** + **探索式(HTSM SFDIPOT tours + Claims Testing)当主力遗漏发现器** + 外部 spec anti-join(带 drift 甄别)+ **风险加权**(治 tag 爆炸:不追 100%,按风险深/采样,明写没测的)。omission 自顶向下靠撞墙,不靠清点。
- **Track C 效能(有没有用)** ←锚→ ISO Functional **Appropriateness** + 使用质量模型 + **消融/反事实**(拔了无变化=空壳或无用)+ **AI-eval 栈**:LLM-as-judge(策略遵守如 cite)、**RAG triad / 检索三指标(向量搜索)**、**agent trajectory eval(hook/skill/mcp 行为)**。
- **横切**:fitness-function 化(属性 over 功能点)· 风险加权 · context-driven frame 挑战(human,可审计 artifact)· no-silent-caps(诚实标没测的)。

---

## 诚实标(未尽/待核)
- 测试象限、金字塔、CheckList、property/metamorphic 来自稳定知识层,本轮未逐一 fetch 原文(经典不易错;如需引用级精确可再 fetch)。
- ISO 25010 2023 版的特性更名(Usability→Interaction Capability 等)我标了"约",精确清单建议 fetch iso 25010:2023 原文再定稿。
- AI-eval 工具榜单(RAGAS/DeepEval/TruLens 谁最主流)半年内会变;落 v3 时这块标 nightly-refresh。
- **未做同空间产品实测调研**(dev-tool / AI 知识层产品真在用啥测)——这是 census 还缺的一块,值得补一轮(符合用户 [[同空间产品>文章]] 偏好)。
