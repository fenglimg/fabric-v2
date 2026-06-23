# Fabric UX/DX 审计 — 触点类别【Skill 交互】

审计员视角:跨客户端 AI 知识层的 8 个 skill 触点(slash-skill)。基调:双角度(交互体验 + 策略)、激进授权(零用户无兼容包袱)、grounded(每论断引 `file:line`)。

C1 基线已读(`git log -20`):C1 改了 archive 3-stage 内核(`fab_archive_scan` 服务端 ledger、BM25F 去重闸 e61973b)、self-archive E3 marker-free else-default 路由(7a2ae5c)、Stop hook nudge 默认安静(fdbd9fe/0db5ae2)、bootstrap section 25→5 行。**本审计不重复 C1 做过的**,审当前状态找新问题。

---

## 1. Census 全集

| # | skill | 触发词(从 description Triggers 提取) | 一句话职责 | SKILL 行数 | Precondition gate | i18n Policy block |
|---|---|---|---|---|---|---|
| 1 | `fabric` | `fabric / 知识库 / 归档 / 审批 / store / 同步 / 关联 / 审计` | 入口路由,意图→下游 leaf | 100 | ❌ 无 | ❌ 无 |
| 2 | `fabric-archive` | `以后 / always / never / 下次 / 记一下 ; wrong-turn-revert ; decision-confirm ; dismissal-reason ; /fabric-archive` | 归档对话洞察→pending | 187 | ✅ 有 | ✅ 有 |
| 3 | `fabric-review` | `审批 / 驳回 / 复审 / 重审 / approve / reject / review pending` | 审 pending+canonical(approve/reject/modify/defer) | 199 | ✅ 有 | ✅ 有 |
| 4 | `fabric-import` | `导入历史 / bootstrap fabric / mine changelog / 挖掘 commit` | 冷启动从 git log+docs 回灌 pending | 151 | ✅ 有 | ✅ 有 |
| 5 | `fabric-store` | `创建 store / 挂载 store / 绑定知识库 / store 列表 / 切换写库 / set up knowledge store` | store 生命周期(create/add/bind/list/switch-write) | 44 | ✅ 有 | ❌ 无 |
| 6 | `fabric-sync` | `同步知识库 / sync stores / fabric-sync / 解决 store 冲突 / rebase 冲突` | 多 store git pull+push+解冲突 | 46 | ✅ 有 | ✅ 有 |
| 7 | `fabric-connect` | `连接知识 / 找关联条目 / 建知识图谱 / link related entries / 补 related 边 / 知识库连通性` | 发现隐藏关联、回写 `related` 图边 | 48 | ❌ 无 | ❌ 无 |
| 8 | `fabric-audit` | `审计知识库 / 清理陈旧知识 / 知识库体检 / deprecate 条目 / prune stale knowledge / 知识库瘦身 / 淘汰旧决策` | 语义淘汰(deprecate-over-delete / rescue-before-delete) | 63 | ❌ 无 | ❌ 无 |

**结构性观察(census 即暴露):**

- **触发词总数失控**:8 个 skill 合计约 **45 个触发短语**。这是 slash-skill 不是 CLI,LLM 靠 description 模糊匹配,触发词越多匹配面越糊。
- **重度不对称**:写流程三件套(archive/review/import)187–199 行重得像 workflow;运维四件套(store/sync/connect/audit)44–63 行轻得像 CLI 包装。两类被强行平铺成同级 skill,认知上不是一回事。
- **gate 一致性破洞**:`fabric-connect`(`SKILL.md:1-48`)和 `fabric-audit`(`SKILL.md:1-63`)**没有 Precondition gate**,而 archive/review/import/store/sync 都有。router 自己也没有 gate。
- **i18n 破洞**:`fabric-store`(44 行)+ `fabric-connect`(48 行)+ `fabric-audit`(63 行)**没有 UX i18n Policy block**,但它们正文全是中文硬编码(如 `fabric-store/SKILL.md:11-15` 的「创建团队 store」),无 `fabric_language` 渲染分支;一个英文用户调它们会得到中文菜单。archive/review/import/sync 都有 i18n block。

