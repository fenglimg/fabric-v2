# 测试架构重构提案(2026-08-10)

> 用户诉求原话:「测试框架有点繁杂和冗余一些,执行时间较长」+「需要依靠具体 AI 做具体验证的先不集成在当前测试中,只测试代码的行为正确是否在预期之内」。
> 依据: `research/test-architecture-current.md`(现状普查)、`research/test-architecture-external.md`(cocos skill 方法论 + 业界取证)、本机实测跑批。

## 1. 体检数字(本机实测 + 静态普查)

> ⚠️ **本节首版数字已作废并更正。** 首版用 `pnpm vitest run --dir packages` 从仓库根跑全量 —— 本仓**没有根 vitest 配置也没有 workspace 文件**,正规入口是 `pnpm -r test`(每个包在自己目录跑 `vitest run`)。从根跑绕过了各包的 `vitest.config.ts`,`setupFiles` 从未加载 → `FABRIC_HOME` 未设置 → 30 个「失败」全是测法造成的假红。下表为按正规入口复测的结果。

| 指标 | 数值 | 说明 |
|---|---|---|
| 测试规模 | **305 文件 / 73,401 行** | 源码 106,972 行,测试:源码 ≈ 0.69 |
| 壁钟耗时(修复前) | cli **102.7s** + server/shared ≈ 15s | cli 因 `fileParallelism: false` 串行 |
| 壁钟耗时(修复后) | cli **46.4s** | 见 §5;三次连跑 46.3/47.1/47.7s |
| 失败 | **0**(145+96+54 文件全绿) | ISS-003 的「flaky 基线」在正规入口下不复现 |
| CPU 利用率(修复前) | 61.6s CPU / 102.7s 壁钟 ≈ **0.6 核** | 多核机器上绝大部分时间闲置 |
| 耗时集中度 | cli **11/145 文件(8%)占 80%**;server 23/96(24%) | 长尾极陡,优化面很窄 |
| 最慢单文件 | `install-skills-and-hooks.test.ts` **24.4s / 20 例** | 每例约 0.87s,因每例真跑一次 93 文件安装 |
| 纯逻辑测试占比 | **22.6%**(111 文件 / 16,567 行) | 其余 **77% 带真实 IO** |
| 「AI 行为」类 | 40 文件 / **17,943 行(24.4%)** | 详见 §3 |

## 2. 诊断:三个病根(不是"测试太多",是结构问题)

**病根一:测试基础设施把死代码钉在仓库里。**
`__tests__/helpers/init-test-utils.ts` 用**退役的 v1 安装器** `commands/install.ts` 搭 fixture,16 个测试依赖它 → 1,093 行运行时不可达的代码删不掉。同型还有 `tui/ConsoleOutputRenderer.ts` 317 行(被 3 个 renderer 测试钉住)、另有 860 行连测试都没有的纯死码(knip 抓不到,因为 `knip.config.ts` 把 `src/install/**` 整目录列为 entry)。
**这是本轮 W1「埋尸体」批次实际卡住的原因** —— 不先动测试架构,死代码就删不动。

**病根二:为一个不存在的竞态付了 2 倍壁钟(已实测证伪并修复,见 §5)。**
`packages/cli/vitest.config.ts` 曾设 `fileParallelism: false`,145 个 CLI 测试文件全串行;注释归因为并发 `rename()` 竞态("ENOENT on the .tmp source mid-rename")。
**该归因经实验证伪**:开并行后 31 个失败**全部**是 `Test timed out in 5000ms`(典型 5298ms / 5367ms,刚过线),零个 rename/ENOENT 错误;单独并行跑 integration 目录 14 文件 107 例全绿。真因是安装型测试在并发下被 CPU/IO 争抢拖慢约 5 倍,越过 vitest 5 秒默认超时。
**修复 = 开并行 + 把超时提到 30s**,不削弱任何断言:壁钟 102.7s → 46.4s,三次连跑全绿。

**病根三:重复实现催生了"守重复"的测试。**
parity 家族 10 文件 / 1,368 行,存在的唯一理由是同一逻辑有 TS + 手写 `.cjs` 两份实现,靠字节等价断言锁一致。其中 `render-backlog-line-parity.test.ts` 更极端:它是"为了守别的测试里的 stub 字面量"而写的测试。
**消灭重复实现(轨B 的 B8),这 1,368 行测试自动消失** —— 测试不是资产,是重复实现的利息。

