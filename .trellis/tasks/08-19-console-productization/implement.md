# 执行计划：控制台产品化

三段互相独立、可分别回滚。每段自带验证命令与收口 commit。

## W0 前置（补既有缺口，先做因为 W2 依赖它）

- [x] W0-1 `writeFieldValue` 增加删除语义（`action:"reset"`）：machine 删 `defaults[key]`、project 删 `projects[<id>][key]`、store 删 store-config 键；删空段落时连空对象一起删。
- [x] W0-2 `POST /api/config/set` 路由 `action`，非法 action 走既有 400 拒绝路径。
- [x] 验证：`cd packages/cli && pnpm exec vitest run __tests__/console-global-config-write.test.ts`（27 绿）
- [x] 测试要点：reset 后重新 resolve 的值等于**下一层**的值而非代码默认值（对齐 KT-PIT-0062：断言值不得恰好撞默认值，否则用例假绿）。fixture 里 `defaults.nudge_mode="verbose"` 刻意不等于代码默认 `normal`；5 个变异体（reset 写默认值 / 不删空段落 / 非法 action 降级为 set / corpus 不删键 / reset 走 set 的 home 路由）全部被杀。

> **验证命令一律在包目录内跑**（`cd packages/cli && pnpm exec vitest ...`）。仓库根的 `npx vitest run --root packages/cli` 会让 `doctor-checks.test.ts` 以 ENOENT 假红 —— 它按 cwd 解析 `../shared/...`，与本任务无关。

## W1 作用域参数化

- [x] W1-1 新增 `GET /api/scopes`（machine + 已登记项目 + stale 标记）。
- [x] W1-2 请求级作用域解析器：`scope` → `projectRoot`；stale / config-only 显式 409，**不回退**。
- [x] W1-3 `/api/status` 参数化 + machine 作用域返回跨项目总览（版本三处、项目列表、挂载库）。
- [x] W1-4 `/api/knowledge` 参数化；machine 作用域复用既有 `--all` 的按库浏览语义（不造第三种聚合）。
- [x] W1-5 `shell.css` + `shell.js` 加作用域切换器（跨页原子）；四个模板挂上；`lumen.html` 只改 navbar 与取数参数。
- [x] 验证：`cd packages/cli && pnpm exec vitest run __tests__/console-*.test.ts __tests__/preview-*.test.ts`
- [x] 测试要点：① 同一台机器上从两个不同目录启动，`?scope=X` 返回**相同**载荷（作用域来自参数而非启动目录）；② stale 项目返回 409 且不泄露回退数据。
- [x] 手工：`node packages/cli/dist/index.js preview` → 切换器切到另一个项目，四页作用域一致。

## W2 设置页重构

- [x] W2-1 呈现注册表：`{ key → tier }` + 预设常量表。**未登记键自动落「高级」**（不变量）。
- [x] W2-2 常用 / 高级两层 + 搜索框（命中高级项时自动展开高级区）。
- [x] W2-3 已修改竖条 + 悬停「恢复默认」（接 W0）。来源层降为详情。
- [x] W2-4 预设卡：`POST /api/config/preset` 服务端逐键走 `writeFieldValue`；读取时逐键全等反推当前档位，不匹配显示「自定义」；**不落 `preset_name` 字段**。
- [x] W2-5 三项挑战完毕，结论是「加一项、驳两项」——
  - **加**：`hint_dismiss_signals` 全量实装（schema 抽 `hintDismissSignalSchema` → 新 `multiselect` 控件类型 → CLI clack `multiselect` + 网页勾选框）。这一项价值最高：nudge 文案本身在教用户手改 JSON。
  - **驳 `active_write_store`**：不加写控件。它存在各 repo 的 `.fabric/fabric-config.json`，而 `project_id → 仓库路径` 的反查在本机不存在（KT-PIT-0050），所以只有「当前行」可改 —— 在一个主张「启动目录不决定任何事」的页面上开这么一个例外，是自己拆自己的台。`fabric store switch-write` 已经能改。
  - **驳远程嵌入可写**：`embed_endpoint`/`embed_model` 保持只读，并**说明为什么**。三项只有配齐才生效，第三项是密钥 —— 不在网页里做明文密钥输入框。改为在卡片上点名文件路径与 `FABRIC_EMBED_*` 环境变量（`remote.how`），把「只读」从遗漏变成一个带去处的决定。
