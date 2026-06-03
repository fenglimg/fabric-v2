# goal-checklist — lifecycle-refactor（mode① 计划驱动 / maestro 分解）

> status.json 真源，本文件投影视图。推进入口：`/maestro-ralph continue`（或 `/goal-mode continue`）。
> 设计真源：`.workflow/.maestro/20260602-lifecycle-concept/lifecycle-concept-final.md`（5 轮多-LLM 收敛）。

## 目标
把已收敛的 Fabric 知识层全生命周期设计**落地为代码重构**：8 hook 终态 + events.jsonl 单总账 + doctor 后台重建因果 + cite 诚实拆分 + telemetry 三点闭环（修 `hook_surface_emitted=0`）+ 隐私物理隔离 + 图谱 F-EFF-1 真闭环。**地基优先分波 + 增量加 append 点**。

## 边界契约
- **in**：§5 五个『保留/增强/激活』hook(SessionStart/SessionEnd/Stop/PreToolUse/PostToolUse) · §3 cite 拆 explicit/exposed · §4 telemetry 三点闭环 · §7 图谱闭环 · §4 隐私隔离 · §2 store-qualified 切面。改 `packages/cli`(doctor.ts) + `packages/shared`(event-ledger.ts) + hook 模板。
- **out**：改 FROZEN 不变量 · hook 层 clean-slate 重写 · 激活 UserPromptSubmit/StopFailure/PostToolUseFailure · Todo lifecycle · **multi-store 接线主体**（global-refactor 另一条线，本计划只做其 telemetry/cite/隐私的 store-qualified 切面）。
- **约束**：增量加点不重写 · 改 hook 改模板再同步 · 改 event-ledger.ts 必 rebuild shared dist · 下沉 doctor 守前台 O(1) · KP 绝不落 ./.fabric · 分波 commit。

## 执行准则（命令式）
1. FROZEN 不变量违反即 block：events.jsonl 单总账 / hook=nudge 非 gate(KT-DEC-0007) / 前台 O(1) / advisory-lock。
2. hook 改动落模板 `packages/cli/templates/hooks/` 再同步安装拷贝，不只改 `.claude/hooks/`。
3. 改 `event-ledger.ts` → 立即 `pnpm --filter @fenglimg/fabric-shared build`（防 runtime invalid_union）。
4. 所有 join/funnel/边生成下沉 `doctor.ts`；前台 hook 只 O(1) append。
5. 隐私：KP 的 id/引用/计数/拓扑边绝不落 ./.fabric；leak guard 硬编码进 skill pre-flight。
6. done_when 优先 deterministic；非确定走 dogfood round-trip。收口前 `pnpm -r exec tsc --noEmit`。

## 终止判据（mode①）
`task_decomposition[*].status` 全部 `done`（等价：本文件末尾含 `ALL_GOALS_DONE`）。

## 进度

### Wave 1 — 可观测性地基（先修 `hook_surface_emitted=0`）
- [x] **W1-T1** broad emit ✅ **verify-before-fix 反转**：源码已存在@b85f48f，0 行=orthogonal install-drift；harness 实证真 work
- [x] **W1-T2** narrow 补 `hook_surface_emitted`（surfaced→edited join 左半）✅ 实现+3 测试+harness，98/98 过
- [x] **W1-T3** cite 诚实拆 explicit vs exposed ✅ `metrics.exposed_and_mutated` 独立字段+三条件过滤+CLI 分列；主控复跑 269/269 + 全仓 tsc exit 0；compliance 不被稀释（实证 0% vs exposed=1）
- [x] **W1-T4** producer-consumer 确定性 round-trip 闭合 ✅（narrow hook_surface_emitted → cite-coverage exposed=1）；活体 dogfood 需 `fabric install` 刷新 stale 安装资产（orthogonal 非阻塞）

**✅ Wave 1 完成**（地基：telemetry 三点闭环左/右半 + cite 诚实拆分）。

> **GT 反转记录**（见 status.json `ground_truth_findings`）：计划假设「telemetry 全空白」部分被 ground-truth 推翻——broad emit 已存在、narrow 已记 edited path。真代码空白只剩 narrow 的 surfaced ids（已修）+ cite split（W1-T3）。