## 3. 「AI 验证」与「代码行为」的切分线(用户诉求的落地)

现状 40 文件 / 17,943 行被归为「AI 行为」类,但**不能整批剥离** —— 普查发现其中多数用例当前是确定性的、不需要真 AI 就能跑绿。真正该切的线不是"和 AI 有关",而是:

> **判据:断言的是「结构/契约」还是「措辞/文案」。**
> 结构与契约(字段在不在、schema 合不合法、错误码对不对、流程走没走到)= 代码行为 → **留在单测**。
> 措辞与文案(prompt 怎么写、中文正文一字不差、SKILL description 写得好不好)= eval 性质 → **移出 PR 门禁**。
> 业界同构表述(Hamel):单元测试的输出是**布尔**,eval 的输出是**分数**;是分数的不进单元测试。

按此判据分档:

| 档 | 规模 | 处置 |
|---|---|---|
| **档 A · 纯 markdown 措辞断言** | 1,359 行 | **移出 PR 门禁**。含 `bootstrap-canonical`(41 处中文正文逐字断言)、`doctor-skill-lints`(判 SKILL description 写得好不好)、`archive-skill-trigger-gate`(文件头自认"spawn Claude session 太脆所以改 grep markdown")、`ai-client-policy-drift`。这些锁死 prompt 文本,**任何 prompt 优化都会假红** |
| **档 B · hook/CLI 自然语言文案 + i18n** | 10,768 行 | **拆**:留「结构」(key 存在、双语齐、占位符匹配、never-block 不变量),删「文案逐字」。`fabric-hint` 2,784 行 / `knowledge-hint-broad` 2,028 行 / `knowledge-hint-narrow` 1,861 行是主战场 |
| **档 C · AI 领域启发式** | 5,816 行 | **多数留**(确定性算法就该测);唯 `recall-dogfood-baseline` 已在门禁外(`DOGFOOD_BASELINE=1`)—— **这是现成的先例与落点** |

严口径下真正"必须 AI 运行时验证"的只有 4 个文件。落点也是现成的:`docs/TESTING.md` 已有 "Optional (not PR hard)" 档,`nofake-audit` / `habit-funnel` / `red-team-safety` 已经在那儿。

## 4. 提议的分层(判据先行,不按 unit/integration/e2e 命名)

采纳 cocos skill 最有价值的一条:**分层判据是「这层唯一能证明什么」**,加一层必须回答"上一层为什么证明不了",答不上来就是冗余。

| 层 | 唯一能证明 | 手段 | 目标耗时 |
|---|---|---|---|
| **L0 静态守卫** | 契约不漂移 | schema/类型/知识 frontmatter/命令面快照 | < 3s |
| **L1 纯逻辑** | 算法与判定正确 | 无 IO,内存输入输出 | < 5s |
| **L2 契约集成** | 组件间接线通 | 进程内驱动(MCP 走**真 Client + in-process**,官方立场:no port/socket/mock transport;CLI 走进程内调用,oclif 同款) | < 20s |
| **L3 端到端** | 产物在真实文件系统里成立 | 真临时目录 + 唯一路径(pnpm 式),**少而精** | < 30s |
| **门禁外 · eval** | prompt/AI 行为质量 | 现有 `DOGFOOD_BASELINE` 机制扩展,非阻断、按需跑 | 不计 |

关键取证:MCP 官方 SDK 测试文档明确要求**进程内驱动真 Client**,fabric 现在 11 个 spawn 真 `node dist/index.js` 的测试多数可降到 L2。

## 5. 提速措施(按预期杠杆排序,先量后砍)

