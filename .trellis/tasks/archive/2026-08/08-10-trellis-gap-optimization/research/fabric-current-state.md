# Research: Fabric v2 当前能力面 + 痛点盘点(供 Trellis gap 分析)

- **Query**: 盘点 fabric-v2 能力面、已知未完项、上次同空间对照的 Trellis 结论及 micro-transfer 落地状态、使用链路薄弱环节
- **Scope**: internal(代码/docs/git 历史/issue 登记/会话 transcript 恢复)
- **Date**: 2026-08-10
- **版本基准**: monorepo `package.json` = **2.5.0-rc.4**,最新 tag `v2.5.0-rc.4`(注意 `README.md:254` 仍写 v2.3.0-rc.5,已过期)

---

## 1. 能力面 Inventory

### 1.1 包结构(`packages/`)

| 包 | 职责 | 依据 |
|---|---|---|
| `packages/cli` | `fabric` CLI:install/store/sync/info/doctor/config/audit/inspect/preview/first-hit/uninstall + hook/Skill/MCP 客户端配置写入 | `docs/ARCHITECTURE.md:9` |
| `packages/server` | stdio-only MCP server(5 工具)+ 生命周期服务(recall/review/doctor/lint/event ledger/metrics) | `docs/ARCHITECTURE.md:10` |
| `packages/shared` | 跨包 Zod schema、i18n、错误类型、atomic-write、ProjectContext resolver | `docs/ARCHITECTURE.md:11` |
| `packages/server-http-experimental` | v1.8 时代 HTTP/REST/SSE/Dashboard,已隔离 quarantine,不构建不测试 | `README.md:246`, `docs/ARCHITECTURE.md:13` |

受支持客户端仅 **Claude Code + Codex CLI** 两端(Cursor 支持已删除并合入 main,merge commit `91925d60`)。

### 1.2 Install 链路

- `fabric install` = 7 阶段 pipeline:`preflight → env → store → hooks → mcp → validate → guidance`(`docs/ARCHITECTURE.md:123-135`;入口 `packages/cli/src/commands/install-v2.ts`)。
- 产物:两端 managed bootstrap block(CLAUDE.md/AGENTS.md 指针 + `.fabric/AGENTS.md` 策略正文)、hook 脚本分发、`.claude/settings.json` / `.codex/hooks.json` hook 注册(deep-merge,Stop 数组特判去重:`packages/cli/templates/hooks/configs/README.md`)、MCP stdio 客户端配置(dynamic root 默认 / pinned 可选,provenance 4 态:`docs/USER-QUICKSTART.md:148-189`)。
- `fabric uninstall` 对称 5 阶段逆操作;硬不变量:`~/.fabric/stores/` 永不删除(`docs/ARCHITECTURE.md:137-147`)。
- 装后验证:`fabric first-hit`(fail-loud 4 码:missing_required / write_target_mismatch / store_unreachable / empty_store;`--seed` 可在空库播种)+ `fabric inspect` / `fabric preview`(`docs/USER-QUICKSTART.md:124-146`)。

### 1.3 Hooks(模板真源 `packages/cli/templates/hooks/`,7 脚本 + 33 个 lib 模块)

| 脚本 | 时机 | 干什么 |
|---|---|---|
| `knowledge-hint-broad.cjs` | SessionStart | broad 知识索引 + scope 普查双 sink(人 + AI) |
| `knowledge-pretooluse.cjs` | PreToolUse(Edit/Write/MultiEdit) | 路径相关 narrow 提示 + 编辑计数侧记 |
| `knowledge-hint-narrow.cjs` | (narrow 提示渲染,配合 pretooluse) | narrow hint 渲染链路 |
| `cite-policy-evict.cjs` | PreToolUse | 改文件前没相关 recall → 软 nudge(非 gate,KT-DEC-0007) |
| `post-tooluse-mutation.cjs` | PostToolUse | 记 `file_mutated` / `knowledge_body_read`(闭合浮现→引用→编辑漏斗) |
| `fabric-hint.cjs` | Stop | archive/review/冷启动回灌提醒(`archive_edit_threshold` 默认 20) |
| `session-end-marker.cjs` | SessionEnd | 会话结束标记 |

