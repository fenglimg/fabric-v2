# 执行计划：配置视图

设计见 `design.md`。顺序有依赖：**先把真值来源修准（S1–S3），再把它显示出来（S4–S6）**。反过来做会先造出一个显示错误信息的页面，然后再去修——中间态比没有页面更糟。

---

## S1 env 注册表 + 防漂移闸门

- 新建 `packages/shared/src/schemas/config-env-registry.ts`，导出 `PANEL_ENV_OVERRIDES`（4 条，见 design §2）。
- 从 `packages/shared/src/index.ts` 导出。
- 新建 `packages/shared/test/config-env-registry.test.ts`：
  - 普查 `packages/*/src` + `.claude/hooks` 下所有实际被读的 `FABRIC_*` 名，与 `getPanelFields()` 键集求交，断言 === 注册表键集。
  - **对照组**：普查函数对一个已知含 `FABRIC_FUSION` 的字符串必须能抽出该名（防"正则恒不匹配 → 交集恒为空 → 测试恒绿"）。
  - 双向断言：注册表里有而普查没有的（宣称有 env 却无人读）同样红。

验证：`pnpm --filter @fenglimg/fabric-shared test config-env-registry`
另跑一次**手工反证**：临时从注册表删掉 `fusion`，测试必须红；恢复。

## S2 搬迁 resolve/write 到可复用位置（逐字节，不改行为）

- 新建 `packages/cli/src/console/config-resolve.ts`，把 `commands/config.ts` 的 `ValueSource` / `PanelContext` / `asPlainObject` / `readJsonObject` / `loadPanelContext` / `resolveEffective` / `writeFieldValue` 原样移入并导出。
- `commands/config.ts` 改为 import；删除原定义。**函数体一行不改。**

验证：`pnpm --filter @fenglimg/fabric-cli test config`（既有 config 用例全绿 = 搬迁无行为变化）

## S3 给 resolveEffective 接上 env 层

- `ValueSource` 加 `"env"`。
- `resolveEffective` 最前插 env 分支：查 `PANEL_ENV_OVERRIDES[key]` → `process.env[name]` → 过 `field.validate()` → 命中返回 `{ value, source: "env" }`；validate 不过则**继续往下走**（malformed 静默 fallthrough，守 KT-MOD-0002 仍然正确的那一半）。
- i18n 两语种加 `cli.config.source.env`（en: `environment`；zh: `环境变量`），放在既有 5 个 source 键同块。
- `locale-parity.test.ts` 的 pinned count +1（并在注释里写清新增的是哪个键）。
- 新增用例 `packages/cli/__tests__/config-env-layer.test.ts`：
  - 4 个键各一例：设 env → 断言 `source === "env"` 且值等于 env 值。
  - **AC3 反默认断言**：env 值、`defaults` 值、代码默认值三者互不相等，断言生效值等于 env 值（KT-PIT-0062）。
  - malformed env（如 `FABRIC_FUSION=nonsense`）→ 断言 fallthrough 到下层且不抛。
  - 每例 `afterEach` 显式删除 env 变量（同文件共享 env 会串味）。

验证：`pnpm --filter @fenglimg/fabric-cli test config-env-layer` + `pnpm --filter @fenglimg/fabric-shared test locale-parity`

## S4 `/api/config` 只读端点

- 新建 `packages/cli/src/console/config-view.ts`：`collectConfigView(projectRoot): ConfigViewa`（契约见 design §1）。
  - `fields` = `getPanelFields().map(...)`，**不得出现任何硬编码字段名**（R2/AC1）。
  - `remoteEmbedding` 按 design §4(a) 组装：只有 `configured` / `endpointHost` / `hasApiKey` / `model`。
  - `strings` = chrome 文案，`t()` 渲染。
- `preview.ts` 加 GET 路由 `/api/config`（普通 GET 分支，非 WRITE_ROUTES）。
- 用例 `console-config-view.test.ts`：
  - AC1：临时 stub `getPanelFields` 增/删一项，断言 `fields` 跟随。
  - AC2：三种 home 各一例，断言 `effective` + `source` 与 `resolveEffective` 一致。
  - **AC5 canary**：fixture 写 `embed_remote.api_key = "sk-CANARY-DO-NOT-LEAK-0001"`，断言 `JSON.stringify(view)` 全文不含该串。

