# Goal Checklist — 设计知识规则三支柱 (Hook / Skill / MCP)

> status.json 是真源, 本文件是投影视图 + 行动手册。session: `20260530-design-rule-hook-skill-mcp` · 模式②审计 · 分支 `feat/v2.2-retrieval-governance`

## 目标 (Goal)

在前三轮 status.json 基础上, 正面设计 Fabric 三根"知识规则交付层"支柱, 补齐前三轮"挑卡片算法"中心研究遗留的交付层空白, 产出 v2.2 可吸收决策包。

## 三根支柱 (Pillars)

- **① Hook 注入** — 前三轮把 maestro hook 链拆透但结论几乎全 reject/defer; Fabric 自身 hook(broad/narrow/cite-policy)的**正面改进设计是空白**, 本轮补。
- **② 配套 Skill** — 前三轮判了"落成 fabric-* skill"但 **skill 内部 stage 编排/调原语/写回模式没拆**; 本轮**先普查知识相关 skill 全集**(spec-*/manage-knowhow/manage-harvest/manage-wiki/learn-* + fabric-archive/import/review, connect/digest 只是代表非闭集)再挑代表性深拆 —— ⚠️ 不拿两个例子把面打死。
- **③ MCP 知识设施 (最大真缺口)** — 前三轮全是检索算法, 但 Fabric 是 MCP-first, **各产品 MCP 工具层设计(粒度/one-shot 打包/引导 AI 调)没研究**, 本轮审 fab_* 工具面 + 对比产品。

## 边界契约 (Boundary)

**IN**: Fabric 自身 hook 正面设计 / skill 内部编排 / MCP 工具面设计 + 产品对比 + 吸收判定
**OUT**:
- ❌ 写实现代码 (只产决策包)
- ❌ store provenance / store-qualified cite (归 northstar D7, **严禁撞车**)
- ❌ 检索算法本身 (BM25/向量/RRF/salience — 前三轮已拆完)
- ❌ maestro hook 触发链机制重拆 (mining 轮 A1-A5 已判完)
**约束**: file:line 实证 / carry 前三轮结论不重挖 / absorb 必带 pillar + northstar 边界 / 双 LLM 冷评 grounded / 不善意补全

## 验收门 (Ship Criteria) — ✅ 全绿, status=completed

- [x] **G-PILLAR-COVERAGE** — 9/9 子任务 (H1-3/S1-3/M1-3) done 带 file:line
- [x] **G-DECIDE** — 15 候选三判定齐全, absorb 带 pillar pain_target
- [x] **G-BOUNDARY** — 15 候选全 northstar_boundary=non-overlap, 无撞车
- [x] **G-GROUNDED** — 双冷评 quorum=2 一致 0 REFUTED (gemini Fabric 全 GROUNDED + codex 产品全 CONFIRMED, 4 处行号 offset 已校正)

## 任务清单 (round 1, ceiling 14)

### 支柱① Hook 注入 → 候选 HK1-5
- [x] **H1** Fabric 5 hook 审计 — 真缺口: 无 always-pin/无注入 telemetry/SessionStart 无 token budget + 3 drift bug
- [x] **H2** 产品对比 — maestro 降级阶梯+markdown截断 / noosphere token 双cap; Fabric 已有 per-session dedup
- [x] **H3** → HK1(always-pin P1) HK2(SessionStart 降级 P1) HK3(telemetry P2) HK4(hygiene 3bug P0) HK5(defer)

### 支柱② 配套 Skill → 候选 SK1-5
- [x] **S1** 全集普查(maestro 18 IN + Fabric 4)→ 拆 3 代表。发现: manage-knowledge-audit 漏 / Fabric skill 偏科 → `.scratchpad/v22-pillar2-skill-census.md`
- [x] **S2** 产品对比 — valence capture/review-tensions + OpenAkashic stale/confirm/claim→capsule
- [x] **S3** → SK1(fabric-audit P1 最大缺口) SK2(connect P2) SK3(digest P2) SK4(reject already-have) SK5(裁决下沉 P2)

### 支柱③ MCP 知识设施 (最大缺口) → 候选 MC1-5
- [x] **M1** Fabric fab_* 审计 — recall 真 one-shot; 缺口 G1 只撞墙不预算/G2 引导不对称/G3 hook 引导矛盾
- [x] **M2** 产品对比 — OpenAkashic search_and_read_top one-shot + server instructions + tool manifest
- [x] **M3** → MC1(recall 打包增量 P1) MC2(server 引导层 P1 净新最高) MC3(修引导矛盾 P0) MC4(payload 预算 P2) MC5(对称 hint P2)

### 综合
- [x] **X1** 决策包 `.scratchpad/v22-three-pillar-decision-package.md` + 双冷评 quorum=2 0 REFUTED + v2.2 落地序

## Resume

续跑: 调 `/goal-mode continue` 推进下一个 open task → 跑 verification → 原子更新 status.json → 重检终止 gate。
收敛判据: 4 扇 ship_criteria 全绿 → `status=completed` + `[[FINAL_NOTIFICATION]]`。