依据:`README.md:105-114` + 模板目录实测。设计铁律:hook 只提醒和记账,从不阻塞(never-block,`README.md:130`)。

### 1.4 MCP 工具(5 个,stdio;`packages/server/src/tools/`)

- `fab_recall(paths, session_id)` — lean 召回:只回描述 + `read_path` + rank,正文按需原生 Read("Memory-style shape");混合检索 = BM25(中文分词)+ 可选向量(fastembed,可降级),RRF 融合、score 透出、相关度优先截断(`README.md:94-103` + `.workflow/roadmap.md` Milestone 1 已完成,KT-DEC-0074)。
- `fab_propose` — 写 pending(唯一进 canonical 的入口第一步);带 summary opacity guards + altitude 检查。
- `fab_archive_scan` — 扫会话事件账本找可归档候选;支持 `range='all'` sentinel(commit `1adc23fc`,但见 ISS-20260806-001)。
- `fab_pending` — 只读浏览/搜索 pending + canonical(已与 recall 共用同一排序引擎,roadmap W5)。
- `fab_review` — approve/reject/modify/defer 写侧 triage。

### 1.5 Skills(模板真源 `packages/cli/templates/skills/`,6 个)

| Skill | 行数(SKILL.md) | 角色 |
|---|---|---|
| `fabric-archive` | 229 + **19 个 ref 文件**(phase-0 到 phase-4-5、source mode 全套) | 会话洞察→pending;source mode 从 git/docs 冷启动回灌 |
| `fabric-review` | 222 + 10 个 ref | pending triage + maintain(retire 语义淘汰 / relate 建边);AskUserQuestion policy |
| `fabric-store` | 29(thin shim) | 路由到 `fabric store` CLI |
| `fabric-sync` | 27(thin shim) | 路由到 `fabric sync` CLI,仅 rebase 冲突时 AI 辅助 |
| `fabric-config` | 70 | 把"太吵了/太勤"翻译成具体配置项写到唯一归属层 |
| `fabric-recall-playbook` | 91 | 检索协议 playbook(何时 recall、lazy body Read、失败路径) |

### 1.6 Doctor / Audit

- `fabric doctor`:健康检查一趟跑完 ~35 个知识健康 lint(孤儿降级、陈旧归档、超期 pending、stable-id 重复、layer/scope 不一致、index 漂移、relevance 绑定、skill contract integrity 等);maturity 升降 **detection-only**,真改动走 fabric-review(`README.md:228`)。`--fix` 只修确定性项;`--probe` 输出机器可读 readiness JSON(peer micro-transfer P1-6,`packages/cli/src/commands/doctor.ts:221`)。
- `fabric audit`:`cite`(引用覆盖率,记录不阻断)/ `conflicts` / `retired` / `why-not-surfaced <id>`(三轴逐因诊断)/ `metrics`。
- 退役命令 tombstone signpost(不做静默 alias):metrics→audit metrics、context→inspect、whoami/status→info、scope-explain→info scope(`packages/cli/src/lib/command-signposts.ts:13-19`)。

### 1.7 Store 模型

- 知识只存挂载 store(store-only,无项目内运行时回退):`~/.fabric/stores/<team|personal>/<store>/knowledge/{decisions,pitfalls,guidelines,models,processes}` + `pending/`;本机实测 team store `fabric-team-knowledge` canonical 164 条。
- store = git 仓,内生不可变 UUID;`fabric store create/add/bind/switch-write`,`fabric sync` = pull --rebase + push;一个 team store 跨多 repo 共享已落地(`README.md:57-63`)。
- 三轴 scope:`semantic_scope`(team / project:<id> / personal)× `relevance_scope`(broad/narrow)× store 物理挂载;personal 隐私红线由 schema/write path/doctor/sync 阻断(`docs/ARCHITECTURE.md:40-66`)。
- 写路由 `write_routes` per scope;多 shared store 下缺 route 是 hard error 不静默回退。
- 知识 = 带 frontmatter 的纯 Markdown;成熟度三档 draft→verified→proven。