### Wave 2 — 活化休眠 hook + doctor 重建 ✅
- [x] **W2-T1** 加 4 event 类型(session_ended/file_mutated/precompact_observed/graph_edge_candidate_requested) + rebuild shared；4 全过 safeParse
- [x] **W2-T2** 激活 SessionEnd → `session_ended` marker（零计算/O(1)/三端注册+install 全接线）
- [x] **W2-T3** 激活 PostToolUse → `file_mutated`（per-call key tool_use_id，三端注册）
- [x] **W2-T4** doctor 消费 file_mutated → `mutations_observed`/`mutation_pool{attributed,unattributed_workspace_dirty}`/`sessions_closed`；归因键防多store双计；git-diff §9 留 TODO（read-only）
- [x] **W2-T5** producer→consumer round-trip 确定性闭合（marker emit → doctor 重建）；含 i18n install-count snapshot 回灌

**✅ Wave 2 完成**（休眠 hook 激活 + doctor 离线重建因果，前台守 O(1)）。进度 **9/14**。

### Wave 3 — 图谱真闭环 + 隐私物理隔离 + store-qualified
- [x] **W3-T1** 图谱生成：KT→KP 护栏真剥离 + Stop hook emit graph_edge_candidate_requested + SKILL.md LLM 抽 related（doctor 共现补边按 §7 speculative deferred）
- [x] **W3-T2** 图谱消费：plan-context 二阶召回透传 + hook 默认 include_related + (related-to-id) 渲染；空图诚实 no-op
- [x] **W3-T3** 隐私隔离 — 拓扑铁律 done（KT→KP 真剥离，agents.meta.json KP=0）；events.jsonl KP=296 经 **ADJ-1 用户拍板 option B（精化 §4 语义）= 合规**
- [x] **W3-T4** store-qualified：doctor cite-coverage `by_store` 独立分列（不污染 compliance）+ recall `store` provenance
- [x] **W3-T5** 验证执行：隐私审计 + 图谱 round-trip + 全仓 2317 passed + tsc 0

**✅ Wave 3 完成。进度 14/14。**

## ✅ ADJ-1 已裁决（用户 option B）
§4 隐私审计暴露的 §4/§2 张力，用户拍板 **精化 §4 语义**：surfacing 遥测记录 read-set（含 personal）是 §2 read-set 的合法结果，非泄漏；§4 实质守护对象=personal 的 authored 知识 + cite 归因（已隔离：agents.meta.json KP=0 + pending 分轨写 ~/.fabric）。当前状态合规，零额外代码。

ALL_GOALS_DONE

## Wave 3 census 结论（只读普查，避免重复实现已 merge 的 multi-store）
`feat/multistore-wiring` 已 merge → 多数 W3 基础设施已存在：`include_related` 二阶召回稳健(recall.ts:19-35)、cite `store:` 前缀解析(cite-line-parser.ts)、KT/KP 路径分离(~/.fabric vs ./.fabric)、related frontmatter 解析(knowledge-meta-builder)。**真 gap**：① KT→KP 拓扑防泄漏护栏未硬编码(§4 铁律缺执行) ② Stop hook 未 emit graph_edge_candidate_requested ③ hooks 未自动 include_related + 无 graph-empty 诚实显示 ④ doctor cite-coverage 未按 store 分列 + recall provenance 无 store 字段。LLM 抽 related=skill-doc; doctor 共现补边=§7 speculative。

## 协调风险（非阻塞）
- 当前有进行中的 multi-store 接线工作（`feat/multistore-wiring` 已并、`fix/multistore-unwired-warning`）。本计划的 §2 store-qualified 切面与 §4 隐私隔离与之**有重叠**——执行 Wave3 前先 `git log`/`fab_recall` 对齐，避免双改冲突。本计划只做 telemetry/cite/隐私的 store 切面，不碰读写路由接线主体。

## Resume
中断后：读本 checklist + `status.json` 取手册，调 `/maestro-ralph continue`（或 `/goal-mode continue`）推进下一步；严禁越界。
