# Research: packages/server 工程清晰度审计 (精简去繁 roadmap 诊断)

- **Query**: packages/server 六维精简审计 + 轨A核证四问 (只诊断不修复)
- **Scope**: internal (packages/server 全量 + 跨包引用普查 cli/shared/server-http-experimental)
- **Date**: 2026-08-10
- **测量方法**: node 脚本全量遍历 (排除 node_modules/dist/coverage), 行数 = `split("\n").length`; 引用普查用 node includes/word-boundary regex, 未用 Bash grep (ugrep 假阴性规避)

## §0 总量基线

| 桶 | 文件数 | 行数 |
|---|---|---|
| src 源码 (非 .test.ts) | 112 | 27,382 |
| src 内联 .test.ts | 89 | 27,323 |
| __tests__/ (integration + unit) | 8 | 1,966 |
| **包总计 (.ts)** | **209** | **56,671** |

| src 子目录 | 源文件 | 源行数 | 测试文件 | 测试行数 |
|---|---|---|---|---|
| src/services | 96 | 24,874 (**90.8% 源行**) | 75 | 24,195 |
| src (根) | 6 | 1,657 | 7 | 1,528 |
| src/tools | 7 | 757 | 7 | 1,600 |

---

## §1 六维审计

### 1.1 内部分层现状 — services/ 已是 96 文件平铺大杂烩

**现状证据**
- 三层物理结构: 根 6 文件 (`index.ts` 579 行 = 131 个 barrel export + MCP 生命周期; `config-loader.ts` 735 行 = 30+ 个 config reader 平铺), `tools/` 7 文件 757 行 (5 个 MCP 注册 + `payload-warning.ts`/`mcp-tool-error.ts` 两个 helper, 是干净的薄适配层), `services/` 96 文件 24,874 行**完全平铺**(唯一子目录是 `__snapshots__`)。
- services/ 统计: 平均 259 行, 最大 1,968 行 (doctor.ts), >800 行 5 个, 500-800 行 8 个。
- 唯一的"分层"是文件名前缀: `doctor-*` 46 文件 11,445 行 (占 services 46%), `review-*` 8 文件 2,662 行, `plan-*` 8 文件 1,945 行, 其余 34 个前缀各 1-2 文件。
- 同层混居四种性质的东西: 引擎 (recall/plan-context/cross-store-recall), lint 套件 (46 个 doctor-*), 基础设施 (_shared/event-ledger/metrics/cache), 纯测试助手 (`doctor-test-helpers.ts`, 见 1.4)。无任何工具层/服务层/领域层约定文档或目录体现。

**精简提案**: 按前缀聚类落成子目录 — `services/doctor/`(46), `services/retrieval/`(plan-context* + bm25 + vector-retrieval + cross-store-recall + recall ≈ 14 文件), `services/review/`(8), `services/ledger/`(event-ledger/read-ledger/metrics/cite-rollup/rotation-tick), 剩余 ~20 个散件归 `services/core/`。纯机械移动 + import 改写。
**风险**: 低 — tsup 单入口打包不受影响; 75 个共址测试须随迁; `doctor-i18n.test.ts` 锁的是 DOCTOR_CHECK_BUILDERS **顺序**(doctor-check-registry.ts L3-4、L218)不是文件路径, 移动不触雷。
**优先级**: P1 (导航价值大、机械可批量)。

### 1.2 巨型文件 (>800 行, 非测试) — 5 个

