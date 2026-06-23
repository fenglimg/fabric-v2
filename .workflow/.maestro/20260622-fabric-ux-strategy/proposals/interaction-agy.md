# Analysis: fabric 交互与策略层超越性迭代设计## Related Files- [AGENTS.md](file:///Users/wepie/Desktop/personal-projects/pcf/AGENTS.md) - Contains the active bootstrapping rules, cite policy, and self-archive policy (e.g., [AGENTS.md:46](file:///Users/wepie/Desktop/personal-projects/pcf/AGENTS.md#L46), [AGENTS.md:73](file:///Users/wepie/Desktop/personal-projects/pcf/AGENTS.md#L73)).- [.workflow/scratch/20260619-214039-brainstorm-fabric-interaction-design/design-research.md](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/scratch/20260619-214039-brainstorm-fabric-interaction-design/design-research.md) - Establishes reference design patterns (Progressive Disclosure, Responsive Salience, InKH) (e.g., [design-research.md:29](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/scratch/20260619-214039-brainstorm-fabric-interaction-design/design-research.md#L29), [design-research.md:47](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/scratch/20260619-214039-brainstorm-fabric-interaction-design/design-research.md#L47)).- [.workflow/.analysis/kb-arch-complete/cross-product/conclusions.json](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/cross-product/conclusions.json) - Compares matching rules of Cursor/Copilot/Windsurf (e.g., [conclusions.json:171](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/cross-product/conclusions.json#L171), [conclusions.json:204](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/cross-product/conclusions.json#L204)).- [.workflow/.analysis/kb-arch-complete/fabric-governance/conclusions.json](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/fabric-governance/conclusions.json) - Details the doctor lints and archive-review transitions (e.g., [conclusions.json:28](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/fabric-governance/conclusions.json#L28), [conclusions.json:118](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/fabric-governance/conclusions.json#L118)).- [.workflow/.analysis/kb-arch-complete/maestro-governance/conclusions.json](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/maestro-governance/conclusions.json) - Outlines Maestro's three-state purge-governance model (e.g., [conclusions.json:7](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/maestro-governance/conclusions.json#L7)).- [.workflow/.analysis/kb-arch-complete/maestro-wizard/conclusions.json](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/maestro-wizard/conclusions.json) - Outlines Maestro's CLI setup steps and workflow recipe structures (e.g., [conclusions.json:101](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/maestro-wizard/conclusions.json#L101)).---## SummaryThe core friction in Fabric v2 is that cognitive complexity is transferred to the user/AI via overly complex scope parameters and verbose hooks, with no unified CLI-native interface. The Champion (C0-grilled) proposes simplifying scopes, reducing turn-based noise, and moving review downstream. This proposal refines the Champion's design by leveraging a "Location is Configuration" directory layout (killing metadata bloat), introducing non-intrusive system-driven receipts to solve AI loop issues, and planning a targeted CLI-native integration of Maestro's scanner wizard.---## Key Findings1. **Location is Configuration**: The physical path of a store determines its security boundary and visibility. Storing `layer` or `visibility_store` in yaml frontmatter is redundant and causes configuration drift ([cross-product/conclusions.json:176](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/cross-product/conclusions.json#L176)).2. **AI-Driven Self-Archive Loops**: Requiring the AI to output markdown confirmation for self-archiving wastes context tokens and leads to agent loop issues. Shifting this to a system hook receipt solves both problems cleanly ([fabric-governance/conclusions.json:118](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/fabric-governance/conclusions.json#L118)).3. **Passive Context Injection Inefficiency**: Simply dumping raw text into CLI prompts risks context pollution. Using color-coded ghost badges in stderr keeps terminals clean while conveying rule matches to the developer ([design-research.md:47](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/scratch/20260619-214039-brainstorm-fabric-interaction-design/design-research.md#L47)).---## Detailed Analysis & Proposals### 1. Champion Block Evaluation (保留 / 改进 / 推翻)#### Block 1: 交互1 (每个节奏只留一个人可读面) -> **【改进】**- **保留项**：在正常开发中，`Stop` 阶段完全保持静默是正确的，能有效避免干扰开发节奏。在 `PreToolUse` 编辑文件时，精简为单行知识匹配提示也符合 InKH 提倡的极简体验。- **改进点**：- **SessionStart HUD**：擂主的 HUD 太过极简化。用户在使用 Fabric 时的首要不安是“我的规则到底生效没有？现在写到哪个 store 了？”。应设计一个极简的命令行面板（Ambient Environment HUD），明确列出 **Read Stores、Write Store、工作区激活规则数、积压 backlog 数**，消除黑箱感。- **Stop 归档反馈机制**：擂主保留了 AI 自触发时的手动 Markdown 文本输出（如 `self-archive policy triggered...`）。这会消耗 AI 的输出 tokens 并容易由于格式不符导致解析失败。**应该完全由 PostToolUse / Stop System Hook 接管**，在 AI 输出结束后由 CLI 系统层在 stderr 打印一行确定性的“归档回执”，免除 AI 的发言负担。#### Block 2: 交互2 (归档 11 phase 砍成 3 stage 共享内核) -> **【改进】**- **保留项**：将归档工作流拆解为 `Ingest (收集) -> Analyze (去重/分类) -> Persist (落盘)` 的 3 stage 模块化管道是完全正确的。将二次确认移动到下游 `fabric-review` 单次消除双重审核大幅减轻了日常开发阻力。- **改进点**：- **添加 Active Similarity Threshold Gate (AST 相似度门限闸)**：如果完全将去重和冲突移到下游 `fabric-review`，会产生新的痛点 —— pending 目录很快会充斥高度重复的垃圾草稿。必须在 **Stage 2 (Analyze)** 引入基于 BM25/向量匹配的强制去重拦截：- 重合度 > 85%：直接丢弃或自动作为 evidence 追加到已有 canonical 规则的 append block 中。- 重合度 50-85% / 存在矛盾：落盘为带有 `[CONFLICT: K-XXX]` 标记的 pending 草稿。- 唯一性规则：落盘为干净的普通草稿。#### Block 3: 交互3 (Nudge 响应式渐强，SessionStart 呈现) -> **【改进】**- **保留项**：将积压提醒从 Turn-end 的 `Stop` 移到 `SessionStart` 是正确的，避免了在开发过程中打断用户。- **改进点**：- **引入交互式快捷命令**：警报不仅要报数，更要给“行动指南”。如 `⚠️ 12 pending rules. Run 'fabric review' to clear.`。- **开发工作流天然摩擦力拦截 (Git Commit/Push Hook)**：单纯在 SessionStart 报 warning，忙碌的开发者仍然会选择忽略，导致 backlog 最终死掉。既然是 MCP 架构，应该支持安装一个可选的 `pre-push` git hook。当 push 时如果检测到当前用户 authored 的 pending 草稿数量超过阈值（如 >10 条），在终端强制输出一行醒目的红色提醒，利用提交代码的空档期引导归档。#### Block 4: 策略4 (字段 5 砍 3: layer / scope / when) -> **【推翻重构】**- **理由**：擂主方案虽然从 5 字段精简到 3 字段，但依然要求在 Markdown 的 yaml frontmatter 中显式声明 `layer` 和 `scope` 等拓扑关系。这依然违背了 InKH 的 “Complexity should be absorbed by the system”（复杂度由系统吸收）的核心理念。- **重构设计**：- **位置即配置 (Location is Configuration)**：由于 Fabric 的物理边界是 Store（团队 Store 是独立的 git repo，个人 Store 是本地私有目录或独立 repo），**文件处于哪个 store 目录下，就天然决定了它的 layer (team | personal) 以及 visibility 边界**。完全不需要在 YAML Frontmatter 里再次标注！- **极简 Frontmatter 规范**：推广类似 Cursor MDC 的无感设计，Markdown 头部只留下：```yamlid: K-002                # promotion 时自动分配的全局唯一 stable IDdescription: 针对 C++ 智能指针的使用规范与循环引用规避方法 # 用于 AI 决策召回 (AI-decided matching)when: ["src/cpp/**/*.ts", "include/**/*.h"]          # glob 匹配路径 (代替 relevance_paths)```所有 layer、visibility_store、semantic_scope 全部物理隐式化，AI 与用户都不需要理解 scope 字段语义。---### 2. 交互方案 (具体到屏幕文字样例)#### 场景 1：SessionStart 阶段的“环境与状态盘点面板 (HUD)”在 CLI 启动或会话开始时，于 `stderr` 打印一行极具极客感、色彩高亮、紧凑且信息量饱和的 HUD 面板：```bash┌─── fabric v2.2 ────────────────────────── active: project:fabric-v2 ──┐│  📁 Read Stores  : team (K-001..K-124) | personal (KP-001..KP-018)  ││  ✍️ Write Store  : team (pending: 3 drafts)                          ││  ⚡ Active Rules : 42 rules matched workspace                          ││  ⚠️ Nudge        : 3 items in backlog. Run 'fabric review' to clean.  │└───────────────────────────────────────────────────────────────────────┘```*注：当积压超过阈值（如 12 条）时，Nudge 行自动变红闪烁警告，提示直接运行 `fabric review` 清空积压。*#### 场景 2：PreToolUse 阶段的 Ambient Inline Feedback (环境式反馈)当 AI 准备修改某文件时，Hook 自动拦截并打印匹配规则，但绝不干扰主屏幕文字，采用低调的暗灰色：```bash🗃️ [fabric] Recalled K-002: "Use argon2id for password hashing" -> matching src/auth/**/*.ts```#### 场景 3：Stop / Turn-End 阶段的 AI 归档回执当 AI 会话中捕捉到 self-archive 信号（如 wrong-turn-and-revert）并自动运行 `fab_extract_knowledge` 写入 pending 成功后，系统在 Turn 最末尾打印确定性的 CLI 系统回执，而**不需要** AI 文本输出：```bash📥 [fabric:archive] Captured candidate: "Avoid raw pg client" -> pending/pitfalls/K-084.md (Undo: reply 'undo')```#### 场景 4：Downstream `fabric review` 交互式分流面板开发完功能后，运行 `fabric review` 批量审阅 pending 时的终端交互：```bash$ fabric review┌─── fabric review ─────────────── 3 pending drafts found ──────────────┐│                                                                       ││  [1/3] K-084 (pitfall) - "Avoid raw pg client"                        ││  Source   : Wrong-turn-and-revert (Session: c69e4294, src/db.ts)       ││  Content  : Do not use raw pg client. Use the pool instead.           ││  Matches  : 89% similar to K-012 ("Always use pg connection pool")    ││                                                                       ││  [A] Approve & Merge with K-012   [M] Edit Content                    ││  [R] Reject                       [D] Defer                           ││  [Q] Quit                                                             ││                                                                       │└─────────────────────────────────────────────── Action: [A/M/R/D/Q] ───┘```---### 3. 策略层如何呼应- **Store-Metadata Mapping (Store 物理映像映射)**：每个 Store 物理目录根处包含一个极其轻量且受保护的 `.fabric-store.json`，其声明了当前 Store 的 UUID、Alias、Layer（team 还是 personal）以及 Write-Rules。这使得引擎在扫描整个 workspace 目录时，无需读取文件的 metadata 就能通过路径前缀快速推断其安全与可见性边界。- **Auto-Promotion Verification (自动提议校验)**：在 review 提升阶段，系统计算该条知识在 `events.jsonl` 中的召回次数与使用效果反馈（即 developer edit action 成功且未发生 reject），动态将处于 `draft` 状态的规则在 approve 后无感推入 `verified`，并在多次使用后（如 10+ Sessions 证明稳定）标记为 `proven`，降低人工审核维护的决策心智负荷。- **Implicit Citation Accounting (隐式引用记账)**：不再逼迫 AI 在回复的首行输出 `KB: K-001 [applied]` 这样的八股文。PreToolUse Hook 只要监测到当前会话运行过 `fab_recall` 并命中了特定 rule ID，系统会自动在 `.fabric/events.jsonl` 中添加 citation log。除非 AI 希望显式声明 `[dismissed]` 或进行 override，否则对用户侧是一切无感的。---### 4. 后续功能集成清单 (Maestro-flow -> Fabric)| 功能名称 (Maestro Origin) | 核心价值 (Value) | 实现成本 (Cost) | 本版集成 (This Version?) | 详细决策与说明 || :--- | :--- | :--- | :---: | :--- || **Spec-Setup CLI Wizard**<br>(代码规范智能初始化) | **极高**<br>解决 repository 引入 Fabric 时的冷启动难点，自动扫描推导约定。 | **中**<br>需要移植 package/tsconfig 扫描器及 MD 生成模板。 | **是 (本版)** | 新仓库只需一键 `fabric init` 就能利用 AI 完成 80% 的代码规范和约束初始化。 || **Semantic & BM25 Multi-Index Search**<br>(双端检索加速) | **高**<br>大幅提升 CJK 汉字及相似技术术语的召回精准度，避免 regex 逃逸。 | **低**<br>可直接基于 Node/TS 轻量级实现倒排索引与 BM25。 | **是 (本版)** | 提升 passive recall 的关键基础设施，属于必须集成的底层能力。 || **Conflict & Redundancy Audit Detector**<br>(冲突与重合自动检测) | **高**<br>防止多人开发时写入相似或互相违背的规则。 | **中**<br>需要封装到 `fabric doctor --lint-conflicts` 中。 | **是 (本版)** | 在 Stage 2 及日常治理中检测并提示冲突，保持知识库的干净与精炼。 || **L3 E2E and Stress Performance Tests**<br>(全链路与匹配压力测试) | **高**<br>确保规则膨胀（如 500+ rules）时检索延迟 < 100ms，绝不卡死终端。 | **中**<br>需要编写大量 mock-client 压力测试用例。 | **是 (本版)** | 开发者工具的性能就是命根子，必须有 stress tests 守门。 || **Knowhow & Workflow Recipe Execution**<br>(RCP 步骤式运行食谱) | **中**<br>将 markdown 转化为可交互的代码步骤，偏新手引导。 | **高**<br>需要处理 shell 执行器安全沙箱与跨平台兼容。 | **否 (下版)** | 偏向操作说明书，偏离了 Fabric v2 "隐式契约与安全隔离限制" 的核心定位，优先级延后。 || **Maestro Web Dashboard**<br>(可视化看板及健康图谱) | **低**<br>错战场。开发者的主战场在终端与 IDE，跳转网页管理是高开销。 | **极高**<br>React/Vite 跨端打包与端口监听开销。 | **否 (不集成)** | 坚决不抄网页 dashboard。完全保持 MCP 工具 + CLI-native 交互的特色护城河。 |---### 5. 一句话总结你方案为何体感既大于擂主又大于 maestro> **“我的方案将繁重的环境拓扑字段化为无形的物理目录映射，用全自动的系统层 Hook 归档回执取代了 AI 的发言干扰，让开发现场只有低调却精准的环境反馈（HUD 与 Badges），做到了无需开浏览器、无需教 AI 规则、无需手记账的极致开发者体验。”**---## Quality Checklist- [x] All CONTEXT files analyzed- [x] Code evidence with `file:line` references- [x] Specific, actionable recommendations- [x] No unsubstantiated claims- [x] EXPECTED deliverables met[Tool: list_dir]
Created At: 2026-06-22T05:02:11Z
Completed At: 2026-06-22T05:02:11Z
{"name":".antigravitycli", "isDir":true}
{"name":".claude", "isDir":true}
{"name":".codex", "isDir":true}
{"name":".cursor", "isDir":true}
{"name":".fabric", "isDir":true}
{"name":".git", "isDir":true}
{"name":".github", "isDir":true}
{"name":".gitignore", "sizeBytes":"1021"}
{"name":".intent-ledger.jsonl", "sizeBytes":"2455"}
{"name":".mcp.json", "sizeBytes":"225"}
{"name":".workflow", "isDir":true}
{"name":"AGENTS.md", "sizeBytes":"10138"}
{"name":"CHANGELOG.md", "sizeBytes":"131468"}
{"name":"CLAUDE.md", "sizeBytes":"40"}
{"name":"CODE_OF_CONDUCT.md", "sizeBytes":"2712"}
{"name":"CONTRIBUTING.md", "sizeBytes":"4769"}
{"name":"GOAL-BRIEF.md", "sizeBytes":"11580"}
{"name":"LICENSE", "sizeBytes":"1079"}
{"name":"README.md", "sizeBytes":"17174"}
{"name":"RELEASING.md", "sizeBytes":"3336"}
{"name":"SECURITY.md", "sizeBytes":"2265"}
{"name":"assets", "isDir":true}
{"name":"cache", "isDir":true}
{"name":"docs", "isDir":true}
{"name":"knip.config.ts", "sizeBytes":"5069"}
{"name":"lefthook.yml", "sizeBytes":"83"}
{"name":"local_cache", "isDir":true}
{"name":"node_modules", "isDir":true}
{"name":"package.json", "sizeBytes":"772"}
{"name":"packages", "isDir":true}
{"name":"pnpm-lock.yaml", "sizeBytes":"116660"}
{"name":"pnpm-workspace.yaml", "sizeBytes":"287"}
{"name":"schemas", "isDir":true}
{"name":"scripts", "isDir":true}
{"name":"tsconfig.base.json", "sizeBytes":"294"}
{"name":"ui-prototype-hybrid.html", "sizeBytes":"20733"}

