# 轴 5 · 功能面全量普查与必要性挑战

**问题**:代码级臃肿(死事件 / 注释噪声 / 低价值测试)已由 `debloat-census.md` 覆盖。本轴问的是另一件事 —— **这个产品到底有多少功能面,其中哪些不该存在**。

砍掉一个不该存在的功能,省的是它的代码 + 测试 + 文档 + i18n 词条 + doctor 检查项 + 未来每次重构都要照顾它的成本;拆一个巨石函数只省阅读成本。两者杠杆差一个数量级。

## 方法与两个已踩的坑

口径:`git ls-files` 驱动(避开 gitignore 的 dogfood 安装副本和 `packages/cli/C:` 那个 1.9M Windows 路径 fixture),排除 `.workflow/` 与 `.trellis/`,全部用 node `includes` + 词边界正则判定,不用 Bash grep(本机是 ugrep,已知假阴性)。

**本轮实际踩到的两个假信号,都记下来:**

1. **`.workflow/` 里 maestro 生成的 `search-cache.json` / `wiki-index.json` 会让任何按符号名做的普查全线假活。** 测 `event-ledger.ts` 的 96 个 export 时,"被外部引用"的 57 个里绝大多数唯一命中就是这两个文件 —— 它们是派生索引,不是消费者。
2. **词边界比 `includes` 严格得多,而且方向相反地重要。** 查 `FabricLanguage` 时 `includes` 报 19 个文件命中,加上 `\b` 后 0 个 —— 命中的全是 `readFabricLanguage` 这个函数名的子串。**用 `includes` 做"还活着"的判定会系统性高估。**

结论:**名字探针在两个方向上都会撒谎**,任何基于它的结论都必须逐条落到具体文件上复核。本文所有"零引用"结论都做了这一步,其中**两条初判被自己的复核推翻**(见 § 挑战 A、C 的更正)。

---

## 1. 功能面全集(2026-08-11 实测)

| 面 | 数量 | 权威源 |
|---|---:|---|
| 顶层 CLI 命令 | **14** | `packages/cli/src/commands/index.ts` 的 `allCommands` |
| citty 命令声明总数(含子命令) | **≥41** | 全仓 `meta: { name: ... }` 扫描 |
| 其中 `hidden: true` | **≥13** | 同上 |
| MCP 工具 | **5** | `fab_recall` / `fab_propose` / `fab_review` / `fab_pending` / `fab_archive_scan` |
| hook 事件槽 | **6** | `hook-registrations.ts`(Stop / SessionStart / PreToolUse / PostToolUse / SessionEnd / SubagentStart) |
| hook 入口脚本 | **7** | `templates/hooks/*.cjs` |
| hook lib 模块 | **34** | `templates/hooks/lib/*.cjs` |
| Skill | **6** | `templates/skills/`(+ 一个 `lib/` 目录) |
| doctor issue code / check name | **45** | server 全仓 `code:` / `name:` 字面量 |
| fabric-config 键 | **43**(口径待校) | `schemas/fabric-config.ts` 顶层 `key: z.` |
| event_type 声明 | **65** | `schemas/event-ledger.ts` |
| event_type **真实出现过** | **26** | 本仓 dogfood 账本 `.fabric/events.jsonl`,9,586 行,2026-06-29 → 08-11 |

> config 键数与 `debloat-census.md` 记的 51 不一致 —— 本轮正则只扫了单文件顶层缩进,可能漏嵌套。**挑战之前先统一口径**,别拿两个不同的数吵架。

### 1.1 dogfood 账本是本轮最硬的证据

`.fabric/events.jsonl` 是这个仓自己用 Fabric 开发 Fabric 攒下的 9,586 条真实事件,跨 6 周。它回答的是"这个功能有没有真的被跑过",而不是"代码里有没有它"。**这是全仓唯一的 producer-consumer 往返 oracle**:声明面在 schema,消费面在账本,对不上就是空壳。

26 / 65 出现过。缺席的 39 个中,18 个已被 `debloat-census.md` 定性(10 个真死残骸 + 8 个 schema 先行、emitter 一个没写)。**剩下 21 个未定性,是本轴的直接输入。**