- [x] W2-6 「已启用 · 未生效」状态：`semanticSearch` 视图块把**意图**（本页自己解析的 `embed_enabled`）与**效果**（`gatherRecallStatus` 的机器级探针）分开报，挂在语义检索那一行下面。四态各有各的下一步，其中「模型还没下载」明确写「你不需要做什么」—— 与真故障合并成一句「没生效」会让一半的人去修一个自己会好的问题。
- [x] W2-7 文案语域统一：陈述句 + 说清后果 + 给出实际数值（参照 VS Code 设置 / Raycast 手册），去掉口语化修辞。
- [x] 验证：`cd packages/cli && pnpm exec vitest run __tests__/console-global-config-*.test.ts`
- [x] 测试要点（对齐 KT-GLD-0019 变异判据）：① 塞一个未登记键，断言它出现在高级区而非消失；② 改预设覆盖的任一键，断言档位显示变「自定义」；③ reset 后该项竖条消失。
- [x] 变异验证：3 个变异体全被杀 —— M1 `tierOf` 未知键回落 `common`（4 挂）／M2 视图过滤掉非 common 字段即「新字段静默消失」（2 挂）／M3 `standard` 档偏离 schema 默认值（3 挂）。
- [x] 竖条判据取 **source** 而非「值 == 默认值」：显式写入一个恰好等于默认值的值仍算已修改（它会压住下层），有专门用例钉住这条。
- [x] 搜索穿透全部四节（全机器 / 高级 / 按项目 / 按知识库）；命中为空的节整节不渲染 —— 否则「没有匹配」下面还挂着无关行。

## W3 集成页

- [x] W3-1 `GET /api/integrations`：客户端接入状态、MCP 条目、hook/skill 清单与漂移、托管块状态。**唯一判据是「装在项目里的字节 vs 模板里的字节」**——不是 manifest hash：字节比对同时覆盖「装完被手改」和「装的是旧版 CLI 的模板」两种漂移，manifest 只覆盖前一种。manifest 只用来报一件字节答不了的事：这份安装是哪个 CLI 版本写的。
- [x] W3-2 页面：左客户端列表 / 右详情；行为开关绑既有 config key；物理文件只读。行为的单位取 **hook 脚本**而非 config key —— key 是「渲染得出来就渲染」，脚本是「在盘上且已登记进客户端配置」才算在跑，「不在跑」再拆成文件缺失（去重装）与文件在但没登记（客户端配置被覆盖过）两种下一步。
- [x] W3-2a 同一个 key 只画一个控件：`nudge_mode` / `hint_dismiss_signals` 各被三个 hook 读，按读者各画一份就成了三个控件管一个值，存了一个另外两个仍显示旧值。控件落在第一个读它的行为下，其余行为出一条指回去的引用（引用不能省——「这个旋钮影响哪些 hook」正是分组要回答的问题）。
- [x] W3-2b 写入层由服务端 `writeTarget` 指定，不在浏览器里拼：值是按项目层解析的，存到机器层等于悄悄把设置挪了一层。浏览器实测保存 `archive_hint_hours` 落 `projects.<id>` 而非 `defaults`。
- [x] W3-2c 控件渲染器提到 `shell.js` 的 `FabricField`（第二个消费者即上移，同 `shell.css` 自身的规则）；配置页改为调用它，浏览器实测保存回路未回归。
- [x] W3-3 `POST /api/repair`：动作枚举仅 `install` / `doctor --fix`，argv 在服务端按枚举拼、请求体只带 scope id 不带路径，输出以 `text/plain` 边跑边回；machine 作用域 400 拒绝。
- [x] 验证：`pnpm -r exec tsc --noEmit`、`pnpm lint`、`(cd packages/cli && pnpm exec vitest run)` 1700 绿、`(cd packages/shared && pnpm exec vitest run)` 668 绿。
- [x] 测试要点：① 非 POST / 跨源 Origin 被拒（`/api/repair` 作为写通道表第四条，与前三条同矩阵）；② 非法 action 400 且**不 spawn** —— 判据取响应 `content-type`：子进程输出一旦开流就是 `text/plain` 且状态已随首块发出，所以 JSON 响应体即「流分支从未进入」，只断言状态码会漏掉「先跑了再判非法」；③ 清单以文件系统为真源（删/改/加文件后载荷跟着变）。
- [x] 额外钉住：`BEHAVIORS[].keys ∪ NON_HOOK_KEYS ∪ UNWIRED_BEHAVIOR_KEYS` 必须**恰好等于**非 corpus 面板键全集且无重复——这条全划分是发现四个死键（`audit_mode` / `cite_policy_enabled` / `self_archive_policy_enabled` / `review_stale_pending_days`）的原因，也是新加 schema 键不会两边都不落的保证。
- [x] 变异验证 5 个全被杀：M1 `compareFile` 装了就报 ok；M2 `active` 去掉 registered 合取；M3 MCP 以文件存在即视为已接入；M4 `NON_HOOK_KEYS` 少一个键；M5 Claude 托管块见 import 行即 ok。
- [ ] 未做实机执行验证：`install` / `doctor --fix` 会改用户真实 store 与安装树，未在未经确认的情况下点。服务端流式（spawn → 边跑边写 → 退出码尾行）已用真实子进程测；浏览器侧 reader pump 未实跑。

