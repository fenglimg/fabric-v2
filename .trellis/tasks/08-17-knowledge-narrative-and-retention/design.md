# Design — fab wespy 知识叙述风格与留存标准

## 设计立场

治理存量是一次性的;**装置**才是长期资产。因此本设计的重心在 B1:让"结论前置的 summary"和"代码为真源的取舍"在**生成的那一刻**被约束,而不是写在 README 里等人自觉。

三块的依赖关系是硬的:B1 未发布前做 B2/B3,产出会被旧路径持续污染(`KT-DEC-0083`)。

---

## B1 — 装置

### B1.1 止血:让回退分支不再被触发

**现状**(实测 151/180 = 84% 走回退):

```
fab_propose(input)
  └─ renderFreshEntry(args)
       ├─ evidence_paths 有 → frontmatter evidence_paths: [...]        ← 新形状(29 条)
       └─ evidence_paths 无 && recent_paths 有
            → body "## Evidence" + renderEvidenceBlock(summary, paths)  ← 回退(151 条)
                 └─ "Notes:\n\n- <summary 逐字>"
```

**根因不是模板没改,是新路径可选 + 指引隔一跳**(`fabric-archive/ref/phase-3-review.md:164-167` Step 6)。
依赖 skill 记得填的方案已被 84% 实测否决 —— 修在服务端。

**改法(服务端兜底派生)**:

`extract-knowledge.ts` 的 `fab_propose` 入口处,`evidence_paths` 缺失或为空时,从 `recent_paths` 派生:

```
evidencePaths = input.evidence_paths?.length ? input.evidence_paths : input.recent_paths
```

派生后回退分支的条件 `evidencePaths.length === 0` 自然不成立,`## Evidence` 不再产出。

**为什么这样切**:
- 与 `mergeEvidenceNotes:1125-1129` 已有的收敛方向一致 —— 合并路径早就 strip `## Evidence` 并上移 paths。本改动只是让**首次写入**产出合并路径最终会收敛到的形状,消除 fresh/merge 的形状漂移。
- `notes` 在 merge 路径里被 `collectEvidenceItems` 采集后**从不写回**,说明"Notes 承载信息"这一假设在现行代码里已不成立。

**保留回退分支本身**:`renderEvidenceBlock` 不删除,仅移除其 `Notes` 段渲染。理由是容读旧格式(`KT-DEC-0076` "容读双格式、只写新格式")。

**兼容性**:纯写入侧变更,不触碰任何已落盘条目。旧条目由 B2 处置。

### B1.2 地板:确定性 summary lint

**位置**:`packages/server/src/services/` 新增模块,与 `body-altitude.ts` 平级并复用其告警形态。

**契约**:

```
checkSummaryVoice(summary: string)
  → { ok: true }
  | { ok: false; code: "summary_session_voice"; detail: string }
```

- 命中词表:`用户 / 我先 / 我把 / 本次 / 此后 / 拍板 / 逐字确认 / 要求我 / 否掉 / 重申`(英文对应 `the user / I first / this time / …`)。
- 默认 **warn + 仍写入**,与 `body_altitude_dump` 同档;环境变量/config 可升级为拒写(沿用 `FABRIC_ALTITUDE_PROPOSE_GATE` 同款开关形态,**不新建第三套通道**)。
- 同一函数复用为一条 `doctor` lint(`knowledge_summary_session_voice`),warn-only,用于存量体检。

**边界(明确不做什么)**:此 lint **不判断语义自足性**。"通顺但只是指针"的伪自足由 B1.3 的冷评负责(`KT-GLD-0006`:机械 lint 只能做写入期地板)。
它的全部职责是拦掉最粗暴的那批 —— 按实测,豁免类型 59% 的纪要式正是以人称命中为判据识别出来的。

**口径校准(`KT-GLD-0022`:静态门禁不得用预设口径直接上线)**

朴素词表在 wespy 语料上实测 **93 命中 / 3 误报(3.2%)**,误报全部来自**领域名词**而非会话人称:

| 误报条目 | 命中原因 |
|---|---|
| `KT-PIT-0008` | 「**用户信息**弹窗:renderUser 写入的 total/win_rate 会与…冲突」 |
| `KT-PIT-0007` | 「…需要单独取**用户信息**;退房后聊天状态残留会污染下一局」 |
| `KT-GLD-0020` | 「Cocos **用户头像**显示:头像可能是 gif 动图,须用 ImageComponent」 |

三条都是**写得正确的陈述句 summary** —— 正是 lint 最不该碰的目标。

校准后口径:先剥离领域名词组合(`用户` + `头像|信息|昵称|等级|数据|列表|画像|体验|态|名|反馈|ID`),再匹配人称词表。
英文侧不匹配裸词 `user`(领域文本里 "user avatar" 遍地),改匹配**短语**(`the user asked/requested/rejected…`、`I first tried…`)。

**校准后实测**(用落地实现 `summary-voice.ts` 直接跑 wespy 全语料,非重写副本):
命中 **83 / 175 = 47%**;其中只命中单一标记 `用户` 的 69 条逐条目视,**无残余误报** —— 全部形如「用户要求…」「用户指出…」「用户先提出…」,正是目标失败模式。

**上线前置**:该词表必须在目标 store 语料上跑到误报可接受再启用,不得直接上线;新增 store 时重跑校准。

**词表的已知局限**:正则对改写规避无效(把"用户要求"写成"需求方要求"即绕过)。这是**地板**不是 gate,接受该局限;真 gate 在 B1.3。

### B1.3 闸:冷评扩到全 5 型,分 rubric

**复用**:`summary-cold-eval.ts#buildColdEvalBatch` 调用骨架**不改**,只新增一套 rubric 常量。

