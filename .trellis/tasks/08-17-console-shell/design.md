# 控制台骨架 — 技术设计

## 0. 现状核实（动手前的前提校准）

读 `packages/cli/src/commands/preview.ts`（671 行）与 `templates/preview/`（只有 `lumen.html`，2220 行）后，三条与 PRD 假设不符或需要修正的事实：

### 0.1 C1 当前是**被违反**的 —— `--host` 可以绑 `0.0.0.0`

`previewCommand` 暴露 `--host`（`preview.ts:608`），`startPreviewServer` 直接 `options.host ?? LOOPBACK_HOST` 拿去 `server.listen(p, host)`（`preview.ts:503,562`）。文件顶部注释与 `preview.ts:557` 的行内注释都写着「binds 127.0.0.1 ONLY (never 0.0.0.0)」—— **注释描述的不变量并不成立**，flag 就在同一个文件里。

今天危害有限：服务是 GET-only 只读，最坏是局域网内可读知识库。但本任务正要加写通道，届时同一个 flag 会把它升级成「局域网任意机器可改本机 Fabric 配置」。

**所以本任务的第一步是删 `--host`，而不是加页面。** 核实过 4 个既有 preview 测试（`preview-graph` / `preview-port-fallback` / `preview-source-toggle` / `preview-title`）无一使用 `host`，删除零测试改动。

`RunPreviewOptions.host` 作为**内部选项**保留（测试需要，且不经 CLI 暴露），但收窄为「仅接受 loopback 字面量」——见 §3。

> 这一条同时说明为什么 C1 要求「需有测试锁死」而不是「注释写清楚」：这个不变量已经有两处注释声明，且都是错的。注释不是门禁。

### 0.2 两个页面用了两套不兼容的实现方式

| 页面 | 实现 | 样式来源 |
| --- | --- | --- |
| `/` | 读磁盘模板 `templates/preview/lumen.html` | 文件内 75KB 自带 CSS |
| `/graph` | TS 里的模板字符串 `renderGraphView()`（`preview.ts:184-453`，270 行） | 函数内**手抄一份**的 `:root{--bg…}` 变量块 |

`/graph` 里的 `--bg / --surface / --border / --text / --text2` 及深色模式媒体查询是从 lumen 复制来的字面量。AC6（改一处两页同时生效）今天不成立——改一个色号要改两处，且没有任何东西会提醒你漏了一处。

这也解释了 PRD Notes 里「2220 行接近可维护上限」的判断为什么低估了问题：真正的债不是单文件太长，是**已经开始复制**。

### 0.3 KT-DEC-0080 的机制描述已过期（原则仍适用）

条目描述的「7 个 style variant + 专用 `/all` 页」在代码中均不存在。当前只有单模板 + `?all=1`。本设计遵循它的**原则**（结构性功能 = server-owned 页，不做模板注入），不遵循它描述的机制。该条目已在父任务收口时列为待 review 修订项。

> 注意区分：KT-DEC-0080 禁止的是**把新数据改写成既有模板认识的形状再注入**。给页面加一条导航栏是 chrome 不是 data，不在禁止范围内。

---

## 1. 目标形态

```
templates/console/
  shell.css        ← 唯一样式真值：设计令牌 + 导航条 + 页面 chrome
  status.html      ← 新页（本任务交付）
  graph.html       ← 从 renderGraphView() 搬出来的既有页
templates/preview/
  lumen.html       ← 不动（见 §2.3）

packages/cli/src/console/
  server.ts        ← 路由表 + 静态资源 + 写通道分发
  security.ts      ← loopback 门禁（可单测的纯函数）
  status.ts        ← /api/status 的数据组装（薄，只调内核）
packages/cli/src/commands/
  preview.ts       ← 保留为公开面：citty 命令 + 既有导出
```

`preview.ts` 继续导出 `startPreviewServer` / `toPreviewEntry` / `extractH1Title` / `firstSentence` —— 4 个既有测试正是从这里 import（核实过），保持不动即满足 AC5 且零测试改动。

## 2. 样式共享（R2 / AC6）

### 2.1 机制：一个静态 CSS 路由

新增 `GET /assets/shell.css`，从 `templates/console/shell.css` 按请求读盘（与现有 `/` 读 lumen 同策略，`cache-control: no-store`，改文件刷新即见）。

页面模板顶部：`<link rel="stylesheet" href="/assets/shell.css">`。

**为什么不做 CSS 内联到每个页面**：那正是今天 `/graph` 手抄一份的做法，是被这条 AC 判定为债的东西。
**为什么不引 CSS 构建**：R3 零构建，且没有任何东西需要编译——纯 CSS 变量 + 媒体查询浏览器原生支持。

### 2.2 shell.css 的内容边界

