# v2.1 三轴全面测试执行 — Goal Checklist (mode③ 混血)

> status.json 真源, 本文件投影。依据 `.scratchpad/e2e-methodology-FINAL.md` 跑三轴全面测试, 驱动 rc3/rc4→GA。

## 目标
三轴 ship gate 全绿 + ship_criteria 全过 floor。分 3 波: T1 确定性 → 建埋点 T2 → T3 real-agent replay。

## 边界契约
- **In**: 写 J1-J40 真实测试套件; 自动修确定性真 bug(每修复独立 auto-commit); Wave2 建 9 埋点; Wave3 replay。
- **Out**: 产品设计级(4 NEW-N 类)→ needs_adjudication; 主动重构; 推翻 methodology; 破坏性操作。
- **铁律**: verify-before-trust(报的问题先自验); grounded(引真符号, 臆造=FAIL); rc 前 tsc --noEmit; 中文 commit。

## 三波 / 命名 gate
- **Wave1 T1 确定性**: GATE-DEPTH(J1-J24 grounded 全绿) + GATE-BREADTH(J-META census 8 源全覆盖) → 切 rc3
- **Wave2 T2 埋点**: GATE-INSTR(9 ledger 事件) + GATE-INTERACT-T2(skill/hook/MCP 行为可复盘) → 切 rc4
- **Wave3 T3 replay**: GATE-INTERACT-T3(D1-D9 real-agent replay + llm_judge_run) + 涌现类 ship_criteria 过 floor → GA 候选

## ship_criteria (floor)
G-GREEN(hard) · G-LEAK-NEG(hard) · G-SCOPE-ISO(hard) · G-STORE-TXN(hard) · G-MCP-PAYLOAD(≤4k) · G-PARITY-3 | Wave2/3: G-CITE(≥20%) · G-SKILL-TRIGGER(≥65%) · G-ARCHIVE-RECALL(≥30%)

## 涌现/裁决纪律
- **确定性真 bug**(test/tsc/grep/measure 证实 + in-scope + 非破坏) → 自动追加 task_decomposition + 修 + 独立 auto-commit, 无需同意
- **设计级/主观/破坏性/越权** → needs_adjudication(填 reason), loop 跳过攒队列, wave 末批量浮
- 已 seed 4 条: ADJ-NEWN-1(无push) / -2(parity 欠覆盖) / -3(9 埋点 schema) / -4(over-compliance)
- dedup(parent_id+relationship), goal 对齐必填, depth≤3, drift gate(每 5 task 自检对齐 <60% 停报)

## 终止判据 (mode③)
5 命名 gate 全绿 + 所有 hard ship_criteria verified + 涌现类过 floor → 自动 completed。

## 本会话收尾 (2026-05-30, partial-complete — 用户裁定)
**可自动达成的判据全绿:**
- ✅ GATE-DEPTH: 全量 1979 tests / 0 failed + tsc 0
- ✅ GATE-BREADTH: 8 源 census + parity 7→11 cap / 33 cells
- ✅ 6 硬 ship_criteria 全 PASS(G-GREEN/LEAK-NEG/SCOPE-ISO/STORE-TXN/MCP-PAYLOAD/PARITY-3)
- ✅ Wave0 真实多 store dogfood harness 全绿(2 私有 gh 仓 + 双 store + 双向 bind + 防泄漏 0 命中)
- ✅ 7 条 ADJ 全裁: ADJ-5(store create)/ADJ-6(phantom mount 守卫)/ADJ-2(parity 补全) 已实现+测试+commit

**跨会话 deferred(本会话边界/资源不可达成):**
- ⏸ GATE-INSTR: 需 codex round10 NEW-N-3 的 9 埋点 schema spec(repo 内无 grounded spec, 臆造违反铁律)
- ⏸ GATE-INTERACT-T2: 依赖 INSTR 埋点先建
- ⏸ GATE-INTERACT-T3: 需真实多-agent 会话部署, 单会话不可自动化
- ⏸ ADJ-1/7: sync→Skill 完整迁移(CLI sync 退役, 大改)
- ⏸ ADJ-4: over-compliance 逃生口(Wave3 J32 量化后定)

**关键真发现**: ADJ-1 sync 无 push 经真实远端 dogfood **CONFIRMED**(此前据未读完的 grep 差点误判 REFUTED, verify-before-trust 救回)。

## Resume
下会话凭 codex 9 埋点 schema + 真实 agent 部署接 INSTR/T2/T3; 其余见 status.json loop_exit_status.deferred_to_future_session。
