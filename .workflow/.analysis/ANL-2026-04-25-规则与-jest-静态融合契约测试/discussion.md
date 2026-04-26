# Analysis Discussion

**Session ID**: ANL-2026-04-25-规则与-jest-静态融合契约测试
**Topic**: 规则与 Jest 的静态融合：契约式测试 (Contract Testing)
**Started**: 2026-04-25T23:45:22+08:00
**Dimensions**: architecture, implementation, decision
**Depth**: standard

## Table of Contents
- [Analysis Context](#analysis-context)
- [Current Understanding](#current-understanding)
- [Discussion Timeline](#discussion-timeline)
- [Synthesis & Conclusions](#synthesis--conclusions)
- [Decision Trail](#decision-trail)

## Current Understanding

### What We Established
- 规则不应写入 Jest 断言逻辑；Jest 只通过静态标注声明自己覆盖了哪些 rule stable_id。
- `fabric sync-meta` 已经负责编译规则文件 hash、stable_id 和 revision，适合扩展为同时生成 rule-test coverage sidecar index。
- `fabric doctor` 已经有健康检查和审计告警框架，适合接入“规则变更但测试未同步”的诊断。
- werewolf-minigame 的 Jest 规范已有三类测试入口：logic firewall、runtime contract、shell regression；可直接映射为 L0/L1/L2 的测试契约层。
- 静态索引只能证明映射和同步，不能证明测试曾经通过；需要独立的测试运行证据。
- L1 规则会天然 fan-out 到大量测试，doctor 需要按规则聚合告警，并区分 human acknowledgement 与 verified pass evidence。
- 当前实施决策已收敛到 V1 最小版：只保证“有测试声明覆盖且 hash 可追踪”，不保证测试通过或测试质量。

### Key Insights
- 规则-测试联动索引应独立于 `.fabric/agents.meta.json` 主 schema，建议落在 `.fabric/rule-test.index.json`，避免污染 rule selection hot path。
- “对应测试最近没有更新”不应依赖 Git commit hash；更稳的最小实现是记录 test file content hash，后续可附加 last commit sha 作为诊断信息。
- L0/L1 是通用 Jest 套件和领域断言库的覆盖要求；L2 是具体脚本测试文件中的 `@fabric-verify` 标注。
- `.fabric/rule-test.index.json` 应只保存静态映射；Jest 通过性应写入 `.fabric/rule-test.results.json` 或 `.jsonl`，由 Jest reporter、CI hook 或 `fabric test-contracts` 更新。
- 状态机应从“同步/不同步”升级为：mapped、synced、acknowledged、verified。
- V1 暂不实现 results、acknowledgement、AI audit、Jest runner、测试质量判断；这些保留为 V2+ 设计空间。

## Analysis Context
- Focus areas: static rule-test mapping, L0/L1/L2 integration, sync-meta and doctor wiring, Jest contract conventions
- Perspectives: Technical, Architectural
- Depth: standard

## Initial Questions
- 静态标注应该存在哪里，如何避免把规则逻辑塞进测试？
- `sync-meta` 和 `doctor` 当前有哪些现成接入点？
- L0/L1/L2 在 Jest 目录中应分别对应什么粒度？
- 如何判断规则变更后对应测试没有同步？

## Initial Decisions

> **Decision**: Use static annotations and generated index, not dynamic Jest generation.
> - **Context**: User explicitly rejected dynamic test code generation because it increases system complexity.
> - **Options considered**: Generate Jest files from rules; put rule checks into test helper logic; scan static annotations into a sidecar index.
> - **Chosen**: Scan static annotations into `.fabric/rule-test.index.json` during `fabric sync-meta`.
> - **Rejected**: Dynamic generation couples rule authoring to test code shape; rule-aware test helpers make tests encode policy instead of verifying behavior.
> - **Impact**: Fabric owns traceability; Jest remains ordinary, reviewable test code.

---

## Discussion Timeline

### Round 1 - Exploration (2026-04-25T23:45:22+08:00)

#### User Input
用户希望讨论“规则与 Jest 的静态融合：契约式测试”，明确要求不用动态生成测试代码，而是采用“静态映射 + 标注”。核心问题是这套规则如何接入 L0/L1/L2，以及规则变更后如何通过 `fabric sync-meta` 和 `fabric doctor` 告警。

#### Decision Log

> **Decision**: Treat rule-test coverage as a doctor check, backed by sync-meta generated metadata.
> - **Context**: `sync-meta` already compiles rules into stable metadata; `doctor` already reports stale metadata and audit violations.
> - **Options considered**: Add a separate command; run Jest inside doctor; store test links inside rule Markdown only; generate sidecar index.
> - **Chosen**: `sync-meta` scans test annotations and writes a sidecar index; `doctor` validates rule hash vs test hash.
> - **Rejected**: Running Jest inside doctor is too slow and changes doctor from static health check to execution harness.
> - **Impact**: The feature remains fast, deterministic, and aligned with current Fabric tooling boundaries.

#### Key Findings

> **Finding**: `sync-meta` is the natural compiler phase.
> - **Confidence**: High -- Evidence: `packages/cli/src/commands/sync-meta.ts:74` computes metadata; `packages/cli/src/commands/sync-meta.ts:272` includes rule hash and identity in revision.
> - **Hypothesis Impact**: Confirms hypothesis "static mapping belongs to metadata sync".
> - **Scope**: CLI sync-meta, shared schema, generated `.fabric` sidecar files.

> **Finding**: `doctor` is already structured for additional static health checks.
> - **Confidence**: High -- Evidence: `packages/server/src/services/doctor.ts:163` builds a report; `packages/server/src/services/doctor.ts:346` turns meta drift into checks.
> - **Hypothesis Impact**: Confirms hypothesis "rule-test staleness belongs in doctor".
> - **Scope**: server doctor service, CLI doctor output, dashboard doctor API.

> **Finding**: werewolf-minigame already has contract-first Jest conventions.
> - **Confidence**: High -- Evidence: `/mnt/c/Project/werewolf-minigame/tests/README.md:75` defines logic firewall/runtime contract/shell regression; `/mnt/c/Project/werewolf-minigame/tests/env/setup-after-each/ui-contract-teardown.ts:100` enforces listener/timer/residue cleanup.
> - **Hypothesis Impact**: Refines hypothesis "Fabric should invent generic Jest contracts" into "Fabric should reference project-local contract suites".
> - **Scope**: Project templates, convention docs, L0/L1 generic suites.

#### Technical Solutions

> **Solution**: Add `.fabric/rule-test.index.json` as a sync-meta generated sidecar.
> - **Status**: Proposed
> - **Problem**: Need to know which test files claim to verify which stable rule IDs and what rule/test hashes were last synced.
> - **Rationale**: Keeps `.fabric/agents.meta.json` focused on rule selection while making doctor validation cheap.
> - **Alternatives**: Extend each `AgentsMetaNode` with tests; store links only inside Markdown; use Git commit hash only.
> - **Evidence**: `packages/shared/src/schemas/agents-meta.ts:44` already keeps node schema strict; `packages/cli/src/commands/sync-meta.ts:100` writes stable rule metadata.
> - **Next Action**: Define shared schema and scanner.

> **Solution**: Use `// @fabric-verify <stable_id>` and optional block labels.
> - **Status**: Proposed
> - **Problem**: Need readable, static, reviewable mapping from Jest tests to rules.
> - **Rationale**: A comment works across Jest styles and does not alter runtime behavior; describe labels improve human scanning.
> - **Alternatives**: Custom Jest matcher; naming convention only; dynamic test generation.
> - **Evidence**: User provided `// @fabric-verify L2-Pool-001`; werewolf tests already use descriptive `*.contract.test.ts` and `describe('... contract')`.
> - **Next Action**: Document accepted annotation forms.

#### Analysis Results
- L0 should define required generic suites, not specific test logic inside rules. Example: `tests/support/harness/ui/__tests__/ui-contract.test.ts` validates the contract harness itself; project tests use `mountUIContract` and `flushManagedHarnessTeardown`.
- L1 should define domain or convention suites, such as `tests/__tests__/conventions/*.test.ts`, `tests/support/assertions/*`, or project-specific domain invariant suites.
- L2 should be verified in mirrored script tests, for example `tests/assets/.../__tests__/PoolManager.test.ts`, with `// @fabric-verify L2-Pool-001`.
- Staleness should compare current rule node hash from `.fabric/agents.meta.json` with the `rule_hash_at_sync` stored for each annotation in `.fabric/rule-test.index.json`; if the rule hash changed and the annotated test hash did not change since the previous index, `doctor` warns.

#### Corrected Assumptions
- ~~Use Git commit hash as primary synchronization proof~~ -> Use content hashes first, because Fabric already computes sha256 hashes and tests may be edited without commit context.
- ~~Put test coverage links into rule selection metadata~~ -> Use a sidecar index so MCP rule injection remains lean and neutral.

#### Open Items
- Should unverified L2 rules warn by default or only when they opt into `verification.required = true`?
- Should `doctor` provide a strict mode where stale rule-test coverage becomes error?
- Should test annotations support multiple stable IDs in one line?

#### Narrative Synthesis
**起点**: 用户提出静态映射方案，并询问如何接入 L0/L1/L2 与规则变更重塑。
**关键进展**: 代码探索确认 `sync-meta` 和 `doctor` 已经提供合适的编译与告警边界，werewolf-minigame 已经有可复用的 contract-first Jest 规范。
**决策影响**: 分析方向从“设计一套测试系统”收敛为“在现有 Fabric 元数据与 doctor 中加入静态 traceability”。
**当前理解**: 最小可行方案是 `sync-meta` 扫描规则和 Jest 标注生成 sidecar index，`doctor` 对比 rule hash 与 test hash 做 staleness 告警。
**遗留问题**: 严格级别、未覆盖规则策略、多 ID 标注细节需要在实施前锁定。

#### Initial Intent Coverage Check
- Addressed: 不动态生成测试代码，采用静态映射和标注。
- Addressed: L0/L1/L2 的融入方式。
- Addressed: `sync-meta` 扫描测试文件。
- Addressed: 规则变更但测试未同步时 `doctor` 告警。
- Addressed: 参考 werewolf-minigame Jest 规范。

---

### Round 2 - Concern Review (2026-04-26T00:00:00+08:00)

#### User Input
用户提出两项担忧并要求先评判其合理性：

- 隐忧一：content hash 只能解决“同步性”，不能证明测试“通过性”；建议增加 `last_pass_hash`。
- 隐忧二：L1 规则变更会导致大量关联测试同时 stale，造成审计疲劳；建议在 `doctor --fix` 中提供批量确认机制。

#### Decision Log

> **Decision**: Split static mapping evidence from passing test evidence.
> - **Context**: Hash 匹配不能说明测试上次运行通过，原方案存在“有效性断层”。
> - **Options considered**: 把 `last_pass_hash` 放入 `rule-test.index.json`；让 `doctor` 运行 Jest；新增独立 test results artifact。
> - **Chosen**: 保持 `.fabric/rule-test.index.json` 只负责静态映射，新增 `.fabric/rule-test.results.json` 或 `.jsonl` 存放通过性证据。
> - **Rejected**: `doctor` 运行 Jest 会让健康检查变慢且不稳定；把通过性写进 index 会混淆 sync-meta 与 test execution 的职责。
> - **Impact**: `doctor` 可以同时判断 stale、unverified、failed、missing evidence，而不需要执行测试。

> **Decision**: Allow batch acknowledgement for L1 blast radius, but never let `doctor --fix` manufacture pass evidence.
> - **Context**: L1 规则是领域级规则，变更后可能影响几十个测试，逐条告警会造成审计疲劳。
> - **Options considered**: 忽略 L1 stale；逐条 stale；`doctor --fix` 批量更新索引；批量 acknowledgement + 独立 verification。
> - **Chosen**: 按 rule 聚合告警，并允许 `doctor --fix` 写入 acknowledgement；verified 状态只能来自真实 Jest pass evidence。
> - **Rejected**: 直接批量更新所有测试索引会把“人确认影响范围”误写成“测试已验证通过”。
> - **Impact**: L1 告警可控，同时保留契约测试的真实性。

#### Key Findings

> **Finding**: 隐忧一完全成立，原方案只覆盖同步性，不覆盖通过性。
> - **Confidence**: High -- Why: `rule_hash_at_sync` 与 `test_hash_at_sync` 都是静态文件状态，无法表达 Jest result。
> - **Hypothesis Impact**: Modifies hypothesis "doctor compares hashes is enough" into "doctor must compare hashes plus pass evidence".
> - **Scope**: rule-test index schema, Jest reporter/hook, doctor diagnostics。

> **Finding**: 隐忧二成立，但批量修复的语义必须限定为 acknowledgement。
> - **Confidence**: High -- Why: L1 是领域级规则，fan-out 是预期行为；批量修改 verification 状态会破坏证据链。
> - **Hypothesis Impact**: Modifies hypothesis "doctor --fix can refresh stale entries" into "doctor --fix can acknowledge scope, not verify tests".
> - **Scope**: doctor output grouping, doctor --fix design, results artifact。

#### Technical Solutions

> **Solution**: Add a separate rule-test results artifact.
> - **Status**: Validated
> - **Problem**: Need to know whether the mapped contract tests passed under the current rule/test/config tuple.
> - **Rationale**: Test execution is a different lifecycle from metadata sync; storing it separately prevents sync-meta from pretending tests passed.
> - **Alternatives**: `last_pass_hash` inside index; commit hash only; run Jest inside doctor.
> - **Evidence**: Round 1 established `sync-meta` as metadata compiler and `doctor` as static health reporter.
> - **Next Action**: Define result tuple fields: rule_stable_id, rule_hash, test_file, test_hash, jest_config_hash, command, status, passed_at.

> **Solution**: Model rule-test state as mapped/synced/acknowledged/verified.
> - **Status**: Validated
> - **Problem**: Binary stale/non-stale status cannot distinguish human-reviewed blast radius from passing test evidence.
> - **Rationale**: L1 fan-out needs product-level aggregation and human confirmation without weakening pass semantics.
> - **Alternatives**: Ignore L1; treat every L1 linked test as independent stale warning; bulk update test hashes during doctor --fix.
> - **Evidence**: L1 domain-level mapping can affect many tests; user identified audit fatigue risk.
> - **Next Action**: Update doctor design to group by rule and report affected/stale/acknowledged/verified counts.

#### Analysis Results
- `rule-test.index.json` should remain generated by `sync-meta` and contain only static mapping: rule id, rule hash at sync, test path, test hash at sync, annotation location, optional describe path.
- Passing evidence should be written by a Jest reporter, CI hook, or explicit command such as `fabric test-contracts`. It should include both rule hash and test hash so stale pass results are not reused after either side changes.
- `doctor` should evaluate at least these states:
  - OK: mapping exists, rule/test hashes are current, and matching pass evidence exists.
  - WARN unverified: mapping exists and hashes are current, but no matching pass evidence exists.
  - WARN/ERROR stale: rule hash changed and linked test hash has not changed or pass evidence is stale.
  - ERROR failed: latest matching execution evidence says failed, if strict mode is enabled.
  - WARN orphan/missing: annotation references unknown rule or test file disappeared.
- L1 warning output should be grouped by rule, not by every linked test file. Example: `L1-ui-async-error changed; 47 linked tests affected; 0 verified, 47 stale`.
- `doctor --fix` may write an acknowledgement record for L1 blast radius after human confirmation, including rule_stable_id, ack_rule_hash, scope, reason, acknowledged_by, acknowledged_at. It must not write `status: passed`.

#### Corrected Assumptions
- ~~Hash 匹配即可说明契约有效~~ -> Hash 匹配只说明静态同步；还需要当前 tuple 的 passing evidence。
- ~~`doctor --fix` 可以批量更新所有命中的 L1 测试索引~~ -> `doctor --fix` 只能批量 acknowledge；verified 必须来自真实 Jest pass。

#### Open Items
- Passing evidence artifact 使用 JSON snapshot 还是 JSONL append log？
- 是否需要提供 Fabric Jest reporter，还是先提供 `fabric test-contracts` 包装命令？
- acknowledgement 过期规则：当 rule hash 再次变化时自动失效，test hash 变化时是否也失效？

#### Narrative Synthesis
**起点**: 基于 Round 1 的静态索引方案，用户指出同步性与通过性断层，以及 L1 fan-out 告警疲劳。
**关键进展**: 本轮确认两个担忧都合理，并将方案从单一静态索引扩展为静态映射 + 测试运行证据 + 人工确认记录。
**决策影响**: `rule-test.index.json` 的职责被收窄；新增 results/acknowledgement 概念，`doctor --fix` 的权限被限定。
**当前理解**: Fabric contract testing 需要四态模型：mapped、synced、acknowledged、verified；其中 verified 只能由真实测试通过产生。
**遗留问题**: results artifact 形态、Jest reporter 入口、acknowledgement 失效策略仍需实施前锁定。

#### Intent Coverage Check
- Addressed: 评判“测试有效性断层”担忧是否合理。
- Addressed: 评判“L1 爆炸半径”担忧是否合理。
- Addressed: 修正原方案中 `doctor --fix` 的边界。
- In progress: 具体 reporter/CLI 形态还未设计到实现级别。

---

### Round 3 - V1 Scope Lock (2026-04-26T00:00:00+08:00)

#### User Input
用户决定暂时按第一版执行，后续再重新梳理 `sync-meta` 和 `doctor` 的职能区间。当前要求先在 discussion 中记录 V1 最小结论。

V1 实现范围：

- shared schema: `RuleTestIndex`
- CLI scanner: `@fabric-verify`
- `sync-meta` 写 index，保留 previous hash
- `doctor` 静态 contract check
- 测试覆盖 `sync-meta` + `doctor` 几个状态
- 文档写清楚：V1 只保证“有测试声明覆盖且 hash 可追踪”，不保证测试通过或测试质量

#### Decision Log

> **Decision**: Lock V1 to static traceability only.
> - **Context**: 前两轮讨论扩展出了 results、acknowledgement、AI audit、Jest runner 等能力，但当前版本过多过杂。
> - **Options considered**: 一次性实现完整 contract lifecycle；先做静态索引与 doctor 静态检查；继续讨论 sync-meta/doctor 边界后再动手。
> - **Chosen**: 先做 V1 最小版，只覆盖规则-测试声明关系和 hash 可追踪。
> - **Rejected**: 完整 lifecycle 会引入 runner 配置、通过性证据、L1 acknowledgement 和测试质量审计，超出第一版必要范围。
> - **Impact**: 第一版可以快速验证核心价值，同时避免把测试运行与质量评估提前绑进 Fabric。

#### Key Findings

> **Finding**: V1 的核心价值是“静态可追踪”，不是“契约有效性证明”。
> - **Confidence**: High -- Why: 用户明确接受第一版不处理测试通过与测试质量。
> - **Hypothesis Impact**: Narrows hypothesis "Fabric contract testing should verify lifecycle" into "V1 should record coverage claims and hash drift".
> - **Scope**: shared schema, sync-meta scanner/index, doctor static diagnostics, tests, docs。

#### Technical Solutions

> **Solution**: Implement `RuleTestIndex` as the only V1 artifact.
> - **Status**: Validated for V1
> - **Problem**: Need a small, auditable record linking `@fabric-verify` annotations to stable rule IDs and current/previous hashes.
> - **Rationale**: This directly answers the original problem while keeping sync-meta and doctor responsibilities simple enough for a first pass.
> - **Alternatives**: Add results evidence, acknowledgement log, AI audit, or test runner in V1.
> - **Evidence**: Round 3 user decision to keep only V1 minimal scope.
> - **Next Action**: Implement schema, scanner, index writer, doctor static check, focused tests, and docs.

#### Analysis Results
V1 should implement only these pieces:

1. Shared schema: `RuleTestIndex`.
2. CLI scanner: find `// @fabric-verify <stable_id>` in test files.
3. `sync-meta`: write `.fabric/rule-test.index.json`, preserving `previous_rule_hash` and `previous_test_hash` so doctor can still tell whether a rule changed while the linked test did not.
4. `doctor`: static contract check with states such as covered, stale_rule, stale_test, orphan, and missing.
5. Tests: cover sync-meta index generation and doctor diagnostics for the main states.
6. Docs: clearly state V1 only proves “declared coverage + hash traceability”; it does not prove Jest passed or that the test semantically covers the rule.

Explicitly out of V1:

- No Jest execution.
- No pass/fail evidence.
- No `.fabric/rule-test.results.jsonl`.
- No `doctor --fix` acknowledgement.
- No AI audit.
- No test quality analysis.
- No L1 batch confirmation.
- No config hash.

#### Corrected Assumptions
- ~~V1 should include pass evidence or acknowledgement because those are conceptually important~~ -> V1 deliberately excludes them to keep the first implementation small and verifiable.
- ~~doctor/sync-meta boundary must be fully settled before any implementation~~ -> V1 can proceed with a narrow rule: sync-meta records static facts, doctor explains static drift.

#### Open Items
- Exact test root discovery/config shape for scanner.
- Whether `missing` applies to all L2 rules by default or only to rules that opt into required verification.
- Exact severity mapping for V1 states: warn vs error.

#### Narrative Synthesis
**起点**: 前两轮已经扩展出完整 contract lifecycle，但用户指出当前版本太多太杂。
**关键进展**: 本轮把实施范围收敛到 V1 静态可追踪，只做 RuleTestIndex、annotation scanner、sync-meta 写 index、doctor 静态检查、测试和文档。
**决策影响**: results、acknowledgement、AI audit、Jest runner、测试质量判断全部移出第一版。
**当前理解**: V1 的验收标准不是“测试有效”，而是“规则和测试之间存在可审计映射，并且 rule/test hash drift 能被 doctor 发现”。
**遗留问题**: scanner 配置、missing coverage 默认范围、doctor severity 仍需实施前锁定。

#### Intent Coverage Check
- Addressed: 记录当前第一版最小范围。
- Addressed: 明确 V1 不保证测试通过或测试质量。
- Addressed: 明确后续再讨论 sync-meta 和 doctor 的更完整职能区间。

---

## Synthesis & Conclusions

### Executive Summary
V1 暂时只实现 Fabric 的“静态契约覆盖索引”：规则仍然是规则，Jest 仍然是普通测试；二者通过 `@fabric-verify <stable_id>` 和 hash 索引建立可审计关系。`sync-meta` 负责生成 `.fabric/rule-test.index.json` 并保留 previous hash；`doctor` 负责静态检查 covered/stale/orphan/missing 等状态。V1 不跑 Jest，不记录 pass/fail，不判断测试质量。

### Recommendations
1. Add shared schema: `RuleTestIndex`.
2. Add CLI scanner for `// @fabric-verify <stable_id>`.
3. Extend `sync-meta` to write `.fabric/rule-test.index.json`, preserving previous rule/test hashes.
4. Extend `doctor` with a static `Rule-test contracts` check.
5. Add tests covering sync-meta index generation and doctor states.
6. Document that V1 guarantees only declared coverage and hash traceability, not test pass status or semantic quality.

### Intent Coverage Matrix
| # | Original Intent | Status | Where Addressed | Notes |
|---|---|---|---|---|
| 1 | 不动态生成测试代码，采用静态映射 + 标注 | Addressed | Round 1, Recommendation 1-3 | Static comments + sidecar index. |
| 2 | L0/L1/L2 如何融入 | Addressed | Round 1, Recommendation 5 | L0 generic suites, L1 domain suites, L2 script tests. |
| 3 | 测试引用规则而不是写入规则逻辑 | Addressed | Round 1 | `@fabric-verify` only declares coverage. |
| 4 | 规则变更后如何重塑 | Addressed | Round 1, Recommendation 4 | Rule/test hash comparison in doctor. |
| 5 | 参考 werewolf-minigame Jest 规范 | Addressed | Round 1 evidence | Contract-first categories mapped into Fabric layers. |
| 6 | 测试有效性断层 | Addressed | Round 2, Recommendation 6 | Passing evidence separated from static index. |
| 7 | L1 爆炸半径与审计疲劳 | Addressed | Round 2, Recommendation 7 | Grouped diagnostics plus acknowledgement, not fake verification. |
| 8 | 当前只做 V1 最小结论 | Addressed | Round 3, Recommendations 1-6 | V1 scope locked to static traceability only. |

### Findings Coverage Matrix
| # | Finding | Disposition | Target |
|---|---|---|---|
| 1 | sync-meta is natural compiler phase | recommendation | Rec #1, #3 |
| 2 | doctor can host static health check | recommendation | Rec #4 |
| 3 | werewolf-minigame has contract-first Jest conventions | recommendation | Rec #5 |
| 4 | agents.meta schema should remain rule-selection focused | recommendation | Rec #1 |
| 5 | content hash is better than commit hash as primary signal | recommendation | Rec #2 |
| 6 | hash sync does not prove Jest pass status | recommendation | Rec #6 |
| 7 | L1 fan-out can cause audit fatigue | recommendation | Rec #7 |
| 8 | V1 should be small enough to implement safely | recommendation | Rec #1-6 |

## Decision Trail

### Critical Decisions
- Static annotation plus generated index is the integration model.
- `.fabric/rule-test.index.json` is preferred over embedding test coverage into `.fabric/agents.meta.json`.
- `doctor` should warn on stale coverage; it should not run Jest.
- Passing evidence must be stored separately from static mapping and updated only by real Jest execution.
- `doctor --fix` may acknowledge L1 blast radius, but must not create verified/pass evidence.
- V1 excludes passing evidence, acknowledgement, AI audit, Jest runner, config hash, and test quality analysis.

### Trade-offs Made
- Content hashes are less human-friendly than commit hashes, but they are deterministic and already match Fabric's metadata model.
- `@fabric-verify` is intentionally shallow; semantic quality remains the responsibility of Jest review and project test conventions.
- Human acknowledgement reduces L1 audit noise, but it is deliberately weaker than verified pass evidence.
- V1 deliberately accepts that it cannot prove test validity in exchange for a small, deterministic, implementable first step.

## Plan Checklist

This is a plan only; no source code was modified.

- [ ] Define `RuleTestIndex` shared schema.
- [ ] Add scanner for `@fabric-verify`.
- [ ] Add `sync-meta` sidecar write and check-only drift behavior.
- [ ] Preserve `previous_rule_hash` and `previous_test_hash` in the index.
- [ ] Add `doctor` static contract check for covered, stale_rule, stale_test, orphan, and missing states.
- [ ] Add sync-meta and doctor tests for V1 states.
- [ ] Add docs/templates for L0/L1/L2 contract tests and V1 limitations.