只放**跨页共用**的东西：

- 设计令牌（`:root` 的 `--bg/--surface/--border/--text/--text2` + `prefers-color-scheme: dark` 覆盖）——从 lumen.html 抄一次，**这是最后一次抄**；
- 页面 chrome：`body` 基线、字体栈、`.navbar` 及其内部元素、`.seg` 分段按钮、`.card` / `.row` 等两页都要用的原子类。

**不放**任何单页专有布局（图的 SVG 定位、status 的栅格）——那些留在各自页面的 `<style>` 块。判据：一个规则只有一个页面在用，就不属于 shell。

### 2.3 lumen.html 明确不重构

它 2220 行、自带全套 CSS、且是 C4「只读行为零回归」的主要保护对象。本任务**只给它加一条导航条**（复用 shell.css 的 `.navbar`），不动它的其余样式。

代价诚实说明：短期内色号令牌在 lumen 与 shell.css 里各有一份。AC6 的验收对象是 `graph` + `status` 两个新体系页，lumen 的令牌收编另开任务——因为收编它意味着通读 2220 行 CSS 找出所有硬编码色号，风险与本任务「交付骨架」的目标不匹配。

> 这是刻意选的局部最优：现在把边界画在「新页共享、旧页加导航」，比一次性重构 lumen 更可能不出回归。

## 3. 绑定地址（C1 / AC2）

三处同时收紧，缺一条都能被绕过：

1. **删 `--host` flag** —— citty `args` 里移除，`run()` 里移除透传，i18n 键 `cli.preview.arg.host` 一并删（zh-CN + en，并按既有规约重跑死键普查再改 parity 钉死计数）。
2. **`startPreviewServer` 收窄 host** —— 保留 `options.host` 供测试注入，但落地前过一道白名单：只接受 `127.0.0.1` / `localhost` / `::1`，其余一律抛错。不做「悄悄改回 127.0.0.1」的静默降级——静默降级会让误配置的人以为自己成功了。
3. **测试锁死** —— 断言 ①`options.host = "0.0.0.0"` 抛错；②citty 命令的 `args` 里不存在 `host` 键（防止未来有人「顺手加回来」）。

第 3 条的第二个断言是关键：只测运行时行为的话，将来加回 flag 但白名单还在，就变成一个报错的 flag——用户体验更差且测试还是绿的。

> i18n 键的删除必须走既有普查流程：`locale-parity.test.ts` 钉死了键计数，且该测试强制在改计数前重跑死键普查（本仓已有一次因普查脚本自捕获而误判的记录）。

## 4. 写通道（R4 / C2 / AC3 / AC4）

### 4.1 门禁是纯函数，不是散落的 if

`console/security.ts`：

```ts
/** 判定一个写请求是否由本机浏览器上的本控制台页面发起。 */
export function isSameOriginLoopback(
  headers: { origin?: string; host?: string },
  boundPort: number,
): { ok: true } | { ok: false; reason: string };
```

判定内容：
- `Host` 头的 hostname 必须是 loopback 字面量（`127.0.0.1` / `localhost` / `[::1]`）——挡 DNS rebinding（外部域名解析到 127.0.0.1，浏览器发的 `Host` 是那个域名）；
- `Origin` 存在时必须是 `http://<loopback>:<boundPort>`——挡跨站表单/fetch；
- `Origin` **缺失时拒绝**写请求。浏览器对同源 `fetch` 也会带 `Origin`（非 GET 一律带），所以缺失意味着不是页面发起的。

抽成纯函数的理由：它是本任务唯一的安全边界，要能被大量廉价用例覆盖（各种伪造头组合），而不是每加一个写端点就重测一遍服务器。

### 4.2 分发：路由表声明读写，不靠每个 handler 自觉

`server.ts` 里路由是一张表，每条声明 `method`。分发时统一执行：

- 表里 `method: "POST"` 的路由，收到 `GET` → `405`（AC4）；
- 且在进入 handler **之前**跑 `isSameOriginLoopback`，不通过 → `403`（AC3）。

这样「新加的写端点忘了校验」在结构上不可能发生——不经过分发就没有 handler 被调用。对比：让每个 handler 自己第一行调校验，是 KT-PIT-0065「能力造好了但从未接线」的标准温床（漏一个，类型对、测试绿、lint 干净）。

### 4.3 本任务交付的第一个写端点：`POST /api/open`

「在编辑器/访达中打开这条知识的 md 文件」。

**为什么骨架任务要带一个真端点**：一个没有任何消费者的写通道无法被端到端验证，且正是 KT-PIT-0065 记录的那类「造好从未接线」的缺陷——AC3/AC4 若只能测一个假端点，测的就不是将来真正跑的那条路径。同时它本身是产品化诉求的直接兑现（看到一条知识，一键打开源文件）。

