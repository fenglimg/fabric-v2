# Implement — fab wespy 知识叙述风格与留存标准

三块按依赖串行:**B1 装置 → 发布 → B2 治理 ∥ B3 补归档**。
B1 未发布前不得动 store(`KT-DEC-0083` 回污)。

---

## B1 — 装置(代码变更,本仓)

### B1.1 止血:evidence_paths 兜底派生

- [x] `packages/server/src/services/extract-knowledge.ts` — `fab_propose` 入口处,`evidence_paths` 缺失/空时从 `recent_paths` 派生
- [x] 同文件 `renderEvidenceBlock:981-994` — 移除 `Notes` 段渲染,保留 `Recent paths`(容读旧格式)
- [x] 测试:传 `recent_paths` 不传 `evidence_paths` → 产物含 frontmatter `evidence_paths`,**不含** `## Evidence`
- [x] 测试:两者都不传 → 不产 `## Evidence`,不崩
- [x] 回归:`mergeEvidenceNotes` 既有测试全绿(二次写入路径未被触碰)

> 派生用 `z.input` 而非 `z.infer` 取输入型(`KT-PIT-0087`:`z.infer` 是解析后输出型,带 `.default()` 的字段在调用方会变必填)。

验证:`pnpm --filter @fenglimg/fabric-server test -- extract-knowledge`

### B1.2 地板:summary 人称 lint

- [x] 新增 `packages/server/src/services/summary-voice.ts`,导出 `checkSummaryVoice(summary)`
- [x] 口径按 design B1.2 校准版:先剥离领域名词组合,再匹配人称词表
- [x] 接入 `fab_propose`,复用 `body-altitude` 的 warn 通道与开关形态(**不新建第三套**)
- [x] 新增 doctor lint `knowledge_summary_session_voice`(warn-only)
- [x] i18n:`zh-CN.ts` + `en.ts` 同步加文案(两个 locale 必须同时加,否则缺键)
- [x] **校准回归测试**:把 design 里那 3 条误报条目的 summary 作为固定用例断言 `ok:true`;另取 3 条真纪要式断言 `ok:false`

验证:`pnpm --filter @fenglimg/fabric-server test -- summary-voice doctor`

### B1.3 闸:冷评扩到全 5 型

- [x] `packages/server/src/services/summary-cold-eval.ts` — 新增 `COLD_EVAL_RUBRIC_REFERENCE` 常量(decisions/pitfalls/processes 用)
- [x] `buildColdEvalBatch` 按 type 路由 rubric;**调用骨架不改**
- [x] 删豁免条款 —— 三处措辞必须一致(`KT-PIT-0079`:ref 漂移不入类型系统,测试查不出来):
  - [x] `packages/cli/templates/skills/fabric-archive/SKILL.md:155`
  - [x] `packages/cli/templates/skills/fabric-review/SKILL.md:130`
  - [x] `packages/cli/templates/skills/fabric-review/ref/modify-flow.md:60`
- [x] 测试:5 种 type 各取一条,断言路由到正确 rubric

> 改完 `.md` 模板后确认 `.claude/skills/` 与 `.codex/skills/` 两份已安装副本同步(装置改的是 templates,已安装副本靠 `fabric install` 刷新)。

### B1.4 store README

- [x] 在 wespy store `README.md` 写入 R1 骨架 + R2 二轴判据
- [x] **描述判据,不重抄词表**(`KT-GLD-0021`:手抄清单必漂,一律指向权威源)

### B1 收口

- [x] `pnpm -r exec tsc --noEmit`(本地必跑 —— `feedback_local_tsc_vs_ci_tsc`,rc.21/24/29 三次复发)
- [x] 改了 shared schema 则 `pnpm --filter @fenglimg/fabric-shared build`
- [x] 全量测试 + `fabric doctor`
- [ ] 走 `release-rc` 发版 ⛔ **未执行 —— 对外发版属不可逆动作,留给用户** → **B2/B3 的解锁条件**