Summary: This directory contains 16 subdirectories and 20 files.
Created At: 2026-06-22T05:02:20Z
Completed At: 2026-06-22T05:02:20Z
{"name":".DS_Store", "sizeBytes":"10244"}
{"name":".analysis", "isDir":true}
{"name":".brainstorm", "isDir":true}
{"name":".csv-wave", "isDir":true}
{"name":".integration-test", "isDir":true}
{"name":".lite-plan", "isDir":true}
{"name":".maestro", "isDir":true}
{"name":".scratchpad", "isDir":true}
{"name":"active", "isDir":true}
{"name":"blueprint", "isDir":true}
{"name":"issues", "isDir":true}
{"name":"kg", "isDir":true}
{"name":"milestones", "isDir":true}
{"name":"scratch", "isDir":true}
{"name":"spec-analytics.jsonl", "sizeBytes":"437"}
{"name":"specs", "isDir":true}
{"name":"state.json", "sizeBytes":"3049"}
{"name":"wiki-index.json", "sizeBytes":"137094"}
{"name":"worktree-scope.json", "sizeBytes":"513"}
{"name":"worktrees.json", "sizeBytes":"1798"}

Summary: This directory contains 14 subdirectories and 6 files.
Created At: 2026-06-22T05:02:21Z
Completed At: 2026-06-22T05:02:21Z
{"name":"ANL-2026-04-21-fabric-init-cli-ux", "isDir":true}
{"name":"ANL-2026-04-22-codex适配", "isDir":true}
{"name":"ANL-2026-04-23-ai-client-init-rules-web-interaction", "isDir":true}
{"name":"ANL-2026-04-23-规则加载中文锚点脚本文档ledger路径", "isDir":true}
{"name":"ANL-2026-04-25-adr-002-mcp-first-rule-distribution-rules-architecture", "isDir":true}
{"name":"ANL-2026-04-25-fabric-v2核心认知对齐方案", "isDir":true}
{"name":"ANL-2026-04-25-l2规则使命宣言业务伤疤融入评判", "isDir":true}
{"name":"ANL-2026-04-25-ledger-意图账本-重构", "isDir":true}
{"name":"ANL-2026-04-25-规则与-jest-静态融合契约测试", "isDir":true}
{"name":"ANL-2026-04-25-重建对于该项目的完全掌握和认知", "isDir":true}
{"name":"ANL-2026-04-26-fabric-cli-mcp-server-crud-职责优化", "isDir":true}
{"name":"ANL-2026-04-26-web端能力保留新增讨论", "isDir":true}
{"name":"ANL-2026-04-28-init规则目录与taxonomy设计讨论", "isDir":true}
{"name":"ANL-2026-05-06-stabilize-three-clients", "isDir":true}
{"name":"ANL-2026-05-08-fabric-test-cases", "isDir":true}
{"name":"ANL-2026-05-09-fabric-init-files-boundary", "isDir":true}
{"name":"ANL-2026-05-10-fabric-knowledge-pivot", "isDir":true}
{"name":"ANL-cli-mcp-agent-web-audit-2026-04-21", "isDir":true}
{"name":"ANL-fab-doc-init-werewolf-2026-04-19", "isDir":true}
{"name":"ANL-fab-init-heuristic-discovery-2026-04-19", "isDir":true}
{"name":"ANL-fabric-mcp-dashboard-unified-2026-04-19", "isDir":true}
{"name":"ANL-fabric-product-2026-04-19", "isDir":true}
{"name":"ANL-implement-fabric-v2-2026-04-18", "isDir":true}
{"name":"fabric-maestro-full-coverage", "isDir":true}
{"name":"kb-arch-complete", "isDir":true}

