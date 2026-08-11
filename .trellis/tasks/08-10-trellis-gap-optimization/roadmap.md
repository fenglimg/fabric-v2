# Fabric v2 优化 Roadmap — Trellis 对照 × 精简去繁(2026-08-10)

> 状态: **已评审定稿(2026-08-10)**。用户裁决见下方「评审结论」;落地按 §5 分批执行。

## 0. 评审结论(2026-08-10 用户拍板)

| 决策点 | 裁决 | 影响 |
|---|---|---|
| **ISS-001 归档范围** | 走代码侧修: 默认只扫增量, 全量改显式参数; **自相矛盾的 ref 文档删掉而非打补丁** | B4 实施方式确定;衍生出下方新轨 T |
| **B7 实验包(2,603 行)** | **删除** | 需 supersede KT-DEC-0016;进 W4 |
| **任务轴(§3.1)** | **暂不开禁**, W3 落地并跑一段后再评 | 维持 KT-DEC-0078 封印;W3 后重新评估 |
| **会话历史检索(§3.2)** | **不做** | 理由: 本仓已装 Trellis 自带 `trellis mem`, fabric 再做=重复建设+扩隐私面;正是 KT-PIT-0058 false-friend 警告的典型场景。建议归档为新 decision 防复议 |
| **分批顺序** | 按 §5 执行(W1 先行) | — |
| **44 会话归档积压** | 排在 W3 之后跑, 兼作 W3 验收实测 | 积压不丢(事件账本+transcript 都在)。**2026-08-11 已涨到 46** |
| **⚠️ 新增原则(用户主动提出)** | 「尽量保证代码就是真源, 文档能删就删, 代码要对 AI 足够清晰明确」 | 立为**轨T 文档瘦身**, 见 §4.5;并改变 B4 的修法 |

W1 前置确认已自查完成: 三个 worktree 的提交全部有分支保管(`646831a3` 已在 main / `daa83d84` 在 `feat/sync-readme-version` / `8ba8dc1b` 在 `worktree-fabric-observability-fixes` 且已推远端), 脏文件仅 maestro 运行时状态 —— **B1 删除无条件安全**。

---

## 1. 一页摘要(大白话)

**这次看出了什么病(按严重程度):**

1. **仓库里有相当多"确认死掉但还在占地方"的代码**——不是感觉,是逐个查了引用数的:cli 包 1,961 行不可达死代码(老安装器换代后尸体没埋,还在被顺手维护);server 包一个 309 行的文件零引用、6 个检查器有一模一样的双胞胎实现;翻译文件 27.8% 的键(348 个)没人用,其中 201 个是早已隔离的 v1.8 Dashboard 的全套文案;硬盘上还躺着 910MB 的陈旧 worktree,正是本地测试时好时坏的一个饲料源。**你说"像 vibecoding 产物"的感受,数字上是成立的**——但好消息是骨架其实不糟:三个包的依赖方向干净、没有循环依赖、测试和源码的比例健康。病在"换代后不埋尸体、单文件越长越大",不在根子上。
2. **今天亲历的事故暴露了一个真缺口**:另一个工具(Trellis)安装时把配置文件写坏了,fabric 的所有提示钩子静默失灵——没有任何一处会主动告警。体检命令(doctor)里其实有相关检查,但它是被动的、只报警告、也不会自动修。Trellis 在这方面的设计(坏了就大声说、能修就自动修)值得直接学过来。
3. **知识沉淀这条主链路又贵又费劲**(这是上次就挂账的):归档时会全量扫历史(登记在案的 ISS-001)、写一条知识要走两段长流程、待审条目不满 10 条就一直挂着没人管。Trellis 把"收工前过一遍要不要沉淀"做成了必经步骤——这个思路可以在不违反"提示永不阻塞"铁律的前提下学过来。

**推荐先治哪三个:** ① 埋尸体(纯删除,零功能风险,立刻让代码库清爽一截);② 配置防御升级(把今天这种静默失灵变成"主动发现+自动修");③ 沉淀链路减负(修 ISS-001 + 给小知识条目开快速通道)。

**Trellis 那边整体的结论:** 20 条机制逐条判完——**7 条值得学**(全是小机制,不动产品定位)、**4 条 fabric 已经有了**(有的甚至做得更彻底)、**5 条明确不学**(属于任务管理器/编排器领地,或已被之前的决策否决)、**4 条封进两份「需重议」档案**等你拍板(任务轴、会话历史检索——都被旧决策封印,开不开禁只有你能定)。

---

## 2. 轨A · Trellis 机制判定表(20/20)

verdict 说明: **steal** = 学设计重写(禁抄码,AGPL) / **have** = fabric 已有等价物 / **skip** = 明确不学 / **重议** = 被先例封印,材料见 §3。