---

## 1.2 复核后的总结论(2026-08-11 下午,推翻了本文最初的框架)

初稿把五条挑战写成"哪些功能该删"。逐条落地复核后,**五条里三条被推翻**,而推翻的方式是同一个 ——

> **命令面几乎全是活的。真正缺的不是"删掉死功能",是"活功能没有使用契约"。**

具体说:`audit conflicts/history/descriptions` 有集成测试、从 `server/index.ts` 导出、history 那两个还被 doctor 自己复用;`store` 的隐藏子命令是一条**今天刚复核过的活决策**(KT-DEC-0060)而不是失控;19 个"从没发出过"的事件里有 emitter,只是没触发过。

**唯一真能删的那一轴是事件 schema**,而且比初稿说的窄得多(见 § 挑战 F 的重新定性)。

这个结论对"怎么减臃肿"的指向完全不同:与其找东西删,不如给每个已存在的能力补上"什么时候该用它"——因为一个没人知道何时该用的功能,和不存在的区别只是它还在吃维护成本。

## 2. 必要性挑战清单

### 挑战 A · `fabric store` 是个 18 子命令的组,9 个对用户不可见

`store.ts` 一个文件声明 18 个命令名,其中 `mount` / `create` / `remove` / `explain` / `bind` / `switch-write` / `switch-personal` / `project` / `migrate` 标了 `hidden: true`。

再往下看四个:`backfill` / `scope` / `promote` / `reroot`。

> **初判更正**:我最初的结论是"这四个全仓零引用"。复核推翻了 ——
> 它们有实现模块(`src/store/scope-backfill.ts` / `store-rescope.ts`)、有专门测试
> (`store-command-surface.test.ts` / `scope-backfill.test.ts` / `store-rescope.test.ts`)、
> `reroot` 还被 `scripts/store-only-e2e.mjs` 跑到。**不是死代码。**

真正成立的、更窄的结论是:**没有任何文档、skill 或使用链路按名字调用 `fabric store backfill|scope|promote|reroot`**。它们有测试守着,但没有任何"什么时候该用它"的说明。这是**一次性迁移工具的典型形状** —— 迁移做完了,工具连同它的测试一起留了下来,从此只产生维护成本。

**挑战**:这四个是不是已完成迁移的残留?若是,删;若还需要保留应急能力,至少要有一句"什么情况下跑它",否则没人(包括 AI)会在正确的时机想起它。

> ### ⛔ 复核推翻:"9 个 hidden 是臃乱"这半条必须撤回
>
> `fab_recall` 召回 **KT-DEC-0060**(`last_review_confirmed_at` = 2026-08-11,今天刚复核,活的):
> 「命令组 --help 子命令太多时,用 `meta.hidden` 隐藏 skill/CI/进阶子命令,**不要**合并成 --flag 大命令」。
> 起因正是用户本人指出 `store --help` 一排 10 个子命令把普通用户看懵;三个候选里
> 用户看过效果后确认选了 `meta.hidden`。决策还要求补一句折叠说明 —— 我核了,
> `index.ts:57` 的 `cli.store.help.folded-note` 确实在。
>
> **所以 9 个 hidden 是按决策执行的结果,不是失控。** 这条属于「别拿现状当臃肿,
> 先查它是不是一条被确认过的决策」(KT-GLD-0011 的反向应用)。
>
> **但复核反而暴露了一个更准的问题**:`backfill` / `scope` / `promote` / `reroot`
> 这四个**恰恰没有** `hidden: true`,而 `create` / `bind` / `switch-write` / `migrate`
> 被折叠了。也就是说 —— **四个一次性迁移操作大喇喇留在普通用户的 --help 里,
> 而日常操作反倒被藏起来了:隐藏与否的划分没有遵循这条决策自己的判据。**
> 折叠说明的文案点名的也是 "create / bind / switch-write / migrate",与实际不符。
>
> 附带:这四个的 description 是硬编码英文,没走 `t()` —— i18n 漏了。
>
> **修法是决策自己已经规定好的**:给这四个加 `hidden: true`,一行一个,零 API 破坏,
> skill / CI 按 name 调用照常。至于"要不要删",仍然需要产品历史判断,但**加 hidden
> 不依赖那个答案**,可以先做。