### 1.8 Config 分层

三个 home,窄者优先(`docs/configuration.md:1-22`):

```
environment > repo(.fabric/fabric-config.json) > store(store-config.json) > library default
```

- Machine:env vars + `~/.fabric/fabric-config.json`(endpoint/API key/language 等)。
- Store:recall/ranking/embedding 默认值(`plan_context_top_k`、`embed_model`、fusion 等);`embed_enabled` 是 Repo 决定,store 不能替 repo 开嵌入;secrets 永不进 store-config。
- 每层独立校验,invalid 单字段 fall-through 不连坐。

---

## 2. 已知未完项 / Backlog

### 2.1 正式 issue 登记处:`.workflow/issues/issues.jsonl`(当前 **3 open / 170 closed**)

即 commit `95a0491a`(合并 archive-scan 分支时记录)的 3 条,全部 open:

| ID | 严重度 | 内容 | 位置 |
|---|---|---|---|
| **ISS-20260806-001** | high/p2 | `range='all'` 在 fabric-archive **skill 链路上是默认值而非 opt-in**:代码注释声称 opt-in only,但 `ref/phase-0-range-resolution.md:110` 把 "all" 定义为无 hint 时的产物且语义描述是旧的(与新实现矛盾);Step 6 carry-forward 无 omit 选项 → skill 路径 anchor cutoff 实际失效,每次归档全量扫历史(候选爆炸/成本上升)。待产品决策 (a) backlog 可达优先→改文档 或 (b) all 应显式→Phase 0 区分 omit/all | `packages/server/src/services/archive-scan.ts:75`; `packages/cli/templates/skills/fabric-archive/ref/phase-0-range-resolution.md:110,112`; `SKILL.md:75` |
| **ISS-20260806-002** | medium/p3 | forensic 扫描裸 walk 文件系统未排除本地产物(`.workflow/kg` 15M、`.claude/worktrees/` 等),total_files 15071 vs 干净 checkout 922;forensic.json 是 tracked 派生状态,污染版本会推错技术栈画像。已补 .gitignore 缓解,根因(应以 git ls-files 为全集)未修 | `.fabric/forensic.json`; forensic/init-scan 遍历实现 |
| **ISS-20260806-003** | medium/p3 | 本地测试套件 flaky:同 commit 连跑 `pnpm vitest run --dir packages` 三次 30/31/32 失败文件 ±2,任何基于总数的回归 gate 不可信;疑似共享 fixture 串扰 + 嵌套 worktree 副本被 glob 扫入(CI 绿,是"不稳定"问题非"失败"问题) | `packages/**/*.test.ts`; vitest include/exclude |

### 2.2 文档内显式 deferred

- `docs/configuration.md:58-65` "Deferred work":① Repo-local `fabric-config.local.json` overlay;② `fabric info` remote-readiness 报告与 embedding model warm-up。
- `docs/USER-QUICKSTART.md:176-178`:MCP root-pin provenance 的 `managed` repair primitive **尚未接入公开 `fabric doctor --fix`**——升级工具接入前须人工确认来源。

### 2.3 Roadmap 层 deferred(`.workflow/roadmap.md`,Milestone 1 已关账)

- **常驻 daemon**:defer,触发条件 = W2 磁盘缓存落地后实测 hook 仍是瓶颈,且须 per-repo+per-session 隔离(多窗口并发风险)。
- **代码符号索引 / KG**:YAGNI,便宜退路 = knowledge 增 `relevance_symbols` 字段;maestro 代码图谱半套明确 out of scope。

### 2.4 其他挂账(非正式登记)