| # | Trellis 机制 | verdict | 依据 / 对应痛点 | 价值÷成本 | 优先级 |
|---|---|---|---|---|---|
| 1 | 任务生命周期 phase gate(create/start 分离、双重同意) | **重议** | 任务轴家族,KT-DEC-0078 hard don't-steal #2 | 高÷高 | §3.1 |
| 2 | Per-turn 面包屑 + fail-visible 降级 | **steal** | 今日 settings 事故:hooks 静默全哑无告警;doctor 的 hooks_wired 检查是被动 warn 级、损坏/缺失折叠同一码、不进 --fix(doctor-hooks-lints.ts:117-151) | 高÷低 | **P0** |
| 3 | Brainstorm 规划纪律(evidence rule/一问一答) | skip | 工作流工具领地;fabric-review 已有自己的提问 policy;用户侧有 grilling/goal-mode | — | — |
| 4 | 任务工件体系(prd/design/implement + research 落盘) | **重议** | 任务轴家族,同 #1 | 高÷高 | §3.1 |
| 5 | JSONL manifest(子代理上下文清单) | skip | 依附任务工件体系,fabric 无对应载体;单独学无意义 | — | — |
| 6 | 子代理上下文注入(hook 改写 dispatch prompt) | **steal** | 核证:fabric 注册 5 hook 事件**无任何 Task/Agent matcher**(claude-code.json:25-35)→ 子代理只靠 CLAUDE.md 继承政策,无会话级知识提示 | 中÷低 | P2 |
| 7 | Spec 两跳索引(index→按需读正文) | have | lean recall 同构:描述+read_path→原生 Read(KT-DEC-0026/KT-GLD-0005) | — | — |
| 8 | before-dev 注入的 push/pull 双实现 | have | PreToolUse 软 push + fab_recall/recall-playbook pull,同一合同两路径已成立 | — | — |
| 9 | Check 闭环「自己修,不只报告」 | **steal** | doctor --fix 仅 6 fixable 码+4 卫生动作(doctor.ts:607-886);挂账的 MCP root-pin repair、settings 修复都不在面内 | 中÷中 | P1 |
| 10 | break-loop 根因封闭分类学(A-E)+「失败的修复」归因 | **steal** | fabric pitfall 归档无根因词汇表;纯 prompt 层补强,零 schema 改动(守 KT-DEC-0005 三轴) | 中÷极低 | P2 |
| 11 | 沉淀是必经闸口(3.3 必经+「没得更新也要走判断」+commit 前再拦) | **steal** | 直击 W3 写入摩擦 + 完成 bet#8 遗留;须以 policy 仪式实现,**不做 hook 硬 gate**(守 KT-DEC-0007) | 高÷低 | **P0** |
| 12 | trellis mem 跨会话对话检索 | **重议** | evidence 层家族:README 明列 non-goal「不是 session 证据库」;W7 留白是有意的 | 高÷中 | §3.2 |
| 13 | Workspace journal(刻意书写的 session 日志) | **重议** | 任务轴家族(don't-steal 清单 #5「evidence/journal 自动进 canonical」相邻) | 中÷中 | §3.1 |
| 14 | Channel 多 agent runtime | skip | 编排器禁区(KT-DEC-0072/0078);用户已有 maestro | — | — |
| 15 | meta 自描述(23 篇怎么改我自己) | skip | AGENTS.md DO/DON'T 表 + USER-QUICKSTART 已覆盖核心;剩余是文档打磨非机制缺口 | — | — |
| 16 | full-copy 分发 + SHA-256 漂移检测 + .new sidecar | **steal** | 核证:fabric 分发无 hash 清单,同步=字节比对静默覆写;doctor 仅存在性检查无漂移码;install 遇非法 JSON 会正确 abort 但**无人主动发现坏态**(Q2/Q3 核证) | 高÷中 | **P0**(并入 #2 群) |
| 17 | 确定性脚本引擎(政策在数据里,脚本只是解析器) | have | fabric 同构:CLI 是引擎,skill 是 thin shim(fabric-store 29 行/fabric-sync 27 行) | — | — |
| 18 | Session 身份工程(per-session 指针、拒猜降级) | have* | session_id 参数+active-session.json sidecar 已有;*但 sidecar 是**单槽 last-writer-wins**(24h TTL)——多窗口并发下有张冠李戴隐患,与 Trellis「宁可双双降级不许互相继承」相反 | 中÷低 | P2(隐患项) |
| 19 | SessionStart Next-Action 一句话 | skip | 核证:fabric 曾有「下一步:」行,**H5 决策有意退役**(broad:1340-1342);fabric 无状态机,静态 Next-Action 价值弱;不盲目翻案 | — | — |
| 20 | continue/finish-work(状态恢复+三段式提交秩序) | **重议** | 任务轴家族,同 #1;其中「收口仪式」的沉淀触发部分已由 #11 单独继承 | — | §3.1 |

**Steal 卡片(6 条,每条一句话设计重写方案):**

- **#2+#16 → 「客户端配置防御群」(P0)**: doctor 把 settings.json 可解析性 + fabric hooks 注册在位 + 安装副本漂移(新增模板 hash 清单)升为一等检查,区分 broken/missing 两码,全部纳入 `doctor --fix` 自动修复;修复动作复用 install 已有的 deep-merge(核证过:保留第三方 key)。今天的事故做成回归测试用例。
- **#11 → 「沉淀闸口 + 快速通道」(P0)**: ✅ **已完成**(2026-08-11, W3)。三招全落地: ① 收口仪式写进 bootstrap canonical 中英双语(`0b6c252a`);② 快速通道 —— 单条明确条目走「去重搜索 → 就地分类 → propose → 记账」,零 ref 跳转,三条件破一条即退回长链路(`68c60cf7`);③ review nudge 的量/龄双触发 —— **核证发现 Stop hook 早就是 count-OR-age**,真缺口在 SessionStart 的 action ladder 只看 count(其注释还声称与 Stop hook 一致),数据 `oldestPendingMtimeMs` 本就在算却被调用点丢弃(`779b0138`)。
- **#9 → 「--fix 扩面」(P1)**: ✅ **已完成**(2026-08-10, commit ea134c91)。挂账的 MCP root-pin repair 接进 `--fix`:`repairManagedRootPin` 原本生产侧零调用方(只有一个测试引用),逻辑从 `packages/cli/src/config/root-pin-migration.ts` 移进 `packages/shared/src/mcp-root-pin.ts` —— 不是为整洁,server 对 cli 零依赖,不移就接不上。新检查 `mcp_root_pin_managed` 只报 `managed`(digest 能证明是 installer 写的),`explicit`/`ambiguous` 不碰(KT-GLD-0016);严重级按钉是否仍指向本项目分叉(指别处 error/fixable,指对了 warning——对今天能工作的钉喊 error 会训练用户忽略检查)。**这条承诺 --fix,与邻居 install_copy_drift 相反:KT-PIT-0016 是双向的**,删 env 键不需要 CLI 模板。settings/hooks 修复已由 #2 群完成(commit 2e4dc057);README 版本同步经核证**树里根本没有对应检测**(全仓无任何 README 版本机制;最接近的 `global_cli_outdated` 管的是全局装的 CLI 版本),给不存在的检测接 --fix = 新建检测而非「扩面」,**本轮不做**。
- **#6 → 「子代理知识提示」(P2)**: 增设 PreToolUse(Task/Agent)hook,向子代理 dispatch prompt 追加一行「对将改文件先 fab_recall」+ 当前 session 已召回条目索引;守 never-block(纯追加,失败放行)。
- **#10 → 「pitfall 根因词汇表」(P2)**: fabric-archive 的 pitfall phase ref 增加封闭根因分类(缺规范/跨层契约/传播失败/测试缺口/隐式假设)+「上次修复为什么没修好」提问;纯 skill 文本,零 schema 变更。
- **#18* → 「多窗口 sidecar 隔离」(P2)**: active-session.json 从单槽改 per-session 文件(或拒猜降级),消除多窗口 last-writer-wins 串台隐患(用户实际是多窗口工作流,见 memory)。

---

## 3. 需重议档案(两份,等你拍板;不拍板不进 roadmap)

### 3.1 任务轴(#1/#4/#13/#20)——「fabric 要不要知道'我正在做什么任务'」

- **封印**: KT-DEC-0078 hard don't-steal #2「Trellis task/PRD 状态机 + AGPL」(2026-07-12 定,07-29 复核);bet#8 当时裁决「dogfood 后再评」。
- **现状代价**(research/fabric-current-state.md W1): 知识浮现只有路径+session 两个锚,没有任务/阶段轴;归档没有「任务收口」这个天然打点;「上次做到哪」全靠用户脑子。这是最大的一块 Trellis-shaped gap。
- **重议时的最小可行形态**(如果开禁,不必抄状态机): 给 fab_recall/propose 增加一个可选的「当前意图/任务标签」轴(手动声明,非状态机管理),让浮现和归档多一个锚——不做 create/start/finish 生命周期,不做 PRD,不碰编排。
- **不开禁的替代**: #11 沉淀闸口已经把「收口打点」补了一半;剩余代价接受。
- **风险提醒**: 一旦有任务概念,用户预期会滑向任务管理(scope creep 的经典入口);AGPL 下所有实现必须从设计层重写。

### 3.2 会话历史检索(#12)——「fabric 要不要能翻旧对话」

- **封印**: README 定位表 non-goal「不是终端/session 证据库」;W7 留白是有意的。
- **现状代价**: 「上次怎么解的/之前讨论过吗」只能查 canonical 知识;归档纪律没跟上时历史直接丢(归档摩擦 W3 放大此悬崖)。
- **已有的桥**: transcript 读取能力其实已存在于 CLI hook 层(transcript-summary.cjs,沙箱到 ~/.claude/projects)——技术上不是从零开始。
- **重议时的最小可行形态**: 只读检索(不入库、不自动 promote、零写入),作为 fabric-archive 的证据补充源;守 don't-steal #5「evidence 不自动进 canonical」。
- **风险提醒**: 隐私面扩大(读全部本地对话);与「knowledge layer only」定位的边界要重新画。

---

## 4. 轨B · 精简去繁提案(按优先级)

> 六维度→提案勾稽索引: **包边界** B7/B12 · **重复/重叠子系统** B3/B8/B15 · **死代码** B2/B3/B5/B6 · **巨型文件** B9/B11/B14 · **双份维护面** B8 + steal 卡 #16 · **命令面蔓延** 见本节末「明确不动的」(审计结论: 已被控住,不动)。

### P0(纯删除/止血,零功能风险)

| 提案 | 证据 | 风险 |
|---|---|---|
| **B1 清 .claude/worktrees 910MB**(1 个已合并纯尸体 + 2 个落后 12-13 commit)⚠️ 删 worktree 不删分支,但 2 个未合 worktree 若有未提交改动需先确认 | complexity-shared-misc.md §4;实证喂养 flaky 假红(ISS-003 家族) | 低(分支保留) |
| ~~**B2 cli 死代码一刀删 1,961 行(src 的 8.1%)**~~ ✅ **已完成**(commit ecef80f5):W0 的 T-2 把 `runInit`/`runScaffoldOnly` 迁进 install-v2 管线解钉测试后,v1 安装器 8 文件 2,049 行删除,**CLI 不可达代码归零** | complexity-cli.md §6,可达性分析实锤 | — |
| ~~**B3 server 死代码**~~ ✅ **已完成**。unarchive-knowledge.ts / 双胞胎 builder / 死 export 随 W1 清掉;`doctor-test-helpers.ts` 随 W5 前置收尾(`946ccb04`)迁入 `src/services/__testing__/` + 进 coverage 排除。**没有按原计划迁 `__tests__/`**:实测 `TS6059` —— 三个消费它的测试**共址在 `src/services/`**,而 tsc 的 `include: src/**/*.ts` + `rootDir: ./src` 会把跨出 rootDir 的 import 判违规,真要搬出去得连带搬走 `doctor.test.ts` 等三个大文件。本包 93 个测试全是共址,`__tests__/`(6 文件)反倒是少数派 —— 所以正确落点是 rootDir 内分目录,不是硬套另一个包的布局 | complexity-server.md §4 | 低;⚠️ barrel 修剪须防 quarantine 包与离线 cold-eval 两类静态 grep 假阴性 |
| ~~**B4 修 ISS-001 归档全量扫**~~ ✅ **已完成**(随 W3, `5e42db62`,取裁决 (b))。核证后**根因不在代码**:`archive-scan.ts` 省略 range 本就走 anchor cutoff,错的是 skill 契约强制它永远不省略 | issues.jsonl ISS-20260806-001(已 closed) | — |

### P1(小手术,需回归验证)

| 提案 | 证据 | 风险 |
|---|---|---|
| ~~**B5 i18n 死键清理**~~ ✅ **已完成**(随 W4)。实测死键 **403 而非 348**(348 是 20-key 抽样的保守下界);两个 locale 各 1265 → **862 键**。**普查必须建模动态 key**:纯字面量扫描报 562 死键,把 `` t(`doctor.check.${code}.message.${n===1?"singular":"plural"}`) `` 这类全判死;把 `${...}` 段当通配符后真值 403。**测试套件对 i18n 删除是弱 oracle** —— translator 走 `active[key] ?? en[key] ?? key`,删错键静默降级成裸键字符串,没有任何断言会红;强 oracle 是跑 19 个真实 CLI 面、正则抓渲染输出里的裸点号 key(该 probe 自身做过变异验证:删 `cli.doctor.description` → 报 2 处 LEAK)。ratchet + dashboard 命名空间禁令 + 从 audit 脚本吸收的「en 值含 CJK = 漏翻」进 `locale-parity.test.ts`;audit 脚本的 check[4](zh 值与 en 逐字节相同)**未吸收** —— 21 处全是有意为之(保护词/格式串/专名),当闸口纯是噪声。`scripts/i18n-audit.mjs` 已删:它被写进 `.gitignore`,从未提交过,别人克隆本仓根本看不见它 | complexity-shared-misc.md §3(20-key 抽样全仓 0 命中;保守下界) | — |
| ~~**B6 shared 死区**~~ ✅ **已完成**(随 W4,分两批:前 4 项独立于 B7,后 3 项待 B7 删包后)。删 `provenance.ts` / `mcp-store-contracts.ts` / `resolver/store-qualified-id.ts` / `schemas/events.ts` / `schemas/human-lock.ts` / `KnowledgeEntryFrontmatterSchema` / api-contracts §10(6 个 schema)。**普查方法**:逐 export 符号(共 34 个名)全后缀 node `includes`,不是按文件路径 —— barrel 用 `export *` 全量转出,消费者 import 的是符号名不是路径,按路径查会漏。**两个值得记的形态**:① `KnowledgeEntryFrontmatterSchema` 长得像 frontmatter 契约但零 parse 调用,运行时真在用的是另一处手写 regex parser —— 没人拿来 parse 的 schema 比没有更糟;② api-contracts 那节的 banner 写的是 "Existing API contract schemas","Existing" 本身就是线索:一次迁移里别的都拿到了目的命名,只有它拿到"反正本来就在这儿"。顺带修掉 parity E2E 的自证断言(mcp 行原本只查静态表,改成走 server 真 `registerTool` 的名字,变异验证通过) | complexity-shared-misc.md §2(69 模块全量普查) | — |
| ~~**B7 删 server-http-experimental 包**~~ ✅ **已完成**(随 W4,用户点名授权)。实测 **3651 行**(非 2603)。核证 KT-DEC-0016 后确认复活前提失效:`src/http.ts` import 的 `invalidateKnowledgeSyncCooldown` 在**全仓任何地方都不存在**,`node_modules` 从未安装 —— 排出 workspace 恰恰保证了没人构建/typecheck 它,所以它必然静默腐烂。**关键论点不是"它没用"而是 quarantine 相对 `git show` 的边际价值是零**,代价却是 census 测试 + workspace 排除 + 8 个活文件注释 + 一个看着还活着的烂目录。已 propose supersede decision(`delete-quarantined-package-git-history-i.md`)。顺带清掉 4 条只为该包存在的 barrel re-export(`readEventLedger`/`rehydrateAgentsMetaAt`/`resolveLedgerPaths`/`readLedger`);`contextCache` 保留 —— store-only-e2e 真在用,且它是 `server.contextCache?.invalidate?.()` 可选链,删了不会红只会静默跳过失效 | complexity-shared-misc.md §1 | — |
| ~~**B8 templates CJS 孪生迁生成通道**~~ ✅ **已完成**(随 W0 的 T-5 一并做掉):3 个手写 `.cjs` 孪生改为编译生成,随之删 4 个 parity 测试文件(−382 行)。经复核**真正的手写孪生只有 4 组而非 10 个文件**;`store-config-reader-parity` 判定不做、`render-backlog-line-parity` 的真问题是测试卫生而非重复实现(见 test-architecture-proposal.md §12) | complexity-cli.md §5 | — |
| ~~**B9 拆 skills-and-hooks.ts 五合一**~~ ✅ **已完成**(2026-08-10, commit f82fa3b3):1517 行 → 7 个单职责模块(step-result 34 / distribution-targets 329 / template-io 76 / install-skills 307 / install-hook-scripts 255 / hook-config-merge 275 / bootstrap-propagation 273)。拆分顺带清出 5 处死面:`InstallOptions` 空类型 + 19 处 `_options` 形参(零调用点传参)、`readFabricLanguagePreference` export(零 import,env.stage 有私有同名副本)、`BOOTSTRAP_MARKER_*` 再导出(零消费者)、`buildManagedBlockBody`/`FABRIC_HOOK_SCRIPT_BASENAMES` 过度导出、未用 `rm` import。**行为保持用真实 install 双跑比对证明**(158 文件 sha256 全集 + 完整 InstallStepResult 行流逐字节相同),不只靠测试绿 | complexity-cli.md §2 | — |

### P2(结构化,分批慢做)

- **B10 server services/ 平铺治理**: 96 文件 24,874 行(源码 90.8%)零子目录,doctor-* 前缀 46 文件 11,445 行(46%)→ 按前缀落子目录(doctor/ retrieval/ ledger/ …),纯移动+改 import。
- **B11 巨型文件拆分**: doctor.ts 1,968(fix 引擎 L607-886、install-writer 复制品 L1500-1594 两条缝)、doctor-cite-coverage-core.ts 单函数 960 行、api-contracts.ts 1,917(11 个 banner section,5 个 MCP 契约 ~1,000 行 server 单向消费是天然缝)、extract-knowledge.ts 1,225。
- **B12 伪共享下沉**: shared 69 模块中 26 个单端消费(theme 13 exports 仅 cli、event-ledger 132 exports 仅 server)→ 逐步下沉回消费包,shared 收敛到 24 个真共享。
- **B13 .workflow 尸体清理**: tracked 的 blueprint 37 + 完结 active 28 + scratch 20 个目录是尸体,roadmap.md 07-12 后停更 → 归档或删;**kg/embedding/wiki-index 是活的 maestro 产物别动**。
- **B14 巨型测试拆分**: doctor-cite-coverage.test.ts 2,887 行有 9 个 describe 缝;review.test.ts 2,398。
- **B15 pending 检索双栈评估**: review-search.ts 475 行自带 cache 与主检索栈(~3,900 行)并行——评估并栈或明确分工文档化。

### 4.5 轨T · 文档瘦身 / code-as-truth(用户 2026-08-10 新增原则)

> 原则原话:「一些文档可以考虑删除,尽量保证代码就是真源是最好的感觉,需要让代码足够清晰和明确对于 AI 来说」。

诊断依据(已有证据,无需再研究): W6 文档漂移是复发病(README 版本落后两条 minor 线;ISS-001 本身就是 ref 文档与实现矛盾);`docs/ARCHITECTURE.md:113` 开篇即自认「本文与代码冲突时代码胜出」——等于承认 prose 会漂;skill 侧 md 共 3,330 行(fabric-archive 光 ref 就 21 个文件)。

| 提案 | 内容 | 优先级 |
|---|---|---|
| ~~**T1**~~ ✅ **已完成**(随 W3 B4, `5e42db62`)。**部分偏离原计划**: 没整份删 `ref/phase-0-range-resolution.md` —— 其 Step 2-5(双语时间窗解析表 / 关键词抽取 / session_id 解析算法 / AskUserQuestion 兜底)是纯 LLM 行为规约,代码里没有对应物,删了就真丢。删的是**真矛盾的那部分**: Step 6 carry-forward contract 整段 + Step 5 落到 `"all"` 的兜底 + 3 个复述表格的 worked example(157→107 行),权威契约收敛到 zod `describe` | 随 B4(W1) |
| **T2** | **文档 census 三分类**: 全仓 prose(docs/*.md、README、.workflow/ 文档、skill ref 树)逐份判 **活契约 / 已漂移 / 尸体**;尸体删、漂移的要么修代码让其自明要么删、活契约留 | W4 |
| **T3** | **凡是复述代码的文档一律删**: 判据 = 「这段话的信息代码里已经有(类型/schema/错误信息/默认值),读代码就能知道」→ 删文档,必要时补强代码自解释性(更好的类型名、更明确的错误文案) | W4 |
| ~~**T4**~~ ✅ **全部完成**。fabric-archive 21 → 11(`68c60cf7`): source-* 6 合 1 / phase-3-* 4 合 1 / 删 rc-history / dry-run 折进 SKILL.md。fabric-review 10 → 7、784→613 行(`946ccb04`): 删 `askuserquestion-policy.md`(DO/DON'T 已在 SKILL.md 全文,两个模板在另两份 ref 里各有一份 —— 净新增信息为零)+ `worked-examples.md`(4 例中 2 例用的是已废除的模式名);`output-contract.md` 折进 `per-mode-flows.md`(roll-up 本就是流程第 7 步的产物)。合并仍按「读者带着什么问题来」切。**真正的收获不是行数**:瘦身普查暴露两类活的漂移 —— ① rc.37 NEW-12 的 **4→2 模式收敛从没传导进 ref 树**,SKILL.md 说 2 个模式而三份 ref 还在教 topic/health/revisit;② ref 树通篇按 per-project `fabric_language` 分支,而 `resolve-fabric-locale.ts` 早已 delegate 到 machine-wide `resolveGlobalLocale()`,`i18n-policy.md` 还列着 `zh-CN-hybrid`/`match-existing` 两个到不了这层的值。**教训: SKILL.md 改了不等于 ref 跟着改,ref 树是「主文档改版后没人回访的下游」** —— 这正是 T2 census 要逐份判的形态,只是这次在 T4 里先撞见了 | W3+W4 |
| **T5** | **止漂机制**: 版本号等确定性事实由代码/构建产出注入文档,而非人工同步(README 版本漂移的根治);无法自动化的加 census ratchet | W4 |

### 4.6 轨I · 安装物件必要性(用户 2026-08-10 新增原则)

> 原则原话:「对于安装的每一个物件都需要批判看待是否必要,有一些是历史产物没有作用但是还是进行了安装之类的」。

普查见 `research/install-payload-census.md`。与 #16「安装副本漂移」互补:漂移检测问「装下去的还对不对」,本轴问「本来就该不该装」——**manifest 只能查已装文件的字节,查不出缺席条目**(I1 正是这个空档)。

**已还清白的面**(不必再查): hook 入口脚本 8/8 + hook lib 33/33 从 6 个注册入口全部传递可达,0 死文件;`skills/lib/` 与 `hooks/configs/` 均已被活消费者或 W2 parity 测试钉住。

| 提案 | 内容 | 状态 / 优先级 |
|---|---|---|
| **I1** | **recall-playbook 的 ref 从来没被装过**: SKILL.md 两处指示 agent 打开 `ref/scenarios.md`,install spec 却没设 `includeRefFiles`。根因是该布尔值本身有三份真相(install 侧 / uninstall 侧 / 模板目录),而两侧实现本就优雅处理缺席 → 删标记,文件系统当唯一真源;补双向 producer-consumer round-trip oracle(24 tests,变异实证有判别力) | ✅ **已完成** commit 4585235a |
| ~~**I2**~~ ✅ **已完成**(随 W4)。搬进 `templates/hooks/lib/` 后发现**不只是搬家,是能整条删掉专用分发通道**:`installHookLibs` 会自动分发 `templates/hooks/lib/*.cjs`,所以 `HOOK_NARROW_SCRIPT_TEMPLATE_REL` + `HOOK_SCRIPT_DESTINATIONS.knowledgeHintNarrow` + `installKnowledgeHintNarrowHook` + `removeKnowledgeHintNarrowHook` + 两处 pipeline 调用全部删除。**搬文件会改变它自己相对 require 的基准** —— narrow 内部 11 处 `require("./lib/x.cjs")` 必须改成 `require("./x.cjs")`,漏了会在真实布局下炸(测试先红过一次)。**roadmap 说的"旧路径进 deprecated 清扫"不做**:`SKILL_DESTINATIONS` 的注释记录了本项目已就同类问题裁决过 —— 零用户阶段不做 residue sweep,"不在这张表里的路径就是 fabric 不管的路径"。验证走真安装 dogfood + 变异(删掉安装出的 narrow → validate 精确报 `hook script missing: .claude/hooks/lib/knowledge-hint-narrow.cjs`)。原表述 ↓ | ~~W4~~ — |
| ~~**I2 原始描述**~~ | **knowledge-hint-narrow 装在入口位却零注册**: 已退化为 pretooluse 的 lib,却仍装在 `hooks/` 顶层 → 移入 `hooks/lib/`,旧路径进 deprecated 清扫。**不是死文件是分类错位**:顶层位置误导心智模型,且 doctor wired 检查够不着。**W4 实测修正前提(逐 config 核对两端注册表)**:`knowledge-hint-narrow` 两端(`.claude/settings.json` + `.codex/hooks.json`)**都**未注册 → 确为错位,可移;但 `cite-policy-evict` **在 Codex 侧是注册的入口**(`.codex/hooks.json`),只在 CC 侧不是 —— 它不是错位而是**客户端不对称的真入口**,移进 lib/ 会直接打断 Codex 的钩子。所以 I2 只搬前者;后者的正确处置是把这份不对称显式化+可检,不是搬家 | W4(中风险,动分发路径) |
| **I3** | **两个 thin shim skill 的常驻描述税**: `fabric-store`(30L)/`fabric-sync`(28L)是纯意图→命令表+红线 | ❌ **用户裁决:不做** — 合并没必要 |
| **I4** | **清空历史清扫机制**: install 侧 `DEPRECATED_SKILL_DIRS`(10 条)+ `cleanupDeprecatedSkills()`,以及 uninstall 侧打**同一批目录**的 4 个 legacy sweeper(router/import/audit/connect)——只清一边自相矛盾,一起拆。零用户阶段不背 pre-W3-C 包袱 | ✅ **已完成** commit da51bcf6 |

**I4 拆除后的连带发现**(同族残留,已随批修): 用户可见文案还在指向已折叠的 skill —— `preview.ts` 让用户「用 fabric-connect 建边」(该 skill 早已折进 fabric-review 的 relate 子流程),`plan-context-hint` 的 --help 称被 fabric-import 调用。另修三处严重过期模块 doc(wiring site 指向已退休的 `commands/install.ts`、orchestrator 列 8 步实为 6 步且编号断裂、`SKILL_DESTINATIONS` 头注称「5 skills」实为 6)。**教训**: 删机制时要顺着它的"服务对象"再查一遍文案与注释 —— 代码删干净了,指向死物的字还在。

风险提示: 删文档要区分「复述代码的」与「记录为什么这么做的」——后者(设计意图、被否决的方案)代码里没有,删了就真丢了,应转入 fabric 知识库而非删除。这条边界要在 T2 census 时逐份把关。

**明确不动的**(审计还了清白): 三包依赖形状(干净 DAG 无循环无反向)、测试:源码比(server 1.07 健康)、命令面蔓延(已被 hidden/folded 控住)、i18n 双语同步(locale-parity 测试已是确定性 gate)。

---

## 5. 分批落地建议(每批独立收口,建议各开一个 Trellis 任务)

| 批次 | 内容 | 前置决策 | 预估量级 |
|---|---|---|---|
| **W1 埋尸体** | ✅ **全部完成**(2026-08-10): 911MB worktree 清理 + 811 行零引用死代码(commit bc636bcf/6bac073c);原受阻的 install.ts 死件簇经 W0 的 T-2 解钉后删除 2,049 行(commit ecef80f5),**CLI 不可达代码归零**。**剩一个尾巴**: `doctor-test-helpers.ts` 115 行仍在 `src/`(见 B3) | ✅ 已拍板 | ✅ 收口 |
| **W0 测试架构** | ✅ **全部完成**。T-1 量化(证伪「竞态」归因,落并行+超时 102.7s→46.4s)→ T-2 解耦死代码(**解锁 W1**)+ T-2b fixture 降频(46.4s→**26.4s**)→ T-3 切 AI/代码线(判据写进 `docs/TESTING.md`,措辞锁移 `PROMPT_WORDING=1`)→ T-4 提速(CI 门禁 10 步→9 步)→ T-5 消重(**吃掉 B8**,−382 行)。两处经实测**否决**: 档 B 拆分不做、撤 70% 覆盖率阈值不做 | 待用户评审提案 | ✅ 收口 |
| **W2 配置防御** | ✅ **全部完成**(2026-08-10): #2 hook 配置可解析性/注册在位升一等检查且分 broken/missing 两码并接入 `--fix`(commit 97ce7c5d/2e4dc057);#16 安装副本漂移 sha256 清单 + doctor 比对(commit db441392,刻意 detection-only,守 KT-PIT-0016);#9 MCP root-pin repair 从「造好没人调」接进检查 + `--fix`,逻辑移进 shared 打通 server↔cli 边界(commit ea134c91)。doctor 检查数 51→53 | 无 | ✅ 收口 |
| **W3 沉淀减负** | ✅ **全部完成**(2026-08-11)。**B4+T1**(`5e42db62`): ISS-001 根因不在代码而在 skill 契约 —— Step 6 规定 Phase 0 只能产出 `session_id[]` 或 `"all"`,没有 omit 选项,于是 skill 永远不省略 range,anchor cutoff 实际失效;改成三选一表(无 hint 一律 OMIT),矛盾的 Step 6 整段删除,权威契约收敛到 `archiveScanInputSchema.range` 的 describe。**review 龄触发**(`779b0138`): Stop hook 早已是 count-OR-age,缺口在 SessionStart 只看 count(注释还声称两边一致);`liveKnowledgeStats` 一直在算 `oldestPendingMtimeMs` 然后被丢掉 —— 与 #9 同族的"造好没人调"。**收口仪式**(`0b6c252a`): bootstrap 加"做完一段必须显式给归档判断,'无'是合法结论"。**T4 + 快速通道**(`68c60cf7`): ref 21→11(source-* 6 合 1 / phase-3-* 4 合 1 / 删 rc-history / dry-run 折进 SKILL.md),加单跳快速通道 | 无 | ✅ 收口 |
| **W4 瘦身(代码+文档)** | ~~B9~~ ✅、~~B8~~ ✅、~~B5~~ ✅(403 死键)、~~B6~~ ✅(34 符号普查)、~~B7~~ ✅(删包 3651 行);~~I2~~ ✅(删专用分发通道);~~B3 尾巴~~ ✅ + ~~T4~~ ✅(`946ccb04`);**剩 轨T 的 T2/T3/T5** | KT-DEC-0016 的 supersede decision 已 propose 进 pending 待审;I3 已裁决不做 / I4 已完成 | 1 个会话 |
| **W5 结构化** | B10-B15 择量 + steal P2 三条(#6/#10/#18*) | 无 | 按需分段 |
| **(条件批)** | 需重议档案 §3.1/§3.2 若开禁,各自单独立项走完整 brainstorm | 你的裁决 | — |

依赖关系(**已兑现**): W1 先行 → 实际是 W0 先行解钉 W1;W2 与 W3 可并行 → W2 已单独收口;W4 里 B8/B9 排在 W2 之后 → 均已在 W2 收口后完成。**剩余顺序: W3(当前)→ W4 → W5**。

> **回填说明(2026-08-11)**: 本节此前长期停留在 08-10 的时点状态(W1 标"受阻"、W0 标"待评审"、W4 列 B8 未做),与磁盘实况不符。本次按 `packages/` 实际内容与 git log 逐条核实后回填。**教训: 批次表是给下一个会话读的唯一状态源,不回填等于给自己埋假信号。**

---

## 附录 · 依据索引

- 轨A机制细节: `research/trellis-design.md`(20 机制逐条含文件路径)
- fabric 现状与痛点 W1-W8: `research/fabric-current-state.md`
- 精简审计三份: `research/complexity-server.md` / `complexity-cli.md` / `complexity-shared-misc.md`
- 先例知识: KT-DEC-0078(micro-transfer only)/ KT-DEC-0072(非编排器)/ KT-PIT-0058(false-friend)/ KT-DEC-0007(hook 永不阻塞)/ KT-DEC-0005(schema 三轴)/ KT-DEC-0016(experimental quarantine,B7 拟 supersede)/ KT-DEC-0026(lean recall)
- 正式 issue: `.workflow/issues/issues.jsonl` ISS-20260806-001/002/003
- 今日实证: `.claude/settings.json` 双 JSON 事故(本 session 发现并修复,commit 待 W2 一并回归)