### 挑战 B · `fabric audit` 的三个子命令没有任何调用侧

`conflicts` / `history` / `descriptions` —— 除了 `audit.ts` 里注册自己的那一行,全仓 tracked 文件零引用:**无文档、无 skill 调用、无测试、无脚本**。

对照同组的 `cite`(doc:3 test:3 src:4 hook:1 skill:2)和 `why-not-surfaced`(doc:3 test:1 src:6 skill:1),差距是数量级的。

**挑战**:这三个是不是"当初 doctor 瘦身时从 `doctor --<flag>` 平移过来、但平移完就没人再提"的?平移保留了实现,却没有保留使用理由。

> ### ⛔ 复核推翻:"零引用"是错的,我把两个问题混成了一个
>
> 逐个追实现:
>
> | 子命令 | 实现 | 测试 | 是否被别处复用 |
> |---|---|---|---|
> | `conflicts` | `runDoctorConflictLint`(`doctor-conflict.ts`) | `audit.test.ts` + `doctor-conflict.test.ts` | 从 `server/src/index.ts` 导出 |
> | `history` | `runDoctorArchiveHistory` / `runDoctorHistoryAll`(`doctor-history.ts`) | `audit.test.ts` + `doctor-enrich-history.test.ts` | **被 `doctor.ts` 与 `doctor-cite-coverage.ts` 自己复用** |
> | `descriptions` | `enrichDescriptions`(`doctor-enrich-descriptions.ts`) | `audit.test.ts` + `audit-cite.test.ts` | 从 `server/src/index.ts` 导出 |
>
> 三个全是活的,**一个都不能删**。`descriptions` 驱动的正是 W5 B11 今天刚抽出来的
> 那个 305 行模块;删掉命令等于把它变成死码。
>
> **我错在哪**:我查的是调用**字符串**(`"fabric audit conflicts"` 出现在谁的文档/流程里),
> 得到"零引用",却把它当成了"没接线"的证据。这是两个不同的问题 —— 前者问"有没有人
> 知道该用它",后者问"它通不通电"。KB 里 **KT-PIT-0073** 早就记了这一类
> (「判据靠解析出的 import specifier,不靠符号名子串」),我今天又独立踩了一遍。
>
> **真正剩下的、成立的发现只有一条**:`audit conflicts --deep` 这个 flag 的自述是
> **"Reserve the LLM-judge pass (no judge wired yet)"** —— 一个唯一作用是**为一个
> 不存在的功能占位**的 flag。用户打了它不会有任何额外行为,也不会有任何提示。
> 这属于 KT-PIT-0065「能力造好了但从未接线」,而且是自陈的。

### 挑战 C · cite-coverage 这套机器的输入流有多细

`assistant_turn_observed` 是整个 cite 合规体系的分子来源 —— 它喂养的是:今天刚拆的 `runDoctorCiteCoverage`(重构前 960 行)+ doctor 的 cite 检查项 + `fabric audit cite` + goodhart 启发式 + rollup 合并 + folded-turn 回填。

> **初判更正**:我最初想写"全账本只有 36 条 turn 对 2110 条 edit,60:1"。这个对比是错的 ——
> `assistant_turn_observed` 只从 **2026-08-10** 才开始出现,是新仪器,而 edit 事件从 6/29 就有。
> 拿全期计数对比新仪器等于把仪器上线前的时间算成它的失败。
>
> 同窗口(2026-08-10 起)的真实比值:**turn 36 : edit 287 : recall 302**,约 1:8:8。

即便按诚实口径,结论方向不变:**全仓最复杂的单个函数,建立在一条比它服务的编辑流细 8 倍的信号上**。

**挑战**:不是"删掉 cite coverage",而是 —— 这条信号这么细,是仪器刚上线还没铺开,还是采集点选错了?**在回答这个问题之前,不该再往这套机器上加任何复杂度。**

### 挑战 D · hook lib 是入口脚本的 5 倍

