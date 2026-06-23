# Fabric 北极星重设计 — 综合 + 统一全量 backlog

> Phase 1 产出。镜头 = 激进三连(存在性 / 形态·技术栈 / 审美),不是修 bug。
> 输入 = 6 份审计(`../01..06` + `../00-SYNTHESIS`)。本文 = 目标态 + 把审计 issue 与北极星决策**合并成一个按优先级排满的全量 backlog**,供 Phase 3 全修。
> 详见同目录 `NS-01..06`。

## ★ 决策锁定(2026-06-23,用户拍板)
- **F1 Skill 拓扑** → **先删 router 保 4 leaf(archive/review/store/sync),观察一版**;下版再评 4→2。不一步到 2。
- **F2 CLI 栈** → **退 Ink,分两步**:W2-5 先抽共享 theme(无悔前置),W3-A 再拔 Ink(单独 PR)。
- **F3 审美** → **更鲜明多色**(非"安静仪表盘")。**影响面 = CLI 输出 + Hook 注入文案(共用同一 theme/渲染真源)**。调和:退 Ink 后色板用纯函数·cjs 可 require 的 `ansis`(truecolor)+ 必要处 `gradient-string` 强调,取代 picocolors(16 色不够鲜明)。theme.ts 出"鲜明多色"token,CLI 与 hook 两处共享。

---

## 一、北极星目标态(一眼看全)

| 触点 | 现状 | 北极星 | 关键决策 |
|---|---|---|---|
| **CLI 命令** | 13 人面 / 16 注册 | **9 人面 + 3 内部 RPC** | 删 deprecated 别名;3 个"假死"命令 KEEP+迁内部;grouped-help 改派生 |
| **CLI 技术栈** | Ink@4 + React18 + clack + picocolors | **退 Ink → @clack + picocolors 纯函数** | Ink 是误用(当 console.log);hook 是 cjs 永远 require 不了 Ink |
| **CLI 审美** | 三栈割裂、裸 \t | **"安静的仪表盘"**:单主色 cyan + 树形 `▸├└` + padEnd 栅格 + 三态符号 | 靠排版纪律赢 maestro 的炫色 |
| **MCP 工具** | 4(recall/review/archive_scan/extract) | **4(成员换)**:recall(重构)/ pending(NEW 只读)/ review(只写)/ propose(scan+extract 合并改名) | extract→propose 名实一致;recall 双数组→单 entries[] |
| **Skill** | 8(router+7) | **冲突:2 leaf+删 router(激进) vs 4+1(保守)** | 见 §三-F1 |
| **Hook** | 6 + lib | **5**(cite-evict 并入 narrow;KILL cite-contract-reminder) | 一一映射 5 生命周期事件;全降软 nudge 无 block |
| **策略旋钮** | ~45 key | **~18 key**(纯阈值 38→9) | 删死字段、写死 22 skill 阈值、6 音量旋钮并入 nudge_mode |
| **架构镜像** | 每文件 5 份入 git(集合已漂移) | **1 份真源**(`cli/templates/`) | 4 套 dogfood 产物 gitignore + git rm --cached |
| **scope 模型** | 3 维(layer×scope×relevance) | **1 维可见** + relevance 降为 BM25 内部时机 | + why-not-surfaced 诊断出口 |

---

## 二、统一全量 backlog(按波次 / 优先级排满 —— Phase 3 全修依据)

> 排序原则:① 红线·correctness 先 ② 机械低风险 ③ 结构根治 ④ 大重设计(先杀后修,避免美化将删之物)。每项标 [来源] 价值÷成本。

### W0 · 红线 / stale-pointer(立即,分钟级,零结构风险)
- **W0-1** `narrow.cjs:1245` 删退役 MCP 工具 `fab_plan_context` 引用(`fabric plan-context-hint --all` 这半保留,CLI 命令仍活)— [Hook/NS-05] 高÷低
- **W0-2** `bootstrap-canonical.ts:93/161` `fabric_language`→`~/.fabric/fabric-global.json#language` — [Strategy] 高÷低
- **W0-3** `fabric-hint.cjs` 删 4 处 `decision:block`(archive_backlog/review/import/maintenance 全降软 nudge)— [Hook/NS-05,KT-DEC-0007 红线] 高÷中

### W1 · 机械 cheap-high(改名/文案/删死字段,无结构风险)
- **W1-1** `fab_extract_knowledge`→`fab_propose` + 统一 server instructions — [MCP] 高÷低
- **W1-2** `fab_review` description 内嵌逐-action required 清单(绕 flat-shape)— [MCP] 中÷低
- **W1-3** `broad.cjs:959` ALWAYS-ACTIVE summary 套 `hint_summary_max_len` 截断 — [Hook] 中高÷低
- **W1-4** `grouped-help` 从 `allCommands` 派生 + group 标签(修 `context` 浮空)— [CLI/NS-01] 高÷中
- **W1-5** 删 config 死字段(`cite_evict_interval`/`reverse_unarchive_*`/`hint_broad_budget_chars`)— [Strategy/NS-06] 中÷低
- **W1-6** 删 deprecated 别名 `whoami`/`status`(`info` 已取代,零 caller)— [CLI/NS-01] 中÷低
- **W1-7** 3 内部 RPC(`plan-context-hint`/`scope-explain`/`onboard-coverage`)加 `__` 前缀/标内部,从人面 help 隐形(**不删,先确认调用点**)— [CLI/NS-01] 中÷低
- **W1-8** KILL `cite-contract-reminder` lib(与 C1 recall 自动记账矛盾)— [Hook/NS-05] 中÷低
- **W1-9** `nudge_mode` 写进 shipped config + 提为唯一可见总表盘 — [Strategy/NS-06] 中高÷低

