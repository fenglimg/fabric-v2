# 方案 ④ — 冲突/矛盾知识检测(新能力)

> 现状:两条互相矛盾的笔记可静默共存,recall 把矛盾的都端给 AI 无警示(F20)。

## 目标
让 Fabric 能发现"知识库里互相打架的条目对",在 doctor 体检时报警,引导用户淘汰/合并一条。

## 设计:分两级,先做便宜的 v1
冲突检测的难点 = "相似" ≠ "矛盾"。两条都讲 auth 但不冲突很常见。所以分级:

### v1(便宜,先做)— 相似对 flag,人判矛盾
- 复用已有 `bm25.ts`(+ 可选 `vector-retrieval.ts`)对**同 type 同 layer** 条目两两算相似度。
- 相似度超阈值的**候选对**进 doctor warn:"这两条高度相似,可能重复或矛盾,请 review 一条"。
- **不引入 LLM**(doctor 保持确定性/离线);只做"可疑对"召回,矛盾与否由人 review 拍。
- 阈值保守(宁少报,避免噪声)。

### v2(可选,后续)— LLM-judge 判真矛盾
- v1 的可疑对,丢给多-LLM 冷评判"是否真矛盾"(复用本次冷评机制),只把判为矛盾的报为 error。
- 需 LLM,放 nightly/手动 `fabric doctor --lint-conflicts --deep`,不进默认 doctor。

## 具体改动(v1)
| 文件 | 改动 |
|---|---|
| 新 `packages/server/src/services/conflict-lint.ts` | 同 type/layer 条目两两相似度(复用 bm25),超阈值产候选对。 |
| `packages/server/src/services/doctor.ts` | 加 check `knowledge_conflict_candidates`(warn 级,默认开或 `--lint-conflicts` 开)。 |
| `packages/shared/src/schemas/fabric-config.ts` | 加 `conflict_lint_similarity_threshold`(可调,默认保守)。 |
| i18n locales | 新 check 的 name/message/remediation 中英。 |

## 风险
- 假阳性(相似≠矛盾):v1 用词"可能重复或矛盾,请 review",不武断报 error;阈值保守。
- 规模:N² 两两比较;大库需限同 type 内 + top-K 近邻(用现有 top_k/budget 设施)。

## 测试
- fixture:已知"矛盾对"(decision A 用 X / decision B 用非 X 同主题)→ 应进候选;"无关对"→ 不进;"相似但不矛盾对"→ v1 会进候选(可接受,人判)。

## 工作量估计
v1 中等(复用 bm25 + 新 doctor check,纯增量)。v2(LLM-judge)另算,建议先 v1 看实际噪声再定要不要 v2。