- **README 版本漂移**:`README.md:254` 写 v2.3.0-rc.5,实际 2.5.0-rc.4;本地存在未合分支 `feat/sync-readme-version`(`git branch` 实测)——文档滞后两条 minor 线。
- **未合本地分支** 4 条:`feat/config-single-home`、`feat/preview-store-first-titles`、`feat/sync-readme-version`、`worktree-fabric-observability-fixes`(+ 2 条 claude/* 工作分支)。
- **pending 审核积压**(轻):team store pending 4 条 + personal 1 条(实测 `~/.fabric/stores/.../knowledge/pending`;远低于 >10 的 batch-review 阈值,非痛点但在账上)。
- **孤儿 npm 2.0.0 deprecate 待办**(来源:用户 memory `project_rc_release_log.md`——2.0.0 版本号已烧,孤儿包待 deprecate)。
- **MCP rootless cwd 时 propose 全挂**(来源:用户 memory `project_fabric_mcp_rootless_cwd_no_write_target.md`):MCP server cwd=/ 且无 CLAUDE_PROJECT_DIR → 无 write_routes,`fab_pending` 空是假阴性;修复手段是重连/钉 cwd——属已知运维坑,产品侧未彻底闭合。
- **嵌套 worktree 双假红家族**(memory `project_worktree_hook_test_false_reds.md`,与 ISS-002/003 同根因家族):repo 遍历不排除 `.claude/worktrees/`。

---

## 3. 上次同空间对照的 Trellis 结论 + micro-transfer 落地判定

### 3.1 材料来源与恢复说明

- 分析会话:**ANL-same-space-frameworks-2026-07-12**(6 仓 round1:Spexcode/Superpowers/**Trellis**/EagleRAG/Spec-kit/OpenSpec;round2 加测 mem0/GitNexus/Obsidian)。
- `.workflow/scratch/20260712-analyze-same-space-frameworks/` 已被 `5d50f212`(2026-07-21 清理)删除;git 中可恢复的只有 `conclusions.json`(被 round2 覆盖,R7-R10)、`explorations.json`、`clone-status.json`、`round2-mem0-gitnexus-obsidian.md`(取自 `e2aef499`)。
- **`analysis.md` 从未 commit**(KT-DEC-0078 的 Evidence 引用了它但 git 里没有);本次从 Claude Code 会话 transcript(`~/.claude/projects/-Users-wepie-Desktop-personal-projects-pcf/99e27aec-13ac-45f9-afd4-1dcd6789a6bb.jsonl`,2026-07-12T09:58 的 Write 调用)完整恢复,要点摘录见 3.2/3.3。
- 会话锁定结论已归档为知识:**KT-DEC-0078**(peer micro-transfer not morph)+ **KT-PIT-0058**(false-friend knowledge 词),路径 `~/.fabric/stores/team/fabric-team-knowledge/knowledge/projects/fabric-v2/{decisions,pitfalls}/`。

### 3.2 当时对 Trellis 的具体分析(恢复自 analysis.md + transcript census)

- **分层定位**:Trellis = "工程化 in-repo 记忆/任务" 层,与 Fabric **问题高重叠、解法中重叠**(四层对照表中唯一标"高重叠"的 peer)。
- **census 观察**(transcript 内 round1 普查块):`@mindfoldhq/trellis` pnpm monorepo(core SDK + cli),`.trellis/spec/` 自动注入规范、`.trellis/tasks/` PRD+任务状态、`.trellis/workspace/` journal 跨会话记忆、17 平台分发、4 阶段循环(brainstorm→implement→check→finish + update-spec 沉淀)、AGPL-3.0。
- **判定**:
  - **Don't steal(hard)#2**:"Trellis task/PRD 状态机 + AGPL" —— 不抄任务机形态,license 也有约束。
  - **Ranked bet #8**(Trellis 唯一正向输入):"**Finish→archive 产品化**",value 中高 / cost 中,裁决 = "**dogfood 后**"(即当时未排进 P0-P2 全量,只落了轻量版,见 3.3 P1-7)。
