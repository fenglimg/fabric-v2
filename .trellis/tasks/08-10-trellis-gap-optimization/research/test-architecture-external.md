# Research: 测试架构重构外部调研 (fabric-v2)

- **Query**: 为 fabric-v2 测试架构重构做外部调研 —— (A) 从本地 `cocos-test-framework` skill 提炼可迁移方法论;(B) exa/web 调研 CLI / MCP server / prompt-eval 分家 / 提速 / 反模式
- **Scope**: mixed (本地 skill + 外部 web/GitHub API + 少量 fabric 仓库现状取证)
- **Date**: 2026-08-10
- **产出定位**: 输入材料,不是结论。所有「适用/不适用」判断在最后一节,并已标注推断强度。

## 调研方法与取证说明(重要)

> 本次**没有** exa MCP 工具可用(本 agent 的 tool schema 只有 Read/Write/Bash/Skill,`ToolSearch` skill 不存在,`.mcp.json` 只挂了 fabric server,环境无 EXA/FIRECRAWL key)。
> 替代路径:Bash + `curl`(需 `dangerouslyDisableSandbox`,沙箱内网络被静默切断——curl 返回空 body 且 exit 0,注意别误判为"页面为空")+ `gh api`(已登录 `fenglimg`,可用 `search/code` 与 `contents` 直读真实仓库源码)。
> Bing RSS(`bing.com/search?...&format=rss`)可通但语义漂移严重(搜 "MCP server testing" 返回新加坡建筑业 Maintenance Control Plan),DuckDuckGo html/lite 端点均被反爬拦截。**因此本报告放弃"搜索引擎召回"路径,改为直接拉取一手权威源 + GitHub 真实仓库代码取证。**这意味着覆盖面偏"我已知的权威源",可能漏掉 2026 年新出现的小众实践 —— 这是本报告最大的已知盲区。

标注约定:
- **[事实]** = 有 URL / 文件路径 / 可复现命令 的原文佐证
- **[推断]** = 我从事实推出的,无直接出处

---

# A. 本地 skill 方法论提炼(`cocos-test-framework`)

来源:`/Users/wepie/.claude/skills/cocos-test-framework/SKILL.md`(通过 Skill 工具加载,全文已进上下文)。
下面只提炼**可迁移的架构 taste**,已剥离 Cocos/游戏场景。

## A1. 分层判据:按「反馈成本 × 唯一可证明性」切,不按「测试类型名」切

**[事实]** skill 的四层不是按 unit/integration/e2e 命名,而是按**"这层是唯一能证明什么"**定义:

| 层 | 唯一可证明的东西 | 反馈成本 |
|---|---|---|
| Layer 0 静态守卫 | 机械可判定的资产/配置坑(pre-commit lint,无运行时) | 毫秒 |
| Layer A 纯逻辑 | reducer/状态机/算法/协议契约(无引擎) | 秒级(实证 10 suites/47 tests/0.93s) |
| Layer B 组件级 | 需要真引擎才成立的生命周期/状态迁移 | 数秒~分钟 |
| Layer C E2E | 跨模块闭环 + 渲染层真的跑通 | 分钟级,需编辑器 |

**可迁移原则**:每加一层必须回答"**上一层为什么证明不了这件事**"。答不上来 = 这层测试是冗余的。
**[推断]** 这正是"295 文件冗余"最可能的成因诊断切口:大量测试落在"上一层已经能证明"的位置。

## A2. Demand-driven,显式反对覆盖率 KPI

**[事实]** skill 的第一条哲学:「Demand-driven,不追覆盖率百分比 —— spec 数量按业务需要长,不设 KPI」。
**[事实]** 且有配套的"**大多数改动应该落在【不写测试】**"的显式声明(60 秒决策树末尾:「demand-driven 的含义就是:大多数改动落在「不写」」)。

**可迁移原则**:测试数量是**结果**不是**目标**。必须存在一条被文档承认的"不写测试"出口,否则每次改动的默认动作就是加测试,套件必然单调膨胀。

## A3. 60 秒决策树:短路求值,第一个「是」即停

**[事实]** 原文四问(按序,第一个"是"即停):
1. 含决策/计算/协议/时序逻辑? → Layer A
2. 是修 bug 且属高危域? → **必附回归测试**(唯一强制项)
3. 有新的关键状态迁移?(框架级组件必须,业务组件挑最易回归的一个)→ Layer B
4. 是新的跨模块业务闭环? → 1-2 条 Layer C
四个都不是(文案/资源/视觉/平台 API 本体)→ **不写测试**

**可迁移的三个设计特征**:
- **短路**:避免"既写 A 又写 B 又写 C"的叠加式膨胀
- **唯一强制项只有一个**(bug fix 附回归测试),其余全是"可以不写"
- **末项是显式的 NO 分支**,并点名了哪些改动类型永远不测

## A4. 靶序由「缺陷回溯审计」裁决,不由直觉裁决

**[事实]** skill 有一条例行自校准机制 `docs/RETROSPECTIVE-AUDIT.md`:每季度/每 2 迭代拉全分支 fix 提交史(实证 599 条)→ 按文件域分类归因 → 排"重复修复榜" → 三种归因裁决,**用真实 fix 史推翻判据**。
**[事实]** 该审计产出了真实的判据修订,且是**推翻性**的:
- 原判「RTC/时序类 bug 不可测,归手动 smoke」→ **被推翻**,证据是单文件 6 周 15 连修全是事件时序 bug → 改判 Layer A + fake 事件序列
- 原判「Layer B 优先业务组件」→ **被推翻**,回归循环(含 fix→fix→revert 链)集中在框架级组件 → 改判框架组件优先

