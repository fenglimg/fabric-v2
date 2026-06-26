# Grill Report: 剩余 W3 backlog(W3-C..I)

**Session**: 20260624-grill-w3-remaining
**Depth**: standard (5 branches)
**Date**: 2026-06-24
**Upstream**: `.workflow/.maestro/20260623-fabric-ux-census/proposals/north-star/NS-00..06`
**Artifact**: GRL-w3-remaining

## Discovery Summary

### Project Context
W0/W1/W2/W3a/W3b 已落地并独立复核绿(tsc 0;shared 625 / server 67 文件 / cli 1141,连跑两遍全绿)。剩余 W3 = C/D/E/F/G/H/I 七项大重设计,每项单独 PR。**关键:proposals 写于 census 时,W0–W3b 已改变代码,grill 对齐当前真源而非旧态。**

### Codebase Surface(当前真源 packages/cli/templates)
- **Skills(8)**:`fabric`(router) + archive/audit/connect/import/review/store/sync。W3-C 未动。
- **Hooks 文件(7)**:`knowledge-pretooluse.cjs`(W2-6 orchestrator,**已是唯一 PreToolUse 注册点**)+ cite-policy-evict.cjs / knowledge-hint-narrow.cjs(降为被调 lib)+ broad / fabric-hint / post-tooluse-mutation / session-end-marker。**注册层已是 5 生命周期事件一一映射 → W3-I 结构主体已由 W2-6 完成。**
- **命令注册(allCommands,12 项)**:install/store/sync/info/scope-explain/doctor/uninstall/config/plan-context-hint/onboard-coverage/metrics/context。whoami/status 已删(W1-6)。3 内部 RPC(scope-explain/plan-context-hint/onboard-coverage)**已 hidden 但未 rename 成 `__` 前缀**(W1-7 选 hide 不 rename,偏离 NS-01)。
- **config schema**:W2-3 只做 part1(删 9 死字段);part2 defer 到无主的"W3 config 重设计"。
- **活跃数据契约(删命令前必迁)**:4 skill(sync/import/review/archive)调 `fabric scope-explain <layer> --json`;broad hook spawn `fabric plan-context-hint --all`;archive/import 调 `onboard-coverage --json`。

### Upstream Material
NS-01(命令表 13→9)/ NS-04(skill 8→2,与锁定 4-leaf 冲突)/ NS-05(hook 6→5,主体已 W2-6 落)/ NS-06(scope 降维 + esbuild bundle + retired lint)。

---

## Branch Log

| # | Branch | Status | Decisions | Open |
|---|--------|--------|-----------|------|
| 1 | Scope & Boundaries | 🟢 Complete | 2 | 0 |
| 2 | Data Model & Contracts | 🟢 Complete | 3 | 0 |
| 3 | Edge Cases & Failure Modes | 🟢 Complete | 2 | 0 |
| 4 | Integration & Dependencies | 🟢 Complete | 2 | 0 |
| 5 | Migration & Rollback | 🟢 Complete | 2 | 1 |

---

## Branch 1: Scope & Boundaries

### Q1.1: W3-I 的结构主体已由 W2-6 完成,该如何重定义?
**Answer**: 重命名为「SessionStart HUD 渐进披露重写 + 删死文件」。用户追问"开局只显示一次,渐进披露何解"——已澄清:渐进=分层按需,非分时;开局只给截断索引 + 分组计数(`decision 25 · pitfall 8`),正文等 narrow 命中编辑路径或 fab_recall 再展开;当前 HUD(本会话顶部 system-reminder 即活例)平铺 33 行 id 墙 + summary 不截断 = 开局上下文过载。
**Evidence**: `knowledge-hint-broad.cjs:412/462`;本会话 SessionStart system-reminder 实物;NS-05 样例 A;违反 KT-GLD-0005 lean 哲学。
**Decision**: locked
**Constraint**: W3-I MUST 重定义为 HUD 渐进披露重写(ALWAYS summary 截断 + REFERENCE 分组计数)+ 删 cite-policy-evict.cjs/knowledge-hint-narrow.cjs 死文件;"6→5 映射"承认 W2-6 已完成,不重复。

### Q1.2: W2-3 part2(config schema 43→18)无主孤儿如何安置?
**Answer**: 立为独立项 W3-J。
**Evidence**: W2-3 status `DONE_WITH_CONCERNS`,part2 defer 到不存在的"W3 config 重设计";NS-06 P1-2/P1-3 评为策略侧最该简化处;config schema 当前 ~60 行字段。
**Decision**: locked
**Constraint**: 新增 W3-J = config schema 瘦身(删 inert + 写死 ~22 skill 阈值 + 6 音量旋钮并入 nudge_mode)+ nudge_mode 提为唯一可见总表盘;lenient parser 零迁移。

---

