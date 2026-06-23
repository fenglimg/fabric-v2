# NS-04 · Skill 拓扑北极星重设计

> 角色:Fabric skill 体系设计师。问题:重新设计该有几个 skill、怎么触发、router 怎么消歧。
> 输入基线:`04-skill.md`(给出 8→4+1)+ `00-SYNTHESIS.md`(T6 同结论)。本文 **验证 / 深化 / 推翻** 该收敛。
> 对照系:maestro-flow `maestro.md` router 状态机(真 session + `classification_rationale` + 统一 dispatch)。
> 授权:零用户、无兼容包袱、clean-slate(per memory `feedback_clean_slate`)。

---

## 0. 一句话主张(先给结论)

`04-skill.md` 的「8→4+1」**方向对、力度不够**。北极星是 **8 → 2 leaf + 0 router(KILL router)+ 1 CLI 运维面**:
真 LLM 工作流只有 `archive`(写入侧)和 `review`(审核+维护+关联+退役侧)两个;`import` 是 archive 的 source mode;`store`/`sync` 退回纯 CLI(`fabric store …` / `fabric sync`,带 `--help`),根本不占 skill slot;`connect`/`audit` 折叠成 review 的 mode;**router 直接删** —— 它是空壳,且在 Fabric 没有 CLI 后端做 session 的前提下,「降级保留」仍是净负债(对照 maestro router 之所以成立,正因为它背后有 `maestro ralph` CLI + `status.json`,fabric router 什么都没有)。

判据(贯穿全文):**一个东西该是 skill,当且仅当它有「独立的 LLM 判断工作流」**。纯命令式运维(create/add/bind/list/switch/sync)没有 LLM 判断,是 CLI;有 LLM 判断但与既有 skill 同写路径(audit/connect/import)是既有 skill 的 mode,不是新 skill。

---

## ① 8 个 skill 存在性裁决(逐个 KEEP / KILL / MERGE)

| # | skill | 有独立 LLM 工作流? | 有独立写路径? | 裁决 | 去向 |
|---|---|---|---|---|---|
| 1 | `fabric`(router) | ❌ 不增消歧(只机械重列 leaf 触发词) | — | **KILL** | 删除;路由交给 leaf 的 `description`(harness 原生 skill 匹配)+ AGENTS.md 一张意图小抄 |
| 2 | `fabric-archive` | ✅ session digest 判断 + 5-type 分类 | ✅ `fab_extract_knowledge` | **KEEP** | 写入侧唯一入口;吸收 import 成 `source` 维度 |
| 3 | `fabric-review` | ✅ 逐条 human judgment + 语义查重 | ✅ `fab_review` | **KEEP** | 审核+维护侧唯一入口;吸收 audit/connect 成 mode |
| 4 | `fabric-import` | △ 同 archive 动作,不同 source(git/docs) | ✅ 同 archive 的 MCP | **MERGE→archive** | archive 的 `source=git\|docs` mode;one-time 不配独立常驻 slot |
| 5 | `fabric-audit` | △ 退役决策规则(三态判定+两红线) | ❌ 自己不写,经 review 落盘 | **MERGE→review** | review 的 `retire` mode(规则进 ref) |
| 6 | `fabric-connect` | △ 关联判定(且 recall 可运行时替代) | ❌ 自己不写,经 review 落盘 | **MERGE→review** | review 的 `relate` mode(或更弱:见下) |
| 7 | `fabric-store` | ❌ 纯命令映射表(意图→`fabric store <verb>`) | ❌ 纯 CLI | **KILL(降 CLI)** | `fabric store …` + `--help`;无 skill 层 |
| 8 | `fabric-sync` | ❌ 90% CLI 转述,仅 Phase 2 冲突需 LLM | ❌ 纯 CLI(除冲突辅助) | **KILL(降 CLI)** | `fabric sync` + `--continue/--abort`;冲突辅助降为 CLI 在冲突时打印的「下一步」提示 |

### 三处对 `04-skill.md` 的深化/推翻