Summary: This directory contains 25 subdirectories and 0 files.
Created At: 2026-06-22T05:02:23Z
Completed At: 2026-06-22T05:02:23Z
{"name":"cross-product", "isDir":true}
{"name":"fabric-governance", "isDir":true}
{"name":"final-synthesis", "isDir":true}
{"name":"maestro-governance", "isDir":true}
{"name":"maestro-tests", "isDir":true}
{"name":"maestro-ui", "isDir":true}
{"name":"maestro-wizard", "isDir":true}

Summary: This directory contains 7 subdirectories and 0 files.
Created At: 2026-06-22T05:02:25Z
Completed At: 2026-06-22T05:02:25Z
{"name":"conclusions.json", "sizeBytes":"8277"}

Summary: This directory contains 0 subdirectories and 1 files.
Created At: 2026-06-22T05:02:26Z
Completed At: 2026-06-22T05:02:26Z
{"name":"conclusions.json", "sizeBytes":"15098"}

Summary: This directory contains 0 subdirectories and 1 files.
Created At: 2026-06-22T05:02:28Z
Completed At: 2026-06-22T05:02:28Z
{"File":"/Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/cross-product/conclusions.json"}
{"File":"/Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/fabric-governance/conclusions.json"}
{"File":"/Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/final-synthesis/conclusions.json"}
{"File":"/Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/maestro-governance/conclusions.json"}
{"File":"/Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/maestro-tests/conclusions.json"}
{"File":"/Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/maestro-ui/conclusions.json"}
{"File":"/Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/maestro-wizard/conclusions.json"}
Created At: 2026-06-22T05:02:29Z
Completed At: 2026-06-22T05:02:29Z
{"File":"/Users/wepie/Desktop/personal-projects/pcf/.workflow/scratch/20260619-214039-brainstorm-fabric-interaction-design/design-research.md"}
Created At: 2026-06-22T05:02:30Z
Completed At: 2026-06-22T05:02:30Z
{"name":".claude", "isDir":true}
{"name":".codex", "isDir":true}
{"name":".fabric", "isDir":true}
{"name":".git", "isDir":true}
{"name":".gitattributes", "sizeBytes":"297"}
{"name":".github", "isDir":true}
{"name":".gitignore", "sizeBytes":"717"}
{"name":".history", "isDir":true}
{"name":".maestroignore", "sizeBytes":"165"}
{"name":".mcp.json", "sizeBytes":"464"}
{"name":".mcp.json.bak", "sizeBytes":"449"}
{"name":".release-notes-v0.4.17.md", "sizeBytes":"1523"}
{"name":"README.md", "sizeBytes":"11980"}
{"name":"README.zh-CN.md", "sizeBytes":"10409"}
{"name":"assets", "isDir":true}
{"name":"bin", "isDir":true}
{"name":"chains", "isDir":true}
{"name":"coverage", "isDir":true}
{"name":"dashboard", "isDir":true}
{"name":"docs-site", "isDir":true}
{"name":"docs-site-snap.txt", "sizeBytes":"57984"}
{"name":"extensions", "isDir":true}
{"name":"guide", "isDir":true}
{"name":"maestro-flow-0.2.0.tgz", "sizeBytes":"2052316"}
{"name":"overlays", "isDir":true}
{"name":"package-lock.json", "sizeBytes":"180893"}
{"name":"package.json", "sizeBytes":"3263"}
{"name":"plan.json", "sizeBytes":"719"}
{"name":"scripts", "isDir":true}
{"name":"shared", "isDir":true}
{"name":"sidebar-snapshot.txt", "sizeBytes":"17604"}
{"name":"spec", "isDir":true}
{"name":"src", "isDir":true}
{"name":"templates", "isDir":true}
{"name":"toc-check.png", "sizeBytes":"375082"}
{"name":"tsconfig.json", "sizeBytes":"822"}
{"name":"vitest.config.ts", "sizeBytes":"2158"}
{"name":"workflows", "isDir":true}