7 个入口脚本,34 个 lib 模块。lib 里已经能看到明显的同族分裂:`hint-config` / `hint-narrow-config` / `hint-thresholds` / `hint-summary-format` 四个都在管提示配置;`signal-decide` / `soft-signal-emit` / `maintenance-signal` / `session-signal-state` / `nudge-policy` 五个都在管信号与节流。

**挑战**:这是真的九个正交关注点,还是一次次加功能时"再开一个文件最省事"的累积?**这一条我还没做符号级复核,不要据此动手。**

### 挑战 E · bootstrap 自述的 Skill 数与实际不符

`.fabric/AGENTS.md`(即注入两端 AI 的策略正文)写的是 **「Skills (4)」**,列 `fabric-archive` / `fabric-review` / `fabric-store` / `fabric-sync`。

实际 ship 的是 **6 个**:多了 `fabric-config` 和 `fabric-recall-playbook`。

这条的危害和别的不同 —— **它是直接注进 AI 上下文的权威文本**。AI 读到"总共 4 个 skill",就不会去用另外两个。**一个不存在的功能只是浪费;一个存在但被权威文档否认的功能,是负价值。**

**挑战**:要么补进 bootstrap,要么删掉这两个 skill。当前状态是最差的那种。

---

### 挑战 F · 事件 schema:唯一真能删的一轴,但比初稿窄得多

按 `event_type: z.literal("...")` 数,schema 声明 **46** 个判别变体;dogfood 账本里出现过 **26** 个,**20 个从未发出**。

> **口径不一致,别拿两个数吵架**:`debloat-census.md` 记的是 65。差异来自数法 —— 该文件里另有 18 处 `z.enum([...])`,把枚举成员也算进去就会得到更大的数。**统一口径是动手前的第一步**,不是先动手再解释差异。

关键在于:**"从没发出过" ≠ "死"**。20 个里只有 **1 个**(`mcp_event`)在 schema 之外零生产引用;**其余 19 个都有 emitter,只是没被触发过**。分三类,处置完全不同:

**F1 · 罕见/错误路径 —— 从没发出过是好消息,不是死码。**
`knowledge_promote_failed`(晋升失败才发)、`knowledge_unarchived`、`serve_lock_cleared`(有陈旧锁才清)、`event_ledger_truncated`、`knowledge_scope_degraded`。**这些一条都不能删** —— 删掉等于把"出问题时才有的诊断信号"删掉,而它平时不出现恰恰证明系统健康。按"没出现过就删"处理是这一轴最容易犯的错。

**F2 · 已知退役、但刻意保留读侧兼容。**
`knowledge_consumed` 在 hook lib 里带着注释:「retired as a live producer. Count both so historic…」—— 生产侧已退役,读侧同时数新旧两种是为了还能读懂历史账本。这是**写清楚了的**决定,不是残留。`knowledge_selection` / `knowledge_sections_fetched` 同理,随 KT-DEC-0026(检索三工具塌成一个)退役。

**F3 · 真正该查的少数。**
`mcp_event`(零生产引用,只有 5 个测试提它 —— 典型的"测试自己是唯一调用方",KT-PIT-0065)、`init_scan_completed`、`graph_edge_candidate_requested`、`knowledge_enriched`(只有跑 `audit descriptions` 才发,而没人跑它 —— 与挑战 B 的结论互相印证)。

**删之前必须先过 KT-PIT-0075**:「从生产入口不可达 ≠ 可删」—— 测试基建会把死码钉在仓里。上面每个类型都带着 1–7 个测试引用,删 schema 就要同时改那些测试。

## 3. 建议的执行顺序(复核后重排)

初稿的第 2、3 条都建立在"零引用"上,复核后两条前提都被推翻(见挑战 A/B 的 ⛔ 块)。**保留作废行而不是删掉它们** —— 推理链错在哪里,本身就是这份普查的产物。

