# v2.2 全池清账 — 闭环 maestro-flow + 同类产品 + 腾讯文章 + 4 轮调研

> 2026-05-30 · 分支 feat/v2.2-retrieval-governance · 目标: 每个候选显式归位, 不留 limbo = 不留遗憾
> 源: project_kb_candidate_pool_master memory (Part A 21 + Part B 18 + Part C 4 + Part H 5) + mining/infra/hybrid/三支柱 4 轮

## 归位图例
✅ DONE(rc.32-39 已建) · 🎯 v2.2-DO(本里程碑做) · ⏸️ v2.1-NORTHSTAR(全局化独立线) · ❌ REJECTED(闭于拒绝, 有理由) · ⚪ DESIGN(需先拍板) · 🔮 DEFER(条件/低优, 带触发器)

---

## 一、✅ 已闭环 (rc.32-39, 不是 v2.2 工作, 列出防重提)
- C1 cite policy 全链路(85%, soak 中) · C2 archive recall(rc.38 闭环) · C3 SKILL 超标(rc.28/34/37 trim) · C4 remediation guardrail(rc.37 NEW-8)
- A11 dual store · A15 session dedup · B9 maturity 3档+orphan demote · events 膨胀治理(rotation/gzip/cite-rollup)

## 二、🎯 v2.2-DO — 真正要做的, 按 5 主题归并(去重后 ~22 项)

### 主题1 检索质量 (scoreDescriptionItem 2信号→6信号 + 内容相关性)
| 候选 | 来源 | 优先 | 备注 |
|---|---|---|---|
| C3 salience(maturity/lifecycle/recency 线性) | hybrid | P1 | **最高 ROI 零依赖**, persistor salience.go:15-21 |
| A-INFRA-1 BM25 内容相关性 | infra | P1 | search.ts:134-163, 落 plan-context.ts:619 |
| A-INFRA-2 CJK tokenizer | infra | P1 | 中文 KB 上 BM25 生效前提, 与 BM25 绑定 |
| C4 endorsement(cite confirm/dispute 接入) | hybrid | P2 | OpenAkashic retrieval.py:415-443 |
| A-INFRA-3/C6 top_k 截断 | infra/hybrid | **P0** | plan-context.ts:251 无 slice, 但须排 BM25 后 |

### 主题2 注入治理 / Hook (本会话三支柱①)
| 候选 | 来源 | 优先 | 备注 |
|---|---|---|---|
| HK4 hook hygiene 3 bug | 三支柱 | **P0** | cite-tag drift / archive-hint 未注册 / 多窗口去重 |
| HK1 always-inject pin(=A5) | 三支柱/mining | P1 | fabric-config 加 always_knowledge_ids |
| HK2 SessionStart 降级阶梯(=A3+A4) | 三支柱 | P1 | 借 maestro context-budget.ts:40-169 |
| C5 token budget(注入层 + MCP 层) | hybrid | P2 | noosphere budget.ts; HK2 配套 |
| HK3 per-inject telemetry(=A12) | 三支柱/mining | P2 | injections.jsonl 注入侧 |

### 主题3 配套 Skill (本会话三支柱② — 补维护治理轴空白)
| 候选 | 来源 | 优先 | 备注 |
|---|---|---|---|
| SK1 fabric-audit(语义淘汰) | 三支柱 | P1 | 最大 skill 缺口 |
| H2 related 字段(图基础) | Part H/mining | P1 | SK2 connect 前置 |
| SK2 fabric-connect(=A16) | 三支柱/mining | P2 | 依赖 H2 |
| SK3 fabric-digest(=A17) | 三支柱/mining | P2 | gap→pending |
| SK5 裁决表+契约文档下沉进 skill | 三支柱 | P2 | 减 AGENTS.md 膨胀 |

### 主题4 MCP 知识设施 (本会话三支柱③ — 最大缺口)
| 候选 | 来源 | 优先 | 备注 |
|---|---|---|---|
| MC3 修 hook 工具引导矛盾 | 三支柱 | **P0** | broad:638 vs :744 |
| MC2 server-level instructions+tool manifest | 三支柱 | P1 | **净新最高价值**, Fabric 全缺 |
| MC1 fab_recall 打包增量 | 三支柱 | P1 | directive/截断/_next/include_related |
| MC4 MCP payload 预算(=A-INFRA-3 MCP 落点) | 三支柱/infra | P2 | 撞 64KB hard 前预算 |
| MC5 对称收敛 action_hint | 三支柱 | P2 | 廉价 |

