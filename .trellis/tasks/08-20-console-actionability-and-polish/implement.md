# 执行计划 — 控制台交互可操作性与视觉收口

四批。每批收口即 `git commit`（分支 `feat/fabric-console` 已在用）。
排序理由：先把**说错话的**改对（最便宜、风险最低），再补**缺的功能**（最大工作量、有不可逆动作），最后做**视觉**（改动面最广但可逆，放最后避免与前两批反复冲突）。

## W1 — 让页面说实话（服务端 + 模板，零新写面）

- [x] `global-config-view.ts:308` 把 `modified` 从 `source !== "default"` 改为 `source === layerOf(target)`；新增 `layerOf(target)` 把写目标映射到 `ValueSource`
- [x] 同处下发新字段 `inherited: boolean`（真实来源不是本层、也不是内置默认）
- [x] 配置页 / 集成页每行渲染 `sourceLabel`（数据已下发，无需新 i18n 键）
- [x] 各页主体区渲染当前范围名（切项目后能看出切了）
- [x] `.frow.mod` 的 tooltip 文案随判据修正（"已在此处设置"仅在本层有值时出现）
- [x] 用例：ccpm（纯继承）与 pcf（项目层真设过）两个 fixture，断言后者标记、前者不标记 —— **fixture 须在这一维上有区分力**
- [x] 变异：把判据改回 `!== "default"`，断言用例变红
- [x] 真机双项目比对：先前 7 行误标 → 0 行误标（AC7）

**验证**：`pnpm --filter @fenglimg/fabric-cli test` + 真机 `/config` `/integrations` 双 scope 比对

## W2 — 措辞与指路（纯模板/文案）

- [x] `shell.js:347-353` reset 按钮文案改为「移除」语义；对应 i18n 键改名或新增（改键必须同步 `locale-parity.test.ts` 的钉死计数，并写清增删理由）
- [x] 多选控件（`hint_dismiss_signals`）在 `mod:false` 时给出说明或禁用态的「移除」，不再只有孤零零一个「保存」
- [x] 行为卡的「在上面的『收工时提醒归档与复审』里调整」改为**可点击锚点**：滚动到目标控件并短暂高亮
- [x] 行为卡补一句去向：卡内可关的直接给控件，需去配置页的给可点链接（`cite_policy_enabled` 等三个）
- [x] 集成页顶部补一句"想关掉某个提醒 → 看这里"的导引
- [x] 明确写出"彻底停用单个 hook 需改客户端配置，控制台做不到"（不假装能做）

**验证**：真机走一遍"我想关掉归档提醒"的完整路径，全程不出控制台

## W3 — 两个清理能力（唯一的新写面，含不可逆动作）

- [x] `preview.ts` 的 `WRITE_ROUTES` 加入 `/api/cleanup`
- [x] 新建 handler：body 只收 `{action, scope}`，**不收路径**
- [x] `action="orphan-artifacts"`：调 `collectIntegrations(scope)`（与读端同函数同参）→ 过滤 `state==="orphan"` → 逐个删除前二次校验仍在白名单且位于安装根之下 → 返回实际删除列表
- [x] `action="hint-cache"`：清单从 writer helper 派生或与 doctor 清扫器共用常量，**不手抄**；不碰 `vectors/` `bm25/` `session-digests/` `active-session-*`
- [x] 集成页两步确认 UI：首点展开清单面板（含完整路径 + 条数）→ 「确认删除」才 POST → 取消则磁盘零变化
- [x] 结果比对：`removed` 与确认时清单不一致时明说差异（报 off 磁盘状态，不 off 意图）
- [x] 集成页显示提醒缓存的条目数与最旧时间（现在完全不可见）
- [x] 用例：正向删孤儿 / 负向 `ok`·`modified` 零触碰 / 越界路径被拒 / round-trip（writer 生成名 → 清理器认得）
- [x] 守卫用例：`/api/cleanup` GET=405 **且** 同用例断言某读端点 GET=200（机制级，非单端点级）
- [x] 变异：把越界校验改成 no-op、把 `state==="orphan"` 过滤放宽，断言各自变红
- [x] 真机：清理本项目 15 个孤儿 → 计数归零、"N 项需要处理"下降；`git status` 确认只动了孤儿路径

**回滚点**：本批唯一不可逆。合入前先在一次性副本目录跑一遍删除，确认只删该删的。

## W4 — 视觉（改动面最广，全部可逆）

