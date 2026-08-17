# fab wespy 知识叙述风格与留存标准

## Goal

对 `wespy-team-cocos-knowledge-base` store 的全部 171 条知识(107 canonical + 64 pending)做一次治理:
统一叙述风格,使其对**未参与当时会话的第三方**可读;并按"代码为真源"原则清掉不该存在于 KB 的条目。

产出两样长期资产:
1. **一份叙述模板 + 一份留存判据**(写进 store `README.md`,后续新增条目按此产出/审批)。
2. **一次全量治理的结果**(重写 / 回填 / retire 后的库)。

## 现状盘点(2026-08-17 实测)

| 桶 | 数量 |
|---|---|
| canonical | 107 |
| pending | 64 |
| canonical 中由 docs/git 批量导入(`source_sessions` 含 `fabric-import`) | 47 |

47 条导入条目按正文规模分三簇(度量:剔除 frontmatter、`Imported from` 行、`## Evidence` 段后的非空字符数):

| 簇 | 条数 | 正文规模 | 性质 |
|---|---|---|---|
| 空壳 | 12 | ≤9 字符 | `## Context` 下无内容,仅剩 `src=` 指针。含 `KT-PIT-0001`(预乘 alpha 黑边) |
| 一句话 | 26 | 175–354 字符 | 标题 + 一句摘要 + `src=` 指针 |
| 有肉 | 9 | 493–1169 字符 | 从 git log / 实战导入,内容真实存在 |

## 既有约束(来自 `fabric-team` store,本 task 必须遵守)

Fabric 自身的知识库做过同类治理,已有决策与实测数据。以下每条都直接约束本 task 的方案:

| id | 约束 | 对本 task 的影响 |
|---|---|---|
| `KT-DEC-0077` | canonical body 已刻意收敛为**单段 `## Context`**,理由:Summary 与 Session context 无分工边界(实测 52% 写入归属分叉),消费方把 body 当 opaque blob | **不得新增顶层段**。叙述骨架只能放在 `## Context` **内部** |
| `KT-DEC-0076` | `## Summary` 段的 dedup 用**三态搬家**:verbatim/near 删段,diverged 整段搬入 `## Context`。n=107 实测 verbatim 26 / near 21 / **diverged 56**。MUST NOT 纯删分叉段 | **不得无脑删复读段**。须先做 wespy 侧同类分布实测 |
| `KT-DEC-0083` | 改 canonical 磁盘格式的顺序必须是 ①模板止血 → ②团队升级缓冲 → ③存量 backfill。先清洗后升级会被旧版 CLI **回污** | 本 task 存在**前置阻塞**,见 P6 |
| `KT-GLD-0021` | 判该不该删要**同时**满足两条:信息代码里已有,**且**代码形状直接读得出来。只看第一条会删掉策略语义 | 修正 R2 的 A 轴为合取 |
| `KT-GLD-0006` | summary 自足性必须由**零上下文冷评**把关;作者自评带 curse-of-knowledge(实测自评 100% vs 冷评 81%) | 定义验收方法 |
| `KT-GLD-0020` | 对共享知识库的批量变更,判据层同意 **≠** 执行授权,须先陈述判断与依据再拿明确同意 | 治理执行前须显式授权(Trellis 1.4 闸门承担) |

## 问题定义

### P1 — `summary` 写成会话纪要,导致索引层失效(最高优先级)

`fab_recall` **只投递 `summary`/description,不投递正文**;AI 依据 summary 决定要不要 Read 正文。
因此 summary 写砸 = 该条知识对检索不可见。

实例 `knowledge/pending/decisions/vest-ui-diff-code-over-prefab.md`:

> summary: 我先直接改了 FriendPlayingListItem.prefab 的 _opacity,用户否掉:「…」。此后每次提新的颜色差异都重申…

