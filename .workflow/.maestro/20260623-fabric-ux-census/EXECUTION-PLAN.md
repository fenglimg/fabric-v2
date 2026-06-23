# Fabric UX 北极星 — 执行计划 (EXECUTION-PLAN)

> 收口 `20260623-fabric-ux-census` 全部 proposals → 单一执行真源。
> 分支:`feat/ux-northstar-w0`。同步链:改 `packages/cli/templates/` 真源 → `fabric install --yes` 重生 dogfood 副本。
> 验证纪律:每波 `pnpm -r exec tsc --noEmit` + 相关 vitest;改 shared schema 必 `pnpm --filter @fenglimg/fabric-shared build`;`LEFTHOOK=0 git commit`;逐波 commit。

## A. proposals 索引(13 文件)

| 文件 | 内容 |
|---|---|
| `proposals/00-SYNTHESIS.md` | 审计综合:6 维症状 + 5 跨维根因 + 全局 Top16(诊断层) |
| `proposals/01-cli.md` … `06-architecture.md` | 6 维逐触点审计(census + file:line) |
| `proposals/north-star/NS-00-NORTHSTAR.md` | ★ 北极星综合 + 统一全量 backlog + 锁定决策 |
| `proposals/north-star/NS-01..06.md` | 6 维北极星重设计(存在性/形态·技术栈/审美) |
| `EXECUTION-PLAN.md` | 本文 = 纯执行视角收口 |

## B. 锁定决策(2026-06-23)
1. **Skill**:先删 router 保 4 leaf,观察一版(不一步到 2)。
2. **CLI 栈**:退 Ink 分两步(先抽 theme,再拔 Ink)。
3. **审美**:**鲜明多色**(CLI + Hook 共享 theme;色板用 cjs 纯函数 `ansis`+`gradient-string`,取代 picocolors)。
4. **W0-3 重判**:fabric-hint block→soft 是契约变更,移入 W2 配测试(非 W0 trivia)。

## C. 全量执行 backlog

### 🟢 W0 · 红线 trivia(2 项|分钟级|零结构风险)
| id | 改动 | 文件 | done_when |
|---|---|---|---|
| W0-1 | 删 narrow 退役 MCP 工具 `fab_plan_context` 引用(留 CLI plan-context-hint) | `templates/hooks/knowledge-hint-narrow.cjs` (~1245) | 该行不再含 fab_plan_context;install 同步;hook 自测过 |
| W0-2 | bootstrap `fabric_language`→`~/.fabric/fabric-global.json#language` | `shared/src/templates/bootstrap-canonical.ts:93/161` | 双语行改对;bootstrap canonical/parity test 绿;dogfood AGENTS.md 重生 |
**commit**: `fix(ux-w0): 清退役工具/字段 stale pointer`

### 🟡 W1 · 机械 cheap-high(9 项|改名/文案/删死字段|无结构风险)
| id | 改动 | 主文件 |
|---|---|---|
| W1-1 | `fab_extract_knowledge`→`fab_propose` + 统一 server instructions | `server/src/tools/extract-knowledge.ts` `index.ts` |
| W1-2 | `fab_review` description 内嵌逐-action required 清单 | `server/src/tools/review.ts` |
| W1-3 | broad ALWAYS-ACTIVE summary 套 `hint_summary_max_len` 截断 | `templates/hooks/knowledge-hint-broad.cjs` (~959) |
| W1-4 | grouped-help 从 `allCommands` 派生 + group 标签(修 context 浮空) | `cli/src/lib/grouped-help.ts` `commands/index.ts` |
| W1-5 | 删 config 死字段 `cite_evict_interval`/`reverse_unarchive_*`/`hint_broad_budget_chars` | `shared/src/schemas/fabric-config.ts` |
| W1-6 | 删 deprecated 别名 `whoami`/`status`(info 已取代,零 caller) | `cli/src/commands/index.ts` |
| W1-7 | 3 内部 RPC 加 `__` 前缀隐形(先 grep 确认调用点) | `commands/index.ts` `grouped-help.ts` |
| W1-8 | KILL `cite-contract-reminder` lib(与 C1 矛盾) | `templates/hooks/lib/cite-contract-reminder.cjs` + 引用点 |
| W1-9 | `nudge_mode` 写进 shipped config + 提为总表盘 | `.fabric/fabric-config.json` schema panel |
**commit**: 按"命名(W1-1/2/7)/截断(W1-3)/help(W1-4)/旋钮(W1-5/9)/删除(W1-6/8)"分 ~4 个 commit

### 🟠 W2 · 结构根治(10 项|一次消维护税|含 W0-3)
| id | 改动 |
|---|---|
| W2-1 ★ | 镜像 5→1:4 套 dogfood `.gitignore`+`git rm --cached`,留 `cli/templates/` 真源 |
| W2-2 | doctor `retired-reference` lint(登记表驱动,根治 stale pointer) |
| W2-3 | 旋钮 45→~18(写死 22 skill 阈值 + 6 音量旋钮并入 nudge_mode) |
| W2-4 | `fab_recall` 双数组→单 `entries[]`(read_path 挂条目+score+body_in_context) |
| W2-5 ★ | 抽 `theme.ts` 共享渲染真源(CLI+hook,**鲜明多色 token**) — Ink 退场前置 |
| W2-6 | `cite-policy-evict` 并入 narrow(PreToolUse 单 hook) |
| W2-7 | server instructions 按 AGENT-DIRECT vs SKILL-DRIVEN 分组 |
| W2-8 | shared `exports.development` 走 src 免手动 rebuild(根治 rc.21/24/29) |
| W2-9 | `events.jsonl` 单 guarded 写路径过 schema |
| W0-3↑ | fabric-hint 4 信号 block→soft nudge(契约变更,配 invariant test) |
**commit**: 每项独立 commit(结构改动,便于回滚)

### 🔴 W3 · 大重设计(9 项|高成本|每项单独 grill + PR)
W3-A 退 Ink→ansis 纯函数(依赖 W2-5)｜W3-B 鲜明多色审美落地(4 命令 before→after)｜W3-C 删 router 保 4 leaf｜W3-D doctor 八合一拆分｜W3-E store 去同义词+分组｜W3-F 命令表 13→9｜W3-G cjs TS 单源 esbuild bundle｜W3-H scope 三维→1 维+why-not-surfaced｜W3-I hook 6→5 生命周期映射

## D. 路由建议

| 阶段 | 推荐 slash command | 理由 |
|---|---|---|
| **W0→W2(~21 项)** | **`/goal` 闭环自动全修** | 方向已锁、低/中风险、可逐波 commit 收敛 —— 匹配"全修 by priority 到收敛",对齐你的闭环 doctrine([[goal-mode]]),无需逐项确认 |
| **W3(9 项大重设计)** | **逐项 `/maestro-grill` → 单独 PR** | 跨端契约/审美/迁移大,我们已定每项单独拍板;grill 压测设计后单 PR 落 |

> 备选:若想每波停下 review,用 `maestro-execute` 逐波手动而非 `/goal` 自动。
