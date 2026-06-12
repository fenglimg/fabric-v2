# W0-2 — doctor.test.ts skip triage map

> 源:Explore agent 全量分类(2026-06-12)+ 主线验证 caveat。
> ⚠️ **agent 的 REDUNDANT 删除建议不可靠**:抽验发现 orphan_demote/onboard_coverage/baseline_filename_format
> 在 test 文件内 grep 得 0 处(与 agent「已有非-skip 覆盖」声明矛盾)。**删任何 skip 前必须亲验该 check
> 有非-skip 覆盖**(删 skip 唯一风险=丢覆盖)。check code 字符串需逐个核准。

## 已执行
- [x] knowledge_dir_missing(原 1025/1040,2 个 it.skip)— RETIRED,production 0 ref + 仅这俩引用,零覆盖损失 → 删(commit 见下)。doctor.test 99→97 skip。

## 待处理(97 skip,逐个亲验后删/复活)

### RETIRED-DELETE 候选(check code production 0 ref → 安全删)
- 需对每个 check code 跑 `grep -rl '<code>' packages/server/src --include=*.ts | grep -v test` 确认 0 才删。
- 已知仅 knowledge_dir_missing 一处确认 retired。其余 check 多 production live。

### LIVE-REDUNDANT-DELETE 候选(check live 但有非-skip 覆盖 → 删 skip 无损)
agent 列(**均需亲验非-skip 覆盖真存在**):925/1219(stable_id_collision)· 1454/2272/2928(orphan_demote)·
1937(stable_id_duplicate)· 2096(underseeded)· 2183(onboard_coverage)· 4634(baseline_filename_format)
→ 亲验:grep 该 check code 在非 `.skip` 的 `it(`/`expect` 块出现,确认后删。

### LIVE-UNCOVERED-REVIVE 候选(check live 无其他覆盖 → 重写 store fixture 复活)
1271/1304/1338/1377(knowledge_promoted_synthesized,filesystem_edit_fallback)· 3057(relevance_paths hygiene)·
3223(personal_layer_path_misclassify)· 3306(suspicious_kb_injection)· 3699(narrow_too_few)·
3913(relevance_fields_missing,**29 个**)· 8101(draft_auto_promotable)· 4777/5379/5552/7001(cite-coverage 边界)
→ 复活=去掉 co-location `writeKnowledgeMeta` fixture,改用 store-based 种子触发 check;须防 false-green
(producer-consumer round-trip:确认 check 真被触发,非空跑绿)。

## 关键事实
- 几乎所有 skip 依赖 co-location fixture `writeKnowledgeMeta`(现已 no-op)→ fixture 实际空搭。
- 删完所有 co-location-fixture skip 后,`writeKnowledgeMeta` 才能随 W1 死簇一起删(解耦 W1 的最后阻塞)。
- REVIVE 是 W0-2 主体工作量(~50+ test),非删除;需逐 check 理解当前 store-only 触发条件。
