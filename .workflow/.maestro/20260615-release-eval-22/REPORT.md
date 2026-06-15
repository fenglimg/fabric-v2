# Fabric 2.2.0-rc.6 发版前体检报告 v1

> 生成: 2026-06-15 · session 20260615-release-eval-22 · mode③ 混血 · 12/13 命名 ship gate 绿(G-SHIP 待人裁)
> 真源: `status.json`(本文件是人可读投影)· 所有结论可由 `scripts/*.mjs` 一键复现

---

## ① 总览矩阵(5 被测面 × 6 维度 + 0 跨域盲区)

| Ship Gate | 维度 | 硬/软 | 判定 | 一句话证据 | 复现 |
|---|---|---|---|---|---|
| **G-MACHINE** | 1 机器闸 | 硬 | ✅ | build/typecheck/lint/test(2403/0)/strategy/store-only-e2e 全绿 | `pnpm test` 等 |
| **G-CENSUS** | 2 完备性 | 硬 | ✅ | 33 surface 活注册表派生全 wired,零未接线空壳 | `scripts/surface-census.mjs` |
| **G-OBSERV** | 2 可观测 | 硬 | ✅ | 18 死电线诚实红账;6 行为遥测簇标"不可评分"→ADJ-1 | `.scratchpad/T2-observ-census.md` |
| **G-NOFAKE** | 3 行为 | 硬 | ✅ | 19 真实 cite 事件 0 编造 ID,检测器非盲 | `scripts/nofake-audit.mjs` |
| **G-HABIT** | 3 行为 | 软 | ✅ | 激活漏斗 9/9 阶段非零,翻库率 2.71 | `scripts/habit-funnel.mjs` |
| **G-PERF** | 4 性能 | 硬 | ✅ | 延迟 p95 达标;注入 3.6KB/recall 24-29KB 在 65K hard 内 | `scripts/measure-injection.mjs` |
| **G-DISPLAY** | 5 展示 | 软 | ✅ | 漂移闸绿+无错渲染;冷评 1-2/5(F4 dev-facing,不卡) | `.scratchpad/g-display-screens.md` |
| **G-SAFETY** | 6 安全 | 硬 | ✅ | 红队 18 攻击/5 类全容器(投毒/越权/budget/注入/PII) | `scripts/red-team-safety.mjs` |
| **G-UPGRADE** | 0 升级 | 硬 | ✅ | 黑盒升级 e2e:stale hook/skill 重装刷回当前版(P0-NEW1) | `scripts/upgrade-e2e.mjs` |
| **G-RESILIENCE** | 0 韧性 | 硬 | ✅ | 并发隔离 5/5 + backend-down 降级 3/3 + 多store round-trip | `scripts/resilience-probe.mjs` |
| **G-SELFAUDIT** | 0 防腐 | 硬 | ✅ | registry vs scorecard diff,缺行→exit1(负向证伪) | `scripts/self-audit.mjs` |
| **G-HONEST** | 0 诚实 | 硬 | ✅ | a-e 元自检全过(对账/时间戳/丢弃log/baseline据/中立) | `scripts/honest-selfcheck.mjs` |
| **G-SHIP** | 0 发布 | 硬 | ⬜ | **待人裁** — 不可逆外向动作需用户授权 release-rc | — |

**被测面覆盖**: Hook(6)/CLI(13 cmd)/MCP tool(6)/Skill(8)/产出展示(4 画面)= G-CENSUS 33 surface 全派生。

---

## ② 性能区(G-PERF)

| 面 | 指标 | 实测 | 阈值 | 判定 |
|---|---|---|---|---|
| CLI 冷启 | p95 延迟 | ≈297ms | ≤2000ms | ✅ |
| Hook 冷启 | p95 延迟 | ≈138ms | ≤500ms | ✅ |
| Hook 注入 | payload | 3650B | warn 16K | ✅ |
| recall(service) | payload | 24159B | hard 65K | ✅ over-warn 在 hard 内 |
| recall(MCP wire) | payload | 29333B | hard 65K | ✅ |

- recall over-warn(>16K)对 36 条语料属设计内预期;description-first 在工作(24 候选仅 6 返 body)。runtime `mcp_payload_warn` guard 在线。
- **loop 失控结构三重界**: top_k 候选上限 + `trimToPayloadBudget` 截尾 + `enforcePayloadLimit` hard-stop throw。

