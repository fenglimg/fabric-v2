# B2 S1 三分诊判决记录

判决逐条对照正文与 summary 作出,**不按文件名批量推断**(R3 约束)。
判据 = PRD R2 两轴:A「代码为真源」取合取(信息代码里有 **且** 代码形状直接读得出来,两条同时成立才算代码能回答)、B「腐烂速度」。

动作三选一:`retire`(语义淘汰,原地 deprecate,不硬删)/ `backfill`(过 R2 但正文是空壳,回填后再按 R1 重写)/ `rewrite`(过 R2 且正文有肉,仅重排结构与 summary)。

---

## 语料实测(2026-08-17)

| 面 | 数 |
|---|---|
| canonical | 107(team 28 + project:werewolf-minigame 79) |
| pending | 68 |
| 其中 import-origin(`source_sessions` 含 `fabric-import-`) | canonical 47 / pending 0 |
| summary 命中会话人称 lint | 83 / 175(47%) |
| ——按层 | pending 57/68(84%)、project 23/79(29%)、team 3/28(11%) |

**Notes 复读段四态**(R4 要求先量分布再定处置;在 `KT-DEC-0076` 的三态上多测了一维「Notes 文本是否在条目间重复」):

| 态 | canonical | pending | 处置 |
|---|---|---|---|
| `verbatim`(与 summary 规范化后全等) | 16 | 46 | 删段 |
| `near`(互为子串或双字组 Jaccard ≥0.6) | 24 | 3 | 删段 |
| `boilerplate`(与 summary 分叉,但文本在多条间**逐字重复**) | 16 | 0 | 删段 |
| `diverged`(真增量) | 44 | 0 | 增量并入 `## Context` 后删段头 |
| `none` | 7 | 19 | 无 |

`boilerplate` 是本轮新加的一维,也是本轮最重要的测量修正:光看"与 summary 分叉"会把 16 条判成有增量,但它们的 Notes 是同一句 import 批次出处话术,逐字重复(`8x 用户提交 Cocos 组全局编码规范文档…`、`8x 用户显式请求 fabric-import 挖掘知识…`),**每条的增量为零**。分叉 ≠ 有增量。

`diverged` 里还有一类不是"正文有额外信息",而是 **summary 被截断、Notes 才是全文**(KT-GLD-0002 / KT-PIT-0016 / KT-PRO-0005 / KT-DEC-0003 / KT-DEC-0004 等)。这类的修法就是按 R1 重写 summary 本身,增量自然回到条目里。

---

## Group A — 47 条 import-origin 判决

### retire(21)

代码/文档为真源,或一次性计划。全部走语义淘汰而非硬删。

| 条目 | 理由 |
|---|---|
| `P/guidelines/KT-GLD-0003` voice-room-component-extension-spec | 正文即"见 docs/voice-room-extension/spec-component-extensions.md",无 doc 之外的增量 |
| `P/guidelines/KT-GLD-0004` voice-room-extension-navigation | 七个 spec 的目录导航;手抄清单必漂,应指向权威源 |
| `P/guidelines/KT-GLD-0005` voice-room-feature-plugin-spec | 同 0003,doc 镜像 |
| `P/guidelines/KT-GLD-0006` voice-room-view-spec | 同上 |
| `P/guidelines/KT-GLD-0007` voice-room-viewmodel-spec | 同上 |
| `P/guidelines/KT-GLD-0008` wolfgame-key-implementation-patterns | 描述的是代码现状形态(单例 Manager 怎么注册),读代码即得 |
| `P/models/KT-MOD-0001` game-center-module-overview | 模块总览 —— R2 明确不留 |
| `P/models/KT-MOD-0002` voice-room-data-model-spec | 数据模型字段 —— R2 明确不留 |
| `P/models/KT-MOD-0003` voice-room-music-widget-design | 128KB 需求文档的摘要;需求已落地,腐烂快 |
| `P/models/KT-MOD-0004` voice-room-seat-system-spec | 继承结构总览,读代码即得 |
| `P/models/KT-MOD-0005` wolfgame-audio-animation-system | 音效映射现状,代码形状直接读得出 |
| `P/models/KT-MOD-0006` wolfgame-data-models | 字段表 —— R2 明确不留 |
| `P/models/KT-MOD-0007` wolfgame-mvvm-mobx-architecture | 是架构**总览**(分了哪五层),不是架构**决策**(为什么不是别的分法);后者才是长期资产 |
| `P/models/KT-MOD-0008` wolfgame-phase-state-machine | 状态码表(None=0…Over=5),等价字段表,且随玩法改 |
| `P/models/KT-MOD-0009` wolfgame-ui-layer-system | 分层结构总览 |
| `P/models/KT-MOD-0010` wolfgame-ws-frame-protocol | 协议格式 —— R2 明确不留 |
| `P/processes/KT-PRO-0002` cpgame-lover-publish-plan | 一次性项管计划 |
| `P/processes/KT-PRO-0003` cpgame-progress-status-plan | 一次性项管计划 |
| `P/processes/KT-PRO-0004` spy-game-migration-guide | 已完成的一次性迁移;其中仍成立的原则(共用基建保留、玩法私有字段下沉)已由 `KT-DEC-0003` 承载 → superseded_by |
| `P/processes/KT-PRO-0006` voice-room-workflows-spec | doc 镜像 |
| `processes/KT-PRO-0001` android-platform-migration-guide | 正文只有 "Imported from docs. Origin: ANDROID_MIGRATION.md",指针而非知识;迁移本身一次性 |

