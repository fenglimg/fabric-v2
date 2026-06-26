# Grill Report: fabric install — 为什么交互体验"平淡"

**Session**: 20260625-grill-install-flatness
**Depth**: standard (5 branches)
**Date**: 2026-06-25
**Upstream**: 用户直觉「install 交互平淡」+ 一份真实 `fabric install` 输出(Exhibit A)
**Artifact**: GRL-20260625-install-flatness

> 这是「逐个 CLI 命令深度 grill」系列的第 1 站(install)。聚焦**felt experience / 体验**,与 2026-06-10 那场 grill(`GRL-20260610-fabric-install-uninstall-ux`,查的是 i18n / 客户端表 / 语义搜索 / store clone 等**内容正确性**)是**正交的一层**,不重叠。

## Discovery Summary(code-grounded,均已核验)

### 实际跑的是哪个 install
- `commands/index.ts:8` → `install-v2.ts`(pipeline + TUI renderer,184 行)。
- `commands/install.ts`(1058 行)是**已退休**实现,仍被测(issue ISS-20260608-021)。
- ⚠️ SessionStart 注入的 `KT-DEC-0017` 仍指向旧 `install.ts` —— 该知识条已 **stale**,需更新指向 install-v2 / pipeline。

### 根因 F1:华丽 TUI 与真人交互路径互斥,且方向装反了
- `pipeline.ts:78-190` 每个视觉元素都是 `if (renderer) { 富 TUI } else { 裸 console.log }` 二分:
  - 阶段标题:`🔍 label`(图标,`renderSection`) ↔ `[1/7] label`(无图标)
  - 进度:实时 spinner + step 徽章 ↔ **无**
  - 每阶段结果:success/skip/error 徽章 + detail ↔ **无**
  - 收尾:`renderSummaryCard` + `renderComplete`(礼花) ↔ **无**
  - 报错:带 hint 的 error box ↔ 裸 `console.error`
- `install-v2.ts:175 shouldUseInstallRenderer`:`!interactive→false`;否则 `return args.yes || args["dry-run"]`。
  → **真人交互装 = renderer=undefined = 全程裸日志;`--yes`(自动化/CI)反而全套 TUI。方向相反。**
- 合理动机:store/guidance stage 用 `@clack/prompts`(`guidance.stage.ts:4`、`store.stage.ts:4` 的 confirm/select/text)阻塞提问,与实时 spinner 在同一 TTY 冲突 → 交互路径关 renderer。
- **但过度牺牲**:图标 / summary card / 阶段徽章 / 收尾礼花**全是静态、不与 prompt 冲突**,却一并丢失。把孩子和洗澡水一起倒了。
- 无任何测试守 `shouldUseInstallRenderer`(grep 仅 2 处:定义 + 调用)。

### 根因 F2:扫描了你的项目,却什么都不告诉你(零 payoff)
- `env.stage.ts:96` 真跑了 `buildForensicReport(target)`,数据写进 `forensic.json`。
- 但用户侧只看到 `scanning` → `scan-complete`(`env.stage.ts:94/98`),**一个发现都不 surface**。
- issue ISS-20260530-035 已标:scan 无进度/无产出反馈。
- 这是「它好像很懂我项目,结果啥都没说」的空洞感来源 —— install 最该有的"它懂我"时刻被丢弃。

### 加重平淡的次级信号(来自 Exhibit A,已对代码)
- `已完成 hooks: installed=0 skipped=135`(`hooks.stage.ts:119 formatStageResult`):机器视角计数。`skipped=135` 像 135 个失败,实为"已是最新"。人类视角应是 `hooks 已最新 ✓`。
- 语义搜索:问 Yes/No → 答 Yes → "已是启用状态,未改动" 反高潮(与 2026-06-10 C1 重叠,此处不重复裁决)。
- 收尾:3 条 next-steps + 4×6 ASCII 能力表压在最后,主导最终印象;无"现在就做这一件事"的单一锚点。