| 文件 | 行数 | export | 顶层内部函数 | 自然拆分缝 |
|---|---|---|---|---|
| `src/services/doctor.ts` | 1,968 | 5 | 26 | ① `runDoctorFix` L607-886 + 其 fix 助手 → 独立 `doctor-fix.ts` (fix 引擎与 report 组装无共享状态); ② `rewriteThreeEndManagedBlocks` L1500-1594 — 注释自认是 CLI install writer 的**故意复制品** (L631-636 "duplicated from the install-side writers…to preserve the cross-package boundary") → 下沉 shared; ③ `enrichDescriptions` L1794-1959 是无关的 LLM 候选浓缩面 → 独立模块 |
| `src/services/doctor-cite-coverage-core.ts` | 1,428 | 7 | 5 | `runDoctorCiteCoverage` L468→文件尾 ≈ **单函数 960 行** (L343 后再无其他顶层声明)。缝: ledger 扫描/折叠段 vs 指标计算段 vs 报告组装段; 纯 helper (L238-343) 与类型 (L74-110) 已可先行剥离 |
| `src/services/extract-knowledge.ts` | 1,225 | 6 | 16 | ① 注入/PII 消毒块 L80-186 (`INJECTION_PATTERNS`/`sanitizeInjectionPatterns`/`redactPiiFields`) → `propose-sanitize.ts`; ② 渲染段 L827-996 (`renderFreshEntry`/`renderEvidenceBlock`) + evidence 合并机器 L1019-1213 (levenshtein/mergeEvidenceNotes/splitAtEvidence) → `pending-render.ts` |
| `src/services/event-ledger.ts` | 931 | 16 | 15 | ① 轮转/保留段 L573-920 (`rotateEventLedgerIfNeeded`/`dropEventsFromLedger`/`purgeExpiredEventArchives`) → `event-ledger-rotation.ts`; ② 截断/脱敏段 L193-268 (`truncateLongStrings`/`redactSecretsDeep`) → 独立 util |
| `src/services/review-write-actions.ts` | 864 | 7 | 2 | ① `modifyLayerFlip` L521-720 单动作 200 行 → 独立文件; ② 按动作族拆 approve/reject/defer/retire (approveAll L58 / rejectAll L329 / deferAll L721 / retireAll L785 边界清晰) |

**风险**: doctor.ts / cite-coverage-core 拆分风险中等 — 各挂着 1,834 / 2,887 行测试, 拆函数(而非只拆文件)需测试跟随; 纯文件级拆分(方案①类)行为不变。
**优先级**: doctor.ts 文件级拆分 P1; cite-coverage-core 单函数分解 P2 (先拆文件后拆函数)。

### 1.3 重复/重叠子系统

**现状证据 (已 spot-check 确认)**
1. **同名 check builder 双实现 (真重复)**: `doctor-knowledge-checks.ts` (221 行, 文件头自述 "W8 extract…from doctor.ts") 导出 7 个 builder, 其中 6 个 (`createDraftBacklogCheck`/`createDriftUnconsumedCheck`/`createKnowledgeTagsEmptyCheck`/`createCiteGoodhartCheck`/`createUnderseededCheck`/`createSessionHintsStaleCheck`) 与 `doctor-core-checks.ts` (624 行) **同名再实现**; 注册表 `doctor-check-registry.ts` L8-37 全部取自 core-checks, L38-40 只从 knowledge-checks 取 `createBodyReadMisfireCheck` 1 个 → knowledge-checks 约 190/221 行是死重复 (该文件全仓唯一非测试 importer 就是 registry)。
2. **okCheck/issueCheck 五连复制**: `doctor-check-helpers.ts` (30 行) 导出规范版, 但 `doctor-bootstrap-lints.ts`/`doctor-hooks-lints.ts` (L47-68)/`doctor-knowledge-checks.ts` (L19-42)/`doctor-skill-lints.ts` 各自再定义本地私有版 — 共 5 份。
3. **SESSION_HINTS 常量双定义**: `doctor-session-hints-stale.ts` L8-10 与 `doctor-core-checks.ts` L107-109 各定义一套 `SESSION_HINTS_STALE_DAYS/FILE_PREFIX/FILE_SUFFIX`。
4. **事件账本四头 JSONL sink** (`_shared.ts` L9-27): `.fabric/.intent-ledger.jsonl` (read-ledger.ts, 旧 intent ledger), `events.jsonl` (event-ledger.ts), `metrics.jsonl` (metrics.ts, 60s 计数器 flush), `cite-rollup.jsonl` (cite-rollup.ts, 日粒度 rollup)。写入头分散但各有分工(计数 vs 事件 vs rollup), 属演化分叉而非纯冗余; 另 `emitEventBestEffort` 有两份 — `review-shared.ts` 导出版 + `extract-knowledge.ts` L1214 内部私有版。
5. **检索/排序两套独立实现**: 主栈 = plan-context* 8 文件 + `bm25.ts` + `vector-retrieval.ts` + `cross-store-recall.ts` ≈ 3,900 行 (bm25 importer: conflict-lint / plan-context-bm25-cache / plan-context-doc-text / plan-context-scoring); 而 `review-search.ts` (475 行) 的 `triageSearch` 自带独立 index cache、**不用 bm25** — pending 检索与 recall 检索是两套无共享的排序器。
6. **跨语言孪生 (设计态, 非事故)**: server TS 与 hook .cjs 的 byte-parity 双份 (如 `isHighValueArchiveCandidate`, archive-scan.ts L19-24 注释 + `high-value-sst.test.ts` parity 锁; hook lib 亦有 ledger append/read 的 .cjs 重写)。有 parity 测试兜底, 不是清理对象。

