# 支柱② S1 — 知识相关 Skill 全集普查 + 代表性编排拆解

> session 20260530-design-rule-hook-skill-mcp · task S1 · 2026-05-30
> 目的: 不预设只有 connect/digest, 先 census 全集再挑代表深拆, 显式标排除项防过早收窄

## 1. 全集表 (maestro .agy/skills + Fabric .claude/skills)

### maestro-flow IN (与"知识规则 / KB 维护检索"直接相关)

| skill | 用途 | 编排归类 |
|---|---|---|
| `spec-add` | 写一条短规则 spec-entry (`--ref` 建 knowhow 索引桥) | **写入原语** |
| `spec-load` | 按 category/keyword 载 spec (hook 注入入口) | **读取原语** |
| `spec-setup` | 初始化 spec 库 | 初始化 |
| `spec-remove` | 删 spec | 写入原语 |
| `wiki-connect` | 图链接发现 + 健康改善 (orphan rescue/打分/写回 related) | **维护/连接** ⭐ |
| `wiki-digest` | 主题聚类 + gap + 覆盖热力图 | **综合/审计** ⭐ |
| `manage-wiki` | wiki 图健康/清理/搜索/stats | **治理** |
| `manage-knowledge-audit` | 8 类/28 子场景知识淘汰 (keep/deprecate/delete 三态), 对称 harvest | **治理/淘汰** ⭐⭐ (前三轮漏) |
| `manage-harvest` | 把 artifact 抽取为 spec/wiki/issue | **抽取/写入** ⭐ |
| `manage-knowhow` | knowhow 文档增删查 | 写入/读取 |
| `manage-knowhow-capture` | 捕获可复用知识为模板/recipe | 抽取/写入 |
| `manage-learn` | 捕获+搜索学习 insight | 抽取 |
| `codify-to-knowhow` | 结构包→knowhow+spec (ref 链) | 抽取/写入 |
| `learn-decompose` | 从代码抽 pattern 入 spec/wiki | **抽取** |
| `learn-follow` | 引导阅读 code/wiki 抽 pattern | 抽取/导航 |
| `learn-investigate` | 假设检验+证据日志调查 | 抽取 |
| `learn-retro` | git 活动+决策质量回顾 | 综合 |
| `maestro-learn` | 路由到 learn-* | router |

### Fabric IN (自家全部知识 skill)

| skill | 用途 | 编排归类 | 成熟度 |
|---|---|---|---|
| `fabric-archive` | 归档对话洞察→pending (GATHER/REVIEW/PERSIST 3 macro-phase, MCP 写) | **写入/抽取** | 高 (ref 渐进加载+viability gate+幂等) |
| `fabric-import` | 冷启动从 git log+docs 回灌 pending | **抽取/bootstrap** | 高 |
| `fabric-review` | 审 pending+canonical (approve/reject/modify/defer) | **治理/审批** | 高 |
| `fabric-sync` (template) | 同步 managed block 三端 | 装配 | — |

### OUT (排除项 + 理由, 防"看着相关其实不是")

| skill | 排除理由 |
|---|---|
| `maestro-*` (init/plan/execute/fork/merge/roadmap/ralph/...) | workflow 编排器, 非知识规则 (mining 轮已 OUT) |
| `team-*` (coordinate/lifecycle/swarm/review/...) | 多 agent 团队编排, 非 KB |
| `quality-*` (test/debug/refactor/review/sync) | 质量门, 非知识维护 |
| `security-audit` | 安全审计, 非 KB |
| `manage-issue` / `manage-issue-discover` | issue 队列治理 (Fabric 无 issue pipeline, mining A7 已判复用 pending 流) |
| `manage-status` | 项目 dashboard, 非 KB |
| `manage-codebase-rebuild` / `refresh` | codebase **文档**重建, 非知识规则条目 (边界: 文档≠KB 条目) |
| `skill-iter-tune` / `workflow-skill-designer` | meta-skill (调 skill 本身), 不在知识规则交付层 |
| `learn-second-opinion` | 多视角咨询, 偏 review 非知识维护 (弱相关, 暂 OUT) |

## 2. 代表性 stage 编排拆解 (file:line)

挑覆盖"连接 / 综合-审计 / 抽取-写入 / 治理-淘汰"模式谱的代表:

### 模式 A — 维护/连接型: `wiki-connect`
源: `~/.maestro/workflows/wiki-connect.md:38-150` (SKILL.md 是薄壳, 真 stage 在 workflow.md)
```
Stage1 载入基线 (wiki list/health/orphans/hubs --json 并行)
Stage2 多维发现候选 (2a orphan rescue BM25+tag+category+parent / 2b 缺反向链 / 2c 传递闭包≤2hop / 2d type bridge)
Stage3 打分 (0.4×tag + 0.3×bm25 + 0.2×category + 0.1×bridge, filter≥min-sim, sort, limit max)
Stage4 呈现排序建议 (含 projected health delta)
Stage5 --fix 写回 (append related 去重 → maestro wiki update; 重算 health delta)
Stage6 持久化报告 + 沉淀 <spec-entry> 到 learnings.md
```
**编排骨架**: 载入原语 → 多维发现 → 公式打分 → 呈现 → 写回原语 → 报告+反哺。**纯 prompt 编排, 零打分 TS**, 全调 CLI 原语 (Fabric 对等: `fab_recall`/`fab_plan_context` 读 + 写回 related frontmatter)。

### 模式 B — 治理/淘汰型: `manage-knowledge-audit`
源: `manage-knowledge-audit/SKILL.md:44-90` (stage 在缺失的 knowledge-audit.md, 但 SKILL 暴露了 invariants)
```
对称 harvest(写入) 的淘汰入口; Stage1-8: scope 解析 → 三存储载入 → 时间线索引 → P0/P1/P2 finding → 三态决策(keep/deprecate/delete) → backup → mutate → report
```
**关键 invariant** (可直接借给 Fabric doctor): ① backup before mutate ② **deprecate over delete** (文本存储首选注 `status=deprecated` 保历史) ③ purge 双确认 ④ **rescue before delete** (删未抽取 artifact 前反向触发 harvest)。

### 模式 C — 写入/抽取型: `fabric-archive` (Fabric 自家, 对比基准)
源: `pcf/.claude/skills/fabric-archive/SKILL.md:26-126`
```
GATHER (Phase0 range → 0.5 config → 1 fab_archive_scan 服务端账本扫 → 2 candidates)
REVIEW (2.5 viability gate 反归档守卫 → 3 classify/layer/slug → 3.5 scope+relevance_paths)
PERSIST (4 fab_extract_knowledge 每候选一调 → 4.5 archive-attempt 账本)
```
**比 maestro 成熟处**: ① MCP-first 写 (fab_extract_knowledge, 禁直写 fs) ② ref/*.md 渐进加载 (SKILL.md 是 navigator stub) ③ viability gate + 幂等 key ④ DISPLAY/WRITE 硬规则分离。

## 3. 关键缺口结论 (喂 S3 设计建议)

**Fabric 知识 skill 拓扑严重偏科**:
- ✅ **写入/抽取轴成熟**: archive (对话→pending) + import (git/docs→pending) + review (审批) — 三件套覆盖"进货+质检"。
- ❌ **维护/治理轴空白**: 无任何对等于 maestro `wiki-connect`(连接发现) / `wiki-digest`(综合 gap) / `manage-knowledge-audit`(淘汰去重) 的 skill。Fabric 现状治理全压在 `doctor` (CLI lint) 一个入口, 无 LLM 编排的语义层维护 skill。

→ **配套 skill 候选方向** (S3 细化, 此处先标):
1. `fabric-connect` skill — 移植 wiki-connect 编排, 调 fab_recall 发现候选, 写回 related (依赖前三轮 H2 related 字段)
2. `fabric-digest` skill — 移植 wiki-digest, gap→pending (复用 fabric-review 流)
3. `fabric-audit` skill — 移植 manage-knowledge-audit 的"deprecate over delete + rescue before delete"语义淘汰, 补 doctor 之上的 LLM 语义层 (与 doctor lint 互补非替代)

→ **编排范式选择**: Fabric 已有的 GATHER/REVIEW/PERSIST + ref 渐进加载 + MCP-first 写, 比 maestro 的 workflow.md numbered-stages 更先进; 新 skill 应**沿用 Fabric 自家范式**, 只借 maestro 的 stage 逻辑 (多维发现/打分公式/三态淘汰 invariant), 不照搬其 workflow.md 结构。