---

## Branch Log

| # | Branch | Status | Decisions | Open Questions |
|---|--------|--------|-----------|----------------|
| 1 | 体验定位 & renderer 策略 | ✅ locked | 路径合一:静态视觉常驻,spinner 仅 `--yes` 时 animate | spinner 与无 prompt 阶段是否也可 animate |
| 2 | 扫描 payoff(它懂我时刻) | ✅ locked | env stage surface 2-4 条 forensic 发现 | 具体展示哪几项(产品取舍) |
| 3 | 结果措辞(计数 vs 人话) | ✅ locked | installed=0&skipped>0&err=0 → "已最新 ✓";裸计数移 --debug | - |
| 4 | 与既有锁定决策/clack 集成 | ✅ locked | 不动 clack 提问;合一而非加第三条路径;修 stale KT-DEC-0017 | - |
| 5 | 收尾印象 & 单一下一步 | ✅ locked | summary 卡片收尾;next-steps 单一首要动作;能力表降级 | 能力表是否仍默认显示 |

---

## Q&A Log

### Q1.1 (Branch 1): 华丽 TUI 与交互提问互斥、且方向装反 —— 怎么解?
**矛盾(code-grounded)**: `install-v2.ts:175 shouldUseInstallRenderer` 仅 `--yes||--dry-run` 给 renderer;真人交互装 renderer=undefined。`pipeline.ts:78-190` 整条 `if(renderer){富}else{裸}` 二分。clack 提问(`guidance.stage.ts:4`/`store.stage.ts:4`)与实时 spinner 同 TTY 冲突 = 关 renderer 的动机。
**Answer**: 用户授权按推荐裁。选 A「静态富化」。
**Evidence**: `ConsoleOutputRenderer` 已实现 `renderSummaryCard`/`renderSection`(图标)/`renderStep`(徽章);平淡根因 = 非 renderer 路径(`pipeline.ts:81-99` else 分支)不调这些静态能力,而非能力缺失。
**Decision**: locked。
**Constraint**: 路径合一为单一 renderer —— **静态视觉(图标 / 阶段徽章 / summary 卡片 / 报错 box)MUST 在交互路径常驻**;**动画 spinner MUST 仅在无 pending clack 提问时(实践上 `--yes`)启用**;MUST NOT 保留第三条独立路径(防 [[feedback-cli-design]] drift)。

### Q1.2 (Branch 1): 为什么不走全 TUI(方案 B)?
**Answer**: B 需把 store/semantic 选择前置为 flag/一次问完,牺牲"边装边引导"首次体验,且是大交互重构;C 可配置要养双路径 = 复发本 bug 的漂移根。价值÷成本下 A 胜。
**Evidence**: store.stage clone-or-new / guidance semantic confirm 是 2026-06-10 锁定的**引导式**交互(C1/C4),前置化会与那批决策对冲。
**Decision**: locked(B/C → non-goals)。

### Q2.1 (Branch 2): 扫描了项目却零 payoff —— install 该告诉用户什么?
**矛盾**: `env.stage.ts:96` 已 `buildForensicReport(target)` 建好报告写入 forensic.json,用户侧仅见 `scanning`→`scan-complete`(`env.stage.ts:94/98`),0 发现。issue ISS-20260530-035 已标。
**Answer**: env stage 在 scan-complete 处 surface 2-4 条**最高信息量**发现,作为"它懂我"时刻。推荐展示:① 检测到的客户端(CC/Codex…)② 项目类型/stack ③ 已有 fabric 状态(已绑 store 数 / 现有知识条数)。
**Evidence**: forensicReport 数据已在内存(`env.stage.ts:96`),仅需渲染;这是单点最高杠杆的反平淡改动(把死掉的"完成"变成情感核心)。
**Decision**: locked。
**Constraint**: 展示项 MUST 取自已建 forensicReport(不新增扫描成本);MUST 控制在 ≤4 行避免再造信息墙。
**Open**: 具体展示哪几项 = 产品取舍,实现期定。

