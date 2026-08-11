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

### 挑战 B · `fabric audit` 的三个子命令没有任何调用侧

`conflicts` / `history` / `descriptions` —— 除了 `audit.ts` 里注册自己的那一行,全仓 tracked 文件零引用:**无文档、无 skill 调用、无测试、无脚本**。

对照同组的 `cite`(doc:3 test:3 src:4 hook:1 skill:2)和 `why-not-surfaced`(doc:3 test:1 src:6 skill:1),差距是数量级的。

**挑战**:这三个是不是"当初 doctor 瘦身时从 `doctor --<flag>` 平移过来、但平移完就没人再提"的?平移保留了实现,却没有保留使用理由。

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

## 3. 建议的执行顺序(未执行,待确认)

| # | 动作 | 证据强度 | 风险 |
|---|---|---|---|
| 1 | 修 E:bootstrap 的 Skill 清单对齐实际(补或删) | **确凿** | 极低 |
| 2 | 定性 B 的三个 audit 子命令:删,或补一句使用场景 | **强**(零调用侧) | 低 |
| 3 | 定性 A 的四个 store 子命令:迁移是否已完成 | 中(需要你的判断,代码答不了) | 低 |
| 4 | 定性剩余 21 个未出现的 event_type(接 `debloat-census` 轴 1) | 强(账本 oracle) | 低 |
| 5 | D 的 hook lib 合并 | **弱,先别动** | 中 |

第 3 条代码回答不了 —— "这次迁移做完了没有"是产品历史,不是代码事实。