全段无一字是结论,记的是"谁在何时说了什么"。而其正文首行恰恰是可用结论(「判据:看这个 prefab 是否已经与主干分叉」)。
**结论被埋在正文,索引层放的是流水账。** 这是"别人读了迷惑"的机械成因,非文笔问题。

### P2 — `## Context` 内部无骨架(注意:不是 `## Context` 本身有问题)

初判「`## Context` 是空壳标题应删」**已被 `KT-DEC-0077` 推翻** —— 单段抽屉是刻意设计。
真实问题是抽屉**内部**无组织:条目各写各的,有的直接摊一段,有的自发长出 `## 场景 / ## 踩的坑 / ## 判据`。
自发长出的那套(见 `vest-ui-diff-code-over-prefab`、`cocos-opacity-cascades-to-children`)恰恰是可用骨架,应固化为约定。

### P3 — 时间/人称锚点绑死"当时"

正文含「本次」「7sp3 新增」「main 分支原行为」「用户拍板」「我先改了」。分支合并、版本推进后坐标失效,读者无法还原语境。

### P4 — 大量条目违反"代码为真源"

`KT-MOD-0001~0010`(模块总览 / 数据模型 / 状态机 / UI 层级 / WS 协议)属读代码即得且随代码腐烂;
`KT-PRO-0001` 指向仓库内已存在的 `ANDROID_MIGRATION.md`,KB 仅复制了一个指针;
`KT-PRO-0002/0003`(cpgame publish / progress plan)是一次性项管产物,过期即废。

### P5 — 真资产被做成标题党

`KT-PIT-0001`(预乘 alpha 黑边)结论正确且是团队典范知识,但正文为空:无成因、无判断方法、无「srcBlend 必须配套改」的关联。
**此类不可 retire(会烧掉真资产),亦不可原样保留(不可执行)——须回填正文。**

### P6 — `Notes` 复读段的生产源仍在运行(前置阻塞)

新模板**已经**去掉了 `## Evidence`(`extract-knowledge.ts:934-940`:paths 上移 frontmatter `evidence_paths`)。
但 `renderFreshEntry:947-953` 保留了一条**向后兼容回退分支**——当调用方**没传** `evidence_paths` 却传了 `recent_paths` 时,仍渲染 legacy `## Evidence`,其中 `renderEvidenceBlock:981-994` 把 `summary` 逐字写进 `Notes`:

```ts
if ((args.evidencePaths === undefined || args.evidencePaths.length === 0) &&
    args.recentPaths !== undefined && args.recentPaths.length > 0) {
  bodyParts.push("", "## Evidence", "", renderEvidenceBlock(args.summary, args.recentPaths));
}
```

`evidence_paths` 是可选字段,且其填写指引(Step 6)藏在 `fabric-archive/ref/phase-3-review.md:164-167` —— **隔一跳 ref**。

**实测(wespy 180 条,二分完全干净、无中间态):**

| | `## Evidence` body 段 | 条数 |
|---|---|---|
| 无 `evidence_paths` frontmatter | 有 | **151** |
| 有 `evidence_paths` frontmatter | 无 | 29 |

即 **84% 的归档走了回退分支**。所以 Notes 复读不是"模板没改",而是**新路径可选 + 指引隔一跳 → 实际几乎总是回退到旧形状**。

修法因此不是删 `renderEvidenceBlock`,而是**让服务端在 `evidence_paths` 缺失时从 `recent_paths` 兜底派生**,使回退分支不再被触发(附带把 Notes 渲染一并去掉)。依赖 skill 记得做 Step 6 的方案已被 84% 的实测否决。

按 `KT-DEC-0083`,在此止血之前做存量清洗 = 边洗边被回污。

注:合并路径(`mergeEvidenceNotes:1125-1129`)**已经**在收敛——二次写入会 strip 掉 body 的 `## Evidence` 并把 paths 上移 frontmatter,但 `notes` 被采集后从不写回。故本缺陷只发生在**首次写入且未传 `evidence_paths`** 的条目上。