| # | 动作 | 证据强度 | 风险 | 状态 |
|---|---|---|---|---|
| 1 | 修 E:bootstrap 的 Skill 清单对齐实际 | **确凿** | 极低 | ✅ 已做(`eb29dc70`,并补了跨包闸口) |
| 2 | ~~删 B 的三个 audit 子命令~~ | ~~强~~ → **推翻** | — | ❌ 作废:三个都有集成测试 + 被 `doctor` 复用 |
| 3 | ~~给 A 的四个 store 子命令加 hidden~~ | ~~中~~ → **推翻一半** | — | ❌ 作废,重写为 A′ |
| **A′** | ~~store 的 hidden/visible 划分自相矛盾:迁移专用的可见、日常用的被藏~~ | **又被推翻** | — | ❌ 见下方 A″ |
| **A″** | 四条迁移命令的描述硬编码英文、绕过 `t()`;`folded-note` 举的例子点名 `migrate`(唯一没被折叠的那批) | 确凿 | 极低 | ✅ 已做 |
| **B′** | `audit conflicts --deep` 是自陈的空 flag(「no judge wired yet」):删 flag,保留 service 层 judge 注入缝 | **确凿**(自陈) | 低 | ✅ 已做,变异验证 |
| **G** | `fabric store link` 整条特性 DOA:命令没注册、i18n key 一个不存在、ESM 里写 `require()`;`store-link.ts` 还带一份重复副本 | **确凿**(三条独立证据) | — | 待你裁决 |
| **F3** | 定性 4 个真存疑 event_type(`mcp_event` / `init_scan_completed` / `graph_edge_candidate_requested` / `knowledge_enriched`)。**F1/F2 一条都不能碰** | 强(账本 oracle + 逐条追 emitter) | 低 | 待做 |
| F0 | 先统一 event_type 计数口径(46 vs 65) | — | — | 动手前必做 |
| D | hook lib 合并 | **弱,先别动** | 中 | 不做 |

### A′ 也被推翻 —— 第四次探针撒谎

我说"迁移命令可见、日常命令被藏"。查注册表才发现:`backfill/scope/promote/reroot` **根本不是顶层命令**,它们挂在 `store migrate` 下面,而 `migrate` 自己就是 `hidden: true`。所以 `store --help` 里本来就只有 `list` 一行,划分并不矛盾。我给这四条加的 `hidden` 反而会把 `store migrate --help` 变成空列表 —— 已回滚。

**这是同一个错误的第四次**:我又一次把"读起来像什么"当成了"注册成什么"。四次里三次靠的是同一种补救 —— **去看注册/装配的那一处**,而不是看声明的那一处。已记在 KT-PIT-0073 名下。

顺带查出了 G:`linkCommand` 定义在 `store.ts` 里,**从来没进过 `subCommands`**。三条独立证据说明它一次都没跑过:① 没注册;② 它要打印的 5 个 i18n key 在两个语言表里都不存在(跑起来会吐原始 key);③ `store-link.ts` 在 ESM 模块里调 `require("node:fs")`,一用就抛。外加 `store-link.ts` 里还导出了**第二份**同名命令 `storeLinkCommand`,同样没人引用。整条特性(`.fabric-store-link` 标记文件 + `linked_workspaces[]`)没有任何读侧。

这是这次普查里**唯一一处真的"死功能"**,而且是我在查一个错误前提时顺手撞上的 —— 不是初稿点名的那五处里的任何一处。

**只剩两个问题代码回答不了,需要你判断**:

**G**:`store link` 要删还是要接上?删 = `store-link.ts` 整个文件 + `store.ts` 里那段(约 90 行);接 = 补 5 个 i18n key、把 `require` 换成 import、注册进 `subCommands`、再想清楚谁读 `linked_workspaces`。我倾向删 —— 没有读侧的写入功能等于往磁盘写垃圾。**这次我没动它:超出你批的范围,权限闸口也拦了,只在代码里留了 DOA 注释。**

`backfill` / `scope` / `promote` / `reroot` 对应的那次数据迁移,做完了没有?

- 做完了 → 连测试一起删(它们已是纯历史)。
- 没做完 → 加 `hidden` + 补一句使用场景即可。

加 `hidden` 这一步不依赖这个答案(两种情况下都对),所以 A′ 可以先做。
