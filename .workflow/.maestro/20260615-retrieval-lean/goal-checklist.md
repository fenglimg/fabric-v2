# Goal Checklist — Fabric 检索/注入向 Memory 收敛 (mode ③ 混血)

> **真源是 `status.json`,本文件是投影视图。** 状态变更先改 status.json。
> Session: `20260615-retrieval-lean` · 分支 `feat/retrieval-memory-convergence`

## 北极星
把 7 条已批准决策 (KT-DEC-0026..0031 + KT-MOD-0001) 落成代码。clean-slate **直接删,不留兼容垫片** (KT-DEC-0002)。

## 终止判据 (命名 ship gate 全绿)
- **G-W1-RETRIEVAL** — recall 返回无 body 带 path;旧两步 MCP 工具下线;include_related 只浮 id
- **G-W2-SPINE** — dogfood SessionStart 渲染符合定稿(broad 全见 / 家规带正文 / 决策带钩子 / narrow 沉默)
- **G-W3-OBSERVABILITY** — Read 正文产生 knowledge_body_read 事件;cite-coverage 记账不变
- **G-W4-LINT** — 三条 lint 触发正确(broad-index-drift / narrow空路径非法 / backstop schema)
- **G-W5-DOCS** — 全 repo grep 无残留两步流程旧文案(除 CLI plan-context-hint)
- **G-SHIP-TSC** — `pnpm -r exec tsc --noEmit` 通过
- **G-SHIP-LINT-TEST** — lint / test 全绿

## 边界契约
- **in**: W1 检索塌成 1 工具 / W2 SessionStart 重裁 / W3 观测电线 / W4 三轴 scope+lint / W5 文档同步
- **out**: CLI plan-context-hint(保留)/ 新建 wiki 导航面(YAGNI)/ 任何兼容垫片
- **约束**: clean-slate 直接删 · 三端镜像改 templates 源+`fabric install` · shared schema 改了必 rebuild · release 前必跑 tsc · 每 wave 收口即 commit · 改前先 `fab_recall`

## Waves (任务清单)

### W1 — 检索塌成 1 工具 (KT-DEC-0026 / KT-GLD-0005)
- [x] **W1-1** recall.ts 改只返描述+路径;删 selectBodyBudgetedIds/applyBodyHardCeiling/rules[]/body_tier ✅ 34 tests green
- [ ] **W1-2** 退役 fab_plan_context + fab_get_knowledge_sections MCP 工具;保留 CLI plan-context-hint
- [x] **W1-3** include_related 改 C-1:候选浮 related id,不取 body ✅

### W2 — SessionStart 脊柱重裁 (KT-DEC-0027/0028/0029, KT-MOD-0001)
- [ ] **W2-1** broad 全显示,废 hint_broad_top_k;每行字数封顶;broad_index_backstop 兜底+报漂移
- [ ] **W2-2** 类型分等:guideline/model 灌正文(降级退索引行);decision/pitfall/process 仅标题+must_read_if 钩子
- [ ] **W2-3** SessionStart 对 narrow 完全沉默(删 ON-DEMAND 计数 + dropped-other-project)
- [ ] **W2-4** footer 改 fab_recall(paths)+recall(ids)/Read 约定(删两步文案)

### W3 — 观测电线 (KT-DEC-0030)
- [ ] **W3-1** PostToolUse hook 盯 Read ~/.fabric → 发 knowledge_body_read(id+store)
- [ ] **W3-2** knowledge_selection/knowledge_sections_fetched 作废;knowledge_context_planned 保留
- [ ] **W3-3** doctor 加防哑火检查(有 Read 无 body_read)

### W4 — 三轴 scope + 配置/lint (KT-MOD-0001)
- [ ] **W4-1** broad_index_backstop 入 fabric-config schema(20..500)
- [ ] **W4-2** doctor broad-index-drift lint(warn@80%,按 store 归因)
- [ ] **W4-3** doctor narrow+空 relevance_paths=非法 lint

### W5 — 文档/bootstrap 同步 + wiki 护栏 (KT-DEC-0031)
- [ ] **W5-1** 重写删两步流程:.fabric/AGENTS.md ×2 + README + .cursor/*.mdc
- [ ] **W5-2** 7 fabric skill ref/ 两步流程文案重写
- [ ] **W5-3** wiki 护栏:related[] 保持 id-based 单向无类型;不建多余面(验证性)

## Resume
推进:`/goal-mode continue`(单步 = 推一个 task → 跑 verification → 原子更新 status.json → 重检终止门)。
状态:`/goal-mode status`  ·  收尾:`/goal-mode close`
