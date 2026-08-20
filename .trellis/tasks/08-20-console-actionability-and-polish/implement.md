# 执行计划 — 控制台交互可操作性与视觉收口

四批。每批收口即 `git commit`（分支 `feat/fabric-console` 已在用）。
排序理由：先把**说错话的**改对（最便宜、风险最低），再补**缺的功能**（最大工作量、有不可逆动作），最后做**视觉**（改动面最广但可逆，放最后避免与前两批反复冲突）。

## W1 — 让页面说实话（服务端 + 模板，零新写面）

- [ ] `global-config-view.ts:308` 把 `modified` 从 `source !== "default"` 改为 `source === layerOf(target)`；新增 `layerOf(target)` 把写目标映射到 `ValueSource`
- [ ] 同处下发新字段 `inherited: boolean`（真实来源不是本层、也不是内置默认）
- [ ] 配置页 / 集成页每行渲染 `sourceLabel`（数据已下发，无需新 i18n 键）
- [ ] 各页主体区渲染当前范围名（切项目后能看出切了）
- [ ] `.frow.mod` 的 tooltip 文案随判据修正（"已在此处设置"仅在本层有值时出现）
- [ ] 用例：ccpm（纯继承）与 pcf（项目层真设过）两个 fixture，断言后者标记、前者不标记 —— **fixture 须在这一维上有区分力**
- [ ] 变异：把判据改回 `!== "default"`，断言用例变红
- [ ] 真机双项目比对：先前 7 行误标 → 0 行误标（AC7）

**验证**：`pnpm --filter @fenglimg/fabric-cli test` + 真机 `/config` `/integrations` 双 scope 比对

## W2 — 措辞与指路（纯模板/文案）

- [ ] `shell.js:347-353` reset 按钮文案改为「移除」语义；对应 i18n 键改名或新增（改键必须同步 `locale-parity.test.ts` 的钉死计数，并写清增删理由）
- [ ] 多选控件（`hint_dismiss_signals`）在 `mod:false` 时给出说明或禁用态的「移除」，不再只有孤零零一个「保存」
- [ ] 行为卡的「在上面的『收工时提醒归档与复审』里调整」改为**可点击锚点**：滚动到目标控件并短暂高亮
- [ ] 行为卡补一句去向：卡内可关的直接给控件，需去配置页的给可点链接（`cite_policy_enabled` 等三个）
- [ ] 集成页顶部补一句"想关掉某个提醒 → 看这里"的导引
- [ ] 明确写出"彻底停用单个 hook 需改客户端配置，控制台做不到"（不假装能做）

**验证**：真机走一遍"我想关掉归档提醒"的完整路径，全程不出控制台

## W3 — 两个清理能力（唯一的新写面，含不可逆动作）

- [ ] `preview.ts` 的 `WRITE_ROUTES` 加入 `/api/cleanup`
- [ ] 新建 handler：body 只收 `{action, scope}`，**不收路径**
- [ ] `action="orphan-artifacts"`：调 `collectIntegrations(scope)`（与读端同函数同参）→ 过滤 `state==="orphan"` → 逐个删除前二次校验仍在白名单且位于安装根之下 → 返回实际删除列表
- [ ] `action="hint-cache"`：清单从 writer helper 派生或与 doctor 清扫器共用常量，**不手抄**；不碰 `vectors/` `bm25/` `session-digests/` `active-session-*`
- [ ] 集成页两步确认 UI：首点展开清单面板（含完整路径 + 条数）→ 「确认删除」才 POST → 取消则磁盘零变化
- [ ] 结果比对：`removed` 与确认时清单不一致时明说差异（报 off 磁盘状态，不 off 意图）
- [ ] 集成页显示提醒缓存的条目数与最旧时间（现在完全不可见）
- [ ] 用例：正向删孤儿 / 负向 `ok`·`modified` 零触碰 / 越界路径被拒 / round-trip（writer 生成名 → 清理器认得）
- [ ] 守卫用例：`/api/cleanup` GET=405 **且** 同用例断言某读端点 GET=200（机制级，非单端点级）
- [ ] 变异：把越界校验改成 no-op、把 `state==="orphan"` 过滤放宽，断言各自变红
- [ ] 真机：清理本项目 15 个孤儿 → 计数归零、"N 项需要处理"下降；`git status` 确认只动了孤儿路径

**回滚点**：本批唯一不可逆。合入前先在一次性副本目录跑一遍删除，确认只删该删的。

## W4 — 视觉（改动面最广，全部可逆）

- [ ] `lumen.html:1237-1242` 退掉旧 `.brand` 页头（"Aurora×Terminal · Lumen"），修相邻布局；导航条 `nav-title` 不动（五页已是「Fabric 控制台」）
- [ ] `shell.css` `.seg.active`：除颜色外加形状差异
- [ ] `shell.css` `.seg:hover`：收缩填充盒 / 放大 `.navbar` gap，使相邻标签悬停底色不相接
- [ ] lumen 的三层渐变条与导航条下缘的关系重排（两条线不再相邻打架）
- [ ] `.frow.mod` 标记与 `:focus-visible` 重做
- [ ] 新增样式一律带类/id 锚点，无裸标签选择器
- [ ] 跑 `__tests__/manual/ui-metrics-probe.mjs` 静态半：零字面色号、零裸标签选择器、类型阶梯合规
- [ ] lumen 零回归复核：除被删页头及其相邻布局外，其余渲染一致

**验证**：700 / 768 / 1024 / 1440 四档无横向滚动；五页截图比对

## 收口

- [ ] `pnpm -r exec tsc --noEmit`（本地必跑，不靠 build —— 三次复发史）
- [ ] 全量 `pnpm -r test`
- [ ] `ui-metrics-probe.mjs` 静态半通过
- [ ] 九条逐条对照 AC1–AC13 勾验，未达成的写明原因而不是删判据
- [ ] 归档判断：本轮若产出可复用教训（如"报告了却无法处置的状态是一类 UI 缺陷"），走 `fabric-archive`

## 风险文件

| 文件 | 风险 | 处置 |
|---|---|---|
| `preview/lumen.html` | 受保护零回归文件，本轮首次批准改动 | 只动 1237-1242 及相邻布局；改动前后截图比对 |
| `preview.ts` | 新增写面，安全边界 | 请求体不含路径；机制级守卫用例 |
| `global-config-view.ts` | `modified` 是多处消费的判据 | grep 全部消费方；变异测试 |
| `shell.css` | 五页共用，改错全线受影响 | 只动令牌与已锚定的类；probe 静态断言兜底 |
| i18n 键改名 | `locale-parity.test.ts` 设计成会红 | 改钉死计数时必须写增删理由 |
