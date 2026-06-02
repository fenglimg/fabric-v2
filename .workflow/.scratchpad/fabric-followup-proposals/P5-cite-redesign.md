# 方案 ⑤ — Cite policy 重设计:从"首行手写"到"工具调用自动记账"

> 优先级最高。冷评双 LLM 收敛 2/5 最弱;执行者(本会话 Claude)实证多轮未遵循。

## 问题(现状)
- `.fabric/AGENTS.md` Cite policy 要求:**做 edit/decide/propose 前,回复第一行**写
  `KB: <id> (<用法>) [applied|dismissed:reason] → <contract operators>`。
- `cite-policy-evict.cjs` 在 Stop 后解析第一行,缺失/缺 contract 时软提醒。
- **为什么不可遵循**(冷评 + 实证):
  1. AI 要先思考才知道改哪、引用啥 → 逼第一行先写,违背 CoT(先想后说)。
  2. contract 语法复杂(operators/skip 枚举/glob),易写错或编造。
  3. 逃逸太易:写 `KB: none` 就过了,规则形同虚设。

## 重设计核心
**把"AI 自律手写文本格式" → "系统按真实行为自动记账"。**

cite 的真实价值 = "这次改动是被哪条知识告知/驳回的"。这个事实**可以从行为推断**:
AI 改文件前若 `fab_recall(paths)` 过,系统就知道哪些 KB 进入了它的视野 → 自动关联为该次 edit 的 cite,无需 AI 手写。

## 具体改动
| 文件 | 改动 |
|---|---|
| `packages/cli/templates/hooks/cite-policy-evict.cjs` | PreToolUse(Edit/Write)时:查本 session 近 N 分钟内有无 `fab_recall`/`fab_plan_context` 命中**与编辑目标 path 重叠**的调用。**有** → 把召回的 KB ids 自动写入 cite ledger(关联此 edit);**无** → 软提醒"改前先 `fab_recall(paths)`"(nudge 非 gate,守 KT-DEC-0007)。不再要求回复首行格式。 |
| `.fabric/AGENTS.md`(经 bootstrap-canonical.ts) | 重写 Cite policy 段:从"首行必写 KB:"改为"改前先 recall;引用由系统自动记账;首行 KB: 仅作可选 override"。 |
| `packages/shared/src/cite-line-parser.ts` | **保留**(向后兼容:仍接受手写首行 KB: 作为显式 override),不删。 |
| doctor `--cite-coverage` | 覆盖率定义从"edit 前有首行 KB:" → "edit 前有相关 recall"。指标语义迁移(旧数据标 legacy)。 |

## 向后兼容
- 手写首行 `KB:` 仍被接受(显式 override 自动记账)→ 旧 session/习惯不破。
- 已有 cite-rollup.jsonl 数据保留,新口径并行统计。

## 风险
- cite 语义变化:需确保审计价值不丢(仍能答"哪条 KB 影响了哪次 edit")—— 靠 recall→edit 的 path 重叠关联,可能比手写宽松(recall 了不代表真用了)。缓解:记"recalled"与"applied"两级,applied 仍可由可选首行精确化。
- path 重叠判定的准确度(edit src/a.ts 是否算"被 recall src/ 命中")。

## 测试
- hook 行为测试:recall(paths)→edit 重叠 path → 自动 cite 记账;edit 无 recall → 软提醒 exit;手写首行 KB: → override 生效。
- doctor --cite-coverage 新口径单测。

## 工作量估计
中等。主要在 cite-policy-evict.cjs 行为重写 + AGENTS.md 段重写 + 三端 hook 同步 + doctor 口径迁移。不破坏现有(纯加 recall-based 路径 + 保留 legacy)。
