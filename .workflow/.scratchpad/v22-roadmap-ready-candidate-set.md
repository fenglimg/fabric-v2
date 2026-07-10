# v2.2 Roadmap-Ready 候选集 — 多-LLM 对抗批判审定终态

> 2026-05-30 · session `20260530-v22-pool-critique` · 模式②审计 converged · 分支 `feat/v2.2-retrieval-governance`
> 机制: gemini+codex 双零上下文冷评(读真代码 file:line)+ claude 综合, quorum=3 · 真源 status.json
> 全池 36 条(21 DO + 7 设计 + 8 defer)→ **17 absorb-v2.2 / 16 defer-v2.3 / 3 reject**, 零 limbo

## 0. 护城河 D(2026-05-30 human 重定义 — 本轮批判基线)
- **D1 三端 AI-交互-内集成**: Hook+Skill+MCP 织进 CC/Codex/Cursor agent loop + cross-client parity(主 CC+Codex, Cursor 暂弱化)。最核心壁垒。
- **D2 MCP-first**: 行为由 MCP 连接驱动, CLI 为附带运维面。("离线零依赖"并入此条不单列)
- **D3 Lifecycle governance**: cite-contract + maturity + archive + orphan demote + health, 防 KB 慢速死。
- **D4 AI-in-loop curation**: 知识由 AI 在循环内自动 surface+propose 入库, capture→review→surface 闭环。
- **剔除**: ~~no-server-filter~~(废) · ~~离线零依赖~~(并入 D2)。
- **下游反转**: ① top_k/BM25 不再撞护城河(纯质量工程); ② C2 向量反对理由大幅削弱 → 升 human 重评(见 §4)。

## 1. v2.2 ABSORB 集(17 条)— 按 wave

### Wave 1 — 止血 + 检索/MCP 地基(7) ✅ DONE
> 验证完成: 2026-06-05 代码审计确认全部已实现

| id | P | rationale(grounded) | 状态 |
|---|---|---|---|
| MC3-fix-guidance | P0 | broad hook `:660` 输出"直接 fab_get_knowledge_sections"(缺 selection token 误导) vs `:782` 建议"先 fab_recall"。最便宜高 ROI 保 D1。**须先于 MC1** | ✅ 已实现 `knowledge-hint-broad.cjs:757-759` |
| A-INFRA-2-CJK | P0 | 中文 KB BM25 前提; 无 CJK 中文相关性塌 | ✅ 已实现 `text-tokenize.ts:43-68` CJK bigrams |
| A-INFRA-1-BM25 | P0 | `plan-context.ts:626/635` 仅 recency+locality 无正文相关性; top_k 安全前置。dep CJK | ✅ 已实现 `plan-context.ts:909-914`, `bm25.ts:45-99` |
| A-INFRA-3-topk | P0 | `:262/273` 候选全量无 slice; 序: BM25 之后(先截断固化弱排序成数据损失)。dep BM25 | ✅ 已实现 `plan-context.ts:391-400`, 默认 topK=24 |
| MC4-payload-budget | P1 | `mcp-payload-guard.ts:36` 超 64KB hard throw=可用性风险, 应返可继续裁剪包。dep topk |
| MC2-server-instructions | P1 | server 仅 name/version(`index.ts:158`)缺 server-level 操作规范, 强化 D2 净新价值 |
| H2-related | P1 | `agents-meta.ts:44` 仅 tags/relevance_paths 无 related 图边; SK2/MC1 前置, 越早越好 |

### Wave 2 — 预算 + 治理写入 + schema(6)
| id | P | rationale |
|---|---|---|
| C3-salience | P1 | 加 maturity/lifecycle 信号, 作 BM25 后 tie-breaker(防高成熟低相关压过正文)。dep BM25 |
| HK2-degrade | P1 | broad hook 有 top_k+trunc 无预算阶梯; KB 膨胀必选 |
| C5-budget | P1 | `fabric-config.ts:20` 有 mcpPayloadLimits 缺分层裁剪策略; 绑 top_k/payload。dep HK2,MC4 |
| MC1-recall-pack | P1 | `recall.ts:53` 已合并 plan+sections 但返全量 bodies, 缺 directive/_next/truncation/include_related。dep H2,MC4 |
| SK1-audit | P1 | `doctor.ts:1082` 有 lint 缺语义 audit skill; 补 D3 最大 skill 缺口, deprecate-over-delete |
| SK5-adjudication-sink | P2 | 裁决表+契约下沉 skill ref 减 bootstrap 膨胀(`doctor.ts:313` skill token budget lint 支撑) |
| **C2-vector** | P1 | 【human 2026-05-30 拍 现在做】护城河废离线后捞起; CJK 语义鸿沟靠向量降维打击, fastembed MCP-first 下可接受。dep BM25; 实现守 `--no-embed` 默认关 + text-only fallback + 自 pin cache-only/CPU |

### Wave 3 — 观测 + 图谱 + 长尾(4)
| id | P | rationale |
|---|---|---|
| HK3-telemetry | P2 | `metrics.ts` 覆盖消费侧, 注入侧无 injections.jsonl 算不出真命中率; 解锁 HK5/A13 触发器 |
| SK2-connect | P2 | H2 落点成立后回写稳定图边。dep H2 |
| MC5-action-hint | P2 | `api-contracts.ts:9` warning schema 有 action_hint 但各工具不对称, 低成本统一 |
| A14-doctor-health | P2 | `doctor.ts:1082/1266` 多 check 缺 0-100 rollup; 供 SK1/产品面消费 |