---

## 2. "该调哪个" 测试(真实意图 → 路由)

模拟用户裸输入意图,看从触发词能否无歧义落到对的 skill。

| # | 用户意图(裸输入) | 应落 skill | 实际触发词命中 | 歧义? |
|---|---|---|---|---|
| A | 「我刚定了个决定,想记下来」 | `fabric-archive` | archive 命中「记一下/decision-confirm」✅ | 清晰 |
| B | 「pending 太多了,帮我清一清」 | `fabric-review` | review 命中「review pending」;但**「清一清」字面更像 audit 的「清理陈旧知识/瘦身」** | ⚠️ **review↔audit 歧义** |
| C | 「想把历史 commit 挖进来」 | `fabric-import` | import 命中「挖掘 commit/mine changelog」✅ | 清晰 |
| D | 「知识库该清理了 / 体检一下」 | `fabric-audit` | audit 命中「清理陈旧知识/体检」;但 review 的「整理一下」(`fabric-review/SKILL.md:72` maintain mode keyword)也吃「整理」 | ⚠️ **audit↔review 歧义** |
| E | 「把这些知识连起来」 | `fabric-connect` | connect 命中「连接知识/找关联条目」✅ | 清晰 |
| F | 「我的决策写到哪个 store?」 | `fabric-store` | store 命中「store 列表」边缘;**「写到哪」也可能被理解成 archive 的写目标** | ⚠️ 边缘 |
| G | 「知识库该收口一下了」 | `fabric-audit`? | 没有任何触发词含「收口」(audit 正文 `SKILL.md:8` 才有);裸词漏匹配 | ⚠️ 漏匹配 |

**最严重的语义重叠:`review` ↔ `audit`。** 二者职责确实不同——`fabric-review/SKILL.md:62` 的 `pending` mode 处理「write-side backlog 新 draft」,`fabric-audit/SKILL.md:10` 处理「已归档条目的退役」。但二者:
- 都对 KB 做「整理/清理」语义动作;
- **`fabric-review` 自己已经合并了 `maintain` mode**(`fabric-review/SKILL.md:63`:「sustain the EXISTING canonical KB: browse / survey staleness/health / revisit」),而 `fabric-audit/SKILL.md:34` 的「找孤儿/陈旧条目」**和 review 的 `maintain` health/staleness 子流程功能重叠**;
- 二者的落盘都「经 `fabric-review` 写路径」(`fabric-audit/SKILL.md:46`:「处置经 `fabric-review` skill 落盘」)——**audit 自己不写,它只是 review 的一个语义前置**。

→ 这是 census 里最大的整合信号:**audit 是 review 的一个 mode,不该是独立 skill**(详见 §4 整合)。

### router 能消歧吗?

`fabric` router(`SKILL.md:36-51`)的 `S_CLASSIFY` 只产出 `task_type` 七选一 + 一个低置信问 1 问。它**对 B/D 这种 review↔audit 歧义无消歧逻辑**——Intent Map(`SKILL.md:23-31`)是 leaf description 触发词的机械拼接(`SKILL.md:21` 注释「由 fabric install 从 7 个 leaf description Triggers 子句生成」),歧义在源头(触发词重叠)就没解,router 只是把同样的重叠词表再列一遍。**router 不增加消歧能力,只增加一层间接。**

对照 maestro router(`maestro-flow/.claude/commands/maestro.md`):它的 `S_CLASSIFY → S_DECOMPOSE → S_CREATE` 是真状态机,建 `status.json` session、记 `classification_rationale`(invariant 13)、统一 dispatch via `maestro ralph next`(invariant 1/6)。fabric router 没有 session、没有 classification evidence、`S_CHAIN`(`SKILL.md:69-77`)只有 5 个硬编码组合。**fabric router 是个「轻量分诊台」,但它分诊的依据(触发词)本身没去重——投入产出比可疑。**

---

## 3. 触发词记忆负担

8 个 skill 约 45 个触发短语,问题:

1. **中英混杂不一致**:有的纯中(`知识库瘦身`),有的纯英(`mine changelog`),有的混(`bootstrap fabric`)。同一个用户记不住该说中还是英。
2. **`archive` 触发词最反直觉**:`以后/always/never/下次/记一下/wrong-turn-revert/decision-confirm/dismissal-reason`(`fabric-archive/SKILL.md:3`)——这**不是用户会主动说的词**,是 self-archive **内部信号枚举**泄漏进了 description。用户不会说「decision-confirm」。这些应该留在 Precondition gate 里(它们本就是 E3 路由判据),不该当 user-facing 触发词。
3. **router 自己的触发词 `知识库/归档/审批/store/同步/关联/审计`(`fabric/SKILL.md:3`)和 leaf 触发词正面冲突**:`审批`=review、`审计`=audit、`归档`=archive、`同步`=sync、`关联`=connect。**用户说「审批」时,router 和 review 同时被点亮**——两个 skill 抢同一个词,LLM 选哪个不确定。这是 router-with-overlapping-triggers 反模式。
4. **`收口`/`整理`/`清一清`这类口语动词无人认领或多头认领**(见 §2 B/D/G)。

**简化方向**:触发词应收敛成「每个 skill 3 个高区分度词,中英各半,不泄漏内部枚举」。router 不该有自己的触发词集(它靠下游词路由,自己再列一遍就是冲突源)。

---

## 4. 逐 skill 审计

### 4.1 `fabric`(router)

- **现状**:`SKILL.md:6-8` 定位「只负责理解意图、选下游、按顺序调用」。`SKILL.md:36-79` 是 `S_CLASSIFY/S_EXECUTE/S_CHAIN` 三状态。`SKILL.md:3` 触发词 `fabric/知识库/归档/审批/store/同步/关联/审计`。
- **问题(交互)**:触发词与 5 个 leaf 正面冲突(§3.3),用户说「审批」时 router 与 review 抢词。`SKILL.md:51` 「fabric 帮我处理一下 → 默认 fabric-audit 只读体检」——把模糊意图默认导向 audit 是个奇怪选择(用户「处理一下」多半想写,不是体检)。
- **问题(策略)**:router 不增消歧能力(§2),只把 leaf 触发词机械重列(`SKILL.md:21`)。`S_CHAIN` 5 组合(`SKILL.md:71-77`)硬编码,扩展性差。对比 maestro router 有 session+rationale,fabric router 是「空壳分诊」。**零用户阶段,这层间接的价值≈0**:用户直接 `/fabric-archive` 比先想「该不该走 router」更快。
- **方案(激进)**:**降级 router,不删**。保留 `fabric` 作为「不确定时的兜底入口」,但:① 删掉它自己的触发词集(`SKILL.md:3` 改成只在用户显式说「fabric」或意图真模糊时触发),消除与 leaf 的抢词;② 把 `SKILL.md:51` 默认从 audit 改成「先 `fab_recall` + 列 pending 概览」让用户选;③ 既然要把 8→更少(§5),router 的下游表自然缩短。
- **价值÷成本**:中价值(消除抢词是真痛点)÷ 低成本(改 description + 1 处默认)。

### 4.2 `fabric-archive`

- **现状**:187 行,最重。`SKILL.md:3` 触发词泄漏内部信号枚举。`SKILL.md:28-34` 已 collapse 成 3 macro-phase(C1 NEW-9),但仍有 `0→0.5→0.6→1→1.5→2→2.5→3→3.5→3.6→3.7→4→4.5` **十三个 sub-phase**。
- **问题(交互)**:触发词反直觉(§3.2),用户记不住。187 行对一个「记一下」动作过载。
- **问题(策略)**:13 sub-phase 是 census 里最复杂的 skill。C1 已做内核简化,**但 phase 编号体系(3.5/3.6/3.7 这种小数分裂)本身是复杂度气味**——不在本类(交互)审计授权范围内深改内核,但 description 触发词清理是交互层的。
- **方案**:① 触发词从 description 移除内部枚举(`wrong-turn-revert/decision-confirm/dismissal-reason` 回归 Precondition,user-facing 只留 `记一下/归档/archive`);② 内核 phase 收敛留给「策略/内核」类审计,本类不动。
- **价值÷成本**:中价值 ÷ 极低成本(只改 description 一行)。