- KT-PIT-0058 把 Trellis 归入 false-friend 名单:"Trellis/Spex knowledge-ish = 任务/SDD",与 Fabric 的 curated knowledge 不同层,对齐前先分层。

### 3.3 四个 micro-transfer 候选是什么 + 落地判定

候选出自 analysis.md ranked recommendations(#1/#2/#3/#5),经 `.workflow/scratch/20260712-plan-M5-peer-micro-transfer/`(8 task,3 wave)落地,主 commit **`e2aef499`**(2026-07-12,已在 main)。逐条现状核验:

| 候选 | 指什么 | 判定 | 当前代码证据 |
|---|---|---|---|
| **① using-fabric pre-action gating**(P0-1,源 Superpowers) | skill/bootstrap 层强化"改文件前必 fab_recall"纪律清单,不加 permanent Stop-hook gate(守 KT-DEC-0007) | **done(且已迭代两轮)** | `packages/shared/src/templates/bootstrap-canonical.ts:85,155` 双语 "Pre-action gating (修改任何文件前 MUST)";`fabric-recall-playbook` skill 存在;v2.2 C1 进一步演进为 recall-first 自动记账(删首行 `KB:` 八股,见 `.fabric/AGENTS.md` Cite policy 节) |
| **② altitude body lint**(P0-2,源 Spexcode) | propose/doctor 缝隙检测 session-dump 形状正文(dump-shape markers 非纯长度),默认 warn、propose-gate opt-in(`FABRIC_ALTITUDE_PROPOSE_GATE`) | **done** | `packages/server/src/services/body-altitude.ts`(独立 service);`extract-knowledge.ts:22-24` import `assessBodyAltitude`,`:37` 注释 "Peer micro-transfer P0-2: dump-shaped body altitude heuristics",warn 路径仍写 pending + `altitude_warning` |
| **③ store UX 对照 OpenSpec**(P0-3) | 缺 store/未绑定/无写目标错误输出**可整行粘贴**的恢复命令(actionHint + first-hit remediation),对标 OpenSpec store 的 pasteable fix 文案;不改数据模型 | **done** | `packages/cli/src/store/first-hit.ts:157` `remediationFor(code, writeTarget)` + `:234,:305` 接线;FirstHitCode 4 码在 `docs/USER-QUICKSTART.md:129-134` 有用户侧文档 |
| **④ CLI signposts**(P1-5,源 Spexcode) | 退役命令名 tombstone:打印后继命令并非零退出,**绝不静默 alias** | **done** | `packages/cli/src/lib/command-signposts.ts:13-19` 5 条 tombstone;`commands/index.ts:31` 注释指回 |

同批附带项(同样已落地,列全供 gap 分析):

- **P1-4 archive-as-truth 叙事** — done:`docs/USER-QUICKSTART.md:42-57` "Archive as truth" 节 + README 单向管道。
- **P1-6 `doctor --probe`** — done:`packages/cli/src/commands/doctor.ts:221` "Peer micro-transfer P1-6"。
- **P1-7 finish→archive 轻量 cadence(Trellis bet #8 的轻量版)** — done:`.fabric/AGENTS.md` "Archive cadence nudge (rc.36 / finish→archive)";`fabric-archive/SKILL.md:192` 明确 "Soft Stop-hook nudge only (KT-DEC-0007) — **not** a task engine, not Spex/Trellis"。
- **P2-8/9/11 诊断打磨** — done(verification.json 全绿,`e2aef499` 内 `.summaries/`)。

**唯一 partial:Trellis bet #8 的"产品化"部分**。当时裁决是"dogfood 后"再评,plan 把 "Spex session dashboard / **Trellis task PRD** / EagleRAG stack / SDD main loop" 列进 OUT OF SCOPE(`plan.json` design_decisions)。此后 git log 无任何任务载体/PRD/journal 方向的落地(`git log --all -S 'trellis' -i` 仅命中上述两个 commit)——即 **Trellis 所代表的"任务级工作流 + 跨会话 journal"能力在 Fabric 侧至今是刻意空缺**,这正是本次 gap 分析的主对象。

### 3.4 当时的 hard don't-steal 清单(约束后续 gap 分析的边界)

1. Spex session/worktree/PTY dashboard;2. **Trellis task/PRD 状态机 + AGPL**;3. EagleRAG Milvus/Celery 文档 RAG;4. Spec Kit/OpenSpec 作为 Fabric 主循环;5. evidence/journal 自动进 canonical;6. 用 SHALL-requirement 规格替换五类知识模型。(恢复自 analysis.md "Don't steal (hard)")

---

## 4. 使用链路薄弱环节(install→recall→archive→review→sync 用户视角;主观判断,每条注明依据)

按影响排序:

### W1. 没有任务级工作流载体 —— 知识与"正在做的事"之间缺一层(最大 Trellis-shaped gap)

Fabric 刻意定位 harness-agnostic、绑定 harness 已有事件(SessionStart/Stop/PreToolUse/PostToolUse),明确"不是 16 阶段工作流注入""不是多 agent 编排器"(`README.md:186-192`)。后果:
- 知识浮现的锚只有**路径**(relevance_paths)和**session 时机**,没有"当前任务类型/阶段"轴——无法做 Trellis 式"按当前任务按需注入相关 spec"。
- 归档触发靠 per-turn 信号(normative 语句/wrong-turn-revert)+ 编辑计数阈值 + Stop nudge(`.fabric/AGENTS.md` Self-archive policy),没有"任务收口"这个天然打点;bet #8 产品化被搁置(见 3.3)。
- 跨会话连续性只有 knowledge store,没有 journal/工作日志——"上次做到哪"完全靠用户自己或 harness 的记忆。
依据:README non-goals、plan.json out_of_scope、`fabric-archive/SKILL.md:192`、KT-DEC-0078。**注意**:这是有意的产品边界(morph 禁令),gap 分析需在"不变成任务机"的约束下找 micro 载体。

### W2. Archive skill 链路成本失控(挂账 high issue)

skill 路径上 `range='all'` 是事实默认 → 每次归档全量扫历史事件账本,候选爆炸、成本上升,且 ref 文档语义与实现矛盾。这是 archive 主链路(4 步循环的第 3 步)的正确性/成本双重问题。依据:ISS-20260806-001(`.workflow/issues/issues.jsonl`)+ `archive-scan.ts:75` vs `ref/phase-0-range-resolution.md:110`。

### W3. 知识写入摩擦:重流程 skill + 双人审门,cadence 靠自觉

- `fabric-archive` 是 229 行 SKILL + 19 个 ref 文件的多 phase 流程(Phase 0 range → 2.5 viability → 3.5 scope → 3.7 semantic scope → 4 persist → 4.5 emit),AI 全流程走完才落一条 pending;`fabric-review` 再 222 行 + 10 ref 的人审。单条知识从产生到 canonical 的最短路径也要两个 skill 会话段。
- 官方自己在 quickstart 承认 "SKILL.md feels too long to read | It is"(`docs/USER-QUICKSTART.md:199`)。
- review batch nudge 阈值 >10 条(`.fabric/AGENTS.md` Review backlog nudge),小批量 pending(现状 5 条)会长期挂着无人触发。
依据:模板行数实测(3250 行 ref 总量)、AGENTS.md 策略节。主观判断:对独立开发者/小团队,这套 curation 成本高于产出节奏,容易"KB 慢速死掉"(AGENTS.md 自己的原话警告)。

### W4. 新用户首价值路径长且脆

装完 ≠ 有价值:install → 重启客户端(MCP 配置生效硬要求,`README.md:178`)→ bind store → 空库(需 `first-hit --seed` 播种或跑 fabric-archive source mode 冷启动回灌)→ 第一条真知识还要过 propose+review。quickstart 专设 "First 30 minutes — troubleshooting" 表列 5 种常见翻车(旧全局 CLI JSON dump、hooks 没接线、cite 块缺失等,`docs/USER-QUICKSTART.md:191-199`);另有 MCP rootless cwd 导致 propose 全挂的已知运维坑(memory `project_fabric_mcp_rootless_cwd_no_write_target`)。依据:上述文档 + memory。主观判断:从 0 到"第一次被知识救到"的 time-to-value 偏长,冷启动依赖用户主动跑 source mode。

### W5. 行为改变(mid-funnel)不可观测,漏斗只闭到"读了"

事件账本闭合了 浮现→`knowledge_body_read`→`file_mutated` 的读侧漏斗(`post-tooluse-mutation.cjs`),`audit cite` 记覆盖率;但"读到后是否真的改变下一步动作"(SBA 吸收分析里的 reached-but-inert)只落成了 review 审核语言和 archive activation floor,没有量化信号。依据:`docs/skill-architecture-absorption-analysis.md:241-259,417-427`(P1 落地为审核语言)+ `README.md:134` honesty iron law(不用 usage 排序——刻意约束,也让"哪条知识真有用"缺数据)。

### W6. 文档/契约漂移是复发病

README 版本落后两条 minor 线(v2.3.0-rc.5 vs 2.5.0-rc.4);ISS-001 本质也是 skill ref 文档与实现矛盾;ARCHITECTURE.md 开篇即声明"当本文和代码冲突时代码胜出"(`docs/ARCHITECTURE.md:113`)——承认 prose 会漂。skill 模板→安装副本有 parity 测试,但 docs↔实现之间没有等价 gate。依据:版本实测、issues.jsonl、ARCHITECTURE.md。

### W7. 会话历史不可检索(evidence 层留白)

Fabric 定位排除 evidence 层("不是终端/session 证据库",`README.md:11,191`),`fab_archive_scan` 只扫自家事件账本,不提供"上次怎么解的/之前讨论过吗"式对话历史召回(Trellis `trellis mem` / session-insight 覆盖的场景)。用户问历史决策时只有 canonical 知识可查,粒度粗、覆盖取决于归档纪律。依据:README 定位表、MCP 工具面。主观判断:evidence 留白是有意的,但"归档没做→历史全丢"的悬崖,在归档摩擦(W3)存在时会被放大。

### W8. 工程底盘噪声侵蚀验证信心

本地测试 flaky(ISS-003)+ 嵌套 worktree 双假红(memory)+ forensic 污染(ISS-002)同属"repo 遍历/共享状态不隔离"根因家族——不是用户链路问题,但拖慢每一次改动验证,也是历史上误判回归的来源。依据:ISS-002/003、memory `project_worktree_hook_test_false_reds`。

---

## Caveats / Not Found

- `.workflow/scratch/20260712-analyze-same-space-frameworks/analysis.md` git 中不存在(从未 commit);本文 3.2/3.3 的引用基于会话 transcript `99e27aec-...jsonl` 内的 Write 调用恢复,内容为当时最终版(4464 字符,两次 Write 的后一次),可信但非 git 事实源。
- git 里的 `conclusions.json` 已被 round2 覆盖(只剩 R7-R10 mem0/GitNexus/Obsidian),round1 的 R1-R6 编号结论无独立文件,以恢复的 analysis.md ranked 表为准。
- Trellis 当时被克隆到 `tmp/trellis`(HEAD `bde902c`),分析基于 2026-07-12 的 Trellis 版本;当前装进本 repo 的 `.trellis/` 是更新版本,能力对照时需注意 Trellis 自身也演进了(本文按任务要求未盘点 `.trellis/` 本体)。
- 能力面按 docs + 模板层盘点,未深读实现;`onboard-coverage`、`plan-context-hint` 两个 CLI 命令为 hook/内部辅助面,未展开。
- pending 计数(team 4 / personal 1)为本机实测快照,随审核变动。