**可迁移原则(本 skill 最有价值的一条)**:**"该测什么"这个问题的权威答案在 git fix 史里,不在讨论里。**测试架构重构前先跑一遍"哪些文件被反复修",把测试资源重排到重复修复榜首,而不是均摊。
**[推断]** 对 fabric 直接可执行:`git log --grep=fix` 按文件归因 → 排行榜 → 对照现有 295 个测试文件的分布,大概率会看到严重错配(测试密集区 ≠ 缺陷密集区)。

## A5. 避免慢测试的具体手法

**[事实]** skill 中三条与"慢"直接相关的:
1. **重 setup 隔离到独立 config**:「真引擎 setupFiles 每个测试文件重复解析 1.4MB → Layer A 走独立 `jest.config.pure.js` 不注入引擎」——**贵的 setup 不能是全局 setup**
2. **目录即分类,不用显式清单**(2026-07-16 修订):原 `PURE_TEST_FILES` 显式清单被废弃,理由是「清单藏在 config 里分层不可感知,且清单曾引用不存在的文件而无任何报错」→ 改为 `tests/pure/` 镜像源路径,**交集为空由目录结构保证**
3. **慢层不进 CI**:「CI 路径 C(Jest+guardrail 进 CI,preview E2E 本地)」被选定,理由是单人团队 ROI —— 显式接受"最慢的一层不在 CI 跑"

## A6. 明确的"暂缓非否决"决策栏

**[事实]** skill 有一张「关键决策(已锁定)」表,里面多项是 `⏸ 暂缓` 而非 `❌ 否决`,且**带触发阈值**:UIState 状态机 `spec ≥8 后引入`、BDD DSL `spec ≥15 后评估`、CI 路径 A `spec ≥15 稳定后`。理由统一是"早引入 = 过度设计"。

**可迁移原则**:重构时对每个"要不要上基础设施"的问题,写下**触发阈值**而不是"以后再说"。这让"现在不做"变成可审计的决策而非拖延。

## A7. 反模式清单是"AI 禁止行为"格式

**[事实]** skill 用 `❌ AI 反面模式(禁止)` 直接列行为,如「修 spec 时删断言让它绿」「e2e 跑不通就跳过断言 → skip 分支必须显式记录原因」「零断言绿灯 = 有害的绿灯」。

**可迁移原则**:反模式写成**可被 grep / lint 检出的行为**,而不是原则性劝告。"每条 spec 关键动作后 ≥1 业务态断言"是可自动化校验的(vitest 有 `expect.requireAssertions` —— 见 B4)。

## A8. 不可迁移的部分(明确排除)

**[推断]** 以下是 Cocos 场景特有,fabric 无对应物,**不要照搬**:
- 真引擎挂载(mountComponent)、locators 语义定位表、录制工作流(WS 帧 + 点击录制)—— fabric 没有 UI/渲染层
- `@covers/@route/@action` 三 tag + test-graph:**动机可迁移**(让 AI 知道"改 X 会挂哪些测试"),**实现不可迁移**(fabric 用 vitest,`vitest related <file>` 原生就做这件事,见 B4)

---

# B. 业界做法调研

## B1. CLI 工具的测试分层(重度文件系统操作)

### B1.1 pnpm:真临时目录 + 目录外置 + 领域断言门面

**[事实]** pnpm 的测试脚手架不用内存 fs,用**真临时目录**。
源码 `pnpm11/__utils__/prepare-temp-dir/src/index.ts`(via `gh api repos/pnpm/pnpm/contents/...`):
```ts
// The testing folder should be outside of the project to avoid lookup in the project's node_modules
// Not using the OS temp directory due to issues on Windows CI.
const tmpBaseDir = path.join(import.meta.dirname, '../../../../../pnpm_tmp')
const tmpPath = path.join(tmpBaseDir, `${getFilesCountInDir(tmpBaseDir)}_${process.pid}`)
let dirNumber = 0
export function tempDir (chdir = true): string {
  dirNumber++
  const tmpDir = path.join(tmpPath, dirNumber.toString())
  fs.mkdirSync(tmpDir, { recursive: true })
  if (chdir) process.chdir(tmpDir)
  return tmpDir
}
```
三个可直接抄的设计点(全是**注释里写明的踩坑记录**):
1. **临时目录放项目外**,否则被测代码会向上查找命中项目自己的 `node_modules`
2. **不用 OS temp dir**,理由是 Windows CI 有问题
3. **目录名 = `<序号>_<pid>` + 进程内自增 `dirNumber`** → 每个测试拿到唯一路径,**天然可并行,无需串行化**

**[事实]** `pnpm11/__utils__/prepare/src/index.ts` 暴露 `prepare(manifest)` / `preparePackages(pkgs)` / `prepareEmpty()`,返回 `assertProject(dir)` 的门面对象。
**[事实]** `pnpm11/__utils__/assert-project/src/index.ts` 的 `Project` 接口是**领域语言断言**而非裸 fs 断言:
```ts
export interface Project {
  has: (pkgName: string, modulesDir?: string) => void
  hasNot: (pkgName: string, modulesDir?: string) => void
  storeHas / storeHasNot / cafsHas / cafsHasNot / isExecutable
  readLockfile / readCurrentLockfile / readModulesManifest
}
```
**可迁移原则**:重文件系统的 CLI,测试的表达单位应是**领域动词**(`project.has('foo')`),不是 `expect(existsSync(join(dir,'node_modules','foo'))).toBe(true)`。这一层门面同时消灭了 fixture 断言的大量重复代码。

**[事实]** pnpm 还用 `@pnpm/testing.registry-mock`(assert-project 里 import `REGISTRY_MOCK_PORT`)—— 昂贵的外部依赖(npm registry)被替换为**本地假服务**,而不是被 mock 掉整个模块。