### Q3.1 (Branch 3): `installed=0 skipped=135` 这种计数措辞
**Answer**: 改人话。规则:`installed=0 && skipped>0 && errors=0` → `<stage> 已最新 ✓`(可附 `(135 项无需改动)`);裸计数降级到 `--debug`。
**Evidence**: `hooks.stage.ts:119 formatStageResult` 当前直出 `installed=N skipped=M`;`skipped=135` 易读成 135 个失败,实为幂等无操作。
**Decision**: locked。
**Constraint**: stage 结果措辞 MUST 表达**结果状态**(已最新/已安装 N/失败 N)而非裸 install/skip 计数;原始计数 MUST 仍可经 `--debug` 取得。

### Q4.1 (Branch 4): 与 2026-06-10 锁定决策 & clack 的集成边界
**Answer**: 本站 F1/F2 与上场 grill 正交(那场=内容正确性,本场=体验通路),互不覆盖。实现红线:① 不改 clack 提问逻辑(护 C1/C4/C5 在途)② 静态富化 MUST 走既有 `t()`(不回灌硬编码,护 C5)③ 合一不加第三路径。附带:更新 stale `KT-DEC-0017`(仍指退休 `install.ts`)指向 install-v2/pipeline。
**Evidence**: 2026-06-10 grill C1/C4/C5 locked;`commands/index.ts:8` 实跑 install-v2;`install.ts` 退休(ISS-20260608-021)。
**Decision**: locked。

### Q5.1 (Branch 5): 收尾印象被 4×6 能力表主导
**Answer**: 收尾以 summary 卡片为主导视觉(F1 已引入);next-steps 提炼为**单一首要动作**("重启 AI 客户端 → 问它『Fabric 知道这个 repo 什么?』"),能力表降级为一行摘要或 `--verbose` 后置。
**Evidence**: `guidance.stage.ts:162-235` 当前末尾打完整能力表 + 3 条 next-steps,主导最终印象;无单一锚点。
**Decision**: locked。
**Open**: 能力表是否仍默认显示 vs `--verbose`,实现期定。

---

## Synthesis

### Verified Constraints(→ 实现)
- **F1-1** install 收敛为单一 renderer;静态视觉(图标/阶段徽章/summary 卡片/error box)交互路径常驻;spinner 仅无 pending prompt 时 animate;不留第三路径。
- **F1-2** `shouldUseInstallRenderer` 的"仅 --yes/--dry-run 才富化"逻辑废除/重构;补测试守该行为(当前 0 测试)。
- **F2-1** env stage 在 scan 收尾 surface ≤4 条 forensicReport 发现(客户端/stack/已有 fabric 状态),数据复用已建报告。
- **F3-1** stage 结果改"结果状态"措辞;`installed=0&skipped>0&err=0`→"已最新 ✓";裸计数移 --debug。
- **F4-1** 不动 clack 提问;静态富化走 `t()`;更新 stale KT-DEC-0017 指向 install-v2。
- **F5-1** summary 卡片收尾 + next-steps 单一首要动作 + 能力表降级。

### Open Questions(实现期细化,非阻塞)
- spinner 是否也可在"无 prompt 的阶段"(如 hooks/mcp)局部 animate,而非整次 --yes 才开?
- scan payoff 具体展示字段集。
- 能力表默认显示 vs --verbose。