**深化 A — router:`04-skill.md` 主张「降级不删」,北极星推翻为 KILL。**
理由:`04-skill.md` 自己已论证 router「不增消歧、只多一层间接、价值≈0」,却保留它做「兜底入口」。但兜底入口在 Claude Code / Codex 的 skill 机制里**本就由 harness 的 description 模糊匹配承担** —— 一个零逻辑的 `fabric` skill 只会和 leaf 抢匹配(它的触发词 `归档/审批/审计` 正面撞 leaf)。maestro 的 router 能存在,是因为它是 **command**(`/maestro`)且背后有 `maestro ralph` CLI 建 `status.json`、记 rationale、统一 dispatch —— router 是那套 session 状态机的**入口**,不是空壳。Fabric 既无 session 持久化需求(每个 fabric 动作是一次性的,不像 maestro 要跨 phase 串 execute→review→test),也无 CLI 后端 —— **强行保留一个无状态机后端的 router = 纯负债**。删它,触发词抢词问题随之根除。

**深化 B — store/sync:`04-skill.md` 主张「合并成 store skill(含 sync)」,留作「8→5 稳妥」;北极星直接取「8→3 激进版」并定为唯一北极星。**
理由:`04-skill.md` 自己在 §5 已写「更激进版(store/sync CLINify)推荐先做 8→5 验证后再评估」。但「先稳妥再激进」是有兼容包袱时的策略;**零用户、clean-slate 授权下没有验证成本可摊销** —— 直接落最终态。store 的 5 个命令(create/add/bind/list/switch-write)意图区分度极高,LLM 不挑也不会错,skill 层零增值;sync 的 90% 是 CLI 转述,唯一 LLM 价值在 rebase 冲突解释,那应是 `fabric sync` 在冲突时**自己打印冲突两侧 + 建议**(CLI 能做,见 maestro `ralph` 在 decision 节点 handoff 的先例),不需要常驻 skill。**store/sync 降 CLI 后,记忆负担从 ~11 触发词归零**(运维走 `fabric --help` 自发现,这是 CLI 的主场)。

**深化 C — connect:`04-skill.md` 给「折叠进 review 或删」二选一,北极星定为「折叠成 review 的 `relate` mode,但默认不主动建边」。**
理由:connect 自己承认 `fab_recall include_related:true` 运行时算够用(`fabric-connect/SKILL.md:22`),build-time 建边价值存疑。但完全删会丢「显式补 related 边」这个真实(虽低频)动作。折中:作为 review `relate` mode 存在(复用 review 的 modify 写路径,零新写路径),**但从 SessionStart/Stop 的任何 nudge 里移除**(不主动 propose),只在用户显式说「连一下/补 related」时由 review 接住。这样既不丢能力,也不让一个低频动作占据触发词预算。

---

## ② 目标拓扑(N leaf + router 设计)

### 北极星拓扑:2 leaf skill + 1 CLI 面 + 0 router

```
┌─ Skill 层(LLM 判断工作流,2 个)────────────────────────┐
│                                                          │
│  fabric-archive   ← 知识「写入」唯一入口                  │
│      source: session(默认) | git | docs                 │
│      (原 fabric-import = source=git|docs 的特例)          │
│                                                          │
│  fabric-review    ← 知识「审核+维护」唯一入口             │
│      mode: pending(默认) | maintain | retire | relate    │
│      retire = 原 fabric-audit(三态判定+两红线进 ref)     │
│      relate = 原 fabric-connect(显式补 related,不主动)   │
│                                                          │
└──────────────────────────────────────────────────────────┘
┌─ CLI 层(命令式运维,无 skill)──────────────────────────┐
│  fabric store create|add|bind|list|switch-write|explain  │
│  fabric sync [--continue|--abort]  (冲突时 CLI 自打印两侧)│
└──────────────────────────────────────────────────────────┘
   router: 无。leaf description 由 harness 原生匹配;
           AGENTS.md 留一张「意图→入口」3 行小抄兜底。
```

### 为什么是 2 而不是 4(对 4+1 的根本分歧)

`04-skill.md` 的 4 = archive + review + store(含 sync)+ router。北极星砍掉后两个的依据:
- **store(含 sync)不是 skill**:它没有「LLM 判断」。判据严格执行 → 它是 CLI。保留它做 skill 的唯一理由是「按意图挑命令」,但 6 个命令意图已自解释,这层挑选是伪需求。
- **router 不是 skill**:它没有任何自己的工作产出,是个分诊台,而分诊在 description-matching 机制下免费。

→ **真 skill 数 = 真 LLM 工作流数 = 2**。这是「数据结构优先」:skill 的本质数据结构是「一段需要 LLM 推理才能完成的流程」,运维和路由都不是。

### router 消歧:从「空壳分诊」到「无 router,靠两层兜底」