## 收口（每段做完各跑一次）

```bash
pnpm -r exec tsc --noEmit
pnpm lint
(cd packages/cli && pnpm exec vitest run)
```

- [x] 每个 W 段收口即 `git commit`（分支 `feat/fabric-console` 已在）。
- [x] 全部完成后手工过一遍父任务 AC7/AC8：每页在「空数据 / 数据不全 / 获取失败」三态都给原因与下一步；界面不出现未翻译的内部术语。结论见 prd.md AC13。

## 本轮查出、但不在本任务范围内的两件事

- **四个已渲染但无人读取的 config 键**（`audit_mode` / `cite_policy_enabled` / `self_archive_policy_enabled` / `review_stale_pending_days`）：schema 里声明了、设置页按能用的控件渲染、全仓库零消费者（全量普查确认）。已记进 `integrations-registry.ts` 的 `UNWIRED_BEHAVIOR_KEYS` 并注明——**只记不修**，因为每一个是接线还是退役都是产品决定。其中两个尤其扎眼：`review_stale_pending_days` 被三张预设卡分别写成三个不同的值；`self_archive_policy_enabled` 还坐在设置页的「常用」层，即一个死键占着最主要的位置。
- **`config/resolver.ts` 里硬编码的 `installedCapabilities: {hook:true, skill:true}`**：ClaudeCodeCLI 无条件声称自己装好了 hook 与 skill。集成页因此拒绝把它当数据源，改以文件系统为唯一真源（KT-PIT-0067）。这条硬编码本身仍在。

## 风险文件

| 文件 | 风险 |
| --- | --- |
| `packages/cli/templates/preview/lumen.html` | 2220 行、自带调色板，是「只读零回归」保护的主体。**只改 navbar 与取数参数，不碰其余** |
| `packages/cli/src/console/config-resolve.ts` | `writeFieldValue` 是 `fabric config` 与控制台共用的写入内核，改删除语义会同时影响 CLI |
| `packages/cli/src/commands/preview.ts` | 写通道守卫表所在；新增路由必须同步进 `WRITE_ROUTES`，否则守卫失效 |
