# Implement — fab wespy 知识叙述风格与留存标准

三块按依赖串行:**B1 装置 → 发布 → B2 治理 ∥ B3 补归档**。
B1 未发布前不得动 store(`KT-DEC-0083` 回污)。

---

## B1 — 装置(代码变更,本仓)

### B1.1 止血:evidence_paths 兜底派生

- [ ] `packages/server/src/services/extract-knowledge.ts` — `fab_propose` 入口处,`evidence_paths` 缺失/空时从 `recent_paths` 派生
- [ ] 同文件 `renderEvidenceBlock:981-994` — 移除 `Notes` 段渲染,保留 `Recent paths`(容读旧格式)
- [ ] 测试:传 `recent_paths` 不传 `evidence_paths` → 产物含 frontmatter `evidence_paths`,**不含** `## Evidence`
- [ ] 测试:两者都不传 → 不产 `## Evidence`,不崩
- [ ] 回归:`mergeEvidenceNotes` 既有测试全绿(二次写入路径未被触碰)

> 派生用 `z.input` 而非 `z.infer` 取输入型(`KT-PIT-0087`:`z.infer` 是解析后输出型,带 `.default()` 的字段在调用方会变必填)。

验证:`pnpm --filter @fenglimg/fabric-server test -- extract-knowledge`

### B1.2 地板:summary 人称 lint

- [ ] 新增 `packages/server/src/services/summary-voice.ts`,导出 `checkSummaryVoice(summary)`
- [ ] 口径按 design B1.2 校准版:先剥离领域名词组合,再匹配人称词表
- [ ] 接入 `fab_propose`,复用 `body-altitude` 的 warn 通道与开关形态(**不新建第三套**)
- [ ] 新增 doctor lint `knowledge_summary_session_voice`(warn-only)
- [ ] i18n:`zh-CN.ts` + `en.ts` 同步加文案(两个 locale 必须同时加,否则缺键)
- [ ] **校准回归测试**:把 design 里那 3 条误报条目的 summary 作为固定用例断言 `ok:true`;另取 3 条真纪要式断言 `ok:false`

验证:`pnpm --filter @fenglimg/fabric-server test -- summary-voice doctor`

### B1.3 闸:冷评扩到全 5 型

- [ ] `packages/server/src/services/summary-cold-eval.ts` — 新增 `COLD_EVAL_RUBRIC_REFERENCE` 常量(decisions/pitfalls/processes 用)
- [ ] `buildColdEvalBatch` 按 type 路由 rubric;**调用骨架不改**
- [ ] 删豁免条款 —— 三处措辞必须一致(`KT-PIT-0079`:ref 漂移不入类型系统,测试查不出来):
  - [ ] `packages/cli/templates/skills/fabric-archive/SKILL.md:155`
  - [ ] `packages/cli/templates/skills/fabric-review/SKILL.md:130`
  - [ ] `packages/cli/templates/skills/fabric-review/ref/modify-flow.md:60`
- [ ] 测试:5 种 type 各取一条,断言路由到正确 rubric

> 改完 `.md` 模板后确认 `.claude/skills/` 与 `.codex/skills/` 两份已安装副本同步(装置改的是 templates,已安装副本靠 `fabric install` 刷新)。

### B1.4 store README

- [ ] 在 wespy store `README.md` 写入 R1 骨架 + R2 二轴判据
- [ ] **描述判据,不重抄词表**(`KT-GLD-0021`:手抄清单必漂,一律指向权威源)

### B1 收口

- [ ] `pnpm -r exec tsc --noEmit`(本地必跑 —— `feedback_local_tsc_vs_ci_tsc`,rc.21/24/29 三次复发)
- [ ] 改了 shared schema 则 `pnpm --filter @fenglimg/fabric-shared build`
- [ ] 全量测试 + `fabric doctor`
- [ ] 走 `release-rc` 发版 → **B2/B3 的解锁条件**