### Risk Register
| # | Risk | Branch | Severity | Mitigation |
|---|------|--------|----------|------------|
| R1 | 路径合一时静态渲染与 clack 提问仍在同 TTY 抢行,造成错位 | 1 | med | 静态元素均为"打印即走"(无 redraw),clack 在其后独占;实现先验证 store/semantic 提问前后无重绘冲突 |
| R2 | 富化文案漏走 t() 回灌硬编码,回退 C5 | 4 | med | 所有新文案过 t() + i18n 完整性 gate;复用 pipeline.ts 既有 stageLabel(t) 范式 |
| R3 | scan payoff 展示过多 → 再造信息墙(本想治平淡反致臃肿) | 2 | low | 硬上限 ≤4 行;只取高信息密度项 |
| R4 | 改 formatStageResult 措辞撞 i18n snapshot 测试 | 3 | low | 同步更新 snapshot;计数仍 --debug 可得,不丢信息 |
| R5 | 删 shouldUseInstallRenderer 旧分支影响 --dry-run/--yes 既有行为 | 1 | med | 合一后 --yes 仍得动画全套;补回归测试覆盖 interactive/yes/dry-run/non-TTY 四态 |

### Recommended Next Step
全部 5 项为**同一 install 模块的体验层修复**,可一批 execute(F1 为骨,F2/F3/F5 挂其上,F4 为红线约束)。F1 路径合一是结构改动,建议先做并补四态回归测试,再叠 F2/F3/F5 文案/渲染。
- 下一站可继续 grill 其它命令(store / doctor / sync …),沿用本"体验通路 vs 内容正确性"双轴。

---

## Continuation 2026-06-25b — Phase 3「知识库拓扑」store 绑定 UX + 顺序规范

> install grill 第 2 段。聚焦 store stage(`install/pipeline/store.stage.ts`)的信息架构 + 多 store 架构下的绑定模型与安装顺序。

### Discovery(code-grounded)
- 绑定菜单只列"非个人 + 未绑定"store:`store-ops.ts:582 unboundAvailableStores` 过滤 `personal!==true && !declared`。→ 用户那次只有 wespy-cocos 符合 = "只显示一个"。
- personal store 全程不 surface:`ensurePersonalStore`(`store.stage.ts:519`)静默 ensure;`promptStoreSetup` 注释明说 "personal store is implicit and never listed"(:268)。→ "没说明已绑定 personal" 成立。
- 已绑定 team 仅作 prompt 上方 muted info 行(`setup.already-bound` zh:966),不在菜单。
- 全配好时整 phase 静默跳过:`store.stage.ts:124 hasWriteStore && unboundStores.length===0 → return`。→ 同站 1 "该说话时变哑巴" 同病。
- 单选硬伤:`promptStoreSetup` 用 `select`(单选),绑一个即 return。

### 模型分歧裁决(关键)
- **代码现状**:`required_stores: z.array(...)`(`fabric-config.ts:119`)= 可绑多个非个人 store;`STORE_MOUNT_GROUPS=["personal","team"]`(`store.ts:228`)→ **"team" 是组/类别(=所有非个人库),非特定库**;read-set = required_stores ∪ personal;`active_write_store` 单值。即架构支持「team 群多读 + 单写目标」。
- **用户裁决(产品 owner 意图)**:**1 project = 1 personal-store + 1 team-store** 的**双槽**模型。team 槽**单选**——列出该类型全部候选,挑一个。
- **裁决**:locked 为双槽 1+1。这把 array/多读能力**规范为 max-1 team**(好简化:消灭让作者自己都看不懂的多库裸态)。

### Branch Log(续)
| # | Branch | Status | Decisions | Open Questions |
|---|--------|--------|-----------|----------------|
| 6 | store 绑定模型 | ✅ locked | 双槽 1 personal + 1 team;team 槽单选 | array→max-1 的校验/迁移 |
| 7 | phase 信息架构 | ✅ locked | 双槽状态面板;每槽列全候选 + 加入已有/新建/跳过 | personal 槽动作集是否精简 |
| 8 | 状态可见性 | ✅ locked | personal+team 状态永远显式;废静默跳过 | - |
| 9 | install 顺序规范 | ✅ locked | 语言→personal 槽→team 槽,显式;personal 已绑也显示 | 顺序是否进 doctor 校验 |