### W2 · 结构根治(一次性消一批维护税)
- **W2-1 ★** 镜像 5→1:4 套 dogfood 产物 `.gitignore` + `git rm --cached`,留 `cli/templates/` 唯一真源 — [Arch/NS-06] 高÷低 **(架构 Top1)**
- **W2-2** doctor 加 `retired-reference` lint(登记表驱动,根治 stale-pointer 类)— [Arch/Strategy] 高÷中
- **W2-3** 旋钮瘦身 45→~18(写死 22 skill 阈值 + 合 6 音量旋钮入 nudge_mode,lenient parser 零迁移)— [Strategy/NS-06] 高÷中
- **W2-4** `fab_recall` candidates/paths→单 `entries[]`(read_path 挂条目 + score + body_in_context)免 join — [MCP/NS-03] 中÷中
- **W2-5** 抽 `theme.ts` 单一视觉 token + 渲染原语真源(CLI 输出 + hook 注入共享,byte-identical 从"测试守"变"代码守")— [CLI/NS-02] 高÷中
- **W2-6** `cite-policy-evict` 并入 narrow(PreToolUse 单 hook)— [Hook/NS-05] 中÷中
- **W2-7** server instructions 按 AGENT-DIRECT(只 recall)vs SKILL-DRIVEN 分组 — [MCP/NS-03] 中÷低
- **W2-8** `shared` `exports.development` 走 src 免手动 rebuild(根治 rc.21/24/29 复发)— [Arch] 中÷中
- **W2-9** `events.jsonl` 单 guarded 写路径过 schema(消 cjs/TS 双写不一致)— [Arch] 中÷中

### W3 · 大重设计(高价值高成本,先拍板 / 单独 PR)
- **W3-A ★ 拍板** CLI 栈退 Ink → @clack+picocolors 纯函数渲染(依赖 W2-5 theme)— [NS-02] 高÷高
- **W3-B ★ 拍板** 审美北极星落地:"安静的仪表盘"视觉语言 + doctor/install/context-HUD/错误 4 命令 before→after — [NS-02] 高÷高
- **W3-C ★ 拍板·冲突** Skill 拓扑:**8→2 leaf 删 router(NS-04 激进)** vs **8→4+1 留 router(审计保守)** — 见 §三-F1
- **W3-D** doctor 八合一拆分 + `--cite-coverage` 等遥测拆去新 `audit` 组 — [CLI/NS-01] 中÷高
- **W3-E** `store` 命令去同义词(add/create、switch-write/route-write)+ 3 价值轴分组 — [CLI/NS-01] 中÷中
- **W3-F** 命令表 13→9 收敛(MERGE/迁移落地)— [CLI/NS-01] 中÷中
- **W3-G** cjs 由 TS 单源 esbuild bundle(双运行时收敛,依赖 W2-1)— [Arch/NS-06] 中÷高
- **W3-H** scope 三维→1 维可见 + why-not-surfaced 诊断出口 — [Strategy/NS-06] 中÷高
- **W3-I** hook 6→5 + 生命周期一一映射(依赖 W2-6)— [Hook/NS-05] 中÷中

---

## 三、需用户拍板的大决策(taste / 高成本 / 不可逆)

### F1 · Skill 拓扑(内部冲突)
- **激进(NS-04)**:8→**2 leaf(archive/review)+ 删 router**。store/sync 降纯 CLI、import 并入 archive、audit/connect 并入 review。触发词 45→~10。论据:router 无多步链可编 = 空壳抢词。
- **保守(审计)**:8→**4 leaf + 1 router**,router 保留作消歧兜底。
- **推荐**:倾向激进——但 router 删除是单向门,建议**先删 router、保 4 leaf 观察一版**,再决定 4→2。折中路径风险最低。

### F2 · CLI 栈退 Ink(W3-A)
- 论据极硬:Ink 当前是误用(每条消息 fresh React render);hook 是 cjs **永远** require 不了 Ink 组件,纯函数 `theme.ts` 才能让 CLI/hook byte-identical 从测试守变代码守。
- **推荐**:退。但属大迁移,W2-5(抽 theme)是无悔前置,可先做;真正拔 Ink 放 W3 单独 PR。

### F3 · 审美方向(W3-B)
- NS-02 提"安静的仪表盘"(单 cyan + 树形 + 栅格,冷静可信)对打 maestro 的"赛博炫色"。属主观取向,需你认。

---

## 四、方法论备注
- census 先于收窄;每触点先全集再裁决。
- 北极星建立在已验证审计之上;NS-01 grep 纠正了 3 个误判死命令(防破坏性误删)。
- "先杀后修"排序贯穿 backlog,避免对将删之物投入美化。