### B1.2 oclif:官方测试工具走「进程内调用」而非 spawn 二进制

**[事实]** `@oclif/test` README(`gh api repos/oclif/test/contents/README.md`)提供三个 API:`captureOutput`(捕获回调的 stdout/stderr/返回值/错误)、`runCommand`(**进程内**跑一条命令拿 stdout/stderr/返回值/错误)、`runHook`。全部无 spawn。
**[事实]** README 有一条运行器配置警告:「In order for these utilities to capture all output to the terminal, you must disable any console output interception —— Vitest 用户需开 `disableConsoleIntercept`」。

**可迁移原则**:CLI 的绝大多数测试应该是**进程内调用 command handler**(毫秒级),而不是 spawn 真二进制(每次几百毫秒 + 需要先 build)。spawn 只保留给"必须证明打包产物/shebang/bin 链路可用"的极少数冒烟用例。
**[推断]** 这一条对 fabric 的杠杆很大:145 个 CLI 测试若有相当比例在 spawn 或跑完整 install,进程内化 + 少量 spawn 冒烟能砍掉大部分时间。

### B1.3 内存 fs vs 真临时目录

**[事实]** `memfs`(README via gh api)定位为「Implementation of in-memory Node.js `fs` module API」,并额外提供 `snapshot` 与 `print` 目录树工具。
**[事实]** pnpm(B1.1)在有 memfs 可选的前提下,**选择了真临时目录**,并在注释里记录了真实约束(node_modules 查找、Windows CI)。

**[推断]** 结论不是"memfs 好"或"真目录好",而是**判据**:
- 被测代码只用 `node:fs` API 且不 spawn 子进程 / 不被第三方原生模块读取 → memfs 可行,快
- 被测代码会 `chdir`、被子进程读取、依赖 rename 原子性、依赖 node_modules 解析 → **必须真目录**(memfs 打不进子进程,也不实现真 rename 语义)
- **fabric 的 install 路径写 hook `.cjs` + skill `.md` 并被外部客户端读取,属于后者**;但 fabric 的**纯 path 计算 / 模板渲染 / 配置合并**属于前者,根本不该碰 fs。

### B1.4 「避免每个测试都跑完整 install」的通用手法

**[推断]**(此条无单一权威出处,是从 B1.1/B1.2 的结构推出的)业界公认的三段式:
1. **一次昂贵 setup,多次只读断言**:在 `beforeAll` 跑一次真 install 到临时根,后续 N 个 `it` 只做只读断言。fabric 的 `packages/cli/__tests__/integration/parity-matrix-e2e.test.ts` 已经在这么做 —— 其注释自陈:「does a **single fresh install**, then asserts EVERY (capability × supported client) cell」。
2. **纯函数化 planner**:让 install 先产出一份"要写哪些文件/内容"的**计划对象**,绝大多数测试断言这个计划(零 IO),只留极少数测试真正执行落盘。
3. **fixture 目录复制而非重建**:准备一份 golden fixture 树,测试时 `cp -R` 到临时目录(一次 syscall 批量)而不是逐文件生成。

## B2. MCP server 的测试实践

### B2.1 官方 TypeScript SDK 有一份专门的 testing how-to(这是本方向最权威的一手源)

**[事实]** `modelcontextprotocol/typescript-sdk` 仓库内 `docs/testing.md`(via `gh api repos/modelcontextprotocol/typescript-sdk/contents/docs/testing.md`)。开篇一句话就是官方立场:

> **Drive your server through a real `Client`, in-process — no port, no socket, no mock transport.**

原文给出的四种手法,按优先级:

1. **`handler.fetch` 进程内服务**(2026-07-28 协议版本的推荐入口):
```ts
const handler = createMcpHandler(createServer);
const transport = new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
  fetch: (url, init) => handler.fetch(new Request(url, init))
});
```
原文:「The transport never dials `http://test.local/mcp` — `handler.fetch` serves every request in-process, through the same `createMcpHandler` you deploy.」

2. **`InMemoryTransport.createLinkedPair()`**:「returns two transports that are each other's wire」。原文注明:「`createLinkedPair` connects **2025-era instances only**;`handler.fetch` is the in-process entry for 2026-07-28 coverage」—— 版本相关,选错会覆盖不到新协议。

3. **断言约定(重要且反直觉)**:
   - 断 `structuredContent` 走 happy path
   - 「a handler failure resolves as an **ordinary result with `isError: true`**, not a thrown error」→ **`await expect(...).rejects` 是错的写法**
   - 「Arguments the input schema rejects produce the **same** `isError: true` result, so they assert the same way」→ schema 拒绝与业务失败断言形状一致

4. **teardown 有顺序要求**:「Close both ends in your runner's `afterEach` — **the client first, then the handler**」,理由是「`handler.close()` aborts any exchange still in flight, so a hung tool call cannot leak into the next test」。

5. **stdio 没有进程内捷径**:「Stdio has no in-process shortcut: `StdioClientTransport` **spawns the command** and connects to the child over its stdin and stdout」。

**[事实]** 官方的"Recap"直接给了分层结论:「One `Client` plus one `createMcpHandler` is a **complete no-socket integration test** of the server you deploy.」

**[推断]** 对 fabric(stdio MCP server)的直接含义:**协议层不需要每个 tool 都 spawn 进程**。把 server 工厂函数化,用 `InMemoryTransport.createLinkedPair()` 挂一个真 `Client`,就能覆盖 tool 注册 / schema 校验 / 结果形状 / 错误语义;真正 spawn stdio 只留 1-2 条"二进制能起来且握手成功"的冒烟。