---

## ③ 具体画面区(G-DISPLAY · 真实采集带时间戳)

采集 4 画面(`.scratchpad/g-display-screens.md`, 本次 run 2026-06-15T09:05Z):
- **SessionStart 注入 / broad banner**: KB 列表 + revision_hash + read-set stores。
- **doctor**: i18n zh-CN 健康总览,严重度排序,可执行 remediation。
- **doctor --cite-coverage**: cite 合规率/recall 覆盖率/mutation 归因。

**渲染正确性(硬闸)**: ✅ 零快照漂移 + 无原始 i18n key 泄漏 / 无乱码 / 无未闭合标记。

**主观可读性(B 零上下文冷评, 不卡 → F4)**: gemini 给 1-2/5,评"无产品感,像研发调试控制台"。
- 卡点: 内部代号(`team:KT-DEC-0001`)、函数名泄漏(`fab_recall`)、代码黑话(`startRotationTick`/`bumpCounter`)、中英夹杂、metrics 无上下文。
- **Caveat(诚实)**: 冷评按消费级受众判,但 Fabric 受众=开发者(`fab_recall`/`stable_id` 是其常识),部分严苛属 audience 错配。
- **真信号(对开发者亦成立)**: TL;DR 与正文冗余、中英夹杂 → **2.3 UX-polish 候选,非 2.2 blocker**。

---

## ④ 行为区(G-NOFAKE 硬 + G-HABIT 软)

**G-NOFAKE — 编造 ID 审计(真实 cc dogfood)**:
- 19 真实 cite/consume 事件、12 distinct stable_id,**全解析到 40 个有效 KB id,编造 = 0**。
- 检测器非盲(合成假 id 被 flag)+ valid-set 非空守卫(防 false-green)。
- 检测器报告路径(`cite_id_unresolved`)另有单测+集成测(case10 断言值 3 浮出)。

**G-HABIT — 激活漏斗 baseline v1**:
```
surface 7 → plan 10 → consume 19 → select 3 → fetch 3 → edit 55 → archive_policy 1
翻库率(consume/surface)= 2.71   floor(surface≥1 ∧ consume≥1)= pass
```
KB 既被推(7)也被拉(19),习惯环活。baseline 固化 `.scratchpad/g-habit-baseline.json`。

**降级显式记账(诚实律)**: codex 行为侧未跑(需独立 dogfood session)→ soft/分诊降级,非阻断;硬条件"编造 ID=0"在 cc 真实数据成立 + 检测器机制已证。

---

## ⑤ 结论区

**判定: 11 实质 gate 全绿(8 硬 + 2 软 + G-HONEST),G-SHIP 待人裁。** 无硬闸红。

**4 findings**:
- F1 (medium, 已修): store-only-e2e gate 路径陈旧 false-red → 改用 `storeRelativePathForMount`。
- F2 (low, refuted): recall payload "回退"假设不成立 — 在 65K hard 内,description-first 工作中。
- F3 (medium → ADJ-1): 6 行为遥测 event_type 死电线(skill_invocation*/llm_judge_run/client_capability_snapshot)。
- F4 (low, 不卡): 展示画面 dev-facing 冷评 1-2/5 → 2.3 UX-polish 候选。

**1 待人裁(ADJ-1, 推荐 B)**: 行为遥测死电线补埋点 vs 降级。推荐 **B = 降级**(G-HABIT 用现有活线漏斗评分,skill/judge 维度标"不可评分待 2.3 补埋点"),不阻 2.2。**需用户拍板**。

**G-SHIP 人裁点(不可逆)**: 全实质 gate 绿后,`release-rc` 摘 -rc 发 2.2.0 是不可逆外向动作(npm publish + tag),按裁决阶梯无条件升 human。**需用户显式授权方可执行**。

**常驻评测集 v1 固化**: 8 个 `scripts/*.mjs`(census/self-audit/red-team/resilience/upgrade/nofake/habit/honest)+ baseline JSON + 本报告口径,已随 commit 进 repo。下次 rc 一键复跑;新增 surface 未重生 census → G-SELFAUDIT 自动亮红(不腐烂)。
