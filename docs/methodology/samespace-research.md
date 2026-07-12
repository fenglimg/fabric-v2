# 同空间产品实测调研（R2 交付物，产品 > 文章）

> exa + firecrawl,2026-06-02。聚焦"Fabric 同空间产品真在用什么测",每条带 URL。
> Fabric = 跨客户端 AI 知识/记忆层 → 最直接同空间 = **AI 记忆层(mem0/Letta/Zep)** + **agent/skill eval 平台(LangSmith/Braintrust/Langfuse)** + **MCP 工具测试**。

---

## A. AI 记忆/知识层(mem0 / Letta / Zep)★ 与 Fabric 最同构

### mem0 的记忆评估方法(docs + arXiv 2504.19413 + GitHub evaluation)
- **三阶段 pipeline = Ingest → Search → Evaluate**:① 对话切块加进记忆,抽事实/embed/建实体链 ② 每问查询,**用 semantic similarity + BM25 + entity boost 打分**(⚠️ Fabric 也是 BM25,直接同构)③ LLM 从检索记忆生成答案 → judge LLM 对 ground truth 打分。
- **指标五件套**:BLEU / F1 / **LLM-judge 二元分(0/1)** / **Token 消耗** / **Latency**。
- **★ 评记忆 = 三参数同时:accuracy(基准分)× cost(tokens/query)× performance(latency)。"平衡这三个在规模下才是真问题。"** 且必须 **equal constraints 比较**(同检索预算/同模型/同延迟预算),否则"frontier 模型满召回 vs 生产小模型现实召回"不可比。**"token 效率和 accuracy 一样重要 —— 报 accuracy 时必须并报 mean tokens/query"**。
- **established 记忆基准**:**LoCoMo**(~300q:single-hop/multi-hop/temporal/open-domain)· **LongMemEval**(500q,6 类)· **BEAM**(100K–10M token,10 种记忆能力)。
- 源:docs.mem0.ai/core-concepts/memory-evaluation · arxiv.org/html/2504.19413 · github.com/mem0ai/mem0/tree/main/evaluation · github.com/mem0ai/memory-benchmarks
- **对 Fabric/v3 可借**:① recall 效能别只看"召没召中",按 **accuracy×cost(token)×latency 三联 + equal-constraints** 测(直接吃掉 F-SCALE-LAT + recall efficacy)② 可建 Fabric 版"记忆基准集"(合成多会话知识 + 问答对)做回归 ③ 检索打分 semantic+BM25+entity 是同空间共识配方。

### Letta:任务级 holistic 评估
- "另一种评记忆的法 = 评 agent 在**需要记忆的具体任务**上的整体表现"(不止检索层指标,要 outcome 层)。源:letta.com/blog/benchmarking-ai-agent-memory。
- **对 Fabric**:呼应"消融/反事实" —— 测"有记忆 vs 无记忆"在真任务上的 delta。

---

## B. Eval-driven development:生产 trace → 测试用例 闭环 ★ v0-v2 最缺的操作骨架

### 共识模式(Braintrust / LangSmith / Langfuse 三家趋同)
- **最小单元 = data + task + scorers**(Braintrust)。两类 scorer:**code-based(确定性检查)+ LLM-as-judge(柔性质量)**。
- **agent 评 = 端到端 outcome + 单步(tool call/参数准确性)双层**。
- **核心循环**:生产 trace → 一键进 dataset → **offline eval 在 deploy 前跑(像单测/集成测,可复现,stub 外部依赖用生产快照)** → 过了才 ship → online 监控线上(全量打分起步,按流量调采样)→ **低分 trace 回流进 offline dataset**。"每条生产 trace 都成为一个测试用例。"
- **每次 prompt/model/workflow/架构改动都跑累积 eval 套件 → 比对版本间分数 → 证明'真变好了不只是变了'**(= 本 goal mode④ 的产品级形态)。
- 源:braintrust.dev/articles/how-to-eval · langchain.com/blog/traces-start-agent-improvement-loop · langchain.com/blog/how-we-build-evals-for-deep-agents · aws.amazon.com/blogs/.../evaluating-deep-agents-using-langsmith(融合 Anthropic "demystifying evals" + 5 eval patterns)