### B2.2 MCP Inspector 的定位

**[事实]** `modelcontextprotocol` GitHub org 下有 inspector 项目(org 页面可见)。
**[推断 — 低置信,未取到一手文档]** Inspector 是**交互式人工调试工具**,不是 CI test harness。我没有拉到 Inspector README 原文来佐证这一点(搜索引擎路径失败),**这条请勿直接引用,需要时应另行核实**。

### B2.3 官方是否有"tool schema 契约测试"推荐

**[事实]** `docs/testing.md` 全文没有提出独立的 schema 契约测试概念;它把 schema 校验**折叠进同一套 `callTool` 断言**里(见 B2.1 第 3 点:schema 拒绝产生同形状 `isError: true`)。
**[推断]** 即官方立场是「**不要为 tool schema 单独建一层测试**」——通过真 Client 调一次就同时覆盖了注册、schema、执行、错误。这与用户"减少冗余层"的诉求方向一致。

## B3. 「prompt / AI 行为」如何与代码测试分离(重点)

这是用户诉求的核心。业界共识存在,且相当明确。

### B3.1 分级共识:eval 有自己的层级体系,且**只有最便宜的 Level 1 才进每次 CI**

**[事实]** Hamel Husain,《Your AI Product Needs Evals》(https://hamel.dev/blog/posts/evals/)—— 该领域被引用最多的实践文章。原文给出三级:

> There are three levels of evaluation to consider:
> **Level 1: Unit Tests** / **Level 2: Model & Human Eval** / **Level 3: A/B testing**
> The cost of Level 3 > Level 2 > Level 1. This dictates the cadence and manner you execute them.
> I often run **Level 1 evals on every code change**, Level 2 on a **set cadence** and Level 3 **only after significant product changes**.

**[事实]** 对 Level 1 的定义(注意:它**不是**"跑模型"):
> Unit tests for LLMs are **assertions (like you would write in pytest)**. ... The important part is that these assertions should **run fast and cheaply** as you develop your application so that you can run them every time your code changes.

**[事实]** 原文给的 Level 1 实例是**纯正则 / 纯结构断言,零模型调用**:
```js
const noExposedUUID = message => {
  const sanitizedComment = message.comment.replace(/\{\{.*?\}\}/g, '')
  const regexp = /[0-9a-f]{8}-[0-9a-f]{4}-.../ig
  expect(Array.from(sanitizedComment.matchAll(regexp)).length, 'Exposed UUIDs').to.equal(0)
}
```
以及「Only one listing matches → `len(listing_array) == 1`」这类**结构性断言**(断数量/断字段存在性,不断措辞)。

**这直接支撑用户提出的原则**:「需要靠 AI 运行时验证的东西不要集成进单元测试」——业界做法不是"不测",而是:
- **能用确定性断言表达的**(结构、字段、禁止出现的模式)→ 留在单元测试,零模型调用,每次 CI 跑
- **需要模型/人判断的**(措辞质量、是否遵循意图)→ 移到独立 eval 套件,**按 cadence 跑,不进每次 CI**

### B3.2 工具层面确实分家:eval 是独立 pipeline,独立命令,独立配置

**[事实]** promptfoo CI/CD 文档(https://www.promptfoo.dev/docs/integrations/ci-cd/):eval 是**独立命令 + 独立配置文件**,不寄生在单元测试运行器里:
```
npx promptfoo@latest eval -c promptfooconfig.yaml -o results.json
npx promptfoo@latest redteam run
```
**[事实]** 其前置条件明确包含「**LLM provider API keys** (stored as secure environment variables)」——即 eval 天然需要 secrets 与网络,这本身就是它不能进普通单测的硬约束。
**[事实]** 文档把 eval 的价值定位为「Catch regressions early / Quality gates(enforce **minimum performance thresholds**)/ **Cost control - Track token usage and API costs over time**」——注意 eval 的通过标准是**阈值/分数**,不是布尔断言。

**[推断]** 这是 eval 与 unit test 无法合并的根本原因,可以作为写进 fabric 规约的一句话判据:
> **单元测试的输出是布尔(过/不过),eval 的输出是分数(比上次好/差)。把分数塞进布尔 gate 必然产出 flaky 测试。**

### B3.3 「只测结构不测措辞」

**[事实]** 直接支撑来自 B3.1 的 Rechat 案例:所有 Level 1 断言都是结构性的(`len(...) == 1`、UUID 正则不命中),**没有一条断言 LLM 输出的自然语言措辞**。
**[推断 — 对 fabric 的映射]** fabric 分发 skill markdown 与 hook `.cjs`:
- **该测**:文件被写到了正确路径、frontmatter 字段齐全且合法(name/description/allowed-tools)、模板变量全部被替换(无残留 `{{...}}`)、引用的 skill/hook 名在 registry 中存在、生成的 JSON(settings.json / hooks.json)结构合法
- **不该测**:prompt 正文措辞、章节顺序、某句话在不在里面、AI 读了会不会照做
- 已发现 fabric 现状中有 7 个测试文件在断言 prompt/skill markdown 内容(`doctor-skill-lints.test.ts`、`extract-knowledge.test.ts`、`plan-context.test.ts` 等,见"fabric 现状取证"),**这批是本次重构最该逐条过一遍的候选**

### B3.4 golden file 在这里的位置

**[推断 — 无直接出处]** 我没找到关于"prompt golden file"的权威表态。基于 B5.1 的 snapshot 批判,我的判断是:**prompt 正文不适合 golden file**(它天然频繁变更,会退化成"改完就 `-u` 刷新"的橡皮图章);但**结构化产物**(生成的 settings.json / hooks.json / 目录清单)适合 golden file,因为它们变更少且每次变更都应该被人看见。此条为推断,置信度中等。

## B4. 测试提速的通用杠杆(vitest)

全部来自 vitest 官方文档:https://vitest.dev/guide/improving-performance 与 https://vitest.dev/guide/cli.html(LLM 友好版:在 URL 后加 `.md`,例如 `https://vitest.dev/guide/projects.md`,返回纯 markdown,拉取成本远低于 HTML)。

### B4.1 隔离(isolation)—— 通常是最大的单点杠杆

**[事实]** 「By default Vitest runs every test file in an isolated environment based on the pool ... **This greatly increases test times**, which might not be desirable for projects that don't rely on side effects and properly cleanup their state (**which is usually true for projects with node environment**).」
**[事实]** 关掉:`--no-isolate` 或 `test.isolate: false`。
**[事实]** 可**按文件粒度**保留隔离,官方给的正是 projects 写法:
```ts
projects: [
  { test: { name: 'Isolated',     isolate: true,  exclude: ['**.non-isolated.test.ts'] } },
  { test: { name: 'Non-isolated', isolate: false, include: ['**.non-isolated.test.ts'] } },
]
```
**[事实]** 「If you are using `vmThreads` pool, you cannot disable isolation. Use `threads` pool instead.」

### B4.2 pool 选择

**[事实]** 「By default Vitest runs tests in `pool: 'forks'`. While `'forks'` pool is better for compatibility issues (hanging process and segfaults), it **may be slightly slower than `pool: 'threads'`** in larger projects.」

### B4.3 projects(前身叫 workspace,3.2 起 workspace 已废弃)

**[事实]** https://vitest.dev/guide/projects.md:「Vitest provides a way to define multiple project configurations **within a single Vitest process**. ... particularly useful for monorepo setups but can also be used to run tests with **different configurations**」
```ts
export default defineConfig({ test: { projects: ['packages/*'] } })
```
**[事实]** 命名约束:project 配置文件名须以 `vitest.config`/`vite.config` 开头,或匹配 `vitest.<name>.config.*`(合法例:`vitest.unit.config.ts`、`vitest.e2e-node.config.ts`)。
**[事实]** CLI 过滤:`--project=<name>`,可重复,支持通配 `--project=packages*`,支持排除 `--project='!pattern'`。

**[推断]** 这正是 A5「贵的 setup 不能是全局 setup」在 vitest 里的落地件:把"纯逻辑(零 IO)"与"真 fs install"拆成两个 project,前者 `isolate:false` + `threads` + 高并行,后者保留隔离。日常开发只跑 `--project=unit`。

### B4.4 只跑受影响的测试

**[事实]** `vitest related <files...>`:「Run only tests that cover a list of source files. Works with **static imports** ... but **not the dynamic ones** (e.g. `import(filepath)`). Useful to run with **lint-staged** or with your CI setup.」官方给的 lint-staged 配置(注意必须加 `--run`,否则进 watch 模式挂住):
```js
export default { '*.{js,ts}': 'vitest related --run' }
```
**[事实]** `--changed`:「Run tests only against changed files. If no value is provided, it will run tests against **uncommitted changes** (including staged and unstaged). ... `--changed HEAD~1` / commit hash / branch name (`--changed origin/develop`)」。
**[事实]** 配套 `forceRerunTriggers`:「If paired with the `forceRerunTriggers` config option it will run the **whole** test suite if at least one of the files listed changes. **By default, changes to the Vitest config file and package.json will always rerun the whole suite.**」
**[事实]** `--coverage.changed <commit/branch>` 可让覆盖率只统计变更文件,默认继承 `--changed`。

**⚠ [事实+推断] 对 fabric 的重要警告**:`vitest related` **只跟静态 import**。fabric 分发的 hook `.cjs` 与 skill `.md` 是**数据资产**,不是被 import 的模块 —— 改了模板文件,`related`/`--changed` **不会**触发相关测试。**[推断]** 需要用 `forceRerunTriggers` 把模板/资产目录显式登记进去,否则"只跑受影响测试"会漏。

### B4.5 分片(多机才有意义)

**[事实]** `vitest run --reporter=blob --shard=1/3`,各机产物落 `.vitest-reports/`,再 `vitest run --merge-reports` 合并;官方给了完整 GitHub Actions matrix 示例,参考实现 https://github.com/vitest-tests/test-sharding。
**[事实]** 重要限制:「Vitest splits your **test files**, not your test cases, into shards. If you've got 1000 test files, `--shard=1/4` will run 250 test files, **no matter how many test cases** individual files have.」
**[推断]** → 若时间集中在少数几个巨型文件(fabric 很可能如此:平均 71K/295 ≈ 240 行/文件,但 install/parity 类文件必然远超),分片收益会被长尾文件吃掉。**分片前先量出 per-file 耗时分布**。

### B4.6 其他官方杠杆

**[事实]** `test.dir` 限制搜索目录:「should make the search faster if you have unrelated folders and files in the root directory」。**[推断]** fabric 仓库根有 `tmp/` 塞满了 EagleRAG/mem0/trellis 等第三方仓(census 已见),这些目录里全是别人的测试与 vitest.config —— 极可能拖慢文件扫描,应显式排除。
**[事实]** `experimental.fsModuleCache`:把 watch 模式的转译缓存持久化到磁盘跨 rerun 复用。官方实测(>900 模块的单文件):首跑 `8.75s` → 二跑 `5.90s`(transform 4.02s → 842ms)。官方注明「For full test suites, parallelization already mitigates the cost」——**只对"跑少数文件"提速明显**。
**[事实]** `--no-file-parallelism`「might also be desirable to disable parallelism **to improve startup time**」(注意:这是极少数情况,fabric 现在是被迫全局关掉,见下)。
**[事实]** `expect.requireAssertions`(CLI/config):「Require that all tests have at least one assertion」—— **这是 A7「零断言绿灯」的原生实现**,可直接开。
**[事实]** `slowTestThreshold`(默认 300ms)、`--logHeapUsage`、`experimental.importDurations.print`(打印 import 耗时明细,`thresholds.warn` 默认 100ms / `danger` 500ms,`failOnDanger` 可让超重 import 直接失败)—— 这组是**定位慢源**的工具,重构前应先用它们量数据。

## B5. 反模式

### B5.1 过度快照(snapshot)

**[事实]** Kent C. Dodds《Effective Snapshot Testing》(https://kentcdodds.com/blog/effective-snapshot-testing)整篇转录了 Justin Searls 的四点批判(原文引用):
> 1. They are **tests you don't understand**, so when they fail, you don't usually understand why or how to fix it.
> 2. Good tests **encode the developer's intention**, they don't only lock in the test's behavior without editorialization of what's important and why. Snapshot tests lack (or at least, fail to encourage) expressing the author's intent.
> 3. They are **generated files**, and developers tend to be undisciplined about scrutinizing generated files before committing them. Most developers, upon seeing a snapshot test fail, will sooner **just nuke the snapshot and record a fresh passing one** instead of agonizing over what broke it.
> 4. Because they're more integrated and try to serialize an incomplete system ... they will tend to have **high false-negatives** ... False negatives quickly erode the team's trust in a test.

**[事实]** 结论句:「These four things lead to a **near total loss in the intended utility** of integrated/functional tests」。

### B5.2 测实现细节

**[事实]** Kent C. Dodds《Testing Implementation Details》(https://kentcdodds.com/blog/testing-implementation-details)给出两个正交理由:
> Tests which test implementation details:
> 1. **Can break when you refactor** application code. **False negatives**
> 2. **May not fail when you break** application code. **False positives**

**[事实]** 具体被点名的 API:enzyme 的 `shallow` 渲染、`instance()`、`state()`、`find('ComponentName')`。
**[推断 — 映射到 fabric]** 对应物是:断言私有函数、断言中间数据结构、断言"调用了哪个内部函数几次"(`toHaveBeenCalledTimes` 打在内部实现上)、断言日志措辞。这类测试在 fabric 这种"重构频繁 + 无用户"(项目已确立 clean-slate 偏好)的阶段成本最高 —— 每次重构都要改一批测试却没换来任何 bug 检出。

### B5.3 金字塔倒挂 / 层级选错

**[事实]** Ham Vocke,《The Practical Test Pyramid》(https://martinfowler.com/articles/practical-test-pyramid.html, martinfowler.com, 2018):「The "Test Pyramid" is a metaphor that tells us to group software tests into buckets of **different granularity**. It also gives an idea of **how many** tests we should have in each of these groups. Although the concept ... has been around for a while, **teams still struggle to put it into practice properly**.」
**[推断]** 对 fabric 具体的倒挂形态是"**中间层膨胀**":大量测试跑真 install(重),而它们要验证的其实是路径拼接/模板渲染(轻)。这不是经典的 e2e 过多,而是**每个测试的成本相对它验证的东西过高**。

### B5.4 parity / 矩阵测试代替消除重复(用户点名的反模式)

**[事实 — fabric 内部取证]** `packages/cli/__tests__/integration/parity-matrix-e2e.test.ts`(146 行)的自陈注释:
> 「The P0 contract stub at `packages/shared/src/parity/parity-matrix.json` declares, per capability, which of the 2 clients support it. This test does a single fresh install, then asserts **EVERY (capability × supported client) cell** is actually delivered — **100% of the matrix, not a hand-picked subset**.」
且文件内维护着 `HOOK_SCRIPT` 与 `CLIENT_DIR` 两张手工映射表(`claudeCode → .claude` / `codexCLI → .codex`)。

**[推断]** 这是典型的"用测试锁住重复,而不是消除重复":两个客户端的安装逻辑各写一份 → 靠矩阵测试保证它们一致。替代做法是让两个客户端共享一个 emitter,差异收敛成一份数据表(client descriptor),那么"parity"就变成**类型系统 + 一条 descriptor 完整性测试**,矩阵 e2e 可以整个删掉。此为推断,需要读 install 实现才能确认可行性。
**[事实]** 注意该文件本身实现是**好的**(单次 install + 全矩阵只读断言,正是 B1.4 的手法);问题不在这个文件,在于**它存在的必要性来自上游的重复**。

### B5.5 「靠串行化掩盖并发缺陷」(fabric 现状,最贵的一条)

**[事实 — fabric 内部取证]** `packages/cli/vitest.config.ts` 设了 `fileParallelism: false`,注释自陈:
> 「Run test FILES serially. The install/uninstall/clone integration suites do **real bootstrap writes (~93 hook/skill files each** via atomic temp-file + rename). Under high file-parallelism ..., those concurrent `rename()` syscalls sporadically race the OS filesystem → ENOENT ... → flaky byte-exact assertions (**30+ non-deterministic failures locally, all green serially**). Production never runs 14 installs at once, so this is a test-load artifact, not a product bug」

**[推断 — 高置信]** 这是「执行时间长」的**直接主因**:145 个 CLI 测试文件全部串行,且其中多个各写 ~93 个文件。
对照 B1.1:pnpm 面对**同一类问题**(并发 install 到临时目录)的解法不是串行化,而是**给每个测试唯一的、项目外的临时目录路径**(`<序号>_<pid>/<自增>`)。如果 fabric 的竞态源于多个测试写入同一路径或共享临时根,pnpm 的方案能在**保留全并行**的前提下消除竞态。
**[事实]** 现状统计:305 个测试文件里 **168 个**用 `mkdtemp`/`os.tmpdir`(55%),只有 3 个用 memfs/mock fs。
**[推断]** `os.tmpdir()` 本身正是 pnpm 注释里点名规避的东西(Windows CI 问题);且若多个测试在 `mkdtemp` 之外还 `chdir` 到共享位置,并行下必然互相踩。**这条值得作为重构的第一个技术调查项 —— 若成立,单点解决可能就是最大的提速。**

### B5.6 其他被广泛批评的做法(**[推断]**,无本次一手出处)

- 覆盖率阈值当质量目标(fabric 现设 `thresholds: { lines: 70, statements: 70 }`)—— 会激励"为达标而写的低价值测试",与 A2 直接冲突
- 每个文件一个 `describe` 镜像源码结构 → 测试组织跟着实现走,重构必连坐(B5.2 的组织学版本)
- mock 到只剩 mock 在自我验证

---

# C. 对 fabric 的适配建议

**说明**:本节全部是 **[推断]**,基于 A/B 的事实与下面这份 fabric 现状取证。落地前应逐条验证。

## C0. fabric 现状取证(本次实测,可复现)

| 指标 | 值 | 取证方式 |
|---|---|---|
| cli | 145 文件 / 32,313 行 | `find packages/cli -name '*.test.ts' \| wc -l` |
| server | 96 文件 / 28,882 行 | 同上 |
| shared | 54 文件 / 10,012 行 | 同上 |
| server-http-experimental | 10 文件 / 1,889 行 | 同上 |
| **合计** | **305 文件 / 73,096 行** | (与用户所说 295/71K 基本吻合) |
| 用真 fs 临时目录 | **168 文件(55%)** | `grep -rl 'mkdtemp\|os.tmpdir'` |
| 用 memfs/mock fs | 3 文件 | `grep -rl 'memfs\|mock-fs\|vi.mock(.node:fs'` |
| 用 snapshot | 12 文件 | `grep -rlc 'toMatchSnapshot\|toMatchInlineSnapshot'` |
| 断言 prompt/skill markdown 内容 | 7 文件 | `grep -rl 'skills/.*\.md\|SKILL\.md\|prompt'` |
| CLI 包并行 | **全局关闭**(`fileParallelism: false`) | `packages/cli/vitest.config.ts` |
| vitest 配置 | 4 份独立 config,**无根级 projects 聚合** | `find -name 'vitest.config*'` |
| 覆盖率阈值 | lines/statements 70% | `packages/cli/vitest.config.ts` |

## C1. 适用(建议采纳,按预期杠杆排序)

| # | 做法 | 出处 | 对 fabric 的形态 |
|---|---|---|---|
| 1 | **唯一临时目录路径 + 项目外 + `<pid>_<自增>` 命名,换回全并行** | pnpm `prepare-temp-dir` (B1.1) | 直接针对 `fileParallelism:false`(B5.5)。**先验证竞态是否真源于路径共享**;若是,这一条单独就可能是最大提速 |
| 2 | **拆 vitest projects:`unit`(零 IO,`isolate:false`+`threads`)/ `fs`(真目录,保留隔离)** | vitest projects + isolation (B4.1/B4.3) | 日常 `--project=unit`,CI 跑全量。落地件即 A5「贵的 setup 不能是全局 setup」 |
| 3 | **CLI 命令进程内调用,spawn 只留冒烟** | `@oclif/test` (B1.2) | 需配 `disableConsoleIntercept` 才能捕获输出 |
| 4 | **MCP server 用真 `Client` + `InMemoryTransport.createLinkedPair()` 测,不 spawn** | MCP 官方 `docs/testing.md` (B2.1) | 同时覆盖注册/schema/结果形状/错误语义;`isError:true` 是 resolve 不是 throw;`afterEach` 先关 client 再关 handler |
| 5 | **prompt/skill 内容测试改为「只测结构不测措辞」** | Hamel L1 (B3.1) | 测:路径/frontmatter 合法性/无残留模板变量/引用存在性/生成 JSON 结构。**不测**正文措辞。直接对应用户原则,当前 7 个文件是候选 |
| 6 | **install 拆出纯函数 planner,多数测试断言 plan 对象** | B1.4 推断 + A1 分层判据 | 把 55% 的 fs 测试往下压到 unit project |
| 7 | **领域断言门面** `assertInstalled(dir).hasHook('x').hasSkill('y')` | pnpm `assert-project` (B1.1) | 消灭大量 fixture 断言重复;冗余感的一大来源 |
| 8 | **先量后砍**:`slowTestThreshold` / `--logHeapUsage` / `experimental.importDurations` 拿 per-file 耗时分布 | vitest CLI (B4.6) | **重构前必做**,否则优化打在错的地方 |
| 9 | **`test.dir` / exclude 排除 `tmp/`** | vitest `test.dir` (B4.6) | 仓库 `tmp/` 下有十几个第三方仓及其 vitest.config |
| 10 | **开 `expect.requireAssertions`** | vitest (B4.6) + A7 零断言绿灯 | 原生实现 skill 的核心纪律 |
| 11 | **`vitest related --run` 挂 lint-staged;`--changed` 进 PR CI** | vitest (B4.4) | ⚠ 必须配 `forceRerunTriggers` 覆盖 hook/skill 模板资产(非静态 import,related 追不到) |
| 12 | **缺陷回溯审计定靶序** | skill `RETROSPECTIVE-AUDIT.md` (A4) | `git log --grep=fix` 归因 → 重复修复榜 → 对照 305 个测试文件分布找错配 |
| 13 | **写一棵短路决策树 + 显式「不写测试」出口** | skill 60 秒决策 (A2/A3) | 进 `.trellis/spec/`;唯一强制项 = bug fix 附回归测试 |
| 14 | **12 个 snapshot 文件逐个复核** | Searls 四点 (B5.1) | 保留:变更少 + 每次变更都该被人看见的结构化产物;删掉:锁 prompt 正文的 |
| 15 | **消除 parity 重复,而非用矩阵测试锁住重复** | B5.4 | 共享 emitter + client descriptor 数据表 → 矩阵 e2e 可删。需读 install 实现确认 |

## C2. 不适用 / 需要打折(因为 fabric 是知识层 CLI)

| # | 业界做法 | 为什么不适用 fabric |
|---|---|---|
| 1 | **全面改用 memfs** | fabric 的产物要被**外部进程**(Claude Code / Codex CLI)读取,且依赖 atomic temp-file + rename 的真语义;memfs 打不进子进程也不复刻 rename 语义(B1.3)。**只有纯 path 计算/模板渲染/配置合并层适合免 fs —— 而它们本就不该碰 fs** |
| 2 | **测试分片 `--shard`** | 分片切**文件**不切用例(B4.5);fabric 是单人项目、单机 CI,收益主要来自多机。且时间大概率集中在少数巨型 install 文件,分片会被长尾吃掉。**先做 C1-1/C1-2,分片留到多机再说** |
| 3 | **promptfoo / LLM-as-judge eval 套件** | 方向正确但**当前不必上**。fabric 的 AI 面产物是 markdown skill 与 hook 提示,不是需要打分的模型输出;真正需要 judge 的是"AI 读了这个 skill 会不会照做",而这在当前阶段用人工 dogfood 判断的 ROI 远高于建 eval pipeline。**按 A6「暂缓非否决 + 写触发阈值」处理**,建议阈值:当 skill 数量 ≥N 或出现过 ≥2 次"改了 prompt 导致 AI 行为回归"的真实事故时再评估 |
| 4 | **Level 2/3 eval(模型评/AB 测)** | fabric 无线上流量、无用户(项目已确立 pre-user clean-slate 阶段),AB 测无从谈起 |
| 5 | **Cocos skill 的三 tag + test-graph** | 动机(让 AI 知道改 X 挂哪些测试)可迁移,实现不必自建 —— `vitest related <file>` 原生提供(B4.4)。**别造 test-graph 轮子**,但要补 `forceRerunTriggers` 覆盖非 import 型资产 |
| 6 | **Cocos Layer B/C(真引擎组件测试 / Playwright)** | fabric 无 UI、无渲染层、无浏览器。对应位置是 MCP 协议层(C1-4)与 CLI 冒烟,量级小得多 |
| 7 | **`--no-isolate` 全局开启** | 只对"不依赖副作用且正确清理状态"的测试成立(vitest 原文限定,B4.1)。fabric 一半以上测试**就是**在做副作用(写文件、chdir)。**必须按 project 分开**,不能一刀切 |
| 8 | **覆盖率阈值 70% 保留** | 与 A2 demand-driven 直接冲突;砍测试时它会变成阻力,把已被判定为冗余的测试锁在原地 |
| 9 | **MCP `InMemoryTransport.createLinkedPair()` 无脑用** | 官方注明它「connects **2025-era instances only**」(B2.1);若 fabric server 要覆盖 2026-07-28 协议版本,需用 `handler.fetch` 路径。**用前先核对 fabric 依赖的 SDK 版本与协议版本** |

## C3. 一句话判据(建议写进 spec)

**[推断,综合 A1 + B3.2]**
> **单元测试的输出是布尔,eval 的输出是分数。**
> 加一层测试前必须回答"上一层为什么证明不了这件事";
> 断言前必须回答"这条断言的失败是布尔还是分数" —— 是分数的,不进单元测试。

---

## Caveats / Not Found

1. **exa MCP 不可用**,本次未按原任务指定的工具路径执行。改用 curl + gh api 直取一手源;搜索引擎召回环节缺失,**可能漏掉 2026 年新出现的小众实践**。这是本报告最大盲区。
2. **MCP Inspector 定位未取证**(B2.2)——「Inspector 是人工调试工具而非 CI harness」是我的推断,**未拉到 README 原文**,引用前请核实。
3. **未找到 MCP 生态"官方推荐的 test harness"**除 SDK `docs/testing.md` 之外的东西;也未找到独立的 tool-schema 契约测试推荐(B2.3 的判断是"官方把它折叠进了 callTool 断言",属推断)。
4. **turborepo / create-vite 的测试策略未取到**:`gh api search/code` 对这两个仓的查询返回空(可能是 code search 索引限制或查询词不当),因此 B1 的项目佐证只有 pnpm 与 oclif 两个。
5. **"prompt golden file"无权威表态**(B3.4),该条为纯推断。
6. **未实测 fabric 测试耗时**:没有跑 `vitest run` 量 per-file 耗时(会很慢,且不在本次 research 范围)。C1-8 之所以排在前面,正是因为**慢的归因目前仍是推断**(基于 `fileParallelism:false` + 168 个真 fs 文件),不是实测。
7. **C2-5 建议"别造 test-graph"有个未验证前提**:fabric 的模板资产若不是通过静态 import 被引用,`vitest related` 的失效范围可能比 `forceRerunTriggers` 能补的更大。需要看实际的模板加载方式(读文件 vs import)。
8. 本报告**未读 fabric 的任何测试文件正文**(除 parity-matrix-e2e 的头 40 行与 vitest.config),现状取证全部基于 grep 计数。计数会有误差(如 `grep 'prompt'` 可能误命中)。