**精简提案**: ①删 knowledge-checks 6 个死重复 builder (P0, registry import 已钉死, 零行为差); ②okCheck/issueCheck 收敛到 check-helpers (P1); ③SESSION_HINTS 常量单源化 (P1); ④emitEventBestEffort 合一 (P1); ⑤review-search 是否并入主检索栈 → 属架构决策, 仅记录不建议 (P2 评估)。
**风险**: ①-④ 均低; ⑤ 高 (review triage 的排序语义可能故意不同)。

### 1.4 Dead code

**符号级普查结果 (全仓 4 包 word-boundary 引用计数)**

| 目标 | 证据 | 判定 |
|---|---|---|
| `services/unarchive-knowledge.ts` **309 行** | `unarchiveKnowledge` 仅 2 处非测试"引用"且均为**注释提及** (cli/templates/hooks/lib/project-context-runtime.cjs:4395, shared/src/schemas/fabric-config.ts:304); 直接 importer 仅 1 个测试文件; index.ts barrel 不导出 | **整文件死代码** |
| `services/doctor-test-helpers.ts` 115 行 | `tempRoots`/`createProject`/`createInitializedProject` 等 srcRefs=0, testRefs 305/140/138 | 纯测试助手误放 src/services (应迁测试支撑目录) |
| `read-ledger.ts` `createStoredLedgerEntry` | 全仓 0 引用 (含测试) | 死 export |
| `read-ledger.ts` `migrateLegacyLedger` | srcRefs=0, testRefs=2 | 仅测试引用 (v1 迁移遗迹) |
| `rehydrate-state.ts` `LedgerEntryNotFoundError` | srcRefs=0, testRefs=6 | 仅测试引用 |
| `id-redirect.ts` `IdRedirectMap` (type) | 全仓 0 引用 | 死 export |
| **barrel 出口 79/131 个**无任何消费包 import | index.ts 导出 131 符号, cli + server-http-experimental 实际 import 仅 52 个 | 详见 1.6; 内含 `extractKnowledge`/`recall`/`reviewKnowledge`/`reviewPending` (MCP tools/ 直连 services, barrel 出口零消费) 与 `formatPreexistingRootMessage` (index.ts L230-232 注释自认 "extracted…so unit tests can exercise") |
| Cursor 客户端残留 | 全 src 14 处 "cursor" 命中全部为合法语义 (cache.ts L21-79 audit 字节偏移 cursor; review-shared.ts L65-71 路径回溯变量) | **无残留** |
| v1/迁移遗迹 (有意保留且仍接线) | `LEGACY_LEDGER_PATH` (根目录旧 ledger)、`legacy-serve-lock-probe.ts` 8 行 (index.ts L245-249 注释: 供 doctor 收尸 rc≤36 serve.lock)、`AGENTS_MD_RESOURCE_URI` 契约 shim (index.ts L318-345)、`doctor-legacy-fabric-cache.ts` 128 行 + `fabric-cache-migration.ts` 59 行 | 非死码, 是**到期可拆的迁移债** (每个都有 rc 注释锚) |