### 4.3 `fabric-review`

- **现状**:199 行,最长。`SKILL.md:60-63` 已把 4 mode 收成 2(`pending`+`maintain`,C1 NEW-12)。`maintain`(`SKILL.md:63`)吞了 topic/health/revisit。
- **问题(交互)**:触发词 `审批/驳回/复审/重审`(`SKILL.md:3`)区分度好,**这是 8 个里触发词最干净的**。但 `maintain` mode 的 health/staleness 子流程(`SKILL.md:95`)和 `fabric-audit` 职责重叠(§2)。
- **问题(策略)**:**review 已经长成「pending 审 + canonical 维护」双职能**,而 audit 也是「canonical 维护(退役)」。两者维护职能没有清晰边界——audit 的 deprecate 动作还得「经 fabric-review 落盘」(`fabric-audit/SKILL.md:46`)。
- **方案**:见 §5——**把 audit 折叠成 review 的第 3 个 mode(`retire`/`deprecate`)**,review 成为「KB 全生命周期审」单一入口。
- **价值÷成本**:高价值(消除 review↔audit 最大歧义)÷ 中成本(把 audit 的两条红线 + 三态判定 merge 进 review 的 ref)。

### 4.4 `fabric-import`

- **现状**:151 行。`SKILL.md:10-11` 「one-time per-project cold-start」。3-phase pipeline。
- **问题(交互)**:触发词 `导入历史/bootstrap fabric/mine changelog/挖掘 commit` 清晰。**但它是 one-time skill**(`SKILL.md:11` 「Run once on adoption」),一个用户一辈子调 1–2 次,却占一个常驻 skill slot + 151 行。
- **问题(策略)**:`fabric-import` 和 `fabric-archive` **本质是同一动作(LLM 判断 → `fab_extract_knowledge` 写 pending)的两个数据源**:archive 源=对话 session,import 源=git log+docs。二者 Phase 4 调用完全同一个 MCP(`fab_extract_knowledge`)。import 的 broad+[] scope rule(`SKILL.md:70-72`)只是 archive 在「无 session 上下文」场景下的特例。
- **方案(激进)**:**把 import 折叠成 archive 的一个 source mode**(`fabric-archive --source=git` 或 archive Phase 0 多一个 range source)。one-time 的冷启动不配独立常驻 skill。或者:保留 import 但明确标记为「seldom-used,可不进默认 skill 注册」。
- **价值÷成本**:中价值(减一个常驻 slot + 消除 archive/import 双写路径冗余)÷ 中成本(import 的 checkpoint/state 机制要 merge)。

### 4.5 `fabric-store`

- **现状**:44 行,纯 CLI 包装(`SKILL.md:22-32` 意图→命令映射表)。
- **问题(交互)**:**无 i18n block**(§1),中文硬编码。触发词 `创建/挂载/绑定/列表/切换写库` 是纯 CLI 动词,**这些其实可以直接是 `fabric store <verb>` CLI,根本不需要 skill 层**——skill 的唯一增值是「按意图挑命令」,但 5 个命令的意图区分度已经很高(create/add/bind/list/switch-write),LLM 不挑也不会错。
- **问题(策略)**:store + sync 都是「store 运维」,被拆成两个 44/46 行 skill,而它们共享同一前置(`fabric install --global`)、同一 store-data-only 红线(store `SKILL.md:44` = sync `SKILL.md:44`,**逐字重复 S65 RCE 防线**)。
- **方案**:**store + sync 合并成 `fabric-store`**(运维门面),sync 作为其一个动作。或更激进:**二者都降级为纯 CLI**(`fabric store …` / `fabric sync`),不要 skill 层——CLI 自带 `--help` 比 skill 更适合命令式运维。AI 辅助只在 sync 冲突解决时真有价值(`sync/SKILL.md:26-32`),那部分可保留为 sync 的一个 conflict-resolve 子技能。
- **价值÷成本**:中价值(减 1–2 个 skill slot)÷ 低成本(CLI 已存在,skill 只是壳)。