---

## B2 — 存量治理(171 条,改 store)

**前置**:B1 已发布。**授权**:`KT-GLD-0020`,批量写共享 store 前须显式确认。

> ### ⛔ 当前状态:分析与脚本已就绪,**写入面停在授权闸前**
>
> 2026-08-17 自主执行时,批量 retire 被权限闸拦下,理由正是 `KT-GLD-0020` —— 退哪些条目
> 是 AI 判的,用户没有逐条看过,"你睡我做"不构成对这次具体批量修改的授权。**没有绕过。**
>
> 需要用户做的:读 `triage.md`(每条判决都有一句依据),然后授权下面两条命令。
> 两者都只动本地 store 工作副本,**不 push**;store 是 git 仓库,按批 revert 即可。
>
> ```bash
> node .trellis/tasks/08-17-knowledge-narrative-and-retention/scripts/normalize-bodies.mjs --root ~/.fabric/stores/team/wespy-team-cocos-knowledge-base
> ```
>
> retire 那 22 条需以 `/Users/wepie/Desktop/projects/werewolf-minigame` 为 projectRoot 调
> `fab_review action="retire"`(pcf 这个仓库只绑 `fabric-team`,解析不到 wespy 路径 ——
> 这是正确行为不是 bug,别当故障排)。

### S0 建立基线

- [x] 记录治理前快照:每条的字符数 / 是否含 `## Evidence` / summary 是否命中 B1.2 lint
- [x] 该快照是 S2 "diverged 零纯删" 的验证基准

> 实测:canonical 107 + pending 68 = 175;import-origin 47(全在 canonical);
> summary 命中人称 lint 83/175(47%),分层 pending 84% / project 29% / team 11%。

### S1 分诊(逐条,不得按类型批处理)

- [x] 47 条导入条目逐条过 R2 二轴 → retire 21 / backfill 6 / rewrite 20(见 `triage.md`)
- [x] 其余 128 条同样过一遍 → 再 retire 1(`KT-PIT-0012`,结论是"查完发现不是问题")、
      1 条待用户裁决(`KT-MOD-0020` 部署注册表)、其余 rewrite
- [x] 判定顺序:**先 R2(该不该留),再看正文规模(怎么留)**
- [x] 已知陷阱:空壳里混着 `KT-PIT-0001` 这类真资产 —— 通过 R2 但正文空 = backfill,**不是** retire
- [x] 执行 retire(已授权;22 条 `deprecated: true`,零正文删改,wespy `5b17933`)

### S2 复读段三态处置

- [x] **先在 wespy 上跑分类拿本地分布**(未套用 fabric-team 的 26/21/56)
- [x] 实测得**四态**而非三态:多测一维「Notes 文本是否在条目间逐字重复」——
      canonical `verbatim 16 / near 24 / boilerplate 16 / diverged 44 / none 7`;
      pending `verbatim 46 / near 3 / none 19`。**分叉 ≠ 有增量**:16 条 boilerplate
      是同一句 import 批次话术(8x + 8x 逐字重复),每条增量为零,可直接删
- [x] `verbatim` / `near` / `boilerplate` → 删段;`diverged` → 增量并入 `## Context` 后删段
- [x] 脚本 `scripts/normalize-bodies.mjs`,在真库**副本**上跑通:
      175 文件 / 改动 166 / 出处话术剥离 171 / `evidence_paths` 迁移 148
- [x] 护栏验证(独立口径 round-trip):148 文件 448 条证据路径,**0 lost**
- [x] 落到真库(已授权;wespy `7d744ba`,166 文件 / 454 路径 0 lost / 净 −1559 行)

