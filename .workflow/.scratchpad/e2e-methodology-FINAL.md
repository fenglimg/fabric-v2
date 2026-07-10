# Fabric v2.1 全面测试方法论 — FINAL (mode④ 6 轮收敛产物)

> 整合 round1-6: 深度轴(grounded) + 广度轴(覆盖完备) + 可模拟性分层 + 生成式 meta-test + verify-before-trust。
> 目标: 0 用户 fixture 模拟即可判产品端到端全闭环。

## 〇、★ 统一收口律 (贯穿三轴, 最深洞察)
**当 critic 一直找出「再来一个 instance」(签名/surface/体验场景/维度), 解不是更多 instance, 是一个把 instance 当 data 吸收的生成式 pattern。** 三轴各撞一次、各用此律收口:
| 轴 | 长尾枚举 | 生成式收口 |
|---|---|---|
| 深度 | 逐签名 grounded | anchor 引用(不编码签名, 交 tsc/test-run) |
| 广度(工程) | 逐 surface/export | **J-META census**(从声明点抽 inventory+断言覆盖, 源清单=data) |
| 交互(体验) | 逐体验场景/维度 | **J-EXP-META taxonomy+rubric**(D1-D8 锚定 HAX 框架, 场景=instance) |
**且 frame 本身只有 human 能挑战**: 8 轮 critic 在 CLI-frame 内判 converged, 用户 frame-challenge 揭示漏了交互轴 → 裁决阶梯 human 级不可替代。

## 一、三轴 + 可观测性边界
- **深度轴**: 每条 journey grounded 在真实 anchor(测试文件/导出符号/真实 CLI); 只强制 grounding+anchor, 不逐签名编码。
- **广度轴**: 工程 surface × 产品生命周期 × persona 矩阵 0 GAP + 5 闭环价值链全可模拟 (J1-J24 + J-META 8源)。
- **★交互轴 (Fabric 本体价值, 用户 frame-challenge 补)**: agent-in-the-loop 行为观测 —— Fabric 存在意义=改变 live agent 行为, 不能 mock 掉 agent。J25-J39 + J-EXP-META(见五-bis)。
- **可观测性 4 层** (取代旧粗糙 L-DET/L-LLM): **T1-ledger**(events.jsonl 现成: cite/archive/knowledge_consumed) · **T1-online**(确定性但须 harness 捕获: payload) · **T2-需补事件**(9 个 NEW-N-3 ledger 事件) · **T3-LLM-judge**(不可约体验质量, 但补 llm_judge_run 使可审计)。**tier 是 (journey×埋点状态) 的函数, 加事件可把 T3 下沉 T1/T2**。「0 用户全闭环」: T1 现成立 / T2 补埋点后 / T3 永远只能 LLM-judge(real-agent replay)。

## 二、完整旅程地图 (广度轴 J1-J24 + J-META; 交互轴 J25-J40 见五-bis)
### L-DET 确定性核心 (CI 0 用户跑)
- J1 install/binding事务 · J2 scope resolution(API) · J3 store-qualified cite · J4 跨库 pending 聚合 · J5 写路径防泄漏(hasSecrets/lint) · J6 三端 parity · J7 perf(recall 非全扫)
- J8a 知识环-Personal(extract→自动active→recall) · **J8b 知识环-Team(extract→pending→阻塞 J13→approve→active→recall)** ← 越权防线
- J10 多窗口并发(events.jsonl 防踩踏) · J11 维护+offboard(sync冲突/uninstall 0残留) · J12 doctor 50+ broken-state · J13 治理provenance环(fab_review 8action→id redirect) · J14 global-store-sync环 · J15 schema-compat replay · J16 parity扩展全inventory · J18 daily-recall主路径
- J19 volume-stress(海量KB→hook 截断降级) · **J20 ledger-resilience(JSONL含git冲突标记→降级不崩)** · **J22 Tombstone/Zombie(retire→recall返空+hook剥离ID)** ← CRUD 的 D · **J23 Prompt边界投毒(恶意</instructions>→转义/CDATA)** ← 共享 store 安全
- **J24 config-tuning(round7 补): 改高影响 knob(archive_hint_hours/hint_broad_top_k/fabric_language)→断言行为实际随之变(nudge 频率/recall top_k/渲染语言), 非只存值; `fabric config`/dismiss-slot/onboard-reset 端到端**
### L-LLM 半模拟环 (nightly LLM-eval)
- J9 LLM-grounded-archive(强team信号→layer==team) · J17 onboarding-discover · J20b 语义冲突告警 · **J21 cold-start-discovery(冷LLM模糊需求→首动作 fab_plan_context 非盲改码)**

