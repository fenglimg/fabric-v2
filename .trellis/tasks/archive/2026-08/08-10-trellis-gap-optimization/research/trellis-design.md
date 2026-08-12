# Research: Trellis 工作流系统设计盘点(本仓实装版)

- **Query**: 全面盘点本仓已实装的 Trellis 工作流系统设计,产出机制清单,供"对照 Trellis 优化 Fabric"的 gap 分析使用
- **Scope**: internal(仓库根下 `.trellis/` + `.claude/` + `.cursor/` + `.agents/` + `.codex/`)
- **Date**: 2026-08-10
- **Trellis 版本**: 0.6.14(`.trellis/.version`),npm 包 `@mindfoldhq/trellis`(CLI)+ `@mindfoldhq/trellis-core`(SDK)

---

## 〇、系统全景(一句话地图)

Trellis = **一份 prompt-as-data 的 workflow.md(状态机)+ 一套确定性 Python 脚本引擎(task.py 等)+ 一组按平台分发的 hooks/skills/agents/commands + 文件化的任务工件与知识库**。AI 只做判断,状态、路由、注入全由脚本与 hook 确定性完成。

```
.trellis/
├── workflow.md          # 单一事实源: 3-phase 状态机 + [workflow-state:*] 面包屑正文 + 平台标记块
├── config.yaml          # 项目配置(hooks/packages/channel guard/注入限额/skip keyword)
├── .version / .template-hashes.json   # 版本 + 188 个分发文件的 SHA-256 漂移检测清单
├── scripts/             # 确定性引擎: task.py / get_context.py / add_session.py + common/ 16 模块
├── spec/                # 知识库: <package>/<layer>/index.md + guides/ 思维清单
├── tasks/{MM-DD-slug}/  # 任务工件: task.json + prd.md + design.md + implement.md + research/ + *.jsonl
├── tasks/archive/{YYYY-MM}/           # 归档
├── workspace/<dev>/journal-N.md       # 跨 session 工作日志(2000 行轮转)
├── agents/{implement,check}.md        # channel runtime 平台无关 role card
└── .runtime/sessions/<context-key>.json  # per-session active-task 指针(gitignored)

平台层(每端一份完整拷贝): .claude/ .cursor/ .codex/ .agents/(hooks + skills×9 + agents×3 + commands×2)
CLI 全局能力: trellis channel(多 agent 事件总线) / trellis mem(跨会话对话检索) / trellis update(模板升级)
```

---

## 一、机制清单

### 1. 任务生命周期与 Phase Gate(状态机)

- **干什么**: 把开发流程固化为 Phase 1 Plan → Phase 2 Execute → Phase 3 Finish,每步标注 `[required · once]` / `[required · repeatable]` / `[optional]` / `[on demand]`,状态由 `task.json.status`(planning → in_progress → completed)驱动。
- **实现在哪**: `.trellis/workflow.md`(全文 3.8 万字,Phase Index + 逐步 walkthrough);状态翻转在 `.trellis/scripts/common/task_store.py`(create 写 planning)与 `.trellis/scripts/task.py` `cmd_start`(planning→in_progress)、`cmd_archive`(→completed 并搬目录)。
- **巧思**:
  - **两道独立的同意 gate**: "任务创建同意 ≠ 实施批准"写进 workflow.md Request Triage 与 brainstorm skill 的 Non-Negotiable Planning Contract——用户批准建任务后仍必须在"最终规划摘要"之后**另发一条消息**显式批准,才能 `task.py start`。防 AI 拿最初的 "去做吧" 当全程授权。
  - **create 与 start 分离**: 1.0 只 create(status=planning,面包屑立即切到 planning 态),start 留给 1.4 的 review gate。脚本注释里明确"不要在 create 时顺手 start"。
  - **轻重分级**: lightweight 任务 PRD-only 合法;complex 任务必须 prd+design+implement 三件套才许 start。产物存在性本身就是 gate 输入(`[once]` 步骤"输出已存在则跳过")。
  - **可回滚的 phase**: check 发现 prd 缺陷 → 回 Phase 1 改 prd 再重进 Phase 2,回滚是流程的一等公民(workflow.md 2.3)。

### 2. Per-turn 面包屑注入(workflow-state breadcrumb)

- **干什么**: 每个用户回合,UserPromptSubmit hook 解析当前 active task 的 status,把 workflow.md 里对应 `[workflow-state:STATUS]...[/workflow-state:STATUS]` 块的正文注入为 `<workflow-state>` 上下文,持续提醒 AI"你在哪一步、下一步做什么、该用哪个 skill/agent"。
- **实现在哪**: `.claude/hooks/inject-workflow-state.py`(注册于 `.claude/settings.json` UserPromptSubmit);正文全部内联在 `.trellis/workflow.md` 的 Phase Index 节;解析器 `load_breadcrumbs()` 用正则抓 tag 块。
- **巧思**:
  - **Prompt-as-data**: 脚本里**没有任何 fallback 文案字典**(v0.5.0-rc.0 起),workflow.md 是唯一事实源;tag 缺失时降级为一句可见的 "Refer to workflow.md for current step.",**故意让用户看见坏状态去修**,而不是 hook 静默兜底掩盖。
  - **不变量有测试守护**: workflow.md 注释里写明 invariant——"每个 `[required · once]` 步骤必须在对应 phase 的 workflow-state 块里有 enforcement 行"(test/regression.test.ts),因为面包屑是唯一 per-turn 通道,漏写 = AI 静默跳步(曾实际发生 Phase 1 gate skip 与 3.4 commit skip)。
  - **逃生舱**: 用户 prompt 里带独立词 `no-trellis`(可配 `prompt_injection.skip_keyword`)则本回合跳过注入——word-boundary 匹配防误触。
  - **自定义状态可扩展**: 加 `[workflow-state:my-status]` 块 + 用 lifecycle hook 写 task.json.status 即可,状态机文本级可编程。
  - 平台细节适配集中在 hook 内(Gemini 事件名 BeforeAgent、Kiro 裸文本输出、Codex 加 `<codex-mode>` banner 与 `-inline` 变体 key)。

