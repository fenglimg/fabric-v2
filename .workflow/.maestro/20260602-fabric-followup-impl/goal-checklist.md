# Goal Checklist — Fabric 后续 3 功能实现 (mode ① 计划驱动)

> **真源是 `status.json`**,本文件是投影视图。方案文档在 `.workflow/.scratchpad/fabric-followup-proposals/`。
> Session: `20260602-fabric-followup-impl` · 分支 `feat/fabric-followup-impl`

## 目标 (terminate 判据)
`task_decomposition[*].status` **全部 done**(每个实现 + deterministic 验证 + tsc/test 绿)。依次 ⑤→④→③。

## 任务(依次,depends_on 满足才动)
### ⑤ Cite 重设计(P5)— 最高优先
- **C1**: `cite-policy-evict.cjs` 改 recall-based 自动记账(PreToolUse recall→edit 重叠自动 cite;无 recall 软 nudge;不再要求首行)
- **C2**: AGENTS.md Cite policy 段重写(首行可选 override;parser 保留向后兼容)← C1
- **C3**: doctor `--cite-coverage` 口径迁移 + 三端 hook 同步 + 全 test ← C2

### ④ 冲突检测(P4,一步到位 LLM)
- **D1**: `conflict-lint.ts`(bm25 相似对 → LLM-judge 判真矛盾;seam 可注入 fake)
- **D2**: doctor check `knowledge_conflict` + config 阈值 + i18n + `--lint-conflicts` ← D1

### ③ 向量中文模型(P3)
- **V1**: 确认 fastembed-js 模型枚举(multilingual-e5-small / e5-large / bge-small-zh),定最终 pin(lokb 验证倾向 e5-small)← 研究 task
- **V2**: config `embed_model` + vector-retrieval 读 config 模型(替英文硬编码)← V1
- **V3**: install 可选"启用语义搜索"步骤 + reindex 说明 ← V2

## 边界 / 约束
**IN**: 按 3 方案文档实现 + test + 分批 commit
**OUT**: 3 功能外新需求 · KP-leak(多-store 已基本解)· 破坏现有行为
**CONSTRAINTS**: 向后兼容硬约束(cite/recall/hook 旧行为不破)· 改 shared 必 rebuild · LLM-judge seam 可注入 fake(test 不真调 LLM)· 改前 grep 验

## 选型已定(③)
`multilingual-e5-small`(lokb 同类产品实战:384维/120MB/100+语言含中文/速度够);BGE-M3 太重,MiniLM/nomic 仅英文,OpenAI 需云端不合离线。V1 仅确认 fastembed-js 是否支持该名。

## Resume
续跑 `/goal-mode continue`;收尾全 done 时自动 `status=completed` + `[[FINAL_NOTIFICATION]]`。
