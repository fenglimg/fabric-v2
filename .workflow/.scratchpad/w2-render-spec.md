# W2 — SessionStart 脊柱重裁 渲染定稿 spec

锚: KT-DEC-0027 类型分等 / KT-DEC-0028 broad 全显示+backstop / KT-DEC-0029 narrow 沉默 / KT-MOD-0001 三轴

## AI sink (additionalContext) = 动态生成的 MEMORY.md (脊柱)
```
[fabric:SessionStart] <storeLabel>
ALWAYS-ACTIVE RULES (无需再 recall):
  [guideline] team:KT-GLD-0001
  <full body>
  [model] team:KT-MOD-0001
  <full body>
  # 预算超 → 退回索引行(不折计数): "  [guideline] id · summary (超预算; fab_recall 取正文)"
REFERENCE (按需 Read / fab_recall):
  [decision] team:KT-DEC-0027 — <must_read_if (char-capped)>
  [pitfall]  team:KT-PIT-0004 — <must_read_if>
  [process]  team:KT-PRO-0001 — <must_read_if>
  # 只 broad 的 decision/pitfall/process; narrow 不进(沉默)
  # broad_index_backstop(默认50): index 行 > backstop → 折叠 tail "  … N more (broad index > backstop 50; fabric-audit)" + drift
取正文: fab_recall(paths), 或 Read <store>/knowledge/<type>/<id>--*.md
```

## Human sink (systemMessage) = breadcrumb (broad-only)
```
▸ [fabric] SessionStart (N broad KB)
  always-loaded: guideline G · model M
  [team] X · [personal] Y
<store label>
下一步: fab_recall(paths) 拿相关 KB
```
- **删** ON-DEMAND 计数行(decisions N · pitfalls M)
- **删** dropped-other-project (✗ 剔除他项目) 行
- narrow 完全沉默

## 改动清单
1. CLI plan-context-hint.ts: PlanContextHintEntry + map 加 `must_read_if` (from description.must_read_if)
2. shared api-contracts.ts: planContextHintNarrowEntrySchema 加 must_read_if optional
3. hook knowledge-hint-broad.cjs:
   - main: 删 topK slice (broad 全显示); 读 broad_index_backstop
   - renderAiSink: ALWAYS(degrade→index 行) + REFERENCE(broad dec/pit/proc title+must_read_if from entries) + backstop fold + drift + footer fab_recall/Read
   - renderHumanCensus: 删 on-demand line + dropped line
   - 删 DEFAULT_HINT_BROAD_TOP_K / readBroadTopK (废 top-K 硬砍)
   - footer 文案改 (删 fab_get_knowledge_sections 两步)
   - 加 readBroadIndexBackstop (默认 50)
4. 测试重写: knowledge-hint-broad.test.ts (删 ON-DEMAND/dropped/two-step footer/topK 断言; 加 REFERENCE title+hook / backstop / 新 footer)
5. fabric install 同步 .claude/.codex 镜像 (KT-PIT-0004)
6. tsc + cli tests + dogfood 实测渲染

## drift 报告 (backstop)
broad index 行数 > backstop → stderr 一行 "[fabric] broad index N > backstop 50 — run fabric-audit" + (W4-2 doctor lint 接此). hook 侧只折叠+提示, 不阻塞.