### Q&A Log(续)
#### Q6.1: 一个项目能绑几个非个人 store?(模型分歧)
**矛盾**: 代码 `required_stores` 数组 + read-set 并集 = 架构支持多 team 群库;用户直觉 = 只一个 team。
**Answer**: 用户裁为 **1 personal + 1 team 双槽**(产品意图,"一直是这样")。team 槽单选,从所有 team 类型候选挑一。
**Evidence**: `fabric-config.ts:119`(array);`store.ts:228 STORE_MOUNT_GROUPS`;实际配置 `required_stores=[{id:team}]` `active_write_store=team`(正好 1)。
**Decision**: locked。
**Constraint**: 一个 project MUST 最多绑 1 个 team 类型 store;实现 MUST 加校验/迁移防破已有 >1 配置;UI "team 槽" MUST NOT 暗示该库必须命名 'team'(team=类别非别名,守 KT-MOD-0001)。

#### Q7.1: phase 该怎么组织?
**Answer**: 双槽状态面板。个人库槽(✓状态+切换/新建/跳过,通常自动)+ 团队库槽(✓状态 + 单选列出全部 team 候选含已挂载未绑 + 加入已有 + 新建 + 跳过)。wespy-cocos → team 槽候选项,不再是孤立"未绑定"。
**Evidence**: 用户双轮收敛 + 可视化 mockup 确认;`unboundAvailableStores` 当前过滤逻辑需扩为"按槽列候选"。
**Decision**: locked。
**Constraint**: 每槽 MUST 列出该类型全部可用 store(已绑高亮当前 + 已挂载未绑 + 加入已有/新建)供单选;动作集统一 加入已有/新建/跳过。

#### Q8.1: 已配好就静默跳过?
**Answer**: 改为永远先亮双槽状态再给跳过;personal 即使已绑也显式展示(消灭隐身)。
**Evidence**: `store.stage.ts:124` 静默 return;`:268` personal never listed。
**Decision**: locked。
**Constraint**: store phase MUST NOT 在已配好时整段静默消失;MUST 先渲染双槽状态。

#### Q9.1: 多 store 架构下最佳 install 顺序?
**Answer**: store stage 内显式规范化为:① 语言 ② personal 槽 ③ team 槽。当前子序已是此形(`store.stage.ts:65→82→128`)但 personal 步仅首次安装出现且静默;规范化为四步显式、personal 步常驻状态。
**Evidence**: 现有子序 promptLanguage→ensurePersonalStore→promptStoreSetup。
**Decision**: locked。

### Risk Register(续)
| # | Risk | Branch | Severity | Mitigation |
|---|------|--------|----------|------------|
| R6 | `required_stores` 数组现允许多绑;锁 1-team 需校验,已有 >1 配置会破 | 6 | high | 实现首步加 schema/运行期校验 + 迁移:>1 时提示用户选主 team;本人配置=1,风险低 |
| R7 | 锁单 team 牺牲 multi-read(读多个共享库)能力 | 6 | med | 用户已确认意图;若日后需多读,经"额外读源"子特性回补,不在本次 |
| R8 | "team 槽" 命名易与别名 'team' 混(KT-MOD-0001 命名撞轴) | 7 | med | UI 文案用"团队库(team 类)",候选项显真实 alias;不暗示必须叫 team |
| R9 | 双槽重组会改动刚合的 promptStoreSetup(KT-DEC-0017 单流) | 7 | med | 双槽仍是"一条 install 内可跳过步骤",与 KT-DEC-0017 不冲突;重组保持单流语义 |

### Recommended Next Step(续)
拓扑 phase 重构与站 1 的 F1(renderer 合一)同属 install 体验层,可同批 execute:F1 提供静态富化骨架,双槽面板挂其上。先做 R6 的 array→max-1 校验/迁移(防破配置),再落双槽 UI。

---

## Continuation 2026-06-25c — Phase 4~7(hooks / mcp / validate / guidance)体感