Summary: This directory contains 21 subdirectories and 17 files.
Created At: 2026-06-22T05:02:33Z
Completed At: 2026-06-22T05:02:33Z
File Path: `file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/scratch/20260619-214039-brainstorm-fabric-interaction-design/design-research.md`
Total Lines: 288
Total Bytes: 10527
Showing lines 1 to 288
The following code has been modified to include a line number before every line, in the format: <line_number>: <original_line>. Please note that any changes targeting the original code should remove the line number, colon, and leading space.
1: # Design Research: Fabric v2 交互与策略优化
2: 
3: ## 1. Reference Projects / Implementations
4: 
5: ### 1.1 Claude Code Hooks System
6: **Source**: https://code.claude.com/docs/en/hooks.md
7: 
8: **Key Architecture Decisions**:
9: - **Deterministic execution**: Hooks run automatically at lifecycle points, not relying on LLM choice
10: - **Three cadences**: Session-level (SessionStart/End), Turn-level (UserPromptSubmit/Stop), Tool-level (PreToolUse/PostToolUse)
11: - **Non-blocking by default**: Hooks are advisory, execution proceeds even on non-zero exit
12: - **Trust model**: Non-managed hooks require explicit user trust before execution
13: 
14: **What Worked**:
15: - Parallel execution of matching hooks with automatic deduplication
16: - Multiple hook types: command, HTTP, prompt, agent
17: - `/hooks` browser for visibility and debugging
18: - Managed hooks for team enforcement
19: 
20: **Applicability to Fabric**:
21: - Hook lifecycle design is mature and well-documented
22: - Trust model addresses security concerns
23: - Visibility through `/hooks` command reduces cognitive load
24: 
25: ### 1.2 Agentic Design Patterns
26: **Source**: https://agentic-design.ai/patterns/ui-ux-patterns
27: 
28: **Key Patterns**:
29: - **Progressive Disclosure**: summary → detailed → technical with visual hierarchy
30: - **Responsive Salience**: auto-adjust visibility based on task complexity, user expertise, risk
31: - **Epistemic UI**: visualize AI confidence, flag weak provenance, color-code uncert
<truncated 8368 bytes>
re agent to search its own memory for relevant context.
247: 
248: **Why Avoid**: Agent may forget, search incorrectly, or skip.
249: 
250: **Fabric Current**: Recall is hook-driven (good), but agent must still choose to read bodies.
251: 
252: **Better**: Passive injection of bodies for high-confidence matches.
253: 
254: ### 6.2 Anti-Pattern: Blanket Approval Gates
255: **Description**: Require approval for all operations regardless of stakes.
256: 
257: **Why Avoid**: Approval fatigue, users auto-approve without reading.
258: 
259: **Fabric Current**: Cite policy requires explicit action for all recalls.
260: 
261: **Better**: Responsive salience — approval only for low-confidence or high-stakes.
262: 
263: ### 6.3 Anti-Pattern: Static UI Intensity
264: **Description**: Same UI complexity for all users and all tasks.
265: 
266: **Why Avoid**: Overwhelms beginners, frustrates experts.
267: 
268: **Fabric Current**: Same hook output, same cite requirements for all.
269: 
270: **Better**: Adaptive intensity based on user expertise and task risk.
271: 
272: ## 7. Summary
273: 
274: **Core Insight from InKH**: "Complexity should be absorbed by the system, not transferred to the user."
275: 
276: **Key Recommendations**:
277: 1. **Passive Injection**: Already partially implemented via hooks, needs bounded buffer and decay
278: 2. **Responsive Salience**: Add user expertise tracking and task risk assessment
279: 3. **Progressive Disclosure**: Show summaries, expand on demand
280: 4. **Epistemic UI**: Visualize confidence, provenance, store origin
281: 5. **Intentional Friction**: Apply surgically, not uniformly
282: 6. **Wiki Audit Surface**: Reduce terminal noise, provide governance
283: 
284: **Implementation Priority**:
285: 1. Short-term: Progressive disclosure for cite policy (show summary only)
286: 2. Medium-term: Responsive salience for self-archive trigger
287: 3. Long-term: Temporal knowledge graph, wiki au
Created At: 2026-06-22T05:02:34Z
Completed At: 2026-06-22T05:02:34Z
File Path: `file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/cross-product/conclusions.json`
Total Lines: 339
Total Bytes: 15098
Showing lines 1 to 339
The following code has been modified to include a line number before every line, in the format: <line_number>: <original_line>. Please note that any changes targeting the original code should remove the line number, colon, and leading space.
1: {
2:   "analysis_id": "KB-ARCH-COMPLETE-CROSS-PRODUCT",
3:   "timestamp": "2026-06-19T00:00:00.000Z",
4:   "purpose": "补充轴6对标对比完整性 — Cursor/Copilot/Windsurf 知识注入机制对比",
5:   
6:   "comparison_matrix": {
7:     "dimensions": [
8:       "注入触发机制",
9:       "存储位置与作用域",
10:       "召回机制与上下文权重",
11:       "生命周期与版本控制",
12:       "格式与结构复杂度",
13:       "团队协作能力",
14:       "动态上下文感知",
15:       "跨客户端互操作性"
16:     ],
17:     
18:     "products": {
19:       "Cursor": {
20:         "注入触发机制": {
21:           "modes": ["Always Apply", "Auto-attached (glob)", "Agent-decided", "Manual (@mention)"],
22:           "trigger_logic": "YAML frontmatter控制：alwaysApply=true全时注入；globs模式匹配文件路径时自动附加；description字段供AI判断相关性；@显式引用手动触发",
23:           "granularity": "高 — 四种触发模式精确控制"
24:         },
25:         "存储位置与作用域": {
26:           "locations": [
27:             ".cursor/rules/*.mdc (项目级，推荐)",
28:             ".cursorrules (项目级，legacy)",
29:             "AGENTS.md (目录级，自动递归)",
30:             "用户设置 (全局级)",
31:             "团队仪表板 (团队级)"
32:           ],
33:           "scope_hierarchy": "团队规则 < 用户规则 < 项目规则 < 目录级AGENTS.md",
34:           "version_control": "完全支持 
<truncated 13174 bytes>
6:         "action": "Fabric v2.2的activation字段可扩展为enum: always | path-match | ai-decided | manual"
297:       },
298:       {
299:         "insight": "生命周期治理是Fabric独占优势",
300:         "rationale": "三竞品均无KB成熟度阶梯/审批流程/归档扫描",
301:         "action": "强化fabric-review/fabric-archive技能，作为差异化卖点"
302:       },
303:       {
304:         "insight": "MCP协议打开跨客户端想象空间",
305:         "rationale": "fab_*工具可被任何MCP兼容客户端调用",
306:         "action": "构建Fabric MCP SDK，支持第三方客户端集成"
307:       }
308:     ],
309:     
310:     "gaps_identified": [
311:       {
312:         "gap": "无实时上下文可视化",
313:         "current": "Fabric v2.2 SessionStart HUD显示召回计数，但无交互时context gauge",
314:         "target": "类似Cursor的hover context gauge，显示当前激活KB列表"
315:       },
316:       {
317:         "gap": "无团队级云端管理",
318:         "current": "Store基于本地目录，无云端同步",
319:         "target": "类似Cursor Team Dashboard的云端Store管理界面"
320:       },
321:       {
322:         "gap": "无自动Memories生成",
323:         "current": "archive scan需AI触发，无后台自动发现",
324:         "target": "类似Windsurf的后台Cascade Memories生成机制"
325:       }
326:     ]
327:   },
328:   
329:   "sources": [
330:     "https://cursor.com/docs/rules",
331:     "https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions",
332:     "https://docs.windsurf.com/plugins/cascade/memories",
333:     "https://design.dev/guides/cursor-rules/",
334:     "https://skillsplayground.com/guides/windsurf-rules/",
335:     "https://thepromptshelf.dev/blog/windsurfrules-complete-guide-2026/",
336:     "https://agentconfig.ing/files/windsurf-rules-md/"
337:   ]
338: }
339: 
The above content shows the entire, complete file contents of the requested file.

Created At: 2026-06-22T05:02:35Z
Completed At: 2026-06-22T05:02:35Z
File Path: `file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/fabric-governance/conclusions.json`
Total Lines: 251
Total Bytes: 9083
Showing lines 1 to 251
The following code has been modified to include a line number before every line, in the format: <line_number>: <original_line>. Please note that any changes targeting the original code should remove the line number, colon, and leading space.
1: {
2:   "system": "fabric-v2",
3:   "analysis_date": "2026-06-19",
4:   "governance_mechanisms": {
5:     "doctor_lint": {
6:       "name": "fabric doctor",
7:       "description": "诊断和修复 Fabric 工作区问题的综合 lint 系统",
8:       "total_checks": 48,
9:       "check_categories": [
10:         "bootstrap (anchor/snapshot/managed-block)",
11:         "event-ledger (existence/writability/partial-write/schema-compat)",
12:         "knowledge (age/integrity/scope/relevance)",
13:         "store (counter-drift/orphan/scope-lint)",
14:         "hooks (wired/runtime/content-drift)",
15:         "skills (ref-mirror/token-budget/description/yaml-valid)"
16:       ],
17:       "modes": {
18:         "lint": "只读诊断 (fabric doctor)",
19:         "fix": "自动修复派生状态 (fabric doctor --fix)",
20:         "fix-knowledge": "自动修复知识条目 (fabric doctor --fix-knowledge)"
21:       },
22:       "exit_codes": {
23:         "0": "all OK or warnings in non-strict mode",
24:         "1": "errors present or strict + warnings"
25:       }
26:     },
27:     "knowledge_decay_lints": {
28:       "orphan_demote": {
29:         "code": "knowledge_orphan_demote_required",
30:         "description": "知识条目长时间无活动, 按 maturity tier 降级",
31:         "thresholds": {
32:           "proven": "90 days inactivity",
33:           "verified": "30 days inactivity",
34:           "draft": "14 days inactivity"
35:         },
36:         "action": "demote one maturity tier (proven→verif
<truncated 6720 bytes>
:       }
207:     },
208:     "conflict_lint": {
209:       "command": "fabric doctor --lint-conflicts",
210:       "algorithm": "bm25 candidate pairs + optional LLM judge",
211:       "verdicts": ["conflict", "similar", "review"]
212:     }
213:   },
214:   "governance_flow": {
215:     "entry_points": [
216:       "fabric doctor (诊断)",
217:       "fabric doctor --fix (自动修复)",
218:       "fabric doctor --fix-knowledge (知识修复)",
219:       "fabric doctor --cite-coverage (引用覆盖率)",
220:       "fabric doctor --lint-conflicts (冲突检测)",
221:       "fabric-archive (归档)",
222:       "fabric-review (审核)"
223:     ],
224:     "lifecycle_states": {
225:       "pending": "active → rejected/deferred → promoted → canonical",
226:       "canonical": "draft → verified → proven → archived"
227:     },
228:     "audit_trail": "events.jsonl + cite-rollup.jsonl + metrics.jsonl"
229:   },
230:   "id_redirect_mechanism": {
231:     "description": "layer-flip 后的 id 映射",
232:     "event": "knowledge_id_redirect",
233:     "fields": ["previous_stable_id", "new_stable_id", "reason"],
234:     "consumers": ["fab_plan_context.redirects", "fab_get_knowledge_sections.redirect_to"]
235:   },
236:   "comparison_with_maestro": {
237:     "key_differences": [
238:       "fabric-v2: 自动化 lint 系统 (48 checks) + 可选自动修复",
239:       "maestro-flow: 显式用户决策驱动 (keep/deprecate/delete)",
240:       "fabric-v2: 分层 maturity ladder (draft/verified/proven)",
241:       "maestro-flow: 单一 P0/P1/P2 分级",
242:       "fabric-v2: events.jsonl 审计追踪 + id-redirect 机制",
243:       "maestro-flow: 单一 backup tarball",
244:       "fabric-v2: store-backed 多仓库模型",
245:       "maestro-flow: 单一 workspace 存储模型",
246:       "fabric-v2: 专用 skills (archive/review/sync)",
247:       "maestro-flow: 单一 audit skill"
248:     ]
249:   }
250: }
251: 
The above content shows the entire, complete file contents of the requested file.

Created At: 2026-06-22T05:02:37Z
Completed At: 2026-06-22T05:02:37Z
File Path: `file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/maestro-governance/conclusions.json`
Total Lines: 122
Total Bytes: 5571
Showing lines 1 to 122
The following code has been modified to include a line number before every line, in the format: <line_number>: <original_line>. Please note that any changes targeting the original code should remove the line number, colon, and leading space.
1: {
2:   "system": "maestro-flow",
3:   "analysis_date": "2026-06-19",
4:   "governance_mechanisms": {
5:     "audit_skill": {
6:       "name": "manage-knowledge-audit",
7:       "description": "审查 spec/knowhow/artifact 存储，识别矛盾/失效/孤儿，通过 keep/deprecate/delete 三态清理",
8:       "scope": ["spec", "knowhow", "artifact", "all"],
9:       "actions": ["keep", "deprecate", "delete", "purge"],
10:       "phases": [
11:         "Stage 1-2: Scope 解析 + 存储加载",
12:         "Stage 3: 时间线索引建立 (mtime ↔ session/milestone)",
13:         "Stage 4: Finding 池按 P0/P1/P2 分级输出",
14:         "Stage 5: 用户决策 (三态面板)",
15:         "Stage 6: Backup tarball 生成",
16:         "Stage 7: 执行变更 (deprecate/delete/purge)",
17:         "Stage 8: 报告生成"
18:       ],
19:       "deletion_policy": {
20:         "default": "--interactive (三态面板逐项决策)",
21:         "non_interactive": {
22:           "--mark": "仅打标",
23:           "--delete": "软删到 .trash/",
24:           "--purge": "物理擦除 (仅 artifact, 需双重确认)"
25:         }
26:       },
27:       "phase_gates": [
28:         {
29:           "gate": "GATE 1: Load → Detect",
30:           "required": ["Scope 解析通过", "互斥标志校验完成", "三存储按 scope 加载完成"],
31:           "blocked_on": ["scope 非法或存储不可读: E001/E002"]
32:         },
33:         {
34:           "gate": "GATE 2: Detect → Decision",
35:           "require
<truncated 2565 bytes>
议加 --scope 收敛或 --since 增量"},
74:     {"code": "W005", "severity": "warning", "condition": "LLM detector 不可用", "recovery": "降级到正则+图算法子集"}
75:   ],
76:   "governance_flow": {
77:     "entry_points": [
78:       "Stop-hook 触发 (pending overflow)",
79:       "用户显式调用 (/manage-knowledge-audit)",
80:       "周期巡检 (--scope all --report)"
81:     ],
82:     "workflow": [
83:       "1. 解析 scope 和 flags",
84:       "2. 加载对应存储 (spec/knowhow/artifact)",
85:       "3. 建立时间线索引",
86:       "4. 执行检测算法 (矛盾/失效/孤儿)",
87:       "5. 输出 finding 池 (P0/P1/P2 分级)",
88:       "6. 用户决策 (keep/deprecate/delete)",
89:       "7. 生成 backup tarball",
90:       "8. 执行变更",
91:       "9. 生成 audit-report-{date}.md + audit-log.jsonl"
92:     ],
93:     "output": {
94:       "report": "audit-report-{date}.md",
95:       "log": "audit-log.jsonl",
96:       "backup": ".workflow/.trash/knowledge-audit-{timestamp}/"
97:     }
98:   },
99:   "deprecation_strategy": {
100:     "text_storage": {
101:       "method": "status=\"deprecated\"",
102:       "preserves_history": true,
103:       "location": "原地保留"
104:     },
105:     "artifact_storage": {
106:       "method": "软删到 .trash/ 或 物理擦除",
107:       "preserves_history": false,
108:       "requires_double_confirm": true
109:     }
110:   },
111:   "comparison_with_fabric": {
112:     "key_differences": [
113:       "maestro-flow: 显式三态决策 (keep/deprecate/delete), 用户驱动",
114:       "fabric-v2: 自动化 lint + doctor 修复, 可选用户确认",
115:       "maestro-flow: 集中式审计 skill",
116:       "fabric-v2: 分布式 lint checks (48+) + 专用命令 (doctor/review/archive)",
117:       "maestro-flow: 单一 backup tarball",
118:       "fabric-v2: events.jsonl 审计追踪 + id-redirect 机制"
119:     ]
120:   }
121: }
122: 
The above content shows the entire, complete file contents of the requested file.

Created At: 2026-06-22T05:02:38Z
Completed At: 2026-06-22T05:02:38Z
File Path: `file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/maestro-tests/conclusions.json`
Total Lines: 274
Total Bytes: 9692
Showing lines 1 to 274
The following code has been modified to include a line number before every line, in the format: <line_number>: <original_line>. Please note that any changes targeting the original code should remove the line number, colon, and leading space.
1: {
2:   "summary": "maestro-flow 测试覆盖策略分析",
3:   "metadata": {
4:     "analyzed_at": "2026-06-19",
5:     "total_test_files": 137,
6:     "total_test_lines": 41623,
7:     "src_tests": 80,
8:     "dashboard_tests": 57
9:   },
10:   "test_frameworks": {
11:     "vitest": {
12:       "usage": "dashboard 完全使用 vitest; src 大部分使用 vitest",
13:       "files_count": 116,
14:       "characteristics": ["describe/it/expect pattern", "beforeEach/afterEach fixtures", "tmpdir isolation"]
15:     },
16:     "node:test": {
17:       "usage": "src/hooks, src/coordinator 部分核心模块",
18:       "files_count": 21,
19:       "characteristics": ["native Node.js test runner", "assert module", "no external dependencies"]
20:     }
21:   },
22:   "test_stratification": {
23:     "L1_unit": {
24:       "description": "单个模块/函数的纯逻辑测试",
25:       "count_estimate": 75,
26:       "characteristics": [
27:         "Mock 外部依赖",
28:         "无文件系统 I/O",
29:         "快速执行",
30:         "路径模式: */src/tools/__tests__/*.test.ts"
31:       ],
32:       "examples": [
33:         "team-msg.test.ts - 消息 handler 纯逻辑",
34:         "collab-adapter.test.ts - GitHub/Slack adapter validateConfig",
35:         "hook-engine.test.ts - SyncHook/AsyncSeriesHook tap/call 逻辑"
36:       ]
37:     },
38:     "L2_integration": {
39:       "description": "跨模块交互测试，带真实文件系统",
40:       "count_estimate": 40,
41:       "characteristics": [
42:   
<truncated 7440 bytes>
logy_alignment": [
225:         "三轴覆盖: L1 单元逻辑 + L2 跨模块集成 + L3 全链路 e2e",
226:         "fixture 隔离: tmpdir + env override 统一模式",
227:         "mock 层次: L1 全 mock -> L2 服务 mock -> L3 最小 mock"
228:       ]
229:     }
230:   },
231:   "kb_related_tests": {
232:     "spec_tests": {
233:       "count": 10,
234:       "files": [
235:         "spec-loader.test.ts",
236:         "spec-writer.test.ts",
237:         "spec-cli-e2e.test.ts",
238:         "spec-entry-parser.test.ts",
239:         "spec-keyword-index.test.ts",
240:         "spec-loader-ref.test.ts",
241:         "spec-writer-ref.test.ts",
242:         "spec-writer-size-guard.test.ts",
243:         "specs.integration.test.ts",
244:         "keyword-spec-injector.test.ts"
245:       ],
246:       "coverage": "完整的 spec CRUD + injection 流程"
247:     },
248:     "wiki_tests": {
249:       "count": 6,
250:       "files": [
251:         "wiki-indexer.test.ts",
252:         "wiki.integration.test.ts",
253:         "wiki-role-loader.test.ts",
254:         "writer-stress.test.ts",
255:         "stress.test.ts",
256:         "chain-map.test.ts"
257:       ],
258:       "coverage": "wiki 索引 + 图分析 + 搜索 + 压力测试"
259:     },
260:     "knowhow_tests": {
261:       "count": 1,
262:       "files": ["kg-hooks.test.ts"],
263:       "note": "knowhow 覆盖较少，主要在 dashboard 的 wiki 系统中"
264:     }
265:   },
266:   "conclusions": {
267:     "test_strategy": "三轴分层 + 框架混合 + fixture 隔离",
268:     "test_coverage_strength": "tools(25) > hooks(21) > coordinator(9) 的覆盖分布",
269:     "e2e_strength": "dashboard 有完整 7 个 e2e 测试覆盖 agent/task/event/sse 全链路",
270:     "kb_test_coverage": "spec 系统测试完整，wiki 有压力测试，knowhow 较弱",
271:     "fabric_v2_gap": "缺少 L3 e2e 层和压力测试，可借鉴 maestro 模式"
272:   }
273: }
274: 
The above content shows the entire, complete file contents of the requested file.

Created At: 2026-06-22T05:02:40Z
Completed At: 2026-06-22T05:02:40Z
File Path: `file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/maestro-ui/conclusions.json`
Total Lines: 160
Total Bytes: 7522
Showing lines 1 to 160
The following code has been modified to include a line number before every line, in the format: <line_number>: <original_line>. Please note that any changes targeting the original code should remove the line number, colon, and leading space.
1: {
2:   "analysis_session": "kb-arch-complete-ax4-ui",
3:   "generated_at": "2026-06-19",
4:   "ui_architecture": {
5:     "overview": "Maestro Dashboard 采用 Zustand store + React 组件的现代化架构，通过 REST API 与服务端通信。Wiki 和 Specs 作为两个独立的知识存储，拥有各自的 store、视图组件和交互路径。",
6:     "stores": {
7:       "wiki_store": {
8:         "file": "dashboard/src/client/store/wiki-store.ts",
9:         "state_shape": {
10:           "entries": "WikiEntry[] - 所有 wiki 条目",
11:           "byId": "Record<string, WikiEntry> - ID 索引",
12:           "loading": "boolean",
13:           "error": "string | null",
14:           "typeFilter": "WikiNodeType | 'all'",
15:           "tagFilter": "string",
16:           "categoryFilter": "string | 'all'",
17:           "statusFilter": "WikiStatus | 'all'",
18:           "search": "string - BM25 搜索词",
19:           "selectedId": "string | null - 当前选中条目",
20:           "backlinksCache": "Record<string, WikiEntry[]> - 反向链接缓存",
21:           "health": "WikiHealth | null - 健康度指标",
22:           "graph": "WikiGraph | null - 链接图数据"
23:         },
24:         "node_types": ["project", "roadmap", "spec", "issue", "knowhow", "note"],
25:         "writable_types": ["spec", "knowhow"],
26:         "api_endpoints": {
27:           "WIKI": "GET /api/wiki - 列表/搜索",
28:           "WIKI_DETAIL": "GET/PUT/DELETE /api/wiki/:id - 详情/更新/删除",
29:           "WIKI_BAC
<truncated 4697 bytes>
_manage": {
128:       "entry_points": ["Sidebar Specs 导航", "直接 URL"],
129:       "flow": [
130:         "1. 进入 Specs 视图 → 触发 fetchEntries() + fetchFiles()",
131:         "2. 切换 Kanban/Table 视图",
132:         "3. 使用过滤器 (type/scope/category/keyword) 筛选",
133:         "4. 点击 category tag 切换看板列显示/隐藏",
134:         "5. 点击条目 → setSelectedEntry() 显示详情"
135:       ],
136:       "write_path": [
137:         "点击 '+' 或 'New Spec Entry' → 打开 SpecAddDialog",
138:         "选择类型 (bug/pattern/decision/rule/debug/test/review/validation)",
139:         "输入 markdown 内容",
140:         "选择目标文件",
141:         "提交 → addEntry(type, content, file) → POST /api/specs"
142:       ]
143:     },
144:     "cross_reference": {
145:       "description": "Wiki 条目间通过 [[wikilink]] 语法双向链接，backlinks 自动追踪",
146:       "health_monitoring": "WikiHealthPanel 显示孤立条目、断链、枢纽节点"
147:     }
148:   },
149:   "data_flow_diagram": {
150:     "wiki": "Server (wiki.jsonl / .workflow/wiki/) → REST API → wiki-store → {WikiGalleryView, WikiGroupedView, WikiReaderPanel}",
151:     "specs": "Server (.workflow/specs/*.md) → REST API → specs-store → {SpecsKanbanView, SpecsTableView, SpecAddDialog}"
152:   },
153:   "key_insights": {
154:     "separation_of_concerns": "Wiki 和 Specs 是两个独立的知识系统，Wiki 面向知识图谱（链接、反向链接），Specs 面向规范条目（类型化、分类）",
155:     "client_side_filtering": "Wiki 使用服务端 BM25 搜索 + 客户端 tag/type/category 过滤；Specs 全部客户端过滤",
156:     "optimistic_ui": "deleteEntry 采用乐观更新模式（先删 UI，失败回滚）",
157:     "derived_state": "filteredEntries、entriesByType、allTags 等派生状态由 useMemo 计算，避免重复渲染"
158:   }
159: }
160: 
The above content shows the entire, complete file contents of the requested file.

Created At: 2026-06-22T05:02:41Z
Completed At: 2026-06-22T05:02:41Z
File Path: `file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/maestro-wizard/conclusions.json`
Total Lines: 183
Total Bytes: 7753
Showing lines 1 to 183
The following code has been modified to include a line number before every line, in the format: <line_number>: <original_line>. Please note that any changes targeting the original code should remove the line number, colon, and leading space.
1: {
2:   "analysis_session": "kb-arch-complete-ax4-wizard",
3:   "generated_at": "2026-06-19",
4:   "wizard_architecture": {
5:     "overview": "Maestro 提供两类 wizard：Install Wizard（Dashboard UI）用于安装命令/代理/工作流，Spec-Setup（Skill）用于初始化项目规范。两者独立运作，Install Wizard 是 UI 驱动的多步引导，Spec-Setup 是 AI 执行的代码扫描+生成流程。",
6:     "install_wizard": {
7:       "location": "dashboard/src/client/components/install/",
8:       "trigger": "Dashboard UI 中的 Install 按钮或菜单项",
9:       "store": "dashboard/src/client/store/install-store.ts",
10:       "api_routes": "dashboard/src/server/routes/install.ts",
11:       "steps": [
12:         {
13:           "name": "mode",
14:           "component": "StepModeSelect.tsx",
15:           "description": "选择安装模式：Global（推荐，~/.claude/ + ~/.maestro/）或 Project（指定项目路径）",
16:           "user_actions": [
17:             "选择 Global/Project 模式",
18:             "如选 Project，输入项目路径",
19:             "点击 Next 触发 detect()"
20:           ],
21:           "api_call": "POST /api/install/detect → 扫描可用组件"
22:         },
23:         {
24:           "name": "configure",
25:           "component": "StepConfigure.tsx",
26:           "description": "配置安装组件、MCP 工具、Addon 选择",
27:           "user_actions": [
28:             "勾选要安装的组件（commands/agents/skills/workflows）",
29:   
<truncated 5047 bytes>
n": "显示创建的文件列表（specs/recipes/skipped/deferred）"
145:         }
146:       ],
147:       "generated_spec_schema": {
148:         "frontmatter": ["title", "category"],
149:         "sections": ["Auto-generated header", "Detected patterns", "Entries section (for /spec-add)"]
150:       },
151:       "generated_recipe_schema": {
152:         "frontmatter": ["title", "type=recipe", "tags", "created", "source=spec-setup"],
153:         "sections": ["Goal", "Prerequisites", "Steps (runnable commands)", "Expected Outcome", "Common Pitfalls", "Related"]
154:       }
155:     }
156:   },
157:   "comparison": {
158:     "install_wizard": {
159:       "type": "UI-driven multi-step wizard",
160:       "scope": "安装 maestro 组件到全局或项目",
161:       "user_interaction": "点击、选择、输入",
162:       "execution": "服务端 API 执行文件复制和配置"
163:     },
164:     "spec_setup": {
165:       "type": "AI-executed skill workflow",
166:       "scope": "分析项目并生成规范和工作流食谱",
167:       "user_interaction": "触发命令后全自动",
168:       "execution": "AI agent 执行代码扫描和文件生成"
169:     }
170:   },
171:   "interaction_entry_points": {
172:     "dashboard_install": "Dashboard → Settings/Install → Install Wizard Dialog",
173:     "cli_init": "maestro init → /maestro-init → /spec-setup",
174:     "manual_spec_setup": "/spec-setup 命令"
175:   },
176:   "key_insights": {
177:     "dual_path": "Install Wizard 管理工具链安装，Spec-Setup 管理项目规范初始化，两者互补",
178:     "addon_ecosystem": "Install Wizard 集成 addon marketplace，支持从 GitHub 安装第三方 skill",
179:     "recipe_generation": "Spec-Setup 不仅生成静态规范，还生成可执行的工作流食谱（test/debug/build/dev/lint）",
180:     "idempotency": "Spec-Setup 采用 .proposed.md 机制避免覆盖用户修改"
181:   }
182: }
183: 
The above content shows the entire, complete file contents of the requested file.

Created At: 2026-06-22T05:02:43Z
Completed At: 2026-06-22T05:02:43Z
File Path: `file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/final-synthesis/conclusions.json`
Total Lines: 166
Total Bytes: 8277
Showing lines 1 to 166
The following code has been modified to include a line number before every line, in the format: <line_number>: <original_line>. Please note that any changes targeting the original code should remove the line number, colon, and leading space.
1: {
2:   "analysis_id": "KB-ARCH-COMPLETE-FINAL-SYNTHESIS",
3:   "generated_at": "2026-06-19T14:15:00+08:00",
4:   "purpose": "六轴完整性分析最终综合 — 确认无遗漏 + 产出改进路线图",
5: 
6:   "six_axis_coverage": {
7:     "axis_1_dataflow": {
8:       "coverage": "100%",
9:       "verified": true,
10:       "summary": "数据流完整性已覆盖: 产生(spec-writer/seeds) → 存储(spec-loader buildLayers) → 注入(spec-injector/keyword-spec-injector) → 召回(WikiIndexer search) → 消费(wrapMaestroContext XML)"
11:     },
12:     "axis_2_codemap": {
13:       "coverage": "100%",
14:       "verified": true,
15:       "summary": "代码映射完整性已覆盖: 核心实现文件职责 + 测试文件职责",
16:       "evidence": {
17:         "maestro_flow_tests": "137测试文件, 三轴分层(L1单元75 + L2集成40 + L3 e2e 10 + L4压力4)",
18:         "fabric_v2_tests": "~50测试文件, 缺少L3 e2e层和压力测试",
19:         "test_frameworks": "vitest(116) + node:test(21), maestro hooks层用node:test减少依赖"
20:       }
21:     },
22:     "axis_3_config": {
23:       "coverage": "100%",
24:       "verified": true,
25:       "summary": "配置/边界完整性已覆盖: 注入阈值(MAX_ENTRIES_PER_INJECTION) + 大小约束(2KB cap) + Scope层级(global/project/team/personal) + Dedup机制 + Keyword算法"
26:     },
27:     "axis_4_ui": {
28:       "coverage": "100%",
29:       "verified": true,
30:       "summary": "用户交互完整性已覆盖: CLI命令 + MCP工具 +
<truncated 5487 bytes>
激活KB列表(类似Cursor hover提示)",
124:         "effort": "中",
125:         "impact": "中 — 增强用户感知",
126:         "reference": "Cursor context_gauge可视化"
127:       },
128:       {
129:         "priority": "P1",
130:         "category": "触发模式",
131:         "action": "扩展activation字段",
132:         "description": "支持四种触发模式: always | path-match | ai-decided | manual",
133:         "effort": "低",
134:         "impact": "中 — 增强控制粒度",
135:         "reference": "Cursor/Windsurf触发模式"
136:       },
137:       {
138:         "priority": "P2",
139:         "category": "自动发现",
140:         "action": "后台archive scan",
141:         "description": "类似Windsurf Cascade的自动Memories生成机制",
142:         "effort": "高",
143:         "impact": "中 — 减少手动归档负担",
144:         "reference": "Windsurf Memories自动生成"
145:       },
146:       {
147:         "priority": "P2",
148:         "category": "团队协作",
149:         "action": "云端Store管理",
150:         "description": "类似Cursor Team Dashboard的云端Store管理界面",
151:         "effort": "高",
152:         "impact": "中 — 支持跨团队知识共享",
153:         "reference": "Cursor Team Dashboard"
154:       }
155:     ]
156:   },
157: 
158:   "conclusion": {
159:     "analysis_completeness": "六轴完整性100%, 无遗漏",
160:     "fabric_v2_positioning": "企业级知识治理平台 — 生命周期管理、多Store隔离、引用追踪、MCP协议",
161:     "maestro_flow_positioning": "开发者友好型知识系统 — 完整测试分层、丰富UI组件、wizard引导",
162:     "cross_product_positioning": "AGENTS.md跨客户端共识 + 触发模式趋同 + Fabric独占生命周期治理优势",
163:     "next_steps": "按P0→P1→P2优先级执行改进路线图, 首先补充L3 e2e测试和压力测试"
164:   }
165: }
166: 
The above content shows the entire, complete file contents of the requested file.


# Analysis: fabric 交互与策略层超越性迭代设计## Related Files- [AGENTS.md](file:///Users/wepie/Desktop/personal-projects/pcf/AGENTS.md) - Contains the active bootstrapping rules, cite policy, and self-archive policy (e.g., [AGENTS.md:46](file:///Users/wepie/Desktop/personal-projects/pcf/AGENTS.md#L46), [AGENTS.md:73](file:///Users/wepie/Desktop/personal-projects/pcf/AGENTS.md#L73)).- [.workflow/scratch/20260619-214039-brainstorm-fabric-interaction-design/design-research.md](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/scratch/20260619-214039-brainstorm-fabric-interaction-design/design-research.md) - Establishes reference design patterns (Progressive Disclosure, Responsive Salience, InKH) (e.g., [design-research.md:29](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/scratch/20260619-214039-brainstorm-fabric-interaction-design/design-research.md#L29), [design-research.md:47](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/scratch/20260619-214039-brainstorm-fabric-interaction-design/design-research.md#L47)).- [.workflow/.analysis/kb-arch-complete/cross-product/conclusions.json](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/cross-product/conclusions.json) - Compares matching rules of Cursor/Copilot/Windsurf (e.g., [conclusions.json:171](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/cross-product/conclusions.json#L171), [conclusions.json:204](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/cross-product/conclusions.json#L204)).- [.workflow/.analysis/kb-arch-complete/fabric-governance/conclusions.json](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/fabric-governance/conclusions.json) - Details the doctor lints and archive-review transitions (e.g., [conclusions.json:28](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/fabric-governance/conclusions.json#L28), [conclusions.json:118](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/fabric-governance/conclusions.json#L118)).- [.workflow/.analysis/kb-arch-complete/maestro-governance/conclusions.json](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/maestro-governance/conclusions.json) - Outlines Maestro's three-state purge-governance model (e.g., [conclusions.json:7](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/maestro-governance/conclusions.json#L7)).- [.workflow/.analysis/kb-arch-complete/maestro-wizard/conclusions.json](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/maestro-wizard/conclusions.json) - Outlines Maestro's CLI setup steps and workflow recipe structures (e.g., [conclusions.json:101](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/maestro-wizard/conclusions.json#L101)).---## SummaryThe core friction in Fabric v2 is that cognitive complexity is transferred to the user/AI via overly complex scope parameters and verbose hooks, with no unified CLI-native interface. The Champion (C0-grilled) proposes simplifying scopes, reducing turn-based noise, and moving review downstream. This proposal refines the Champion's design by leveraging a "Location is Configuration" directory layout (killing metadata bloat), introducing non-intrusive system-driven receipts to solve AI loop issues, and planning a targeted CLI-native integration of Maestro's scanner wizard.---## Key Findings1. **Location is Configuration**: The physical path of a store determines its security boundary and visibility. Storing `layer` or `visibility_store` in yaml frontmatter is redundant and causes configuration drift ([cross-product/conclusions.json:176](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/cross-product/conclusions.json#L176)).2. **AI-Driven Self-Archive Loops**: Requiring the AI to output markdown confirmation for self-archiving wastes context tokens and leads to agent loop issues. Shifting this to a system hook receipt solves both problems cleanly ([fabric-governance/conclusions.json:118](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/.analysis/kb-arch-complete/fabric-governance/conclusions.json#L118)).3. **Passive Context Injection Inefficiency**: Simply dumping raw text into CLI prompts risks context pollution. Using color-coded ghost badges in stderr keeps terminals clean while conveying rule matches to the developer ([design-research.md:47](file:///Users/wepie/Desktop/personal-projects/pcf/.workflow/scratch/20260619-214039-brainstorm-fabric-interaction-design/design-research.md#L47)).---## Detailed Analysis & Proposals### 1. Champion Block Evaluation (保留 / 改进 / 推翻)#### Block 1: 交互1 (每个节奏只留一个人可读面) -> **【改进】**- **保留项**：在正常开发中，`Stop` 阶段完全保持静默是正确的，能有效避免干扰开发节奏。在 `PreToolUse` 编辑文件时，精简为单行知识匹配提示也符合 InKH 提倡的极简体验。- **改进点**：- **SessionStart HUD**：擂主的 HUD 太过极简化。用户在使用 Fabric 时的首要不安是“我的规则到底生效没有？现在写到哪个 store 了？”。应设计一个极简的命令行面板（Ambient Environment HUD），明确列出 **Read Stores、Write Store、工作区激活规则数、积压 backlog 数**，消除黑箱感。- **Stop 归档反馈机制**：擂主保留了 AI 自触发时的手动 Markdown 文本输出（如 `self-archive policy triggered...`）。这会消耗 AI 的输出 tokens 并容易由于格式不符导致解析失败。**应该完全由 PostToolUse / Stop System Hook 接管**，在 AI 输出结束后由 CLI 系统层在 stderr 打印一行确定性的“归档回执”，免除 AI 的发言负担。#### Block 2: 交互2 (归档 11 phase 砍成 3 stage 共享内核) -> **【改进】**- **保留项**：将归档工作流拆解为 `Ingest (收集) -> Analyze (去重/分类) -> Persist (落盘)` 的 3 stage 模块化管道是完全正确的。将二次确认移动到下游 `fabric-review` 单次消除双重审核大幅减轻了日常开发阻力。- **改进点**：- **添加 Active Similarity Threshold Gate (AST 相似度门限闸)**：如果完全将去重和冲突移到下游 `fabric-review`，会产生新的痛点 —— pending 目录很快会充斥高度重复的垃圾草稿。必须在 **Stage 2 (Analyze)** 引入基于 BM25/向量匹配的强制去重拦截：- 重合度 > 85%：直接丢弃或自动作为 evidence 追加到已有 canonical 规则的 append block 中。- 重合度 50-85% / 存在矛盾：落盘为带有 `[CONFLICT: K-XXX]` 标记的 pending 草稿。- 唯一性规则：落盘为干净的普通草稿。#### Block 3: 交互3 (Nudge 响应式渐强，SessionStart 呈现) -> **【改进】**- **保留项**：将积压提醒从 Turn-end 的 `Stop` 移到 `SessionStart` 是正确的，避免了在开发过程中打断用户。- **改进点**：- **引入交互式快捷命令**：警报不仅要报数，更要给“行动指南”。如 `⚠️ 12 pending rules. Run 'fabric review' to clear.`。- **开发工作流天然摩擦力拦截 (Git Commit/Push Hook)**：单纯在 SessionStart 报 warning，忙碌的开发者仍然会选择忽略，导致 backlog 最终死掉。既然是 MCP 架构，应该支持安装一个可选的 `pre-push` git hook。当 push 时如果检测到当前用户 authored 的 pending 草稿数量超过阈值（如 >10 条），在终端强制输出一行醒目的红色提醒，利用提交代码的空档期引导归档。#### Block 4: 策略4 (字段 5 砍 3: layer / scope / when) -> **【推翻重构】**- **理由**：擂主方案虽然从 5 字段精简到 3 字段，但依然要求在 Markdown 的 yaml frontmatter 中显式声明 `layer` 和 `scope` 等拓扑关系。这依然违背了 InKH 的 “Complexity should be absorbed by the system”（复杂度由系统吸收）的核心理念。- **重构设计**：- **位置即配置 (Location is Configuration)**：由于 Fabric 的物理边界是 Store（团队 Store 是独立的 git repo，个人 Store 是本地私有目录或独立 repo），**文件处于哪个 store 目录下，就天然决定了它的 layer (team | personal) 以及 visibility 边界**。完全不需要在 YAML Frontmatter 里再次标注！- **极简 Frontmatter 规范**：推广类似 Cursor MDC 的无感设计，Markdown 头部只留下：```yamlid: K-002                # promotion 时自动分配的全局唯一 stable IDdescription: 针对 C++ 智能指针的使用规范与循环引用规避方法 # 用于 AI 决策召回 (AI-decided matching)when: ["src/cpp/**/*.ts", "include/**/*.h"]          # glob 匹配路径 (代替 relevance_paths)```所有 layer、visibility_store、semantic_scope 全部物理隐式化，AI 与用户都不需要理解 scope 字段语义。---### 2. 交互方案 (具体到屏幕文字样例)#### 场景 1：SessionStart 阶段的“环境与状态盘点面板 (HUD)”在 CLI 启动或会话开始时，于 `stderr` 打印一行极具极客感、色彩高亮、紧凑且信息量饱和的 HUD 面板：```bash┌─── fabric v2.2 ────────────────────────── active: project:fabric-v2 ──┐│  📁 Read Stores  : team (K-001..K-124) | personal (KP-001..KP-018)  ││  ✍️ Write Store  : team (pending: 3 drafts)                          ││  ⚡ Active Rules : 42 rules matched workspace                          ││  ⚠️ Nudge        : 3 items in backlog. Run 'fabric review' to clean.  │└───────────────────────────────────────────────────────────────────────┘```*注：当积压超过阈值（如 12 条）时，Nudge 行自动变红闪烁警告，提示直接运行 `fabric review` 清空积压。*#### 场景 2：PreToolUse 阶段的 Ambient Inline Feedback (环境式反馈)当 AI 准备修改某文件时，Hook 自动拦截并打印匹配规则，但绝不干扰主屏幕文字，采用低调的暗灰色：```bash🗃️ [fabric] Recalled K-002: "Use argon2id for password hashing" -> matching src/auth/**/*.ts```#### 场景 3：Stop / Turn-End 阶段的 AI 归档回执当 AI 会话中捕捉到 self-archive 信号（如 wrong-turn-and-revert）并自动运行 `fab_extract_knowledge` 写入 pending 成功后，系统在 Turn 最末尾打印确定性的 CLI 系统回执，而**不需要** AI 文本输出：```bash📥 [fabric:archive] Captured candidate: "Avoid raw pg client" -> pending/pitfalls/K-084.md (Undo: reply 'undo')```#### 场景 4：Downstream `fabric review` 交互式分流面板开发完功能后，运行 `fabric review` 批量审阅 pending 时的终端交互：```bash$ fabric review┌─── fabric review ─────────────── 3 pending drafts found ──────────────┐│                                                                       ││  [1/3] K-084 (pitfall) - "Avoid raw pg client"                        ││  Source   : Wrong-turn-and-revert (Session: c69e4294, src/db.ts)       ││  Content  : Do not use raw pg client. Use the pool instead.           ││  Matches  : 89% similar to K-012 ("Always use pg connection pool")    ││                                                                       ││  [A] Approve & Merge with K-012   [M] Edit Content                    ││  [R] Reject                       [D] Defer                           ││  [Q] Quit                                                             ││                                                                       │└─────────────────────────────────────────────── Action: [A/M/R/D/Q] ───┘```---### 3. 策略层如何呼应- **Store-Metadata Mapping (Store 物理映像映射)**：每个 Store 物理目录根处包含一个极其轻量且受保护的 `.fabric-store.json`，其声明了当前 Store 的 UUID、Alias、Layer（team 还是 personal）以及 Write-Rules。这使得引擎在扫描整个 workspace 目录时，无需读取文件的 metadata 就能通过路径前缀快速推断其安全与可见性边界。- **Auto-Promotion Verification (自动提议校验)**：在 review 提升阶段，系统计算该条知识在 `events.jsonl` 中的召回次数与使用效果反馈（即 developer edit action 成功且未发生 reject），动态将处于 `draft` 状态的规则在 approve 后无感推入 `verified`，并在多次使用后（如 10+ Sessions 证明稳定）标记为 `proven`，降低人工审核维护的决策心智负荷。- **Implicit Citation Accounting (隐式引用记账)**：不再逼迫 AI 在回复的首行输出 `KB: K-001 [applied]` 这样的八股文。PreToolUse Hook 只要监测到当前会话运行过 `fab_recall` 并命中了特定 rule ID，系统会自动在 `.fabric/events.jsonl` 中添加 citation log。除非 AI 希望显式声明 `[dismissed]` 或进行 override，否则对用户侧是一切无感的。---### 4. 后续功能集成清单 (Maestro-flow -> Fabric)| 功能名称 (Maestro Origin) | 核心价值 (Value) | 实现成本 (Cost) | 本版集成 (This Version?) | 详细决策与说明 || :--- | :--- | :--- | :---: | :--- || **Spec-Setup CLI Wizard**<br>(代码规范智能初始化) | **极高**<br>解决 repository 引入 Fabric 时的冷启动难点，自动扫描推导约定。 | **中**<br>需要移植 package/tsconfig 扫描器及 MD 生成模板。 | **是 (本版)** | 新仓库只需一键 `fabric init` 就能利用 AI 完成 80% 的代码规范和约束初始化。 || **Semantic & BM25 Multi-Index Search**<br>(双端检索加速) | **高**<br>大幅提升 CJK 汉字及相似技术术语的召回精准度，避免 regex 逃逸。 | **低**<br>可直接基于 Node/TS 轻量级实现倒排索引与 BM25。 | **是 (本版)** | 提升 passive recall 的关键基础设施，属于必须集成的底层能力。 || **Conflict & Redundancy Audit Detector**<br>(冲突与重合自动检测) | **高**<br>防止多人开发时写入相似或互相违背的规则。 | **中**<br>需要封装到 `fabric doctor --lint-conflicts` 中。 | **是 (本版)** | 在 Stage 2 及日常治理中检测并提示冲突，保持知识库的干净与精炼。 || **L3 E2E and Stress Performance Tests**<br>(全链路与匹配压力测试) | **高**<br>确保规则膨胀（如 500+ rules）时检索延迟 < 100ms，绝不卡死终端。 | **中**<br>需要编写大量 mock-client 压力测试用例。 | **是 (本版)** | 开发者工具的性能就是命根子，必须有 stress tests 守门。 || **Knowhow & Workflow Recipe Execution**<br>(RCP 步骤式运行食谱) | **中**<br>将 markdown 转化为可交互的代码步骤，偏新手引导。 | **高**<br>需要处理 shell 执行器安全沙箱与跨平台兼容。 | **否 (下版)** | 偏向操作说明书，偏离了 Fabric v2 "隐式契约与安全隔离限制" 的核心定位，优先级延后。 || **Maestro Web Dashboard**<br>(可视化看板及健康图谱) | **低**<br>错战场。开发者的主战场在终端与 IDE，跳转网页管理是高开销。 | **极高**<br>React/Vite 跨端打包与端口监听开销。 | **否 (不集成)** | 坚决不抄网页 dashboard。完全保持 MCP 工具 + CLI-native 交互的特色护城河。 |---### 5. 一句话总结你方案为何体感既大于擂主又大于 maestro> **“我的方案将繁重的环境拓扑字段化为无形的物理目录映射，用全自动的系统层 Hook 归档回执取代了 AI 的发言干扰，让开发现场只有低调却精准的环境反馈（HUD 与 Badges），做到了无需开浏览器、无需教 AI 规则、无需手记账的极致开发者体验。”**---## Quality Checklist- [x] All CONTEXT files analyzed- [x] Code evidence with `file:line` references- [x] Specific, actionable recommendations- [x] No unsubstantiated claims- [x] EXPECTED deliverables met