## Branch 2: Data Model & Contracts

### Q2.1 / Q2.3: store/sync 该降 CLI 还是保留 skill?护栏住哪一层?
**Answer**: 用户保留 store/sync,理由**非** NS-04 的"LLM 判断"判据,而是"store/sync CLI 复杂且含破坏性操作,希望对 AI 说'绑定一下'就走固定安全流程,而非让 AI 改 raw CLI 走偏"。escalation 追问后定:**护栏进 CLI + 薄 skill 仅做入口**。
**Evidence**: store 含破坏性子命令 re-scope/promote/backfill-scope/switch-write(NS-01 §1);AI 走偏风险源于"选错子命令/flag",息在 CLI 设计;NS-04 维护成本(4 套漂移 i18n + ~11 触发词)由薄 shim 化消除。
**Decision**: locked
**Constraint**: **W3-C 终态 = 2 real leaf(archive/review,完整 LLM 工作流 + gate 机器)+ 2 thin shim(store/sync,仅意图路由→调哪条 CLI,不背 i18n/precondition/触发词重资产)+ 0 router**。破坏性 store 操作的 confirm-before-mutate 门 MUST 放 CLI 本身;确定性来自 CLI 设计,不依赖 skill 厚度。
**综合裁定**: F1(4 leaf)与 NS-04(2 leaf)冲突由"护栏归位"消解 —— 不是 2 vs 4 之争,而是 store/sync 的 skill 层从'厚'变'薄',安全从 skill 迁到 CLI。两全。

### Q2.2: connect 合并后值不值得保留为 mode?
**Answer**: 保留为 review 的 `relate` mode,默认不主动 propose,仅用户显式说"连一下/补 related"时由 review 接住,复用 modify 写路径。
**Evidence**: `fabric-connect/SKILL.md:22` 自承运行时 include_related 够用;NS-04 深化 C。
**Decision**: locked
**Constraint**: connect→review `relate` mode(零新写路径),从所有 nudge 移除,不主动建边;import→archive `source` mode、audit→review `retire` mode 同此合并模式(三者均经既有写路径落盘,不引入新写面)。

---

## Branch 3: Edge Cases & Failure Modes

### Q3.1: 删/改名命令时如何结构性保证不裸删活契约?
**Answer**: migrate-before-delete + CI lint 拦。用户初次未懂,以"改电话分机号:先改通讯录验证能接通再停旧分机"类比澄清后锁定。
**Evidence**: scope-explain 被 4 skill 活调;plan-context-hint 被 broad hook spawn(:412/462);onboard-coverage 被 archive/import 调;census 差点误删三者(NS-01 §0)。
**Decision**: locked
**Constraint**: 每个 W3 PR MUST:先迁调用点→验证 JSON 形状/行为一致→再删旧名;同时登记进 W2-2 retired-registry,retired-reference lint 在 CI 拦任何残留引用。"别裸删"从人肉义务变结构保证。

### Q3.2: shared 间歇 flaky 测试怎么处理?
**Answer**: 开 W3 前先钉死。
**Evidence**: `pnpm -r test` 首跑 shared 报 1 failed,单跑/连跑两遍全绿 → 并行高负载竞态。
**Decision**: locked
**Constraint**: W3 启动前 MUST 先定位并钉死该 shared 间歇测试(疑并行写临时目录/共享状态竞态);带病 CI 信号污染每个 W3 PR 的红绿判断。

---

## Branch 4: Integration & Dependencies

### Q4.1: W3-G(esbuild bundle)时机?
**Answer**: 本轮做,独立 PR + 字节一致严验。用户要求通俗解释后锁定。
**Evidence**: hook 手写 cjs(broad 1336 行)重实现渲染逻辑,`fabric context` 反向 require cjs 求字节一致 = 认知倒置 + rc.21/24/29 类复发根;NS-06 §2.1(2)/P1-6 评为维护负担最大单源。
**Decision**: locked
**Constraint**: 渲染逻辑真源上移 shared/src 纯函数(无 fs),esbuild `--format=cjs` bundle 成单文件注入 templates/hooks;`fabric context` import TS 版、hook 用 bundle 版,字节一致由同源编译保证。MUST 独立 PR,byte-identical 测试守"重构不改变输出",运行时零外部 TS 依赖。

### Q4.2: 9 项 PR 推进顺序?
**Answer**: 按依赖拓扑:C/D/E 并行 → F 收口;G/H/I/J 独立插空。
**Evidence**: F(命令表 13→9)是 C(skill)/D(doctor)/E(store)的合项,须三者落完才能收口;G/H/I/J 互不依赖。
**Decision**: locked
**Constraint**: PR 顺序 = {C, D, E} 并行波 → F 收口波;{G, H, I, J} 各自独立插空,不强制串行。

---

