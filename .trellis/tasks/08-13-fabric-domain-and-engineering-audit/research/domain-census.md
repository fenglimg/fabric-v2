# W1 — 领域 census 与靶子攻击

检索日期:2026-08-13。检索工具:WebSearch + exa。

---

## 1. 候选全集普查

先枚举再收窄。四类候选,逐个标 in/out。

### 类别 A — Agent memory 产品(会话/用户记忆)

| 项目 | 定位 | 有无审核环节 | 跨客户端 | in/out | 理由 |
| --- | --- | --- | --- | --- | --- |
| **Mem0** | 抽取事实存向量库,按 scope(会话/session/user/org)分层并自动提升 | 无人工审核,自动提升 | 库形态,任何 runtime | **out** | 存"agent 经历过什么",非"团队审过什么" |
| **Letta (MemGPT)** | 可编辑 core-memory block + archival,agent 自管上下文 | 无 | 自托管 agent | **out** | 托管 agent 本身,与 Fabric 不是同一层 |
| **Zep / Graphiti** | 时序知识图谱,事实带有效期区间 | 无 | SDK | **out** | 时序事实追踪,无治理语义 |
| **Cognee** | graph-RAG,面向文档/实体/代码库 | 无 | SDK | **边缘 out** | 形态最接近"代码库知识",但无生命周期治理 |
| **LangMem** | LangGraph 原生长期记忆 | 无 | 绑 LangGraph | **out** | 框架绑定 |

**类别结论**:整类的共同缺口是**没有人工审核闸门**——知识自动进库。这是 Fabric 主张的差异点。但见 §3 攻击一。

### 类别 B — Rules-file 生态(AGENTS.md / CLAUDE.md 同步)

| 项目 | 定位 | in/out | 理由 |
| --- | --- | --- | --- |
| **AGENTS.md / CLAUDE.md 本体** | 静态规则文件 | **in(基线对手)** | Fabric README 明确以它为起点论证。它是"不用工具"的默认选项,也是最强的对手——因为零成本 |
| **agnix** | CLAUDE.md/AGENTS.md/SKILL.md/hooks/MCP 的 linter + LSP | **in** | 同样跨客户端,但只校验不治理 |
| **source-agents / claude-agentsmd** | AGENTS.md ↔ CLAUDE.md 同步 | **in** | 解决跨客户端漂移,不解决生命周期 |
| **Plexus** | `~/.config/plexus/` 存基线,投射到各客户端原生文件 | **in** | 与 Fabric 的 "global store → 各客户端" 拓扑高度相似 |
| **符号链接 / CI drift 检测** | 手工方案 | **in** | 零依赖,覆盖"跨客户端一致"这一条,成本几乎为零 |

**类别结论**:这一类只解决**分发一致性**,不解决**生命周期治理**。Fabric 相对它们确实多一层。

### 类别 C — MCP memory / 知识 server(最直接的赛道)

| 项目 | 定位 | 审核环节 | 采纳规模 | in/out |
| --- | --- | --- | --- | --- |
| **Basic Memory** | Markdown 知识图谱 + 语义检索,human/AI 双写同一批文件 | 无正式审核,靠双写 | **3641 stars / 57K 月下载 / 已有付费云** | **in(生态最强对手)** |
| **team-memory-mcp** | 团队共享 memory,Bayesian 置信度 + 90 天时间衰减 | 无审批;用 confirm/correct 调置信度 | 12 stars | **in(机制最接近)** |
| **Mneme HQ** | ADR → 结构化约束,**生成前确定性阻断** | ADR 是人写的,机器编译 | 活跃,有 benchmark 套件 | **in(正面竞品,见 §3 攻击二)** |
| **ADR Guard** | GitHub Action,改动受监视代码而无 ADR 则 PR 红 | CI 闸门 | 小 | **in** |
| **官方 MCP memory server** | 扁平 JSONL 知识图谱 | 无 | 参考实现 | **out** | 刻意极简,无团队支持 |
| MemPalace / Hindsight / Stash / agentmemory | 会话记忆 benchmark 选手 | 无 | 各异 | **out** | session memory,非团队治理 |

### 类别 D — 团队知识治理 / ADR 工具链

| 项目 | 定位 | in/out |
| --- | --- | --- |
| **经典 ADR(Nygard)** | 架构决策文档,accepted 后不可变,靠 supersede | **in** |
| **adr-agent / ADR Writer Agent** | AI 生成 ADR | **in** |
| **"Keep the Why"** | repo-native skill,回溯挖掘代码背后的理由 | **in** — 与 Fabric 的 archive source mode(从 git/docs 回灌)功能重合 |
| **KCS(Knowledge-Centered Service)** | draft / review / published / **retired** 生命周期 | **in(理论对手)** — Fabric 的三档成熟度是它的子集 |
| Backstage TechDocs 等 | 文档门户 | **out** | 不面向 agent |

---

## 2. 单源未交叉验证的断言

- `[单源未交叉验证]` team-memory-mcp 的 12 stars — 仅 GitHub 页面一处。
- `[单源未交叉验证]` "retirement state 在多数 AI workflow 设计中缺失" — 来自一篇 Slalom 博客,未见第二处佐证。
- `[单源未交叉验证]` Fabric npm 8511 次下载(2026-05-01..08-13)— 来自 npm API,但**归因不明**:该项目零外部用户,这个数几乎必然由自身 CI 与发版自动化产生。**不得当作采纳证据使用。**

---

## 3. 靶子攻击(PRD R1 硬要求)