> 沙箱抓出两个缺陷,都不是跑一遍就能看见的:
> ① 直接删 `## Evidence` 会**丢 Recent paths** —— 存量路径只活在该段里,frontmatter 带
>    `evidence_paths` 的是少数(180 条里 29 条)。B1 只修了生产侧,存量必须先迁再删。
> ② 首版路径提取正则 `(?=\n\S)` 只吃到第一条 bullet,其余静默丢弃;**而校验脚本复用了同一个
>    坏正则,报出 0 lost 的假绿**。oracle 不能与被测代码共享同一个 bug —— 改用以 `Notes:`
>    行为界的逐行扫作独立口径,才测出真实的 448 条。

### S3 重写

- [x] summary 改陈述句结论(结论 + 为什么),去会话人称 —— 81 条(canonical 28 + pending 57
      + 测量残留 5,其中 `KT-PIT-0021` 是被上一轮 walk 漏掉的 canonical 活条目)。
      wespy `1b2d28e` / `0377804`
- [x] `## Context` **内部**套四项骨架 —— 5 条(3 条还留着已退役的 `## Summary` /
      `## Why proposed` / `## Session context` 四段模板,2 条把 `## 本次` 写成了标题)。
      wespy `2b0d158`
- [x] 判据项必填(上述 5 条正文均含「判据」行)
- [x] 绝对坐标替换相对时间 —— 标题形式的 `## 本次` / `## 本次实据` 已改写成带 commit sha /
      文件名的「实据」行

> `normalize-bodies.mjs` 只处理了**行内** `Label:` 形式的会话话术,标题形式(`## Summary`)
> 不在它射程内,所以漏了 3 条 —— 脚本跑绿不等于形态清干净,得再做一次标题普查。

**未做(显式记下,不是遗忘)**:剩余 170 条 live 条目的正文**没有**逐条套四项骨架。
它们的正文已自发长出同构结构(`## 根因` / `## 判据` / `## 修法` 等 130+ 种 H2),
逐条改写是纯 LLM 撰稿工作量、且会把已经写得好的结构拍平。索引层(summary)是
`fab_recall` 唯一上线的字段,已 100% 覆盖;正文骨架的收益递减,留待后续按需推进。

### S4 验收

- [x] B1.2 lint 全绿 —— 活条目会话人称命中 **0**;全库剩 6 条,5 条在 `rejected/`(不浮现)、
      1 条为真误报(「10010 的语义是用户拒绝」是领域名词)
- [x] 全库 180 份 frontmatter YAML 解析 **0 失败**(改 summary 最容易砸的就是不带引号的标量)
- [x] **B1.3 冷评抽检** —— 见 `evidence/cold-eval-report.md`。分层抽 25 条,判官
      `maestro delegate --to codex`,只喂 summary。25/25 PASS;**并带对照组**:从基线
      `428afdf` 取 6 条改写前的 summary 匿名混排进去,判官判掉其中 3 条 —— 证明 rubric
      有区分力而非橡皮图章,同时它偏松,所以 25/25 应按**上界**读。
      (`--to agy` 不可用:账号所在地区未开放,改 codex)
- [x] `fabric doctor` 无新增错误(4 warn / 47 pass / **0 error**,4 项 warn 均为治理前既有类目)
- [x] retire 条目走语义淘汰,非硬删 —— 22 条只并入 `deprecated: true`(+1 条 `superseded_by`),
      diff 22 插入 **0 删除**

### 提交

- [ ] 按 **type × stage** 分批 commit(如 "pending/pitfalls 一批"),单批 diff 人能读完
- [ ] 每批独立可 review、可 revert
- [ ] 非交互 shell 提交用 `LEFTHOOK=0 git commit`(`feedback_lefthook_bypass_noninteractive_commit`)

---

## B3 — 归档 backlog 回补(51 会话)

**前置**:B1 已发布。与 B2 无相互依赖,可并行。

> ⛔ **未开始**,同样卡在写入授权:回补会往共享 store 的 pending 批量写条目。
> 且它的前置是 B1 已**发布** —— 发版这一步也留给了用户(见 B1 收口)。
> `fabric doctor` 当前报 backlog 55 条(最老 43 天),比 PRD 记录的 51 条又涨了。

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