### 依赖链(统一截断架构关键)
```
CJK → BM25 → top_k → payload-budget   (同链: 分词→排序→条数截断→字节预算, MC1 _next 读同一截断后 ids, 防双切坏游标)
MC3 ⊰ MC1                              (先修引导文案)
H2 → SK2 / H2 → MC1(include_related)
HK2 + MC4 → C5
BM25 → C3(tie-breaker)
```

## 2. REJECT(3)— 闭于理由
| id | rationale |
|---|---|
| **HK4-hygiene** | 【亲验裁决】3 子 bug 全已修: cite-tag→`LEGACY_CITE_TAG_REMAP` recalled→applied(`cite-line-parser.ts:83`); archive-hint→折进 Stop hook `fabric-hint.cjs`(已注册); broad 多窗互抑→broad hook 本设计无 dedup 态(`:8-13`)。gemini 未验代码误判 absorb。真残留引导冲突归 MC3 |
| A9-realtime-validator | PreToolUse 非阻断信息面(`narrow.cjs:57`), 实时校验增延迟+误报撞 D1; 校验后置 doctor/audit |
| A2-injection-keyword | hook 侧 keyword 召回复制 server 检索撞 D2; BM25/CJK 在 plan_context 统一解(no-server-filter 废不改此结论) |

## 3. 设计抉择 7 条 — 终判(全 resolved)
| id | verdict | 触发器/rationale |
|---|---|---|
| A6-inline-ref | defer-v2.3 | 长文档双载体改 schema+retrieval contract, 不抢 budget/top_k 前; 检索地基稳后重评 |
| A8-knowhow-fields | defer-v2.3 | 类型化字段牵动 frontmatter/review/MCP I/O; A14 后看维度过滤真需求 |
| A18-virtual-wiki | defer-v2.3 | 防"遥测变知识"反馈环撞 D3; 仅 provenance(v2.1)就绪后重评 |
| A21-progressive-fill | defer-v2.3 | harness-agnostic 触发器不清晰易变隐式写入撞 D4 |
| A20-harvest-routing | defer-v2.3 | 多源多目的扩散权限/review 语义; audit/connect 稳后 |
| A9-realtime-validator | **reject** | (见 §2) |
| A2-injection-keyword | **reject** | (见 §2) |

## 4. ⚠ 升 HUMAN — needs_adjudication(非阻断)
- **C2-vector(absorb vs defer 真分歧)**: gemini=absorb-P1(护城河废离线→CJK 语义鸿沟降维打击, fastembed server 成本可接受, 现在捞起) · codex=defer(向量仍引入模型体积/隐私/缓存生命周期 3 风险, 仅 BM25+top_k precision 不足才吸收)。provisional=defer-v2.3 保守; **user 本轮主动重定义护城河部分意在重评向量** → 请拍 absorb-now vs defer-with-trigger。
- **软分歧批(已 grounded 综合落锁, FYI 可一并 confirm/翻)**: HK1→defer(撞 D3/D4 须 pin 降级设计) · HK3→absorb-P2 · SK2→absorb-P2 · A18/A20→defer · H1→defer · 优先级手感 SK1-P1/MC2-P1/A14-P2/SK5-P2。

## 5. DEFER-v2.3(16)— 带触发器
C1-RRF(BM25 eval precision 不足)· **C2-vector(见§4)** · HK1-alwayspin(pin 降级设计+A14 后)· HK5-token-cap(HK2/HK3 后真 telemetry)· C4-endorsement(cite-quality 质量模型, 防 Goodhart)· SK3-digest(H2/SK1 后)· A6/A8/A18/A20/A21(见§3)· A-INFRA-4-index-cache(BM25 性能瓶颈)· A13-hook-tier(隐私/性能 telemetry)· A19-A7-B11(第二写入 skill 诉求)· H1-readonly-cli(MCP 故障支持成本)· H4-personal-seed(onboarding 非 backend 主线)。

## 6. Portfolio 校验
- **MOAT-CLEAN ✓**: 17 absorb 项零护城河冲突(冲突全落 reject/defer)。
- **v2.1-BOUNDARY-CLEAN ✓**: 零 absorb 触 provenance/多store/全局registry; H2-related 仅 per-entry intra-store 图边, 与 v2.1 多store stable_id namespace 正交。
- **隐藏冲突已解**: top_k/payload 重叠→统一截断链 · A2/BM25 重复→A2 reject · endorsement/Goodhart→C4 defer · HK1/health→HK1 defer · A18/治理日志→A18 defer。
- **portfolio 级双 LLM 批判**: gemini+codex 三波结构 + 隐藏冲突清单高度一致, 无未解严重分歧。

## 7. 下一步(本 session 边界外)
v2.2 = 跨 rc 里程碑。建议起 maestro 实现 session, Wave 1(7 条 P0 密集)优先; C2-vector 待 human 拍后并入 Wave 2 或保 defer。