- [x] `lumen.html:1237-1242` 退掉旧 `.brand` 页头（"Aurora×Terminal · Lumen"），修相邻布局；导航条 `nav-title` 不动（五页已是「Fabric 控制台」）
- [x] `shell.css` `.seg.active`：除颜色外加形状差异
- [x] `shell.css` `.seg:hover`：收缩填充盒 / 放大 `.navbar` gap，使相邻标签悬停底色不相接
- [x] lumen 的三层渐变条与导航条下缘的关系重排（两条线不再相邻打架）
- [x] `.frow.mod` 标记与 `:focus-visible` 重做
- [x] 新增样式一律带类/id 锚点，无裸标签选择器
- [x] 跑 `__tests__/manual/ui-metrics-probe.mjs` 静态半：零字面色号、零裸标签选择器、类型阶梯合规
- [x] lumen 零回归复核：除被删页头及其相邻布局外，其余渲染一致

**验证**：700 / 768 / 1024 / 1440 四档无横向滚动；五页截图比对

**W4 实测（2026-08-20，真机 `fabric preview` on 127.0.0.1:7791）**

- **20 组合扫描**（5 页 × 700/768/1024/1440）：`hScroll: false` 全绿；相邻标签底色最小间距 `minGap: 6`（>0，AC10 达成）；`brands: 0`（正文区零第二品牌）。
- **五页品牌普查**：每页 `fabricConsole: 1 / lumen: 0 / aurora: 0`，`navTitle: "Fabric 控制台"` —— AC9 达成。
- **lumen 三层渐变条与导航条**：`navBottom: 52`、`headerTop: 51`、`barH: "2px"`，靠 `header { margin-top: -1px }` 让 2px 渐变条盖住导航条那 1px 边框，两条线合一而非相邻打架。
- **选中态形状差异**：`.seg.active::after` 从 `left:10px right:10px height:2px` 改为 `left:0 right:0 height:4px` —— 实测 `height: "4px", left: "0px", right: "0px"`。改成 `bottom:-10px/height:3px` 时底部会留 0.5px 灰缝（标签在 51px 内容盒里居中，底边落在 41.5 而非 42），故取"宁可过冲不可差一点"。
- **`.frow.mod` 重做**：整高 `border-left` → 内缩圆角 `::before`，实测 `w:"3px" top:"6px" bottom:"6px" radius:"3px"`，行 `padding-left: 14px`。浏览器里强制四行连续 `.mod` 验证：四条独立短条，不再连成一条通天柱。
- **`:focus-visible` 真实缺陷**：`--ring: #a1a1aa` 与 `--input: #d4d4d8`／`--border: #e4e4e7` 只差一档，键盘用户看到的只是"边框略深"。先 grep 确认 `--ring` 的每一个消费方（shell.css + config.html + integrations.html）都是 focus 轮廓，才把令牌挪到 `--primary`（亮 `#2563eb` / 暗 `#60a5fa`）。Tab 实测 `fv: true`，明暗两主题均为蓝色轮廓。
- **lumen 改动有界**：`git diff` 共 9 增 31 删，全部落在 `.brand` 标记 / `.brand*` CSS / 一行 `margin-top`，无第四处。probe 静态半：2240 → 2218 行、148 → 146 个 class 属性，无裸标签选择器、无字面色号。
- **本轮知情的越界项**：lumen 的 `<title>` 仍是「Aurora×Terminal · Lumen 知识预览」，另四页是「Fabric 控制台 · X」。**没改** —— AC11 把 lumen 的批准范围限定在"正文页头及相邻布局"，扩到 `<title>` 是用户的决定，不由我静默扩。

## 收口

- [x] `pnpm -r exec tsc --noEmit`（本地必跑，不靠 build —— 三次复发史）
- [x] 全量 `pnpm -r test`
- [x] `ui-metrics-probe.mjs` 静态半通过
- [x] 九条逐条对照 AC1–AC13 勾验，未达成的写明原因而不是删判据
- [x] 归档判断：走了 `fabric-archive`。**归档 1 条、不归档 1 条**。
  - **已落 pending**（store `fabric-team`）：`knowledge/pending/pitfalls/reused-age-fn-sign-bug-at-tighter-floor.md` —— 「复用一个为宽松阈值写的年龄判据到更紧的下限前，必须重新验算它在新边界的行为：旧下限可能一直在吸收一个符号错误」。`fab_recall` 查过近邻（KT-PIT-0108 同键双消费方、KT-PIT-0071 计数口径），无重复；pending backlog 只有 1 条无关条目，不触发复审 nudge。
  - **判定不归档**：「报告了却无法处置的状态是一类 UI 缺陷」。它是本任务的出发点、不是本轮新得的判断，且写成知识条目后只是一句无触发条件、无检测线索的正确废话（活化闸的 `reached-but-inert`）。真正可复用的那一半已经落在 KT-PIT-0106/0107（读写集合必须同源、结果计数必须重读而非算差）里。

### AC1–AC13 逐条勾验