**路径校验（必须，否则这是一个任意文件打开器）**：

1. 请求体只接受 `{ qualifiedId: string }`，**不接受路径**——路径由服务端从 `collectStoreCanonicalEntries` 的结果里查出来；
2. 查出的路径再做一次 `realpath` + 前缀断言（必须落在某个已挂载 store 根之下）；
3. 不匹配 → `400`，不泄露磁盘信息。

「客户端传 id、服务端查路径」比「客户端传路径、服务端校验」强一个量级：后者的正确性依赖校验写得没漏，前者的攻击面是空集。

复用既有 `openBrowser()` 的 `open` / `xdg-open` / `start` 分派（`preview.ts:456`），抽到 `console/` 下共用。

## 5. 导航（R5 / AC1）

`shell.css` 提供 `.navbar`；三个页面（`/`、`/graph`、`/status`）各自在 body 顶部放同构的一段 HTML，当前页用 `.seg.active` 标记。

**不做服务端注入导航**：那需要给每个模板留占位符再字符串替换，等于把模板变成半个模板引擎——而 `/graph` 今天的 270 行模板字符串已经演示了这条路的终点。导航是 6 行静态 HTML，复制它比引入注入机制便宜。

> 与 §2.1「不复制 CSS」不矛盾：CSS 是**会持续演化**的（改色号、加组件），导航结构是**基本冻结**的（加页时才动）。复制的成本 = 变更频率 × 份数。

## 6. `/status` 页与 `/api/status`（AC1 的「新页」）

选它作为骨架的样板页，因为它是唯一不属于另两个子任务的页面（配置归 config-view，项目归 version-upgrade），且它正好是用户打开控制台时想先看到的东西。

`/api/status` 返回（全部来自内核既有能力，适配层零业务判断，遵父设计 §1）：

- `fabricVersion`（`__CLI_VERSION__` 构建期常量）
- `projectRoot`、`activeWriteStore`（`loadProjectConfig`）
- `stores[]`：别名 + 条目数（`collectStoreCanonicalEntries` 按 store 分组计数）
- `entryCount`、`revision`（`computeReadSetRevision`）

**空状态与失败状态是一等公民**（父 PRD 的产品化判据：第一次打开就看懂）。没绑 store 时不是渲染一个空列表，而是显式说明「本项目还没绑定任何 store」+ 下一步命令。

## 7. 实施顺序（依赖决定，不是偏好）

```
1. 删 --host + host 白名单 + 锁死测试        ← 先关门再开窗
2. shell.css + /assets/shell.css 路由
3. renderGraphView() → templates/console/graph.html（行为等价搬迁）
4. 导航条接入 3 页
5. security.ts + 路由表分发 + 405/403
6. /api/status + status.html
7. POST /api/open（第一个真写端点）
```

第 1 步必须在第 5 步之前：先加写通道再关绑定地址，中间任何一个提交点都是「局域网可写」的窗口。

第 3 步是**纯搬迁**，必须行为等价——`preview-graph.test.ts` 是这一步的回归闸，搬完先跑它再继续。

## 8. 风险

| 风险 | 应对 |
| --- | --- |
| 搬迁 `/graph` 时静默改变行为（270 行含 SVG 力导模拟） | 纯文本搬迁，不做任何「顺手优化」；`preview-graph.test.ts` 作为前后对照；样式只删被 shell.css 覆盖的那部分令牌，其余原样 |
| 删 i18n 键撞上 parity 钉死计数 | 按既有规约：先重跑死键普查（普查脚本必须排除自身，否则 canary 恒假阴性），再改计数并留census 注释 |
| `POST /api/open` 成为任意文件打开器 | 只收 `qualifiedId`，服务端反查路径 + realpath 前缀断言；带一个「伪造 id / 越界路径」的负例测试 |
| `Origin` 判定过严导致真实浏览器被拒 | 用真实 `fetch` 从服务端渲染的页面发一次请求做端到端确认，不只测构造的头 |
| 全局装的 `fabric` 遮蔽本仓改动，验证时看到旧行为 | 验证走 vitest + workspace dist，不信任 PATH 里的全局 `fabric`（本机全局落后于本仓） |

## 9. 非目标（本子任务）

- 配置页、项目页的内容（另两个子任务）。
- lumen.html 的 CSS 令牌收编（见 §2.3）。
- 把命令从 `fabric preview` 更名为 `fabric console`。名字确实该改（它已经不只是 preview），但退役一个用户会直接叫的命令名要连带 grep 全部用户可见文案、docs、scripts 与 CI，属独立工作；且应在三个功能页都落地后一次性改，而不是中途改一半。留给父任务收口。
