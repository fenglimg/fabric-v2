# Goal Checklist — Fabric 完全测量审计 (mode ③ · 三轴框架)

> **真源是 `status.json`**,本文件是投影视图。任何状态变更先改 status.json。
> Session: `20260602-fabric-fulltest` · 两项目等权 · **LIBERAL capture(评完必留完整 findings ledger,绝不留空)**

## 完全测量模型(三轴 + 跨切律,源自 `measurement_model`)

| 轴 | 内涵 | 引擎 | 模拟层 | 终止 |
|---|---|---|---|---|
| **深度** | journey grounded 可真跑 | deterministic 实跑,签名交 tsc/test | L-DET | loop-until-dry 2 轮无新 confirmed bug |
| **广度** | 34 surface × 5 lifecycle × 5 persona + 8 价值链 | completeness-critic + J-META 自动census | L-MIX | 每 surface 有覆盖 + 每价值链跑通或记 gap,critic 2 轮无新 distinct gap |
| **交互** | hook行为delta/MCP payload质量/skill可遵循/策略遵守 | real-agent replay+埋点,rubric 锚 **HAX-18**,≥2多-LLM冷评 | L-LLM | 每 L-LLM surface 经 HAX rubric 冷评 |

**关键律**:① 执行者自评不可信(self 100%→冷评 81%),主观项必 ≥1 零上下文冷评 ② J-META census 自动 grep 抽,不手维护(漂移=anti-pattern)③ L-DET/L-LLM 诚实标注 ④ 可观测性 T1/T2/T3,加埋点把 T3 下沉可复盘 ⑤ critic 只能 frame 内审计,frame 由 human 挑战。

## 终止判据(7 扇 ship 门全绿即 auto-completed)

- **G-CENSUS** — 34 surface 每个三轴各至少探一次(∈ journey∪parity∪waiver)
- **G-VALUE-LOOP** — 8 闭环价值链每条 0 用户跑通 或 broken-gap 记 finding
- **G-DEPTH-DRY** — 深度轴 deterministic bug loop-until-dry(连续 2 轮)
- **G-EFFICACY** — 每 L-LLM surface 经 HAX-18 rubric + ≥2 多-LLM 冷评
- **G-OBSERV** — 每 interaction finding 映射 T1/T2/T3 + 埋点缺口标注
- **G-FIX** — confirmed func-bug + 明确坏设计 修+验;次优 efficacy defer 带 rationale
- **G-GREEN** — pcf tsc+test 绿 + werewolf 端 hook/MCP/skill smoke 绿

## LIBERAL capture 政策(核心)

像 bug 的、**设计导致疑惑的**、efficacy 弱的、**skill 当前遵循不了的**,**全部当 finding 记**(标 `finding_class ∈ {func-bug | design-confusion | efficacy-weakness | followability-gap | value-loop-broken | isolation-leak}`),再过 verify 阶梯(deterministic → 多-LLM 冷评 → human)判 confirmed/refuted。**目标:评完留下完整 findings ledger,不留空。**

## 边界

**IN**: 三轴完全测量 · liberal capture 全 finding_class · J-META 自动census + 价值链枚举 · L-LLM 走冷评 · confirmed 修/次优 defer · 两项目等权
**OUT**: werewolf 业务 bug · 次优 efficacy 的产品重设计(记+推荐不实施)· KP-leak F11/F15/F16 修复(已 defer v2.1,仅作隔离轴 reference)
**CONSTRAINTS**: verify 阶梯先取证 · 诚实标 L-DET/L-LLM · census 自动化非手维护 · fix 前验声称 · 两项目 commit 隔离

## 已 seed 的 4 条 finding(开局即非空)

| id | class | surface | verdict | 摘要 |
|---|---|---|---|---|
| **F1** | value-loop-broken | git-governance | **confirmed** | werewolf `.fabric` 整 gitignored→KB 不进 git→团队共享静默失效;install 不检测宿主遮蔽 |
| **F2** | design-confusion | hook fabric-hint | candidate | 本会话 archive+review nudge 相邻叠加,无合并/节流(待冷评是否过扰) |
| **F3** | followability-gap | cite-policy | candidate | 执行者本会话 cite KB:首行遵循率<100%,规则可遵循性存疑 |
| **F4** | isolation-leak | isolation-security | confirmed(defer) | KP-* 跨层泄漏 F11/F15/F16,归 v2.1,本 goal 作隔离轴 reference |

## 8 闭环价值链(详见 status.json `value_loops`)

VL1 核心知识环 · **VL2 团队 git 共享(BROKEN-suspected F1)** · VL3 cold-start import · VL4 decay 维护 · **VL5 nudge cadence(WEAK F2)** · **VL6 cite 治理(WEAK F3)** · **VL7 personal 隔离(BROKEN-known F4)** · VL_teardown uninstall

## Resume

续跑:`/goal-mode continue` 推进下一步,或 `/goal-mode status` 看进度。
收尾:7 门全绿时 `continue` 自动写 `status=completed` + `[[FINAL_NOTIFICATION]]`。