注:`doctor-body-dedup.ts` 已实现,但它处理的是旧 4 段模板的 `## Summary` 段(`KT-DEC-0076` 那条路径),与本条的 `Notes` 复读是**两个不同的复读源**,不可混为一谈。

### P7 — 叙述风格对 3/5 的类型没有任何执行装置(根因)

归档链路(`fabric-archive` skill → `fab_propose` → pending → `fabric-review` → canonical)上,风格能生效的落点有三个:

| # | 落点 | 实现位置 | 现状 | 覆盖类型 |
|---|---|---|---|---|
| 1 | 写入端 authoring standard | `fabric-archive/SKILL.md:155` | 已实现 | **仅 guidelines / models** |
| 2 | 写入端机器检测 | `packages/server/src/services/body-altitude.ts` | 已实现,默认 warn 不拦 | 只查 **body** 的 transcript 形状,**不查 summary** |
| 3 | 审核端零上下文冷评 | `packages/server/src/services/summary-cold-eval.ts` + `fabric-review/SKILL.md:130-134` | 已完整实现 | **仅 guidelines / models** |

**decisions / pitfalls / processes 在写入端与审核端两头都被明文豁免。** 豁免理由(SKILL.md:155):

> decision/pitfall/process summaries are exempt (they surface as `must_read_if` triggers, deliberately pointers)

该理由不成立,两点:
- `must_read_if` 是**可选字段**(Phase 4 明确 "omit rather than guess"),缺失时 summary 是该条目唯一的索引。
- 即便填了,`fab_recall` 返回的 `entries[]` 中 `description.summary` 始终在场,是 AI 判断"要不要 Read 正文"的主依据。

**实测佐证**(wespy store,summary 命中会话人称 `用户|我先|我把|本次|此后|拍板|逐字确认|要求我|否掉|重申` 判为纪要式;**已剔除 47 条机器导入条目**以排除"机器摘要天然无人称"的混淆):

|  | 冷评覆盖类型 | 冷评豁免类型 |
|---|---|---|
| canonical(审过) | 19 条中 6 条 = **32%** | 41 条中 22 条 = **54%** |
| pending(未审) | 18 条中 14 条 = **78%** | 50 条中 44 条 = **88%** |

两个效应均成立:**审核环节把纪要式从 85% 压到 47%**;**冷评覆盖的类型再好约 20pt**。
分类型看,`decisions` 单类 **70%** 为纪要式 —— 最该长期留存的类型,索引质量最差。

结论:P1 不是个别作者的文笔问题,是**制度性缺口**。不补装置,治理完的库会在下一批归档里重新退化。

## Requirements

### R1 叙述骨架(放在 `## Context` 内部,不新增顶层段)

```
summary: <一句陈述句结论> + <一句为什么>     # 禁止出现「用户」「我」「本次」
---
## Context

**结论** —— 这类情况下,做 Y,不做 X
**为什么** —— X 的代价是什么(具体、可验证)
**判据** —— 什么条件下适用 / 什么条件下反过来
**何时翻案** —— 什么变了这条就该退休
```

- **判据**项为必填。该结构在现有条目中已自发出现,本 task 将其固化。
- 判据项同时是"当时的判断/取舍品味"的存放位(例:「prefab 冲突面 vs 代码冲突面,宁可代码丑一点」),这类内容比其涉及的任何具体实现活得更久。
- 正文禁用相对时间与会话人称;指代分支/版本时写绝对坐标(commit / tag / 日期)。

### R2 留存判据(A 为合取,任一轴判"不留"即不留)

| 轴 | 判"不留"的条件 |
|---|---|
| **A(代码为真源)** | 信息代码里已有 **且** 代码形状直接读得出来 —— 两条**同时**成立才算"代码能回答" |
| **B(腐烂速度)** | 变更快,知识必然落后于代码 |