### 主题5 治理可观测
| 候选 | 来源 | 优先 | 备注 |
|---|---|---|---|
| A14 doctor KB health 0-100 分 | mining | P2 | doctor 加 rollup, 互补 lint |

## 三、🔮 DEFER — 条件/低优, 带触发器 (v2.2 可选尾, 不强求)
| 候选 | 触发器 |
|---|---|
| C1 hybrid RRF(in-memory) | BM25+top_k 落地后, 若 precision 仍不足 |
| C2 向量(fastembed 可选依赖)+C7 fallback | KB 规模到阈值 + 接受 npm +180MB; 做成 --no-embed 默认关 |
| HK5 token 双 cap(精确版) | HK2 落地后规模需要 |
| A-INFRA-4 索引缓存 | 随 A-INFRA-1 倒排索引引入 |
| A13 hook tier(minimal/standard/full) | 有隐私/性能诉求时 |
| A19 codify manifest / A7 tool:true / B11 catalog | 低优, 有第二写入 skill / 工具诉求时 |
| H1 fab knowledge ls/cat(只读 CLI 旁路) | MCP 瘫痪兜底; rc.39 曾 drop, mining 复核 defer P3 |
| H4 personal seed | 一次性教学 |

## 四、⚪ DESIGN-决策 — 需先拍板才能 roadmap (不拍板=遗憾)
| 候选 | 决策点 |
|---|---|
| A6 inline+ref 双层模型 | Fabric 要不要引入"长文档"第二载体(短 entry ↔ 长 ref)? 影响 schema |
| A8 knowhow 类型专属字段(decision.status 等) | 5 类要不要加类型化字段做维度过滤? |
| A18 virtual wiki adapters | events.jsonl/archive 要不要只读投射成 KB 候选? 影响数据模型 |
| A21 progressive fill(事件→category 自动沉淀) | Fabric harness-agnostic 下等价触发器是什么? |
| A20 harvest 多源→多目的路由 | fabric-archive 单源单目的 → 要不要泛化多路由? |
| A9 实时 spec-validator(PreToolUse 校验) | narrow hook 要不要加 frontmatter/glob 实时校验? |
| A2-injection(keyword→entry 注入 hook) | no-server-filter 松绑后, 注入侧 keyword 召回要不要做?(检索侧已由 A-INFRA-1/2 解) |

## 五、❌ REJECTED — 闭于拒绝 (有理由, 不做也是闭环)
- B1-B8(腾讯, 4 轮拒): ACT-R 阶梯/5-layer scope/16-stage/RBAC/共识/矛盾检测/连接器
- A1 AGENT_CATEGORY_MAP(冲突 path-binding) · A22 双轴分类(冲突 no-server-filter)
- A-INFRA-5/C8 重图检索(≥4 产品确认无主图检索) · SK4 写前 dedup(already-have)
- B16-B18 远程操控/通知 push/YOLO(Part E boundary) · H5 review TUI(rc.39 grill drop)

## 六、⏸️ v2.1-NORTHSTAR — 全局化独立线 (★关键: 不是 v2.2)
- 全局化 registry(co-location→~/.fabric + 项目瘦绑定) · 多 store 平行 git 模型 · store identity UUID
- 分层写路由 · read-set required_stores∪personal · resolution 双轴+store tie-break
- D7 交互层: store provenance / store-qualified cite / hook store 标签
- A10 跨项目 scope · B13/B14/B15 team-knowledge.git promotion
- 见 [[project-layered-kb-registry-northstar]]; 影响面审计 round3 已闭合(2026-05-30)

---

## 现实校验 (诚实, 不为迎合"全做"而打肿)

1. **"v2.2 rc 版本全部完成"需拆**: 单个 rc 装不下 ~22 主线 + 设计尾。v2.2 应是**里程碑**(milestone), 分 wave 跨 rc.40-rc.4X 交付; 不是单 rc。
2. **v2.1 全局化是独立大线**, 体量≈其余全部之和。把它吞进 v2.2 会让 v2.2 无界。**建议: v2.1 先走完(或并行), v2.2 = 闭环"除全局化外的全部候选池"**。这需用户拍板。
3. **设计尾 7 项(第四节)需先决策**才能进 roadmap。"不留遗憾"= 给每条一个 explicit 归宿, 而非全塞进做。

→ 真正的"不留遗憾"= 全池每条都已归位(本文件), 且 v2.2-DO 有 wave 计划, 设计尾有 explicit 决策, 拒绝项闭于理由, 全局化归 v2.1。
