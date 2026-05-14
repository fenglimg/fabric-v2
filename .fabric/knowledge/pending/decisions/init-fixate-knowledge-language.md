---
type: decisions
maturity: draft
layer: team
created_at: 2026-05-14T02:58:43.499Z
source_sessions: ["WFS-2026-05-14-fabric-skills-contract-fix"]
proposed_reason: decision-confirmation
tags: []
x-fabric-idempotency-key: sha256:3c34e7396adbb3aed3f13603fa76b59d2ed6d774477387098af46b0277f6b9a7
---

## Summary

knowledge_language 应在 fab init 时通过 scan.ts:detectExistingLanguage 解算成具体值（zh-CN/en）回写 config，而非保留 "match-existing" 占位符作为运行时 lazy resolve 信号。grill-me 三方案 α/β/γ + γ.1/γ.2/γ.3 权衡后选 γ.2（init 时固化）。理由：runtime lazy resolve 让每次 skill 调用都扫 README/docs 探测 CJK 比例，代价高且 LLM 易走样；init 是天然的探测时点，scan.ts 本来就在跑探测；只在 config 不存在时写入，不覆盖用户显式配置。

## Why proposed

decision-confirmation — ≥2 候选方案经权衡后确认选型，需保留 rationale。

## Session context

Session goal: 解决 fabric skill UX "纯英文扑脸"——明明用户已配 knowledge_language=zh-CN，但 skill 输出仍大量英文。
Turning point: grill-me 权衡 α/β/γ 三方案后选 γ；γ 又面临"match-existing 默认值怎么解算"的 sub-question，权衡 γ.1（runtime 探测）/γ.2（init 固化）/γ.3（fallback en）后选 γ.2。理由：探测信号本就在 scan.ts 内已具备，init 是 lazy resolve 的天然消解时点。
Result: init.ts 落地后 .fabric/fabric-config.json 总是含具体 zh-CN/en 值，runtime 不再 lazy 探测。
Implication: 类似的 enum "match-existing" 占位符模式都应该在 init/setup 时点 eager resolve，而非运行时 lazy resolve——后者增加不确定性。

## Evidence

Recent paths:

- packages/cli/src/commands/init.ts
- packages/cli/src/commands/scan.ts
- packages/shared/src/schemas/fabric-config.ts
- packages/cli/__tests__/integration/scan-init.test.ts

Notes:

- knowledge_language 应在 fab init 时通过 scan.ts:detectExistingLanguage 解算成具体值（zh-CN/en）回写 config，而非保留 "match-existing" 占位符作为运行时 lazy resolve 信号。grill-me 三方案 α/β/γ + γ.1/γ.2/γ.3 权衡后选 γ.2（init 时固化）。理由：runtime lazy resolve 让每次 skill 调用都扫 README/docs 探测 CJK 比例，代价高且 LLM 易走样；init 是天然的探测时点，scan.ts 本来就在跑探测；只在 config 不存在时写入，不覆盖用户显式配置。