**精简提案**: P0 = 删 unarchive-knowledge.ts + 4 个死 export (删前按 [[feedback_audit_verification]]/[[feedback_migrate_grep_scope_includes_scripts]] 再跑正向白名单 grep, 范围含 scripts/ + .github/workflows/ + cli/templates); P1 = doctor-test-helpers 迁位、barrel 修剪; P2 = 迁移遗迹设淘汰期限。
**风险**: barrel 修剪须留意两类静态 grep 不可见的消费者 — ①quarantined `server-http-experimental` 在主 workspace 外 (KB [[fabric-serve-quarantine-not-delete]]: W2-06 additive 出口 `contextCache`/`readEventLedger`/`rehydrateAgentsMetaAt`/`readLedger`/`resolveLedgerPaths` 本次已扫描其 src, 属 52 个在用之列, 勿删); ②`buildColdEvalBatch`/`COLD_EVAL_RUBRIC` 由 fabric-review skill 经 maestro delegate 离线驱动 (index.ts L113-121 注释), 仓内 0 消费是假阴性。

### 1.5 测试规模比

**现状证据**
- 测试 97 文件 / 29,289 行 vs 源码 112 文件 / 27,382 行 → **测试:源码 = 1.07 : 1** (行数), 测试行占包内 51.7%。
- 最大 5 个测试文件与拆分缝:

| 测试文件 | 行数 | 顶层 describe 结构 → 拆分缝 |
|---|---|---|
| `doctor-cite-coverage.test.ts` | 2,887 | 9 个顶层 describe (L29 rollup / L147 by_store / L215 emit-fold / L381,497,1352,2120,2460,2734 runDoctorCiteCoverage 各切面) — **按 describe 一刀一文件, 缝最自然** |
| `review.test.ts` | 2,399 | 5 个 describe, 但 `reviewKnowledge` L166-2142 单块 ≈1,975 行 — 需按子行为 (approve/modify/defer/list) 二次切 |
| `doctor.test.ts` | 1,834 | `runDoctorReport` L38-1633 内嵌 8 个二级 describe — 按二级块切 |
| `extract-knowledge.test.ts` | 1,648 | 仅 2 个顶层 describe (`extractKnowledge` L157→尾) — **缝最弱**, 拆分需先在测试内部立切面 |
| `plan-context.test.ts` | 1,597 | 12 个顶层 describe — 缝干净, 随时可拆 |

**精简提案**: 仅对 >2,000 行的两个按 describe 缝拆 (vitest 无 projects 归并成本)。
**风险**: 低 (describe 级搬移); 共享 setup/helper 需提取。
**优先级**: P2 (比例本身健康, 拆分纯为可维护性)。

### 1.6 对外 API 面

**现状证据**
- **MCP 面 = 恰好 5 工具 + 1 遗留资源** (index.ts L311-316): `fab_recall` (tools/recall.ts) / `fab_archive_scan` (tools/archive-scan.ts) / `fab_propose` (tools/extract-knowledge.ts) / `fab_review` (tools/review.ts) / `fab_pending` (tools/pending.ts); 外加 legacy "bootstrap README" MCP resource shim (index.ts L318-345, v1 契约兼容)。
- **内部 CLI 调用面 = barrel**: index.ts 导出 **131 符号**, cli + server-http-experimental 实际 import **52 个** (79 个零消费)。在用面主要是: doctor 全家桶 (runDoctorReport/Fix/ApplyLint/CiteCoverage/ArchiveHistory/HistoryAll)、audit 面 (inspectRetiredReferences/explainWhyNotSurfaced)、conflict lint、`planContext` (供 `fabric plan-context-hint` CLI 适配器)、cross-store bodies (buildAlwaysActiveBodies/buildKnowledgeCensus)、ledger/metrics 读取器、embedder 探针 (readEmbedConfig/resolveEmbedder/isEmbedderResolvable)。
- **实验性/一次性残留**: ①`summary-cold-eval.ts` 75 行 (KT-GLD-0006 冷评 judge 协议, 仅离线 skill 驱动, 仓内零消费); ②server-http-experimental 供养出口 5 个 (W2-06, 受 KB quarantine-not-delete 约束); ③`get-knowledge.ts` 20 行 — index.ts L209-212 注释宣布已随 decolo 退出 barrel, 但 `plan-context.ts` 仍在直连消费 (半退役态)。
- 另有 zh-CN i18n 全套 (shared 包) 说明 doctor 报文是双语内容面。