| AC | 结论 | 证据 |
|---|---|---|
| AC1 | ✅ | `applyCleanup("orphan-artifacts")` 后重跑 `collectIntegrations` 取 `remainingCount`（不是 `plan.length - removed.length`，KT-PIT-0107）；真机孤儿计数归零、"N 项需要处理"随之下降。 |
| AC2 | ✅ | 首点展开 `.cpanel` 列全路径+条数，「确认删除」才 POST；取消不发请求，磁盘零变化。 |
| AC3 | ✅ | 删除集就是页面渲染的同一个对象（`IntegrationsView.cleanup`，读写一处实现，KT-PIT-0106）；`removable` 标志把"本版不分发"与"模板读不出来"分开；`console-cleanup.test.ts` 的 packaging-fault 用例断言包坏掉时零删除。 |
| AC4 | ✅ | 集成页显示提醒缓存条目数与最旧时间；`action="hint-cache"` 清理后计数下降。清单派生自 doctor 的 `ON_DEMAND_SWEEP_FAMILIES`，不手抄（KT-PIT-0095），并有 round-trip 用例把 `stateStore.activeSessionFileName()` 与两套 family 集合对上。 |
| AC5 | ✅ | W2 已交付：卡内可关的直接给控件，需去配置页的给可点锚点（滚动+高亮）。 |
| AC6 | ✅ | W1 已交付：主体区渲染当前范围名；每行标出来源层。 |
| AC7 | ✅ | 判据由 `source !== "default"` 改为 `source === layerOf(target)`；变异（改回旧判据）实测变红。真机 8 标记 → 2 标记、误标 0。 |
| AC8 | ✅ | 按钮语义改为「移除」，toast 与标签一致；i18n 键改动同步了 `locale-parity.test.ts` 钉死计数并写了增删理由。 |
| AC9 | ✅ | 五页普查 `fabricConsole:1 / lumen:0 / aurora:0`，`navTitle` 五页一致。**唯一保留**：lumen 的 `<title>` 仍是旧文案 —— 见下方"知情未做"。 |
| AC10 | ✅ | 四档 × 五页实测 `minGap: 6`（>0）；选中态 `height:4px` + 通宽下划线，形状差异非仅颜色。 |
| AC11 | ✅ | lumen diff 9 增 31 删，全在 `.brand` 标记 / `.brand*` CSS / 一行 `margin-top`；其余渲染 probe 与截图比对一致。 |
| AC12 | ✅ | `/api/cleanup` 进 `WRITE_ROUTES`；`console-write-guard.test.ts` 单个用例内同时断言 `GET /api/cleanup === 405` 与 `GET /api/integrations === 200`（机制级，KT-PIT-0100）。 |
| AC13 | ✅ | `pnpm -r exec tsc --noEmit` 零输出；`pnpm -r test` = shared 668 / server 1216 / cli 1740 全过。新增断言逐条做过变异：越界校验 no-op、orphan 过滤放宽、`ageDays` 去掉 `Math.max(0, …)` 三个突变体均被杀。 |

**知情未做（不是遗漏，是范围）**：`lumen.html` 的 `<title>` 仍为「Aurora×Terminal · Lumen 知识预览」，与另四页的「Fabric 控制台 · X」不一致。AC11 把 lumen 的批准面限定在正文页头及相邻布局，改 `<title>` 属于扩范围，留给用户决定。

**本轮抓到的真实产品 bug（不在原计划里）**：`doctor-session-hints-stale.ts` 的 `ageDays = Math.floor((now - mtimeMs) / MS_PER_DAY)` 对刚写入的文件会算出 **-1** —— APFS 的 `mtimeMs` 带亚毫秒精度而 `Date.now()` 是整毫秒，刚写的文件常被盖上比 `now` 晚一丝的时间戳。在 doctor 的 7 天下限下这个 -1 不可见（-1 和 0 都算"太新"），但在控制台的 0 天下限下它意味着**最新的文件被静默跳过**，"清理缓存"恰好留下用户刚生成的那批。修法 `Math.max(0, …)`；回归用例用 `utimesSync(path, now+60s)` 把未来 mtime 做成确定性输入，去掉 clamp 后实测变红。

## 风险文件

| 文件 | 风险 | 处置 |
|---|---|---|
| `preview/lumen.html` | 受保护零回归文件，本轮首次批准改动 | 只动 1237-1242 及相邻布局；改动前后截图比对 |
| `preview.ts` | 新增写面，安全边界 | 请求体不含路径；机制级守卫用例 |
| `global-config-view.ts` | `modified` 是多处消费的判据 | grep 全部消费方；变异测试 |
| `shell.css` | 五页共用，改错全线受影响 | 只动令牌与已锚定的类；probe 静态断言兜底 |
| i18n 键改名 | `locale-parity.test.ts` 设计成会红 | 改钉死计数时必须写增删理由 |
