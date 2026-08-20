# 控制台骨架 — 执行计划

顺序由依赖决定（design §7），不可重排：**先关门（绑定地址），再开窗（写通道）**。每步末尾的验证命令必须通过才进入下一步。

---

## Step 1 — 关门：删 `--host`，收窄绑定地址

**改动**
- `packages/cli/src/commands/preview.ts`
  - `previewCommand.args` 删除 `host` 键；`run()` 里删除 `args.host` 透传。
  - `startPreviewServer` 新增 loopback 白名单：`options.host` 只接受 `127.0.0.1` / `localhost` / `::1`，其余 **抛错**（不静默降级）。
- `packages/shared/src/i18n/locales/zh-CN.ts` + `en.ts`：删 `cli.preview.arg.host`。
- `packages/shared/src/i18n/locale-parity.test.ts`：钉死计数 −1。

**i18n 门禁纪律（不可跳过）**
改钉死计数前必须重跑死键普查。普查脚本 **必须把自身排除出扫描树**——否则脚本里的 canary 字面量会被自己扫到，canary 全部"存活"，探针恒假阴性（本仓已有一次实证）。普查完在 parity 测试里留 census 注释。

**新测试** `packages/cli/__tests__/preview-loopback-binding.test.ts`
1. `startPreviewServer({ host: "0.0.0.0" })` → rejects。
2. `previewCommand.args` 不含 `host` 键（防"未来顺手加回来"变成一个报错的 flag，运行时测试查不出）。
3. 默认启动后 `handle.url` 以 `http://127.0.0.1:` 开头。

**验证**
```bash
pnpm --filter @fenglimg/fabric-cli exec vitest run __tests__/preview-loopback-binding.test.ts __tests__/preview-graph.test.ts __tests__/preview-port-fallback.test.ts __tests__/preview-source-toggle.test.ts __tests__/preview-title.test.ts
```
```bash
pnpm --filter @fenglimg/fabric-shared exec vitest run src/i18n/locale-parity.test.ts
```

**回滚点**：本步独立可回滚，不依赖后续任何步骤。

---

## Step 2 — `shell.css` + `/assets/shell.css` 路由

**新增** `packages/cli/templates/console/shell.css`
- 设计令牌：`:root` 的 `--bg/--surface/--border/--text/--text2/--edge` + `prefers-color-scheme: dark` 覆盖（从 `lumen.html` 抄一次，**这是最后一次抄**）。
- chrome：`body` 基线 + 字体栈、`.navbar` 及内部元素、`.seg` / `.seg.active`、`.card`、`.row`、`.muted`、`.empty`。
- **不放** 单页专有布局（SVG 定位、status 栅格）。判据：只有一个页面用到的规则不属于 shell。

**改动** `preview.ts`：新增 `GET /assets/shell.css` 路由，按请求读盘，`content-type: text/css; charset=utf-8`，`cache-control: no-store`。

**验证**：起服务 fetch `/assets/shell.css` → 200 + 含 `--bg`。

---

## Step 3 — `/graph` 搬迁到磁盘模板（**纯搬迁，零行为变化**）

**新增** `packages/cli/templates/console/graph.html`：`renderGraphView()`（`preview.ts:184-453`）的 HTML 原样落盘。
- 删除其中被 `shell.css` 覆盖的令牌与 chrome 规则；**其余 CSS/JS 一字不改**。
- 顶部加 `<link rel="stylesheet" href="/assets/shell.css">`。

**改动** `preview.ts`：`/graph` 改为读 `templates/console/graph.html`；删除 `renderGraphView()`。

**纪律**：不做任何"顺手优化"。这 270 行含 SVG 力导模拟，任何微调都可能静默改变布局而没有断言会红。

**验证**（本步的回归闸，未过不得进入 Step 4）
```bash
pnpm --filter @fenglimg/fabric-cli exec vitest run __tests__/preview-graph.test.ts
```
外加人工：`fabric preview` 打开 `/graph`，确认力导图、拖拽、缩放、悬浮高亮、右侧面板、孤点清单均与搬迁前一致。

---

## Step 4 — 导航条接入三页

