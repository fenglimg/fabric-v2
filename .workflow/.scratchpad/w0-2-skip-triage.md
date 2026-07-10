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

### ⚠️ 重大修正:agent 的 REDUNDANT 判定基本被 refute
**根因**:agent 把 `describe.skip` 块**内部**的 `it(...)`(无 .skip 后缀但被父 describe.skip 整块跳过)
误当成「非-skip 覆盖」。实际这些 it 全 skip,即该 check **零活跃覆盖**。
- **orphan_demote**(knowledge_orphan_demote_required):全部断言 1486–2976 落在 describe.skip 块
  (1422/2240/2896…)内 → **零活跃覆盖 → REVIVE**(非 redundant)。同理推定多数 describe.skip 块如此。
- **stable_id_collision**:断言 909/938/946/953 在首个 describe.skip(1422)**之前** → 可能有真非-skip
  覆盖 → 925/1219 的 it.skip 或确属 redundant(**待逐行亲验 946/953 是否真非-skip**)。

→ **亲验法修正**:不能只 grep check code 出现;必须确认该断言所在的 `it(` **不被任何 describe.skip 包裹**
(即行号落在所有 describe.skip 块区间之外)。describe.skip 块起始行(删 knowledge_dir_missing 后):
1422 1905 2064 2151 2240 2896 3025 3191 3274 3667 3881 4602 8069。

### LIVE-UNCOVERED-REVIVE 候选(check live 无其他覆盖 → 重写 store fixture 复活)
1271/1304/1338/1377(knowledge_promoted_synthesized,filesystem_edit_fallback)· 3057(relevance_paths hygiene)·
3223(personal_layer_path_misclassify)· 3306(suspicious_kb_injection)· 3699(narrow_too_few)·
3913(relevance_fields_missing,**29 个**)· 8101(draft_auto_promotable)· 4777/5379/5552/7001(cite-coverage 边界)
→ 复活=去掉 co-location `writeKnowledgeMeta` fixture,改用 store-based 种子触发 check;须防 false-green
(producer-consumer round-trip:确认 check 真被触发,非空跑绿)。

## 关键事实 / 修正后的 W0-2 真实规模
- 几乎所有 skip 依赖 co-location fixture `writeKnowledgeMeta`(现已 no-op)→ fixture 实际空搭。
- **修正**:经亲验,12 个 describe.skip 块多数是 **live doctor check 的整块覆盖被迁移时 skip 掉**(orphan_demote
  确认零活跃覆盖),非 redundant。即 W0-2 **主体是 REVIVE ~90 个 test**(重写 co-location fixture → store-based
  种子触发 check),不是删除。原 plan「triage 删/复活」严重低估为删除,实测为大规模测试复活工程。
- 复活每个 check 需:理解其 store-only 触发条件 → 构造 store-based 种子 → 解 skip → 防 false-green
  (producer-consumer round-trip:确认 check 真被触发)。可能顺带暴露 check 在 store-only 下的真 bug。
- 删完/复活完所有 co-location-fixture skip 后,`writeKnowledgeMeta` 才能随 W1 死簇删(W1 最后阻塞)。
- **真 retired-delete 极少**(仅 knowledge_dir_missing 已删);**真 redundant** 需逐个确认断言 `it(` 落在所有
  describe.skip 区间**之外**(目前仅 stable_id_collision 925/1219 待验)。

## 建议
W0-2 是被低估的大块(~90 test 复活)。建议作为独立聚焦相位推进:每个 check family 一个增量
(理解触发 → store fixture → 解 skip → 验绿),而非一轮扫完。W1 死簇删除阻塞于此。