fabric router 的病(对照 maestro router):

| 维度 | maestro router(成立) | fabric router(空壳) | 北极星 |
|---|---|---|---|
| 形态 | `/maestro` command | `fabric` skill | **删除** |
| 后端 | `maestro ralph` CLI + `status.json` session | 无 | 无需(fabric 动作无跨步 session) |
| 分类证据 | `classification_rationale`(invariant 13,无则不进 CREATE) | 无 | 无需(2 选 1 + mode,无需 rationale 持久化) |
| 消歧逻辑 | 语义匹配 chain catalog + ≤2 轮 clarify | 触发词机械重列,**无消歧** | 见下「两层兜底」 |
| 统一出口 | 全走 `ralph-execute` | `S_EXECUTE` 直调 leaf(无收口) | 2 入口本就无需收口 |
| 触发词 | command 名唯一,不抢 | 自己 7 词全撞 leaf | **删词 → 零抢** |

**北极星的消歧 = 两层兜底,不需要 router 这个第三层:**
1. **第一层(harness description 匹配)**:只剩 2 个 leaf,description 高区分度(archive=写入,review=审核/维护)。意图落点从「7 选 1 + router 抢词」坍缩成「2 选 1」—— 歧义面从源头消掉 5/7。
2. **第二层(skill 内 mode/source 推断)**:archive 内部推 `source`(有 session 上下文=session;用户说「挖 commit/导历史」=git/docs),review 内部推 `mode`(沿用现有 `pending`/`maintain` 2-step keyword 推断,扩 `retire`/`relate` 两行)。**mode 推断是 review 已有的成熟机制(`KT-DEC-0006`:mode 推断不问用户)**,把 audit/connect 折进来只是给推断表加 2 行,不是新机制。
3. **AGENTS.md 兜底小抄(替代 router 的「兜底入口」)**:3 行静态映射,零逻辑、零触发词、零抢词:
   ```
   记知识 / 归档 / 决策确认  → fabric-archive
   审 pending / 维护 / 退役 / 连关联 → fabric-review
   store 运维 / 同步        → CLI: fabric store … / fabric sync
   ```

> 关键洞察:**maestro 需要 router 因为它编排「多步 lifecycle 链」(grill→brainstorm→plan→execute→review),fabric 的每个动作都是单步终态。单步动作不需要 chain orchestrator。** 这是把 maestro 模式照搬到 fabric 的最大误区 —— `04-skill.md` 保留 router 正是没拆穿这层(它说「参考 maestro 顺序协调」,但 fabric 没有要协调的顺序)。

---

## ③ 目标触发词体系(~45 → ~10)

### 现状病灶(census 复述,grounded)

| 病 | 实证 |
|---|---|
| 总量失控 | 8 skill ≈ 45 触发短语 |
| 内部枚举泄漏 | `fabric-archive/SKILL.md:3` 把 `wrong-turn-revert/decision-confirm/dismissal-reason`(E3 内部信号)当 user-facing 触发词 —— 用户不会说「decision-confirm」 |
| router 抢词 | `fabric/SKILL.md:3` 的 `归档/审批/审计/同步/关联` 全撞 leaf |
| 中英不一致 | `知识库瘦身`(纯中)vs `mine changelog`(纯英)vs `bootstrap fabric`(混) |
| 口语动词无主 | `收口/整理/清一清` 多头或漏匹配(census §2 B/D/G) |

### 目标触发词集(每入口 ≤4 词,中英成对,零内部枚举,零抢词)

| 入口 | 触发词(中英成对) | 删除的(去向) |
|---|---|---|
| `fabric-archive` | `记一下 / 归档 / archive / 记知识` | 删 `以后·always·never·下次`(→ Precondition gate 的 normative 信号,不当触发词);删 `wrong-turn-revert·decision-confirm·dismissal-reason`(→ Precondition 内部枚举);删 `导入历史·mine changelog·挖掘 commit·bootstrap`(→ archive 的 `source=git` 子触发,见下) |
| `fabric-review` | `审知识 / review / 审 pending / 维护知识库 / 退役 / 连关联` | 吸收原 review(`审批/驳回/approve/reject`)+ 原 audit(`审计/体检/陈旧/瘦身/淘汰`)+ 原 connect(`连接/找关联/related`)→ 收敛成 6 个高区分度词;口语 `整理/清一清/收口` 全部映射进 review 的 `maintain`(写进 mode 推断表,不当顶层触发词) |
| CLI `fabric store/sync` | (无 skill 触发词;`fabric --help` 自发现) | 删全部 ~11 个 store/sync 触发词 |
| router | (删除) | 删全部 7 个 router 触发词 |

