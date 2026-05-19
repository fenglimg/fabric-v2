# rc.24 Planning Context

**Source:** grill-me session 2026-05-19,所有 design branch 已锁。详细决议见 memory: `project_rc24_design_locked.md`。

## 主题

cite contract policy — `[recalled]` cite 行追加 operator-based commitment,doctor 比对 session edit diff 验证是否履约。从"判断 id 是否真实"升级到"判断 agent 是否真按规则做事"。

## 核心决议(摘要)

- **B1 contract 语法**:Y-only,5 operators (`edit / !edit / require / forbid / skip`),`skip:<reason>` 6 值词典
- **B2 enforcement**:L3 BOOTSTRAP 文本明文 + L1 Stop hook 软提醒 + L0 doctor audit,**不阻断**
- **B3 schema**:event-ledger 加 `cite_commitments` 并行数组,沿用 rc.20 cite_tags `.default([])` pattern
- **B4 marker**:新 `cite_contract_policy_activated` event type,独立窗口
- **B5 升级路径**:marker 受 bootstrap drift 闸门控制,drift 存在时 `skipped:bootstrap_drift`
- **B6 type 路由**:`knowledge-meta-builder` 提供 idTypeMap,decisions/pitfalls → 强 contract,models → reference cite,guidelines/processes → rc.25 LLM-judge
- **Personal layer**:`--layer` filter + BOOTSTRAP 提及 personal layer + 违规分层显示(team review / personal fyi);用户级 override 推迟 rc.25+

## 上下文文件

- `packages/shared/src/templates/bootstrap-canonical.ts:75-82` — 现行 `## Cite policy` 章节
- `packages/shared/src/schemas/event-ledger.ts:411-423` — assistant_turn_observed schema
- `packages/server/src/services/doctor.ts:5455-5990` — cite-policy marker + runDoctorCiteCoverage
- `packages/server/src/services/knowledge-meta-builder.ts:337-360` — idTypeMap 数据源
- `packages/cli/templates/hooks/fabric-hint.cjs` — 三端 hook parser 模板
- `.workflow/.lite-plan/rc20-cite-policy-2026-05-15/` — 整套先例(format / 节奏 / commit 策略)

## 推迟到后续 RC

- guidelines/processes LLM-judge 路径(rc.25+,等 contract 数据积累)
- 用户级 cite-policy override `~/.fabric/AGENTS.md`(rc.25+,等真有人用 personal layer)
- operator 词典扩展 sequencing/conditional/call:(由 `skip:` ratio 数据驱动)
- doctor.ts cite-coverage 子模块抽离(可选重构,非必须)