**精简提案**: barrel 按 52 个在用面收敛 + 显式区分 "CLI 契约出口" 与 "http-experimental 供养出口" 两个注释段 (现已部分成段); cold-eval 标注 experimental。
**风险**: 见 1.4 的两类静态不可见消费者。
**优先级**: P1。

---

## §2 轨A核证四问

### Q1: doctor 有没有检查客户端配置文件本身合法性 (.claude/settings.json 可解析 / fabric hooks 注册在位)?

**YES (有, 且恰好覆盖今天的事故场景) — 但有 4 个衰减层。** 证据:
- 检查总数先纠偏: 注册表 `doctor-check-registry.ts` L219-279 共 **51 个 check builder** (非 ~35)。
- `hooks_wired` check: `doctor-hooks-lints.ts` `inspectHooksWired` L117-151 — 读 `.claude/settings.json` 并 `JSON.parse` (L122-125); **解析失败 (双 JSON 对象即属此类) 落 catch → status "missing-settings"** (L124-127), 产出 warn 码 `hooks_wired_incomplete`/`hooks_wired_missing_settings` (L308-317); 解析成功则逐一验证 3 个 fabric hook 注册在位: `Stop:fabric-hint.cjs` / `SessionStart:knowledge-hint-broad.cjs` / `PreToolUse:knowledge-pretooluse.cjs` (L129-139)。i18n 报文明说 "absent **or unparseable**" (shared/src/i18n/locales/en.ts L836-837)。
- 相邻还有 3 个 hooks 检查: `hooks_runtime` (同文件 L252-299, 用 `vm.Script` 语法解析每个已装 .cjs hook 文件 + shebang 检查)、`hooks_content_drift` (L206-250, 跨端 sha256 对齐)、`hook_cache_writability` (L153-204)。
- **衰减层 (为何实测"全哑无告警")**: ① 纯被动 — 只在用户手动跑 `fabric doctor` 时触发, 无 hook 侧/会话启动侧的主动告警; ② warn 级非 error; ③ "文件不存在" 与 "解析失败" 折叠成同一个 code `hooks_wired_missing_settings`, 不区分损坏场景; ④ 不在 `--fix` 自动修复面内 (remediation 只是提示重跑 `fabric install`, en.ts L840-841)。附带发现: ok 态报文 (en.ts L834-835) 仍写 "PreToolUse:knowledge-hint-narrow", 与代码要求的 `knowledge-pretooluse.cjs` (L138, rc.30 BUG-M3 修正) 存在 message/code 漂移。

### Q2: doctor --fix 能自动修复哪些项?

`runDoctorFix` = `src/services/doctor.ts` L607-886。三类:
- **fixable_error 码 (6)**: `bootstrap_snapshot_drift` L620 (重写 .fabric/AGENTS.md); `managed_block_drift` L637 (重放三端 managed block); `event_ledger_missing` L642; `store_counter_drift` L649; `event_ledger_partial_write` L716 (截断到最后完整行); `knowledge_body_dedup` L867。
- **warning/info 码但 --fix 兜底 (6)**: `store_orphan` L659 (孤儿 store 收编); `stray_fabric_dir_detected` L671 (rename 不删); `legacy_fabric_cache_dir_detected` L687; `project_registry_drift` L700-714; `stale_serve_lock` L806-846 (unlink 死 PID 锁); `promote_ledger_invariant_violated` L860-863 (合成事件回填)。
- **无条件卫生动作 (4)**: cite rollup L735-746 (`cite_audit_rolled_up`); 空壳 turn 折叠 L751-762 (`empty_shell_turns_folded`); ledger 轮转 L773-781 (`event_ledger_rotated`); metrics flush L793-797。
- 另一独立面 `--apply-lint` (`runDoctorApplyLint` L923, 实现在 `doctor-apply-lint.ts`): `lint:orphan_demote` 降级 maturity、`lint:stale_archive` 归档、`lint:pending_overdue` 30 天自动归档; `knowledge_layer_mismatch` 显式列为不可自动修 (MANUAL_LINT_ERROR_CODES L919-921)。
- fixable 判据源: `fixable: kind === "fixable_error"` (doctor-hooks-lints.ts L64 等各 issueCheck 处)。**hooks/skills/bootstrap-anchor/cite 类 warn 均不在 --fix 面内。**