### 3. Brainstorm 规划纪律(planning contract / evidence rule / 收敛 gate)

- **干什么**: Phase 1 的需求发现 skill,把"聊需求"变成有硬性契约的收敛过程。
- **实现在哪**: `.claude/skills/trellis-brainstorm/SKILL.md`(约 200 行)。
- **巧思**(这是全系统提问纪律最重的一份 prompt):
  - **Non-Negotiable Planning Contract**: 只要还有用户拥有的产品/范围/UX/兼容/风险/验收决策未解决,回合必须以**恰好一个最高价值问题**结束,不许改代码、不许 dispatch、不许 start。
  - **Non-Negotiable Evidence Rule**: "凡是代码库能回答的问题,去查代码库,不许问用户"——只许问产品意图、偏好、范围边界、风险容忍;并明确"已有 pattern 只是选项和推荐证据,不是决策"。
  - **提问格式四要素**: 每个问题必须带 决策点 / 为什么重要 / 我的推荐 / 选别的的 trade-off;一条消息只问一个问题;禁止流程性问题("要不要我搜一下")。
  - **每答即写**: 每次用户回答后立刻更新 prd.md、重算决策清单、回到证据检查——需求文档是活的收敛账本,不是最后补写的总结。
  - **Requirement Convergence Gate**(6 项检查:价值显式/in-out scope 显式/AC 可观察/用户决策清零/blocking questions 清零/技术未知已研究或显式延后)+ **PRD Convergence Pass**(收口前把 prd.md 无损重写一遍:合并重复事实、折叠临时 brainstorm 段落、保留全部 file:line 锚点与决策)——"整理 PRD"本身是必经 gate 而非可选清洁。
  - 附送一个 First Principles 思维框架(重述问题→列基本事实→挑战假设→自底向上重建→验证),用于需求含糊或过度设计时。

### 4. 任务工件体系(task directory as contract)