### ★ J-META — 生成式覆盖断言 (多源, 按构造关闭工程穷举轴)
每类 surface 从其真实所在处抽 inventory(非单一 rg export), 断言每项 ∈ {journey}∪{parity}∪{显式 waived}, 漏覆盖→meta-test red:
| surface | 抽取源(codex round6 修正) |
|---|---|
| CLI 命令/子命令/flag | `allCommands` object keys + 各 command `args` 字段 + 含 hidden(plan-context-hint/onboard-coverage/scope-explain/metrics) |
| MCP 工具/resource | grep `registerTool("...")` / `registerResource("...")` 字符串字面量 |
| hooks | HOOK_SCRIPT_DESTINATIONS/HOOK_CONFIG_ARRAY_PATHS 常量 + 3 端 config JSON 形态(Claude UserPromptSubmit/Codex events.SessionStart/Cursor hooks.sessionStart) |
| skills | templates/skills/* 目录(4个: archive/review/import/sync) |
| schema surface | enum/z.literal discriminant **值**(fab_review 8 action · event_type union · parity surface enum) |
| doctor checks | server `checks: DoctorCheck[]` registry + store doctor check codes |
| parity capability | parity-matrix.json **数据行**(非 enum), 断言每 surface 有 row |
| **用户配置旋钮(round7 codex 补第7源)** | fabric-config schema 的 **object property keys**(非 enum/discriminant): fabric_language/archive_hint_hours/review_hint_pending_count/hint_broad_top_k/selection_token_ttl_ms 等 + `fabric config` TUI introspect 面板字段; 断言每 knob 有 journey 或 waiver(fabric-config.ts:57-348, fabric-config-introspect.ts) |
| **环境变量 runtime knobs(round8 codex 补第8源)** | `grep process.env.<NAME>` + 文档化 env 表(docs/configuration.md): FABRIC_PROJECT_ROOT/FABRIC_HOME/FABRIC_NONINTERACTIVE/FAB_LANG/LANG/FAB_SERVER_PATH/FABRIC_HINT_CLIENT/CLAUDE_PROJECT_DIR; waiver internal/test-only env |

> **★ J-META 源清单是开放 data, 非方法论(收敛锁定子句)**: 上表 8 类是 seed; 工程 surface 的「源类」长尾(可能有第 9 类如 relevance.match glob/exit code 约定)按构造由 J-META 的**实现期 surface census** 吸收——census = grep 全部声明模式(export/allCommands key/registerTool 字符串/process.env/schema key/enum literal/check registry/parity row/config key…) + waiver internal-only。**新增源类 append 到 data, 不改方法论**。这正是 J-META 生成式设计的目的: 把「逐个手列 surface」变成「census 模式」, 故方法论层已结构完整, 不为每个 data 条目续 loop(否则 = over-fit 负收益)。

## 三、5 闭环价值链 (全可模拟判据)
1. 知识环 archive→surface→recall→cite→audit→evict/decay → J8a/b+J18+J22(终态)+J9(LLM层)
2. 安装环 install→bind→resolve→write→commit→sync→recovery → J1/J14/J11 (⚠NEW-N-1: 无 push, 环在产品层未闭)
3. 治理环 pending→review→provenance→audit → J13
4. 跨端环 → J16 (⚠NEW-N-2: parity-matrix 仅 7 cap, 产品层欠覆盖)
5. 维护/自救环 doctor→fix + ledger 韧性 → J12+J20

## 四、取证协议
- P0.5 强制隔离前置(test-wall makeTestWall: isolated HOME+fake bare remote+三端 config)
- fresh-eyes ≥2 LLM ≥1 零上下文; **≥1 reviewer 须有代码访问验 grounded**(round2 教训: 无码访问给假高分)
- verify-before-trust: critic 发现先自验再采纳(round4/5 教训: 2 候选 bug 自验后 1 refuted 1 改判)
- completeness-critic loop-until-dry: 连续 2 轮无新 distinct gap 才收敛(非 score 收敛)

## 五、方法论自身演进史 (防重蹈, 可迁移到任意"优化无 deterministic measure artifact")
1. v0→v1: 抽象漂浮(无 fixture)
2. v1→v2: 加 fixture 骨架, 但臆造 CLI(看似可跑实不存在)
3. v2→v3: grounded 强制(引真实符号), 但逐签名 over-fit/渐近 → 深度轴收口
4. **v3→pivot: 深度边际递减, 切广度轴(用户 reframe) — completeness-critic 替 score 收敛**
5. round4-6 广度: 11→8→3 GAP 强收敛; 工程枚举渐近 → J-META 多源生成式按构造关闭; 产品轴出 distinct failure mode 直到 Tombstone/边界投毒收尾

## 五-bis、交互轴详 (J-EXP-META: agent-in-the-loop 行为观测)
**观测方法**: scripted real-agent replay + 埋点(用真 LLM 当 agent 驱动场景, 观测真实调用/cite/触发/预算行为)。
**J-EXP-META = 体验维度 taxonomy(锚定 HAX) + 每维行为 rubric; 场景=instance(data) 不新增方法论:**
| 维 | rubric(LLM-judge 打分点) | 实例 |
|---|---|---|
| D1 优雅降级 | MCP/数据失败不死循环/不幻觉/向用户说明兜底 | J31 |
| D2 用户控制 vs 摩擦 | 强策略不挟持; 特权 override 被尊重; cite/nudge 不烦 | J29/J32 |
| D3 权威平衡 | 用户错+KB对时柔性纠正(不破窗不讨好) | J35 |
| D4 主动时机情商 | 感知 task-closure, 不在高压期硬插 | J36 |
| D5 一致性连贯 | 单 session 不衰减+主动 re-fetch; 跨 session 不脏读 | J34/J37 |
| D6 跨端体验对等 | 同交互三端行为 delta 一致 | J30 |
| **D7 透明/可解释** | 暴露隐式操作因果(hook 注入了什么/为何调 MCP/应用哪条规则), 信任校准 | J38 |
| **D8 启发/可发现** | 用户绕路时顺势提示已注册 high-value skill(无 GUI 菜单的发现性) | J39 |
| **D9 进化/谨慎适应** | 系统基于沉淀改行为时体验可预期不破心智模型; 索取知识反馈无缝且颗粒度适当(HAX Over-Time) | J40 |
> **★维度完备性锚定 HAX(Human-AI Interaction)18 原则**: D1-D9 完整映射 HAX 4 阶段全 18 条 —— Initially(D8↔G1, D7↔G2/G11) · During(D3↔G5, D4↔G3/G4, D6) · When-wrong(D1↔G10, D2↔G7/8/9, D7↔G11) · **Over-Time(D5↔G12 记忆, D9↔G13/G14/G15 学习/谨慎适应/细粒度反馈)**。完备性**引用 HAX 而非逐轮发现**(同 J-META 锚 census); 锚内 18 条全映射 → 无 D10。新候选先验证是否 HAX 已有 → 是则 map, 否才是真新维。
**4 层可观测落地**: T1-ledger(cite/archive/knowledge_consumed 现成) · T1-online(payload) · T2(下方 9 事件) · T3(D1-D9 质量, llm_judge_run 审计)。

## 六、⚠ 方法论 surfaced 的真实产品发现 (NEW-N, 按 scope 不修, 浮用户)
- **NEW-N-1**: 全库 0 `git push`, sync 只 pull+deferred-push 报告不推送 → 知识本地 commit 从不传 remote/team, 安装/共享环未闭(或设计上手动 push, 待确认)
- **NEW-N-2**: parity-matrix.json 仅 7 capability(3hook/2skill/1mcp/1render), 漏 fabric-import/sync + 5 MCP 工具 → 跨端 parity 产品层欠覆盖
- **NEW-N-3 (instrumentation debt, 交互轴可验前提)**: Fabric 核心价值(交互体验)大半今天测不了, 产品须补 9 个 ledger 事件: `hook_surface_emitted`/`hook_signal_emitted`/`mcp_stdio_trace`/`payload_guard_observed`/`skill_invocation_started+completed`/`skill_phase_transition`/`skill_trigger_candidate`/`llm_judge_run`/`client_capability_snapshot`(join 字段 session_id/correlation_id/request_id/input_trace_id 硬约束)。补后 skill F1/hook delta/MCP 行为从 T2 升 T1-ledger。
- **NEW-N-4 (设计风险)**: Fabric 强 cite/self-archive 策略可能 over-compliance 反噬(agent 变倔强复读机), 须留「用户特权 override」逃生口(D2 红线)。
- (附)cli-surface.test.ts 只断言 4 public command, allCommands 实 9 个(含 hidden) — J-META 须覆盖 hidden, 非 bug