A 轴取合取的理由(`KT-GLD-0021`):只看"代码里有没有"会删掉**代码形状读不出来的策略语义**(如"默认跳过""永不删"这类散在 guard 与条件分支里的规则)。
反向同样成立:手抄清单(命令表 / 阶段表 / 字段表)无一例外会漂,一律改为指向权威源。

据此:
- **团队强制规范**留 —— 代码只有"结果"没有"必须这样"的强制力,且规范稳定。
- **架构/业务决策**留 —— 代码只有 Y、没有"为什么不是 X",且决策稳定。
- **反直觉坑**留 —— 代码看不见"为什么不能那么写",试错成本高。
- **模块总览 / 数据模型字段 / 协议格式 / 一次性项管计划**不留。

### R3 三分诊(取代早前"整批 retire"方案)

| 动作 | 适用 | 说明 |
|---|---|---|
| **retire** | 未通过 R2 | 走 `fab_review` retire 语义淘汰,非硬删 |
| **backfill** | 通过 R2 但正文为空壳/一句话 | 从源 docs / 现状代码回填正文,再按 R1 重写 |
| **rewrite** | 通过 R2 且正文有肉 | 仅按 R1 重排结构与 summary |

判决须逐条对照正文与现状代码作出,**不得按文件名批量推断**。

### R4 复读段处置(不得无脑删)

先对 wespy 171 条做 `KT-DEC-0076` 同款三态分类(verbatim / near / diverged),拿到分布后再定处置:
verbatim / near 删段;diverged 整段搬入 `## Context` 后删段头。**MUST NOT** 纯删分叉段(会丢增量叙事)。

### R5 覆盖范围

- canonical 107 条**全部**按 R1 重写(已确认决定)。
- pending 64 条按 R1 重写后再走审批;正文质量普遍优于 canonical,主要问题在 summary 与结构。

### R6 执行装置(两层防御,解 P7)

沿用 `KT-GLD-0006` 已确立的分工——**机械 lint 做写入期地板,零上下文冷评做真 gate**——把两层都补到当前缺失的三个类型上。

**R6.1 地板:确定性 summary lint(无 LLM)**
在 `fab_propose` 落盘前检查 summary 是否含会话人称(`用户 / 我 / 本次 / 此后 / 拍板 / 逐字确认 / 否掉 / 重申`),命中即发 warn。
- 复用 `body-altitude.ts` 既有的 warn 机制与开关形态(默认 warn + 环境变量可升级为拒写),**不新建第三套告警通道**。
- 定位明确:拦不住"通顺但只是指针"的伪自足(那需要冷评),只负责拦掉最粗暴的那批。按实测,豁免类型 59% 的纪要式中,人称命中即其判定依据。
- 同一检测落一条 `doctor` lint,用于存量体检。

**R6.2 闸:冷评扩到全 5 型,分 rubric**
复用现成的 `summary-cold-eval.ts#buildColdEvalBatch`,**只新增一套 rubric 常量**,不改调用骨架。
- guidelines / models 沿用现行 `COLD_EVAL_RUBRIC`(判"是不是可直接执行的规则")。
- decisions / pitfalls / processes 用新 rubric,判据改为:**"是不是结论 + 为什么的陈述句,读完能决定要不要打开正文"** —— 不要求它是可执行规则(那是 guideline 才有的形态)。
- 相应删除 `fabric-archive/SKILL.md:155` 与 `fabric-review/SKILL.md:130` 的豁免条款,改为分型标准。

**R6.3 装置先于治理**
R6 必须在存量治理(R1–R5)之前落地并发布。否则:治理产出的新标准没有执行装置,下一批归档立即重新退化;且按 `KT-DEC-0083`,旧版 CLI 会持续回污。

## 交付分块(按依赖顺序)