1. ✅ **先量(T-1 已完成)**:`--reporter=json` 拿到 per-file 耗时。产出:cli 8% 文件占 80% 耗时;`collect` 是**跨 worker 累计值**不是壁钟(并行下 30.8s 累计 ≈ 4s 壁钟),故 collect **不是**瓶颈 —— 首版「collect 占 77% 壁钟」的结论作废。
2. ✅ **开并行 + 提超时(已落地)**:`fileParallelism: false` 删除,`testTimeout`/`hookTimeout` = 30s。**102.7s → 46.4s(2.2×)**,三次连跑 145 文件 / 1433 例全绿。不需要「pnpm 式唯一路径」改造 —— 竞态不存在,不必为它动 168 个文件。
3. **削安装型测试的单例成本(下一个最大杠杆)**:`install-skills-and-hooks.test.ts` 24.4s/20 例,每例真跑一次 93 文件安装;`uninstall-skills-and-hooks` 10.1s/10 例。二者合计占 cli 累计耗时 47%。方向是同一棵安装产物在文件内复用(只读断言共享,写型断言才重装),而非每例重装。**与 T-2 同一批文件**,一起改。
4. **CI 去重**:validate job 13 步串行,第 10 步只为换 `NO_COLOR` 把 4 个快照文件重跑一遍。
5. **随 B8 消灭 parity 家族**:-1,368 行测试。
6. **撤覆盖率阈值 70%**:砍冗余测试时它会变成阻力,把已判定冗余的测试锁在原地。

## 6. 分批实施建议

| 批 | 内容 | 解锁什么 |
|---|---|---|
| **T-1 量化** ✅已完成 | per-file 慢榜产出;证伪「竞态」归因并落地并行+超时(102.7s→46.4s);证伪 ISS-003 flaky 基线(正规入口 0 失败) | 让后续每一刀有据 |
| **T-2 解耦死代码** ✅已完成 | `runInit`/`runScaffoldOnly` 迁到 install-v2 管线;11 个测试文件解钉,3 个测 v1 独有能力的文件删除 | **已解锁 W1:2,049 行删除,CLI 不可达代码归零** |
| **T-2b 削安装成本** ✅已完成 | 新增 `createInstalledFixtureRoot`:每 worker 真装一次到模板根, 各用例拿字节相同副本(33ms vs 1000ms);33 处真安装转副本 | **壁钟 46.4s → 26.4s**,三次连跑稳定 |
| **T-3 切 AI/代码线** ✅已收口 | 判据已写进 `docs/TESTING.md`;bootstrap 6 条措辞锁移到 `PROMPT_WORDING=1`。**档 A 归类经复核大幅收缩(§9),档 B 经抽样复核判定不做(§10)** | 门禁不再锁 prompt 散文 |
| **T-4 提速** ✅已收口 | 唯一路径/关串行/fixture 降频三项在 T-1+T-2b 已达成(壁钟 26.4s);CI 去重 = 删空转的 NO_COLOR 复跑步骤 + 把其依赖的不变量入闸 | 门禁 10 步 → 9 步 |
| **T-5 消重** | 随 B8 删 parity 家族;撤覆盖率阈值 | -1,368 行 |

## 7. 已知不确定性(不要当结论用)

- ~~40.6s collect 归因未做~~ → **已解**:collect 是跨 worker 累计值,并行下摊薄,非瓶颈;`fileParallelism` 提速已实测 2.2× 而非推断。
- ~~30 文件 flaky~~ → **已解**:是测法假红(从仓库根跑绕过包配置),正规入口 0 失败。
- **超时 30s 是在本机(约 10 核)测的**。核数更少的 CI runner 上争抢更重,若仍偶发超时,先看是否命中 §5.3 的安装型测试,再考虑调 `maxWorkers` 而不是回退串行 —— 回退会重新掩盖真因。
- 外部调研的 exa/web 搜索通道在子代理环境不可用,B 节改用一手权威源(MCP SDK 官方测试文档、pnpm/oclif 真实代码、Hamel/promptfoo)取证;**可能漏掉 2026 年新出现的小众实践**,这是该报告最大盲区。
- 现状普查基于静态特征计数,未逐个读测试正文,计数有误差。
- 「档 B 拆结构 vs 文案」需逐文件人工判读,10,768 行是本提案最大的人工量。

## 8. T-2/W1 执行中发现的「死契约」(代码已删,行为差异待定夺)