> install grill 第 3 段。聚焦剩余 4 个 stage 的输出体感。全部 code-grounded,与站1(F1/F3/F5)、站2(双槽)不重叠。

### 粒度裁决(贯穿本段)
用户选 **「结果 + 关键项」**:每 phase 收尾 = 一行人话结果 + 1-3 个关键产物;裸 path / 原始计数移 `--debug`。

### Discovery + Branch Log(续)
| # | Branch | Status | Decisions | Open Questions |
|---|--------|--------|-----------|----------------|
| 10 | 双重标题去重 | ✅ locked | 删 stage 自打的 `下一步 正在…` 第二标题;只留 pipeline `[N/7] 图标 标题`;修 hooks "git hooks" 误导 | 与 F1 合一同改 |
| 11 | 不透明计数 → 关键项 | ✅ locked | hooks 报 skill×N+hook×N;mcp 报已配客户端名;裸 path/count→--debug | result.installed 是否含友好名 |
| 12 | validate 富化 + 去英文 | ✅ locked | 一行英文→zh-CN 校验清单(config/hooks/events 就绪) | - |
| 13 | i18n 漏网补 t() | ✅ locked | validate 两串 + guidance surfaces.md 行收 t() | - |
| 14 | 语义搜索预检 | ✅ locked | 问前先探测;已启用则不问只报状态 | - |

### Q&A Log(续)
#### Q10.1: 一个 phase 两个标题,且 hooks 标题误导
**Answer**: 删 stage 自打的 `formatStageHeader`(`下一步 正在…`);phase 标题统一由 pipeline `[N/7] 图标 标题` 负责(配 F1 合一)。hooks 标题文案 "正在安装 git hooks" 改为准确表述(AI 客户端 hook + skill),非 "git hooks"。
**Evidence**: `pipeline.ts:94` 打 `[4/7] Hook 与 skill 安装`;`hooks.stage.ts:109/163`、`mcp.stage.ts:44/87` 各自再打 `下一步 正在…` 第二标题;hooks 实装内容 `hooks.stage.ts:64-95` = skill/hook/bootstrap,非 git hooks。
**Decision**: locked。
**Constraint**: 每 phase MUST 单一标题(pipeline 层);stage MUST NOT 再自打标题;标题文案 MUST 与实装内容一致。

#### Q11.1: 25+ 操作只报 `installed=0 skipped=135`
**Answer**: 按"结果+关键项":hooks → `✓ skill×4 + hook×8 已最新`;mcp → `✓ 已配 Claude Code / Codex CLI / Desktop`(取 `result.installed` 客户端名);裸 path/原始 count 移 `--debug`。
**Evidence**: `hooks.stage.ts:104-106`(installed/skipped 仅取 path 数组→`formatStageResult` 只显 length);`mcp.stage.ts:66`(`result.installed.length` 藏客户端名);标题含 "skill" 但输出从不提 skill。
**Decision**: locked。
**Constraint**: stage 结果 MUST 表达"装了哪类、多少、什么状态",skill 类别 MUST 在 hooks 输出可见;mcp MUST 列已配客户端名(非裸 count)。
**Open**: `result.installed` 元素是 config path 还是友好名,实现期需映射为客户端 label。

#### Q12.1: validate 整 phase 只一行英文
**Answer**: 成功输出从 `Validation passed` 改为 zh-CN 校验清单:`✓ 安装校验通过:config / hooks 路径 / events 均就绪`(关键项粒度)。
**Evidence**: `validate.stage.ts:40-71` 查 hook 路径/.fabric/config/events 四项,:75 仅 `paint.success("Validation passed")`。
**Decision**: locked。