Fabric 的领域边界来自 `KT-DEC-0072` 与 README:"管团队应记住什么(审过的 decision/pitfall/guideline),**不是** session 证据库,**不是** 多 agent 编排器"。三问如下。

### 攻击一:这个边界是产品判断,还是为了让自己成为"唯一"而收窄的?

**判定:大部分是真判断,但有一处是自我服务式收窄。**

- 真判断的部分:排除 session memory(Mem0/Zep/Letta)有正当理由——"agent 经历过什么"和"团队审过什么"确实是两类数据,混在一起会让审核闸门失效。这条站得住。
- **自我服务的部分**:README 的核心论证是"`AGENTS.md` 静态、会漂移、没有生命周期",据此推出需要 Fabric。但这个论证**只对比了最弱的对手**(裸 rules 文件),没有对比 Basic Memory(同样 Markdown、同样跨客户端、同样 MCP-native、且有语义检索 + 知识图谱 + 3641 stars)。把对手设成"一个 markdown 文件",赢面自然大。
- 更关键的:检索显示 **"propose-don't-publish"(agent 只写 pending,人工审核才进 canonical)是这个领域已被命名的既有模式**,不是 Fabric 的发明。Fabric 的 pending → review 是这个模式的一个实现,不是一个新范畴。

### 攻击二:按用户真实痛点分类,对手是谁?

用户痛点是"**AI 反复违反我们已经定过的规矩**"。按这个分类,对手不是 memory 产品,而是:

1. **Mneme HQ** —— 同样解决"agent 忘记既有决策",但走的是**确定性阻断**:PreToolUse hook 拦 Edit/Write,exit 2 直接挡掉违规写入,并把 decision id 回传给 agent;CI 里 `mneme check --mode strict` 兜底。
2. **ADR Guard** —— PR 级闸门。
3. **裸 CLAUDE.md** —— 零成本基线。

而 Fabric 的 `KT-DEC-0007` **明确选择了"只软提醒、不做 permanent gate、不做 decision:block"**。也就是说:在"用户真实痛点"这条轴上,Fabric 主动放弃了唯一能提供**保证**的手段。

Mneme 那篇文章把这个差别讲得很直白:三级阶梯是"没进上下文 → 进了上下文但只是建议 → 被确定性检查强制执行",而**只有第三级才把决策变成保证**。按这个尺子,Fabric 停在第二级。

这不必然是错的选择(阻断会带来假阳性和"没人敢改"的成本,`KT-GLD-0018` 记录过锁死文案的门禁如何变成假红),但它**必须被当作一个明确的竞争劣势陈述出来**,而不是被"我们不做 gate"的内部决策悄悄消化掉。

### 攻击三:边界放宽一档,Fabric 的相对位置怎么变?

- **允许 session memory 进来**:Fabric 立刻落后。它没有时序图谱(Zep)、没有自动事实抽取(Mem0)、没有 LongMemEval 之类的公开 benchmark 分数。
- **允许编排进来**:`KT-DEC-0072` 把编排划给 maestro-flow。放宽后 Fabric 是半个产品。
- **只放宽到"包含 rules-file 分发"**:Fabric 位置**变好**——它同时做分发(install 同步 managed block)和治理,而 Plexus/agnix 只做前者。

**结论**:Fabric 的边界在**一个很窄的窗口**里最优。窗口越窄,"领域最好"这个称号的含金量越低。

---

## 4. 六轴对标(证据版)

| 轴 | Fabric 位置 | 最强对手 | 证据 |
| --- | --- | --- | --- |
| 问题域契合度(团队审过的知识) | **领先** | team-memory-mcp | Fabric 有五类强 schema + pending→review 人工闸门;team-memory-mcp 只有 Bayesian 置信度,无类型区分、无审批 |
| 生命周期完整性 | **领先** | KCS(理论)/ Basic Memory | Fabric 有 draft→verified→proven + retire + 降级 + `KT-PRO-0001` 晋升 rubric(≥30 天、related 入度 ≥3、机械信号永不自动升)。Basic Memory 无生命周期状态机 |
| 跨客户端可移植性 | **持平偏后** | Basic Memory | Fabric 支持 2 端(Claude Code + Codex,Cursor 已于 2026-06-15 砍掉);Basic Memory 覆盖 Claude/Codex/Cursor/ChatGPT/VS Code/Obsidian |
| 首次到价值成本 | **落后** | 裸 CLAUDE.md / Basic Memory | Fabric 要求 `fabric install` + `store bind` + `store switch-write` 三步概念(store/scope 三轴/relevance_scope),`KT-DEC-0072` 自己把 "D2 首价值闭环" 列为待办,承认"装完无命中感知、激活失败"是已知风险 |
| 治理与可审计性 | **有条件领先** | Mneme HQ | Fabric 的**审批链**更强(pending→review→maturity);Mneme 的**执行力**更强(确定性阻断 + 可重建 verdict + benchmark 套件)。两者不是同一种"治理" |
| 生态与可持续性 | **显著落后** | Basic Memory | Basic Memory 3641 stars / 57K 月下载 / 付费云 / 多插件生态;Fabric 零外部用户、单一维护者、npm 下载归因不明 |

---

## 5. 本节的已知弱点

- 竞品信息来自公开检索,**未实际安装试用任何一个对手**。功能对比基于其自述文档,存在营销夸大风险。
- Mneme HQ 的 benchmark 未独立复核。
- 未检索中文生态(国内团队的同类内部工具),可能存在盲区。