删 v1 安装器的过程中,发现 5 处「测试是绿的,但守的是没人跑的代码」。前 1 项已修,后 4 项是 v2 有意或无意丢掉的行为,记录在此不擅自恢复:

| # | 契约 | v1 有 | v2 现状 | 处置 |
|---|---|---|---|---|
| 1 | **drift-abort 闸口** | 有 | 分类出 `user-modified` 但无人消费,`.fabric/events.jsonl` 被目录占位时 install 仍报 SUCCESS | ✅ 已在 env.stage 补回(62e95d32) |
| 2 | `install_diff_applied` 事件 | 只有 v1 写 | 全仓 0 个消费者,shared schema 仍声明该 variant | 退役候选,未动 |
| 3 | **扫描期 TTY 进度**(ISS-035) | `install.ts:617` 两行 stderr | 无。preflight 选择扫完后在框内渲染摘要,大仓扫描期间完全无反馈 | 记为 UX gap |
| 4 | **能力选择向导** | 勾选 bootstrap/mcp/hooks 并重写计划;取消 = exitCode 130 | 无对应物。`skipBootstrap` 只在 guidance 当显示标签,各 prompt 取消 = 各自 skip 继续 | 视为有意 supersede |
| 5 | **--dry-run 预览** | 抬头 + 逐路径 diff 分类表 | 抬头只在 `--global` 分支硬编码;项目级 dry-run 无抬头无分类表。`cli.install.plan.preview-title` / `mode-banner.plan` 成孤儿 key | 记为 UX gap |

## 9. 档 A 归类的更正(T-3 逐条复核)

§3 把 1,359 行判为「纯 markdown 措辞断言、整批移出门禁」。逐条读完 4 个文件后,**这个结论大部分不成立** —— §7 自陈的「普查基于静态特征计数,未逐个读测试正文」正是误差来源:

| 文件 | 提案判定 | 实际 | 处置 |
|---|---|---|---|
| `doctor-skill-lints.test.ts` (240) | 判 SKILL description 写得好不好 | **归错档**。测的是 `inspectSkillDescription` / `inspectSkillContract` / `inspectSkillTokenBudget` 三个 lint 函数,seed 固件 → 断言 warn 等级,确定性代码单测 | 全留门禁 |
| `ai-client-policy-drift.test.ts` (82) | 锁死 prompt 文本 | 主体是**退役面漂移守卫**(六工具旧说法 / UserPromptSubmit cite hook / `.cursor/skills` / `archive-hint.cjs`),全是标识符级 | 全留门禁 |
| `archive-skill-trigger-gate.test.ts` (164) | 文件头自认脆 | 守 E1–E5 入口点检测契约,标记多为标识符(`decision:block` / `fabric-hint.cjs` / `/fabric-archive`) | 全留门禁 |
| `bootstrap-canonical.test.ts` (195) | 41 处中文正文逐字断言 | 确有真措辞锁,但只有 6 条 | **6 条移出**,余下标识符断言留门禁 |

真正移出门禁的是 6 条断言,不是 1,359 行。判据本身(标识符=契约留下 / 散文=措辞移出)是成立的,量级估错了。

## 10. 档 B 抽样复核:结论是「不要拆」

按用户要求先抽样验证再决定是否全量做。**普查全集 22 个文件**(不是提案点名的 3 个)后逐类分类 1,071 条断言:

| 类别 | 条数 | 占比 |
|---|---:|---:|
| 无字符串字面量(阈值/计数/null/布尔/结构) | 647 | 60.4% |
| 标识符/短 token 字面量(路径、命令名、skill 名、config key) | 386 | 36.0% |
| **措辞耦合** | **63** | **5.9%** |

措辞耦合那 63 条的分布(**不是散在 10,768 行里,而是集中在 3 处**):

- **38 条中文正则** `toMatch(/…/)` —— fabric-hint 28 / knowledge-hint-broad 8 / knowledge-hint-narrow 2
- **6 条真散文字面量** —— knowledge-hint 各 1(`元数据已自动刷新` / `writes here land in store team`)+ error-render 4(错误 action hint 句)
- **19 条快照** —— i18n 2 / theme-clack 5 / doctor-reskin 4 / install-renderer-reskin 3 / hud-reskin 2 / doctor-i18n 3