**改动**：`lumen.html`（**只加导航条，不动其余样式** — design §2.3）、`graph.html`、后续 `status.html`，各自 body 顶部放同构的 `.navbar` HTML，当前页 `.seg.active`。

不做服务端注入（会把模板变成半个模板引擎）。导航是 6 行冻结结构，复制成本低于引入机制。

**验证**：三页互跳，视觉一致（AC1）。改 `shell.css` 一个色号，`/graph` 与 `/status` 同时变化（AC6）。

---

## Step 5 — 安全门禁 + 路由表分发

**新增** `packages/cli/src/console/security.ts`
```ts
export function isSameOriginLoopback(
  headers: { origin?: string; host?: string },
  boundPort: number,
): { ok: true } | { ok: false; reason: string };
```
- `Host` hostname 必须是 loopback 字面量（挡 DNS rebinding）。
- `Origin` 存在时必须 `http://<loopback>:<boundPort>`。
- `Origin` **缺失 → 拒绝**（浏览器对非 GET 一律带 Origin，缺失即非页面发起）。

**改动** `preview.ts`：路由改为一张声明 `method` 的表，分发时统一
- POST 路由收到 GET → `405`（AC4）
- 进 handler **之前** 跑门禁，不过 → `403`（AC3）

结构上让"新写端点忘了校验"不可能发生（handler 不经分发不会被调用）。

**新测试** `packages/cli/__tests__/console-write-guard.test.ts`
- 纯函数用例：合法 / 外部 Origin / 外部 Host / Origin 缺失 / 端口不符。
- 服务器用例：POST 端点收 GET → 405；伪造 `Origin: https://evil.com` → 403。

---

## Step 6 — `/api/status` + `status.html`

**新增** `packages/cli/src/console/status.ts`：组装 `fabricVersion`（`__CLI_VERSION__`）、`projectRoot`、`activeWriteStore`（`loadProjectConfig`）、`stores[]`（`collectStoreCanonicalEntries` 按 store 分组计数）、`entryCount`、`revision`（`computeReadSetRevision`）。**适配层零业务判断**（父设计 §1）。

**新增** `templates/console/status.html`，link `shell.css`。

**空/失败状态是一等公民**：没绑 store 时显式说明"本项目还没绑定任何 store"+ 下一步命令，不是渲染空列表。

**新测试**：`/api/status` 形状；无 store 时 `stores: []` 且页面渲染引导文案。

---

## Step 7 — 第一个真写端点 `POST /api/open`

在系统默认程序中打开某条知识的 md 文件。

**路径校验（否则这是任意文件打开器）**
1. 请求体只接受 `{ qualifiedId: string }`，**不接受路径**。
2. 服务端从 `collectStoreCanonicalEntries` 反查路径。
3. `realpath` + 前缀断言（必须落在某个已挂载 store 根之下）。
4. 不匹配 → `400`，不回显磁盘信息。

`openBrowser()` 的平台分派（`preview.ts:456`）抽到 `console/` 下共用。

**新测试**：合法 id → 调用 opener（spy，不真起进程）；未知 id → 400；构造越界路径 → 400。

---

## 收口验证（全部必过）

```bash
pnpm --filter @fenglimg/fabric-cli exec vitest run
```
```bash
pnpm --filter @fenglimg/fabric-shared exec vitest run
```
```bash
pnpm -r exec tsc --noEmit
```
```bash
pnpm knip
```

外加真二进制 dogfood：`node packages/cli/dist/index.js preview`，逐页点一遍导航 + `/api/open`。**不信任 PATH 里的全局 `fabric`**（本机全局 2.5.0-rc.4，落后本仓）。

## AC 映射

| AC | 落在 |
| --- | --- |
| AC1 三页互跳视觉一致 | Step 4 + 6 |
| AC2 只在 127.0.0.1 可达 + 无改绑入口 | Step 1 |
| AC3 非 loopback Origin 的 POST 被拒 | Step 5 |
| AC4 写端点不接受 GET | Step 5 |
| AC5 既有 4 个 preview 测试全绿 | Step 1 / 3 闸 + 收口 |
| AC6 样式共享，改一处两页生效 | Step 2 + 4 |