- **干什么**: 每个任务一个目录 `.trellis/tasks/{MM-DD-slug}/`,固定工件分工:`task.json`(结构化元数据)/ `prd.md`(需求+AC,禁放技术设计)/ `design.md`(复杂任务技术设计)/ `implement.md`(复杂任务执行清单+验证命令+回滚点)/ `research/*.md`(每研究主题一文件)/ `implement.jsonl` + `check.jsonl`(子代理上下文清单)。
- **实现在哪**: 创建逻辑 `.trellis/scripts/common/task_store.py` `cmd_create`(写 task.json 全 schema + 默认 prd 骨架 + 种子 jsonl);工件契约描述在 `.trellis/workflow.md` "Planning Artifacts" 节与 brainstorm skill "Artifact Rules"。
- **巧思**:
  - **task.json schema 一次成型**: id/title/description/status/package/priority/creator/assignee/branch/base_branch/worktree_path/pr_url/subtasks/children/parent/meta 等全部字段 create 时就位(空值显式 null),后续命令(set-branch/set-meta/add-subtask)只做增量写。
  - **base_branch 智能默认**: create 时解析 origin/HEAD 而非当前 checked-out 分支,防止"从 feature 分支建任务把 feature 误标成 PR 目标"(#399);解析不到再降级+警告+可 `--base-branch` 覆盖。
  - **父子任务树非依赖系统**: parent 拥有需求源/任务映射/跨子验收/最终集成 review;子任务必须独立可验证;**依赖顺序必须写进子任务 prd/implement.md 而不是靠树形位置暗示**。归档 parent 时自动清 children 的 parent 指针,list 显示 parent 的派生状态 "active"(存储值不动)。
  - **防呆细节密度高**: `--slug` 带日期前缀自动剥离或报错(防 MM-DD-MM-DD);同名已归档任务拒绝重建;archive 前校验目标真的在 tasks/ 下(`is_within_tasks_dir`,防 "archive src" 把源码目录搬走)。
  - **research 持久化铁律**: "Research output must be written to files, not left only in the chat. Conversations get compacted; files don't."(workflow.md 1.2)——research 子代理的存在意义就是产出文件。

### 5. JSONL manifest 机制(implement.jsonl / check.jsonl)

- **干什么**: 每任务两份 per-agent 上下文清单,一行一个 `{"file": <path>, "reason": <why>}`,规划期由 AI 人工策展(只放 spec 与 research 文档,禁放代码路径),Phase 2 dispatch 子代理时 hook 按清单把文件正文内联进子代理首 prompt。
- **实现在哪**: 种子写入 `.trellis/scripts/common/task_store.py` `_write_seed_jsonl`;增删校验 `.trellis/scripts/common/task_context.py`(add-context/validate/list-context);消费端 `.claude/hooks/inject-subagent-context.py`。
- **巧思**:
  - **自描述种子行**: create 时写一行 `{"_example": "Fill with ... Delete this line once real entries are added."}`——没有 `file` 字段,所有消费者天然跳过它;它纯粹是**写在数据文件里的给 AI 的操作提示**。种子行不算 ready:start gate 要求两文件各至少一条真实条目。
  - **卫生检查是警告不是阻塞**: `task.py validate` 对代码后缀(.ts/.py/...)条目发黄色警告("agents read code themselves"——代码该由子代理自己去读 diff,不该预注册),对超过注入限额的大文件预警"将被截断";硬错误只有路径不存在/JSON 非法。
  - **归档自引用重绑**: 已归档任务的 jsonl 里指向历史路径 `tasks/<name>/...` 的条目,validate 时自动重映射到 archive 副本并防目录穿越(`_resolve_context_entry_path`)。
  - **平台感知种子**: 只有探测到 sub-agent-capable 平台配置目录(`.claude`/`.cursor`/... 15 个)才播种 jsonl;inline 平台(Kilo/Antigravity/Devin/codex-inline)跳过,改用 before-dev skill 拉取——同一工件在不同能力平台有不同存在策略。

### 6. 子代理上下文注入(hook 重写 prompt + 字节预算 + 双保险)

- **干什么**: PreToolUse(Task/Agent)hook 拦截 `trellis-implement`/`trellis-check`/`trellis-research` 的 dispatch,把 jsonl 清单文件 + prd/design/implement.md 正文全部内联,重写子代理 prompt(附角色说明/工作流/约束),再放行。
- **实现在哪**: `.claude/hooks/inject-subagent-context.py`(1149 行,多平台 payload 解析);限额配置 `.trellis/config.yaml` `context_injection.*`;Cursor 镜像 `.cursor/hooks/inject-subagent-context.py`。
- **巧思**:
  - **三级字节预算**: per-file 32KB / per-artifact 64KB / total 128KB(可配)。超 per-file 截断+`[Trellis: truncated at N bytes — read <path> for the full content]` 提示;**总预算耗尽后剩余文件降级为 index 行**(path+reason+size)而不是丢弃——上下文经济学显式建模,截断永远留自取线索。UTF-8 截断不切多字节序列(`truncate_utf8` 手写回退连续字节)。
  - **注入标记 + 拉取兜底**: 注入的 prompt 首行埋 `<!-- trellis-hook-injected -->`;agent 定义文件(`.claude/agents/trellis-implement.md`)写明协议——看到标记就直接干活,没看到(Windows/resume/hooks 禁用)就按 dispatch prompt 首行 `Active task: <path>` 自己去读 jsonl+工件。**push 注入失败自动退化为 pull,两条路径产出同一上下文集合。**
  - **递归防护**: agent 定义里 Recursion Guard——"你已经是 trellis-implement,不许再 spawn implement/check;面包屑说要 dispatch 是对主会话说的,你的存在已满足它"。dispatch prompt guard 同样要求主会话在 prompt 里声明这一点。双向写,防子代理套娃。
  - **[finish] 变体**: check dispatch prompt 含 `[finish]` 时切换到 finish prompt 模板(允许子代理直接更新 spec、按 update-spec 7 段模板写跨层契约)——同一 agent 类型按阶段换角色说明。
  - **二进制守卫**: 内容含 \x00 或非法 UTF-8 → 不内联,发 `[not inlined (binary file)]` 通知行。

### 7. Spec 体系(结构化知识库 + 分层注入)

- **干什么**: `.trellis/spec/<package>/<layer>/` 存本项目可执行工程约定,每层 `index.md` 是入口(带 Pre-Development Checklist + Quality Check 两节,指向同目录具体 guideline 文件);`.trellis/spec/guides/` 存跨包"思维清单"(cross-layer / code-reuse thinking guide)。
- **实现在哪**: 目录 `.trellis/spec/`(本仓已按 4 个 fabric 包 × frontend/backend 生成模板,状态多为 "To fill";guides/ 有实内容);发现命令 `get_context.py --mode packages`(`.trellis/scripts/common/packages_context.py`);组织与刷新规则 `.claude/skills/trellis-meta/references/local-architecture/spec-system.md`。
- **巧思**:
  - **Spec vs Guide 二分法**(update-spec skill):"how to write the code" → spec 层文件(签名/契约/矩阵/用例);"what to consider before writing" → guides/(短清单,指回 spec)。放错位置的判例表都给了。
  - **index 是指针不是终点**: before-dev/check skill 都强调 "The index is NOT the goal",必须跟进读到具体 guideline 文件——两跳结构控制注入体积。
  - **guides 的立论**: "Most bugs come from 'didn't think of that', not from lack of skill"——思维清单的目标是扩展考虑面,不是复述规则(`.trellis/spec/guides/index.md`)。
  - **SessionStart 只注入 index 清单**: `.claude/hooks/session-start.py` `_collect_spec_index_paths` 只列 index.md 路径("Available indexes (read on demand)"),正文按需读;monorepo 下可按 `spec_scope` 配置(active_task / 显式列表)收窄到当前任务的 package,并对 legacy 平铺结构发迁移警告。
  - **registry 刷新**: config 里可配 `registry.spec.source`,`trellis update` 拉新 spec 模板;本地已改文件靠 `.template-hashes.json` 识别为 "modified by user" 冲突,写 `.new` sidecar 而非覆盖。

### 8. before-dev 上下文注入(写码前强制读规范)

- **干什么**: 写任何代码前的强制步骤:读任务工件 → `--mode packages` 发现相关包/层 → 读对应 index.md 的 Pre-Development Checklist → 读 checklist 指向的具体 guideline → 读共享 guides。
- **实现在哪**: `.claude/skills/trellis-before-dev/SKILL.md`(40 行,最短的 skill)。
- **巧思**: 在 sub-agent 平台上这条链已被 hook 注入取代(jsonl 内联),skill 主要服务 inline 平台与主会话直编场景——**同一"规范先行"原则,按平台能力有 push(hook)与 pull(skill)两种实现**,workflow.md 用平台标记块二选一渲染。

### 9. Check 质量闭环(自修复 + 末次全量)

- **干什么**: Phase 2.2 必经步骤。skill 版六步:识别变更(git diff)→ 读工件+spec Quality Check → 跑 lint/typecheck/tests → 四张 checklist(代码质量/测试覆盖/spec 同步/跨层维度)→ 报告并**直接修复**。agent 版(`trellis-check`)同流程,核心约束 "Fix issues yourself, don't just report"。
- **实现在哪**: `.claude/skills/trellis-check/SKILL.md`;`.claude/agents/trellis-check.md`;check prompt 模板在 `inject-subagent-context.py` `build_check_prompt`。
- **巧思**:
  - **check 内嵌知识沉淀触发器**: checklist 里有一问 "If I fixed a bug or discovered something non-obvious, should I document it so future me won't hit the same issue?" → YES 则更新 spec——质量检查环节顺手当知识捕获闸口。
  - **跨层维度按条件展开**: 变更跨 3+ 层才做数据流追踪(Storage→Service→API→UI 双向);改常量/建工具函数才做复用检查(先 grep 再新建);单层变更显式跳过——checklist 有适用条件,不是无脑全跑。
  - **Final pass 全量语义**: 提交前的最后一次 2.2 必须 full-scope(列出全部受影响包、加载每个包的 Quality Check),因为"mid-iteration 的局部 check 抓不到跨包问题"(workflow.md 2.2)。
  - check 与 implement 是**两个独立子代理、两份独立上下文清单**(check.jsonl 可配质量类 spec),不是同一 agent 自查。

### 10. break-loop 复盘机制(打破 fix-forget-repeat)

- **干什么**: 修完反复出现的 bug 后的深度归因 skill:五维分析(根因分类 A-E / 历次修复为何失败 / 预防机制矩阵 / 系统性扩展 / 知识捕获)+ 贝叶斯推理框架(先验表→证据可靠性分级→信念更新→找判别性证据→按置信度行动)。
- **实现在哪**: `.claude/skills/trellis-break-loop/SKILL.md`。
- **巧思**:
  - **根因有封闭分类学**: A 缺规范 / B 跨层契约 / C 变更传播失败 / D 测试覆盖缺口 / E 隐式假设——给归因提供词汇表,而不是自由发挥。
  - **"失败的修复"单独成维**: Surface Fix / Incomplete Scope / Tool Limitation / Mental Model 四类,逼着复盘"为什么前几次没修好"而不只庆祝最终修好。
  - **落地强制**: "After Analysis: Immediate Actions — you MUST immediately update spec/guides… The analysis is worthless if it stays in chat. The value is in the updated specs."——复盘的交付物是 spec diff,不是分析文本。
  - 反谬误表(base rate neglect / confirmation bias / anchoring)直接写进 prompt。

### 11. update-spec 知识沉淀路径(code-spec first)

- **干什么**: Phase 3.3 `[required · once]` 的知识写回 skill:判断本任务是否产生了值得记录的模式/坑/决策,写进 `.trellis/spec/`。
- **实现在哪**: `.claude/skills/trellis-update-spec/SKILL.md`(357 行,最重的沉淀 prompt)。
- **巧思**:
  - **Code-Spec First Rule**: spec 指"可执行契约"——具体签名、payload 字段、env key、边界行为、可测试的校验/错误行为,不是原则性空话。触发条件(新/改命令签名、跨层契约、schema 迁移、infra 集成)命中则**强制 7 段模板**:Scope/Signatures/Contracts/Validation&Error Matrix/Good-Base-Bad Cases/Tests Required/Wrong vs Correct。
  - **更新类型有路由表**: Design Decision / Convention / New Pattern / Forbidden Pattern / Common Mistake / Gotcha 各有目标 section 与写作模板(全部给了 markdown 骨架)。
  - **先读后写**: Step 3 强制先读目标 spec 防重复;Quality Checklist 10 项(有代码例?讲了 why?有签名契约?有错误矩阵?…)。
  - **"没东西可更新"也要走判断**: workflow.md 3.3 写明 "Even if the conclusion is 'nothing to update', walk through the judgment"——把沉淀从"想起来才做"变成"每任务必过的闸口"。
  - **commit 前再拦一道**: Phase 3.4 的 Spec-sync preamble——起草 commit 前自问是否有该落 spec 的知识,有则先回 3.3,"spec writes belong in the same task's commit batch, not as a forgotten follow-up"。

### 12. session-insight / trellis mem(跨会话对话记忆)

- **干什么**: `trellis mem` CLI 索引本机各平台的原始对话日志(`~/.claude/projects/`、`~/.codex/sessions/`、Pi、ZCode sqlite),支持 list/search/context/extract/projects,并能按 Trellis 任务边界切片(`--phase brainstorm|implement|all`,切点 = `task.py create` 与 `task.py start` 出现的位置)。skill 教 AI 何时该伸手、拿到后怎么处置。
- **实现在哪**: `.claude/skills/trellis-session-insight/SKILL.md` + `references/cli-quick-reference.md` / `triggering-patterns.md`;架构描述 `.claude/skills/trellis-meta/references/local-architecture/workspace-memory.md`。
- **巧思**:
  - **capability skill, not workflow**: 明确声明"无固定输出文件、无必写回步骤、无'每次 finish-work 必跑'规则"——"It is a tool, not a ceremony." 触发标准是"资深同事会不会问'这事我们不是聊过吗'"。
  - **反滥用清单与正用清单等长**: 何时不用(上下文已在手/问的是代码事实/在子代理里/用户说别翻历史)写得和何时用一样细。
  - **返回物定位为 raw material**: 五种处置(引用回帖/更新 prd/design/追加任务 notes/升级进 spec(转交 update-spec)/纯内化不写)由当下对话决定,"Forcing every recall into a fixed file makes the file grow into noise."
  - **零上传**: 全部本地读,平台 JSONL 只读不写。
  - 与 workspace journal 的分工:journal 是**刻意书写**的工作记录,mem 是**原始对话**的事后检索——两层记忆,精度换成本。

### 13. Workspace journal(刻意记录的 session 日志)

- **干什么**: `.trellis/workspace/<developer>/journal-N.md` 记录每个 AI session 的标题/commit/摘要/分支;`index.md` 用 `<!-- @@@auto:* -->` 标记块维护统计与历史表;2000 行自动轮转新文件;记录后自动 commit(`chore: record journal`,可关)。
- **实现在哪**: `.trellis/scripts/add_session.py`(681 行:branch 四级解析、结构化 section 参数 `--change/--test/--next-step`、stdin 详情);身份 `.trellis/scripts/init_developer.py` → `.trellis/.developer`(gitignored,本地身份)。
- **巧思**: 三层记忆的**放置决策规则**写成了口诀(workspace-memory.md):"只对当前任务有用 → task 目录;描述本 session 发生了什么 → journal;未来每次写码都该遵守 → spec"。auto 标记块让脚本可幂等重写统计段而不动人写的 Notes。

### 14. Channel 多 agent 协作 runtime

- **干什么**: `trellis channel` 用 append-only JSONL 事件日志(`~/.trellis/channels/<project>/<channel>/events.jsonl`)做本地多 agent 总线:spawn 对等 worker 进程(Claude/Codex/任意 role card)、forum/thread 持久讨论板、进度审计、中断重定向、dispatcher 等待。
- **实现在哪**: 运行时在 CLI 包内(不在仓库);项目侧配置 `.trellis/config.yaml` `channel.worker_guard.*`(idle_timeout 5m / max_live_workers 6,精度链 CLI flag > env > config > default);role card `.trellis/agents/{implement,check}.md`;用法 skill `.claude/skills/trellis-channel/SKILL.md` + 5 个 reference;架构 `.claude/skills/trellis-meta/references/local-architecture/multi-agent-channel.md`。
- **巧思**:
  - **事件溯源 + 文件锁定序**: events.jsonl append-only,`.seq` sidecar + `.lock` 文件锁分配序号,durable idempotencyKey 防重放;**禁止手编事件文件**(meta skill Do Not 列表)。
  - **存储在项目树外**(`~/.trellis/channels/`),用户私有,与 repo 解耦;project bucket 名由绝对路径扁平化派生(对齐 Claude 的 `~/.claude/projects/` 约定)。
  - **OOM guard 双层**: spawn 时清理过期 idle worker + 执行活 worker 预算;supervisor 内 worker 持续 idle 超时自杀。
  - **完成信号用系统事件不用自定 tag**: dispatcher 等待要用 trellis 发出的 `--kind done`/`turn_finished`,不要依赖 worker 自己跑 `send --tag`——"LLM workers commonly write the tag string into prose instead of running the actual CLI command"(对 LLM 不可靠行为的工程化防御)。
  - **两套 agent 定义分家**: 平台子代理文件(`.claude/agents/trellis-implement.md`)与 channel role card(`.trellis/agents/implement.md`)是两个 surface,改错地方无效——meta skill 专门立规则提醒。
  - **用轻原语挡重工具**: skill 里给了"什么时候别用 channel"(一次 Bash 够就直接跑/静态 review 读文件回帖/要记忆用 mem)。

### 15. meta 自定制(系统自描述)

- **干什么**: `trellis-meta` skill + 23 个 reference 文档,让 AI 在用户项目内理解并安全修改 Trellis 本身:分层架构(workflow/persistence/platform/channel)、每平台文件地图、9 个定制主题(改 workflow/task 生命周期/上下文加载/hooks/agents/skills/spec 结构/本地约定)。
- **实现在哪**: `.claude/skills/trellis-meta/SKILL.md` + `references/{local-architecture,platform-files,customize-local}/*.md`。
- **巧思**:
  - **系统把"怎么改我自己"当作一等文档随身分发**——AI 是 Trellis 的运维者,不只是用户。
  - **Do Not 列表是边界工程**: 不改全局 npm 安装/不改 node_modules/不把团队私有规则写进 bundled skill(会被 update 覆盖,该去 spec 或 project-local skill)/不手编 events.jsonl/不吹不存在的 knob("cross-check against `trellis --help` before claiming a knob exists")。
  - **workflow 模板可选**: init 时从 `native` / `tdd` / `channel-driven-subagent-dispatch` / marketplace 模板选 workflow.md 初始内容,`trellis workflow --template <id>` 可重选——流程本身是可替换的数据。

### 16. 跨端分发(full-copy + hash 漂移检测;与 Fabric managed-block 的对照物)

- **干什么**: `trellis init` 把 hooks/skills/agents/commands **整目录复制**进每个平台目录(本仓:`.claude/` 52 文件、`.cursor/` 52、`.agents/` 46、`.codex/` 6、`.trellis/` 32,共 188 个文件),`.trellis/.template-hashes.json` 记录每个分发文件的 SHA-256;`trellis update` 升级时以 hash 判定"用户是否改过":未改 → 覆盖,改过 → 写 `.new` sidecar 不破坏。
- **实现在哪**: `.trellis/.template-hashes.json`(`{"__version": 2, "hashes": {path: sha256}}`);镜像目录 `.cursor/`(hooks.json + 同名 hooks/skills/agents)、`.agents/skills/`(共享 skill 层,含 command 的 skill 形态:trellis-start/continue/finish-work)、`.codex/`(config.toml + agents/hooks/skills)。
- **巧思**:
  - **内容单源、载体多份**: workflow.md/spec/task 工件只有 `.trellis/` 一份;平台目录复制的是**接入层**(hook 脚本、SKILL.md、agent md)。平台差异用三招消化:① workflow.md 里 `[平台列表]...[/平台列表]` 标记块按平台渲染(解析器 `.trellis/scripts/common/workflow_phase.py` `filter_platform`,大小写/连字符模糊匹配);② hook 脚本内部 per-platform 输出 shape 分支(Claude JSON envelope / Cursor snake_case / Kiro 裸文本 / Gemini BeforeAgent / ZCode 单 key 防重复);③ 能力降级路径(无 hook 平台用 trellis-start skill 手动拉起 SessionStart 等价物;无 sub-agent 平台 inline 模式)。
  - **命令的三形态**: 同一 continue/finish-work 在 Claude 是 command(`.claude/commands/trellis/*.md`)、在 Cursor 是 command(`.cursor/commands/`)、在无命令平台是 skill(`.agents/skills/trellis-continue/`)。
  - **版本闭环**: `.trellis/.version` + SessionStart 每 session 一次(marker 节流)探测 `trellis --version` 的 update 提示,并要求 AI **在首条可见回复里向用户口播**升级提示("a line buried in SessionStart context is exactly how the update step kept getting skipped")。
  - 观察到的共存现象: 本仓 `.claude/settings.json` 目前是 **两个 JSON 对象直接拼接**(前半 Fabric hooks,后半 Trellis hooks)——严格说是非法 JSON,说明 Trellis 安装器与既有 settings 的 merge 在本仓留下了脏状态(gap 分析可引为"多系统共存 settings merge"的真实案例)。

### 17. 脚本层确定性引擎(task.py 家族)

- **干什么**: 全部状态操作走 Python 脚本(零第三方依赖,py3 标准库):task.py 17 个子命令(create/start/current/finish/archive/list/add-context/validate/set-*/add-subtask/create-pr...)、get_context.py 三模式(默认 session 全景 / `--mode packages` / `--mode phase --step X.Y --platform P`)、add_session.py、init_developer.py。
- **实现在哪**: `.trellis/scripts/task.py`(602 行路由)+ `.trellis/scripts/common/` 16 模块(active_task/task_store/task_context/session_context/workflow_phase/safe_commit/config/paths...共约 8700 行)。
- **巧思**:
  - **AI-friendly CLI 合同**: `current --json`、`list --json` 给机器读;create 把人类提示全走 stderr、**stdout 只输出任务相对路径**供脚本链式消费;删除的子命令(init-context)留墓碑错误信息指路新用法。
  - **脚本是解析器不是政策**: workflow.md 的 Customizing 节明言 "All customization is done by editing this file; the scripts are parsers only."
  - **安全提交工程**: archive 自动 commit 只 stage 归档任务源/目的路径+被改 children 的 task.json(不夹带其他脏文件);`git rm -r --cached --ignore-unmatch` 补齐 move 产生的 phantom delete;.gitignore 挡路时警告并明确**禁止** `git add -f .trellis/`;`session_auto_commit: false` 一键退出 git 托管(`.trellis/scripts/common/task_store.py` `_auto_commit_archive`,`safe_commit.py`)。
  - **lifecycle hooks**: task.json 或 config.yaml 里配 `hooks.after_create/after_start/after_finish/after_archive`,shell 命令收 `TASK_JSON_PATH` env,失败只警告不阻塞;自带 Linear 同步示例 `.trellis/scripts/hooks/linear_sync.py`(读 gitignored 的 `.trellis/hooks.local.json` 拿 team/assignee 映射)。注意语义精确:after_finish ≠ 完成(只清指针),"任务完成"通知该挂 after_archive。

### 18. Session 身份工程(多窗口隔离的 active-task 指针)

- **干什么**: "当前任务"不是全局单例,而是 **per-session 指针**:`.trellis/.runtime/sessions/<context-key>.json`(context-key = 平台名 + session/conversation/transcript id 派生)。同一 repo 开多个 AI 窗口互不串台。
- **实现在哪**: `.trellis/scripts/common/active_task.py`(731 行)。
- **巧思**(这是全系统工程密度最高的文件):
  - **身份来源解析链**: `TRELLIS_CONTEXT_ID` env 显式覆盖 → hook stdin payload(session/conversation/transcript 三类 key,兼容 snake/camel、嵌套)→ 平台 env 变量表 → shell ticket。
  - **env 变量表带证据注释**: 每个变量名标注 REAL(verified 日期+验证方式)/ HOOK-SCOPE ONLY / UNVERIFIED(附如何 settle);文件头警告"2026-08-05 审计发现 21 平台里 12 个声明的变量名从未存在——全是按 `<PLATFORM>_SESSION_ID` 形状类比猜的"。**对'看起来对称就是对的'的模式化幻觉做了制度性防御。**
  - **shell-ticket 桥**: 没有平台把 session id 导出给 shell 子进程,但都会给 hook——所以 pre-shell hook(如 Cursor beforeShellExecution,`.cursor/hooks/inject-shell-session-context.py`)在检测到待执行命令是 `task.py start/current/finish` 时写一张 30 秒 TTL 的 ticket(含 context_key/cwd/子命令),task.py 无 env 时读回。ticket 匹配要求:新鲜 + 本 repo + 命令匹配 + **恰好一个候选**——"两个并发窗口宁可双双降级,不许一个继承另一个的指针"。
  - **Claude 专用 env-file 桥**: SessionStart 时向 `CLAUDE_ENV_FILE` 追加 `export TRELLIS_CONTEXT_ID=...`,后续 Bash 命令天然带身份;只在"最后一条 export 不等于当前值"时追加(防无限增长,且 A→B→A 切换语义正确)。
  - **降级模式是显式合同**: 拿不到身份时 `task.py start` 不失败——打印"degraded mode"说明+补救提示,仍翻 status,AI 靠对话上下文继续;single-session fallback 只在 runtime 里**恰好一个** session 文件时启用(服务不继承父 id 的 class-2 平台子代理),0 或 ≥2 个一律拒猜。
  - archive 时 `clear_task_from_sessions` 清掉所有指向该任务的 session 文件,防 stale 指针;stale 指针被面包屑显式渲染为 `stale_<source>` 状态引导 `task.py finish` 清理。

### 19. SessionStart 分层上下文注入(compact + on-demand)

- **干什么**: SessionStart(startup/clear/compact 三事件)注入结构化标签块:`<session-context>` 说明 → `<first-reply-notice>`(要求 AI 首条回复口头确认上下文已加载,语言跟随用户,一次性)→ `<current-state>`(developer/git/当前任务+status/任务计数/journal 行数/spec index 计数)→ `<trellis-workflow>`(**只有 Phase Index 摘要**)→ `<guidelines>`(上下文读序 + spec index 路径清单)→ `<task-status>`(状态 + 工件在场清单 + **Next-Action 一句话**)→ `<ready>`。
- **实现在哪**: `.claude/hooks/session-start.py`(950 行);`_get_task_status` 是状态→下一步动作的映射器(planning 无 prd → "Load trellis-brainstorm";planning 有 prd → 按轻重与 jsonl ready 度给出差异化 next;completed → "/trellis:finish-work")。
- **巧思**: **注入的是索引和下一步,不是正文**——"Use it to orient the session; load details on demand"。工件在场性(present list)作为状态机输入注入,AI 不用自己 stat 文件。`_has_curated_jsonl_entry` 在 hook 里复刻 ready 判定,种子行不算数——同一合同在 hook/脚本/skill 三处一致实现。

### 20. Commands: continue 与 finish-work(会话边界的确定性程序)

- **干什么**: `/trellis:continue` = 恢复路由器:跑 get_context → 按 status+工件在场性查表定位到应恢复的 step(表格穷举 8 种组合)→ 加载该 step 的 detail。`/trellis:finish-work` = 收尾程序:survey(`--mode record`,把"我的活跃任务"置顶并提示顺手归档其他已完成任务)→ 脏路径分类(当前任务的 → 打回 Phase 3.4 提交;无关的 → 报告后放过;不确定 → 问一次)→ archive → 记 journal。
- **实现在哪**: `.claude/commands/trellis/continue.md`、`.claude/commands/trellis/finish-work.md`。
- **巧思**:
  - **三段式提交秩序**: work commits(3.4)→ `chore(task): archive ...` → `chore: record journal`,"never interleaved";finish-work 发现本任务脏文件时**拒绝代提交**,打回 3.4 走批量提交程序。
  - **3.4 批量提交协议**: 先学最近 5 条 commit 风格 → 把脏文件分为"本 session AI 改过"与"无法辨认"两组 → 一次性出 commit 计划(含未识别文件单列)→ **一次确认执行,拒绝则彻底退出手动模式不二次推销**;禁 amend、禁 push(workflow.md 3.4)。多窗口并发开发的现实(无关脏文件属于别的窗口)被直接编入判定逻辑。

---

## 二、Trellis 的"知识沉淀"链路(学到的东西往哪放、何时触发)

四层目的地,按"半衰期"分层,放置规则明文化(`workspace-memory.md`):

| 目的地 | 存什么 | 触发时机 |
|---|---|---|
| **`.trellis/spec/`**(长期,可执行契约) | 模式/约定/坑/决策/思维触发器 | ① Phase 3.3 `[required·once]`(即使结论是"没得更新"也要走判断);② check skill 的 Spec Sync 自问;③ break-loop 复盘的 Immediate Actions(强制当场改文件);④ 3.4 commit 前的 Spec-sync preamble(有则打回 3.3,spec 与代码同批提交);⑤ finish 子代理 prompt 允许直接改 spec(带先读后写约束) |
| **任务目录**(任务生命周期内) | prd(每次用户回答后即更)/design/implement/research(每主题一文件,"conversations get compacted, files don't")/notes.md | brainstorm 全程、research 子代理产出、mem 召回中"属于本任务但不入 PRD"的发现 |
| **`workspace/<dev>/journal-N.md`**(session 记录) | 本 session 做了什么、commit、下一步 | finish-work Step 4(`add_session.py`,自动 commit) |
| **`trellis mem`**(被动全量) | 原始对话日志(平台自产,零写入成本) | 不写,只在"这事我们聊过吗"时刻检索;可按 task 边界切 brainstorm/implement 片段 |

关键设计: **沉淀不是独立仪式,而是嵌在质量与提交闸口里的必经支路**(check 自问 → break-loop 强制 → 3.3 必经 → 3.4 preamble 再拦),且**目的地由知识半衰期决定**而不是一股脑进一个库。与 Fabric 的对照点:Trellis 无 pending/review 审批流,spec 直接写(靠 git 与 update 的 hash 冲突机制兜底);粒度是"文档节"而非"知识条目";无跨项目共享层(spec 是 per-repo 的)。

---

## 三、可对照维度总结(Trellis 的核心 taste)

1. **确定性引擎 + AI 只做判断**: 状态、路由、注入、提交秩序全由脚本/hook 确定性执行;"the scripts are parsers only",政策全在 workflow.md 这份**数据**里,改流程 = 改 markdown。
2. **Phase gate 强制收敛 + 双重同意**: 建任务同意 ≠ 实施批准;最终规划摘要必须获得**后续消息的显式批准**;`[required·once]` 步骤有 per-turn 面包屑 enforcement + 回归测试守护,防 AI 静默跳步。
3. **Evidence-first 提问纪律**: 代码库能答的不许问用户;一回合一个问题,必带推荐+trade-off;每答即写 prd;收口前无损重写 PRD 是 gate 不是清洁。
4. **Files over conversation**: 一切研究/决策/教训必须落文件;上下文注入的是索引与 Next-Action,正文按需读;超预算降级为 index 行而非丢弃。
5. **Push 失败自动退化为 pull**: hook 注入(标记 `<!-- trellis-hook-injected -->`)与 agent 自读(`Active task:` 首行)是同一合同的两条路径,平台能力差异全部消化在降级链里。
6. **多窗口现实主义**: active task 是 per-session 指针;身份解析宁可双双降级不许互相继承;无关脏文件默认属于"另一个窗口"。
7. **Fail-visible 降级**: 面包屑缺 tag 显示通用行让人去修、degraded start 打印补救提示、hook 失败从不阻塞——退化路径永远可见且不吞错。
8. **对 LLM 不可靠性的工程化防御**: 递归防护双向写、完成信号用系统事件不用 LLM 自报 tag、env 变量表逐条标注验证证据并警告"类比猜测"、种子行自描述且天然被消费者跳过。
9. **知识沉淀是必经闸口不是可选美德**: 3.3 必经 + check/break-loop/commit-preamble 三处回钩;目的地按知识半衰期分四层(spec/task/journal/mem)。
10. **分发 = full-copy + hash 漂移检测**: 188 文件按平台整拷,SHA-256 清单判定用户修改,冲突写 `.new` 不覆盖;内容单源(workflow.md 平台标记块渲染),载体多份;系统自带"如何改我自己"的 meta 文档与 Do-Not 边界。

---

## Caveats / Not Found

- `.trellis/spec/` 的包级内容目前均为 "To fill" 模板(仅 `guides/` 有实内容)——本仓刚 init,spec-bootstrap 尚未跑过;对照时注意区分"机制设计"与"本仓填充度"。
- channel/mem 的运行时实现在 npm 包内,仓库里只有配置、role card 与 skill 文档;本文对其内部(锁/序号/adapter)的描述以 bundled 文档为准,未读到源码。
- `.claude/settings.json` 当前是两个 JSON 对象拼接(Fabric block + Trellis block),严格非法 JSON——共存脏状态,已在 §16 记录。
- `create-pr` 子命令在 workflow.md 中列出,但当前 task.py 的 argparse 注册表里未见(可能版本差),未深究。
- `.trellis/workspace/index.md` 模板里的 `tasks/` 子目录描述与实际布局(tasks 在 `.trellis/tasks/`)不一致,疑为模板陈旧文案。