## S5 `POST /api/config` 写端点

- `open-entry.ts` 同级新建 `config-write.ts`：`applyConfigEdit(projectRoot, { key, value, scope })`。
  - key 不在 `getPanelFieldByKey` → 400。
  - `resolveEffective(...).source === "env"` → **409**，message 说明"当前值由 `FABRIC_X` 决定，写配置文件不会生效"。
  - value 过 `field.validate()`，用其返回值落盘。
  - `home === "preference"` 且 `scope === "project"` 但无 `projectId` → 400（沿用 `writeFieldValue` 既有抛错）。
- `preview.ts` 的 `WRITE_ROUTES` 加 `"/api/config"`——门禁自动继承，handler 内**不写任何 Origin/method 校验**。
- 用例 `console-config-write.test.ts`：
  - 未知 key → 400；非法 value → 400；env 顶着的键 → 409。
  - `scope: "defaults"` 与 `"project"` 分别落到 global config 的正确段。
  - corpus 键落到 store-config.json。
  - **AC4 往返**：改一个键 → 重新 `collectConfigView` 断言生效值变了 → 再跑 `fabric config --get <key>`（子进程或直调同一 resolve 路径）断言一致。
- 门禁回归：`console-write-guard.test.ts` 补一条，断言 `/api/config` 在 GET 与跨站 Origin 下分别 405 / 403。

## S6 页面 `templates/console/config.html`

- 沿用 shell.css 令牌 + 四段导航（加"配置"入口，四个页面的 nav 六行保持逐字相同）。
- 按 group 分段渲染；来源徽章区分 `env`（警示色）与其余；`envVar !== null` 的行标注可被哪个变量覆盖。
- 编辑控件按 `widget` 选 select / text；preference 类带 scope 选择器（无 `projectId` 时禁用并说明）。
- 写成功后重新 fetch `/api/config` 重渲染（不做乐观更新）。
- `preview.ts` 加 `/config` 路由 + 三个既有页面的 nav 各加一个 `<a class="seg" href="/config">配置</a>`。

## S7 文档修订（AC6 的可做部分）

重写 `docs/configuration.md`：per-class 模型表、`fabric-global.json` 正确文件名、删 "Repo overrides are allowed" 与 `store_knob_repo_override`、补 4 个 env 键的真实覆盖面、指向 `config_key_relocated` 诊断。

## S8 收口

```bash
pnpm --filter @fenglimg/fabric-cli test && pnpm --filter @fenglimg/fabric-shared test
pnpm -r exec tsc --noEmit
pnpm --filter @fenglimg/fabric-cli exec knip
```

真机 dogfood：`node packages/cli/dist/index.js preview --port 7788`，走一遍四个页面；带 `FABRIC_FUSION=rrf` 起一次，断言 `fusion` 行显示 `环境变量` 且编辑被拒。

---

## AC 映射

| AC | 落在 |
| --- | --- |
| AC1 字段自省不硬编码 | S4 stub 增删用例 |
| AC2 生效值 + 来源正确 | S4 三 home 用例 |
| AC3 env 覆盖且反默认 | S3 三值互异断言（**PRD 原措辞需校准，见下**） |
| AC4 改完与 CLI 一致 | S5 往返用例 |
| AC5 secret 不出现 | S4 canary（**PRD 原措辞需校准**） |
| AC6 D1/D2 结论 + 修订 | design §0 + S7；知识条目部分挂起待用户同意 |

## 需回写 PRD 的三处校准

1. **AC3**：原文假设任意字段都能用 env 覆盖。实际只有 4 个键有 env 读点，用例必须落在这 4 个之内。
2. **AC5**：原文假设 secret 字段会出现在配置页。实际 panel 字段集不含 secret，改为 canary 负向断言。
3. **D2 / R3**：`STORE_OVERRIDABLE_KNOBS` 已删，"12 组"无指代对象；R3 的"界面不得提供第二个写入口"已由架构保证，不再是界面要承担的约束。