## Branch 5: Migration & Rollback

### Q5.1: W3-H 是否被起大了?
**Answer**: 拆 —— 本轮只做 `why-not-surfaced` 诊断,砍 relevance 轴 defer。
**Evidence**: NS-06 §1.1 自将"砍 relevance 轴(broad/narrow 移出用户可见)"列 P2 高÷高(动归档/注入整条管道);而消除"为何没浮现"最大困惑的是 `doctor why-not-surfaced <id>` P1 高÷低。
**Decision**: locked
**Constraint**: W3-H 本轮 = 加 `doctor why-not-surfaced <id>` 逐因诊断(store 绑没绑 / semantic 匹不匹配 / 当前 broad vs narrow 时机)+ scope 三因决策表入 bootstrap;砍 relevance 轴单独评估(defer,non-goal)。

### Q5.2: 落终态 vs 渐进"观察一版"?
**Answer**: 一次落终态,不"观察一版"。用户反问确认 Branch 2 已定 store/sync 薄 shim 路由 CLI;澄清 Branch2 定"长什么样"、Q5.2 问"怎么上线",二者不冲突。
**Evidence**: 零用户、无兼容包袱、clean-slate(memory feedback_clean_slate);F1"观察一版"对冲在走到 2-leaf+shim 终态后作废;回滚靠 git revert,零迁移损失。
**Decision**: locked
**Constraint**: router 直接删 + 拓扑直接落 2-real-leaf+2-shim 终态,不分步"观察一版"。

---

## Synthesis

### Decision Summary
| # | Decision | Status | Branch | RFC 2119 |
|---|----------|--------|--------|----------|
| D1 | W3-I 重定义 = HUD 渐进披露重写 + 删死文件(6→5 已由 W2-6 完成) | locked | 1 | MUST |
| D2 | 新增 W3-J = config schema 瘦身 + nudge_mode 唯一总表盘 | locked | 1 | MUST |
| D3 | W3-C 终态 = 2 real leaf(archive/review)+ 2 thin shim(store/sync)+ 0 router;破坏性 store confirm 门进 CLI | locked | 2 | MUST |
| D4 | connect→review relate(不主动建边);import→archive source;audit→review retire | locked | 2 | MUST |
| D5 | migrate-before-delete + W2-2 retired-reference lint 当 CI 闸 | locked | 3 | MUST |
| D6 | 开 W3 前先钉死 shared flaky 测试 | locked | 3 | MUST |
| D7 | W3-G 本轮做,独立 PR + byte-identical 严验 | locked | 4 | MUST |
| D8 | PR 顺序 = C/D/E 并行 → F 收口;G/H/I/J 独立插空 | locked | 4 | SHOULD |
| D9 | W3-H 拆:本轮只做 why-not-surfaced 诊断,砍 relevance 轴 defer | locked | 5 | MUST |
| D10 | 一次落终态,router 直接删,不"观察一版" | locked | 5 | MUST |

### Revised W3 backlog(grill 后,9 项)
| id | 重定义后内容 | 依赖 | 波次 |
|---|---|---|---|
| **W3-C** | skill 8→2 real leaf(archive/review)+ 2 thin shim(store/sync→CLI 路由)+ 0 router;import/audit/connect 折 mode;破坏性 store confirm 门进 CLI | — | 并行波 |
| **W3-D** | doctor 八合一拆 + 遥测拆去新 `audit` 组(cite/conflicts/history/descriptions/metrics/retired) | — | 并行波 |
| **W3-E** | store 去同义词(add→mount、route-write→migrate route)+ 运维降权 `store migrate` + 价值轴分组 | — | 并行波 |
| **W3-F** | 命令表收敛到 9 人面 + grouped-help group 派生 + 3 RPC `__` 前缀(见 R5 open) | C/D/E | 收口波 |
| **W3-G** | cjs 渲染真源上移 shared/src + esbuild bundle;独立 PR + byte-identical 严验 | W2-1(done) | 独立插空 |
| **W3-H** | (拆)本轮只做 `doctor why-not-surfaced <id>` 诊断 + scope 三因决策表;砍 relevance 轴 defer | — | 独立插空 |
| **W3-I** | (重定义)SessionStart HUD 渐进披露重写(summary 截断 + REFERENCE 分组计数)+ 删 cite-policy-evict/narrow 死文件 | — | 独立插空 |
| **W3-J** | (新增)config schema 瘦身 43→~18 + nudge_mode 唯一可见总表盘 | — | 独立插空 |
| ~~6→5 映射~~ | 承认已由 W2-6 完成,不再单列 | — | done |

