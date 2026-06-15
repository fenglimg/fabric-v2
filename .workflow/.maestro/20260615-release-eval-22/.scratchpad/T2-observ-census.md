# T2 / G-OBSERV — 死电线记账 (verified census, 2026-06-15)

方法: 枚举 event-ledger.ts 全部 event_type 字面量 → 逐个查 src(.ts)+hook 模板(.cjs)是否有 **写侧 producer**(排除 schema/test/读侧 consumer)。区分 producer vs consumer(producer-consumer oracle)。

## A. 真死电线 — 声明但 src+hook 双零 producer (18)
**行为关键簇(阻塞 G-HABIT 全维度评分)— schema 自承 "future wiring"(event-ledger.ts:683-684):**
| event_type | 本应度量 | 现状 |
|---|---|---|
| skill_invocation_started | skill 用没用对 / trigger_source | ❌ 零 producer |
| skill_invocation_completed | skill 闭环 outcome | ❌ 零 producer |
| skill_phase_transition | skill 内 phase 进度 | ❌ 零 producer |
| skill_trigger_candidate | auto-invoke false-negative | ❌ 零 producer |
| llm_judge_run | T3 质量评分可审计性 | ❌ 零 producer |
| client_capability_snapshot | D6 跨端 parity 归因 | ❌ 零 producer |

**生命周期/迁移 marker 簇(行为价值低,死但非阻塞):**
claude_hook_path_migrated, claude_skill_path_migrated, codex_skill_path_migrated,
knowledge_meta_auto_healed, knowledge_path_dangled, mcp_event, meta_reconciled,
meta_reconciled_on_startup, payload_guard_observed, pending_auto_archived,
precompact_observed(schema 自承 inert), reapply_completed

## B. 活线但字段缺失 (1)
| event_type | producer | consumer | 缺陷 |
|---|---|---|---|
| hook_surface_emitted | knowledge-hint-broad.cjs ✓ | doctor-cite-coverage ✓ | **无 size/bytes 字段** → G-PERF hook 注入大小无法从 telemetry 测量 |

## C. 我 src 普查初判死、实为 hook emit 的(已纠偏,非死)
graph_edge_candidate_requested(Stop hook), hook_signal_emitted(fabric-hint), init_scan_completed

## D. 面级缺口
- **CLI 无事件类型**: 无 cli_command / cli_invocation 类 event_type 声明 → CLI 调用零埋点(brief 维度2 CLI 行 ❌ 属实)
- hook .cjs 实际 emit: cite-policy-evict / knowledge-hint-broad / post-tooluse-mutation / fabric-hint / session-end-marker

## G-OBSERV 判定
honest 红账已出 = 本 gate 的 deliverable 满足(brief: "显式标红'不可评分+待补埋点'")。
**补埋点分诊**:
- 廉价高价值 → hook_surface_emitted 加 size 字段(同时解 G-PERF hook size 硬要求)= 本轮做
- 大面 skill_invocation/llm_judge 全埋点 = 跨 43 skill + MCP,部分 codex-dependent → 走分诊(见 status.json needs_adjudication / 降级记账),非本轮强求,显式记为 G-HABIT 全维度评分的债