---

## B2 — 存量治理(171 条,改 store)

**前置**:B1 已发布。**授权**:`KT-GLD-0020`,批量写共享 store 前须显式确认。

### S0 建立基线

- [ ] 记录治理前快照:每条的字符数 / 是否含 `## Evidence` / summary 是否命中 B1.2 lint
- [ ] 该快照是 S2 "diverged 零纯删" 的验证基准

### S1 分诊(逐条,不得按类型批处理)

- [ ] 47 条导入条目逐条过 R2 二轴,输出 `retire | backfill | rewrite` + 一句依据
- [ ] 其余 124 条同样过一遍(导入只是来源标签,非导入条目同样可能是代码复述)
- [ ] 判定顺序:**先 R2(该不该留),再看正文规模(怎么留)**
- [ ] 已知陷阱:12 条空壳里混着 `KT-PIT-0001` 这类真资产 —— 通过 R2 但正文空 = backfill,**不是** retire

### S2 复读段三态处置

- [ ] **先在 wespy 上跑三态分类拿本地分布**(不得套用 fabric-team 的 26/21/56 —— 那是另一个语料)
- [ ] `verbatim` / `near` → 删段
- [ ] `diverged` → 整段搬入 `## Context` 后删段头
- [ ] 护栏验证:处置前后字符数比对,`diverged` 条目**零净减**(纯删会净减,搬家不会)

### S3 重写

- [ ] summary 改陈述句结论(结论 + 为什么),去会话人称
- [ ] `## Context` **内部**套四项骨架(结论 / 为什么 / 判据 / 何时翻案),**不新增顶层 `##` 段**(`KT-DEC-0077`)
- [ ] 判据项必填
- [ ] 绝对坐标替换相对时间(「本次」「7sp3」「main 分支原行为」→ commit / tag / 日期)

### S4 验收

- [ ] B1.2 lint 全绿
- [ ] **B1.3 冷评抽检** —— 只给 summary、不给正文,判能否据此决定是否读正文;**作者自评不作数**(`KT-GLD-0006`:自评 100% vs 冷评 81%)
- [ ] `fabric doctor` 无新增错误
- [ ] retire 条目走 `fab_review` 语义淘汰,非硬删

### 提交

- [ ] 按 **type × stage** 分批 commit(如 "pending/pitfalls 一批"),单批 diff 人能读完
- [ ] 每批独立可 review、可 revert
- [ ] 非交互 shell 提交用 `LEFTHOOK=0 git commit`(`feedback_lefthook_bypass_noninteractive_commit`)

---

## B3 — 归档 backlog 回补(51 会话)

**前置**:B1 已发布。与 B2 无相互依赖,可并行。

- [ ] 走 `fabric-archive` source mode 回补 51 个会话
- [ ] 产出条目 100% 通过 B1.2 lint + B1.3 冷评
- [ ] **这同时是装置的端到端验证**:若回补产出仍有纪要式 summary → 装置没生效,回 B1
- [ ] 回补后 round-trip 验证:Stop-hook backlog 计数真的下降(`KT-PIT-0005` 同款教训:emit 后必须验消费端计数)

---

## 回滚点

| 位置 | 回滚 |
|---|---|
| B1 任一步 | `git revert`;装置默认 warn 不拒写,误报不阻塞归档 |
| B2 每批 commit 后 | store 是 git 仓库,按批 revert;retire 可恢复 |
| B3 | pending 未审批,`fab_review reject` |

---

## 会话级备忘

- 本会话已关闭 `archive_backlog` 提醒(session-scoped sidecar)。**B3 完成后应解除**,否则后续真 backlog 不再提醒。
- `hint_dismiss_signals` 永久关闭路径有缺陷(文案指 repo 配置,代码读全局 policy 层;`archive_backlog` 不在 zod 枚举内)—— 已记 PRD Out of Scope,另开单。