**总量:archive 4 + review 6 = 10 个 user-facing 触发词**(从 ~45 降到 ~10,降幅 78%)。

### 三条触发词宪法(写进 AGENTS.md / skill description 规约)

1. **触发词 = 用户真会说的话**:内部信号枚举(E3 的 `wrong-turn-revert` 等)留在 Precondition gate(它们本就是路由判据),**永不出现在 description 的 `Triggers`**。
2. **中英成对**:每个概念给一中一英(`归档/archive`),不给纯中或纯英孤词;杜绝「同一用户记不住说中还是英」。
3. **零抢词**:删 router 后没有任何两个入口共享触发词;口语模糊动词(`整理/清一清`)统一沉到 skill 内 mode 推断,不当顶层触发词(顶层只放高区分度词)。

---

## ④ 行为一致性(i18n / Precondition / C1 cite 在北极星里统一)

census §1 暴露 3 处破洞:`store/connect/audit` 缺 i18n;`connect/audit` 缺 Precondition;router 无 gate。**北极星天然消解大部分**——因为破洞集中在被 KILL/MERGE 的 skill 上:

| 破洞 | 北极星处置 |
|---|---|
| connect 缺 i18n + Precondition | connect → review 的 `relate` mode,**继承 review 的 i18n + Precondition**(review 两者都有),破洞消失 |
| audit 缺 i18n + Precondition | audit → review 的 `retire` mode,同上继承,破洞消失 |
| store/sync 缺 i18n | 降 CLI 后,i18n 由 **CLI 渲染层**统一处理(CLI 读 `~/.fabric/fabric-global.json#language`,见 SYNTHESIS P0-2 修正后的语言真源);skill 层不再各自实现 i18n block,消除 4 套漂移的 i18n 实现 |
| router 无 gate | router 删除,无 gate 问题 |

**剩 2 个 leaf 的一致性北极星(统一规约):**

1. **i18n**:archive/review 各保留 1 个 `UX i18n Policy` block,但**收敛到单一真源**:语言读 `~/.fabric/fabric-global.json#language`(SYNTHESIS P0-2:`.fabric/fabric-config.json#fabric_language` 已废,schema 删字段);5-class taxonomy 进**共享 ref**(`lib/i18n-policy.md`),两 skill 引用不各自抄(消除 census 指出的「i18n block 各写一份」漂移)。

2. **Precondition gate**:archive/review 各保留 Precondition,**统一成同一形状**:
   ```
   Invoke ONLY when: ① Stop-hook block 信号 | ② 用户显式调用 | ③ agent 自判信号
   else → bilingual「无信号;显式调用 <skill> 以手动触发」(per language)
   ```
   gate 是软门(`KT-DEC-0007`:hook=提醒非闸),内部信号枚举(normative/wrong-turn/dismissal)**只活在这里**,不外泄成触发词。

3. **C1 cite 一致性(关键)**:北极星**全面对齐 C1「recall-first 自动记账,零首行负担」**(AGENTS.md Cite policy)。具体:
   - 2 个 leaf 的 description / ref **不得**残留任何「首行打 `KB:` / 打 marker 暗号」的旧 contract 八股(C1 已删首行契约)。
   - archive 的 E3 自触发**保持 marker-free**(`7a2ae5c`:确定性 else-default 路由,不依赖 AI 输出精确字符串);折进来的 audit/connect 动作同样 marker-free —— 用户显式说「退役/连关联」即路由,不需暗号。
   - review 的 `retire`/`relate` 落盘仍走 `fab_review` 单写路径(audit/connect 本就「经 review 落盘」),**cite 自动记账 locus 不变**(`project_recall_cite_accounting_locus`:覆盖率键 off `target_paths`),折叠不引入新记账面。
   - **唯一要用户开口的仍是 `dismissed: <id> (<reason>)`**(C1 override 出口),2 leaf 共用同一词典,不新增。

> 一致性北极星一句话:**3 个 gate-pattern(i18n / Precondition / cite)从「8 份各异、3 处缺失」收敛到「2 leaf × 共享 ref + CLI 层 i18n」,破洞随被删 skill 一起消失,不需单独补丁。**

---