| 类型 | rubric | 判据 |
|---|---|---|
| guidelines / models | 现行 `COLD_EVAL_RUBRIC` | summary 是否是**可直接执行的规则**(它们在 SessionStart ALWAYS-ACTIVE 槽里是无正文的单行索引) |
| decisions / pitfalls / processes | **新增** `COLD_EVAL_RUBRIC_REFERENCE` | summary 是否是**结论 + 为什么的陈述句,读完能决定要不要打开正文** |

**为什么分 rubric 而不是统一**:decisions/pitfalls 的浮现形态确实与 guidelines 不同(前者是 `must_read_if` 触发的参考,后者是常驻规则)。用 guideline 的"可执行规则"标准去要求 decision 会产生大量假失败。豁免的**方向**错了,但它观察到的**差异**是真的 —— 所以是换判据,不是抹平。

**同步删除两处豁免条款**:
- `packages/cli/templates/skills/fabric-archive/SKILL.md:155`
- `packages/cli/templates/skills/fabric-review/SKILL.md:130` 及 `ref/modify-flow.md:60`

改为分型标准表述。三处措辞必须一致(`KT-PIT-0079`:ref 漂移不进类型系统,typecheck 与测试都查不出来)。

**成本控制**:冷评走 `maestro delegate` 离线批处理,不在热路径。扩到全 5 型后候选量约翻 3 倍 —— 按批处理,单批上限沿用现行配置。

### B1.4 store README 写入 R1 骨架 + R2 判据

装置管新增,README 管人读。两者内容必须一致,README 是装置的**说明**而非**副本**——描述判据与骨架,不重抄词表(`KT-GLD-0021`:手抄清单无一例外会漂,一律改指权威源)。

---

## B2 — 存量治理

### 数据流

```
171 条 (107 canonical + 64 pending)
  │
  ├─[S1 分诊]  逐条过 R2 二轴 → retire / backfill / rewrite
  │              A 轴为合取:代码里有 ∧ 代码形状读得出来
  │
  ├─[S2 复读段三态]  verbatim / near / diverged  (KT-DEC-0076 规则)
  │              verbatim·near → 删段;diverged → 整段搬入 ## Context 再删段头
  │
  ├─[S3 重写]  summary 改陈述句结论;## Context 内部套 R1 四项骨架
  │
  └─[S4 验收]  R6.1 lint 全绿 + R6.2 冷评抽检 + fabric doctor
```

### S1 分诊的判定顺序

先判 R2(该不该留),再判正文规模(怎么留)。反过来会把"正文很长但属于代码复述"的条目误留。

| R2 结论 | 正文规模 | 动作 |
|---|---|---|
| 不留 | — | **retire** |
| 留 | 空壳 / 一句话(≤354 字符) | **backfill** |
| 留 | 有肉(≥493 字符) | **rewrite** |

**已知需要逐条判、不得按类型批处理的**:`pitfalls` 整体通过 R2,但导入的 12 条空壳里混着 `KT-PIT-0001` 这类真资产 —— 它们**通过** R2 却**正文为空**,属 backfill 不属 retire。这正是"整批 retire"方案被否的原因。

### S2 的风险与护栏

`KT-DEC-0076` 的 n=107 实测是在 **fabric-team store** 上做的(verbatim 26 / near 21 / diverged 56)。**wespy 的分布未测**,不得直接套用比例。
S2 第一步是在 wespy 上跑同款三态分类拿到本地分布,再按规则处置。

护栏:`diverged` 段**零纯删**。验证方法为处置前后字符数比对 —— 纯删会使字符数净减,搬家不会。

### S3 的骨架落点(不新增顶层段)

`KT-DEC-0077` 已裁定 canonical body 收敛为单段 `## Context`,理由是"两个无分工的段"造成 52% 写入归属分叉。
本设计的四项骨架(结论 / 为什么 / 判据 / 何时翻案)**放在 `## Context` 内部**作为粗体行首,不产生新的顶层 `##` 段。

对 `KT-DEC-0077` 的适配性核对:该决策否决的是**无分工边界**的段(Summary vs Session context 语义重叠)。四项骨架分工明确且互斥,不落在其 rationale 覆盖范围内。且现有条目已自发长出同构结构(`vest-ui-diff-code-over-prefab`、`cocos-opacity-cascades-to-children`),属固化既成实践而非引入新形态。

### 分批边界

store 是团队远端库,改动会推给团队。按 **type × stage** 分批(如"pending/pitfalls 一批"),每批独立可 review、独立可回滚。
单批规模上限:一次 commit 的 diff 能被人读完。

---

## B3 — 归档 backlog 回补

51 个会话,在 B1 发布后执行。执行时 B1.1/B1.2/B1.3 全部在线,产出条目直接符合新标准 —— 这同时是**装置的端到端验证**:若回补产出仍有纪要式 summary,说明装置没生效,回到 B1。

---

## 回滚

| 块 | 回滚方式 |
|---|---|
| B1 | 代码变更,`git revert`;装置默认 warn 不拒写,即使误报也不阻塞归档 |
| B2 | store 是 git 仓库,按批 revert;retire 是语义淘汰非硬删,可恢复 |
| B3 | pending 条目未审批,`fab_review reject` 即可 |

---

## 明确不做

- 不改 `doctor-body-dedup.ts` 既有 `## Summary` 段路径(`KT-DEC-0076` 已落地的另一条链路,与本 task 的 `Notes` 链路是两个复读源)。
- 不把命名/类型规范转写为 eslint(用户判定其属团队强制规范,留在 KB)。
- 不修 `hint_dismiss_signals` 永久关闭路径的缺陷(已记录在 PRD Out of Scope,另开单)。
