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
- [ ] W2-5 新增三项：`hint_dismiss_signals`、`embed_endpoint`/`embed_model`（key 只显示已设置/未设置）、`active_write_store`（仅项目作用域）。
- [ ] W2-6 「已启用 · 未生效」状态：`embed_enabled=true` 但嵌入服务不可用时如实标注 + 下一步。
- [x] W2-7 文案语域统一：陈述句 + 说清后果 + 给出实际数值（参照 VS Code 设置 / Raycast 手册），去掉口语化修辞。
- [x] 验证：`cd packages/cli && pnpm exec vitest run __tests__/console-global-config-*.test.ts`
- [x] 测试要点（对齐 KT-GLD-0019 变异判据）：① 塞一个未登记键，断言它出现在高级区而非消失；② 改预设覆盖的任一键，断言档位显示变「自定义」；③ reset 后该项竖条消失。
- [x] 变异验证：3 个变异体全被杀 —— M1 `tierOf` 未知键回落 `common`（4 挂）／M2 视图过滤掉非 common 字段即「新字段静默消失」（2 挂）／M3 `standard` 档偏离 schema 默认值（3 挂）。
- [x] 竖条判据取 **source** 而非「值 == 默认值」：显式写入一个恰好等于默认值的值仍算已修改（它会压住下层），有专门用例钉住这条。
- [x] 搜索穿透全部四节（全机器 / 高级 / 按项目 / 按知识库）；命中为空的节整节不渲染 —— 否则「没有匹配」下面还挂着无关行。

## W3 集成页

- [ ] W3-1 `GET /api/integrations`：客户端接入状态、MCP 条目、hook/skill 清单与漂移（manifest hash 对模板实际内容）、托管块状态。
- [ ] W3-2 页面：左客户端列表 / 右详情；行为开关绑既有 config key；物理文件只读。
- [ ] W3-3 `POST /api/repair`：动作枚举仅 `install` / `doctor --fix`，目标由作用域推导，请求体不带路径，输出流式可见；machine 作用域不提供修复。
- [ ] 验证：`cd packages/cli && pnpm exec vitest run __tests__/console-write-guard.test.ts` + 新增 integrations 测试
- [ ] 测试要点：① 非 POST / 跨源 Origin 被拒（复用既有写通道守卫矩阵）；② 非法 action 拒绝且不 spawn 子进程；③ 清单以文件系统为真源——删掉一个已装 skill 文件后，清单必须反映缺失（不得读任何布尔清单）。

## 收口（每段做完各跑一次）

```bash
pnpm -r exec tsc --noEmit
pnpm lint
(cd packages/cli && pnpm exec vitest run)
```

- [ ] 每个 W 段收口即 `git commit`（分支 `feat/fabric-console` 已在）。
- [ ] 全部完成后手工过一遍父任务 AC7/AC8：每页在「空数据 / 数据不全 / 获取失败」三态都给原因与下一步；界面不出现未翻译的内部术语。

## 风险文件

| 文件 | 风险 |
| --- | --- |
| `packages/cli/templates/preview/lumen.html` | 2220 行、自带调色板，是「只读零回归」保护的主体。**只改 navbar 与取数参数，不碰其余** |
| `packages/cli/src/console/config-resolve.ts` | `writeFieldValue` 是 `fabric config` 与控制台共用的写入内核，改删除语义会同时影响 CLI |
| `packages/cli/src/commands/preview.ts` | 写通道守卫表所在；新增路由必须同步进 `WRITE_ROUTES`，否则守卫失效 |
