# Track D（安全·对抗·可控）锚研究（R3 交付物）

> exa + firecrawl,2026-06-02。给 v4 Track D 接地(原标 needs-fresh-research)。

## 1. OWASP Top 10 for LLM Applications 2025 ★ Track D 主锚(维度全集)
权威清单(owasp.org PDF v2025 + genai.owasp.org + HackerOne):
| ID | 项 | 撞 Fabric? |
|---|---|---|
| LLM01 | **Prompt Injection**(直接/间接;crafted 输入改 LLM 行为,绕安全measure) | hook/skill 注入的知识可能携带间接注入 |
| LLM02 | **Sensitive Information Disclosure**(PII/凭据/源码泄漏) | KB 跨 store 泄漏(KP→KT)、context 泄漏 |
| LLM03 | Supply Chain | 依赖/模型供应链 |
| LLM04 | Data & Model Poisoning | KB 投毒(恶意知识进库) |
| LLM05 | Improper Output Handling | 输出未审 |
| LLM06 | **Excessive Agency**(2025 因 agentic 扩写:unchecked permissions→risky actions;根因=过度功能/权限/自主) | **MCP 工具越权高危命令** |
| LLM07 | **System Prompt Leakage**(2025 新增) | hook/skill 注入内容泄漏系统 prompt |
| LLM08 | **Vector and Embedding Weaknesses** | **Fabric 向量搜索直接命中** |
| LLM09 | Misinformation | 错误知识被 surface |
| LLM10 | **Unbounded Consumption**(= 成本/资源失控) | **死循环刷爆 token / loop 失控** |
- 源:owasp.org/www-project-top-10-for-large-language-model-applications · genai.owasp.org/llm-top-10 · hackerone.com/blog/owasp-top-10-llms-2025

## 2. LLM/agent 红队(对抗测试方法)
- 定义:**系统性用对抗输入探 AI 系统,在攻击者之前发现漏洞**。= Track D 的发现手段(对抗注入矩阵)。
- 工具/方法:**promptfoo**(开源 red-team,模拟对抗输入)· **DeepTeam**(Confident AI)· generalanalysis · Galileo "8 red-teaming strategies"。
- 源:promptfoo.dev/docs/red-team · trydeepteam.com/docs/what-is-llm-red-teaming · galileo.ai/blog/llm-red-teaming-strategies

## 3. 成本/可控(LLM10 落地)
- "$30K agent loop"/"Infinite Loop of Death":微妙歧义致死循环,6 小时刷 1500 万 token。92% 公司报 agent 成本超预期。
- 防护(code-level patterns,须设计期内建非事后):**per-run token/cost budget · step limits(步数上限)· semantic similarity 检测循环 · financial circuit breakers(熔断)· model routing/approval flows**。
- 源:cloudatler.com/blog/the-50-000-loop · medium Cost Guardrails for Agent Fleets · blogs.oracle.com AI agent loop

## 对 v4 Track D 的接地结论
Track D 三支柱锚定:
- **安全/对抗** ← OWASP LLM Top10(尤 LLM01 注入/LLM02+07 泄漏/LLM06 越权/LLM08 向量弱点/LLM04 投毒)+ 红队对抗注入矩阵(promptfoo/DeepTeam)。
- **成本/可控** ← LLM10 Unbounded Consumption + budget/step-limit/loop-detect/circuit-breaker。
- **优雅降级** ← 对抗性输入下温和失败(与 Track A 环境故障注入互补)。
- **Fabric 特异高危**:LLM08 向量弱点 + LLM02/07 跨 store KB 泄漏 + LLM06 MCP 越权 —— 三个该优先红队。

## 诚实标
- 红队工具(promptfoo/DeepTeam)有产品立场,但方法(对抗注入)是领域共识。
- OWASP LLM Top10 2025 为权威,版本稳定(v1.x→2025),可放心锚。
