# Goal Y — store-aware 读侧 lint 重实现(backlog spec)

> 从 fallback-purge 收尾 grill(2026-06-12)派生。用户拍「先净化(Goal X)另起 reimpl goal」。
> 前置:Goal X(`doctor-decruft-goal-x.md`)删掉空桩 check 之后再做本 goal。

## 解决什么痛点
`fabric doctor` 的知识库**卫生告警能力**(知识过期该降级 / 该归档 / relevance_paths 失效 / id 撞号 等)在 store cutover 时被掏空(读侧 lint 全是空桩,Goal X 已删)。本 goal = 用 store 版**把高价值的卫生检查重新接回来**,恢复 doctor 体检知识库的真本事。这是产品护城河(KB 健康治理)的核心能力。

## 现状(可行性)
- doctor **已有 store 读路径**:`collectStoreKnowledgeSummaries(projectRoot)`(doctor.ts 约 L1012)已被 underseeded/summary-opaque 用。
- **缺口**:summaries 目前主要给计数;orphan_demote/stale_archive 需 **per-entry** 的 `created_at`/`maturity`/事件历史(last-active)。要把 store 读扩到 per-entry 粒度(可参考 `cross-store-recall.ts` 的 store 遍历 + `extractRuleDescription` 解 frontmatter)。

## per-check 价值分级(逐个衡量, 别全上)
**高价值 → store 版重建(TDD + store fixture)**:
- `orphan_demote`(过期 canonical 降级 90/30/14d, KT-DEC-0008)
- `stale_archive`(终态 draft 归档)
- `relevance_paths` hygiene(dangling / drift / narrow_no_paths —— relevance_paths 指向的文件没了/漂了)
- `stable_id_collision` + `layer_mismatch`(id 撞号 / 层错配 —— 数据完整性)

**低价值 → 永久丢(co-location 时代 niche, 不重建)**:
- `suspicious_kb_injection`(NEW-32)· `personal_layer_path_misclassify`(NEW-5)· `narrow_too_few`(TASK-023)· `draft_auto_promote`(NEW-38)· `filesystem_edit_fallback`(co-location 事件合成, store 模型下无意义)· `baseline_filename_format`(baseline 已退役)· `pending_overdue`/`pending_auto_archive`(pending 现在 store 里, 价值待定)

## 防 false-green(本会话血泪 oracle)
重建每个 check 必须 **producer-consumer round-trip**:store 里种一条该触发的知识 → 跑 doctor → 断言 check **真的 fire**(不是空跑绿)。本会话 W0-2 正是栽在"check 空桩→测试假复活"。参 KT-PIT-0010(store migrate 与运行时铸号对账)。

## 测试
全新 store-fixture 测试(不复用旧 co-location 版 —— 那些 Goal X 已删, 且 seed 路径是 `<projectRoot>/.fabric/knowledge` 现读路径忽略)。每 check 一个 family,增量推进。

## 触发
KB 治理需求明确时 / 用户用 doctor 想体检知识库发现"没在查"时启动。