### 4.6 `fabric-sync`

- **现状**:46 行。`SKILL.md:8` 「CLI `fabric sync` 是引擎,本 skill 是 AI 辅助外层」。真正增值是 Phase 2 冲突辅助(`SKILL.md:26-32`)。
- **问题(交互)**:无独立记忆负担(触发词 `同步/sync` 直觉)。但与 store 共红线逐字重复。
- **问题(策略)**:Phase 0/1/3(`SKILL.md:15-36`)是纯 CLI 转述(`fabric store list` / `fabric sync` / settle),**只有 Phase 2 需要 LLM**。整个 skill 90% 是 CLI 包装。
- **方案**:合并进 `fabric-store`(§4.5),或保留为「conflict-assist only」薄 skill。
- **价值÷成本**:同 §4.5。

### 4.7 `fabric-connect`

- **现状**:48 行。`SKILL.md:8` 回写 `related` 图边。`SKILL.md:36-41` 流程:`fab_recall` 看候选 → 判隐藏关联 → 经 `fabric-review` 落盘。
- **问题(交互)**:**无 Precondition gate + 无 i18n block**(§1,双破洞)。触发词 `连接知识/找关联条目/建知识图谱` 区分度尚可,但「建知识图谱」是个很重的词配一个 48 行 skill,预期落差。
- **问题(策略)**:① **落盘「经 `fabric-review` 写路径」**(`SKILL.md:39`:「在源条目 frontmatter 的 `related` inline 数组追加」走 review 的 modify)——**connect 自己不写,和 audit 一样是 review 的语义前置**;② 而 `SKILL.md:22` 自己承认「检索时临时拉关联 → 直接 `fab_recall include_related:true`(无需建边)」——**即 connect 的产出(`related` 边)很多时候 recall 阶段动态算就够了**,build-time 建边的必要性存疑。
- **方案(激进)**:**connect 是最弱的独立 skill,优先合并或删**。两条路:① 折叠成 `fabric-review` 的一个 `link`/`relate` 动作(它本就经 review 写路径);② 若 build-time `related` 边价值不足(recall 动态算够用),**直接删 skill**,只保留 `fab_recall include_related:true` 运行时关联。
- **价值÷成本**:**高价值÷低成本**(删/合一个职责最薄、双 gate 破洞、自己都承认可被 recall 替代的 skill)。

### 4.8 `fabric-audit`

- **现状**:63 行。`SKILL.md:8` 语义淘汰门面,两条红线 deprecate-over-delete / rescue-before-delete。`SKILL.md:46` 处置「经 `fabric-review` skill 落盘」。
- **问题(交互)**:**无 Precondition gate + 无 i18n block**(§1)。与 review `maintain` mode health/staleness 重叠(§2 D)。触发词 `审计/清理陈旧/体检/瘦身/淘汰` 5 个全是「维护」语义,和 review 的 `maintain` 抢。
- **问题(策略)**:audit **自己不写**(`SKILL.md:46/60`:「只读+给处置建议,实际写入经 fabric-review」)。它的核心价值是两条红线 + 三态判定(`SKILL.md:42-46`)——**这是一套「退役决策规则」,不是一个独立工作流**。规则可以注入 review 的退役 mode。
- **方案**:**折叠成 `fabric-review` 的第 3 mode `retire`**(见 §5)。两条红线 + 三态判定进 review 的 ref,触发词 `审计/体检/淘汰` 归 review。
- **价值÷成本**:高价值(消除 review↔audit 最大歧义 + 补 audit 的 gate/i18n 破洞)÷ 中成本(merge 规则)。

---

## 5. 整合专项:8 → 5 推荐拓扑

**核心判据**:一个 skill 该独立,当且仅当它有**独立的写路径或独立的 LLM 工作流**。按此审 8 个:

| skill | 独立写路径? | 独立 LLM 工作流? | 判决 |
|---|---|---|---|
| archive | ✅ `fab_extract_knowledge` | ✅ session digest 判断 | **留**(写入侧) |
| import | ✅ 同 archive 的 MCP | △ 同动作不同 source | **折叠进 archive(source mode)** |
| review | ✅ `fab_review` | ✅ 逐条 human judgment | **留**(审核侧,吸收 audit/connect) |
| audit | ❌ 经 review 落盘 | △ 退役决策规则 | **折叠进 review(`retire` mode)** |
| connect | ❌ 经 review 落盘 | △ 关联判定(recall 可替代) | **折叠进 review 或删** |
| store | ❌ 纯 CLI | ❌ | **降级 CLI 或合 sync** |
| sync | ❌ 纯 CLI(除冲突) | △ 仅冲突辅助 | **合 store** |
| router | — | ❌ 不增消歧 | **降级兜底入口** |

### 推荐拓扑(8 → 5)

```
fabric (router/兜底, 不抢触发词)
├── fabric-archive   ← 写入侧单一入口(source: session | git+docs[原 import])
├── fabric-review    ← 审核+维护侧单一入口(mode: pending | maintain | retire[原 audit] | relate[原 connect])
└── fabric-store     ← store 运维(含 sync,冲突辅助保留)
```

- **8 个常驻 skill → 4 leaf + 1 兜底 router**。
- **写入侧 1 个**(archive 含 import source)、**审核维护侧 1 个**(review 含 audit+connect mode)、**运维侧 1 个**(store 含 sync)。
- 触发词总量从 ~45 收敛到 ~15(每 skill ~3 高区分度词)。
- 消除 review↔audit、archive↔import 的语义重叠;消除 connect/audit 的 gate/i18n 破洞(并入有 gate 的 review)。

**更激进版(8 → 3,可选)**:若 store/sync 完全 CLINify(纯 `fabric store …` / `fabric sync`),skill 层只剩 `fabric-archive` + `fabric-review` 两个真 LLM 工作流 + router。store 运维交给 CLI `--help`,不占 skill slot。**推荐先做 8→5(稳妥),验证后再评估 store CLINify。**

---

## 【本类 Top 5 高价值改动】

1. **`fabric-audit` 折叠进 `fabric-review` 作 `retire` mode**(§4.8/§5)。理由:audit 自己不写(经 review 落盘)、与 review `maintain` health 子流程功能重叠、是 8 个里最大的语义歧义源(review↔audit)。**价值÷成本=高÷中**。这是本类第一改动。

2. **`fabric-connect` 折叠进 review(`relate` mode)或直接删**(§4.7)。职责最薄、双 gate 破洞(无 Precondition+无 i18n)、自己承认 `fab_recall include_related:true` 可运行时替代 build-time 建边。**高÷低**。

3. **清理触发词:移除 description 里的内部信号枚举 + 消除 router 抢词**(§3)。`fabric-archive` 的 `wrong-turn-revert/decision-confirm/dismissal-reason` 回归 Precondition;`fabric` router 删掉自己那套与 leaf 冲突的 `审批/审计/归档/同步/关联`。**中÷极低**(纯改 description)。

4. **补 `fabric-connect`/`fabric-audit`/`fabric-store` 的 Precondition + i18n 破洞**(§1)。当前这三个无 i18n block(中文硬编码,英文用户得中文菜单),connect/audit 还无 Precondition gate——与另 5 个不一致。若按 #1/#2 折叠则随之消解;否则单独补齐。**中÷低**。

5. **`fabric-import` 折叠成 `fabric-archive` 的 `git` source mode**(§4.4)。one-time 冷启动不配独立常驻 skill;archive/import 共用同一 `fab_extract_knowledge` 写路径,import 只是「无 session 上下文」特例。**中÷中**。

> 整合净效果:**8 常驻 skill → 4 leaf + 1 兜底 router**,触发词 ~45 → ~15,消除 2 组语义重叠(review↔audit、archive↔import)、修 3 处 gate/i18n 破洞、削掉 1 个空壳 router 抢词。零用户无兼容包袱,授权激进合并 grounded 成立。