#### Q13.1: 硬编码英文漏网(补 C5)
**Answer**: `validate.stage.ts:75/77` 的 "Validation passed"/"Validation failed: N error(s)"/`  - {error}` + `guidance.stage.ts:65` 的 "More: docs/surfaces.md…" 全收进 `t()` 双 locale。
**Evidence**: 上述行;2026-06-10 C5 已立"交互文本 MUST 经 t()",这些是遗漏。
**Decision**: locked。
**Constraint**: 补键 MUST 同步 en+zh-CN 并过 i18n 完整性 gate(承 R3)。

#### Q14.1: 语义搜索已开还问
**Answer**: `promptSemanticSearch` 进入前先探测当前 `embed_enabled` 状态;已启用 → 不弹 confirm,只打一行状态(`已启用 embed_model=…`);未启用才走原 confirm(default 仍 false)。消灭 ask→yes→"未改动" 反高潮。
**Evidence**: `guidance.stage.ts:101-105` 无条件 confirm(default false);:111-116 答 yes 后才发现 `alreadyEnabled` 回 "未改动"。
**Decision**: locked。
**Constraint**: 已启用语义搜索时 MUST NOT 弹 confirm,仅报状态。

### Risk Register(续)
| # | Risk | Branch | Severity | Mitigation |
|---|------|--------|----------|------------|
| R10 | 删 stage 第二标题需与 F1 合一协同,否则信息丢失 | 10 | med | 与 F1 同 PR 改;pipeline 标题保留图标+label,stage 仅出结果行 |
| R11 | mcp `result.installed` 可能是 config path 非友好名 | 11 | med | 实现先核 `installMcpClients` 返回结构,映射 client label;缺名则降级显数量+类别 |
| R12 | i18n 补键漏 locale → runtime missing-key | 13 | med | 同步 en+zh-CN,跑 i18n gate(同 R3) |

### Recommended Next Step(续)
第 3 段全是 install 体验层细修,与站1 F1/F3/F5、站2 双槽**同模块同批**。建议 execute 时一个 PR 收口:F1 合一(顺带去 Q10 双标题)→ 挂站2 双槽面板 + 站3 各 phase 结果行(Q11/12)→ 扫 i18n 漏网(Q13)+ 语义预检(Q14)。install grill(站1+2+3)至此覆盖全 7 phase,可转 plan/execute。

---

## Continuation 2026-06-25d — 错误/失败路径 + 首装/重装区分

> install grill 第 4 段(收官)。补齐"非 happy path"体感:失败时长什么样、首次 vs 重装。

### Discovery(code-grounded)
- 失败渲染:非 renderer 路径 `install-v2.ts:132-139` 仅 `console.error(paint.error(result.error.message))` 一行;renderer 路径有 `pipeline.ts:153-159 renderError`(带 hint)→ 又是 F1 反向(真人吃裸路径)。
- 错误文案:preflight `preflight.stage.ts:75/84/92/108/117/128` 等 5+ 处 `throw new Error("…")` 硬编码英文,仅 :67 `target-invalid` 走 t();hooks `:100` stderr raw;store/mcp raw throw。
- 回滚:`pipeline.ts:233-254 rollback` 全 `catch {}` 吞错、零输出。
- 首/重装:首装信号 `store.stage.ts:70 globalConfig===null`(mint 全局 + clone/create personal + 选语言);重装全幂等。pipeline intro 不分模式,均 `将按 N 个阶段执行`。

### 重装呈现裁决
用户选 **「智能折叠为体检」**:检测全幂等无改动 → 塌成一张安心卡片;首装走完整引导;明细 `--verbose`。

### Branch Log(续)
| # | Branch | Status | Decisions | Open Questions |
|---|--------|--------|-----------|----------------|
| 15 | 失败路径富化 | ✅ locked | 错误走 t() + hint + 哪个 phase + 非 renderer 也渲 error box | 随 F1 合一 |
| 16 | 回滚出声 | ✅ locked | rollback 告知回滚内容 + 项目当前状态 | 文案不泄内部 |
| 17 | 首/重装定调 | ✅ locked | 检测模式;首装 onboarding 语境 + 额外提问标"首次设置" | - |
| 18 | 重装智能折叠 | ✅ locked | 全幂等→体检卡片;明细 --verbose | 折叠需 end-pass 检测 vs 流式 |

