# Fabric UX 北极星 — 全 proposals 差距普查 (GAP-CENSUS)

> 自包含交接文档。新会话(含 `/maestro` 自动路由)只读本文 + `EXECUTION-PLAN.md` 即可接手剩余工作。
> 普查范围:`proposals/00-SYNTHESIS.md` + `01..06`(6 触点审计)+ `north-star/NS-00..06`(7 北极星)。
> 生成:2026-06-24,经一次完整 grill(产物 `.workflow/scratch/20260624-grill-w3-remaining/`,artifact GRL-001)。
> 真源同步链:改 `packages/cli/templates/` → `fabric install --yes` 重生 dogfood 副本。

## 0. 当前状态总账

| 桶 | 量 | 状态 |
|---|---|---|
| ✅ 已完成 W0/W1/W2/W3a/W3b | ~38 项 | 已落地,独立复核绿(tsc 0;shared 625 / server 775 / cli 1139) |
| ✅ W3-C/D/E 本轮已合 main | 3 | C(skill 8→4,PR #14)/ D(doctor 拆 audit 组,#12)/ E(store 去同义词,#13) 全绿合入 |
| ✅ W3-F 已合 main | 1 | 命令表收敛 9 人面 + 2 hidden RPC(PR #15);context→inspect / info scope 真子命令 / 删 scope-explain 合入 / 删顶层 metrics |
| ✅ W3-J 已合 main | 1 | config prune(PR #16)。**census 大面积过时**:大瘦身早被 ux-w1-5/w2-3/W2-1 做光,真实 delta 仅删 1 死字段 `hint_broad_top_k`。**事故**:本机 Bash grep=ugrep 假阴性差点删 3 个活 narrow knob,被 `audit retired` round-trip oracle 抓回 |
| ✅ W3-H 已合 main | 1 | scope 三轴自解释(PR #17)。新 `audit why-not-surfaced <id>` 逐因诊断(归 audit 非 doctor)+ bootstrap 三轴决策表。**OQ-B 拍板不改 store 别名**(S6 未要求, 81 文件破坏性)。真 dogfood round-trip 实证 verdict 正确 |
| ✅ W3-I 本轮已落(branch) | 1 | 人面输出渲染收尾。**census §2 四子项大幅缩水**:①truncateSummary/②大白话化 human sink 前波已落、④删 2 cjs 是错(两个都活,orchestrator lib);真实安全 delta 仅 ③ `index.ts:89` 裸 `console.error(err)` → `renderUnexpectedError`(themed 单行人话 + stack 仅 `--debug`)。全绿 tsc0/cli 1149/knip。待 push+PR |
| ✅ W3-G **superseded**(无需做) | 0 | grounded 复核:census 的「渲染上移 shared/src + esbuild bundle」方案已被 `KT-DEC-0039` Option X **取代并落地**(commit `9d8ba86`+`d5f74fa`):渲染真源留 hook(`broad.cjs:1089` 导出 `buildSessionStartSinks`,:1250 hook 自用),CLI `fabric inspect` 运行时 `require()` 同份 .cjs(`inspect.ts:62`)。byte-identity/单一真源/零外部 TS 依赖三目标全达成,round-trip oracle `inspect-command.test.ts` 5/5 绿。重做 census 方案=返工/倒退(凭空加 esbuild 步骤)。**9 项 W3 全部收口** |
| ✅ W3-K **全部合入 main**(GRL-20260624-w3k) | 4 做 / 2 弃 | MCP 工具拓扑收尾完成。**K1 superseded** / **K3 dropped**(与 K2 矛盾)。**4 做全合**:批一 #19(K4 消 double-payload + K5 audience 合法示例)、批二 #20(K2 拆只读 fab_pending,reviewKnowledge 纯写;含 scripts/ 迁移修复 #462eda4)、#21(K6 omitted→结构化 dropped[]{id,reason} + payload-trim 反馈环缓解 + 守护测试)。grill `.workflow/scratch/20260624-grill-w3k/`;plan `20260624-plan-w3k-batch1` + `20260625-plan-w3k-batch2` |
| 🟤 W4 **grounded 复核:8/10 已 DONE/前提错** | 剩 2 边际 | Explore 全量实证(2026-06-25):W4-3/4/5 已做(无重复/单写路径 ux-w2-9/cite histogram 已输出);W4-6b~6f 全 W3-D/E/F 已重构或逻辑本就对;**W4-6a 前提错**(install.ts 非死代码,是活的 init 引擎:install-v2 的 `runInitCommand` + uninstall.ts 都调它,knip 绿佐证)。**仅剩 W4-1**(触发词单源化,两处当前一致→纯防漂移,低价值)**+ W4-2**(doctor lint 注册表化,核心重构 ROI 差)。**推荐收工**:proposals 实质价值已全在 W3+W3-K 交付 |
| ⚪ 明确 defer | 1 | 砍 relevance 轴(高÷高,动注入管道) |
| ⚫ 可不做 | — | fabric-archive 13 sub-phase 收敛(内核审计)+ 若干微 polish |

**"把 proposals 全做完" = 9 项 W3 + W3-K(~6) + W4(~10) ≈ 25 项**(另 1 项砍轴已主动 defer)。

## 1. 全局执行纪律(每项 PR 必守)

1. **migrate-before-delete + CI lint 拦**:删/改名任何命令或 skill 前,先迁调用点→验证 JSON 形状/行为一致→再删旧名→登记进 W2-2 `retired-reference` lint 的 registry。活契约清单(删前必迁):
   - `fabric scope-explain <layer> --json` 被 4 skill 调:`fabric-sync/import/review/archive` 各 SKILL.md。
   - `fabric plan-context-hint --all` 被 broad hook spawn:`knowledge-hint-broad.cjs:412/462`。
   - `fabric onboard-coverage --json` 被 archive/import 调。
2. **开 W3 前先钉死 shared flaky 测试**:`pnpm -r test` 首跑 shared 偶发 1 failed(并行高负载竞态),单跑/连跑全绿。带病 CI 信号会污染每个 W3 PR 红绿判断。
3. **一次落终态**:零用户/clean-slate,router 直接删、拓扑直接落终态,不"观察一版";回滚靠 git revert。
4. **验证门**:每波 `pnpm -r exec tsc --noEmit` + 相关 vitest;改 shared schema 必 `pnpm --filter @fenglimg/fabric-shared build`;`LEFTHOOK=0 git commit`。

## 2. 已锁 9 项 W3(grill 修订后)

> PR 顺序:**{C, D, E} 并行波 → F 收口波**;**{G, H, I, J} 独立插空**。

| id | 内容(grill 修订后) | 关键 file:line | 依赖 |
|---|---|---|---|
| **W3-C** | skill 8→**2 real leaf(archive/review)+ 2 thin shim(store/sync→意图路由 CLI)+ 0 router**;import→archive `source` mode、audit→review `retire` mode、connect→review `relate` mode(默认不主动建边);**破坏性 store 操作 confirm-before-mutate 门放 CLI 本身**(确定性来自 CLI 不靠 skill 厚度);触发词 ~45→~10 | `templates/skills/*`(8 skill);`store.ts`(re-scope/promote/backfill-scope/switch-write 破坏性子命令) | — |
| **W3-D** | doctor 八合一拆 + 遥测拆去**新 `audit` 组**:cite / conflicts / history / descriptions / metrics / retired;doctor 回归"健康+修"(合并 `--fix`+`--fix-knowledge`);统一 all/both→`all` | `doctor.ts`(8合1+14隐藏flag,:506 fix mutex,:1008 all/both);`index.ts` metrics | — |
| **W3-E** | store 去同义词:`add`→`mount`(store.ts:64)、`route-write`→`migrate route`/`switch-write --scope`(store.ts:201);运维 3 子命令→`store migrate {scope,promote,route}`(store.ts:260/354/384);`store list` 去裸 `\t`(store.ts:58)改 padEnd 表;价值轴分组 | `store.ts` | — |
| **W3-F** | 命令表收敛到 **9 人面 + 3 内部 RPC**;grouped-help 已派生(W1-4 done),补 group 标签;`context`→`inspect`;`info scope` 升真子命令 + 迁 4 skill 的 scope-explain JSON。**OQ-1:3 内部 RPC 是 rename `__` 前缀(NS-01 §3.2,触发 spawn/skill 迁移)还是保持 hidden-by-allowlist(零迁移)—— 倾向保持 hidden,实施时拍** | `index.ts` allCommands;`grouped-help.ts` | C/D/E |
| **W3-G** | cjs 渲染真源上移 `shared/src` 纯函数 + esbuild `--format=cjs` bundle 注入 hook;`fabric context` import TS 版、hook 用 bundle 版。**独立 PR + byte-identical 严验**(round-trip oracle,运行时零外部 TS 依赖) | `knowledge-hint-broad.cjs`(1336 行);`fabric context` ↔ hook | W2-1(done) |
| **W3-H** | **(grill 拆)** 本轮只做:① `doctor why-not-surfaced <id>` 逐因诊断(store 绑没绑 / semantic_scope 匹不匹配 / 当前 broad vs narrow 时机)+ scope 三因决策表入 bootstrap(bootstrap:89);**② 新增便宜改名消歧**:`semantic_scope: team` 与 `store: team` 同词不同义(broad.cjs:798/931,05-strategy S6)—— store 改用物理别名,"team/project/personal" 只留受众轴。**砍 relevance 轴 defer** | `doctor.ts`(新子命令);`broad.cjs:798/931`;`bootstrap-canonical.ts:89` | — |
| **W3-I** | **(grill 重定义+扩)** "人面输出渲染收尾"一 PR 收掉:① SessionStart HUD 渐进披露(ALWAYS summary 套 `truncateSummary`,broad.cjs:959;REFERENCE 33 行 id 墙→分组计数;backstop 默认 50→~15);② **大白话化** human sink(`statusTier` 暴露 nudge_mode/JSON、`importLine1` 露 `init_scan_completed`、backlog nudge 自带来源,banner-i18n.cjs);③ **错误渲染统一**:`index.ts:89` 非 FabricError 裸 stack → `renderCommandError`(red ✗ + 单行人话 + stack 仅 `--debug`),各命令收敛同 helper(error-render.ts);④ 删已死的 cite-policy-evict.cjs / knowledge-hint-narrow.cjs。**"hook 6→5" 承认已由 W2-6 完成** | `broad.cjs:959`;`banner-i18n.cjs`;`index.ts:89`;`error-render.ts` | — |
| **W3-J** | **(本次从 W2-3 part2 孤儿提升)** config schema 43→~18 + nudge_mode 唯一可见总表盘;lenient parser 零迁移。具体:删 inert 残字段(`reverse_unarchive_enabled/_dry_run`、`hint_broad_top_k`、`hint_*_cooldown_hours`)、写死 ~16 skill 内部阈值(`import_*`×5、`archive_max_*`、`hint_summary_max_len`、`plan_context_top_k`、`orphan_demote_*`×3 等)为 const、6 音量旋钮并入 nudge_mode、install 只 materialize 最小集 + 身份/路由、消 `review_hint_pending_age_days`(7)vs `review_stale_pending_days`(14)双定义 | `shared/src/schemas/fabric-config.ts:50-82,136,206,271` | — |

## 3. W3-K(新立)· MCP 工具拓扑收尾

> 来源 NS-03 #6-10 + 03-mcp 审计 3 细化。面向 AI agent 契约,NS-03 建议**单独 PR + grill**。跨端 wire 契约变更 → 改工具名/形状后 skill 文案同步,纳入 retired-reference lint。

| # | 改动 | file:line | 价值÷成本 |
|---|---|---|---|
| K1 | `fab_review` `modify` 三件套(modify/modify-content/modify-layer)→ 单 `modify`(layer flip 由 `changes.layer` 存在与否自动路由) | `server/src/tools/review.ts`(action enum) | 高÷低 |
| K2 | 读写分离:抽只读 `fab_pending`(原 review 的 list/search),`fab_review` 只留写动作(approve/reject/modify/defer),恢复 `readOnlyHint` 可信 | `review.ts` | 中÷中 |
| K3 | `fab_archive_scan` 合并进 `fab_propose` 的 `mode=scan`(一个写入流一个工具名) | `server/src/tools/archive-scan.ts` + `extract-knowledge.ts` | 中÷中 |
| K4 | `content[].text` → 单行摘要,消除 double-payload(现 recall.ts 仍 3 处 `JSON.stringify` 把 structuredContent 又塞 text) | `server/src/tools/recall.ts`(JSON.stringify×3) | 中高÷低 |
| K5 | 错误回执 `{error, action_hint}` 带 action 上下文 + `audience` regex 失败给合法示例 | review/propose handler catch | 中高÷中 |
| K6 | `omitted_count` → `dropped[]{id,reason}`(借 archive_scan 的结构化 reason 范例);reject / idempotent-skip 也给结构化 reason;approve 前 include_body 安全提示 | recall/review 返回形态 | 中÷低 |

## 4. W4(新立·清理桶)· 一致性 + CLI polish

> 低-中价值收尾。多数零结构风险,可一波清。

| # | 改动 | file:line | 来源 |
|---|---|---|---|
| W4-1 | self-archive normative 词典单源化:bootstrap:101(5 词)vs hook `ARCHIVE_NORMATIVE_KEYWORDS`(7 词,缺 `from now on`/`永远不要`)→ 单一 shared CJS-twin 常量 + parity 测试 | `fabric-hint.cjs:233`;`bootstrap-canonical.ts:101`;模式参考 `cite-line-parser.cjs:31` | NS-06 P1-5 / 05-S5 |
| W4-2 | doctor lint 注册表化:49 check → 数组+元数据驱动(加 lint 从碰 3-5 处变加 1 项);随 W2-1/W3-G 已自然瘦身,确认 templates-set-consistency lint 缺口是否需补 | `doctor.ts`;`06-architecture.md:73-86` | NS-06 P2-2 / 06-§4 |
| W4-3 | config-defaults codegen 到 `config-defaults.cjs`:消除 hook 侧 `config-cache.cjs` 裸 JSON 解析与 `fabric-config.ts` 默认值漂移 | `config-cache.cjs`;`fabric-config.ts` | NS-06 P2-3 / 06-§5 |
| W4-4 | events / injections.jsonl 重叠审查,能合则合少一套读写;确认 cjs 侧 events 已全过 guard(W2-9 已做单写路径,确认 6 处手拼收敛) | `06-architecture.md:116,122` | NS-06 P2-5 |
| W4-5 | `--cite-coverage` 输出逐条 miss 原因(no-recall / window-expired / path-mismatch / exempt),非只汇总百分比 | `cite-policy-evict.cjs:18-20,266,111`(注:文件 W3-I 删,逻辑迁 orchestrator) | NS-06 P2-4 / 05-S7 |
| W4-6 | CLI polish:删 `install.ts` 死代码(:245,5 文件 import 类型→抽 `install/types.ts`);`install-v2.ts` `shouldUseInstallRenderer` 反逻辑(:175,**注:W3a 删 Ink 后可能已 moot,需重对齐**);`doctor` flag 措辞(`--since` 默认归属、`--client cc` valueHint);`store --remote` 姐妹命令语义漂移(store.ts:69/105);`config` dismiss-slot/onboard-reset argv hack→真子命令(config.ts:290);`info` status 上色对齐(info.ts:133) | 见各 file:line | 01-cli 审计 |

## 5. 明确 defer（非 goal）

- **砍 relevance 轴**(broad/narrow 从用户可见模型移除 → BM25 自动判定投递时机):高÷高,需动归档 skill(让用户决定 broad/narrow 的那步)+ 注入管道。grill 决定本轮只靠 W3-H 的 `why-not-surfaced` 诊断 + 改名消歧兜底困惑,**不砍轴**。未来若困惑仍在可设 W5 单独评估。(NS-06 P2-1 / 05-strategy S6)

## 6. grill 决策锚点(GRL-001)

完整 Q&A + RFC 2119 验收门见 `.workflow/scratch/20260624-grill-w3-remaining/grill-report.md` 与 `context-package.json`。核心 11 锁:W3-C 护栏归位(2 real+2 shim,安全进 CLI)/ connect→relate / migrate-before-delete + lint / 先钉 flaky / W3-G 独立 PR byte-identical / PR 拓扑序 / W3-H 拆诊断+改名 / 一次落终态 / W3-I 重定义 / W3-J 提升 / W3-K+W4 立项。

## 7. 推荐下一步(给 `/maestro` 路由)

> **当前进度(2026-06-24 更新)**:flaky 已钉死;**W3-C/D/E/F/J/H 全部合入 main**(#14/#12/#13/#15/#16/#17);**W3-I 已落 branch `feat/w3i-error-render`**(PR #18,真实 delta 仅 ③ 错误渲染接线,①②前波已落、④删 cjs 是错被实证拦回);**W3-G superseded**(census 的 shared/src+esbuild 方案已被 `KT-DEC-0039` Option X 取代落地,byte-identity 三目标全达成,oracle 5/5 绿,无需做)。**→ 9 项 W3 全部收口**。剩余 proposals 工作:**W3-K**(~6,MCP AI 契约,NS-03 建议单独 grill)+ **W4**(~10,清理桶)+ 1 砍轴 defer。
>
> ⚠️ **接手 G/H/I 必读教训(W3-J 实证)**:census 的 file:line 与"待做"清单**会大面积过时**——W3-J 一半已被前波做光、W3-I 的 HUD truncateSummary 也已落。**改前必用可靠工具复核**(本机 Bash `grep` 是 ugrep,correctness-critical 普查假阴性 —— 用 Grep 工具 / `node includes`);**删任何字段/命令前跑 `fabric audit retired` round-trip oracle 兜底**(它救了 W3-J 差点删的 3 个活 narrow knob)。
>
> **W3-F OQ-1 已拍板**(GATE 2 用户确认):RPC **保持 hidden 不改名**(零迁移);**scope-explain 删命令合入 `info scope`** → 终态 **9 人面 + 2 hidden RPC**(非 census 字面 3,NS-01 §2 树真实终态)。**census 文案修正**:「迁 4 skill」实为 **2 skill / 3 站点**(`fabric-sync`/`fabric-import` 零命中);凑 9 人面删了顶层 `metrics`(仅留 `audit metrics`)。详见 `.workflow/scratch/20260624-refactor-w3f-command-table/`。

1. **W3-G / W3-I** 独立插空(互不依赖)。W3-G 因 byte-identical 风险建议单独 `maestro-plan` + 严验。
   - 节奏照 C/D/E/F/H/J:discovery → GATE 2 方案确认 → TDD → 单 PR。**migrate-before-delete 必守**:改/删命令名前 grep 范围含 `scripts/` + `.github/workflows/` + `package.json`;推前本地跑全部 `reusable-validate.yml` 的非-vitest gate(`pnpm lint` / `lint-protected-tokens.ts` / `test:strategy` / `test:store-only-e2e`)。

### ⚠️ W3-I 接手包(grounded 2026-06-24,node/rg 实证 —— 别信 census 字面)

census §2 W3-I 行四子项,**实证后大幅缩水/反转**(与 W3-J 同款 census 过时):

| 子项 | census 说 | grounded 实证 | 处置 |
|---|---|---|---|
| ① SessionStart HUD 渐进披露(truncateSummary) | 待做 | **前波已落**(broad.cjs:1006 已套 hint_summary_max_len) | ✅ 已完成,跳过 |
| ② 大白话化 human sink(statusTier/importLine1/backlog nudge framing,banner-i18n.cjs) | 待做 | 未复核现状 —— 需 discovery 时 grounded 核对 | 🔍 待核 |
| ③ 错误渲染统一:`index.ts` 裸 `console.error(err)` → `renderCommandError` | 待做 | **`packages/cli/src/lib/error-render.ts` 已存在**;`index.ts:89` 仍裸 `console.error(err, "\n")` 没接 | ✅ **真活儿**:把现成 error-render.ts 接进 index.ts:89(red ✗ + 单行人话 + stack 仅 `--debug`) |
| ④ 删"已死" `cite-policy-evict.cjs` / `knowledge-hint-narrow.cjs` | 删 | **❌ census 错**:`knowledge-hint-narrow.cjs` 1677 行,读 config(hint_narrow_*)+ emit hint + **注册为 PreToolUse hook**(skills-and-hooks.ts:231 `knowledgeHintNarrow`);`cite-policy-evict.cjs` 484 行,仍作 lib 拷贝 + **W2-6 orchestrator merge 其 output**(skills-and-hooks.ts:236/251)。**两个都活,删了断 PreToolUse envelope** | 🛑 **别删**,除非 GATE 重新评估 orchestrator 是否已接管 + round-trip oracle 兜底 |

**W3-I 真实安全 delta ≈ 只有 ③ 错误渲染接线**(error-render.ts 已建,接 index.ts:89)+ ② 大白话化(待核)。④ 删 cjs **极可能是 noop/错**(同 W3-J narrow 假死案,被 `audit retired` 抓回)。"hook 6→5 已由 W2-6 完成"指的是**注册数**收敛(orchestrator 合并),**不等于这俩 .cjs 文件可删**(它们是 orchestrator 的 lib 数据源)。

**接手纪律**:用 `rg -a`/`node includes`(本机 grep=ugrep,对 NUL-byte .cjs 假阴性);删任何 .cjs/字段前先 `node -e` 确认无 live 消费 + 跑 `fabric audit retired` round-trip oracle。
3. **W3-K** 面向 AI 契约,NS-03 建议单独 grill 后 PR。
4. **W4** 清理桶随空插,或集中一波。
5. 砍轴永久 defer 直到困惑实证复现。