**提案对档 B 的定性是错的。** `fabric-hint.test.ts`(2,784 行、136 个 it、279 条断言)被描述为「Stop hook 输出的中文 nudge 文案」,实际等距抽样 18 条非中文断言全是决策引擎逻辑:阈值读取(`readArchiveHintHours` = 24)、session 锚点 ts、backlog 计数、sentinel 文件存废、`decision` 必须 undefined(守 KT-DEC-0007)、`recommended_skill` 路由。它是 hook 决策引擎的单测,不是文案测。

普查表那列「CJK 字面量断言数 28」统计的是**全文件的中文字面量**(含固件输入与注释),不是断言目标 —— 语句级重扫后 fabric-hint 的中文字面量断言是 **0** 条(它的 28 条中文断言全是正则形式)。

### 唯一值得做的小改(可选,~38 条)

`decide()` 返回值上 `.reason`(渲染文本)被断言 41 次,而结构化的 `.recommended_skill` 只被断言 8 次 —— 大量 `toMatch(/是否调 \/fabric-archive/)` 其实和已有的 `recommended_skill` 断言语义重复,只是走了渲染文本这条更脆的路。把这类改成断言结构化字段 + 计算值(`/\b20\b/`),丢掉中文框架句,是**一次约 38 条断言、3 个文件**的定点改动。

但注意:剩下的中文正则里有一部分断言的是「计算值出现在输出里」(编辑数、条目数、目录名),要做到完全无措辞耦合,得让 renderer 暴露结构化字段 —— 那是产品重构,不是测试清理。

### 结论

**不做「档 B 拆结构 vs 文案」。** 提案估的 10,768 行人工量,真实标的是 63 条断言(5.9%),其中 19 条快照本就是 `vitest -u` 一条命令的成本、且快照 diff 本身是有价值的 review 产物。投入产出不成立。

## 11. T-4 的实际标的(CI 去重)

validate job 13 步逐一核过, **只有 1 步是真冗余**:第 9 步 `NO_COLOR=1 + scoped reskin/i18n 快照`。
那 4 个文件自身就 stub 了 NO_COLOR(3 个 `vi.stubEnv`,i18n 直接赋 `process.env.NO_COLOR`),
实测 NO_COLOR 未设 / `NO_COLOR=1` / `FORCE_COLOR=1` 三种环境结果完全一致 —— 它是第 4 步
覆盖率跑的纯重复。

**删一层保险就要把它依赖的不变量入闸**:`test-strategy-gate` 原来强制 CI *步骤*字符串存在
(管不住测试文件本身漂移),现改为强制这 4 个文件各自 forces NO_COLOR,并做过反向验证
(破坏 `vi.stubEnv` → 门禁红且给可操作提示 → 还原 → PASS)。

**判定不拆并行 job。** 本地逐步耗时 build 8.7s / tsc 5.5s / coverage 41s / store-only-e2e 11.9s /
lint 0.9s / upgrade-e2e 1.4s / test:strategy 0.13s / lint-protected-tokens 0.06s。拆并行要为每个
job 重付 install+build,对 0.1~12s 的步骤是净亏。

非冗余核实记录:`lint-protected-tokens.ts`(跑真模板)与同名单测(合成输入测校验器函数)
测的不是一回事;`windows-smoke` 是另一平台;`pnpm -r build` 后再 `tsc --noEmit` 二者不等价
(tsup --dts ≠ tsc --noEmit,曾三次复发)。

**顺带发现(未处置)**:`pnpm lint` 在本地对 `tree-sitter-javascript` / `web-tree-sitter` 报
unused-dependency,但 main 上 CI 是绿的 —— 把 `install.ts` 从 git 临时恢复后报告一字不变,
证实与本轮删码无关,是本地 knip 与 CI 的解析差异。加进 `ignoreDependencies` 会把将来的真
信号一并屏蔽,故留原样记录在此。

**方法论副产品**:钉子普查第一版只匹配 `from "` 开头的 import 行,漏掉 4 个文件里的 `await import(...)`,导致删完才在 vitest 里炸出来(`tsc --noEmit` 也没拦住)。删文件前的引用普查必须同时覆盖静态与动态两种形态。