### backfill(6)

过 R2(是真坑 / 真决策),但正文是一句 `Imported from git log. Origin: commit xxx` 的空壳,需从该 commit 与现状代码回填后再按 R1 重写。

| 条目 | 现有正文 | 回填源 |
|---|---|---|
| `pitfalls/KT-PIT-0001` atlas-premultiply-alpha-black-edge | 105 字空壳 | commit b713d74f + 与 `KT-GLD-0019`(正向配置规范)互补 |
| `pitfalls/KT-PIT-0004` im-richtext-trailing-newline | 76 字空壳 | commit 3b959b87 |
| `pitfalls/KT-PIT-0005` listpro-reset-on-data-change | 79 字空壳 | commit 4c1b6ad5 |
| `P/decisions/KT-DEC-0001` friend-invite-spy-room-display | 85 字空壳 | commit 749b15fa |
| `P/decisions/KT-DEC-0005` share-card-rid-length-routing | 100 字空壳 | commit 80d1a7dd |
| `P/decisions/KT-DEC-0006` spy-share-template-id-config | 103 字空壳 | commit de4df22a |

### rewrite(20)

过 R2 且正文有肉,只按 R1 重排结构 + 重写 summary。

`guidelines/KT-GLD-0002`、`pitfalls/KT-PIT-0023`、`KT-PIT-0024`、`KT-PIT-0025`、`KT-PIT-0033`、
`processes/KT-PRO-0005`、`P/decisions/KT-DEC-0002`、`KT-DEC-0003`、`KT-DEC-0004`、`KT-DEC-0011`、`KT-DEC-0012`、
`P/guidelines/KT-GLD-0001`、`P/pitfalls/KT-PIT-0002`、`KT-PIT-0003`、`KT-PIT-0006`、`KT-PIT-0007`、`KT-PIT-0008`、`KT-PIT-0028`、
`P/processes/KT-PRO-0011`、`KT-PRO-0012`

---

## Group B — 60 条 canonical 非-import 判决

这批是真会话归档,正文普遍有肉。逐条核对后 **58 条 rewrite**(过 R2,只需按 R1 重排结构 + 重写 summary),另 2 条单拎:

| 条目 | 动作 | 理由 |
|---|---|---|
| `P/pitfalls/KT-PIT-0012` remote-bundle-new-common-api-cache-order | **retire** | 结论是"后确认**可能**是开发缓存导致,小游戏线上通常同批包不会出现" —— 即这条的落点是「查了一圈发现不是问题」。没有可复用的判据,留着只会让下一个人以为有坑 |
| `models/KT-MOD-0020` wespy-minigame-deploy-registry | **待用户裁决** | 3219 字的部署注册表(项目名/平台/game_type/game_id/git/分支/jenkins)。R2 明确"手抄清单无一例外会漂,一律改为指向权威源",但这张表的权威源是会玩配置中心 + 各仓 CI,团队可能确实没有第二个合并视图。**我不单方面退它** —— 要么退+在 README 指向配置中心,要么保留但标注"以配置中心为准"。请裁决 |

其余 58 条按 R2 全部留下,分布是团队强制规范(`KT-GLD-0014`~`0020` Cocos 组编码规范、`KT-PRO-0015`/`0016`/`0017` 分支与发版流程)、架构与业务决策(`KT-DEC-0008`~`0019`)、反直觉坑(`KT-PIT-0009`~`0038`)三类 —— 正是用户指定的三类长期资产。

其中 `P/models/KT-MOD-0017`/`0018` 看起来像"数据模型字段"(R2 不留),但实际编码的是**判定语义**(如 `DEAD_CURRENT` 本轮被票死者投票时仍算有投票权,未投即弃票)。这类规则散在 guard 与条件分支里,代码形状读不出来 —— A 轴取合取的意义正在这里,判**留**。

## Group C — 68 条 pending 判决

pending 全部是近期真会话产出,正文质量普遍优于 canonical,**无一条判 retire**。问题集中在 summary:57/68(84%)命中会话人称 lint,是全语料最差的一层 —— 也印证 R6.3「装置必须先于治理」(这批正是在装置缺位期间写的)。

动作:全部 rewrite(仅 summary + 结构),然后照常走审批。

---

## 汇总

| 动作 | canonical | pending | 合计 |
|---|---|---|---|
| retire | 22(import 21 + `KT-PIT-0012`) | 0 | 22 |
| backfill | 6 | 0 | 6 |
| rewrite | 78 | 68 | 146 |
| 待用户裁决 | 1(`KT-MOD-0020`) | 0 | 1 |

---

## 早前"整批 retire 47 条"方案为什么被推翻

任务开头把这 47 条概括为"基本是代码/文档复述"并给了整批 retire 选项。逐条读完正文后这个概括不成立:同一批里既有纯 doc 镜像(该退),也有 `KT-PIT-0001`(预乘 alpha 黑边)这种本项目自己的看家坑、`KT-DEC-0002/0003/0004` 这组 GameCenter 收口决策。按文件来源批量下判决,正是 R3 明令禁止的"按文件名批量推断"。

改为三分诊后,retire 21 / backfill 6 / rewrite 20 —— 淘汰面从 100% 收到 45%。