### Q&A Log(续)
#### Q15.1: install 失败时用户看到什么?
**Answer**: 错误信息全走 `t()`(双 locale)+ 附 hint + 标明哪个 phase 失败;非 renderer 路径也渲染 error box(随 F1 合一,统一用 `renderError`)。
**Evidence**: `install-v2.ts:135` 裸 console.error;`pipeline.ts:153-159` renderer error box 带 hint 但交互路径 renderer=undefined;preflight 5+ 硬编码英文 throw。
**Decision**: locked。
**Constraint**: 失败输出 MUST 含 中文消息 + hint + phase 上下文;所有 `throw new Error` 用户可见消息 MUST 走 t()。

#### Q16.1: 失败回滚静默
**Answer**: rollback 执行后 MUST 告知用户回滚了什么 + 项目当前是否干净,不再静默。
**Evidence**: `pipeline.ts:233-254` 全 catch{} 吞错零输出。
**Decision**: locked。
**Constraint**: 回滚 MUST 有用户可见反馈(回滚项 + 最终状态);但 MUST NOT 泄内部堆栈/路径细节。

#### Q17.1: 首装 vs 重装无区分
**Answer**: 顶部检测模式:`globalConfig===null` = 首装(打 onboarding 定调 + 额外提问加"首次设置中"语境);否则重装(体检定调)。
**Evidence**: `store.stage.ts:65-83` 首装专属语言/personal 提问;pipeline intro 不分模式。
**Decision**: locked。

#### Q18.1: 重装(全幂等)怎么呈现
**Answer**: 检测全 stage 幂等无 install → 折叠为一张体检卡片(`✓ Fabric 已是最新 · N 阶段全就绪 · 无改动`);明细走 `--verbose`。首装不折叠,走完整引导。
**Evidence**: 用户实贴重装全 `installed=0 skipped=N`;`pipeline.ts:201-228 buildSummary` 已聚合 disposition,可据此判全幂等。
**Decision**: locked。
**Constraint**: 折叠仅在全 stage 无 install(纯 skip/idempotent)时触发;有任一改动则正常逐 phase。

### Risk Register(续)
| # | Risk | Branch | Severity | Mitigation |
|---|------|--------|----------|------------|
| R13 | 智能折叠需"全幂等"判定,但输出流式逐 phase,折叠要 end-pass | 18 | med | 复用 `buildSummary` 末尾聚合;流式期可静默/极简,末尾若全幂等则打体检卡;或预扫 disposition |
| R14 | 错误 i18n 补键漏 locale | 15 | med | en+zh-CN 同步 + i18n gate(同 R3/R12) |
| R15 | 回滚反馈过度暴露内部致用户恐慌 | 16 | low | 文案层面:只说"已回滚 N 项改动,项目保持原状",不打路径/堆栈 |

### Recommended Next Step(收官)
install grill 四段覆盖**全 7 phase × (happy path + 信息架构 + 失败路径 + 首/重装)**,22 条 locked constraint。所有改动同属 install 模块,建议单 PR 分层落地:
1. **F1 renderer 合一**(骨架):静态视觉常驻 + 去双标题(Q10)+ 非 renderer 渲 error box(Q15)。
2. **挂载**:站2 双槽面板(R6 先做 array→max-1 校验)+ 站3/4 各 phase 结果行(Q11/12)+ 体检折叠(Q18)+ 首/重装定调(Q17)。
3. **横切**:i18n 漏网全收 t()(Q13/Q15,含 preflight 错误)+ 语义预检(Q14)+ 回滚出声(Q16)+ 扫描 payoff(F2)。
→ 转 `/maestro-plan --from grill:GRL-20260625-install-flatness`。