### Risk Register
| # | Risk | Branch | Severity | Mitigation |
|---|------|--------|----------|------------|
| R1 | W3-G bundle 出的 cjs 必须与现手写字节一致 + 运行时零外部 TS 依赖,否则破坏 hook 自包含约束 | 4 | High | 独立 PR + byte-identical 测试守(D7);producer-consumer round-trip oracle |
| R2 | 迁移期任一调用点(scope-explain JSON / plan-context-hint spawn / onboard-coverage)漏改 = 静默断知识注入/写入 | 3 | High | migrate-before-delete + retired-reference lint CI 拦(D5) |
| R3 | shared flaky 测试根因(并行竞态)未定位 | 3 | Medium | 开 W3 前先钉死(D6) |
| R4 | W3-H 砍轴 defer 后 relevance 轴长期保留 = scope 仍 3 维可见,诊断命令缓解困惑但未减维 | 5 | Medium | why-not-surfaced 诊断兜底(D9);砍轴单独评估 |
| R5 | 3 内部 RPC 当前 hidden 未 rename `__`(W1-7 偏离 NS-01);W3-F 需决定 rename(触发 spawn/skill 契约迁移)or keep hidden | 2 | Low-Med | 本次未锁,留 open;若 rename 走 D5 migrate-before-delete |

### Open Questions
- **OQ-1 (R5)**: W3-F 内,3 内部 RPC 是 rename 成 `__plan-context` 等(NS-01 §3.2,触发 broad hook spawn + skill 调用点迁移),还是保持当前 hidden-by-allowlist(零迁移,但审计仍可能误读)?retired-reference lint 已部分覆盖误读风险 → 倾向保持 hidden,但需在 W3-F 拍板。

### Non-Goals(本轮 defer)
- 砍 relevance 轴(broad/narrow 从用户可见模型移除)— P2 高÷高,单独评估。
- skill 4→2 的"下版再评" — 已被 2-real-leaf+2-shim 终态取代,moot。

### Recommended Next Step
权威剩余账见 `.workflow/.maestro/20260623-fabric-ux-census/gap-census.md`。先 **D6**(钉 flaky)→ 按 **D8** 拓扑开 PR。

---

## Branch 6: Full-proposal Census & Deferred Re-grill (added 2026-06-24)

> 用户追问:north-star 之外的 proposals(00-SYNTHESIS + 01..06 审计)是否漏查?并要求 grill 未做项 + 把 defer 项拉回 grill。
> 方法:6 并行 agent 普查 01..06 审计,只报不在"已知账"的项。SYNTHESIS Top16 干净映射、无新增。

### Q6.1: 砍 relevance 轴(deferred)重拍?
**Answer**: 便宜改名消歧本轮做 + 砍轴继续 defer(option 1)。普查挥出独立便宜件:`semantic_scope: team` 与 `store: team` 同词不同义(broad.cjs:798/931,05-S6)—— 与砍轴是两回事。store 改物理别名、team/project/personal 只留受众轴,纯措辞、不动注入管道。
**Decision**: locked
**Constraint**: 改名消歧并入 W3-H 本轮做;砍 relevance 轴维持 non-goal。

### Q6.2: NS-02 漏标的错误渲染(index.ts:89 裸 stack)?
**Answer**: 并入 W3-I(推荐 option 2)。NS-02 #3 标 P0 但未做;`index.ts:89` 非 FabricError 仍喷裸 stack。与 W3-I 同属 theme.ts 人面渲染面。
**Decision**: locked
**Constraint**: W3-I 扩为"人面输出渲染收尾",含 `renderCommandError` 统一兜底(red ✗ + 单行人话 + stack 仅 --debug)。

### Q6.3: 大白话化 jargon 簇?
**Answer**: 做,并入 W3-I(option 1)。statusTier 暴露 nudge_mode/JSON、importLine1 露 init_scan_completed、backlog nudge 不自解释 —— 直接影响非工程用户(项目主自陈非工程背景)。
**Decision**: locked
**Constraint**: W3-I 含 human sink 大白话化 + backlog nudge 自带来源。

### Q6.4: 两批孤儿如何登记?
**Answer**: 立 W3-K(MCP 工具拓扑收尾)+ W4(一致性/清理桶)。
**Decision**: locked
**Constraint**: W3-K = NS-03 #6-10 + 3 细化(单独 PR+grill);W4 = self-archive 词典单源 / doctor lint 注册表 / config-defaults codegen / events·injections 重叠 / cite-coverage 逐条 miss / CLI polish。详见 gap-census.md §3-§4。

### Branch 6 综合
全 proposals 普查确认:审计无重大漏网(多为 polish / 已 moot / 已规划细化);真增量 = 错误渲染(NS-02 漏标 P0)+ 大白话化 + scope 改名消歧 + 两批孤儿(W3-K/W4)。"全做完" = 9 W3 + W3-K(~6) + W4(~10) ≈ 25 项 + 1 项已 defer(砍轴)。权威真源 gap-census.md。