### LangChain Deep Agents:行为优先 eval 策展
- **"最好的 agent eval 直接测我们在意的某个 agent 行为"**:① 编目生产里 matter 的行为(如跨多文件检索、准确连排 5+ tool call)② 每 eval 配 docstring 自解释测什么 + 打 tag(如 `tool_use`)分组跑 ③ 复查 trace 理解失败模式 → 更新覆盖。pytest + GitHub Actions 在 CI 跑。

### ★ Langfuse "Evaluating AI Agent Skills" —— 几乎是 Fabric 的镜像案例
- 他们给 agent 建了个 **skill**(让 agent 会用 Langfuse:CLI 调 API、查文档、守最佳实践),问题逐字 = Fabric 的问题:**"怎么知道 agent 真的正确用了 skill?改了 skill 怎么知道是变好不是变坏?"**
- 方法:**user prompts 存成 Dataset → spin up coding agents 跑 → trace 每个 tool call/CLI/文件编辑 → 打分 → 改 skill 再跑比对**。把 skill 评估当 prompt 评估做。
- **初始指标**:每 run 的 CLI 错误数 / 成功前 retry 次数 / **agent 是否 fallback 到 curl 或干脆 SKIP 了 skill**;再上 LLM-judge 判语义正确性。
- **★ 金句:"魔鬼在细节 —— 一个注释把 'mandatory' 写成 'optional' 就导致每个测试用例一致失败。"** —— 精确命中 Fabric 的 **F-SKILL-PROGRESSIVE(skill 可遵循性)+ cite policy 措辞** 问题!
- OpenAI 对 Codex skills 用类似环:**JSONL traces + deterministic graders**。
- 源:langfuse.com/blog/2026-02-26-evaluate-ai-agent-skills
- **对 Fabric/v3**:Track C 测 hook/skill 的现成配方 = prompt dataset → 真 agent 跑 → trace(skip 率/fallback/retry)+ LLM-judge。这就是"交互轴"做实的产品级标准做法。

---

## C. MCP 工具测试(Fabric 6 MCP tool 直接相关)
- **MCP Inspector**(官方 modelcontextprotocol/inspector):可视化测试 —— 连服务器、发现全部 tools/resources、逐个 invoke。建议"基础字段存在性检查在 client,深校验交给 server"。
- **"测 MCP tools/resources 跟 API 测试一样"**(client 拉 meta + tool/resource 定义)。
- 三层测试金字塔 for MCP apps(medium 指南);MCP 官方 Security Best Practices 文档(攻击向量/最佳实践)。
- 源:github.com/modelcontextprotocol/inspector · modelcontextprotocol.io/docs/tutorials/security/security_best_practices · testomat.io/blog/mcp-server-testing-tools

## D. AI 编码助手(Cursor/Cody/Continue)— 信号较弱
- 多为选型对比文(企业 pilot 指标/安全合规 SOC2),Sourcegraph "anatomy of a coding assistant" 强调 **context retrieval 质量**是核心。深度 eval 实践不如 A/B 富。源:sourcegraph.com/blog/anatomy-of-a-coding-assistant · scrimba 2026 对比。

---

## 同空间相对第一层主流,新增了什么(genuinely new)

1. **eval-driven dev 闭环(B)= v0-v2 最缺的操作骨架**:trace→test-case→offline+online→regression。v0-v2 是一次性发现,不是持续 trace→eval→回归。**这本身就是本 goal mode④ 的产品级实例。**
2. **记忆效能三联 accuracy×cost(token)×latency + equal-constraints(A/mem0)**:比 ISO/RAGAS 更具体到"记忆/知识层"该怎么量效能,直接吃 F-SCALE-LAT + recall efficacy。
3. **skill/hook 评估 = dataset×真agent×trace×(skip/fallback/retry + LLM-judge)(B/Langfuse)**:Fabric"交互轴"的现成落地配方 + "optional/mandatory 措辞致全败"实证。
4. **established 记忆基准(LoCoMo/LongMemEval/BEAM)**:Fabric 可锚或建同构基准集。
5. **MCP Inspector + 像 API 测 MCP(C)**:Fabric MCP tool 的现成工具。

## 诚实标
- AI 编码助手(Cursor/Cody)内部 eval 实践公开少,本轮信号弱,未深挖。
- 各 eval 平台(Braintrust/LangSmith/Langfuse)有商业立场,其"处方"偏向自家产品,但三家趋同的核心循环可信(交叉印证)。
- mem0 数据来自其自家 benchmark(有利益),但方法论(三参数/equal-constraints/三基准)是领域共识,可借。