### Q3: fab_archive_scan 证据源只有自家事件账本吗? 能读客户端 transcript 吗?

**YES 只有自家账本; server 本体无 transcript 读取能力。** 证据:
- `src/services/archive-scan.ts` L52-54: 唯一数据源 `readEventLedger(projectRoot)` (= `.fabric/events.jsonl`); 全文件无任何其他 IO。工具外壳 `src/tools/archive-scan.ts` L46 仅透传。
- 全 server src 扫描 "transcript|claude/projects": 命中仅 `body-altitude.ts` (检测知识正文"像 transcript"的形状 lint, 非读取)。
- **transcript 读取能力存在但在 CLI hook 层**: `packages/cli/templates/hooks/lib/transcript-summary.cjs` `summarizeTranscript` — 读 stdin payload 的 `transcript_path`, 路径沙箱白名单含 `~/.claude/projects/**` (L57), 8MB 上限 (L18); 由 `fabric-hint.cjs` (Stop) / `assistant-turn-emit.cjs` 消费, 把摘要**写成 events.jsonl 事件**。即管线是: hook 读 transcript → 摘要落账本 → fab_archive_scan 只扫账本。

### Q4: session_id 在 server 侧怎么流动?

**双通道注入 + sidecar 兜底 + 账本落盘, 无内存态 per-session store。** 证据:
- **通道1 (MCP 参数手传, optional)**: `fab_recall` (tools/recall.ts)、`fab_archive_scan` (tools/archive-scan.ts L40)、`fab_propose` 等工具签名带可选 `session_id`。
- **通道2 (hook sidecar 兜底)**: hooks (SessionStart/edit) 写 `.fabric/.cache/active-session.json` `{session_id, ts}` (writer 在 cli/templates/hooks/lib/state-store.cjs `writeActiveSession`); server 侧 `services/active-session.ts` `readActiveSessionId` L52-67 读之 (24h TTL, L19), `coalesceSessionId` L43-50 定优先级: **显式参数 > sidecar > undefined**。设立动机见文件头 L4-8 (agent 不传时 recall_coverage 归零, ccpm dogfood 2026-07-12)。
- **落盘态 (非内存)**: ①events.jsonl 每行事件带 session_id (event-ledger); ②per-session hint 缓存文件 `.fabric/.cache/session-hints-<id>.json` (前缀常量 doctor-session-hints-stale.ts L8-10, 7 天陈旧 lint); ③active-session.json 单槽 (最新写入者胜 — 多窗口并发下即 last-writer-wins 语义)。
- **消费端**: `doctor-cite-coverage-core.ts` (45 处引用, 按 session 聚合 cite 记账)、`doctor-history.ts` (21 处)、`archive-scan.ts` (9 处, session 分组/水位)、`plan-context.ts` (7 处, 给 knowledge_context_planned 事件盖戳)。

---

## Caveats / Not Found

- 行数含空行与注释 (raw line count); 任务给的 198 文件/54,413 行与本测 209/56,671 差异来自统计口径 (本测含 __tests__/ 与根 setup 文件) 及 commit 漂移。
- barrel "79 个零消费" 中有一部分是内部生命周期符号 (startStdioServer 经 isMainModule 自用、createFabricServer 测试用) 与类型伴生导出, 并非全部可删; 逐符号可删清单需二次核验 (含离线 skill 消费者假阴性)。
- server-http-experimental 在主 workspace 之外, 其 import 是否随 server 演进已断链未验证 (quarantine 包本身不在本次审计范围)。
- review-search 与主检索栈"应否合并"未做语义比对 (只确认了实现独立), 属后续架构评估项。
