# implement — 全局配置管理页

顺序有意义：S1 先把 AC1 写成一条**红**的用例（现在这版必然失败），后面每步都在往它变绿的方向走。最后才动模板。

## S0 起点闸

```bash
pnpm --filter @fenglimg/fabric-cli test && pnpm -r exec tsc --noEmit
```

改造前先确认基线全绿，否则后面分不清是谁弄红的。

## S1 先写红的 AC1

`packages/cli/__tests__/console-global-config-view.test.ts`：造两个 fixture 仓库（一个有 `.fabric/fabric-config.json`、一个完全没装），分别作为 cwd 调 `collectGlobalConfigView`，deep-equal 除 `isCurrent` 外全部字段。

**此时它必须是红的**（函数还不存在 / 行为随 cwd 变）。红→绿才证明这条用例测的是本次改动，而不是本来就成立的事实。

## S2 `buildPanelContext` + `applyEnv`

`console/config-resolve.ts`：抽出纯构造函数，`loadPanelContext` 改为它的派生调用者；`PanelContext` 加 `applyEnv`，`resolveEffective` 的 env 分支加 `ctx.applyEnv &&` 前置。

`writeFieldValue` / `resolveEffective` 的其余部分**逐字不动**。

```bash
pnpm --filter @fenglimg/fabric-cli test -- config-env-layer config-panel
```

既有 config 测试即回归网；全绿才继续。补一条 `applyEnv:false` 时 env 不参与的负向用例。

## S3 项目清单合并

`console/project-list.ts`：`mergeProjectList({registry, globalProjects, cwdProjectId})` → `MergedProject[]`，带 `origin: "both" | "registry-only" | "config-only"`、`stale`、`isCurrent`。

`packages/cli/__tests__/console-project-list.test.ts`：三种 origin 各一例、stale 一例、空注册表一例、id 冲突（同 id 两条注册表记录）一例。

纯函数，无 IO —— 这是本任务唯一有真实分支逻辑的地方，单独测比经由 view 间接测便宜得多。

## S4 view 组装

`console/global-config-view.ts` — `collectGlobalConfigView(cwd)`：

- `machine`：`buildPanelContext({projectId:null, storeRoot:null, applyEnv:false})` 过一遍 18 个非 corpus 字段
- `projects[]`：S3 的清单，每项按其 id 建 ctx（`applyEnv` 仅对 `isCurrent` 为 true），只取**已有覆盖**的键
- `stores[]`：`global.stores` → `storeRelativePathForMount` → 各自读 `store-config.json`，过 1 个 corpus 字段
- `remoteEmbedding` / `strings`：从 `config-view.ts` 原样搬（含扁平键 fallback，那是真机 dogfood 换来的）

跑 S1，**应转绿**。同时补：AC5 的 env 分级用例、AC2 的空注册表用例、字段清单仍从 `getPanelFields()` 派生的结构性用例（读源码断言不含任何 panel key 字面量，沿用 config-view 的做法）。

## S5 写通道

`console/global-config-write.ts` — `applyGlobalConfigEdit(body)`：target 判别联合 → 校验（枚举成员、home 与 scope 匹配、value validate）→ 构造 ctx → 交给未改动的 `writeFieldValue`。

`packages/cli/__tests__/console-global-config-write.test.ts`：AC3（写 A 不影响 B 与 defaults，一正两负）、AC4（伪造 projectId / 未挂载 uuid / 请求体塞路径 三条，各自断言 4xx **且全局配置文件哈希未变**）、AC6（两个 store 互不影响）、home×scope 错配拒绝。

## S6 接线 + 删旧

`commands/preview.ts` 换 handler；删 `console/config-view.ts` 与 `console/config-write.ts` 及其两个测试文件（被 S1/S4/S5 取代的部分）。

```bash
pnpm -r exec tsc --noEmit && pnpm --filter @fenglimg/fabric-cli exec knip
```

两者都干净才算删干净。`console-write-guard.test.ts` 里 `/api/config` 200 / `/api/config/set` 405 / 外源 Origin 403 三条**必须仍绿**（守卫不动的证据）。

## S7 模板

`templates/console/config.html` 按 design §4 重写：全机器主体 + 项目列表（可展开、空态一等）+ 知识库小表 + 远程嵌入卡。

i18n 新键补 `en` / `zh-CN` 两侧，`locale-parity.test.ts` 的钉死计数按增量更新（本轮**含删除**——旧配置页的键要删——所以按规矩必须重跑 dead-key census，不能套用上轮的纯增量豁免）。

## S8 验证与文档

1. `pnpm --filter @fenglimg/fabric-cli test` + `pnpm --filter @fenglimg/fabric-shared test` + `pnpm -r exec tsc --noEmit` + knip
2. **沙箱** dogfood（`FABRIC_HOME` 指向临时目录，绝不碰真实 `~/.fabric`）：造 2~3 个项目段 + 1 个注册表条目，浏览器里走一遍「加覆盖 → 落盘位置正确 → 删不做但改能改」
3. **真机只读**验证：从两个不同目录各启一次，肉眼确认两次内容一致（AC1 的人工复核）；不在真机做写操作
4. `docs/configuration.md` 补「控制台配置页是机器视角」一段
5. 勾 AC、置 task 完成、提交、走收口仪式（归档判断）

## AC → 步骤映射

| AC | 落在哪 |
| --- | --- |
| AC1 两目录一致 | S1（红）→ S4（绿）+ S8.3 人工复核 |
| AC2 三种 origin + 空态 | S3 + S4 |
| AC3 项目隔离写入 | S5 |
| AC4 target 校验且无副作用 | S5 |
| AC5 env 分级 | S2（机制）+ S4（分级） |
| AC6 store 隔离 | S5 |
| AC7 canary | S4（搬运既有整体负向断言） |

## 回滚点

S2 之后、S6 之前的任何一步都可以单独 revert：新模块是**增量**，旧页面直到 S6 才删。S6 是不可逆点，它之前先确保 S1/S4/S5 全绿。