| 块 | 内容 | 依赖 |
|---|---|---|
| **B1 装置** | P6 模板止血(`renderEvidenceBlock`)+ R6.1 地板 + R6.2 冷评扩型 + store `README.md` 写入 R1/R2 | 无 |
| **B2 治理** | wespy 171 条按 R3 三分诊 + R4 复读段三态处置 + R1 重写 | B1 已发布 |
| **B3 补归档** | 51 个会话的归档 backlog 回补 | B1 已发布(否则灌入同病新条目) |

B3 与 B2 无相互依赖,可并行;但两者都**必须**在 B1 之后。

## Constraints

- **执行顺序(`KT-DEC-0083`)**:模板止血 → 团队升级缓冲 → 存量 backfill。P6 未解决前不得开始存量清洗。
- **授权(`KT-GLD-0020`)**:本 PRD 提供判据,不构成对共享 store 批量写入的执行授权;执行前须显式取得同意。
- store 是团队远端库(`git.17zjh.com/wepie-cocos/components/wespy-team-cocos-knowledge-base`),改动会推给团队 → 分批提交,每批可独立 review。
- 不手编 `.fabric/agents.meta.json`;pending 的 approve/reject/retire 走 `fab_review` / `fabric-review` skill。
- retire 不等于硬删,保留可追溯性。
- 全局 `fabric` CLI 跑的是 published 代码,验证走本地源码路径(`project_global_fabric_cli_shadows_local_source`)。

## Acceptance Criteria

### B1 装置

- [ ] P6 前置阻塞已解除:`renderEvidenceBlock` 不再复读 summary,且变更已随 CLI 版本发布
- [ ] R6.1 summary 人称 lint 在 `fab_propose` 生效,并有对应 doctor lint;复用 `body-altitude` 告警通道,未新建第三套
- [ ] R6.2 冷评覆盖全 5 型,decisions/pitfalls/processes 走新 rubric;两处豁免条款(`fabric-archive/SKILL.md:155`、`fabric-review/SKILL.md:130`)已删除
- [ ] 用现存的纪要式 summary 做回归样本:R6.1 对人称命中项报 warn,R6.2 对其判 `self_sufficient=false`

### B2 治理
- [ ] store `README.md` 内含 R1 骨架与 R2 判据,新增条目有据可依
- [ ] 47 条导入条目 100% 有明确判决(retire / backfill / rewrite),每条判决附一句依据
- [ ] 空壳簇(12 条)无一条以"空壳"状态留在 canonical
- [ ] 全部保留条目的 `summary` 为陈述句结论,不含「用户」「我」「本次」等会话人称
- [ ] 复读段处置按 R4 三态执行,`diverged` 段无一条被纯删(可用处置前后字符数比对验证)
- [ ] 全部保留条目含非空**判据**项
- [ ] **summary 自足性由零上下文冷评抽检**(`KT-GLD-0006`):抽样条目仅给 summary、不给正文,判"能否据此决定要不要读正文";作者自评不作数
- [ ] `fabric doctor` 在治理后无新增 lint 错误
- [ ] 改动分批 commit 并推送到 store 远端

### B3 补归档

- [ ] 51 个会话的 backlog 在 B1 发布后回补,产出的新条目 100% 通过 R6.1 + R6.2

## Out of Scope

- 把命名/类型/禁用语法规则转写为 eslint 规则(用户判定这类属"团队强制要求的规范",留在 KB;转 lint 是独立议题)。
- 其他两个 store(`personal`、`fabric-team`)的治理。
- `doctor-body-dedup.ts` 既有 `## Summary` 段路径的改动(那是 `KT-DEC-0076` 已落地的另一条路径)。
- **`hint_dismiss_signals` 永久关闭路径的缺陷**:nudge 文案指向 repo `.fabric/fabric-config.json`,而 `session-signal-state.cjs:71-76` 实际读的是**全局** policy 层(`readPolicy()`);且 `archive_backlog` 在 hook 的 `DISMISSABLE_SIGNALS` 里但**不在** `fabric-config.ts` 的 zod 枚举里。按文案操作是 no-op。已另行记录,不在本 task 内修。