## 【Skill 收敛清单】(价值÷成本,P0/P1/P2 排序)

> 价值轴:消歧增益 + 记忆负担降幅 + 破洞修复 + 维护税削减。成本轴:改动面 + 跨端契约影响 + ref 迁移量。

### P0 — 高价值低成本,先做(纯删/纯改 description,无 ref 迁移)

| # | 改动 | 价值 | 成本 | 净效 |
|---|---|---|---|---|
| P0-1 | **删 `fabric` router skill** + 在 AGENTS.md 加 3 行意图小抄 | 高(根除 7 词抢词、删一层间接) | 低(删文件 + 3 行) | 触发词 -7,歧义面 -5/7 |
| P0-2 | **清理 archive/review description 触发词**:archive 移除内部枚举(`wrong-turn-revert` 等)+ 收敛到 4 词;review 收敛到 6 词 | 高(记忆负担、停止枚举泄漏) | 极低(改 2 行 description) | 触发词 ~45→~10 |
| P0-3 | **store/sync 降 CLI**:删 2 个 skill,确认 `fabric store …`/`fabric sync` CLI 全覆盖 + `--help` | 中高(删 ~11 触发词、删 2 套漂移 i18n) | 低(CLI 已存在,删壳) | skill -2,触发词 -11 |

### P1 — 高价值中成本(MERGE,需迁 ref + 扩 mode 推断表)

| # | 改动 | 价值 | 成本 | 净效 |
|---|---|---|---|---|
| P1-1 | **audit → review 的 `retire` mode**:三态判定+两红线进 review ref;扩 mode 推断表 2 行;触发词 `审计/体检/退役` 归 review | 高(消除 review↔audit 最大歧义 + 补 audit 的 gate/i18n 破洞) | 中(迁规则 ref + 扩推断) | 消 1 组语义重叠 |
| P1-2 | **import → archive 的 `source=git\|docs` mode**:import 的 checkpoint/state + broad+[] scope rule 进 archive ref 的 source 分支;触发词 `导入历史/挖 commit` 归 archive | 中(减 1 常驻 slot + 消 archive/import 双写路径冗余) | 中(merge checkpoint 机制) | 消 1 组语义重叠 |
| P1-3 | **connect → review 的 `relate` mode**(默认不主动 propose):复用 review modify 写路径;触发词 `连关联/related` 归 review,从所有 nudge 移除 | 高(删最薄 skill + 补双 gate 破洞) | 低(connect 本就经 review 落盘) | skill -1 |

### P2 — 一致性收口(依赖 P0/P1 落地后统一)

| # | 改动 | 价值 | 成本 | 净效 |
|---|---|---|---|---|
| P2-1 | **i18n 收敛单一真源**:5-class taxonomy 进 `lib/i18n-policy.md` 共享 ref;CLI 层 i18n 读 global language;2 leaf 引用不各抄 | 中(消 i18n 实现漂移) | 中(抽共享 ref) | 消 4 套漂移实现 |
| P2-2 | **Precondition gate 统一形状** + 内部信号枚举只活在 gate(不外泄触发词) | 中(行为一致 + 触发词洁净) | 低(对齐 2 leaf 的 gate 模板) | gate 一致 |
| P2-3 | **C1 cite 对齐审计**:扫 2 leaf + ref,删任何残留首行 `KB:`/marker 八股;确认 retire/relate marker-free + 走 fab_review 单写路径 | 中(对齐 C1,防 cite 记账面漂移) | 低(grep + 删残留) | cite 一致 |

### 北极星净效汇总

```
skill 数:    8 常驻         → 2 leaf(+0 router +CLI 运维面)
触发词:      ~45            → ~10(降 78%)
语义重叠:    review↔audit / archive↔import → 0(折成 mode/source)
router:      空壳抢词        → 删除(harness description + AGENTS 小抄兜底)
gate 破洞:   3 缺失 + 8 份各异 → 2 leaf × 共享 ref(破洞随被删 skill 消失)
消歧:        7 选 1 无消歧    → 2 选 1 + skill 内成熟 mode 推断
```

**对 `04-skill.md` 的最终裁定:方向(收敛)验证通过,力度(4+1)推翻为(2+CLI),依据是严格执行「skill = 独立 LLM 工作流」判据 + 戳穿「fabric 不需要 maestro 式 chain router」这层(单步终态动作无需 orchestrator)。零用户授权下不分「稳妥/激进」两步,直接落最终态。**
